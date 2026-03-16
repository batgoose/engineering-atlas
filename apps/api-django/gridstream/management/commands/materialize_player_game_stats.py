"""
Materialize modeled PlayerGameStats rows from raw nflverse player stats payloads.

Source:
    raw.raw_nflverse_player_stats (loaded by import_player_game_stats)

This command is deterministic per season:
1) delete existing gridstream_playergamestats rows for each target season
2) rebuild from raw rows joined to canonical Game/Player/Team FKs
"""

from __future__ import annotations

import json

from django.core.management.base import CommandError
from django.db import transaction

from gridstream.models import Game, Player, PlayerGameStats, Team

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}


class Command(ImportBaseCommand):
    help = "Materialize gridstream_playergamestats from raw.raw_nflverse_player_stats."

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
        self.player_id_by_gsis = self._load_player_ids()
        self.game_cache = self._load_game_cache()

        self.stdout.write(
            f"Materializing PlayerGameStats for {len(seasons)} seasons: "
            f"{seasons[0]}-{seasons[-1]}"
        )

        total_deleted = 0
        total_inserted = 0
        total_skipped = 0

        for season in seasons:
            self.log_season_header(season)

            with self.get_nfl_cursor() as cursor:
                cursor.execute(
                    "SELECT COUNT(*) FROM raw.raw_nflverse_player_stats WHERE season = %s",
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
                    to_regclass('raw.raw_nflverse_player_stats'),
                    to_regclass('gridstream_playergamestats')
                """)
            raw_ref, model_ref = cursor.fetchone()

        if not raw_ref:
            raise CommandError(
                "Missing table raw.raw_nflverse_player_stats. Run import_player_game_stats first."
            )
        if not model_ref:
            raise CommandError(
                "Missing table gridstream_playergamestats. Run migrations first."
            )

    def _resolve_target_seasons(self, requested):
        if requested:
            return sorted({int(s) for s in requested})

        with self.get_nfl_cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT season
                FROM raw.raw_nflverse_player_stats
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

    def _load_player_ids(self):
        return {
            p.gsis_id: p.id
            for p in Player.objects.using("nfl").only("id", "gsis_id")
            if p.gsis_id
        }

    def _load_game_cache(self):
        return {
            g.nflverse_game_id: {
                "id": g.id,
                "season_id": g.season_id,
                "week": g.week,
                "season_type": g.season_type,
            }
            for g in Game.objects.using("nfl")
            .exclude(nflverse_game_id__isnull=True)
            .exclude(nflverse_game_id="")
            .only("id", "nflverse_game_id", "season_id", "week", "season_type")
        }

    def _delete_existing_for_season(self, season):
        deleted, _detail = (
            PlayerGameStats.objects.using("nfl").filter(season_year=season).delete()
        )
        return int(deleted)

    def _materialize_season(self, season):
        sql = """
            SELECT
                game_id,
                week,
                player_id,
                team,
                opponent,
                payload
            FROM raw.raw_nflverse_player_stats
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

                for game_id, week, player_id, team, opponent, payload in rows:
                    game = self.game_cache.get(self.safe_str(game_id, default=""))
                    if not game:
                        skipped += 1
                        continue

                    player_fk = self.player_id_by_gsis.get(
                        self.safe_str(player_id, default="")
                    )
                    if not player_fk:
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

                    obj = self._build_player_game_stats(
                        season=season,
                        week=week_num,
                        season_type=raw_payload.get("season_type")
                        or game["season_type"],
                        game_id=game["id"],
                        player_id=player_fk,
                        team_id=team_fk,
                        opponent_id=opponent_fk,
                        payload=raw_payload,
                    )
                    batch.append(obj)

                if len(batch) >= self.batch_size:
                    PlayerGameStats.objects.using("nfl").bulk_create(
                        batch, batch_size=self.batch_size
                    )
                    inserted += len(batch)
                    batch = []

        if batch:
            PlayerGameStats.objects.using("nfl").bulk_create(
                batch, batch_size=self.batch_size
            )
            inserted += len(batch)

        return inserted, skipped

    def _build_player_game_stats(
        self,
        *,
        season,
        week,
        season_type,
        game_id,
        player_id,
        team_id,
        opponent_id,
        payload,
    ):
        tackles_solo = self._int(payload, "def_tackles_solo")
        tackles_assists = self._int(payload, "def_tackle_assists")
        fumble_recovery_opp = self._int(payload, "fumble_recovery_opp")
        fumble_recovery_own = self._int(payload, "fumble_recovery_own")

        obj = PlayerGameStats(
            player_id=player_id,
            game_id=game_id,
            team_id=team_id,
            opponent_id=opponent_id,
            season_year=season,
            week=week,
            season_type=self._normalize_season_type(season_type),
            # Passing
            completions=self._int(payload, "completions"),
            pass_attempts=self._int(payload, "attempts"),
            passing_yards=self._int(payload, "passing_yards"),
            passing_tds=self._int(payload, "passing_tds"),
            interceptions_thrown=self._int(payload, "passing_interceptions"),
            sacks_taken=self._int(payload, "sacks_suffered"),
            sack_yards_lost=abs(self._int(payload, "sack_yards_lost")),
            sack_fumbles=self._int(payload, "sack_fumbles"),
            sack_fumbles_lost=self._int(payload, "sack_fumbles_lost"),
            passing_air_yards=self._int(payload, "passing_air_yards"),
            passing_yards_after_catch=self._int(payload, "passing_yards_after_catch"),
            passing_first_downs=self._int(payload, "passing_first_downs"),
            passing_2pt_conversions=self._int(payload, "passing_2pt_conversions"),
            passing_epa=self._float(payload, "passing_epa", None),
            passer_rating=self._float(payload, "passer_rating", None),
            qbr=self._float(payload, "qbr", None),
            # Rushing
            carries=self._int(payload, "carries"),
            rushing_yards=self._int(payload, "rushing_yards"),
            rushing_tds=self._int(payload, "rushing_tds"),
            rushing_fumbles=self._int(payload, "rushing_fumbles"),
            rushing_fumbles_lost=self._int(payload, "rushing_fumbles_lost"),
            rushing_first_downs=self._int(payload, "rushing_first_downs"),
            rushing_2pt_conversions=self._int(payload, "rushing_2pt_conversions"),
            rushing_epa=self._float(payload, "rushing_epa", None),
            rushing_long=self._int(payload, "rushing_long"),
            # Receiving
            receptions=self._int(payload, "receptions"),
            targets=self._int(payload, "targets"),
            receiving_yards=self._int(payload, "receiving_yards"),
            receiving_tds=self._int(payload, "receiving_tds"),
            receiving_fumbles=self._int(payload, "receiving_fumbles"),
            receiving_fumbles_lost=self._int(payload, "receiving_fumbles_lost"),
            receiving_air_yards=self._int(payload, "receiving_air_yards"),
            receiving_yards_after_catch=self._int(
                payload, "receiving_yards_after_catch"
            ),
            receiving_first_downs=self._int(payload, "receiving_first_downs"),
            receiving_2pt_conversions=self._int(payload, "receiving_2pt_conversions"),
            receiving_epa=self._float(payload, "receiving_epa", None),
            receiving_long=self._int(payload, "receiving_long"),
            target_share=self._float(payload, "target_share", None),
            air_yards_share=self._float(payload, "air_yards_share", None),
            wopr=self._float(payload, "wopr", None),
            # Defense
            tackles_total=tackles_solo + tackles_assists,
            tackles_solo=tackles_solo,
            tackles_assists=tackles_assists,
            tackles_for_loss=self._float(payload, "def_tackles_for_loss", 0.0),
            sacks_made=self._float(payload, "def_sacks", 0.0),
            qb_hits=self._int(payload, "def_qb_hits"),
            passes_defended=self._int(payload, "def_pass_defended"),
            interceptions_caught=self._int(payload, "def_interceptions"),
            interception_yards=self._int(payload, "def_interception_yards"),
            interception_tds=self._int(payload, "def_interception_tds"),
            forced_fumbles=self._int(payload, "def_fumbles_forced"),
            fumble_recoveries=fumble_recovery_opp + fumble_recovery_own,
            defensive_tds=self._int(payload, "def_tds"),
            safeties=self._int(payload, "def_safeties"),
            blocked_kicks=(
                self._int(payload, "fg_blocked")
                + self._int(payload, "pat_blocked")
                + self._int(payload, "gwfg_blocked")
            ),
            # Special teams
            kick_return_attempts=self._int(payload, "kickoff_returns"),
            kick_return_yards=self._int(payload, "kickoff_return_yards"),
            kick_return_tds=self._int(payload, "kickoff_return_tds"),
            punt_return_attempts=self._int(payload, "punt_returns"),
            punt_return_yards=self._int(payload, "punt_return_yards"),
            punt_return_tds=self._int(payload, "punt_return_tds"),
            special_teams_tds=self._int(payload, "special_teams_tds"),
            # Kicking
            fg_attempts=self._int(payload, "fg_att"),
            fg_made=self._int(payload, "fg_made"),
            fg_long=self._int(payload, "fg_long"),
            fg_made_0_19=self._int(payload, "fg_made_0_19"),
            fg_made_20_29=self._int(payload, "fg_made_20_29"),
            fg_made_30_39=self._int(payload, "fg_made_30_39"),
            fg_made_40_49=self._int(payload, "fg_made_40_49"),
            fg_made_50_59=self._int(payload, "fg_made_50_59"),
            fg_made_60_plus=self._int(payload, "fg_made_60_"),
            pat_attempts=self._int(payload, "pat_att"),
            pat_made=self._int(payload, "pat_made"),
            pat_missed=self._int(payload, "pat_missed"),
            # Punting (not consistently present in this dataset)
            punt_attempts=self._int(payload, "punt_attempts"),
            punt_yards=self._int(payload, "punt_yards"),
            punt_long=self._int(payload, "punt_long"),
            punt_inside_20=self._int(payload, "punt_inside_20"),
            punt_touchbacks=self._int(payload, "punt_touchbacks"),
        )

        self._set_fantasy_points(obj, payload)
        return obj

    def _set_fantasy_points(self, obj: PlayerGameStats, payload: dict):
        standard = self._float(payload, "fantasy_points", None)
        ppr = self._float(payload, "fantasy_points_ppr", None)

        if standard is None and ppr is None:
            standard = obj.calculate_fantasy_points("standard")
            ppr = obj.calculate_fantasy_points("ppr")
            half_ppr = obj.calculate_fantasy_points("half_ppr")
        else:
            if standard is None and ppr is not None:
                standard = ppr - obj.receptions
            if ppr is None and standard is not None:
                ppr = standard + obj.receptions
            half_ppr = (standard or 0.0) + (obj.receptions * 0.5)

        obj.fantasy_points_standard = (
            round(float(standard), 2) if standard is not None else None
        )
        obj.fantasy_points_ppr = round(float(ppr), 2) if ppr is not None else None
        obj.fantasy_points_half_ppr = (
            round(float(half_ppr), 2) if half_ppr is not None else None
        )

    def _canonical_team(self, team_abbr):
        abbr = self.safe_str(team_abbr, default="").upper()
        if not abbr:
            return ""
        return TEAM_ABBR_MAP.get(abbr, abbr)

    def _normalize_season_type(self, season_type):
        normalized = self.safe_str(season_type, default="REG").upper()
        if normalized in {"REG", "POST", "PRE"}:
            return normalized
        return "REG"

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
