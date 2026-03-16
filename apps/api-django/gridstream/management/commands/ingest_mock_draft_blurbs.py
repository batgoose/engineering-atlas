"""
Parse per-pick blurbs from locally saved HTML or plain-text files and update DraftMockDraft.picks.

Supports:
  - .htm / .html files saved from the browser
  - .txt files with pasted article text (N. Team / Player | Pos | School / blurb)

Usage:
    python manage.py ingest_mock_draft_blurbs --season 2026 --dir /app/docs/mocks
    python manage.py ingest_mock_draft_blurbs --season 2026 --file /path/file.htm --slug some-slug
    python manage.py ingest_mock_draft_blurbs --season 2026 --dir /app/docs/mocks --dry-run
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from gridstream.models import DraftMockDraft

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).strip()


def _parse_h2_p(html: str, *, skip_prefix: str | None = None) -> dict[int, str]:
    """h2 = pick header, first non-trivial <p> after = blurb."""
    picks: dict[int, str] = {}
    seen: set[int] = set()
    segments = re.split(r"(<h2[^>]*>.*?</h2>)", html, flags=re.S)
    for i, seg in enumerate(segments):
        if not seg.startswith("<h2"):
            continue
        text = _strip_tags(seg).replace("\xa0", "").replace("\n", " ").strip()
        m = re.match(r"(\d+)[.)]\s*(.+)", text)
        if not m:
            continue
        pick_num = int(m.group(1))
        if pick_num > 32 or pick_num in seen:
            continue
        seen.add(pick_num)
        next_part = segments[i + 1] if i + 1 < len(segments) else ""
        all_ps = re.findall(r"<p[^>]*>(.*?)</p>", next_part[:4000], re.S)
        blurbs = [_strip_tags(p).replace("\n", " ").strip() for p in all_ps]
        if skip_prefix:
            blurbs = [b for b in blurbs if not b.startswith(skip_prefix)]
        # For ESPN, skip the first <p> which is just "Player, Pos, School"
        analysis = [
            b
            for b in blurbs
            if len(b) > 40 and not re.match(r"^[A-Z][a-z]+ [A-Z][a-z]+,", b)
        ]
        if analysis:
            picks[pick_num] = " ".join(analysis[:2])[:600]
    return picks


def _parse_h2_p_espn(html: str) -> dict[int, str]:
    """ESPN: h2 = '1. Las Vegas Raiders', first <p> = player name, second <p> = blurb."""
    picks: dict[int, str] = {}
    seen: set[int] = set()
    segments = re.split(r"(<h2[^>]*>.*?</h2>)", html, flags=re.S)
    for i, seg in enumerate(segments):
        if not seg.startswith("<h2"):
            continue
        text = _strip_tags(seg).replace("\xa0", "").replace("\n", " ").strip()
        m = re.match(r"(\d+)[.)]\s*(.+)", text)
        if not m:
            continue
        pick_num = int(m.group(1))
        if pick_num > 32 or pick_num in seen:
            continue
        seen.add(pick_num)
        next_part = segments[i + 1] if i + 1 < len(segments) else ""
        all_ps = re.findall(r"<p[^>]*>(.*?)</p>", next_part[:4000], re.S)
        texts = [_strip_tags(p).replace("\n", " ").strip() for p in all_ps]
        # Skip short entries (player name line) and take analysis
        analysis = [t for t in texts if len(t) > 50]
        if analysis:
            picks[pick_num] = " ".join(analysis[:2])[:600]
    return picks


# ---------------------------------------------------------------------------
# Plain-text parser (for .txt files with pasted article content)
# ---------------------------------------------------------------------------


def _parse_plain_text(text: str) -> dict[int, str]:
    """
    Parse plain-text mock draft articles.
    Handles multiple formats:
      - "N. Team\n\nPos Player, School\n\nblurb"      (SI style)
      - "N. Team\nPlayer | Pos | School\n\nblurb"     (Athlon style)
      - "N. Team – Player, Pos, School\n\nblurb"      (USA Today style)
    Returns {pick_number: blurb}.
    """
    picks: dict[int, str] = {}
    # Split on pick-number lines: lines starting with "N." or "N) "
    blocks = re.split(r"(?m)^(\d{1,2})[.)]\s+", text)
    # blocks: [pre, pick_num, content, pick_num, content, ...]
    i = 1
    while i < len(blocks) - 1:
        try:
            pick_num = int(blocks[i])
        except ValueError:
            i += 2
            continue
        content = blocks[i + 1].strip() if i + 1 < len(blocks) else ""
        i += 2

        if pick_num > 32:
            continue

        # Split content into lines/paragraphs
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", content) if p.strip()]
        if not paragraphs:
            continue

        # Find the blurb: skip lines that look like team/player headers
        # Header patterns: "Team Name", "Player | Pos | School", "Pos Player, School"
        blurb_paras = []
        for para in paragraphs:
            lines = para.splitlines()
            # Skip short header lines (team name, player line)
            if len(lines) <= 2 and len(para) < 80 and not re.search(r"[.!?]", para):
                continue
            # Skip image caption lines (often contain "photographer" or file names)
            if re.search(r"\bvia\b.*\bImages?\b|\bImagn\b|\bUSATODAY\b", para, re.I):
                continue
            blurb_paras.append(para)

        if blurb_paras:
            picks[pick_num] = " ".join(blurb_paras[:2])[:600]

    return picks


# ---------------------------------------------------------------------------
# Auto-detect which slug a file belongs to
# ---------------------------------------------------------------------------

# Each tuple: (any-match keywords, slug) — slug is used if ANY keyword matches
SLUG_SIGNALS: list[tuple[list[str], str]] = [
    (
        ["nate davis", "nate-davis", "usa-today-2026-nate-davis"],
        "usa-today-2026-nate-davis",
    ),
    (
        ["middlehurst", "middlehurst-schwartz", "usa-today-2026-michael"],
        "usa-today-2026-michael-middlehurst-schwartz",
    ),
    (
        ["athlon", "luke easterling", "athlon-sports-2026"],
        "athlon-sports-2026-luke-easterling",
    ),
    (
        ["profootballnetwork", "pro football network", "infante", "7-round nfl mock"],
        "pro-football-network-2026-jacob-infante",
    ),
    (
        [
            "onsi/fantasy",
            "morales-smith",
            "mock draft 5.0",
            "mock-draft-4",
            "mock-draft-5",
            "si-2026-mark",
        ],
        "si-2026-mark-morales-smith",
    ),
    (["mel kiper", "mel-kiper", "espn-2026-mel-kiper"], "espn-2026-mel-kiper"),
    (["field yates", "field-yates"], "espn-2026-field-yates"),
    (["foxsports.com", "bucky brooks", "bucky-brooks"], "fox-sports-2026-bucky-brooks"),
    (
        ["pff.com", "pro football focus", "max chadwick"],
        "pro-football-focus-2026-max-chadwick",
    ),
    (
        ["for the win", "ftw.usatoday", "christian d'andrea"],
        "for-the-win-2026-christian-d-andrea",
    ),
    (
        ["the athletic", "baumgardner", "nytimes.com/athletic"],
        "the-athletic-2026-nick-baumgardner",
    ),
]

# slug → HTML parser function (used for .htm/.html files)
PARSERS: dict[str, callable] = {
    "espn-2026-mel-kiper": _parse_h2_p_espn,
    "espn-2026-field-yates": _parse_h2_p_espn,
    "pro-football-network-2026-jacob-infante": lambda h: _parse_h2_p(h),
    "usa-today-2026-nate-davis": lambda h: _parse_h2_p(h),
    "usa-today-2026-michael-middlehurst-schwartz": lambda h: _parse_h2_p(h),
    "athlon-sports-2026-luke-easterling": lambda h: _parse_h2_p(h),
    "si-2026-mark-morales-smith": lambda h: _parse_h2_p(h),
    # Already handled by live scraper but included for completeness
    "fox-sports-2026-bucky-brooks": lambda h: _parse_h2_p(h),
    "pro-football-focus-2026-max-chadwick": lambda h: _parse_h2_p(h),
    "for-the-win-2026-christian-d-andrea": lambda h: _parse_h2_p(
        h, skip_prefix="Needs:"
    ),
    "the-athletic-2026-nick-baumgardner": lambda h: _parse_h2_p(h),
}

# All slugs support plain-text parsing via _parse_plain_text
TEXT_PARSERS: set[str] = set(PARSERS.keys())

# slug → canonical article URL
SOURCE_URLS: dict[str, str] = {
    "espn-2026-mel-kiper": "https://www.espn.com/nfl/draft2026/story/_/id/47989848/2026-nfl-mock-draft-kiper-32-picks-pre-combine-predictions-round-1",
    "espn-2026-field-yates": "https://www.espn.com/nfl/draft2026/story/_/id/48151878/2026-nfl-free-agency-mock-draft-field-yates",
    "pro-football-network-2026-jacob-infante": "https://www.profootballnetwork.com/7-round-nfl-mock-draft-infante-march-2026/",
    "usa-today-2026-nate-davis": "https://www.usatoday.com/story/sports/nfl/draft/2026/03/09/nfl-mock-draft-2026-free-agency-trades/89",
    "athlon-sports-2026-luke-easterling": "https://athlonsports.com/nfl/2026-nfl-mock-draft-updated-maxx-crosby-trade",
    "si-2026-mark-morales-smith": "https://www.si.com/onsi/fantasy/nfl/mock-draft-4",
}


def _detect_slug(html: str, filename: str) -> str | None:
    haystack = (html[:8000] + filename).lower()
    for keywords, slug in SLUG_SIGNALS:
        if any(kw in haystack for kw in keywords):
            return slug
    return None


# ---------------------------------------------------------------------------
# Command
# ---------------------------------------------------------------------------


class Command(BaseCommand):
    help = "Ingest mock draft blurbs from locally saved HTML files"

    def add_arguments(self, parser):
        parser.add_argument("--season", type=int, default=date.today().year)
        parser.add_argument(
            "--dir", type=str, default="", help="Directory of .htm/.html/.txt files"
        )
        parser.add_argument("--file", type=str, default="", help="Single file path")
        parser.add_argument(
            "--slug", type=str, default="", help="Explicit slug for --file"
        )
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        season: int = options["season"]
        dry_run: bool = options["dry_run"]

        # Collect (path, slug_hint) pairs
        targets: list[tuple[Path, str | None]] = []

        if options["file"]:
            p = Path(options["file"])
            if not p.exists():
                raise CommandError(f"File not found: {p}")
            targets.append((p, options["slug"] or None))
        elif options["dir"]:
            d = Path(options["dir"])
            if not d.is_dir():
                raise CommandError(f"Not a directory: {d}")
            for ext in ("*.htm", "*.html", "*.txt"):
                for f in sorted(d.glob(ext)):
                    targets.append((f, None))
        else:
            raise CommandError("Provide --dir or --file")

        if not targets:
            raise CommandError("No files found")

        total_saved = 0

        for path, slug_hint in targets:
            self.stdout.write(f"\nProcessing: {path.name}")

            content = path.read_text(encoding="utf-8", errors="replace")
            if not content.strip():
                self.stderr.write("  Empty file — skipping")
                continue

            is_text = path.suffix.lower() == ".txt"
            slug = slug_hint or _detect_slug(content, path.name)
            if not slug:
                self.stderr.write(
                    "  Could not detect slug — skipping (use --slug to override)"
                )
                continue

            self.stdout.write(f"  Detected slug: {slug}")

            if is_text:
                if slug not in TEXT_PARSERS:
                    self.stderr.write(f"  No text parser for slug {slug!r} — skipping")
                    continue
                parser_fn = _parse_plain_text
            else:
                parser_fn = PARSERS.get(slug)
                if not parser_fn:
                    self.stderr.write(f"  No HTML parser for slug {slug!r} — skipping")
                    continue

            try:
                mock = DraftMockDraft.objects.get(season=season, slug=slug)
            except DraftMockDraft.DoesNotExist:
                self.stderr.write(
                    f"  DraftMockDraft not found for {slug} season={season} — skipping"
                )
                continue

            blurbs = parser_fn(content)
            fmt = "text" if is_text else "HTML"
            self.stdout.write(f"  Parsed {len(blurbs)} blurbs from {fmt}")

            if not blurbs:
                self.stderr.write("  WARNING: no blurbs parsed")
                continue

            current_picks: list = mock.picks or []
            updated = 0
            for pick in current_picks:
                pick_num = pick.get("pick") or pick.get("overall")
                if pick_num and pick_num in blurbs:
                    pick["blurb"] = blurbs[pick_num]
                    updated += 1

            self.stdout.write(f"  Enriched {updated}/{len(current_picks)} picks")

            if dry_run:
                self.stdout.write("  [dry-run] skipping write")
                continue

            update_fields = ["picks", "updated_at"]
            mock.picks = current_picks

            # Update source_url if we have a better one
            if slug in SOURCE_URLS and (
                not mock.source_url or "nflmockdraftdatabase" in mock.source_url
            ):
                mock.source_url = SOURCE_URLS[slug]
                update_fields.append("source_url")

            mock.save(update_fields=update_fields)
            self.stdout.write(self.style.SUCCESS(f"  Saved {mock.source_label}"))
            total_saved += 1

        self.stdout.write(
            self.style.SUCCESS(f"\nDone — {total_saved} mock(s) updated.")
        )
