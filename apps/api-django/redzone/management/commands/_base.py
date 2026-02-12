"""
Base class and utilities for Redzone import management commands.

The Rust parser loaded a 52-column subset of the nflverse PBP dataset.
Commands must check column availability dynamically before building SQL.

Available columns in the 'plays' table:
    game_id, play_id, old_game_id, drive, home_team, away_team, posteam,
    posteam_type, defteam, game_date, season_type, week, stadium, weather,
    surface, roof, qtr, quarter_seconds_remaining, half_seconds_remaining,
    game_seconds_remaining, down, ydstogo, yardline_100, side_of_field,
    shotgun, no_huddle, play_type, yards_gained, air_yards, yards_after_catch,
    epa, wpa, success, passer_player_id, passer_player_name,
    rusher_player_id, rusher_player_name, receiver_player_id,
    receiver_player_name, touchdown, interception, fumble, sack,
    complete_pass, pass_touchdown, rush_touchdown, field_goal_result,
    kick_distance, punt_blocked, penalty, penalty_type, penalty_yards

NOT available (full nflverse has these but Rust parser omitted):
    season, home_score, away_score, total_home_score, total_away_score,
    fixed_drive, fixed_drive_result, desc/description, spread_line,
    total_line, first_down_pass, first_down_rush, first_down_penalty,
    fumble_lost, return_touchdown, penalty_team, pass_location,
    run_location, run_gap, wp, vegas_wp, cpoe, cp, td_player_id, etc.
"""

import time
from contextlib import contextmanager

from django.core.management.base import BaseCommand
from django.db import connections


class ImportBaseCommand(BaseCommand):
    help = "Base import command"

    _column_cache = {}

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            nargs="*",
            help="Specific season(s) to import. Omit for all available.",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=5000,
            help="Bulk create/update batch size (default: 5000).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview without writing to the database.",
        )

    # ── Database access ───────────────────────────────────────────────

    def get_nfl_cursor(self):
        return connections["nfl"].cursor()

    def raw_table_exists(self, table_name):
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = %s)",
                [table_name],
            )
            return cursor.fetchone()[0]

    def get_raw_columns(self, table_name):
        if table_name not in self._column_cache:
            with self.get_nfl_cursor() as cursor:
                cursor.execute(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = %s ORDER BY ordinal_position",
                    [table_name],
                )
                self._column_cache[table_name] = [r[0] for r in cursor.fetchall()]
        return self._column_cache[table_name]

    def has_col(self, col, table="plays"):
        return col in self.get_raw_columns(table)

    # ── Season helpers (no 'season' column — derive from game_id) ─────

    def season_expr(self, table="plays"):
        """SQL expression for season year."""
        if self.has_col("season", table):
            return "season"
        return "SPLIT_PART(game_id, '_', 1)::int"

    def season_where(self, table="plays"):
        """WHERE fragment: e.g. "SPLIT_PART(game_id, '_', 1)::int = %s" """
        return f"{self.season_expr(table)} = %s"

    def get_available_seasons(self, table="plays"):
        expr = self.season_expr(table)
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                f"SELECT DISTINCT {expr} FROM {table} WHERE game_id IS NOT NULL ORDER BY 1"
            )
            return [r[0] for r in cursor.fetchall()]

    def resolve_seasons(self, requested, table="plays"):
        available = self.get_available_seasons(table)
        if requested:
            missing = set(requested) - set(available)
            if missing:
                self.stderr.write(
                    self.style.WARNING(f"Not in {table}: {sorted(missing)}")
                )
            return sorted(set(requested) & set(available))
        return available

    # ── Iteration ─────────────────────────────────────────────────────

    def iter_raw_table(self, table, where_clause="", params=None, columns="*"):
        with self.get_nfl_cursor() as cursor:
            sql = f"SELECT {columns} FROM {table}"
            if where_clause:
                sql += f" WHERE {where_clause}"
            cursor.execute(sql, params or [])
            col_names = [d[0] for d in cursor.description]
            while True:
                rows = cursor.fetchmany(self.batch_size)
                if not rows:
                    break
                for row in rows:
                    yield dict(zip(col_names, row))

    # ── Logging ───────────────────────────────────────────────────────

    @contextmanager
    def timed_operation(self, description):
        self.stdout.write(f"  → {description}...")
        start = time.time()
        yield
        elapsed = time.time() - start
        self.stdout.write(self.style.SUCCESS(f"    ✓ {description} ({elapsed:.1f}s)"))

    def log_season_header(self, season):
        self.stdout.write(self.style.MIGRATE_HEADING(f"\n{'='*60}"))
        self.stdout.write(self.style.MIGRATE_HEADING(f"  Season {season}"))
        self.stdout.write(self.style.MIGRATE_HEADING(f"{'='*60}"))

    # ── Safe type converters ──────────────────────────────────────────

    def safe_int(self, value, default=None):
        if value is None:
            return default
        try:
            return int(float(value))  # handles real/float columns
        except (ValueError, TypeError):
            return default

    def safe_float(self, value, default=None):
        if value is None:
            return default
        try:
            import math

            v = float(value)
            return default if math.isnan(v) else v
        except (ValueError, TypeError):
            return default

    def safe_str(self, value, default=""):
        if value is None:
            return default
        return str(value).strip()

    def safe_bool(self, value, default=False):
        """Convert nflverse 0/1 (stored as real) to Python bool."""
        if value is None:
            return default
        try:
            return bool(int(float(value)))
        except (ValueError, TypeError):
            return default
