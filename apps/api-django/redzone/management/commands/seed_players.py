"""
Management command: seed_players

Extracts unique player IDs and names from the nflverse `plays` table
and creates Player records. This gives us the foundation for
PlayerGameStats foreign keys.

Players are created with minimal data (gsis_id, name, position inferred
from role). Full enrichment (headshot, bio, ESPN ID, draft info) will
come from a separate `enrich_players` command that calls ESPN's API.

Usage:
    python manage.py seed_players
    python manage.py seed_players --season 2025
"""

from django.core.management.base import BaseCommand
from django.db import connections
from redzone.models import Player, Team


class Command(BaseCommand):
    help = "Seed players from nflverse plays table player IDs"

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            help="Only extract players from games in this season (parsed from game_id)",
        )

    def handle(self, *args, **options):
        season_filter = options.get("season")

        self.stdout.write("Extracting unique players from plays table...")

        # Build the team abbreviation → Team FK lookup
        teams = {t.abbreviation: t for t in Team.objects.using("nfl").all()}
        if not teams:
            self.stderr.write(self.style.WARNING(
                "No teams found. Run seed_teams first."
            ))

        where_clause = ""
        if season_filter:
            # game_id format: "2024_01_KC_BAL" — season is first segment
            where_clause = f"WHERE game_id LIKE '{season_filter}_%'"

        with connections["nfl"].cursor() as cursor:
            # Extract passers
            cursor.execute(f"""
                SELECT DISTINCT passer_player_id, passer_player_name, posteam
                FROM plays
                {where_clause}
                {"AND" if where_clause else "WHERE"} passer_player_id IS NOT NULL
                    AND passer_player_id != ''
            """)
            passers = [
                (row[0], row[1], row[2], "QB")
                for row in cursor.fetchall()
            ]

            # Extract rushers
            cursor.execute(f"""
                SELECT DISTINCT rusher_player_id, rusher_player_name, posteam
                FROM plays
                {where_clause}
                {"AND" if where_clause else "WHERE"} rusher_player_id IS NOT NULL
                    AND rusher_player_id != ''
            """)
            rushers = [
                (row[0], row[1], row[2], "RB")
                for row in cursor.fetchall()
            ]

            # Extract receivers
            cursor.execute(f"""
                SELECT DISTINCT receiver_player_id, receiver_player_name, posteam
                FROM plays
                {where_clause}
                {"AND" if where_clause else "WHERE"} receiver_player_id IS NOT NULL
                    AND receiver_player_id != ''
            """)
            receivers = [
                (row[0], row[1], row[2], "WR")
                for row in cursor.fetchall()
            ]

        # Merge all players — deduplicate by gsis_id, prefer role-based position
        player_map = {}  # gsis_id → (name, team_abbr, position)

        # Process in priority order: passers override rushers override receivers
        # (a QB who rushes should stay QB, not become RB)
        for player_id, name, team_abbr, default_pos in receivers + rushers + passers:
            if player_id and player_id.strip():
                existing = player_map.get(player_id)
                if existing:
                    # Keep better position (passer > rusher > receiver)
                    # and most recent team
                    _, _, existing_pos = existing
                    pos_priority = {"QB": 3, "RB": 2, "WR": 1}
                    if pos_priority.get(default_pos, 0) > pos_priority.get(existing_pos, 0):
                        player_map[player_id] = (name, team_abbr, default_pos)
                    elif team_abbr and not existing[1]:
                        player_map[player_id] = (name, team_abbr, existing_pos)
                else:
                    player_map[player_id] = (name, team_abbr, default_pos)

        self.stdout.write(f"Found {len(player_map)} unique players")

        created = 0
        skipped = 0

        for gsis_id, (name, team_abbr, position) in player_map.items():
            # Check if already exists
            if Player.objects.using("nfl").filter(gsis_id=gsis_id).exists():
                skipped += 1
                continue

            # Parse name
            name = name or ""
            parts = name.split(".", 1) if "." in name else name.split(" ", 1)
            first_name = parts[0].strip() if parts else ""
            last_name = parts[1].strip() if len(parts) > 1 else ""

            # Resolve team FK
            current_team = teams.get(team_abbr)

            Player.objects.using("nfl").create(
                gsis_id=gsis_id,
                first_name=first_name,
                last_name=last_name,
                display_name=name,
                short_name=name,
                position=position,
                current_team=current_team,
                # Enrichment fields will be populated by enrich_players
                # and sync_rosters commands later
            )
            created += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone! Created {created} players, skipped {skipped} existing."
            )
        )
