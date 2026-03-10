"""
Management command: sync_rosters

Compares current nflverse roster data against the Player table.
Detects team changes and creates PlayerTransaction records.
Updates current_team and jersey_number.

Important:
The roster_{year}.csv file reflects most-recent game-week roster state, so
weekly availability codes (for example INA) are not used as canonical player
roster_status here.

Designed to run daily (cron/celery beat) or on-demand.

Data source: nflverse roster_{year}.csv from nflverse-data releases.

Usage:
    python manage.py sync_rosters
    python manage.py sync_rosters --season 2025
    python manage.py sync_rosters --dry-run
"""

import csv
import io
import logging
from datetime import date, datetime, timedelta

import requests
from django.core.management.base import BaseCommand
from django.utils import timezone

from gridstream.models import Player, PlayerTransaction, Team

logger = logging.getLogger(__name__)

ROSTER_URL_TEMPLATE = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "rosters/roster_{year}.csv"
)
VALID_STATUS_CODES = {code for code, _ in Player.STATUS_CHOICES}
FREE_AGENT_STATUS_CODES = {"UFA", "RFA"}
OUT_OF_LEAGUE_STATUS_CODES = {"RET", "CUT"}
WEEKLY_STATUS_MAP = {
    # Weekly game-day inactive still means in-league active.
    "INA": "ACT",
    # Common shorthand in weekly feeds.
    "IR": "RES",
    "FA": "UFA",
}


def _current_roster_sync_season() -> int:
    """NFL roster season year (March 2026 should still use 2025 roster data)."""
    today = date.today()
    return today.year if today.month >= 9 else today.year - 1


def _safe_str(val, max_len=None):
    if val is None or val == "NA":
        return ""
    val = str(val).strip()
    if max_len:
        val = val[:max_len]
    return val


def _safe_int(val):
    if val is None or val == "" or val == "NA":
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def _canonical_roster_status(code):
    normalized = _safe_str(code, 5).strip().upper()
    if not normalized:
        return ""
    mapped = WEEKLY_STATUS_MAP.get(normalized, normalized)
    if mapped in VALID_STATUS_CODES:
        return mapped
    return ""


class Command(BaseCommand):
    help = "Sync player teams/jerseys from nflverse roster snapshots"

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=None,
            help="Season year to sync (default: current year)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show changes without writing to DB",
        )

    def handle(self, *args, **options):
        season = options["season"] or _current_roster_sync_season()
        dry_run = options["dry_run"]

        teams = {t.abbreviation: t for t in Team.objects.using("nfl").all()}

        # Download roster
        url = ROSTER_URL_TEMPLATE.format(year=season)
        self.stdout.write(f"Downloading roster for {season}...")
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            self.stderr.write(self.style.ERROR(f"Failed to download: {e}"))
            return

        text = resp.content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        roster_rows = list(reader)
        self.stdout.write(f"Got {len(roster_rows):,} roster entries")

        # Build roster map: gsis_id → latest roster row
        # (roster file may have multiple entries per player if weekly)
        roster_map = {}
        for row in roster_rows:
            gsis_id = _safe_str(row.get("gsis_id"))
            if gsis_id:
                roster_map[gsis_id] = row  # last row wins (most recent)

        # Load existing players
        players = {
            p.gsis_id: p
            for p in Player.objects.using("nfl").select_related("current_team").all()
        }

        team_changes = 0
        weekly_status_mismatches = 0
        new_players = 0
        now = timezone.now()

        for gsis_id, row in roster_map.items():
            new_team_abbr = _safe_str(row.get("team"))
            new_team = teams.get(new_team_abbr)
            weekly_status = _safe_str(row.get("status"), 5).strip().upper()
            canonical_status = _canonical_roster_status(weekly_status)
            new_jersey = _safe_str(row.get("jersey_number"), 3)
            full_name = _safe_str(row.get("full_name"), 80)
            position = _safe_str(row.get("position"), 5) or "DB"

            player = players.get(gsis_id)

            if not player:
                # New player not in our DB
                if dry_run:
                    self.stdout.write(
                        f"  [NEW] {full_name} ({position}) → {new_team_abbr}"
                    )
                else:
                    # Parse name
                    parts = full_name.split(" ", 1)
                    first = parts[0] if parts else ""
                    last = parts[1] if len(parts) > 1 else ""

                    valid_positions = {c[0] for c in Player.POSITION_CHOICES}
                    if position not in valid_positions:
                        position = "DB"

                    player = Player.objects.using("nfl").create(
                        gsis_id=gsis_id,
                        first_name=first,
                        last_name=last,
                        display_name=full_name,
                        short_name=full_name,
                        position=position,
                        current_team=new_team,
                        roster_status=canonical_status or ("ACT" if new_team else ""),
                        is_active=(
                            canonical_status not in OUT_OF_LEAGUE_STATUS_CODES
                            if canonical_status
                            else bool(new_team)
                        ),
                        jersey_number=new_jersey,
                        last_roster_check=now,
                    )
                new_players += 1
                continue

            # ── Check for team change ────────────────────────
            old_team = player.current_team
            old_team_abbr = old_team.abbreviation if old_team else ""

            if new_team_abbr and new_team_abbr != old_team_abbr:
                team_changes += 1
                if dry_run:
                    self.stdout.write(
                        f"  [TEAM CHANGE] {player.display_name}: "
                        f"{old_team_abbr or 'FA'} → {new_team_abbr}"
                    )
                else:
                    # Skip creating a transaction if the player was FA/null
                    # and already has an active contract with the destination
                    # team signed in a prior season — this is a data-state
                    # reconciliation, not a real new signing event.
                    is_fa_to_team = old_team is None
                    already_contracted = (
                        is_fa_to_team
                        and player.contracts.using("nfl")
                        .filter(is_active=True, team=new_team, year_signed__lt=season)
                        .exists()
                    )
                    if not already_contracted:
                        PlayerTransaction.objects.using("nfl").create(
                            player=player,
                            transaction_type="signed",  # generic — refine later
                            date=date.today(),
                            from_team=old_team,
                            to_team=new_team,
                            description=(
                                f"Roster sync: {player.display_name} moved from "
                                f"{old_team_abbr or 'FA'} to {new_team_abbr}"
                            ),
                            season=season,
                        )
                    player.current_team = new_team

            # Weekly roster snapshots can disagree with canonical status.
            if weekly_status and weekly_status != (player.roster_status or ""):
                weekly_status_mismatches += 1

            # ── Update fields ────────────────────────────────
            if not dry_run:
                changed = False
                if new_jersey and new_jersey != player.jersey_number:
                    player.jersey_number = new_jersey
                    changed = True
                if canonical_status and canonical_status != (
                    player.roster_status or ""
                ):
                    player.roster_status = canonical_status
                    changed = True
                target_is_active = (
                    canonical_status not in OUT_OF_LEAGUE_STATUS_CODES
                    if canonical_status
                    else bool(new_team)
                )
                if player.is_active != target_is_active:
                    player.is_active = target_is_active
                    changed = True
                # Always update last_roster_check
                player.last_roster_check = now
                if changed or player.current_team != old_team:
                    player.save(using="nfl")

        # ── Check for players who disappeared from roster ────
        # (potentially released/retired)
        roster_gsis_ids = set(roster_map.keys())
        for gsis_id, player in players.items():
            if gsis_id in roster_gsis_ids:
                continue

            normalized_status = _safe_str(player.roster_status, 5).strip().upper()
            should_stay_active = normalized_status in FREE_AGENT_STATUS_CODES
            target_status = (
                normalized_status
                if normalized_status in OUT_OF_LEAGUE_STATUS_CODES
                else ("UFA" if should_stay_active else "CUT")
            )
            old_team = player.current_team
            needs_reconcile = (
                player.current_team_id is not None
                or player.is_active != should_stay_active
                or (player.roster_status or "") != target_status
            )
            if not needs_reconcile:
                continue

            if dry_run:
                team_abbr = (
                    player.current_team.abbreviation if player.current_team else "FA"
                )
                self.stdout.write(
                    f"  [MISSING] {player.display_name} ({team_abbr}) "
                    f"— not found on {season} roster"
                )
                continue

            changed = False
            if player.current_team_id is not None:
                player.current_team = None
                changed = True

            if (player.roster_status or "") != target_status:
                player.roster_status = target_status
                changed = True

            if player.is_active != should_stay_active:
                player.is_active = should_stay_active
                changed = True

            if changed:
                if old_team is not None:
                    transaction_type = (
                        "retired" if target_status == "RET" else "released"
                    )
                    recent_exists = (
                        PlayerTransaction.objects.using("nfl")
                        .filter(
                            player=player,
                            transaction_type=transaction_type,
                            from_team=old_team,
                            to_team__isnull=True,
                            date__gte=date.today() - timedelta(days=30),
                        )
                        .exists()
                    )
                    if not recent_exists:
                        PlayerTransaction.objects.using("nfl").create(
                            player=player,
                            transaction_type=transaction_type,
                            date=date.today(),
                            from_team=old_team,
                            to_team=None,
                            description=(
                                f"Roster sync: {player.display_name} missing from "
                                f"{season} roster snapshot for {old_team.abbreviation}"
                            ),
                            season=season,
                        )
                player.last_roster_check = now
                player.save(using="nfl")

        if dry_run:
            self.stdout.write(self.style.WARNING("\nDry run — no changes made"))

        self.stdout.write(
            self.style.SUCCESS(
                f"\nSync complete! "
                f"{team_changes} team changes, "
                f"{weekly_status_mismatches} weekly status mismatches observed, "
                f"{new_players} new players"
            )
        )
