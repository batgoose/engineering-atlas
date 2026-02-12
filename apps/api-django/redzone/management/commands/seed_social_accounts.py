"""
Management command: seed_social_accounts

Seeds official social media accounts for all 32 NFL teams and
configures ESPN news source entries. Player social accounts are
enriched separately via ESPN athlete overview API.

Usage:
    python manage.py seed_social_accounts
"""

from django.core.management.base import BaseCommand
from redzone.models import Team, SocialAccount, NewsSource

# Official team handles — Twitter/X and Instagram
# Format: abbreviation → {platform: handle}
TEAM_SOCIALS = {
    "ARI": {"twitter": "AZCardinals", "instagram": "azcardinals"},
    "ATL": {"twitter": "AtlantaFalcons", "instagram": "atlantafalcons"},
    "BAL": {"twitter": "Ravens", "instagram": "ravens"},
    "BUF": {"twitter": "BuffaloBills", "instagram": "buffalobills"},
    "CAR": {"twitter": "Panthers", "instagram": "panthers"},
    "CHI": {"twitter": "ChicagoBears", "instagram": "chicagobears"},
    "CIN": {"twitter": "Bengals", "instagram": "bengals"},
    "CLE": {"twitter": "Browns", "instagram": "clevelandbrowns"},
    "DAL": {"twitter": "daboromeoOG", "instagram": "dallascowboys"},
    "DEN": {"twitter": "Broncos", "instagram": "broncos"},
    "DET": {"twitter": "Lions", "instagram": "detroitlionsnfl"},
    "GB": {"twitter": "packers", "instagram": "packers"},
    "HOU": {"twitter": "HoustonTexans", "instagram": "houstontexans"},
    "IND": {"twitter": "Colts", "instagram": "colts"},
    "JAX": {"twitter": "Jaguars", "instagram": "jaguars"},
    "KC": {"twitter": "Chiefs", "instagram": "chiefs"},
    "LA": {"twitter": "RamsNFL", "instagram": "rams"},
    "LAC": {"twitter": "chargers", "instagram": "chargers"},
    "LV": {"twitter": "Raiders", "instagram": "raiders"},
    "MIA": {"twitter": "MiamiDolphins", "instagram": "miamidolphins"},
    "MIN": {"twitter": "Vikings", "instagram": "vikings"},
    "NE": {"twitter": "Patriots", "instagram": "patriots"},
    "NO": {"twitter": "Saints", "instagram": "saints"},
    "NYG": {"twitter": "Giants", "instagram": "nygiants"},
    "NYJ": {"twitter": "nyjets", "instagram": "nyjets"},
    "PHI": {"twitter": "Eagles", "instagram": "philadelphiaeagles"},
    "PIT": {"twitter": "steelers", "instagram": "steelers"},
    "SEA": {"twitter": "Seahawks", "instagram": "seahawks"},
    "SF": {"twitter": "49ers", "instagram": "49ers"},
    "TB": {"twitter": "Buccaneers", "instagram": "buccaneers"},
    "TEN": {"twitter": "Titans", "instagram": "titans"},
    "WAS": {"twitter": "Commanders", "instagram": "commanders"},
}

PLATFORM_URLS = {
    "twitter": "https://x.com/{handle}",
    "instagram": "https://instagram.com/{handle}",
}


class Command(BaseCommand):
    help = "Seed team social media accounts and news sources"

    def handle(self, *args, **options):
        teams = {t.abbreviation: t for t in Team.objects.using("nfl").all()}

        if not teams:
            self.stderr.write(self.style.ERROR("No teams found. Run seed_teams first."))
            return

        # ── Social Accounts ──────────────────────────────
        self.stdout.write("Seeding team social accounts...")
        social_created = 0

        for abbr, handles in TEAM_SOCIALS.items():
            team = teams.get(abbr)
            if not team:
                self.stdout.write(
                    self.style.WARNING(f"  Team {abbr} not found, skipping")
                )
                continue

            for platform, handle in handles.items():
                url = PLATFORM_URLS.get(platform, "").format(handle=handle)
                _, created = SocialAccount.objects.using("nfl").update_or_create(
                    team=team,
                    platform=platform,
                    account_type="official",
                    defaults={
                        "handle": handle,
                        "url": url,
                        "display_name": team.display_name,
                        "is_verified": True,
                    },
                )
                if created:
                    social_created += 1

        self.stdout.write(
            self.style.SUCCESS(f"  {social_created} social accounts created")
        )

        # ── News Sources ─────────────────────────────────
        self.stdout.write("Seeding news source configs...")
        news_created = 0

        # League-wide ESPN news
        _, created = NewsSource.objects.using("nfl").update_or_create(
            name="ESPN NFL News",
            defaults={
                "source_type": "espn_league",
                "entity_type": "league",
                "url_template": (
                    "https://site.api.espn.com/apis/site/v2/"
                    "sports/football/nfl/news?limit=20"
                ),
                "cache_ttl_seconds": 300,
                "is_active": True,
                "priority": 1,
            },
        )
        if created:
            news_created += 1

        # Per-team ESPN news (template — resolved at request time)
        _, created = NewsSource.objects.using("nfl").update_or_create(
            name="ESPN Team News",
            defaults={
                "source_type": "espn_team",
                "entity_type": "team",
                "url_template": (
                    "https://site.api.espn.com/apis/site/v2/"
                    "sports/football/nfl/news?team={espn_id}&limit=20"
                ),
                "cache_ttl_seconds": 300,
                "is_active": True,
                "priority": 2,
            },
        )
        if created:
            news_created += 1

        # Per-player ESPN news (fantasy news endpoint)
        _, created = NewsSource.objects.using("nfl").update_or_create(
            name="ESPN Player News",
            defaults={
                "source_type": "espn_player",
                "entity_type": "player",
                "url_template": (
                    "https://site.api.espn.com/apis/fantasy/v2/"
                    "games/ffl/news/players?limit=10&playerId={espn_id}"
                ),
                "cache_ttl_seconds": 300,
                "is_active": True,
                "priority": 3,
            },
        )
        if created:
            news_created += 1

        # Reddit r/nfl
        _, created = NewsSource.objects.using("nfl").update_or_create(
            name="Reddit r/nfl",
            defaults={
                "source_type": "reddit",
                "entity_type": "league",
                "url_template": "https://www.reddit.com/r/nfl/hot.json?limit=25",
                "cache_ttl_seconds": 120,
                "is_active": True,
                "priority": 5,
            },
        )
        if created:
            news_created += 1

        self.stdout.write(self.style.SUCCESS(f"  {news_created} news sources created"))

        self.stdout.write(self.style.SUCCESS("\nDone!"))
