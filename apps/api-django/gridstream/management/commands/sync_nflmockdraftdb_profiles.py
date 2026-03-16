"""
Sync minimal prospect profiles from nflmockdraftdatabase.com for prospects that
don't have an NFLDraftBuzz scouting profile (i.e. DraftProspectRanking records
where prospect_id IS NULL).

Each player page embeds a JSON blob in a data-react-props attribute containing:
  position, projected_round, consensus rank, college logo URL,
  combine attendance flag, combine_results (measurables), youtube_url, etc.

We create a lightweight DraftProspect record (source='nflmockdraftdb') for each
unmatched prospect so they become clickable in the big board UI.

Usage:
    python manage.py sync_nflmockdraftdb_profiles --season 2026
    python manage.py sync_nflmockdraftdb_profiles --season 2026 --dry-run
    python manage.py sync_nflmockdraftdb_profiles --season 2026 --limit 50
"""

from __future__ import annotations

import json
import time
from datetime import date
from html import unescape

import requests
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from gridstream.models import DraftProspect, DraftProspectRanking

BASE_URL = "https://www.nflmockdraftdatabase.com"
PLAYER_URL = BASE_URL + "/players/{season}/{slug}"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
# Polite crawl delay between requests
CRAWL_DELAY_S = 0.5

# Map nflmockdraftdb projected_round → draft_projection display string
ROUND_MAP = {
    "1st": "1st Round",
    "2nd": "2nd Round",
    "3rd": "3rd Round",
    "4th": "4th Round",
    "5th": "5th Round",
    "6th": "6th Round",
    "7th": "7th Round",
    "UDFA": "Undrafted Free Agent",
}


def _default_season() -> int:
    return date.today().year


def _fetch_player_data(season: int, slug: str) -> dict | None:
    """
    Fetch and parse the data-react-props JSON from an nflmockdraftdb player page.
    Returns the 'player' sub-object, or None on failure.
    """
    url = PLAYER_URL.format(season=season, slug=slug)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as exc:
        return None

    html = resp.text
    marker = 'data-react-props="'
    idx = html.find(marker)
    if idx == -1:
        return None

    start = idx + len(marker)
    end = html.find('"', start)
    if end == -1:
        return None

    try:
        data = json.loads(unescape(html[start:end]))
    except (json.JSONDecodeError, ValueError):
        return None

    return data.get("player")


def _extract_combine_measurables(combine_results: dict | None) -> dict:
    """Pull height/weight/40/etc out of the combine_results sub-object."""
    if not combine_results:
        return {}
    out = {}
    if combine_results.get("height"):
        out["height"] = str(combine_results["height"])
    if combine_results.get("weight") is not None:
        try:
            out["weight"] = int(combine_results["weight"])
        except (TypeError, ValueError):
            pass
    if combine_results.get("forty") is not None:
        try:
            out["forty_yard"] = float(combine_results["forty"])
        except (TypeError, ValueError):
            pass
    if combine_results.get("hand_size"):
        out["hand_size"] = str(combine_results["hand_size"])
    if combine_results.get("arm_length"):
        out["arm_length"] = str(combine_results["arm_length"])
    return out


class Command(BaseCommand):
    help = "Sync minimal prospect profiles from nflmockdraftdatabase.com for unmatched players"

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=_default_season(),
            help="Draft year, e.g. 2026 (default: current year)",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Max number of prospects to process (default: all)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Fetch and parse but do not write to the database",
        )

    def handle(self, *args, **options):
        season: int = options["season"]
        limit: int = options["limit"]
        dry_run: bool = options["dry_run"]

        # All unique slugs that still lack a DraftProspect link
        qs = (
            DraftProspectRanking.objects.filter(season=season, prospect__isnull=True)
            .values("name_slug", "name", "position", "school")
            .distinct()
            .order_by("name")
        )
        if limit:
            qs = qs[:limit]

        slugs = list(qs)
        self.stdout.write(
            f"Found {len(slugs)} unmatched prospects for season={season}"
            + (" [DRY RUN]" if dry_run else "")
        )

        created = updated = failed = 0
        scraped_at = timezone.now()

        for i, row in enumerate(slugs, 1):
            slug = row["name_slug"]
            fallback_name = row["name"]
            fallback_pos = row["position"]
            fallback_school = row["school"]

            player = _fetch_player_data(season, slug)
            if not player:
                self.stderr.write(
                    f"  [{i}/{len(slugs)}] SKIP {slug}: fetch/parse failed"
                )
                failed += 1
                time.sleep(CRAWL_DELAY_S)
                continue

            pos = player.get("position") or fallback_pos
            proj_raw = player.get("projected_round") or ""
            draft_projection = ROUND_MAP.get(proj_raw, proj_raw) or ""
            nmdb_rank = player.get("rank")
            college_logo = (player.get("college") or {}).get("logo") or ""
            summary = player.get("scouting_report_blurb") or ""
            source_url = PLAYER_URL.format(season=season, slug=slug)

            measurables = _extract_combine_measurables(player.get("combine_results"))

            defaults = {
                "name": player.get("name") or fallback_name,
                "position": pos,
                "school": fallback_school,
                "source_url": source_url,
                "college_logo_url": college_logo,
                "draft_projection": draft_projection,
                "all_scouts_overall_rank": (
                    float(nmdb_rank) if nmdb_rank is not None else None
                ),
                "summary": summary,
                "scraped_at": scraped_at,
                **measurables,
            }

            if dry_run:
                self.stdout.write(
                    f"  [{i}/{len(slugs)}] {fallback_name}: proj={draft_projection} "
                    f"rank={nmdb_rank} logo={'yes' if college_logo else 'no'}"
                )
                created += 1
                time.sleep(CRAWL_DELAY_S)
                continue

            prospect, was_created = DraftProspect.objects.update_or_create(
                season=season,
                source="nflmockdraftdb",
                source_slug=slug,
                defaults=defaults,
            )

            # Link all DraftProspectRanking rows for this slug back to the new prospect
            DraftProspectRanking.objects.filter(
                season=season, name_slug=slug, prospect__isnull=True
            ).update(prospect=prospect)

            verb = "created" if was_created else "updated"
            self.stdout.write(
                f"  [{i}/{len(slugs)}] {was_created and 'NEW' or '   '} {fallback_name} "
                f"({pos}) → {draft_projection}"
            )

            if was_created:
                created += 1
            else:
                updated += 1

            time.sleep(CRAWL_DELAY_S)

        verb = "Would process" if dry_run else "Done"
        self.stdout.write(
            self.style.SUCCESS(
                f"\n{verb}: {created} created, {updated} updated, {failed} failed"
            )
        )
