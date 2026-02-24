"""
Import nfldata trades into raw.raw_nflverse_trades.

Source dataset:
    https://raw.githubusercontent.com/nflverse/nfldata/master/data/trades.csv

This command writes source-faithful rows into the raw schema and records one
metadata row per run in raw.raw_ingest_batch.
"""

import csv
import hashlib
import io
import json
from datetime import UTC, datetime

import requests
from django.core.management.base import CommandError
from django.db import transaction

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}
SOURCE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/trades.csv"
SOURCE_FILE = "trades.csv"
INSERT_SQL = """
    INSERT INTO raw.raw_nflverse_trades (
        batch_id,
        season,
        week,
        transaction_id,
        team,
        player_id,
        player_name,
        payload
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
"""


class Command(ImportBaseCommand):
    help = "Import nfldata trades into raw.raw_nflverse_trades."

    def handle(self, *args, **options):
        self.batch_size = max(1, options["batch_size"])
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        self._ensure_required_tables()

        with self.timed_operation(f"Downloading {SOURCE_FILE}"):
            content, checksum = self._download_source()
        all_rows = self._parse_rows(content)
        seasons_in_file = sorted({r["season"] for r in all_rows if r.get("season")})
        target_seasons = self._resolve_target_seasons(requested, seasons_in_file)

        if not target_seasons:
            self.stdout.write(
                self.style.WARNING("No seasons selected; nothing to import.")
            )
            return

        target_set = set(target_seasons)
        rows = [r for r in all_rows if r.get("season") in target_set]

        self.stdout.write(
            f"Importing trades for {len(target_seasons)} seasons: "
            f"{target_seasons[0]}-{target_seasons[-1]} "
            f"({len(rows):,} rows)"
        )

        batch_id = None
        if not self.dry_run:
            batch_id = self._begin_batch(
                seasons=target_seasons,
                checksum=checksum,
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
                    to_regclass('raw.raw_nflverse_trades'),
                    to_regclass('raw.raw_ingest_batch')
                """)
            trades_table, ingest_batch_table = cursor.fetchone()

        if not trades_table:
            raise CommandError(
                "Missing table raw.raw_nflverse_trades. Run migrations first."
            )
        if not ingest_batch_table:
            raise CommandError(
                "Missing table raw.raw_ingest_batch. Run migrations first."
            )

    def _download_source(self):
        response = requests.get(
            SOURCE_URL,
            timeout=180,
            headers={"User-Agent": "engineering-atlas/import_nflverse_trades"},
        )
        response.raise_for_status()
        content = response.content
        checksum = hashlib.sha256(content).hexdigest()
        return content, checksum

    def _parse_rows(self, content):
        text = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        rows = []

        for row in reader:
            season = self.safe_int(row.get("season"))
            if season is None:
                continue

            normalized = self._normalize_payload(row)
            rows.append(
                {
                    "season": season,
                    "week": None,
                    "transaction_id": self.safe_str(row.get("trade_id"), default="")
                    or None,
                    "team": self._canonical_team(row.get("gave")),
                    "player_id": self.safe_str(row.get("pfr_id"), default="") or None,
                    "player_name": self.safe_str(row.get("pfr_name"), default="")
                    or None,
                    "payload": json.dumps(normalized),
                }
            )

        rows.sort(
            key=lambda r: (
                r["season"] if r["season"] is not None else -1,
                r["transaction_id"] or "",
                r["team"] or "",
                r["player_name"] or "",
            )
        )
        return rows

    def _resolve_target_seasons(self, requested, seasons_in_file):
        if requested:
            requested_set = {int(s) for s in requested}
            available_set = set(seasons_in_file)
            missing = sorted(requested_set - available_set)
            if missing:
                self.stdout.write(
                    self.style.WARNING(
                        f"Requested seasons not in trades.csv: {missing}"
                    )
                )
            return sorted(requested_set & available_set)
        return seasons_in_file

    def _begin_batch(self, seasons, checksum):
        metadata = json.dumps(
            {
                "status": "started",
                "ingest_tool": "django.import_nflverse_trades",
                "target_table": "raw.raw_nflverse_trades",
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
                    "nfldata",
                    "trades",
                    SOURCE_URL,
                    SOURCE_FILE,
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
                "DELETE FROM raw.raw_nflverse_trades WHERE season = ANY(%s)",
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
                    row["transaction_id"],
                    row["team"] or None,
                    row["player_id"],
                    row["player_name"],
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
