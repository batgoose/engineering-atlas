"""
Materialize legacy public.plays rows from raw.raw_nflverse_pbp payloads.

The v2 ingest writes authoritative play-by-play data into raw.raw_nflverse_pbp.
Several existing transform commands still read from the historical public.plays
projection. This command deterministically rebuilds that projection per season.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


class Command(BaseCommand):
    help = "Rebuild public.plays from raw.raw_nflverse_pbp."

    INSERT_SQL = """
        INSERT INTO plays (
            game_id,
            play_id,
            old_game_id,
            drive,
            home_team,
            away_team,
            posteam,
            posteam_type,
            defteam,
            game_date,
            season_type,
            week,
            stadium,
            weather,
            surface,
            roof,
            qtr,
            quarter_seconds_remaining,
            half_seconds_remaining,
            game_seconds_remaining,
            down,
            ydstogo,
            yardline_100,
            side_of_field,
            shotgun,
            no_huddle,
            play_type,
            yards_gained,
            air_yards,
            yards_after_catch,
            epa,
            wpa,
            success,
            passer_player_id,
            passer_player_name,
            rusher_player_id,
            rusher_player_name,
            receiver_player_id,
            receiver_player_name,
            touchdown,
            interception,
            fumble,
            sack,
            complete_pass,
            pass_touchdown,
            rush_touchdown,
            field_goal_result,
            kick_distance,
            punt_blocked,
            penalty,
            penalty_type,
            penalty_yards
        )
        SELECT
            p.game_id,
            NULLIF(COALESCE(p.payload->>'play_id', p.play_id), '')::double precision AS play_id,
            NULLIF(p.payload->>'old_game_id', '') AS old_game_id,
            NULLIF(p.payload->>'drive', '')::double precision AS drive,
            NULLIF(p.payload->>'home_team', '') AS home_team,
            NULLIF(p.payload->>'away_team', '') AS away_team,
            COALESCE(NULLIF(p.posteam, ''), NULLIF(p.payload->>'posteam', '')) AS posteam,
            NULLIF(p.payload->>'posteam_type', '') AS posteam_type,
            COALESCE(NULLIF(p.defteam, ''), NULLIF(p.payload->>'defteam', '')) AS defteam,
            NULLIF(p.payload->>'game_date', '')::date AS game_date,
            NULLIF(p.payload->>'season_type', '') AS season_type,
            COALESCE(NULLIF(p.payload->>'week', '')::int, p.week) AS week,
            NULLIF(p.payload->>'stadium', '') AS stadium,
            NULLIF(p.payload->>'weather', '') AS weather,
            NULLIF(p.payload->>'surface', '') AS surface,
            NULLIF(p.payload->>'roof', '') AS roof,
            NULLIF(p.payload->>'qtr', '')::double precision::int AS qtr,
            NULLIF(p.payload->>'quarter_seconds_remaining', '')::real AS quarter_seconds_remaining,
            NULLIF(p.payload->>'half_seconds_remaining', '')::real AS half_seconds_remaining,
            NULLIF(p.payload->>'game_seconds_remaining', '')::real AS game_seconds_remaining,
            NULLIF(p.payload->>'down', '')::double precision::int AS down,
            NULLIF(p.payload->>'ydstogo', '')::double precision::int AS ydstogo,
            NULLIF(p.payload->>'yardline_100', '')::double precision::int AS yardline_100,
            NULLIF(p.payload->>'side_of_field', '') AS side_of_field,
            NULLIF(p.payload->>'shotgun', '')::double precision::int AS shotgun,
            NULLIF(p.payload->>'no_huddle', '')::double precision::int AS no_huddle,
            NULLIF(p.payload->>'play_type', '') AS play_type,
            NULLIF(p.payload->>'yards_gained', '')::real AS yards_gained,
            NULLIF(p.payload->>'air_yards', '')::real AS air_yards,
            NULLIF(p.payload->>'yards_after_catch', '')::real AS yards_after_catch,
            NULLIF(p.payload->>'epa', '')::real AS epa,
            NULLIF(p.payload->>'wpa', '')::real AS wpa,
            NULLIF(p.payload->>'success', '')::real AS success,
            NULLIF(p.payload->>'passer_player_id', '') AS passer_player_id,
            NULLIF(p.payload->>'passer_player_name', '') AS passer_player_name,
            NULLIF(p.payload->>'rusher_player_id', '') AS rusher_player_id,
            NULLIF(p.payload->>'rusher_player_name', '') AS rusher_player_name,
            NULLIF(p.payload->>'receiver_player_id', '') AS receiver_player_id,
            NULLIF(p.payload->>'receiver_player_name', '') AS receiver_player_name,
            NULLIF(p.payload->>'touchdown', '')::real AS touchdown,
            NULLIF(p.payload->>'interception', '')::real AS interception,
            NULLIF(p.payload->>'fumble', '')::real AS fumble,
            NULLIF(p.payload->>'sack', '')::real AS sack,
            NULLIF(p.payload->>'complete_pass', '')::real AS complete_pass,
            NULLIF(p.payload->>'pass_touchdown', '')::real AS pass_touchdown,
            NULLIF(p.payload->>'rush_touchdown', '')::real AS rush_touchdown,
            NULLIF(p.payload->>'field_goal_result', '') AS field_goal_result,
            NULLIF(p.payload->>'kick_distance', '')::real AS kick_distance,
            NULLIF(p.payload->>'punt_blocked', '')::real AS punt_blocked,
            NULLIF(p.payload->>'penalty', '')::real AS penalty,
            NULLIF(p.payload->>'penalty_type', '') AS penalty_type,
            NULLIF(p.payload->>'penalty_yards', '')::real AS penalty_yards
        FROM raw.raw_nflverse_pbp p
        WHERE p.season = %s
            AND p.game_id IS NOT NULL
            AND p.game_id <> ''
            AND NULLIF(COALESCE(p.payload->>'play_id', p.play_id), '') IS NOT NULL
    """

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            nargs="*",
            help="Specific season(s) to materialize. Omit for all seasons in raw table.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview deletes/inserts without writing.",
        )

    def handle(self, *args, **options):
        requested = options.get("season")
        dry_run = options.get("dry_run", False)

        self._ensure_tables_exist()
        seasons = self._resolve_seasons(requested)
        if not seasons:
            self.stdout.write(
                self.style.WARNING("No seasons found in raw.raw_nflverse_pbp.")
            )
            return

        self.stdout.write(
            f"Materializing plays projection for {len(seasons)} seasons: "
            f"{seasons[0]}-{seasons[-1]}"
        )

        total_deleted = 0
        total_inserted = 0

        for season in seasons:
            self.stdout.write(self.style.MIGRATE_HEADING(f"\nSeason {season}"))
            with connections["nfl"].cursor() as cursor:
                cursor.execute(
                    "SELECT COUNT(*) FROM plays WHERE SPLIT_PART(game_id, '_', 1)::int = %s",
                    [season],
                )
                existing = int(cursor.fetchone()[0])

                cursor.execute(
                    "SELECT COUNT(*) FROM raw.raw_nflverse_pbp WHERE season = %s",
                    [season],
                )
                source_count = int(cursor.fetchone()[0])

            self.stdout.write(
                f"  Existing plays: {existing:,}, raw source rows: {source_count:,}"
            )

            if dry_run:
                total_deleted += existing
                total_inserted += source_count
                continue

            with transaction.atomic(using="nfl"):
                with connections["nfl"].cursor() as cursor:
                    cursor.execute(
                        "DELETE FROM plays WHERE SPLIT_PART(game_id, '_', 1)::int = %s",
                        [season],
                    )
                    deleted = cursor.rowcount
                    cursor.execute(self.INSERT_SQL, [season])
                    inserted = cursor.rowcount

            total_deleted += deleted
            total_inserted += inserted
            self.stdout.write(f"  Deleted {deleted:,}, inserted {inserted:,}")

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"\nDRY RUN only: would delete {total_deleted:,}, "
                    f"would insert {total_inserted:,}."
                )
            )
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone! Deleted {total_deleted:,}, inserted {total_inserted:,}."
            )
        )

    def _ensure_tables_exist(self):
        with connections["nfl"].cursor() as cursor:
            cursor.execute("""
                SELECT
                    to_regclass('raw.raw_nflverse_pbp'),
                    to_regclass('public.plays')
                """)
            raw_ref, plays_ref = cursor.fetchone()

        if not raw_ref:
            raise CommandError(
                "Missing raw.raw_nflverse_pbp. Run raw ingest before materializing plays."
            )
        if not plays_ref:
            raise CommandError("Missing public.plays table. Run migrations first.")

    def _resolve_seasons(self, requested):
        if requested:
            return sorted({int(s) for s in requested})

        with connections["nfl"].cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT season
                FROM raw.raw_nflverse_pbp
                WHERE season IS NOT NULL
                ORDER BY season
                """)
            return [int(r[0]) for r in cursor.fetchall()]
