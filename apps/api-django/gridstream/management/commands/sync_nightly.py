"""
Management command: sync_nightly

Orchestrates all regular data sync operations in dependency order.
Designed to run as a nightly cron job (e.g., 3 AM ET during season).

Phases:
  1. Player data  — rosters, bio enrichment, positions
  2. Game data    — schedule, plays, raw stats
  3. Stats        — materialized player/team game stats
  4. Analytics    — NGS, fantasy rankings, standings
  5. [weekly]     — OTC contract scraping (opt-in, slow)
  6. Health check — data freshness report

Auto-detects current NFL season (Sept–Feb). Override with --season.
Each phase is isolated: one failure logs and continues to next.

Usage:
    python manage.py sync_nightly
    python manage.py sync_nightly --season 2025
    python manage.py sync_nightly --include-otc          # add OTC scrape (slow)
    python manage.py sync_nightly --active-players-only  # OTC active-only when included
    python manage.py sync_nightly --dry-run              # print plan, no execution
    python manage.py sync_nightly --skip-phases stats,analytics

Cron example (3 AM ET daily):
    0 3 * * * docker exec atlas-api-django python manage.py sync_nightly >> /var/log/sync_nightly.log 2>&1
"""

import time
import traceback
from datetime import date
from io import StringIO

from django.core.management import call_command
from django.core.management.base import BaseCommand


def _current_nfl_season() -> int:
    """
    NFL season year = calendar year the season *started*.
    Sept–Dec: current year.  Jan–Aug: previous year.
    e.g. March 2026 → 2025 season (Super Bowl LX just finished).
    """
    today = date.today()
    return today.year if today.month >= 9 else today.year - 1


def _current_free_agency_year() -> int:
    return date.today().year


class Command(BaseCommand):
    help = "Nightly orchestration of all NFL data sync commands"

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=None,
            metavar="YEAR",
            help=f"NFL season year (default: auto-detect, currently {_current_nfl_season()})",
        )
        parser.add_argument(
            "--include-otc",
            action="store_true",
            help="Also run sync_otc_contracts (slow, recommended weekly not nightly)",
        )
        parser.add_argument(
            "--active-players-only",
            action="store_true",
            help="When --include-otc is set, only scrape active roster players (~1 hr vs ~4 hr)",
        )
        parser.add_argument(
            "--skip-phases",
            default="",
            metavar="PHASE,...",
            help="Comma-separated phases to skip: players,games,stats,analytics,health",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print the execution plan without running anything",
        )

    def handle(self, *args, **options):
        season = options["season"] or _current_nfl_season()
        include_otc = options["include_otc"]
        active_only = options["active_players_only"]
        dry_run = options["dry_run"]
        skip = {
            p.strip().lower() for p in options["skip_phases"].split(",") if p.strip()
        }

        start_time = time.monotonic()

        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"\n{'='*60}\n"
                f"  sync_nightly  —  season={season}  {'[DRY RUN]' if dry_run else ''}\n"
                f"{'='*60}\n"
            )
        )

        results: list[tuple[str, str, float]] = []  # (label, status, elapsed)

        def run(label: str, cmd: str, **kwargs):
            if dry_run:
                self.stdout.write(f"  [would run] {cmd}  {kwargs}")
                return
            t0 = time.monotonic()
            self.stdout.write(self.style.MIGRATE_HEADING(f"\n── {label} ──"))
            try:
                call_command(cmd, stdout=self.stdout, stderr=self.stderr, **kwargs)
                elapsed = time.monotonic() - t0
                results.append((label, "OK", elapsed))
                self.stdout.write(self.style.SUCCESS(f"  ✓ {label}  ({elapsed:.0f}s)"))
            except Exception as exc:
                elapsed = time.monotonic() - t0
                results.append((label, f"FAILED: {exc}", elapsed))
                self.stdout.write(self.style.ERROR(f"  ✗ {label}  ({elapsed:.0f}s)"))
                self.stdout.write(traceback.format_exc())

        # ── Phase 1: Player data ──────────────────────────────────────────────
        if "players" not in skip:
            self.stdout.write(self.style.HTTP_INFO("\n[ Phase 1: Player Data ]"))
            # Bio, IDs, headshots — skip combine/contracts (handled separately)
            run(
                "enrich_players (bio only)",
                "enrich_players",
                players_only=True,
                skip_combine=True,
                skip_contracts=True,
            )
            # Roster changes, transactions, jersey numbers, team assignments
            run("sync_rosters", "sync_rosters", season=season)
            # Official team transaction pages (cuts, signings, waivers)
            run(
                "sync_spotrac_transactions",
                "sync_spotrac_transactions",
                season=_current_free_agency_year(),
            )
            # Backfill depth chart position from raw nflverse data
            run("sync_player_positions", "sync_player_positions")
            # Current offseason tracker from Ourlads uses calendar year, not NFL season year
            run("sync_ourlads_free_agent_tracker", "sync_ourlads_free_agent_tracker")
            # Raw depth chart data for current season
            run(
                "import_nflverse_depth_charts",
                "import_nflverse_depth_charts",
                season=[season],
            )
            # Raw snap counts
            run(
                "import_nflverse_snap_counts",
                "import_nflverse_snap_counts",
                season=[season],
            )

        # ── Phase 2: Game data ────────────────────────────────────────────────
        if "games" not in skip:
            self.stdout.write(self.style.HTTP_INFO("\n[ Phase 2: Game Data ]"))
            # Authoritative schedule + results from nflverse
            run("import_games", "import_games", season=season)
            # Live scores + game detail from ESPN
            run("sync_espn_games", "sync_espn_games", season=season)

        # ── Phase 3: Stats materialization ───────────────────────────────────
        if "stats" not in skip:
            self.stdout.write(self.style.HTTP_INFO("\n[ Phase 3: Stats ]"))
            # Raw nflverse player stats for current season
            run("import_player_game_stats", "import_player_game_stats", season=season)
            # Materialize into modeled PlayerGameStats
            run(
                "materialize_player_game_stats",
                "materialize_player_game_stats",
                season=season,
            )
            # Raw nflverse team stats
            run("import_team_game_stats", "import_team_game_stats", season=season)
            # Materialize into modeled TeamGameStats
            run(
                "materialize_team_game_stats",
                "materialize_team_game_stats",
                season=season,
            )

        # ── Phase 4: Analytics ────────────────────────────────────────────────
        if "analytics" not in skip:
            self.stdout.write(self.style.HTTP_INFO("\n[ Phase 4: Analytics ]"))
            # NFL Next Gen Stats (passing, rushing, receiving)
            run(
                "sync_nextgen_stats (passing)",
                "sync_nextgen_stats",
                season=season,
                stat_type="passing",
            )
            run(
                "sync_nextgen_stats (rushing)",
                "sync_nextgen_stats",
                season=season,
                stat_type="rushing",
            )
            run(
                "sync_nextgen_stats (receiving)",
                "sync_nextgen_stats",
                season=season,
                stat_type="receiving",
            )
            # Current-week fantasy expert consensus rankings
            run("sync_ff_rankings", "sync_ff_rankings", current=True)
            # Team DVOA snapshots (regular + postseason)
            run("sync_dvoa_ratings", "sync_dvoa_ratings")
            # Standings
            run("import_nflverse_standings", "import_nflverse_standings", season=season)

        # ── Phase 5: OTC contracts (opt-in, slow) ────────────────────────────
        if include_otc:
            self.stdout.write(self.style.HTTP_INFO("\n[ Phase 5: OTC Contracts ]"))
            otc_kwargs: dict = {"delay": 1.5}
            if active_only:
                otc_kwargs["active_only"] = True
            run("sync_otc_contracts", "sync_otc_contracts", **otc_kwargs)

        # ── Phase 5b: News ────────────────────────────────────────────────────
        if "news" not in skip:
            self.stdout.write(self.style.HTTP_INFO("\n[ Phase 5b: News ]"))
            run("sync_news", "sync_news")

        # ── Phase 6: Health check ─────────────────────────────────────────────
        if "health" not in skip:
            self.stdout.write(self.style.HTTP_INFO("\n[ Phase 6: Health Check ]"))
            run("check_data_health", "check_data_health")

        # ── Summary ───────────────────────────────────────────────────────────
        total_elapsed = time.monotonic() - start_time
        failed = [(l, s) for l, s, _ in results if s != "OK"]

        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"\n{'='*60}\n"
                f"  sync_nightly complete  —  {total_elapsed:.0f}s total\n"
                f"{'='*60}"
            )
        )

        for label, status, elapsed in results:
            marker = (
                self.style.SUCCESS("✓") if status == "OK" else self.style.ERROR("✗")
            )
            self.stdout.write(f"  {marker}  {label:<45}  {elapsed:>6.0f}s")

        if failed:
            self.stdout.write(self.style.ERROR(f"\n  {len(failed)} command(s) failed:"))
            for label, status in failed:
                self.stdout.write(self.style.ERROR(f"    • {label}: {status}"))
            raise SystemExit(1)
        else:
            self.stdout.write(
                self.style.SUCCESS(f"\n  All {len(results)} commands succeeded.\n")
            )
