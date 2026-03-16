"""
Materialize modeled TeamGameStats rows from raw nflverse team stats payloads.

Source:
    raw.raw_nflverse_team_stats (loaded by import_team_game_stats)

This command is deterministic per season:
1) delete existing gridstream_teamgamestats rows for each target season
2) rebuild from raw rows joined to canonical Game/Team FKs
"""

from __future__ import annotations

import json

from django.core.management.base import CommandError
from django.db import transaction

from gridstream.models import Game, Team, TeamGameStats

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}


class Command(ImportBaseCommand):
    help = "Materialize gridstream_teamgamestats from raw.raw_nflverse_team_stats."

    def handle(self, *args, **options):
        self.batch_size = max(1, options["batch_size"])
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        self._ensure_required_tables()
        seasons = self._resolve_target_seasons(requested)
        if not seasons:
            self.stdout.write(
                self.style.WARNING("No seasons selected; nothing to materialize.")
            )
            return

        self.team_id_by_abbr = self._load_team_ids()
        self.game_cache = self._load_game_cache()

        self.stdout.write(
            f"Materializing TeamGameStats for {len(seasons)} seasons: "
            f"{seasons[0]}-{seasons[-1]}"
        )

        total_deleted = 0
        total_inserted = 0
        total_skipped = 0

        for season in seasons:
            self.log_season_header(season)

            with self.get_nfl_cursor() as cursor:
                cursor.execute(
                    "SELECT COUNT(*) FROM raw.raw_nflverse_team_stats WHERE season = %s",
                    [season],
                )
                raw_rows = int(cursor.fetchone()[0])

            self.stdout.write(f"  Raw rows: {raw_rows:,}")
            if raw_rows == 0:
                continue

            if self.dry_run:
                total_inserted += raw_rows
                continue

            with transaction.atomic(using="nfl"):
                deleted = self._delete_existing_for_season(season)
                inserted, skipped = self._materialize_season(season)

            self.stdout.write(
                f"  Deleted {deleted:,}, inserted {inserted:,}, skipped {skipped:,}"
            )
            total_deleted += deleted
            total_inserted += inserted
            total_skipped += skipped

        if self.dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"\nDRY RUN only: would insert about {total_inserted:,} rows."
                )
            )
            return

        self.stdout.write(
            self.style.SUCCESS(
                "\nDone! "
                f"{total_inserted:,} inserted, "
                f"{total_deleted:,} deleted, "
                f"{total_skipped:,} skipped."
            )
        )

    def _ensure_required_tables(self):
        with self.get_nfl_cursor() as cursor:
            cursor.execute("""
                SELECT
                    to_regclass('raw.raw_nflverse_team_stats'),
                    to_regclass('gridstream_teamgamestats')
                """)
            raw_ref, model_ref = cursor.fetchone()

        if not raw_ref:
            raise CommandError(
                "Missing table raw.raw_nflverse_team_stats. Run import_team_game_stats first."
            )
        if not model_ref:
            raise CommandError(
                "Missing table gridstream_teamgamestats. Run migrations first."
            )

    def _resolve_target_seasons(self, requested):
        if requested:
            return sorted({int(s) for s in requested})

        with self.get_nfl_cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT season
                FROM raw.raw_nflverse_team_stats
                WHERE season IS NOT NULL
                ORDER BY season
                """)
            return [int(r[0]) for r in cursor.fetchall()]

    def _load_team_ids(self):
        out = {
            t.abbreviation: t.id
            for t in Team.objects.using("nfl").only("id", "abbreviation")
        }
        for old, new in TEAM_ABBR_MAP.items():
            if new in out and old not in out:
                out[old] = out[new]
        return out

    def _load_game_cache(self):
        return {
            g.nflverse_game_id: {
                "id": g.id,
                "season_id": g.season_id,
                "week": g.week,
                "home_team_id": g.home_team_id,
                "away_team_id": g.away_team_id,
                "home_score": g.home_score,
                "away_score": g.away_score,
            }
            for g in Game.objects.using("nfl")
            .exclude(nflverse_game_id__isnull=True)
            .exclude(nflverse_game_id="")
            .only(
                "id",
                "nflverse_game_id",
                "season_id",
                "week",
                "home_team_id",
                "away_team_id",
                "home_score",
                "away_score",
            )
        }

    def _delete_existing_for_season(self, season):
        deleted, _detail = (
            TeamGameStats.objects.using("nfl").filter(season_year=season).delete()
        )
        return int(deleted)

    def _materialize_season(self, season):
        sql = """
            SELECT
                game_id,
                week,
                team,
                opponent,
                home_away,
                payload
            FROM raw.raw_nflverse_team_stats
            WHERE season = %s
        """

        inserted = 0
        skipped = 0
        batch = []

        with self.get_nfl_cursor() as cursor:
            cursor.execute(sql, [season])
            while True:
                rows = cursor.fetchmany(self.batch_size)
                if not rows:
                    break

                for game_id, week, team, opponent, home_away, payload in rows:
                    game = self.game_cache.get(self.safe_str(game_id, default=""))
                    if not game:
                        skipped += 1
                        continue

                    team_fk = self.team_id_by_abbr.get(self._canonical_team(team))
                    opponent_fk = self.team_id_by_abbr.get(
                        self._canonical_team(opponent)
                    )
                    if not team_fk or not opponent_fk:
                        skipped += 1
                        continue

                    raw_payload = self._coerce_payload(payload)
                    week_num = (
                        self.safe_int(week)
                        or self.safe_int(raw_payload.get("week"))
                        or game["week"]
                    )
                    if not week_num:
                        skipped += 1
                        continue

                    is_home = self._resolve_is_home(
                        team_id=team_fk,
                        home_away=home_away,
                        game=game,
                    )
                    points_scored, points_allowed = self._resolve_points(
                        is_home=is_home,
                        game=game,
                    )

                    obj = self._build_team_game_stats(
                        season=season,
                        week=week_num,
                        game_id=game["id"],
                        team_id=team_fk,
                        opponent_id=opponent_fk,
                        is_home=is_home,
                        points_scored=points_scored,
                        points_allowed=points_allowed,
                        payload=raw_payload,
                    )
                    batch.append(obj)

                if len(batch) >= self.batch_size:
                    TeamGameStats.objects.using("nfl").bulk_create(
                        batch, batch_size=self.batch_size
                    )
                    inserted += len(batch)
                    batch = []

        if batch:
            TeamGameStats.objects.using("nfl").bulk_create(
                batch, batch_size=self.batch_size
            )
            inserted += len(batch)

        return inserted, skipped

    def _build_team_game_stats(
        self,
        *,
        season,
        week,
        game_id,
        team_id,
        opponent_id,
        is_home,
        points_scored,
        points_allowed,
        payload,
    ):
        pass_yards = self._int(payload, "passing_yards")
        rush_yards = self._int(payload, "rushing_yards")
        misc_yards = self._int(payload, "misc_yards")
        pass_attempts = self._int(payload, "attempts")
        rush_attempts = self._int(payload, "carries")
        pass_first_downs = self._int(payload, "passing_first_downs")
        rush_first_downs = self._int(payload, "rushing_first_downs")
        first_downs_penalty = self._int(payload, "penalty_first_downs")

        interceptions_lost = self._int(payload, "passing_interceptions")
        fumbles_lost = self._int(payload, "rushing_fumbles_lost") + self._int(
            payload, "sack_fumbles_lost"
        )

        interceptions_caught = self._int(payload, "def_interceptions")
        fumbles_recovered = self._int(payload, "fumble_recovery_opp")
        takeaways = interceptions_caught + fumbles_recovered

        sacks_made = self._float(payload, "def_sacks", 0.0)
        defensive_tds = self._int(payload, "def_tds")
        safeties = self._int(payload, "def_safeties")
        blocked_kicks = (
            self._int(payload, "fg_blocked")
            + self._int(payload, "pat_blocked")
            + self._int(payload, "gwfg_blocked")
        )
        return_tds = self._int(payload, "special_teams_tds")

        passing_epa = self._float(payload, "passing_epa", None)
        rushing_epa = self._float(payload, "rushing_epa", None)
        offensive_epa = None
        if passing_epa is not None or rushing_epa is not None:
            offensive_epa = (passing_epa or 0.0) + (rushing_epa or 0.0)

        return TeamGameStats(
            team_id=team_id,
            game_id=game_id,
            opponent_id=opponent_id,
            season_year=season,
            week=week,
            is_home=is_home,
            # Offense
            total_yards=pass_yards + rush_yards + misc_yards,
            total_plays=pass_attempts + rush_attempts,
            first_downs=pass_first_downs + rush_first_downs + first_downs_penalty,
            first_downs_passing=pass_first_downs,
            first_downs_rushing=rush_first_downs,
            first_downs_penalty=first_downs_penalty,
            third_down_attempts=self._int(payload, "third_down_attempts"),
            third_down_conversions=self._int(payload, "third_down_conversions"),
            fourth_down_attempts=self._int(payload, "fourth_down_attempts"),
            fourth_down_conversions=self._int(payload, "fourth_down_conversions"),
            redzone_attempts=self._int(payload, "redzone_attempts"),
            redzone_scores=self._int(payload, "redzone_scores"),
            # Passing
            pass_completions=self._int(payload, "completions"),
            pass_attempts=pass_attempts,
            pass_yards=pass_yards,
            pass_tds=self._int(payload, "passing_tds"),
            pass_ints=interceptions_lost,
            sacks_allowed=self._int(payload, "sacks_suffered"),
            sack_yards_allowed=abs(self._int(payload, "sack_yards_lost")),
            passer_rating=self._float(payload, "passer_rating", None),
            # Rushing
            rush_attempts=rush_attempts,
            rush_yards=rush_yards,
            rush_tds=self._int(payload, "rushing_tds"),
            # Turnovers
            turnovers=interceptions_lost + fumbles_lost,
            fumbles_lost=fumbles_lost,
            interceptions_lost=interceptions_lost,
            # Defense
            sacks_made=sacks_made,
            takeaways=takeaways,
            interceptions_caught=interceptions_caught,
            fumbles_recovered=fumbles_recovered,
            defensive_tds=defensive_tds,
            # Special teams
            punt_return_yards=self._int(payload, "punt_return_yards"),
            kick_return_yards=self._int(payload, "kickoff_return_yards"),
            return_tds=return_tds,
            # Penalties
            penalties=self._int(payload, "penalties"),
            penalty_yards=self._int(payload, "penalty_yards"),
            # Possession
            time_of_possession=self.safe_str(
                payload.get("time_of_possession"), default=""
            ),
            time_of_possession_seconds=self._parse_time_to_seconds(
                payload.get("time_of_possession")
            ),
            # Score
            points_scored=points_scored,
            points_allowed=points_allowed,
            # Analytics
            offensive_epa=offensive_epa,
            defensive_epa=self._float(payload, "defensive_epa", None),
            passing_epa=passing_epa,
            rushing_epa=rushing_epa,
            fantasy_dst_points=self._calculate_dst_points(
                points_allowed=points_allowed,
                sacks_made=sacks_made,
                takeaways=takeaways,
                defensive_tds=defensive_tds,
                safeties=safeties,
                blocked_kicks=blocked_kicks,
                return_tds=return_tds,
            ),
        )

    def _resolve_is_home(self, *, team_id, home_away, game):
        if team_id == game["home_team_id"]:
            return True
        if team_id == game["away_team_id"]:
            return False
        return self.safe_str(home_away, default="").lower() == "home"

    def _resolve_points(self, *, is_home, game):
        if is_home:
            return game["home_score"], game["away_score"]
        return game["away_score"], game["home_score"]

    def _canonical_team(self, team_abbr):
        abbr = self.safe_str(team_abbr, default="").upper()
        if not abbr:
            return ""
        return TEAM_ABBR_MAP.get(abbr, abbr)

    def _coerce_payload(self, payload):
        if isinstance(payload, dict):
            return payload
        if isinstance(payload, str):
            try:
                parsed = json.loads(payload)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                return {}
        return {}

    def _int(self, payload, key, default=0):
        value = self.safe_int(payload.get(key))
        return default if value is None else value

    def _float(self, payload, key, default=0.0):
        value = self.safe_float(payload.get(key))
        return default if value is None else value

    def _parse_time_to_seconds(self, value):
        text = self.safe_str(value, default="")
        if not text or ":" not in text:
            return 0
        mins, secs = text.split(":", 1)
        mins_val = self.safe_int(mins)
        secs_val = self.safe_int(secs)
        if mins_val is None or secs_val is None:
            return 0
        return (mins_val * 60) + secs_val

    def _calculate_dst_points(
        self,
        *,
        points_allowed,
        sacks_made,
        takeaways,
        defensive_tds,
        safeties,
        blocked_kicks,
        return_tds,
    ):
        # Standard fantasy DST baseline by points allowed.
        if points_allowed == 0:
            base = 10
        elif points_allowed <= 6:
            base = 7
        elif points_allowed <= 13:
            base = 4
        elif points_allowed <= 20:
            base = 1
        elif points_allowed <= 27:
            base = 0
        elif points_allowed <= 34:
            base = -1
        else:
            base = -4

        bonus = (
            sacks_made
            + (takeaways * 2)
            + ((defensive_tds + return_tds) * 6)
            + (safeties * 2)
            + (blocked_kicks * 2)
        )
        return round(float(base + bonus), 2)
