"""
Management command: sync_espn_awards

Fetches major annual NFL awards from the ESPN core API and stores them in
PlayerAward. Matches winners to Player records via Player.espn_id.

Awards covered (9 per season, except early seasons which may have 8):
  - Super Bowl MVP
  - NFL MVP
  - NFL Offensive Player of the Year
  - NFL Defensive Player of the Year
  - NFL Offensive Rookie of the Year
  - NFL Defensive Rookie of the Year
  - NFL Coach of the Year  (skipped — no athlete)
  - NFL Comeback Player of the Year
  - Walter Payton NFL Man of the Year

Source:
  sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/awards

Usage:
    python manage.py sync_espn_awards
    python manage.py sync_espn_awards --season 2024
    python manage.py sync_espn_awards --start-season 2000
    python manage.py sync_espn_awards --dry-run
"""
import logging
import time
import urllib.request
import json

from django.core.management.base import BaseCommand, CommandError

from gridstream.models import Player, PlayerAward

logger = logging.getLogger(__name__)

ESPN_AWARDS_URL = (
    "http://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
    "/seasons/{season}/awards?lang=en&region=us&limit=100"
)
REQUEST_DELAY = 0.3   # seconds between API calls


def _fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.loads(r.read())


def _espn_id_from_ref(ref: str) -> str | None:
    """Extract the numeric athlete ID from an ESPN $ref URL."""
    if not ref:
        return None
    # URLs look like: .../athletes/3918298?lang=en...
    path = ref.split("?")[0]
    parts = [p for p in path.rstrip("/").split("/") if p]
    try:
        idx = parts.index("athletes")
        return parts[idx + 1]
    except (ValueError, IndexError):
        return None


class Command(BaseCommand):
    help = "Sync major NFL season awards from ESPN into PlayerAward."

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=None,
            help="Only sync a single season (e.g. 2024).",
        )
        parser.add_argument(
            "--start-season",
            type=int,
            default=1990,
            help="Earliest season to sync (default: 1990).",
        )
        parser.add_argument(
            "--end-season",
            type=int,
            default=None,
            help="Latest season to sync (default: current year).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Fetch data but do not write to the database.",
        )

    def handle(self, *args, **options):
        import datetime
        dry_run = options["dry_run"]
        single = options["season"]

        if single:
            seasons = [single]
        else:
            start = options["start_season"]
            end = options["end_season"] or datetime.date.today().year
            seasons = list(range(start, end + 1))

        # Build espn_id → player PK lookup for fast matching
        self.stdout.write(f"Building player lookup...")
        espn_map: dict[str, int] = {}
        for pk, espn_id in Player.objects.using("nfl").values_list("pk", "espn_id"):
            if espn_id:
                espn_map[str(espn_id)] = pk

        self.stdout.write(f"Player lookup: {len(espn_map)} players with ESPN IDs")

        created = updated = skipped = unmatched = 0

        for season in seasons:
            url = ESPN_AWARDS_URL.format(season=season)
            try:
                data = _fetch_json(url)
            except Exception as exc:
                self.stdout.write(
                    self.style.WARNING(f"  {season}: failed to fetch awards list — {exc}")
                )
                continue

            award_refs = [item.get("$ref", "") for item in data.get("items", [])]
            season_created = season_updated = 0

            for ref in award_refs:
                time.sleep(REQUEST_DELAY)
                try:
                    award = _fetch_json(ref)
                except Exception as exc:
                    logger.warning("Failed to fetch award %s: %s", ref, exc)
                    continue

                award_id = str(award.get("id", ""))
                name = award.get("name", "")
                description = award.get("description", "")
                winners = award.get("winners", [])

                for winner in winners:
                    ath_ref = winner.get("athlete", {}).get("$ref", "")
                    espn_athlete_id = _espn_id_from_ref(ath_ref)

                    if not espn_athlete_id:
                        # Coach of the Year and similar — no athlete ref
                        skipped += 1
                        continue

                    player_pk = espn_map.get(espn_athlete_id)
                    if not player_pk:
                        logger.debug(
                            "No player match for ESPN ID %s (%s %s)",
                            espn_athlete_id, season, name,
                        )
                        unmatched += 1
                        continue

                    if dry_run:
                        self.stdout.write(
                            f"  [DRY RUN] {season} {name}: player_pk={player_pk}"
                        )
                        season_created += 1
                        continue

                    _, was_created = PlayerAward.objects.using("nfl").update_or_create(
                        player_id=player_pk,
                        season=season,
                        espn_award_id=award_id,
                        defaults={
                            "name": name,
                            "description": description,
                        },
                    )
                    if was_created:
                        season_created += 1
                    else:
                        season_updated += 1

            created += season_created
            updated += season_updated
            if season_created or season_updated:
                self.stdout.write(
                    f"  {season}: +{season_created} created, ~{season_updated} updated"
                )

            time.sleep(REQUEST_DELAY)

        self.stdout.write(self.style.SUCCESS(
            f"\nDone. Created={created}, Updated={updated}, "
            f"Skipped(no athlete)={skipped}, Unmatched={unmatched}"
        ))
