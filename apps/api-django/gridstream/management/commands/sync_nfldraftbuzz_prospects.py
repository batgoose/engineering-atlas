"""
Sync draft prospect scouting data from NFLDraftBuzz.

This command expects already-saved NFLDraftBuzz player pages. Provide a JSON
payload directly or point to a directory of saved HTML to parse locally.

Usage:
    python manage.py sync_nfldraftbuzz_prospects --season 2026 --input-json data.json
    python manage.py sync_nfldraftbuzz_prospects --season 2026 --saved-html-dir docs/prospects
    python manage.py sync_nfldraftbuzz_prospects --season 2026 --saved-html-dir docs/prospects --limit 120
    python manage.py sync_nfldraftbuzz_prospects --season 2026 --input-json data.json --dry-run
"""

from __future__ import annotations

import json
import shutil
import subprocess
from datetime import date, datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from gridstream.models import DraftProspect


def _default_draft_year() -> int:
    return date.today().year


def _parse_date(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def _clean_text(value: object) -> str:
    return str(value or "").strip()


def _clean_list(value: object) -> list:
    if not isinstance(value, list):
        return []
    return [item for item in value if item not in (None, "", [], {})]


def _clean_float(value):
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _clean_int(value):
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _has_payload_value(payload: dict, key: str) -> bool:
    if key not in payload:
        return False
    value = payload.get(key)
    return value not in (None, "", [], {})


class Command(BaseCommand):
    help = "Sync NFLDraftBuzz draft prospect scouting reports"

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=_default_draft_year(),
            help="Draft year to sync (default: current calendar year).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Maximum number of saved HTML files to parse (default: all).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and print summary counts without writing to the database.",
        )
        parser.add_argument(
            "--input-json",
            default="",
            help="Use an existing payload JSON file instead of parsing saved HTML.",
        )
        parser.add_argument(
            "--saved-html-dir",
            default="",
            help="Directory of saved NFLDraftBuzz player HTML files to parse locally.",
        )
        parser.add_argument(
            "--concurrency",
            type=int,
            default=3,
            help="Concurrent saved-HTML parsing tabs to use.",
        )

    def handle(self, *args, **options):
        input_json = _clean_text(options["input_json"])
        saved_html_dir = _clean_text(options["saved_html_dir"])
        if input_json and saved_html_dir:
            raise CommandError("Provide only one of --input-json or --saved-html-dir.")

        if input_json:
            payload = self._load_payload_file(input_json)
        elif saved_html_dir:
            if shutil.which("node") is None:
                raise CommandError(
                    "`node` is required to parse saved NFLDraftBuzz HTML. "
                    "Generate a JSON payload separately and pass --input-json instead."
                )

            payload = self._run_saved_html_parser(
                season=options["season"],
                saved_html_dir=saved_html_dir,
                limit=options["limit"],
                concurrency=options["concurrency"],
            )
        else:
            raise CommandError(
                "Provide --input-json or --saved-html-dir to load prospects."
            )

        prospects = payload.get("prospects", []) if isinstance(payload, dict) else []
        if not isinstance(prospects, list):
            raise CommandError("NFLDraftBuzz parser returned an invalid payload.")

        if options["dry_run"]:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Parsed {len(prospects)} NFLDraftBuzz prospects for {options['season']}."
                )
            )
            return

        created = 0
        updated = 0
        scraped_at = timezone.now()
        for row in prospects:
            if not isinstance(row, dict):
                continue
            source_slug = _clean_text(row.get("source_slug"))
            source_url = _clean_text(row.get("source_url"))
            name = _clean_text(row.get("name"))
            if not source_slug or not source_url or not name:
                continue
            queryset = DraftProspect.objects.using("nfl")
            prospect = queryset.filter(
                season=options["season"],
                source="nfldraftbuzz",
                source_slug=source_slug,
            ).first()

            field_specs = {
                "name": ("name", _clean_text),
                "position": ("position", _clean_text),
                "school": ("school", _clean_text),
                "class_year": ("class_year", _clean_text),
                "hometown": ("hometown", _clean_text),
                "role": ("role", _clean_text),
                "jersey_number": ("jersey_number", _clean_text),
                "image_url": ("image_url", _clean_text),
                "college_logo_url": ("college_logo_url", _clean_text),
                "overall_rating": ("buzz_overall_rating", _clean_float),
                "overall_rank": ("buzz_overall_rank", _clean_int),
                "position_rank": ("buzz_position_rank", _clean_int),
                "position_rank_group": ("buzz_position_rank_group", _clean_text),
                "draft_projection": ("draft_projection", _clean_text),
                "all_scouts_overall_rank": ("all_scouts_overall_rank", _clean_float),
                "all_scouts_position_rank": ("all_scouts_position_rank", _clean_float),
                "height": ("height", _clean_text),
                "weight": ("weight", _clean_int),
                "forty_yard": ("forty_yard", _clean_float),
                "hand_size": ("hand_size", _clean_text),
                "arm_length": ("arm_length", _clean_text),
                "age": ("age", _clean_float),
                "birth_date": ("birth_date", _parse_date),
                "college_games": ("college_games", _clean_int),
                "college_snaps": ("college_snaps", _clean_int),
                "bio": ("bio", _clean_text),
                "summary": ("summary", _clean_text),
                "strengths": ("strengths", _clean_list),
                "weaknesses": ("weaknesses", _clean_list),
                "honors": ("honors", _clean_list),
                "production_stats": ("production_stats", _clean_list),
                "scouting_grades": ("scouting_grades", _clean_list),
                "measurable_percentiles": ("measurable_percentiles", _clean_list),
                "recruiting_ratings": ("recruiting_ratings", _clean_list),
                "comparison_players": ("comparison_players", _clean_list),
                "source_last_updated": ("source_last_updated", _parse_date),
            }
            defaults = {
                "source_url": source_url,
                "scraped_at": scraped_at,
            }
            for field_name, (payload_key, cleaner) in field_specs.items():
                if prospect is not None and not _has_payload_value(row, payload_key):
                    defaults[field_name] = getattr(prospect, field_name)
                else:
                    defaults[field_name] = cleaner(row.get(payload_key))

            prospect, was_created = queryset.update_or_create(
                season=options["season"],
                source="nfldraftbuzz",
                source_slug=source_slug,
                defaults=defaults,
            )
            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Synced {created + updated} NFLDraftBuzz prospects "
                f"for {options['season']} ({created} created, {updated} updated)."
            )
        )

    def _repo_root(self) -> Path:
        current = Path(__file__).resolve()
        candidates = [Path.cwd(), *current.parents]
        for parent in candidates:
            if (
                parent
                / "apps"
                / "api-django"
                / "gridstream"
                / "scripts"
                / "scrape_nfldraftbuzz_prospects.mjs"
            ).exists():
                return parent
            if (
                parent / "gridstream" / "scripts" / "scrape_nfldraftbuzz_prospects.mjs"
            ).exists():
                return parent
        return Path.cwd()

    def _run_saved_html_parser(
        self,
        season: int,
        saved_html_dir: str,
        limit: int | None,
        concurrency: int,
    ) -> dict:
        repo_root = self._repo_root()
        possible_paths = [
            repo_root
            / "apps"
            / "api-django"
            / "gridstream"
            / "scripts"
            / "scrape_nfldraftbuzz_prospects.mjs",
            repo_root / "gridstream" / "scripts" / "scrape_nfldraftbuzz_prospects.mjs",
        ]
        script_path = next((path for path in possible_paths if path.exists()), None)
        if script_path is None:
            raise CommandError(
                "Parser script not found in any expected location:\n"
                + "\n".join(str(path) for path in possible_paths)
            )

        command = [
            "node",
            str(script_path),
            "--season",
            str(season),
            "--saved-html-dir",
            saved_html_dir,
            "--concurrency",
            str(concurrency),
        ]
        if limit is not None:
            command.extend(["--limit", str(limit)])
        completed = subprocess.run(
            command,
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise CommandError(
                "NFLDraftBuzz HTML parser failed:\n"
                f"stdout:\n{completed.stdout}\n\nstderr:\n{completed.stderr}"
            )

        stdout = completed.stdout.strip()
        if not stdout:
            raise CommandError("NFLDraftBuzz HTML parser returned no output.")

        try:
            return json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise CommandError(
                f"NFLDraftBuzz HTML parser returned invalid JSON: {exc}\n{stdout[:1000]}"
            ) from exc

    def _load_payload_file(self, input_json: str) -> dict:
        payload_path = Path(input_json).expanduser()
        if not payload_path.exists():
            raise CommandError(f"Input payload file does not exist: {payload_path}")
        try:
            return json.loads(payload_path.read_text())
        except json.JSONDecodeError as exc:
            raise CommandError(
                f"Input payload file contains invalid JSON: {payload_path}"
            ) from exc
