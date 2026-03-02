"""
Materialize career stat aggregates onto gridstream_player.mat_* columns.

Runs a single bulk UPDATE … FROM (SELECT … GROUP BY player_id) so the DB does
all the heavy lifting in one pass.  Subsequent runs are fully idempotent.

Usage:
    python manage.py materialize_player_career_stats
    python manage.py materialize_player_career_stats --dry-run
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import connections

SQL = """
UPDATE gridstream_player p
SET
    mat_games_played            = s.games_played,
    mat_seasons_count           = s.seasons_count,
    mat_first_season            = s.first_season,
    mat_last_season             = s.last_season,
    mat_completions             = s.completions,
    mat_pass_attempts           = s.pass_attempts,
    mat_passing_yards           = s.passing_yards,
    mat_passing_tds             = s.passing_tds,
    mat_interceptions_thrown    = s.interceptions_thrown,
    mat_sacks_taken             = s.sacks_taken,
    mat_carries                 = s.carries,
    mat_rushing_yards           = s.rushing_yards,
    mat_rushing_tds             = s.rushing_tds,
    mat_rushing_long            = s.rushing_long,
    mat_receptions              = s.receptions,
    mat_targets                 = s.targets,
    mat_receiving_yards         = s.receiving_yards,
    mat_receiving_tds           = s.receiving_tds,
    mat_receiving_long          = s.receiving_long,
    mat_pass_first_downs        = s.pass_first_downs,
    mat_rush_first_downs        = s.rush_first_downs,
    mat_rec_first_downs         = s.rec_first_downs,
    mat_fumbles_rushing         = s.fumbles_rushing,
    mat_fumbles_receiving       = s.fumbles_receiving,
    mat_fumbles_sacks           = s.fumbles_sacks,
    mat_fumbles_lost_rushing    = s.fumbles_lost_rushing,
    mat_fumbles_lost_receiving  = s.fumbles_lost_receiving,
    mat_fumbles_lost_sacks      = s.fumbles_lost_sacks,
    mat_tackles_total           = s.tackles_total,
    mat_sacks_made              = s.sacks_made,
    mat_interceptions_caught    = s.interceptions_caught,
    mat_passes_defended         = s.passes_defended,
    mat_forced_fumbles          = s.forced_fumbles,
    mat_fg_made                 = s.fg_made,
    mat_fg_attempts             = s.fg_attempts,
    mat_punt_attempts           = s.punt_attempts
FROM (
    SELECT
        player_id,
        COUNT(DISTINCT id)                          AS games_played,
        COUNT(DISTINCT season_year)                 AS seasons_count,
        MIN(season_year)                            AS first_season,
        MAX(season_year)                            AS last_season,
        COALESCE(SUM(completions),          0)      AS completions,
        COALESCE(SUM(pass_attempts),        0)      AS pass_attempts,
        COALESCE(SUM(passing_yards),        0)      AS passing_yards,
        COALESCE(SUM(passing_tds),          0)      AS passing_tds,
        COALESCE(SUM(interceptions_thrown), 0)      AS interceptions_thrown,
        COALESCE(SUM(sacks_taken),          0)      AS sacks_taken,
        COALESCE(SUM(carries),              0)      AS carries,
        COALESCE(SUM(rushing_yards),        0)      AS rushing_yards,
        COALESCE(SUM(rushing_tds),          0)      AS rushing_tds,
        COALESCE(MAX(rushing_long),         0)      AS rushing_long,
        COALESCE(SUM(receptions),           0)      AS receptions,
        COALESCE(SUM(targets),              0)      AS targets,
        COALESCE(SUM(receiving_yards),      0)      AS receiving_yards,
        COALESCE(SUM(receiving_tds),        0)      AS receiving_tds,
        COALESCE(MAX(receiving_long),       0)      AS receiving_long,
        COALESCE(SUM(passing_first_downs),  0)      AS pass_first_downs,
        COALESCE(SUM(rushing_first_downs),  0)      AS rush_first_downs,
        COALESCE(SUM(receiving_first_downs),0)      AS rec_first_downs,
        COALESCE(SUM(rushing_fumbles),      0)      AS fumbles_rushing,
        COALESCE(SUM(receiving_fumbles),    0)      AS fumbles_receiving,
        COALESCE(SUM(sack_fumbles),         0)      AS fumbles_sacks,
        COALESCE(SUM(rushing_fumbles_lost), 0)      AS fumbles_lost_rushing,
        COALESCE(SUM(receiving_fumbles_lost),0)     AS fumbles_lost_receiving,
        COALESCE(SUM(sack_fumbles_lost),    0)      AS fumbles_lost_sacks,
        COALESCE(SUM(tackles_total),        0)      AS tackles_total,
        COALESCE(SUM(sacks_made),           0.0)    AS sacks_made,
        COALESCE(SUM(interceptions_caught), 0)      AS interceptions_caught,
        COALESCE(SUM(passes_defended),      0)      AS passes_defended,
        COALESCE(SUM(forced_fumbles),       0)      AS forced_fumbles,
        COALESCE(SUM(fg_made),              0)      AS fg_made,
        COALESCE(SUM(fg_attempts),          0)      AS fg_attempts,
        COALESCE(SUM(punt_attempts),        0)      AS punt_attempts
    FROM gridstream_playergamestats
    GROUP BY player_id
) s
WHERE p.id = s.player_id
"""

# Zero out players who have NO game stats at all (new entries, etc.)
SQL_ZERO_MISSING = """
UPDATE gridstream_player
SET
    mat_games_played            = 0,
    mat_seasons_count           = 0,
    mat_first_season            = NULL,
    mat_last_season             = NULL,
    mat_completions             = 0,
    mat_pass_attempts           = 0,
    mat_passing_yards           = 0,
    mat_passing_tds             = 0,
    mat_interceptions_thrown    = 0,
    mat_sacks_taken             = 0,
    mat_carries                 = 0,
    mat_rushing_yards           = 0,
    mat_rushing_tds             = 0,
    mat_rushing_long            = 0,
    mat_receptions              = 0,
    mat_targets                 = 0,
    mat_receiving_yards         = 0,
    mat_receiving_tds           = 0,
    mat_receiving_long          = 0,
    mat_pass_first_downs        = 0,
    mat_rush_first_downs        = 0,
    mat_rec_first_downs         = 0,
    mat_fumbles_rushing         = 0,
    mat_fumbles_receiving       = 0,
    mat_fumbles_sacks           = 0,
    mat_fumbles_lost_rushing    = 0,
    mat_fumbles_lost_receiving  = 0,
    mat_fumbles_lost_sacks      = 0,
    mat_tackles_total           = 0,
    mat_sacks_made              = 0.0,
    mat_interceptions_caught    = 0,
    mat_passes_defended         = 0,
    mat_forced_fumbles          = 0,
    mat_fg_made                 = 0,
    mat_fg_attempts             = 0,
    mat_punt_attempts           = 0
WHERE id NOT IN (
    SELECT DISTINCT player_id FROM gridstream_playergamestats
)
"""


class Command(BaseCommand):
    help = "Materialize career stat aggregates onto gridstream_player.mat_* columns."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Print what would happen without writing to the DB.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        if dry_run:
            self.stdout.write(
                self.style.WARNING("DRY RUN — no changes will be written.")
            )
            self.stdout.write(
                "Would execute career stats aggregation UPDATE on gridstream_player."
            )
            return

        self.stdout.write("Materializing career stats … ", ending="")

        with connections["nfl"].cursor() as cursor:
            cursor.execute(SQL)
            updated = cursor.rowcount
            cursor.execute(SQL_ZERO_MISSING)
            zeroed = cursor.rowcount

        self.stdout.write(
            self.style.SUCCESS(
                f"done. {updated} players updated with career stats, "
                f"{zeroed} players zeroed (no game stats)."
            )
        )
