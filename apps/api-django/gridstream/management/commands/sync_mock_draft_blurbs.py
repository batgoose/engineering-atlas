"""
Scrape per-pick analysis blurbs from original source articles and update
DraftMockDraft.picks[].blurb for each supported source.

Currently supported:
  - fox-sports-2026-bucky-brooks   (h2 + p pattern)
  - pro-football-focus-2026-max-chadwick  (h3 + p pattern)
  - for-the-win-2026-christian-d-andrea  (h2 + p pattern, skip "Needs:" lines)
  - the-athletic-2026-nick-baumgardner   (h2 + p pattern)

Usage:
    python manage.py sync_mock_draft_blurbs --season 2026
    python manage.py sync_mock_draft_blurbs --season 2026 --slug fox-sports-2026-bucky-brooks
    python manage.py sync_mock_draft_blurbs --season 2026 --dry-run
"""

from __future__ import annotations

import re
import time
import urllib.error
import urllib.request
from datetime import date

from django.core.management.base import BaseCommand, CommandError

from gridstream.models import DraftMockDraft

# ---------------------------------------------------------------------------
# Source config: slug → {url, parser}
# ---------------------------------------------------------------------------


# Clean HTML tags from a string
def _strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).strip()


def _parse_h2_p(html: str, *, skip_prefix: str | None = None) -> dict[int, str]:
    """
    Generic parser for pages where picks are <h2>N. Team: Player, Pos, School</h2><p>blurb</p>.
    Returns {pick_number: blurb}.
    """
    picks: dict[int, str] = {}
    segments = re.split(r"(<h2[^>]*>.*?</h2>)", html, flags=re.S)
    for i, seg in enumerate(segments):
        if not seg.startswith("<h2"):
            continue
        text = _strip_tags(seg).replace("\xa0", "").strip()
        m = re.match(r"(\d+)\.\s*(.+)", text)
        if not m:
            continue
        pick_num = int(m.group(1))
        if i + 1 >= len(segments):
            continue
        next_part = segments[i + 1]
        all_ps = re.findall(r"<p[^>]*>(.*?)</p>", next_part, re.S)
        blurbs = [_strip_tags(p).strip() for p in all_ps]
        if skip_prefix:
            blurbs = [b for b in blurbs if not b.startswith(skip_prefix)]
        analysis = [b for b in blurbs if len(b) > 30]
        if analysis:
            picks[pick_num] = " ".join(analysis[:2])[:600]
    return picks


def _parse_h3_p(html: str) -> dict[int, str]:
    """
    Parser for pages where picks are <h3>N. Team: Player, Pos, School</h3><p>blurb</p>.
    Returns {pick_number: blurb}.
    """
    picks: dict[int, str] = {}
    segments = re.split(r"(<h3[^>]*>.*?</h3>)", html, flags=re.S)
    for i, seg in enumerate(segments):
        if not seg.startswith("<h3"):
            continue
        text = _strip_tags(seg).strip()
        m = re.match(r"(\d+)\.\s*(.+)", text)
        if not m:
            continue
        pick_num = int(m.group(1))
        if i + 1 >= len(segments):
            continue
        next_part = segments[i + 1]
        all_ps = re.findall(r"<p[^>]*>(.*?)</p>", next_part, re.S)
        blurbs = [_strip_tags(p).strip() for p in all_ps]
        analysis = [b for b in blurbs if len(b) > 30]
        if analysis:
            picks[pick_num] = " ".join(analysis[:2])[:600]
    return picks


# Map slug → (article_url, parser_fn)
SOURCE_CONFIGS: dict[str, tuple[str, callable]] = {
    "fox-sports-2026-bucky-brooks": (
        "https://www.foxsports.com/stories/nfl/2026-nfl-mock-draft-ahead-free-agency-four-ohio-state-players-go-top-10",
        lambda html: _parse_h2_p(html),
    ),
    "pro-football-focus-2026-max-chadwick": (
        "https://www.pff.com/news/draft-2026-nfl-mock-draft-raiders-maxx-crosby-trade-jeremiyah-love-saints",
        lambda html: _parse_h3_p(html),
    ),
    "for-the-win-2026-christian-d-andrea": (
        "https://ftw.usatoday.com/story/sports/nfl/2026/03/06/2026-nfl-mock-draft-david-bailey-rueben-bain-arvell-reese/88985470007/",
        lambda html: _parse_h2_p(html, skip_prefix="Needs:"),
    ),
    "the-athletic-2026-nick-baumgardner": (
        "https://www.nytimes.com/athletic/7093472/2026/03/09/nfl-mock-draft-2026-raiders-free-agency/",
        lambda html: _parse_h2_p(html),
    ),
}

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
CRAWL_DELAY = 1.5  # seconds between requests


def _fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


class Command(BaseCommand):
    help = "Scrape per-pick blurbs from original mock draft articles"

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=date.today().year,
            help="Draft year (default: current year)",
        )
        parser.add_argument(
            "--slug",
            type=str,
            default="",
            help="Only process this mock slug (default: all supported)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Fetch and parse but do not write to the database",
        )

    def handle(self, *args, **options):
        season: int = options["season"]
        target_slug: str = options["slug"].strip()
        dry_run: bool = options["dry_run"]

        slugs = [target_slug] if target_slug else list(SOURCE_CONFIGS.keys())
        unsupported = [s for s in slugs if s not in SOURCE_CONFIGS]
        if unsupported:
            raise CommandError(
                f"Unsupported slug(s): {unsupported}\n"
                f"Supported: {list(SOURCE_CONFIGS.keys())}"
            )

        for i, slug in enumerate(slugs):
            url, parser = SOURCE_CONFIGS[slug]

            try:
                mock = DraftMockDraft.objects.get(season=season, slug=slug)
            except DraftMockDraft.DoesNotExist:
                self.stderr.write(
                    f"  No DraftMockDraft found for {slug} season={season} — skipping"
                )
                continue

            self.stdout.write(f"\nFetching blurbs for {mock.source_label} ...")
            self.stdout.write(f"  URL: {url}")

            if i > 0:
                time.sleep(CRAWL_DELAY)

            try:
                html = _fetch(url)
            except (urllib.error.URLError, Exception) as exc:
                self.stderr.write(f"  ERROR fetching {url}: {exc}")
                continue

            blurbs = parser(html)
            self.stdout.write(f"  Parsed {len(blurbs)} pick blurbs")

            if not blurbs:
                self.stderr.write("  WARNING: no blurbs parsed — skipping update")
                continue

            # Merge blurbs into existing picks
            current_picks: list = mock.picks or []
            updated = 0
            for pick in current_picks:
                pick_num = pick.get("pick") or pick.get("overall")
                if pick_num and pick_num in blurbs:
                    pick["blurb"] = blurbs[pick_num]
                    updated += 1

            self.stdout.write(
                f"  Enriched {updated}/{len(current_picks)} picks with blurbs"
            )

            if dry_run:
                self.stdout.write("  [dry-run] would save — skipping write")
                continue

            mock.picks = current_picks
            # Also update source_url to point to the original article (strip UTM params)
            clean_url = url.split("?")[0]
            mock.source_url = clean_url
            mock.save(update_fields=["picks", "source_url", "updated_at"])
            self.stdout.write(self.style.SUCCESS(f"  Saved {mock.source_label}"))

        self.stdout.write(self.style.SUCCESS("\nDone."))
