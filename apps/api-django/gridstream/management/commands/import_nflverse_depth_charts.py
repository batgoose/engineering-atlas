"""
Import nflverse-data depth charts into raw.raw_nflverse_depth_charts.

Source release:
    https://github.com/nflverse/nflverse-data/releases/tag/depth_charts

For each requested season, this command downloads depth_charts_{season}.csv
from release assets and writes source-faithful rows into raw.raw_nflverse_depth_charts.
"""

import csv
import hashlib
import io
import json
import re
from datetime import UTC, datetime

import requests
from django.core.management.base import CommandError
from django.db import transaction

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}
RELEASE_TAG = "depth_charts"
RELEASE_API_URL = (
    f"https://api.github.com/repos/nflverse/nflverse-data/releases/tags/{RELEASE_TAG}"
)
RELEASE_PAGE_URL = (
    f"https://github.com/nflverse/nflverse-data/releases/tag/{RELEASE_TAG}"
)
ASSET_RE = re.compile(r"^depth_charts_(\d{4})\.csv$")
INSERT_SQL = """
    INSERT INTO raw.raw_nflverse_depth_charts (
        batch_id,
        season,
        week,
        team,
        player_id,
        player_name,
        position,
        depth_rank,
        payload
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
"""


class Command(ImportBaseCommand):
    help = "Import nflverse-data depth charts into raw.raw_nflverse_depth_charts."

    def handle(self, *args, **options):
        self.batch_size = max(1, options["batch_size"])
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        self._ensure_required_tables()
        assets = self._fetch_release_assets()
        season_asset_map = self._build_season_asset_map(assets)
        target_seasons = self._resolve_target_seasons(
            requested, season_asset_map.keys()
        )

        if not target_seasons:
            self.stdout.write(
                self.style.WARNING("No seasons selected; nothing to import.")
            )
            return

        rows = []
        checksum_seed = hashlib.sha256()
        for season in target_seasons:
            asset = season_asset_map.get(season)
            if not asset:
                self.stdout.write(
                    self.style.WARNING(
                        f"Skipping {season}: no depth chart asset found."
                    )
                )
                continue
            with self.timed_operation(f"Downloading {asset['name']}"):
                content, checksum = self._download_asset(asset["url"])
            checksum_seed.update(f"{season}:{checksum}".encode("utf-8"))
            rows.extend(self._parse_rows(content, season_hint=season))

        if not rows:
            self.stdout.write(
                self.style.WARNING("No rows parsed from selected depth chart assets.")
            )
            return

        rows.sort(
            key=lambda row: (
                row["season"] if row["season"] is not None else -1,
                row["week"] if row["week"] is not None else -1,
                row["team"] or "",
                row["player_name"] or "",
            )
        )

        self.stdout.write(
            f"Importing depth charts for {len(target_seasons)} seasons: "
            f"{target_seasons[0]}-{target_seasons[-1]} "
            f"({len(rows):,} rows)"
        )

        batch_id = None
        if not self.dry_run:
            batch_id = self._begin_batch(
                seasons=target_seasons,
                checksum=checksum_seed.hexdigest(),
            )

        try:
            with transaction.atomic(using="nfl"):
                deleted = self._delete_existing_rows(target_seasons)
                inserted = self._insert_rows(rows, batch_id)
        except Exception as exc:
            if batch_id is not None:
                self._complete_batch(
                    batch_id=batch_id,
                    row_count=0,
                    processed_rows=0,
                    status="failed",
                    error=str(exc),
                )
            raise

        if batch_id is not None:
            self._complete_batch(
                batch_id=batch_id,
                row_count=inserted,
                processed_rows=inserted,
                status="ok",
                error=None,
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Done! {inserted:,} inserted, {deleted:,} deleted "
                f"across {len(target_seasons)} seasons."
            )
        )

    def _ensure_required_tables(self):
        with self.get_nfl_cursor() as cursor:
            cursor.execute("""
                SELECT
                    to_regclass('raw.raw_nflverse_depth_charts'),
                    to_regclass('raw.raw_ingest_batch')
                """)
            depth_table, ingest_batch_table = cursor.fetchone()

        if not depth_table:
            raise CommandError(
                "Missing table raw.raw_nflverse_depth_charts. Run migrations first."
            )
        if not ingest_batch_table:
            raise CommandError(
                "Missing table raw.raw_ingest_batch. Run migrations first."
            )

    def _fetch_release_assets(self):
        response = requests.get(
            RELEASE_API_URL,
            timeout=120,
            headers={"User-Agent": "engineering-atlas/import_nflverse_depth_charts"},
        )
        response.raise_for_status()
        payload = response.json()
        return payload.get("assets", [])

    def _build_season_asset_map(self, assets):
        season_assets = {}
        for asset in assets:
            name = str(asset.get("name") or "")
            match = ASSET_RE.match(name)
            if not match:
                continue
            season = int(match.group(1))
            download_url = asset.get("browser_download_url")
            if not download_url:
                continue
            season_assets[season] = {"name": name, "url": download_url}
        return season_assets

    def _resolve_target_seasons(self, requested, available_seasons):
        available = sorted(int(season) for season in available_seasons)
        if requested:
            requested_set = {int(season) for season in requested}
            available_set = set(available)
            missing = sorted(requested_set - available_set)
            if missing:
                self.stdout.write(
                    self.style.WARNING(
                        f"Requested seasons missing from {RELEASE_TAG} release: {missing}"
                    )
                )
            return sorted(requested_set & available_set)
        return available

    def _download_asset(self, url):
        response = requests.get(
            url,
            timeout=180,
            headers={"User-Agent": "engineering-atlas/import_nflverse_depth_charts"},
        )
        response.raise_for_status()
        content = response.content
        checksum = hashlib.sha256(content).hexdigest()
        return content, checksum

    def _parse_rows(self, content, season_hint=None):
        decoded = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(decoded))
        rows = []
        for row in reader:
            # Legacy schema includes season/week/club_code columns.
            # Newer schema (e.g. 2025+) uses dt/team/player_name/pos_* with no week.
            season = self.safe_int(row.get("season"), default=season_hint)
            if season is None:
                continue
            week = self.safe_int(row.get("week"))
            team = self._canonical_team(row.get("club_code") or row.get("team"))
            if not team:
                continue
            first_name = self.safe_str(row.get("first_name"), default="")
            last_name = self.safe_str(row.get("last_name"), default="")
            full_name = self.safe_str(row.get("full_name"), default="")
            football_name = self.safe_str(row.get("football_name"), default="")
            modern_name = self.safe_str(row.get("player_name"), default="")
            player_name = (
                full_name
                or football_name
                or modern_name
                or f"{first_name} {last_name}".strip()
            )
            depth_position = self.safe_str(row.get("depth_position"), default="")
            position = (
                depth_position
                or self.safe_str(row.get("position"), default="")
                or self.safe_str(row.get("pos_abb"), default="")
                or self.safe_str(row.get("pos_name"), default="")
            )
            depth_rank = self.safe_int(row.get("depth_team"))
            if depth_rank is None:
                depth_rank = self.safe_int(row.get("pos_rank"))
            normalized = self._normalize_payload(row)
            rows.append(
                {
                    "season": season,
                    "week": week,
                    "team": team,
                    "player_id": self.safe_str(row.get("gsis_id"), default="") or None,
                    "player_name": player_name or None,
                    "position": position or None,
                    "depth_rank": depth_rank,
                    "payload": json.dumps(normalized),
                }
            )
        return rows

    def _begin_batch(self, seasons, checksum):
        metadata = json.dumps(
            {
                "status": "started",
                "ingest_tool": "django.import_nflverse_depth_charts",
                "target_table": "raw.raw_nflverse_depth_charts",
                "season_count": len(seasons),
                "season_min": min(seasons),
                "season_max": max(seasons),
            }
        )
        source_version = f"{min(seasons)}-{max(seasons)}"
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO raw.raw_ingest_batch (
                    source_system,
                    dataset_name,
                    source_url,
                    source_file,
                    source_version,
                    source_checksum,
                    metadata
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                RETURNING id
                """,
                (
                    "nflverse-data",
                    RELEASE_TAG,
                    RELEASE_PAGE_URL,
                    f"{RELEASE_TAG}_{source_version}.csv",
                    source_version,
                    checksum,
                    metadata,
                ),
            )
            return cursor.fetchone()[0]

    def _complete_batch(self, batch_id, row_count, processed_rows, status, error):
        metadata_patch = {
            "status": status,
            "processed_rows": processed_rows,
            "finished_at": datetime.now(tz=UTC).isoformat(),
            "error": error or "",
        }
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                """
                UPDATE raw.raw_ingest_batch
                SET row_count = %s,
                    metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
                WHERE id = %s
                """,
                (row_count, json.dumps(metadata_patch), batch_id),
            )

    def _delete_existing_rows(self, seasons):
        if self.dry_run:
            return 0
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                "DELETE FROM raw.raw_nflverse_depth_charts WHERE season = ANY(%s)",
                [seasons],
            )
            return cursor.rowcount

    def _insert_rows(self, rows, batch_id):
        inserted = 0
        chunk = []
        for row in rows:
            chunk.append(
                (
                    batch_id,
                    row["season"],
                    row["week"],
                    row["team"] or None,
                    row["player_id"],
                    row["player_name"],
                    row["position"],
                    row["depth_rank"],
                    row["payload"],
                )
            )
            if len(chunk) >= self.batch_size:
                inserted += self._flush_chunk(chunk)
                chunk = []
        if chunk:
            inserted += self._flush_chunk(chunk)
        return inserted

    def _flush_chunk(self, chunk):
        if self.dry_run:
            return len(chunk)
        with self.get_nfl_cursor() as cursor:
            cursor.executemany(INSERT_SQL, chunk)
        return len(chunk)

    def _canonical_team(self, team_abbr):
        abbr = self.safe_str(team_abbr, default="").upper()
        if not abbr:
            return ""
        return TEAM_ABBR_MAP.get(abbr, abbr)

    def _normalize_payload(self, row):
        payload = {}
        for key, value in row.items():
            if value is None:
                payload[key] = None
                continue
            stripped = str(value).strip()
            payload[key] = stripped if stripped else None
        return payload
