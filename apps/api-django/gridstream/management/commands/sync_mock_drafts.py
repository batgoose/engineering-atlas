"""
Sync NFL mock draft data from nflmockdraftdatabase.com.

Runs the Playwright scraper (scrape_nflmockdraftdb_mock_drafts.mjs), ingests the
resulting JSON, and upserts DraftMockDraft records.

Usage:
    python manage.py sync_mock_drafts --season 2026
    python manage.py sync_mock_drafts --season 2026 --mock-slug espn-2026-field-yates
    python manage.py sync_mock_drafts --season 2026 --mock-slugs "espn-2026-field-yates,fox-sports-2026-bucky-brooks"
    python manage.py sync_mock_drafts --season 2026 --input-json /path/mocks.json
    python manage.py sync_mock_drafts --season 2026 --dry-run
"""

from __future__ import annotations

import json
import shutil
import subprocess
from datetime import date, datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from gridstream.models import DraftMockDraft


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


class Command(BaseCommand):
    help = "Sync mock draft picks from nflmockdraftdatabase.com"

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=_default_season(),
            help="Draft year, e.g. 2026 (default: current year)",
        )
        parser.add_argument(
            "--mock-slug",
            type=str,
            default="",
            help="Single mock slug to scrape, e.g. espn-2026-field-yates",
        )
        parser.add_argument(
            "--mock-slugs",
            type=str,
            default="",
            help="Comma-separated list of mock slugs to scrape",
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

    def handle(self, *args, **options):
        season: int = options["season"]
        mock_slug: str = options["mock_slug"].strip()
        mock_slugs: str = options["mock_slugs"].strip()
        input_json: str = options["input_json"].strip()
        dry_run: bool = options["dry_run"]

        # Step 1: Get JSON payload
        if input_json:
            self.stdout.write(f"Reading mocks from {input_json} ...")
            raw = Path(input_json).read_text(encoding="utf-8")
            payload = json.loads(raw)
        else:
            payload = self._run_scraper(season, mock_slug, mock_slugs)

        mocks = payload.get("mocks", [])
        if not mocks:
            raise CommandError("No mocks found in the scraped payload.")

        self.stdout.write(
            f"Found {len(mocks)} mock(s) in payload (season={payload.get('season', season)})"
        )

        # Step 2: Upsert DraftMockDraft rows
        total_created = 0
        total_updated = 0
        total_skipped = 0
        scraped_at = timezone.now()

        for mock in mocks:
            slug: str = mock.get("slug", "")
            source_key: str = mock.get("source_key", "")
            source_label: str = mock.get("source_label", slug)
            source_analyst: str = mock.get("source_analyst") or ""
            source_outlet: str = mock.get("source_outlet") or ""
            source_url: str = mock.get("source_url") or ""
            source_updated = _parse_date(mock.get("source_updated"))
            picks: list = mock.get("picks", [])
            error: str = mock.get("error", "")

            if error:
                self.stderr.write(f"  Skipping {source_label}: scraper error: {error}")
                total_skipped += 1
                continue

            if not slug or not source_key:
                self.stderr.write(f"  Skipping mock with missing slug/source_key")
                total_skipped += 1
                continue

            self.stdout.write(
                f"  Processing {source_label} — {len(picks)} picks"
                + (f" (updated {source_updated})" if source_updated else "")
            )

            if dry_run:
                self.stdout.write(f"    [dry-run] would upsert slug={slug!r}")
                total_created += 1
                continue

            # Skip write if source_updated matches what we already have — the
            # mock draft content hasn't changed since the last sync.
            if (
                source_updated
                and DraftMockDraft.objects.filter(
                    season=season, slug=slug, source_updated=source_updated
                ).exists()
            ):
                total_skipped += 1
                self.stdout.write(f"    → unchanged (source_updated={source_updated})")
                continue

            defaults = {
                "source_key": source_key,
                "source_label": source_label,
                "source_analyst": source_analyst,
                "source_outlet": source_outlet,
                "source_url": source_url,
                "source_updated": source_updated,
                "picks": picks,
                "scraped_at": scraped_at,
            }

            _, created = DraftMockDraft.objects.update_or_create(
                season=season,
                slug=slug,
                defaults=defaults,
            )

            if created:
                total_created += 1
                self.stdout.write(f"    → created")
            else:
                total_updated += 1
                self.stdout.write(f"    → updated")

        verb = "Would process" if dry_run else "Processed"
        self.stdout.write(
            self.style.SUCCESS(
                f"\n{verb}: {total_created} created, {total_updated} updated, {total_skipped} skipped"
            )
        )

    def _run_scraper(self, season: int, mock_slug: str, mock_slugs: str) -> dict:
        script_path = (
            Path(__file__).resolve().parents[2]
            / "scripts"
            / "scrape_nflmockdraftdb_mock_drafts.mjs"
        )

        if not script_path.exists():
            raise CommandError(
                f"Scraper script not found: {script_path}\n"
                "Make sure scrape_nflmockdraftdb_mock_drafts.mjs is in gridstream/scripts/"
            )

        node_bin = shutil.which("node")
        if not node_bin:
            raise CommandError(
                "Node.js not found in PATH — cannot run Playwright scraper."
            )

        scraper_args = ["--season", str(season)]
        if mock_slug:
            scraper_args += ["--mock-slug", mock_slug]
        elif mock_slugs:
            scraper_args += ["--mock-slugs", mock_slugs]

        cmd = [node_bin, str(script_path)] + scraper_args

        self.stdout.write(f"Running scraper: {' '.join(str(x) for x in cmd)}")
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,  # 10 minutes for multiple mocks
            )
        except subprocess.TimeoutExpired as exc:
            raise CommandError("Scraper timed out after 10 minutes.") from exc

        if result.returncode != 0:
            raise CommandError(
                f"Scraper exited with code {result.returncode}.\n"
                f"stderr:\n{result.stderr[:2000]}"
            )

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
