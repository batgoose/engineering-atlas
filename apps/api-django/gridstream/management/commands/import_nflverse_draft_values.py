"""
Import nfldata draft values into raw.raw_nflverse_draft_values.

Source dataset:
    https://raw.githubusercontent.com/nflverse/nfldata/master/data/draft_values.csv

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

SOURCE_URL = (
    "https://raw.githubusercontent.com/nflverse/nfldata/master/data/draft_values.csv"
)
SOURCE_FILE = "draft_values.csv"
INSERT_SQL = """
    INSERT INTO raw.raw_nflverse_draft_values (
        batch_id,
        pick,
        stuart,
        johnson,
        hill,
        otc,
        pff,
        payload
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
"""


class Command(ImportBaseCommand):
    help = "Import nfldata draft values into raw.raw_nflverse_draft_values."

    def handle(self, *args, **options):
        self.batch_size = max(1, options["batch_size"])
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        if requested:
            self.stdout.write(
                self.style.WARNING(
                    "Season filters are ignored for draft_values.csv "
                    "(dataset is season-agnostic)."
                )
            )

        self._ensure_required_tables()

        with self.timed_operation(f"Downloading {SOURCE_FILE}"):
            content, checksum = self._download_source()

        rows = self._parse_rows(content)
        self.stdout.write(f"Importing draft values ({len(rows):,} rows)")

        batch_id = None
        if not self.dry_run:
            batch_id = self._begin_batch(checksum=checksum)

        try:
            with transaction.atomic(using="nfl"):
                deleted = self._delete_existing_rows()
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
            self.style.SUCCESS(f"Done! {inserted:,} inserted, {deleted:,} deleted.")
        )

    def _ensure_required_tables(self):
        with self.get_nfl_cursor() as cursor:
            cursor.execute("""
                SELECT
                    to_regclass('raw.raw_nflverse_draft_values'),
                    to_regclass('raw.raw_ingest_batch')
                """)
            draft_values_table, ingest_batch_table = cursor.fetchone()

        if not draft_values_table:
            raise CommandError(
                "Missing table raw.raw_nflverse_draft_values. Run migrations first."
            )
        if not ingest_batch_table:
            raise CommandError(
                "Missing table raw.raw_ingest_batch. Run migrations first."
            )

    def _download_source(self):
        response = requests.get(
            SOURCE_URL,
            timeout=180,
            headers={"User-Agent": "engineering-atlas/import_nflverse_draft_values"},
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
            pick = self.safe_int(row.get("pick"))
            if pick is None:
                continue

            normalized = self._normalize_payload(row)
            rows.append(
                {
                    "pick": pick,
                    "stuart": self.safe_float(row.get("stuart")),
                    "johnson": self.safe_float(row.get("johnson")),
                    "hill": self.safe_float(row.get("hill")),
                    "otc": self.safe_float(row.get("otc")),
                    "pff": self.safe_float(row.get("pff")),
                    "payload": json.dumps(normalized),
                }
            )
        rows.sort(key=lambda r: r["pick"])
        return rows

    def _begin_batch(self, checksum):
        metadata = json.dumps(
            {
                "status": "started",
                "ingest_tool": "django.import_nflverse_draft_values",
                "target_table": "raw.raw_nflverse_draft_values",
            }
        )
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
                    "draft_values",
                    SOURCE_URL,
                    SOURCE_FILE,
                    "all",
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

    def _delete_existing_rows(self):
        if self.dry_run:
            return 0
        with self.get_nfl_cursor() as cursor:
            cursor.execute("DELETE FROM raw.raw_nflverse_draft_values")
            return cursor.rowcount

    def _insert_rows(self, rows, batch_id):
        inserted = 0
        chunk = []

        for row in rows:
            chunk.append(
                (
                    batch_id,
                    row["pick"],
                    row["stuart"],
                    row["johnson"],
                    row["hill"],
                    row["otc"],
                    row["pff"],
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

    def _normalize_payload(self, row):
        payload = {}
        for key, value in row.items():
            if value is None:
                payload[key] = None
                continue
            stripped = str(value).strip()
            payload[key] = stripped if stripped else None
        return payload
