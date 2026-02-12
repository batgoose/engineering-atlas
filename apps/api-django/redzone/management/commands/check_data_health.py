"""
Check the health and freshness of all Redzone data layers.

Reports row counts, latest timestamps, and detects staleness across
the full data pipeline: raw PBP, reference data, imports, and ESPN sync.
Suggests specific commands to run when data is stale.

Usage:
    python manage.py check_data_health
    python manage.py check_data_health --json     # machine-readable output
    python manage.py check_data_health --verbose   # show per-table details
"""

import json as json_module
import logging
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import connections
from django.utils import timezone

from redzone.models import (
    Drive,
    Game,
    GameLeader,
    Player,
    PlayerCombine,
    PlayerContract,
    PlayerGameStats,
    Play,
    ScoringPlay,
    Season,
    SocialAccount,
    Team,
    TeamGameStats,
    TeamLogo,
    Venue,
)

logger = logging.getLogger(__name__)

# How old data can be before it's flagged
THRESHOLDS = {
    "rosters": timedelta(days=3),
    "social": timedelta(days=30),
    "enrich": timedelta(days=14),
    "espn_games": timedelta(days=1),
}


class Command(BaseCommand):
    help = "Report the health and freshness of all Redzone data layers."

    def add_arguments(self, parser):
        parser.add_argument(
            "--json",
            action="store_true",
            help="Output as JSON instead of formatted table.",
        )
        parser.add_argument(
            "--verbose",
            action="store_true",
            help="Show per-season breakdowns.",
        )

    def handle(self, *args, **options):
        output_json = options["json"]
        verbose = options["verbose"]

        checks = []
        suggestions = []

        # ── 1. Teams ───────────────────────────────────────────────
        active = Team.objects.using("nfl").filter(is_active=True).count()
        total = Team.objects.using("nfl").count()
        logos = TeamLogo.objects.using("nfl").count()
        status = "OK" if active == 32 else "WARN"
        if active < 32:
            suggestions.append(("seed_teams", f"Only {active}/32 active teams"))
        if logos == 0 and active > 0:
            suggestions.append(("seed_teams", "No team logos found"))
        checks.append(
            {
                "name": "Teams",
                "detail": f"{active} active, {total} total, {logos} logos",
                "status": status,
            }
        )

        # ── 2. Venues ─────────────────────────────────────────────
        venue_count = Venue.objects.using("nfl").count()
        status = "OK" if venue_count >= 30 else "WARN"
        if venue_count < 30:
            suggestions.append(("seed_venues", f"Only {venue_count} venues"))
        checks.append(
            {
                "name": "Venues",
                "detail": f"{venue_count} venues",
                "status": status,
            }
        )

        # ── 3. Players ────────────────────────────────────────────
        player_total = Player.objects.using("nfl").count()
        player_active = Player.objects.using("nfl").filter(is_active=True).count()
        has_gsis = Player.objects.using("nfl").exclude(gsis_id="").count()
        enrichment_pct = (has_gsis / player_total * 100) if player_total else 0

        # Check last enrichment via updated_at on players with gsis_id
        latest_enrich = (
            Player.objects.using("nfl")
            .exclude(gsis_id="")
            .order_by("-updated_at")
            .values_list("updated_at", flat=True)
            .first()
        )
        enrich_age = None
        if latest_enrich:
            enrich_age = timezone.now() - latest_enrich

        status = "OK"
        if player_total == 0:
            status = "MISSING"
            suggestions.append(("seed_players", "No players found"))
        elif enrichment_pct < 50:
            status = "WARN"
            suggestions.append(
                ("enrich_players", f"Only {enrichment_pct:.0f}% enriched with gsis_id")
            )
        elif enrich_age and enrich_age > THRESHOLDS["enrich"]:
            status = "STALE"
            suggestions.append(
                ("enrich_players", f"Last enriched {enrich_age.days} days ago")
            )

        enrich_str = ""
        if latest_enrich:
            enrich_str = f"  Enriched: {latest_enrich.strftime('%Y-%m-%d')}"

        checks.append(
            {
                "name": "Players",
                "detail": (
                    f"{player_total:,} total, {player_active:,} active, "
                    f"{enrichment_pct:.0f}% enriched{enrich_str}"
                ),
                "status": status,
            }
        )

        # ── 4. Rosters (freshness via last_roster_check) ──────────
        latest_roster = (
            Player.objects.using("nfl")
            .exclude(last_roster_check=None)
            .order_by("-last_roster_check")
            .values_list("last_roster_check", flat=True)
            .first()
        )
        if latest_roster:
            roster_age = timezone.now() - latest_roster
            status = "OK" if roster_age <= THRESHOLDS["rosters"] else "STALE"
            if status == "STALE":
                suggestions.append(
                    ("sync_rosters", f"Last synced {roster_age.days} days ago")
                )
            checks.append(
                {
                    "name": "Rosters",
                    "detail": f"Last synced: {latest_roster.strftime('%Y-%m-%d %H:%M')}",
                    "status": status,
                }
            )
        else:
            checks.append(
                {
                    "name": "Rosters",
                    "detail": "Never synced",
                    "status": "MISSING",
                }
            )
            suggestions.append(("sync_rosters", "Never synced"))

        # ── 5. Social Accounts ────────────────────────────────────
        social_count = SocialAccount.objects.using("nfl").count()
        team_social = SocialAccount.objects.using("nfl").exclude(team=None).count()
        player_social = SocialAccount.objects.using("nfl").exclude(player=None).count()

        if social_count == 0:
            status = "MISSING"
            suggestions.append(("seed_social_accounts", "No social accounts"))
        else:
            # No updated_at on SocialAccount — estimate from created_at pattern
            status = "OK"

        checks.append(
            {
                "name": "Social Accounts",
                "detail": f"{social_count:,} total ({team_social} team, {player_social} player)",
                "status": status,
            }
        )

        # ── 6. Raw PBP table (Rust parser) ────────────────────────
        raw_count = 0
        raw_latest_season = None
        raw_exists = False
        try:
            with connections["nfl"].cursor() as cursor:
                cursor.execute(
                    "SELECT EXISTS (SELECT FROM information_schema.tables "
                    "WHERE table_name = 'plays')"
                )
                raw_exists = cursor.fetchone()[0]

                if raw_exists:
                    cursor.execute("SELECT COUNT(*) FROM plays")
                    raw_count = cursor.fetchone()[0]

                    # Check for season column
                    cursor.execute(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'plays' AND column_name IN ('season', 'game_id')"
                    )
                    cols = [r[0] for r in cursor.fetchall()]

                    if "season" in cols:
                        cursor.execute("SELECT MAX(season) FROM plays")
                        raw_latest_season = cursor.fetchone()[0]
                    elif "game_id" in cols:
                        # game_id format: "2025_22_SEA_NE" — extract year
                        cursor.execute(
                            "SELECT MAX(SPLIT_PART(game_id, '_', 1)::int) FROM plays "
                            "WHERE game_id IS NOT NULL"
                        )
                        raw_latest_season = cursor.fetchone()[0]
        except Exception as e:
            logger.warning(f"Could not query raw plays table: {e}")

        if not raw_exists:
            status = "MISSING"
            suggestions.append(
                ("docker compose run --rm service-rust", "Raw plays table missing")
            )
        elif raw_count == 0:
            status = "EMPTY"
            suggestions.append(
                ("docker compose run --rm service-rust", "Raw plays table is empty")
            )
        else:
            status = "OK"

        season_str = f"  Latest: {raw_latest_season}" if raw_latest_season else ""
        checks.append(
            {
                "name": "Raw PBP (Rust)",
                "detail": f"{raw_count:,} rows{season_str}",
                "status": status,
            }
        )

        # ── 7. Django Games ───────────────────────────────────────
        game_count = Game.objects.using("nfl").count()
        latest_game_season = (
            Game.objects.using("nfl")
            .order_by("-season", "-week")
            .values_list("season", "week")
            .first()
        )
        espn_game_count = Game.objects.using("nfl").exclude(espn_event_id="").count()

        if game_count == 0:
            status = "MISSING"
            suggestions.append(("import_games", "No games imported"))
        else:
            status = "OK"

        latest_str = ""
        if latest_game_season:
            latest_str = f"  Latest: {latest_game_season[0]} Wk{latest_game_season[1]}"

        checks.append(
            {
                "name": "Games",
                "detail": f"{game_count:,} total ({espn_game_count:,} w/ ESPN ID){latest_str}",
                "status": status,
            }
        )

        # ── 8. Drives ────────────────────────────────────────────
        drive_count = Drive.objects.using("nfl").count()
        status = "OK" if drive_count > 0 else ("MISSING" if game_count > 0 else "OK")
        if drive_count == 0 and game_count > 0:
            suggestions.append(("import_drives", "Games exist but no drives imported"))
        checks.append(
            {
                "name": "Drives",
                "detail": f"{drive_count:,}",
                "status": status,
            }
        )

        # ── 9. Django Plays ──────────────────────────────────────
        play_count = Play.objects.using("nfl").count()
        status = "OK"
        if play_count == 0 and game_count > 0:
            status = "MISSING"
            suggestions.append(("import_plays", "Games exist but no plays imported"))
        elif raw_count > 0 and play_count > 0:
            drift = abs(raw_count - play_count)
            drift_pct = (drift / raw_count * 100) if raw_count else 0
            if drift_pct > 5:
                status = "DRIFT"
                suggestions.append(
                    (
                        "import_plays",
                        f"Django plays ({play_count:,}) differ from raw ({raw_count:,}) by {drift_pct:.1f}%",
                    )
                )

        checks.append(
            {
                "name": "Django Plays",
                "detail": f"{play_count:,}",
                "status": status,
            }
        )

        # ── 10. Player Game Stats ────────────────────────────────
        pgs_count = PlayerGameStats.objects.using("nfl").count()
        latest_pgs = (
            PlayerGameStats.objects.using("nfl")
            .order_by("-season_year", "-week")
            .values_list("season_year", "week")
            .first()
        )
        status = "OK"
        if pgs_count == 0 and game_count > 0:
            status = "MISSING"
            suggestions.append(("import_player_game_stats", "No player game stats"))
        latest_pgs_str = ""
        if latest_pgs:
            latest_pgs_str = f"  Latest: {latest_pgs[0]} Wk{latest_pgs[1]}"
        checks.append(
            {
                "name": "Player Game Stats",
                "detail": f"{pgs_count:,}{latest_pgs_str}",
                "status": status,
            }
        )

        # ── 11. Team Game Stats ──────────────────────────────────
        tgs_count = TeamGameStats.objects.using("nfl").count()
        latest_tgs = (
            TeamGameStats.objects.using("nfl")
            .order_by("-season_year", "-week")
            .values_list("season_year", "week")
            .first()
        )
        status = "OK"
        if tgs_count == 0 and game_count > 0:
            status = "MISSING"
            suggestions.append(("import_team_game_stats", "No team game stats"))
        latest_tgs_str = ""
        if latest_tgs:
            latest_tgs_str = f"  Latest: {latest_tgs[0]} Wk{latest_tgs[1]}"
        checks.append(
            {
                "name": "Team Game Stats",
                "detail": f"{tgs_count:,}{latest_tgs_str}",
                "status": status,
            }
        )

        # ── 12. ESPN Live Sync ───────────────────────────────────
        espn_synced = (
            Game.objects.using("nfl")
            .exclude(updated_at=None)
            .filter(status__in=["final", "final_ot"])
            .order_by("-updated_at")
            .values_list("updated_at", "season", "week")
            .first()
        )
        scheduled = Game.objects.using("nfl").filter(status="scheduled").count()
        in_progress = (
            Game.objects.using("nfl")
            .filter(status__in=["in_progress", "halftime", "end_period"])
            .count()
        )

        if espn_synced:
            sync_age = timezone.now() - espn_synced[0]
            status = "OK" if sync_age <= THRESHOLDS["espn_games"] else "STALE"
            if status == "STALE":
                suggestions.append(
                    ("sync_espn_games", f"Last ESPN sync {sync_age.days} days ago")
                )
            checks.append(
                {
                    "name": "ESPN Sync",
                    "detail": (
                        f"Last: {espn_synced[0].strftime('%Y-%m-%d %H:%M')}  "
                        f"({scheduled} scheduled, {in_progress} live)"
                    ),
                    "status": status,
                }
            )
        else:
            checks.append(
                {
                    "name": "ESPN Sync",
                    "detail": "Never synced",
                    "status": "INFO",
                }
            )

        # ── 13. Contracts & Combine (bonus data) ─────────────────
        contract_count = PlayerContract.objects.using("nfl").count()
        combine_count = PlayerCombine.objects.using("nfl").count()
        checks.append(
            {
                "name": "Contracts",
                "detail": f"{contract_count:,}" if contract_count else "Not imported",
                "status": "OK" if contract_count > 0 else "INFO",
            }
        )
        checks.append(
            {
                "name": "Combine",
                "detail": f"{combine_count:,}" if combine_count else "Not imported",
                "status": "OK" if combine_count > 0 else "INFO",
            }
        )

        # ── 14. Cross-check: latest seasons align ────────────────
        if latest_game_season and raw_latest_season:
            game_latest = latest_game_season[0]
            if isinstance(game_latest, Season):
                game_latest = game_latest.year
            if raw_latest_season > game_latest:
                suggestions.append(
                    (
                        "import_games --season " + str(raw_latest_season),
                        f"Raw PBP has {raw_latest_season} but Django games only go to {game_latest}",
                    )
                )

        # ── Output ────────────────────────────────────────────────
        if output_json:
            self.stdout.write(
                json_module.dumps(
                    {
                        "checks": checks,
                        "suggestions": [
                            {"command": cmd, "reason": reason}
                            for cmd, reason in suggestions
                        ],
                    },
                    indent=2,
                )
            )
            return

        # Formatted output
        self.stdout.write("")
        self.stdout.write(self.style.HTTP_INFO("  Data Health Report"))
        self.stdout.write("  " + "─" * 60)

        status_styles = {
            "OK": self.style.SUCCESS,
            "INFO": lambda x: x,
            "STALE": self.style.WARNING,
            "WARN": self.style.WARNING,
            "DRIFT": self.style.WARNING,
            "MISSING": self.style.ERROR,
            "EMPTY": self.style.ERROR,
        }

        for check in checks:
            style = status_styles.get(check["status"], lambda x: x)
            icon = {
                "OK": "✓",
                "INFO": "·",
                "STALE": "⚠",
                "WARN": "⚠",
                "DRIFT": "⚠",
                "MISSING": "✗",
                "EMPTY": "✗",
            }.get(check["status"], "?")

            name = check["name"].ljust(22)
            status_tag = style(f"{icon} {check['status']}")
            self.stdout.write(f"  {name}{check['detail']}")
            self.stdout.write(f"  {''.ljust(22)}{status_tag}")
            self.stdout.write("")

        if suggestions:
            self.stdout.write("  " + "─" * 60)
            self.stdout.write(self.style.WARNING("  Suggestions:"))
            self.stdout.write("")
            for cmd, reason in suggestions:
                prefix = "python manage.py " if not cmd.startswith("docker") else ""
                self.stdout.write(f"    {reason}")
                self.stdout.write(self.style.HTTP_INFO(f"    → {prefix}{cmd}"))
                self.stdout.write("")
        else:
            self.stdout.write("  " + "─" * 60)
            self.stdout.write(self.style.SUCCESS("  All data layers look healthy."))
            self.stdout.write("")

        if verbose:
            self._print_season_breakdown()

    def _print_season_breakdown(self):
        """Show per-season row counts for games, plays, and stats."""
        self.stdout.write("")
        self.stdout.write(self.style.HTTP_INFO("  Per-Season Breakdown"))
        self.stdout.write("  " + "─" * 60)
        self.stdout.write(
            f"  {'Season':<8} {'Games':>7} {'Drives':>8} {'Plays':>10} "
            f"{'PGS':>8} {'TGS':>6}"
        )
        self.stdout.write("  " + "─" * 60)

        seasons = (
            Season.objects.using("nfl").order_by("year").values_list("year", flat=True)
        )

        for year in seasons:
            games = Game.objects.using("nfl").filter(season_id=year).count()
            drives = Drive.objects.using("nfl").filter(game__season_id=year).count()
            plays = Play.objects.using("nfl").filter(game__season_id=year).count()
            pgs = PlayerGameStats.objects.using("nfl").filter(season_year=year).count()
            tgs = TeamGameStats.objects.using("nfl").filter(season_year=year).count()

            self.stdout.write(
                f"  {year:<8} {games:>7,} {drives:>8,} {plays:>10,} "
                f"{pgs:>8,} {tgs:>6,}"
            )

        self.stdout.write("")
