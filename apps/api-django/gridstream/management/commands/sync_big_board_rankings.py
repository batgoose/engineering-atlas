"""
Sync per-scout big board rankings from nflmockdraftdatabase.com.

Runs the Playwright scraper (scrape_nflmockdraftdb_big_boards.mjs), ingests the
resulting JSON, and upserts DraftProspectRanking records.  Optionally links each
ranking entry back to an existing DraftProspect via name/position/school matching.

Usage:
    python manage.py sync_big_board_rankings --season 2026
    python manage.py sync_big_board_rankings --season 2026 --board-slug nfl-com-2026-daniel-jeremiah-big-board
    python manage.py sync_big_board_rankings --season 2026 --board-slugs "consensus-big-board-2026,tankathon-2026-big-board"
    python manage.py sync_big_board_rankings --season 2026 --input-json /path/boards.json
    python manage.py sync_big_board_rankings --season 2026 --dry-run
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unicodedata
from datetime import date, datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from gridstream.models import DraftProspect, DraftProspectRanking


def _default_season() -> int:
    return date.today().year


def _parse_date(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _normalize_name(name: str) -> str:
    """
    Normalize a player name for fuzzy matching:
    lowercase, strip accents, collapse whitespace, remove punctuation.
    """
    nfkd = unicodedata.normalize("NFKD", str(name or ""))
    ascii_name = nfkd.encode("ascii", "ignore").decode("ascii")
    lower = ascii_name.lower()
    no_punct = re.sub(r"[^a-z0-9 ]", "", lower)
    return re.sub(r"\s+", " ", no_punct).strip()


def _build_prospect_lookup(season: int) -> dict[tuple[str, str], DraftProspect]:
    """
    Build a lookup map (normalized_name, normalized_position) → DraftProspect
    for efficient matching.
    """
    lookup: dict[tuple[str, str], DraftProspect] = {}
    for p in DraftProspect.objects.filter(season=season):
        key = (_normalize_name(p.name), _normalize_name(p.position or ""))
        lookup[key] = p
    return lookup


def _match_prospect(
    name: str,
    position: str,
    lookup: dict[tuple[str, str], DraftProspect],
) -> DraftProspect | None:
    """
    Try to match a ranking entry to a DraftProspect.
    Attempts in order:
      1. Exact (name, position)
      2. Name-only exact
      3. Prefix match — handles suffixes like "II", "III", "Jr." being present on
         one side but not the other (e.g. "Chris Brazzell" ↔ "Chris Brazzell II")
      4. First-initial + last-name — handles initials vs full first name
         (e.g. "KC Concepcion" ↔ "Kevin Concepcion")
    """
    norm_name = _normalize_name(name)
    norm_pos = _normalize_name(position or "")

    # 1. Exact (name, position)
    exact = lookup.get((norm_name, norm_pos))
    if exact:
        return exact

    # 2. Name-only exact
    for (pname, _ppos), prospect in lookup.items():
        if pname == norm_name:
            return prospect

    # 3. Prefix match (one name is a leading substring of the other)
    for (pname, _ppos), prospect in lookup.items():
        if pname.startswith(norm_name + " ") or norm_name.startswith(pname + " "):
            return prospect

    # 4. First-initial + last-name match
    tokens = norm_name.split()
    if len(tokens) >= 2:
        first_init = tokens[0][0]
        last = tokens[-1]
        for (pname, _ppos), prospect in lookup.items():
            ptokens = pname.split()
            if (
                len(ptokens) >= 2
                and ptokens[-1] == last
                and ptokens[0][0] == first_init
            ):
                return prospect

    return None


class Command(BaseCommand):
    help = "Sync per-scout big board rankings from nflmockdraftdatabase.com"

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=_default_season(),
            help="Draft year, e.g. 2026 (default: current year)",
        )
        parser.add_argument(
            "--board-slug",
            type=str,
            default="",
            help="Single board slug to scrape, e.g. nfl-com-2026-daniel-jeremiah-big-board",
        )
        parser.add_argument(
            "--board-slugs",
            type=str,
            default="",
            help="Comma-separated list of board slugs to scrape",
        )
        parser.add_argument(
            "--input-json",
            type=str,
            default="",
            help="Path to a pre-scraped JSON file (skips running the scraper)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and validate but do not write to the database",
        )
        parser.add_argument(
            "--skip-prospect-matching",
            action="store_true",
            help="Do not attempt to match rankings to DraftProspect records",
        )

    def handle(self, *args, **options):
        season: int = options["season"]
        board_slug: str = options["board_slug"].strip()
        board_slugs: str = options["board_slugs"].strip()
        input_json: str = options["input_json"].strip()
        dry_run: bool = options["dry_run"]
        skip_matching: bool = options["skip_prospect_matching"]

        # -----------------------------------------------------------------
        # Step 1: Get the raw boards JSON
        # -----------------------------------------------------------------
        if input_json:
            self.stdout.write(f"Reading boards from {input_json} ...")
            raw = Path(input_json).read_text(encoding="utf-8")
            payload = json.loads(raw)
        else:
            payload = self._run_scraper(season, board_slug, board_slugs)

        boards = payload.get("boards", [])
        if not boards:
            raise CommandError("No boards found in the scraped payload.")

        self.stdout.write(
            f"Found {len(boards)} board(s) in payload (season={payload.get('season', season)})"
        )

        # -----------------------------------------------------------------
        # Step 2: Build DraftProspect lookup (for FK linking)
        # -----------------------------------------------------------------
        prospect_lookup: dict[tuple[str, str], DraftProspect] = {}
        if not skip_matching:
            prospect_lookup = _build_prospect_lookup(season)
            self.stdout.write(
                f"Built prospect lookup with {len(prospect_lookup)} NFLDraftBuzz entries"
            )

        # -----------------------------------------------------------------
        # Step 3: Upsert DraftProspectRanking rows
        # -----------------------------------------------------------------
        total_created = 0
        total_updated = 0
        total_skipped = 0
        scraped_at = timezone.now()

        for board in boards:
            source_key: str = board.get("source_key", "")
            source_label: str = board.get("source_label", source_key)
            source_analyst: str = board.get("source_analyst") or ""
            source_outlet: str = board.get("source_outlet") or ""
            source_url: str = board.get("source_url") or ""
            source_updated = _parse_date(board.get("source_updated"))
            entries: list[dict] = board.get("entries", [])
            board_error: str = board.get("error", "")

            if board_error:
                self.stderr.write(
                    f"  Skipping {source_label}: scraper reported error: {board_error}"
                )
                continue

            if not entries:
                self.stderr.write(f"  Skipping {source_label}: no entries")
                continue

            self.stdout.write(
                f"  Processing {source_label} — {len(entries)} entries"
                + (f" (updated {source_updated})" if source_updated else "")
            )

            board_created = board_updated = 0
            for entry in entries:
                name: str = str(entry.get("name") or "").strip()
                name_slug: str = str(entry.get("name_slug") or "").strip()
                rank: int | None = entry.get("rank")
                position: str = str(entry.get("position") or "").strip()
                school: str = str(entry.get("school") or "").strip()

                if not name or not name_slug or not rank:
                    total_skipped += 1
                    continue

                # Match to DraftProspect if possible
                prospect: DraftProspect | None = None
                if not skip_matching and prospect_lookup:
                    prospect = _match_prospect(name, position, prospect_lookup)

                defaults = {
                    "source_label": source_label,
                    "source_analyst": source_analyst,
                    "source_outlet": source_outlet,
                    "source_url": source_url,
                    "source_updated": source_updated,
                    "rank": rank,
                    "name": name,
                    "position": position,
                    "school": school,
                    "prospect": prospect,
                    "scraped_at": scraped_at,
                }

                if dry_run:
                    self.stdout.write(
                        f"    [dry-run] #{rank} {name} ({position}, {school})"
                        + (f" → prospect #{prospect.pk}" if prospect else "")
                    )
                    board_created += 1
                    continue

                _, created = DraftProspectRanking.objects.update_or_create(
                    season=season,
                    source=source_key,
                    name_slug=name_slug,
                    defaults=defaults,
                )
                if created:
                    board_created += 1
                else:
                    board_updated += 1

            total_created += board_created
            total_updated += board_updated
            label = (
                "dry-run"
                if dry_run
                else f"created={board_created}, updated={board_updated}"
            )
            self.stdout.write(f"    → {label}")

        verb = "Would process" if dry_run else "Processed"
        self.stdout.write(
            self.style.SUCCESS(
                f"\n{verb}: {total_created} created, {total_updated} updated, {total_skipped} skipped"
            )
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _run_scraper(self, season: int, board_slug: str, board_slugs: str) -> dict:
        """
        Shell out to the Node.js Playwright scraper and return the parsed JSON.
        """
        script_path = (
            Path(__file__).resolve().parents[2]
            / "scripts"
            / "scrape_nflmockdraftdb_big_boards.mjs"
        )

        if not script_path.exists():
            raise CommandError(
                f"Scraper script not found: {script_path}\n"
                "Make sure scrape_nflmockdraftdb_big_boards.mjs is in gridstream/scripts/"
            )

        node_bin = shutil.which("node")
        if not node_bin:
            raise CommandError(
                "Node.js not found in PATH — cannot run Playwright scraper."
            )

        scraper_args = ["--season", str(season), "--dry-run"]
        if board_slug:
            scraper_args += ["--board-slug", board_slug]
        elif board_slugs:
            scraper_args += ["--board-slugs", board_slugs]

        # Run as: node gridstream/scripts/scrape_nflmockdraftdb_big_boards.mjs --season 2026 --dry-run
        cmd = [node_bin, str(script_path)] + scraper_args

        self.stdout.write(f"Running scraper: {' '.join(str(x) for x in cmd)}")
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minutes
            )
        except subprocess.TimeoutExpired as exc:
            raise CommandError("Scraper timed out after 5 minutes.") from exc

        if result.returncode != 0:
            raise CommandError(
                f"Scraper exited with code {result.returncode}.\n"
                f"stderr:\n{result.stderr[:2000]}"
            )

        # stderr has progress logs, stdout has JSON
        if result.stderr:
            for line in result.stderr.strip().splitlines():
                self.stdout.write(f"  [scraper] {line}")

        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise CommandError(
                f"Failed to parse scraper JSON output: {exc}\n"
                f"stdout preview:\n{result.stdout[:500]}"
            ) from exc
