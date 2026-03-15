"""
Management command: sync_ras_scores

Syncs Relative Athletic Score data from ras.football into PlayerRAS records.

Two-phase workflow:
  1. DISCOVER — iterate ras.football PlayerIDs via HTTP, parse the summary
     sentence, and match to Player records in our DB (draft year 1999+) or
     to 2026 prospect names. Saves/updates PlayerRAS rows.

  2. SCREENSHOT — for each newly matched (or team-changed) player, run
     the scrape_ras_cards.mjs Playwright script to render the card image
     with team overlay, then upload the PNG to the 'player-ras' MinIO bucket.

Usage examples:
    # Incremental run (default): new IDs + current-year prospects only:
    python manage.py sync_ras_scores

    # Full scan of all IDs 1–33500 (initial population or recovery):
    python manage.py sync_ras_scores --full-scan

    # Discovery only (skip screenshots):
    python manage.py sync_ras_scores --skip-screenshots

    # Scan a narrow ID range (e.g. new 2026 prospects added recently):
    python manage.py sync_ras_scores --start-id 28000 --end-id 33500

    # Re-screenshot a single player (by their ras.football ID):
    python manage.py sync_ras_scores --ras-id 4883 --screenshots-only

    # Refresh images for players whose team has changed:
    python manage.py sync_ras_scores --refresh-team-images --screenshots-only
"""

import io
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import IntegrityError
from minio import Minio
from minio.error import S3Error

from gridstream.models import Player, PlayerRAS

logger = logging.getLogger(__name__)

BASE_URL = "https://ras.football/ras-information/"
BUCKET = "player-ras"
MIN_YEAR = 1999
MAX_PLAYER_ID = 33_500
DISCOVERY_WORKERS = 5
REQUEST_DELAY = 0.5  # seconds between batches
REQUEST_TIMEOUT = 15

# Matches the <h3> summary sentence on each page
H3_RE = re.compile(r"<h3[^>]*>(.*?)</h3>", re.DOTALL | re.IGNORECASE)

# Summary sentence variants
DRAFTED_RE = re.compile(
    r"^(.+?)\s+was drafted in round\s+(\d+)\s+with pick\s+(\d+)\s+in the\s+(\d{4})\s+draft class"
)
UNDRAFTED_RE = re.compile(
    r"^(.+?)\s+went undrafted as (?:a|an)\s+(\w+)\s+in the\s+(\d{4})\s+draft class"
)
PROSPECT_RE = re.compile(
    r"^(.+?)\s+is (?:a|an)\s+(\w+)\s+prospect in the\s+(\d{4})\s+draft class"
)
RAS_SCORE_RE = re.compile(r"scored a\s+([\d.]+)\s+RAS out of a possible")
INVALID_RE = re.compile(r"^went undrafted as\s+(?:a|an)?\s+in the\s+draft class")


def _minio_client() -> Minio:
    return Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=getattr(settings, "MINIO_USE_SSL", False),
    )


def _ensure_bucket(client: Minio) -> None:
    if not client.bucket_exists(BUCKET):
        client.make_bucket(BUCKET)
        # Set public read policy so images can be served directly
        policy = json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"AWS": ["*"]},
                        "Action": ["s3:GetObject"],
                        "Resource": [f"arn:aws:s3:::{BUCKET}/*"],
                    }
                ],
            }
        )
        client.set_bucket_policy(BUCKET, policy)
        logger.info("Created MinIO bucket '%s' with public-read policy", BUCKET)


def _normalize_name(name: str) -> str:
    """Lowercase, strip suffixes and punctuation for fuzzy matching."""
    name = name.lower().strip()
    name = re.sub(r"\b(jr\.?|sr\.?|ii|iii|iv|v)\b\.?", "", name)
    name = re.sub(r"[^\w\s]", "", name)
    return " ".join(name.split())


def _fetch_page(player_id: int) -> str | None:
    """Return raw HTML of a ras.football player page, or None on error."""
    try:
        resp = requests.get(
            BASE_URL,
            params={"PlayerID": player_id},
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": "Mozilla/5.0 (compatible; AtlasBot/1.0)"},
        )
        if resp.status_code != 200:
            return None
        return resp.text
    except Exception:
        return None


def _parse_summary(html: str) -> dict | None:
    """
    Extract player data from the page HTML.
    Returns a dict or None if the page has no valid player.
    """
    h3_match = H3_RE.search(html)
    if not h3_match:
        return None

    raw = h3_match.group(1).strip()
    # Strip HTML tags within the h3
    raw = re.sub(r"<[^>]+>", "", raw).strip()

    # Detect invalid/empty pages
    if INVALID_RE.match(raw):
        return None

    result = {
        "ras_summary": raw,
        "ras_score": None,
        "has_ras": False,
        "ras_name": "",
        "position": "",
        "draft_year": None,
        "draft_round": None,
        "draft_pick": None,
        "is_undrafted": False,
        "is_prospect": False,
    }

    m = DRAFTED_RE.match(raw)
    if m:
        result["ras_name"] = m.group(1).strip()
        result["draft_round"] = int(m.group(2))
        result["draft_pick"] = int(m.group(3))
        result["draft_year"] = int(m.group(4))
    else:
        m = UNDRAFTED_RE.match(raw)
        if m:
            result["ras_name"] = m.group(1).strip()
            result["position"] = m.group(2).strip().upper()
            result["draft_year"] = int(m.group(3))
            result["is_undrafted"] = True
        else:
            m = PROSPECT_RE.match(raw)
            if m:
                result["ras_name"] = m.group(1).strip()
                result["position"] = m.group(2).strip().upper()
                result["draft_year"] = int(m.group(3))
                result["is_prospect"] = True
            else:
                # Unknown format — still store it
                result["ras_name"] = raw[:100]

    if not result["ras_name"]:
        return None

    score_m = RAS_SCORE_RE.search(raw)
    if score_m:
        result["ras_score"] = float(score_m.group(1))
        result["has_ras"] = True

    return result


def _match_player(parsed: dict) -> Player | None:
    """Try to match the parsed RAS entry to a Player in our DB."""
    year = parsed.get("draft_year")
    name = parsed.get("ras_name", "")
    if not year or not name or year < MIN_YEAR:
        return None

    norm = _normalize_name(name)

    # 1. Exact display_name match + draft year
    qs = Player.objects.filter(draft_year=year).select_related("current_team")
    for player in qs:
        if _normalize_name(player.display_name) == norm:
            return player

    # 2. Try first+last name parts (handles "Jr." differences)
    parts = norm.split()
    if len(parts) >= 2:
        for player in qs:
            pnorm = _normalize_name(player.display_name)
            pparts = pnorm.split()
            if len(pparts) >= 2 and parts[0] == pparts[0] and parts[-1] == pparts[-1]:
                return player

    return None


def _team_overlay(player: Player | None, is_prospect: bool) -> str:
    """
    Return the team name string for the ras.football ?ovl= param.
    Prospects never get a team overlay.
    """
    if is_prospect or player is None:
        return ""
    team = getattr(player, "current_team", None)
    if team is None:
        return ""
    return team.name  # e.g. "Commanders", "Seahawks"


def _upload_image(client: Minio, image_path: str, object_key: str) -> bool:
    """Upload a PNG file to the player-ras bucket. Returns True on success."""
    try:
        client.fput_object(
            BUCKET,
            object_key,
            image_path,
            content_type="image/png",
        )
        return True
    except S3Error as exc:
        logger.error("MinIO upload failed for %s: %s", object_key, exc)
        return False


class Command(BaseCommand):
    help = "Sync Relative Athletic Scores from ras.football into PlayerRAS records"

    def add_arguments(self, parser):
        parser.add_argument(
            "--start-id",
            type=int,
            default=1,
            help="First ras.football PlayerID to scan",
        )
        parser.add_argument(
            "--end-id",
            type=int,
            default=MAX_PLAYER_ID,
            help="Last ras.football PlayerID to scan",
        )
        parser.add_argument(
            "--ras-id", type=int, help="Process a single ras.football PlayerID"
        )
        parser.add_argument(
            "--skip-screenshots",
            action="store_true",
            help="Only discover/match data; skip Playwright screenshotting",
        )
        parser.add_argument(
            "--screenshots-only",
            action="store_true",
            help="Skip discovery; only re-screenshot existing matched records",
        )
        parser.add_argument(
            "--refresh-team-images",
            action="store_true",
            help="Re-screenshot players whose current team differs from ras_image_team",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and match but do not save to DB",
        )
        parser.add_argument(
            "--min-year",
            type=int,
            default=MIN_YEAR,
            help="Skip players drafted before this year (default: 1999)",
        )
        parser.add_argument(
            "--export-manifest",
            metavar="OUTDIR",
            help=(
                "Write manifest.json + image paths to OUTDIR (container path) and exit. "
                "Then run the Node script on the host, then use --upload-results."
            ),
        )
        parser.add_argument(
            "--upload-results",
            metavar="OUTDIR",
            help="Read manifest.json from OUTDIR, upload PNGs to MinIO, update DB records.",
        )
        parser.add_argument(
            "--full-scan",
            action="store_true",
            help=(
                "Scan all IDs from --start-id to --end-id. By default only new IDs "
                "(beyond the highest already in DB) and current-year prospects are checked."
            ),
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        skip_screenshots = options["skip_screenshots"]
        screenshots_only = options["screenshots_only"]
        refresh_team_images = options["refresh_team_images"]
        min_year = options["min_year"]
        export_manifest = options.get("export_manifest")
        upload_results = options.get("upload_results")

        if upload_results:
            minio_client = _minio_client()
            _ensure_bucket(minio_client)
            self._do_upload_results(upload_results, minio_client)
            return

        minio_client = _minio_client()
        if not dry_run:
            _ensure_bucket(minio_client)

        if not screenshots_only:
            self._run_discovery(options, dry_run, min_year)

        if export_manifest:
            self._do_export_manifest(options, refresh_team_images, export_manifest)
            return

        if not skip_screenshots:
            self._run_screenshots(options, dry_run, refresh_team_images, minio_client)

    # ─── Phase 1: Discovery ──────────────────────────────────────────────────

    def _run_discovery(self, options, dry_run, min_year):
        from datetime import date

        if options.get("ras_id"):
            ids = [options["ras_id"]]
        elif options.get("full_scan"):
            ids = list(range(options["start_id"], options["end_id"] + 1))
        else:
            # Incremental: only scan IDs beyond the highest we have already seen,
            # plus current-year prospects whose scores may be added after combine/pro day.
            current_year = date.today().year
            known_ids = set(PlayerRAS.objects.values_list("ras_player_id", flat=True))
            max_known = max(known_ids, default=0)
            prospect_ids = set(
                PlayerRAS.objects.filter(
                    is_prospect=True, draft_year=current_year, has_ras=False
                ).values_list("ras_player_id", flat=True)
            )
            new_ids = set(range(max_known + 1, options["end_id"] + 1))
            ids = sorted(new_ids | prospect_ids)
            self.stdout.write(
                f"Incremental mode: {len(new_ids):,} new IDs + "
                f"{len(prospect_ids)} current-year ({current_year}) prospects "
                f"= {len(ids):,} to check"
            )

        self.stdout.write(f"Scanning {len(ids):,} player IDs...")
        total = matched = skipped = 0

        with ThreadPoolExecutor(max_workers=DISCOVERY_WORKERS) as pool:
            futures = {pool.submit(_fetch_page, pid): pid for pid in ids}
            batch_count = 0
            for future in as_completed(futures):
                pid = futures[future]
                batch_count += 1
                if batch_count % 500 == 0:
                    self.stdout.write(
                        f"  {batch_count:,}/{len(ids):,} scanned, "
                        f"{matched} matched so far..."
                    )
                # Rate limit
                if batch_count % DISCOVERY_WORKERS == 0:
                    time.sleep(REQUEST_DELAY)

                html = future.result()
                if not html:
                    continue

                parsed = _parse_summary(html)
                if not parsed:
                    continue

                total += 1

                year = parsed.get("draft_year")
                is_prospect = parsed.get("is_prospect", False)

                # Skip players before min_year (except prospects)
                if year and not is_prospect and year < min_year:
                    skipped += 1
                    continue

                player = _match_player(parsed)

                # Skip entirely unmatched non-prospect entries
                if player is None and not is_prospect:
                    continue

                matched += 1
                self._save_ras_record(pid, parsed, player, dry_run)

        self.stdout.write(
            self.style.SUCCESS(
                f"Discovery done: {total} valid pages, {matched} matched, "
                f"{skipped} pre-{min_year} skipped."
            )
        )

    def _save_ras_record(self, ras_player_id: int, parsed: dict, player, dry_run: bool):
        if dry_run:
            score = parsed.get("ras_score")
            self.stdout.write(
                f"  [DRY RUN] {parsed['ras_name']} ({parsed['draft_year']}) "
                f"RAS={score} → player={'matched' if player else 'unmatched'}"
            )
            return

        defaults = {
            "ras_score": parsed["ras_score"],
            "ras_summary": parsed["ras_summary"],
            "has_ras": parsed["has_ras"],
            "ras_name": parsed["ras_name"],
            "position": parsed.get("position", ""),
            "draft_year": parsed["draft_year"],
            "draft_round": parsed.get("draft_round"),
            "draft_pick": parsed.get("draft_pick"),
            "is_undrafted": parsed.get("is_undrafted", False),
            "is_prospect": parsed.get("is_prospect", False),
        }
        if player is not None:
            defaults["player"] = player

        try:
            PlayerRAS.objects.update_or_create(
                ras_player_id=ras_player_id,
                defaults=defaults,
            )
        except IntegrityError:
            # Another thread already claimed this player's OneToOneField slot;
            # save the record without the player link.
            defaults.pop("player", None)
            PlayerRAS.objects.update_or_create(
                ras_player_id=ras_player_id,
                defaults=defaults,
            )

    # ─── Phase 2: Screenshots ────────────────────────────────────────────────

    def _run_screenshots(self, options, dry_run, refresh_team_images, minio_client):
        if options.get("ras_id"):
            qs = PlayerRAS.objects.filter(ras_player_id=options["ras_id"])
        else:
            qs = PlayerRAS.objects.filter(player__isnull=False).select_related(
                "player__current_team"
            )
            # Also include unmatched prospects
            qs = qs | PlayerRAS.objects.filter(is_prospect=True, ras_image_key="")

        if refresh_team_images:
            # Re-run all matched players whose team overlay may be stale
            records_to_screenshot = list(qs)
        else:
            # Only those without an image yet, or explicitly requested
            records_to_screenshot = [r for r in qs if not r.ras_image_key]

        if not records_to_screenshot:
            self.stdout.write("No records need screenshotting.")
            return

        self.stdout.write(f"Screenshotting {len(records_to_screenshot)} cards...")

        script_path = (
            Path(__file__).parent.parent.parent / "scripts" / "scrape_ras_cards.mjs"
        )
        if not script_path.exists():
            self.stderr.write(f"Playwright script not found at {script_path}")
            return

        with tempfile.TemporaryDirectory() as tmpdir:
            # Build input manifest for the Node script
            manifest = []
            for record in records_to_screenshot:
                overlay = _team_overlay(
                    getattr(record, "player", None), record.is_prospect
                )
                manifest.append(
                    {
                        "ras_player_id": record.ras_player_id,
                        "team_overlay": overlay,
                        "output_path": os.path.join(
                            tmpdir, f"{record.ras_player_id}.png"
                        ),
                    }
                )

            manifest_path = os.path.join(tmpdir, "manifest.json")
            with open(manifest_path, "w") as f:
                json.dump(manifest, f)

            if dry_run:
                self.stdout.write(
                    f"[DRY RUN] Would screenshot {len(manifest)} cards via {script_path}"
                )
                return

            # Run the Playwright script
            node_bin = shutil.which("node")
            if not node_bin:
                self.stderr.write(
                    "Node.js not found in PATH — skipping RAS card screenshots. "
                    "Install node in the container or run screenshot phase on the host."
                )
                return

            result = subprocess.run(
                [node_bin, str(script_path), "--input", manifest_path],
                capture_output=True,
                text=True,
                timeout=600,
            )

            if result.returncode != 0:
                self.stderr.write(f"Playwright script failed:\n{result.stderr}")
                return

            self.stdout.write(result.stdout.strip())

            # Upload screenshots and update DB records
            uploaded = 0
            for entry in manifest:
                pid = entry["ras_player_id"]
                img_path = entry["output_path"]
                overlay = entry["team_overlay"]

                if not os.path.exists(img_path):
                    logger.warning("No screenshot generated for PlayerID %s", pid)
                    continue

                object_key = f"{pid}.png"
                if _upload_image(minio_client, img_path, object_key):
                    PlayerRAS.objects.filter(ras_player_id=pid).update(
                        ras_image_key=object_key,
                        ras_image_team=overlay,
                    )
                    uploaded += 1

            self.stdout.write(
                self.style.SUCCESS(f"Uploaded {uploaded}/{len(manifest)} card images.")
            )

    # ─── Export manifest (for host-side node run) ─────────────────────────────

    def _do_export_manifest(self, options, refresh_team_images, outdir):
        os.makedirs(outdir, exist_ok=True)
        os.chmod(outdir, 0o777)
        html_dir = os.path.join(outdir, "html")
        os.makedirs(html_dir, exist_ok=True)
        os.chmod(html_dir, 0o777)

        if options.get("ras_id"):
            qs = PlayerRAS.objects.filter(ras_player_id=options["ras_id"])
        else:
            qs = PlayerRAS.objects.filter(player__isnull=False).select_related(
                "player__current_team"
            )
            qs = qs | PlayerRAS.objects.filter(is_prospect=True, ras_image_key="")

        if refresh_team_images:
            records = list(qs)
        else:
            records = [r for r in qs if not r.ras_image_key]

        if not records:
            self.stdout.write("No records need screenshotting.")
            return

        script_path = (
            Path(__file__).parent.parent.parent / "scripts" / "scrape_ras_cards.mjs"
        )

        # Fetch page HTML for each record via plain HTTP (bypasses Cloudflare),
        # save locally so Playwright can open via file:// URL.
        self.stdout.write(f"Fetching {len(records)} card pages via HTTP...")
        manifest = []
        fetched = failed = 0

        def _fetch_and_save(record):
            overlay = _team_overlay(getattr(record, "player", None), record.is_prospect)
            pid = record.ras_player_id
            params = {"PlayerID": pid}
            if overlay:
                params["ovl"] = overlay
            try:
                resp = requests.get(
                    BASE_URL,
                    params=params,
                    timeout=REQUEST_TIMEOUT,
                    headers={"User-Agent": "Mozilla/5.0 (compatible; AtlasBot/1.0)"},
                )
                if resp.status_code != 200:
                    return None
                html_path = os.path.join(html_dir, f"{pid}.html")
                with open(html_path, "w", encoding="utf-8") as f:
                    f.write(resp.text)
                return {
                    "ras_player_id": pid,
                    "team_overlay": overlay,
                    "filename": f"{pid}.png",
                    "html_path": f"html/{pid}.html",  # relative to manifest dir
                }
            except Exception:
                return None

        with ThreadPoolExecutor(max_workers=DISCOVERY_WORKERS) as pool:
            futures = {pool.submit(_fetch_and_save, r): r for r in records}
            done = 0
            for future in as_completed(futures):
                done += 1
                if done % 500 == 0:
                    self.stdout.write(f"  {done:,}/{len(records):,} fetched...")
                entry = future.result()
                if entry:
                    manifest.append(entry)
                    fetched += 1
                else:
                    failed += 1
                if done % DISCOVERY_WORKERS == 0:
                    time.sleep(REQUEST_DELAY)

        self.stdout.write(f"Fetched {fetched} pages ({failed} failed).")

        manifest_path = os.path.join(outdir, "manifest.json")
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        self.stdout.write(
            self.style.SUCCESS(
                f"Wrote manifest with {len(manifest)} entries to {manifest_path}"
            )
        )
        self.stdout.write(
            f"\nNow run on the HOST (translating /app/ to your host mount path):\n"
            f"  node {script_path} --input <host-path-to>/manifest.json\n"
            f"\nThen upload results:\n"
            f"  docker exec atlas-api-django python manage.py sync_ras_scores "
            f"--upload-results {outdir}"
        )

    # ─── Upload results after host-side node run ──────────────────────────────

    def _do_upload_results(self, outdir, minio_client):
        manifest_path = os.path.join(outdir, "manifest.json")
        if not os.path.exists(manifest_path):
            self.stderr.write(f"manifest.json not found in {outdir}")
            return

        with open(manifest_path) as f:
            manifest = json.load(f)

        uploaded = skipped = 0
        for entry in manifest:
            pid = entry["ras_player_id"]
            filename = entry.get("filename", f"{pid}.png")
            img_path = os.path.join(outdir, filename)
            overlay = entry.get("team_overlay", "")

            if not os.path.exists(img_path):
                skipped += 1
                continue

            object_key = f"{pid}.png"
            if _upload_image(minio_client, img_path, object_key):
                PlayerRAS.objects.filter(ras_player_id=pid).update(
                    ras_image_key=object_key,
                    ras_image_team=overlay,
                )
                uploaded += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Uploaded {uploaded}/{len(manifest)} card images "
                f"({skipped} missing, skipped)."
            )
        )
