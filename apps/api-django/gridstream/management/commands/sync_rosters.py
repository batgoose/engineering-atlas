"""
Management command: sync_rosters

Compares current nflverse roster data against the Player table.
Detects team changes and creates PlayerTransaction records.
Updates current_team, roster_status, jersey_number.

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
from datetime import date, datetime

import requests
from django.core.management.base import BaseCommand
from django.utils import timezone

from gridstream.models import Player, PlayerTransaction, Team

logger = logging.getLogger(__name__)

ROSTER_URL_TEMPLATE = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "rosters/roster_{year}.csv"
)


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


class Command(BaseCommand):
    help = "Sync player rosters from nflverse — detect team changes and update statuses"

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
        season = options["season"] or date.today().year
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
        status_updates = 0
        new_players = 0
        now = timezone.now()

        for gsis_id, row in roster_map.items():
            new_team_abbr = _safe_str(row.get("team"))
            new_team = teams.get(new_team_abbr)
            new_status = _safe_str(row.get("status"), 5)
            new_jersey = _safe_str(row.get("jersey_number"), 3)
            full_name = _safe_str(row.get("full_name"), 80)
            position = _safe_str(row.get("position"), 5) or "DB"

            # Validate status
            valid_statuses = {c[0] for c in Player.STATUS_CHOICES}
            if new_status not in valid_statuses:
                new_status = ""

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
                        roster_status=new_status,
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
                    # Create transaction record
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

            # ── Check for status change ──────────────────────
            if new_status and new_status != player.roster_status:
                status_updates += 1
                if dry_run:
                    self.stdout.write(
                        f"  [STATUS] {player.display_name}: "
                        f"{player.roster_status or '?'} → {new_status}"
                    )

            # ── Update fields ────────────────────────────────
            if not dry_run:
                changed = False
                if new_status and new_status != player.roster_status:
                    player.roster_status = new_status
                    changed = True
                if new_jersey and new_jersey != player.jersey_number:
                    player.jersey_number = new_jersey
                    changed = True
                # Always update last_roster_check
                player.last_roster_check = now
                if changed or player.current_team != old_team:
                    player.save(using="nfl")

        # ── Check for players who disappeared from roster ────
        # (potentially released/retired)
        roster_gsis_ids = set(roster_map.keys())
        for gsis_id, player in players.items():
            if (
                player.current_team
                and player.roster_status in ("ACT", "PRA", "RES")
                and gsis_id not in roster_gsis_ids
            ):
                # Player was active but not on any roster now
                if dry_run:
                    self.stdout.write(
                        f"  [MISSING] {player.display_name} "
                        f"({player.current_team.abbreviation}) "
                        f"— not found on {season} roster"
                    )

        if dry_run:
            self.stdout.write(self.style.WARNING("\nDry run — no changes made"))

        self.stdout.write(
            self.style.SUCCESS(
                f"\nSync complete! "
                f"{team_changes} team changes, "
                f"{status_updates} status updates, "
                f"{new_players} new players"
            )
        )
