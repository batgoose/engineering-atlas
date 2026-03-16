"""
Backfill is_division_game for all Game records based on NFL division membership.
"""

from django.core.management.base import BaseCommand
from gridstream.models import Game

DIVISIONS = {
    frozenset(["BUF", "MIA", "NE", "NYJ"]): "AFC East",
    frozenset(["BAL", "CIN", "CLE", "PIT"]): "AFC North",
    frozenset(["HOU", "IND", "JAX", "TEN"]): "AFC South",
    frozenset(["DEN", "KC", "LV", "LAC"]): "AFC West",
    frozenset(["DAL", "NYG", "PHI", "WAS"]): "NFC East",
    frozenset(["CHI", "DET", "GB", "MIN"]): "NFC North",
    frozenset(["ATL", "CAR", "NO", "TB"]): "NFC South",
    frozenset(["ARI", "LA", "SEA", "SF"]): "NFC West",
}

# Map each team → its division set (for O(1) lookup)
TEAM_DIVISION: dict[str, frozenset] = {}
for division_teams in DIVISIONS:
    for abbr in division_teams:
        TEAM_DIVISION[abbr] = division_teams


class Command(BaseCommand):
    help = "Backfill is_division_game on all Game records."

    def handle(self, *args, **options):
        games = Game.objects.select_related("home_team", "away_team").only(
            "id",
            "is_division_game",
            "home_team__abbreviation",
            "away_team__abbreviation",
        )

        to_update = []
        unknown_teams: set[str] = set()

        for game in games:
            home = game.home_team.abbreviation if game.home_team else None
            away = game.away_team.abbreviation if game.away_team else None

            if not home or not away:
                continue

            home_div = TEAM_DIVISION.get(home)
            away_div = TEAM_DIVISION.get(away)

            if home_div is None:
                unknown_teams.add(home)
            if away_div is None:
                unknown_teams.add(away)

            is_div = bool(home_div and home_div == away_div)

            if game.is_division_game != is_div:
                game.is_division_game = is_div
                to_update.append(game)

        if unknown_teams:
            self.stdout.write(
                self.style.WARNING(
                    f"Unknown team abbreviations (skipped): {sorted(unknown_teams)}"
                )
            )

        if to_update:
            BATCH = 2000
            for i in range(0, len(to_update), BATCH):
                Game.objects.bulk_update(to_update[i : i + BATCH], ["is_division_game"])
            self.stdout.write(self.style.SUCCESS(f"Updated {len(to_update)} games."))
        else:
            self.stdout.write("No changes needed.")
