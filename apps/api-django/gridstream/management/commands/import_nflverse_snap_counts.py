"""
Import nflverse-data snap counts into raw.raw_nflverse_snap_counts.

Source release:
    https://github.com/nflverse/nflverse-data/releases/tag/snap_counts

For each requested season, this command downloads snap_counts_{season}.csv
or snap_counts_{season}.csv.gz from the release assets and writes source-faithful
rows into raw.raw_nflverse_snap_counts.
"""

import csv
import gzip
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
RELEASE_TAG = "snap_counts"
RELEASE_API_URL = (
    f"https://api.github.com/repos/nflverse/nflverse-data/releases/tags/{RELEASE_TAG}"
)
RELEASE_PAGE_URL = (
    f"https://github.com/nflverse/nflverse-data/releases/tag/{RELEASE_TAG}"
)
ASSET_RE = re.compile(r"^snap_counts_(\d{4})\.csv(?:\.gz)?$")
INSERT_SQL = """
    INSERT INTO raw.raw_nflverse_snap_counts (
        batch_id,
        season,
        week,
        game_id,
        team,
        player_id,
        player_name,
        offense_snaps,
        defense_snaps,
        special_snaps,
        payload
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
"""


class Command(ImportBaseCommand):
    help = "Import nflverse-data snap counts into raw.raw_nflverse_snap_counts."

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
            asset_bundle = season_asset_map.get(season, {})
            candidates = [
                asset_bundle.get("csv_gz"),
                asset_bundle.get("csv"),
            ]
            season_rows = None
            for asset in candidates:
                if not asset:
                    continue
                try:
                    with self.timed_operation(f"Downloading {asset['name']}"):
                        content, checksum = self._download_asset(asset["url"])
                    parsed_rows = self._parse_rows(content)
                except Exception as exc:
                    self.stdout.write(
                        self.style.WARNING(
                            f"Failed {asset['name']} ({exc}); trying alternate asset."
                        )
                    )
                    continue
                checksum_seed.update(f"{season}:{checksum}".encode("utf-8"))
                season_rows = parsed_rows
                break

            if season_rows is None:
                raise CommandError(
                    f"Could not download/parse snap counts for season {season} "
                    "(csv.gz and csv attempts failed)."
                )

            rows.extend(season_rows)

        if not rows:
            self.stdout.write(
                self.style.WARNING("No rows parsed from selected snap count assets.")
            )
            return

        rows.sort(
            key=lambda row: (
                row["season"] if row["season"] is not None else -1,
                row["week"] if row["week"] is not None else -1,
                row["game_id"] or "",
                row["team"] or "",
                row["player_name"] or "",
            )
        )

        self.stdout.write(
            f"Importing snap counts for {len(target_seasons)} seasons: "
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
                    to_regclass('raw.raw_nflverse_snap_counts'),
                    to_regclass('raw.raw_ingest_batch')
                """)
            snap_counts_table, ingest_batch_table = cursor.fetchone()

        if not snap_counts_table:
            raise CommandError(
                "Missing table raw.raw_nflverse_snap_counts. Run migrations first."
            )
        if not ingest_batch_table:
            raise CommandError(
                "Missing table raw.raw_ingest_batch. Run migrations first."
            )

    def _fetch_release_assets(self):
        response = requests.get(
            RELEASE_API_URL,
            timeout=120,
            headers={"User-Agent": "engineering-atlas/import_nflverse_snap_counts"},
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
            entry = season_assets.setdefault(season, {})
            key = "csv_gz" if name.endswith(".gz") else "csv"
            entry[key] = {"name": name, "url": download_url}
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
            headers={"User-Agent": "engineering-atlas/import_nflverse_snap_counts"},
        )
        response.raise_for_status()
        content = response.content
        checksum = hashlib.sha256(content).hexdigest()
        return content, checksum

    def _parse_rows(self, content):
        if content[:2] == b"\x1f\x8b":
            decoded = gzip.decompress(content).decode("utf-8-sig")
        else:
            decoded = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(decoded))
        rows = []
        for row in reader:
            season = self.safe_int(row.get("season"))
            game_id = self.safe_str(row.get("game_id"), default="")
            if season is None or not game_id:
                continue
            normalized = self._normalize_payload(row)
            rows.append(
                {
                    "season": season,
                    "week": self.safe_int(row.get("week")),
                    "game_id": game_id,
                    "team": self._canonical_team(row.get("team")),
                    "player_id": self.safe_str(row.get("pfr_player_id"), default="")
                    or None,
                    "player_name": self.safe_str(row.get("player"), default="") or None,
                    "offense_snaps": self.safe_int(row.get("offense_snaps"), 0),
                    "defense_snaps": self.safe_int(row.get("defense_snaps"), 0),
                    "special_snaps": self.safe_int(row.get("st_snaps"), 0),
                    "payload": json.dumps(normalized),
                }
            )
        return rows

    def _begin_batch(self, seasons, checksum):
        metadata = json.dumps(
            {
                "status": "started",
                "ingest_tool": "django.import_nflverse_snap_counts",
                "target_table": "raw.raw_nflverse_snap_counts",
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
                "DELETE FROM raw.raw_nflverse_snap_counts WHERE season = ANY(%s)",
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
                    row["game_id"],
                    row["team"] or None,
                    row["player_id"],
                    row["player_name"],
                    row["offense_snaps"],
                    row["defense_snaps"],
                    row["special_snaps"],
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
