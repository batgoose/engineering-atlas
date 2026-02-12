"""
Management command: seed_teams

Fetches all NFL teams from ESPN's public API and populates
the Team and TeamLogo models. Safe to run multiple times
(uses update_or_create).

Usage:
    python manage.py seed_teams
    python manage.py seed_teams --dry-run
"""

import requests
from django.core.management.base import BaseCommand
from redzone.models import Team, TeamLogo

ESPN_TEAMS_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams"
    "?limit=40"  # 32 active + any historical entries
)

# Map ESPN team abbreviations to nflverse abbreviations where they differ
ESPN_TO_NFLVERSE_ABBR = {
    "WSH": "WAS",
    "JAX": "JAX",  # nflverse uses JAX
    "LAR": "LA",  # nflverse uses LA for Rams
}

# ESPN conference/division extraction from groups
CONFERENCE_MAP = {
    "80": ("AFC", "AFC East"),
    "81": ("AFC", "AFC North"),
    "82": ("AFC", "AFC South"),
    "83": ("AFC", "AFC West"),
    "84": ("NFC", "NFC East"),
    "85": ("NFC", "NFC North"),
    "86": ("NFC", "NFC South"),
    "87": ("NFC", "NFC West"),
}


class Command(BaseCommand):
    help = "Seed NFL teams and logos from ESPN API"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be created without writing to DB",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        self.stdout.write("Fetching teams from ESPN API...")
        response = requests.get(ESPN_TEAMS_URL, timeout=15)
        response.raise_for_status()
        data = response.json()

        teams_data = (
            data.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", [])
        )

        if not teams_data:
            self.stderr.write(self.style.ERROR("No teams found in ESPN response"))
            return

        self.stdout.write(f"Found {len(teams_data)} teams")

        created_count = 0
        updated_count = 0
        logo_count = 0

        for entry in teams_data:
            team_data = entry.get("team", {})
            espn_id = team_data.get("id", "")
            abbr = team_data.get("abbreviation", "")

            if not espn_id or not abbr:
                continue

            # Resolve nflverse abbreviation
            nflverse_abbr = ESPN_TO_NFLVERSE_ABBR.get(abbr, abbr)

            # Extract conference/division from groups if available
            conference = ""
            division = ""
            groups = team_data.get("groups", {})
            if groups:
                # groups can be a dict with 'id' or a nested structure
                group_id = ""
                if isinstance(groups, dict):
                    group_id = str(groups.get("id", ""))
                    if not group_id and "parent" in groups:
                        group_id = str(groups["parent"].get("id", ""))
                if group_id in CONFERENCE_MAP:
                    conference, division = CONFERENCE_MAP[group_id]

            slug = team_data.get("slug", abbr.lower())
            location = team_data.get("location", "")
            name = team_data.get("name", "")
            display_name = team_data.get("displayName", f"{location} {name}")
            short_display_name = team_data.get("shortDisplayName", name)
            nickname = team_data.get("nickname", name)
            color = team_data.get("color", "000000")
            alt_color = team_data.get("alternateColor", "")
            is_active = team_data.get("isActive", True)

            if dry_run:
                self.stdout.write(
                    f"  [DRY RUN] {abbr} ({nflverse_abbr}) - "
                    f"{display_name} | {conference} {division}"
                )
                continue

            team, created = Team.objects.using("nfl").update_or_create(
                espn_id=espn_id,
                defaults={
                    "abbreviation": nflverse_abbr,
                    "slug": slug,
                    "location": location,
                    "name": name,
                    "display_name": display_name,
                    "short_display_name": short_display_name,
                    "nickname": nickname,
                    "color_primary": color,
                    "color_secondary": alt_color,
                    "conference": conference,
                    "division": division,
                    "is_active": is_active,
                },
            )

            if created:
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f"  Created: {team}"))
            else:
                updated_count += 1
                self.stdout.write(f"  Updated: {team}")

            # ── Logos ────────────────────────────────────
            logos = team_data.get("logos", [])
            for logo_data in logos:
                href = logo_data.get("href", "")
                if not href:
                    continue

                # Determine logo type from rel array or href pattern
                rels = logo_data.get("rel", [])
                if "dark" in rels and "scoreboard" in rels:
                    logo_type = "scoreboard-dark"
                elif "scoreboard" in rels:
                    logo_type = "scoreboard"
                elif "dark" in rels:
                    logo_type = "dark"
                else:
                    logo_type = "default"

                width = logo_data.get("width", None)
                height = logo_data.get("height", None)

                _, logo_created = TeamLogo.objects.using("nfl").update_or_create(
                    team=team,
                    logo_type=logo_type,
                    defaults={
                        "url": href,
                        "width": width,
                        "height": height,
                    },
                )
                if logo_created:
                    logo_count += 1

        if dry_run:
            self.stdout.write(
                self.style.WARNING("\nDry run complete — no changes made")
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"\nDone! Created {created_count}, updated {updated_count} teams. "
                    f"{logo_count} new logos."
                )
            )
