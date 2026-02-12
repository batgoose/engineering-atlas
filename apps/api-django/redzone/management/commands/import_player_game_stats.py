"""
Import player game stats aggregated from play-by-play data.

Since we only have the plays table (no player_stats table), all stats
are computed via SQL aggregation from the 52 available PBP columns.

Available for aggregation:
    passer_player_id, rusher_player_id, receiver_player_id
    complete_pass, yards_gained, touchdown, pass_touchdown, rush_touchdown
    interception, sack, fumble, epa, play_type, air_yards, yards_after_catch

NOT available (would need full nflverse player_stats):
    fumble_lost, first_down_*, 2pt conversions, kicking stats,
    pre-computed fantasy points

Populates: PlayerGameStats
Requires: Games, Teams, Players already imported.

Usage:
    python manage.py import_player_game_stats
    python manage.py import_player_game_stats --season 2024
"""

from django.db import transaction

from redzone.models import Game, Player, PlayerGameStats, Team

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}


class Command(ImportBaseCommand):
    help = "Import per-player game stats aggregated from play-by-play data."

    def handle(self, *args, **options):
        self.batch_size = options["batch_size"]
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        if not self.raw_table_exists("plays"):
            self.stderr.write(self.style.ERROR("No 'plays' table found."))
            return

        # Build caches
        self.team_cache = {t.abbreviation: t for t in Team.objects.using("nfl").all()}
        for old, new in TEAM_ABBR_MAP.items():
            if new in self.team_cache and old not in self.team_cache:
                self.team_cache[old] = self.team_cache[new]

        self.player_cache = {}
        for p in Player.objects.using("nfl").all():
            if p.gsis_id:
                self.player_cache[p.gsis_id] = p

        self.game_cache = {
            g.nflverse_game_id: g for g in Game.objects.using("nfl").all()
        }

        seasons = self.resolve_seasons(requested)
        sw = self.season_where()

        self.stdout.write(f"Importing player stats for {len(seasons)} seasons")
        self.stdout.write(
            self.style.WARNING(
                "Aggregating from plays table — no kicking stats, no fantasy pre-computation."
            )
        )

        total_created = 0
        total_updated = 0

        for year in seasons:
            self.log_season_header(year)

            with self.timed_operation(f"Aggregating player stats for {year}"):
                with self.get_nfl_cursor() as cursor:
                    cursor.execute(self._aggregation_sql(sw), [year] * 3)
                    col_names = [d[0] for d in cursor.description]
                    rows = [dict(zip(col_names, r)) for r in cursor.fetchall()]

            self.stdout.write(f"  Found {len(rows):,} player-game rows")

            if self.dry_run:
                total_created += len(rows)
                continue

            created = 0
            updated = 0
            skipped = 0
            batch = []

            with self.timed_operation(f"Writing player stats for {year}"):
                for row in rows:
                    pid = self.safe_str(row.get("player_id", ""))
                    player = self.player_cache.get(pid)
                    gid = self.safe_str(row.get("game_id", ""))
                    game = self.game_cache.get(gid)
                    team_abbr = self.safe_str(row.get("team_abbr", ""))
                    team = self.team_cache.get(team_abbr) or self.team_cache.get(
                        TEAM_ABBR_MAP.get(team_abbr, "")
                    )

                    if not all([player, game, team]):
                        skipped += 1
                        continue

                    opponent = (
                        game.away_team if game.home_team == team else game.home_team
                    )

                    defaults = {
                        "team": team,
                        "opponent": opponent,
                        "season_year": year,
                        "week": game.week,
                        "season_type": game.season_type,
                        # Passing
                        "completions": self.safe_int(row.get("completions"), 0),
                        "pass_attempts": self.safe_int(row.get("pass_attempts"), 0),
                        "passing_yards": self.safe_int(row.get("passing_yards"), 0),
                        "passing_tds": self.safe_int(row.get("passing_tds"), 0),
                        "interceptions_thrown": self.safe_int(row.get("ints"), 0),
                        "sacks_taken": self.safe_int(row.get("sacks_taken"), 0),
                        "passing_epa": self.safe_float(row.get("passing_epa")),
                        "passing_air_yards": self.safe_int(
                            row.get("passing_air_yards"), 0
                        ),
                        "passing_yards_after_catch": self.safe_int(
                            row.get("passing_yac"), 0
                        ),
                        # Rushing
                        "carries": self.safe_int(row.get("carries"), 0),
                        "rushing_yards": self.safe_int(row.get("rushing_yards"), 0),
                        "rushing_tds": self.safe_int(row.get("rushing_tds"), 0),
                        "rushing_fumbles": self.safe_int(row.get("rushing_fumbles"), 0),
                        "rushing_epa": self.safe_float(row.get("rushing_epa")),
                        # Receiving
                        "targets": self.safe_int(row.get("targets"), 0),
                        "receptions": self.safe_int(row.get("receptions"), 0),
                        "receiving_yards": self.safe_int(row.get("receiving_yards"), 0),
                        "receiving_tds": self.safe_int(row.get("receiving_tds"), 0),
                        "receiving_fumbles": self.safe_int(
                            row.get("receiving_fumbles"), 0
                        ),
                        "receiving_air_yards": self.safe_int(
                            row.get("receiving_air_yards"), 0
                        ),
                        "receiving_yards_after_catch": self.safe_int(
                            row.get("receiving_yac"), 0
                        ),
                        "receiving_epa": self.safe_float(row.get("receiving_epa")),
                    }
                    batch.append((player, game, defaults))

                    if len(batch) >= self.batch_size:
                        c, u = self._flush_batch(batch)
                        created += c
                        updated += u
                        batch = []

                if batch:
                    c, u = self._flush_batch(batch)
                    created += c
                    updated += u

            if skipped:
                self.stdout.write(
                    self.style.WARNING(f"  Skipped {skipped} (no player/game match)")
                )
            self.stdout.write(f"  Stats: {created} created, {updated} updated")
            total_created += created
            total_updated += updated

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone! {total_created} created, {total_updated} updated."
            )
        )

    def _aggregation_sql(self, season_where):
        """
        Aggregate player stats from the 52-column plays table.

        Three CTEs (passing, rushing, receiving) joined via FULL OUTER JOIN.
        """
        return f"""
        WITH passing AS (
            SELECT
                game_id,
                passer_player_id as player_id,
                passer_player_name as player_name,
                posteam,
                COUNT(*) FILTER (WHERE complete_pass = 1) as completions,
                COUNT(*) FILTER (WHERE play_type = 'pass' AND sack = 0) as pass_attempts,
                SUM(CASE WHEN play_type = 'pass' AND sack = 0 THEN yards_gained ELSE 0 END)::int as passing_yards,
                COUNT(*) FILTER (WHERE pass_touchdown = 1) as passing_tds,
                COUNT(*) FILTER (WHERE interception = 1) as ints,
                COUNT(*) FILTER (WHERE sack = 1) as sacks_taken,
                SUM(epa) FILTER (WHERE play_type = 'pass' OR sack = 1) as passing_epa,
                SUM(CASE WHEN complete_pass = 1 THEN air_yards ELSE 0 END)::int as passing_air_yards,
                SUM(CASE WHEN complete_pass = 1 THEN yards_after_catch ELSE 0 END)::int as passing_yac
            FROM plays
            WHERE {season_where}
                AND passer_player_id IS NOT NULL
                AND passer_player_id != ''
            GROUP BY game_id, passer_player_id, passer_player_name, posteam
        ),
        rushing AS (
            SELECT
                game_id,
                rusher_player_id as player_id,
                rusher_player_name as player_name,
                posteam,
                COUNT(*) as carries,
                SUM(yards_gained)::int as rushing_yards,
                COUNT(*) FILTER (WHERE rush_touchdown = 1) as rushing_tds,
                COUNT(*) FILTER (WHERE fumble = 1) as rushing_fumbles,
                SUM(epa) as rushing_epa
            FROM plays
            WHERE {season_where}
                AND play_type = 'run'
                AND rusher_player_id IS NOT NULL
                AND rusher_player_id != ''
            GROUP BY game_id, rusher_player_id, rusher_player_name, posteam
        ),
        receiving AS (
            SELECT
                game_id,
                receiver_player_id as player_id,
                receiver_player_name as player_name,
                posteam,
                COUNT(*) as targets,
                COUNT(*) FILTER (WHERE complete_pass = 1) as receptions,
                SUM(CASE WHEN complete_pass = 1 THEN yards_gained ELSE 0 END)::int as receiving_yards,
                COUNT(*) FILTER (WHERE complete_pass = 1 AND touchdown = 1) as receiving_tds,
                COUNT(*) FILTER (WHERE fumble = 1) as receiving_fumbles,
                SUM(CASE WHEN complete_pass = 1 THEN air_yards ELSE 0 END)::int as receiving_air_yards,
                SUM(CASE WHEN complete_pass = 1 THEN yards_after_catch ELSE 0 END)::int as receiving_yac,
                SUM(epa) FILTER (WHERE complete_pass = 1) as receiving_epa
            FROM plays
            WHERE {season_where}
                AND play_type = 'pass'
                AND receiver_player_id IS NOT NULL
                AND receiver_player_id != ''
            GROUP BY game_id, receiver_player_id, receiver_player_name, posteam
        )
        SELECT
            COALESCE(p.game_id, ru.game_id, re.game_id) as game_id,
            COALESCE(p.player_id, ru.player_id, re.player_id) as player_id,
            COALESCE(p.player_name, ru.player_name, re.player_name) as player_name,
            COALESCE(p.posteam, ru.posteam, re.posteam) as team_abbr,
            -- Passing
            COALESCE(p.completions, 0) as completions,
            COALESCE(p.pass_attempts, 0) as pass_attempts,
            COALESCE(p.passing_yards, 0) as passing_yards,
            COALESCE(p.passing_tds, 0) as passing_tds,
            COALESCE(p.ints, 0) as ints,
            COALESCE(p.sacks_taken, 0) as sacks_taken,
            p.passing_epa,
            COALESCE(p.passing_air_yards, 0) as passing_air_yards,
            COALESCE(p.passing_yac, 0) as passing_yac,
            -- Rushing
            COALESCE(ru.carries, 0) as carries,
            COALESCE(ru.rushing_yards, 0) as rushing_yards,
            COALESCE(ru.rushing_tds, 0) as rushing_tds,
            COALESCE(ru.rushing_fumbles, 0) as rushing_fumbles,
            ru.rushing_epa,
            -- Receiving
            COALESCE(re.targets, 0) as targets,
            COALESCE(re.receptions, 0) as receptions,
            COALESCE(re.receiving_yards, 0) as receiving_yards,
            COALESCE(re.receiving_tds, 0) as receiving_tds,
            COALESCE(re.receiving_fumbles, 0) as receiving_fumbles,
            COALESCE(re.receiving_air_yards, 0) as receiving_air_yards,
            COALESCE(re.receiving_yac, 0) as receiving_yac,
            re.receiving_epa
        FROM passing p
        FULL OUTER JOIN rushing ru
            ON p.game_id = ru.game_id AND p.player_id = ru.player_id
        FULL OUTER JOIN receiving re
            ON COALESCE(p.game_id, ru.game_id) = re.game_id
            AND COALESCE(p.player_id, ru.player_id) = re.player_id
        ORDER BY game_id, player_id
        """

    def _flush_batch(self, batch):
        created = 0
        updated = 0
        with transaction.atomic(using="nfl"):
            for player, game, defaults in batch:
                _, was_created = PlayerGameStats.objects.using("nfl").update_or_create(
                    player=player,
                    game=game,
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
        return created, updated
