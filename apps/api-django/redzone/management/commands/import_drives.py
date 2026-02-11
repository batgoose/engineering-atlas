"""
Import drives aggregated from play-by-play data.

Uses the 'drive' column (not fixed_drive which doesn't exist in our schema).
Drive result is inferred from the last play of each drive.

Available columns for aggregation:
    game_id, drive, posteam, qtr, game_seconds_remaining,
    quarter_seconds_remaining, yardline_100, yards_gained, play_type,
    touchdown, interception, fumble, field_goal_result, punt_blocked

NOT available: fixed_drive, fixed_drive_result, desc, first_down_*

Populates: Drive
Requires: Games and Teams already imported.

Usage:
    python manage.py import_drives
    python manage.py import_drives --season 2024
"""

from django.db import transaction

from redzone.models import Drive, Game, Team

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}


class Command(ImportBaseCommand):
    help = "Import drives aggregated from play-by-play data."

    def handle(self, *args, **options):
        self.batch_size = options["batch_size"]
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        if not self.raw_table_exists("plays"):
            self.stderr.write(self.style.ERROR("No 'plays' table found."))
            return

        self.team_cache = {t.abbreviation: t for t in Team.objects.using("nfl").all()}
        for old, new in TEAM_ABBR_MAP.items():
            if new in self.team_cache and old not in self.team_cache:
                self.team_cache[old] = self.team_cache[new]

        self.game_cache = {
            g.nflverse_game_id: g for g in Game.objects.using("nfl").all()
        }

        seasons = self.resolve_seasons(requested)
        sw = self.season_where()

        self.stdout.write(f"Importing drives for {len(seasons)} seasons")

        total_created = 0
        total_updated = 0

        for year in seasons:
            self.log_season_header(year)

            with self.timed_operation(f"Aggregating drives for {year}"):
                with self.get_nfl_cursor() as cursor:
                    cursor.execute(f"""
                        SELECT
                            game_id,
                            drive,
                            -- Possession: most common posteam in the drive
                            MODE() WITHIN GROUP (ORDER BY posteam) as posteam,
                            -- Boundaries
                            MIN(qtr) as start_quarter,
                            MAX(qtr) as end_quarter,
                            MAX(quarter_seconds_remaining) as start_clock_secs,
                            MIN(quarter_seconds_remaining) as end_clock_secs,
                            MAX(yardline_100) as start_yardline,
                            MIN(yardline_100) as end_yardline,
                            -- Totals
                            SUM(yards_gained) as total_yards,
                            COUNT(*) as play_count,
                            -- Time consumed
                            MAX(game_seconds_remaining) - MIN(game_seconds_remaining) as elapsed_secs,
                            -- Redzone
                            MIN(yardline_100) as min_yardline,
                            -- Result indicators (from last play of drive)
                            -- We'll compute drive result in Python from the last play
                            MAX(CASE WHEN touchdown = 1 THEN 1 ELSE 0 END) as had_td,
                            MAX(CASE WHEN interception = 1 THEN 1 ELSE 0 END) as had_int,
                            MAX(CASE WHEN fumble = 1 THEN 1 ELSE 0 END) as had_fumble,
                            MAX(CASE WHEN field_goal_result = 'made' THEN 1 ELSE 0 END) as had_fg_made,
                            MAX(CASE WHEN field_goal_result = 'missed' THEN 1 ELSE 0 END) as had_fg_missed,
                            MAX(CASE WHEN play_type = 'punt' THEN 1 ELSE 0 END) as had_punt,
                            -- EPA
                            SUM(epa) as drive_epa
                        FROM plays
                        WHERE {sw}
                            AND drive IS NOT NULL
                            AND posteam IS NOT NULL
                            AND posteam != ''
                        GROUP BY game_id, drive
                        ORDER BY game_id, drive
                    """, [year])
                    col_names = [d[0] for d in cursor.description]
                    rows = [dict(zip(col_names, r)) for r in cursor.fetchall()]

            self.stdout.write(f"  Found {len(rows)} drives")

            if self.dry_run:
                total_created += len(rows)
                continue

            created = 0
            updated = 0
            skipped = 0

            with self.timed_operation(f"Writing drives for {year}"):
                batch = []
                for row in rows:
                    result = self._build_drive(row)
                    if result is None:
                        skipped += 1
                        continue
                    batch.append(result)

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
                self.stdout.write(self.style.WARNING(f"  Skipped {skipped} drives"))
            self.stdout.write(f"  Drives: {created} created, {updated} updated")
            total_created += created
            total_updated += updated

        self.stdout.write(
            self.style.SUCCESS(f"\nDone! {total_created} created, {total_updated} updated.")
        )

    def _build_drive(self, row):
        game_id = row["game_id"]
        game = self.game_cache.get(game_id)
        if not game:
            return None

        drive_num = self.safe_int(row.get("drive"))
        if drive_num is None:
            return None

        posteam_abbr = self.safe_str(row.get("posteam", ""))
        team = self.team_cache.get(posteam_abbr) or self.team_cache.get(
            TEAM_ABBR_MAP.get(posteam_abbr, "")
        )
        if not team:
            return None

        # Determine drive result
        result = "unknown"
        if self.safe_bool(row.get("had_td")):
            result = "touchdown"
        elif self.safe_bool(row.get("had_fg_made")):
            result = "field_goal"
        elif self.safe_bool(row.get("had_fg_missed")):
            result = "missed_fg"
        elif self.safe_bool(row.get("had_int")):
            result = "turnover"
        elif self.safe_bool(row.get("had_fumble")):
            result = "turnover"
        elif self.safe_bool(row.get("had_punt")):
            result = "punt"

        # Clock formatting
        start_secs = self.safe_int(row.get("start_clock_secs"), 0)
        end_secs = self.safe_int(row.get("end_clock_secs"), 0)
        start_clock = f"{start_secs // 60}:{start_secs % 60:02d}" if start_secs else ""
        end_clock = f"{end_secs // 60}:{end_secs % 60:02d}" if end_secs else ""

        elapsed = self.safe_int(row.get("elapsed_secs"), 0)
        elapsed_str = f"{elapsed // 60}:{elapsed % 60:02d}" if elapsed else ""

        play_count = self.safe_int(row.get("play_count"), 0)
        total_yards = self.safe_int(row.get("total_yards"), 0)

        return {
            "game": game,
            "drive_number": drive_num,
            "defaults": {
                "team": team,
                "start_quarter": self.safe_int(row.get("start_quarter")),
                "end_quarter": self.safe_int(row.get("end_quarter")),
                "start_clock": start_clock,
                "end_clock": end_clock,
                "start_yardline": self.safe_int(row.get("start_yardline")),
                "end_yardline": self.safe_int(row.get("end_yardline")),
                "play_count": play_count,
                "total_yards": total_yards,
                "result": result,
                "time_elapsed": elapsed_str,
                "inside_20": bool(
                    self.safe_int(row.get("min_yardline"), 100) <= 20
                ),
                "is_score": result in ("touchdown", "field_goal"),
                "drive_epa": self.safe_float(row.get("drive_epa")),
                "description": f"{play_count} plays, {total_yards} yards, {elapsed_str}",
            },
        }

    def _flush_batch(self, batch):
        created = 0
        updated = 0
        with transaction.atomic(using="nfl"):
            for item in batch:
                _, was_created = Drive.objects.using("nfl").update_or_create(
                    game=item["game"],
                    drive_number=item["drive_number"],
                    defaults=item["defaults"],
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
        return created, updated
