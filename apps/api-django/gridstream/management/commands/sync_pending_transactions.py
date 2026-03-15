"""
Management command: sync_pending_transactions

Processes all PlayerTransaction rows where is_handled=False.

For each unhandled transaction we need to bring downstream data up to date:
  1. OTC contracts — re-scrape overthecap.com for every affected player
  2. Ourlads FA tracker — re-sync the destination team's page (batched: one
     request per team after all players are processed, not one per transaction)

Once all downstream tasks for a player complete, their pending transactions
are marked is_handled=True / handled_at=now().

Usage:
    python manage.py sync_pending_transactions
    python manage.py sync_pending_transactions --dry-run
"""

from __future__ import annotations

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from gridstream.models import PlayerTransaction


class Command(BaseCommand):
    help = "Process all unhandled PlayerTransactions: OTC contracts, Ourlads team pages"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be processed without writing anything",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        pending_qs = PlayerTransaction.objects.using("nfl").filter(is_handled=False)
        count = pending_qs.count()

        if not count:
            self.stdout.write("No pending transactions — everything is up to date.\n")
            return

        # Collect affected players and destination teams
        rows = list(
            pending_qs.select_related("player", "to_team").values(
                "player_id", "player__display_name", "to_team__abbreviation"
            )
        )

        player_ids = sorted({r["player_id"] for r in rows})
        team_abbrs = sorted(
            {r["to_team__abbreviation"] for r in rows if r["to_team__abbreviation"]}
        )

        self.stdout.write(
            f"Pending transactions: {count}  →  "
            f"{len(player_ids)} players, {len(team_abbrs)} destination teams\n"
        )
        if team_abbrs:
            self.stdout.write(
                f"  Teams needing Ourlads refresh: {', '.join(team_abbrs)}\n"
            )

        if dry_run:
            self.stdout.write(self.style.WARNING("\nDry run — no changes made.\n"))
            return

        # ── 1. OTC contracts for all affected players ──────────────────────────
        self.stdout.write("\n── OTC contracts ──\n")
        player_ids_str = ",".join(str(pk) for pk in player_ids)
        call_command(
            "sync_otc_contracts",
            player_ids=player_ids_str,
            stdout=self.stdout,
            stderr=self.stderr,
        )

        # ── 2. Ourlads FA tracker — one pass per destination team ──────────────
        if team_abbrs:
            self.stdout.write("\n── Ourlads FA tracker ──\n")
            call_command(
                "sync_ourlads_free_agent_tracker",
                teams=team_abbrs,
                stdout=self.stdout,
                stderr=self.stderr,
            )

        # ── 3. Mark handled ────────────────────────────────────────────────────
        now = timezone.now()
        updated = pending_qs.update(is_handled=True, handled_at=now)
        self.stdout.write(f"\n✓ Marked {updated} transaction(s) handled.\n")
