"""
Backfill ESPN game data for all historical seasons.

Iterates over every season and week in the requested range, calling
sync_espn_games for each combination.  Non-existent weeks (e.g. week 18
pre-2021) are skipped automatically via the year-mismatch guard in
sync_espn_games.

examples:
    # sync everything (1999–2025), regular + postseason
    python manage.py sync_espn_backfill

    # specific range
    python manage.py sync_espn_backfill --start-season 2010 --end-season 2019

    # regular season only
    python manage.py sync_espn_backfill --season-types 2

    # with play-by-play (slow — adds ~12 extra API calls per game)
    python manage.py sync_espn_backfill --full

    # dry run
    python manage.py sync_espn_backfill --dry-run
"""

import time
import logging

from django.core.management import call_command
from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)

DEFAULT_START = 1999
DEFAULT_END = 2025

# Upper bound on weeks to try per season type.  Extras are silently skipped
# by sync_espn_games when ESPN returns a mismatched year.
MAX_WEEKS = {
    1: 5,  # preseason
    2: 18,  # regular (18 since 2021, 17 before — week 18 auto-skipped for old seasons)
    3: 5,  # postseason (4 most years; 5 with expanded Wild Card round)
}


class Command(BaseCommand):
    help = "Backfill ESPN game data for all historical seasons."

    def add_arguments(self, parser):
        parser.add_argument(
            "--start-season",
            type=int,
            default=DEFAULT_START,
            help=f"First season to sync (default {DEFAULT_START})",
        )
        parser.add_argument(
            "--end-season",
            type=int,
            default=DEFAULT_END,
            help=f"Last season to sync (default {DEFAULT_END})",
        )
        parser.add_argument(
            "--season-types",
            type=int,
            nargs="+",
            default=[2, 3],
            choices=[1, 2, 3],
            help="Season types: 1=pre 2=regular 3=post (default: 2 3)",
        )
        parser.add_argument(
            "--delay",
            type=float,
            default=0.3,
            help="Seconds to sleep between scoreboard requests (default 0.3)",
        )
        parser.add_argument(
            "--full",
            action="store_true",
            help="Also sync play-by-play summaries (much slower)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Pass --dry-run through to sync_espn_games (no DB writes)",
        )

    def handle(self, *args, **options):
        start = options["start_season"]
        end = options["end_season"]
        season_types = sorted(options["season_types"])
        delay = options["delay"]
        full = options["full"]
        dry_run = options["dry_run"]

        if start > end:
            self.stdout.write(
                self.style.ERROR("--start-season must be <= --end-season")
            )
            return

        type_labels = {1: "PRE", 2: "REG", 3: "POST"}
        total_seasons = end - start + 1
        self.stdout.write(
            f"Backfilling ESPN data: {start}–{end} ({total_seasons} seasons), "
            f"types [{' '.join(type_labels[t] for t in season_types)}]"
            + (" [DRY RUN]" if dry_run else "")
            + (" [+full]" if full else "")
        )

        for year in range(start, end + 1):
            for season_type in season_types:
                max_weeks = MAX_WEEKS.get(season_type, 18)
                self.stdout.write(
                    f"\n{'─'*60}\n"
                    f"{year} {type_labels.get(season_type, '?')}  "
                    f"(weeks 1–{max_weeks})\n"
                    f"{'─'*60}"
                )

                for week in range(1, max_weeks + 1):
                    call_command(
                        "sync_espn_games",
                        season=year,
                        week=week,
                        season_type=season_type,
                        full=full,
                        dry_run=dry_run,
                        stdout=self.stdout,
                        stderr=self.stderr,
                    )
                    time.sleep(delay)

        self.stdout.write(self.style.SUCCESS("\nBackfill complete."))
