import csv
import io
from io import StringIO
from unittest.mock import Mock, patch

import pytest
from django.core.management import call_command
from django.db import connections


def _ensure_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS raw")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_ingest_batch (
                id BIGSERIAL PRIMARY KEY,
                source_system TEXT NOT NULL,
                dataset_name TEXT NOT NULL,
                source_url TEXT,
                source_file TEXT,
                source_version TEXT,
                source_checksum TEXT,
                loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                row_count INTEGER NOT NULL DEFAULT 0,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb
            )
            """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_draft_values (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                pick INTEGER,
                stuart DOUBLE PRECISION,
                johnson DOUBLE PRECISION,
                hill DOUBLE PRECISION,
                otc DOUBLE PRECISION,
                pff DOUBLE PRECISION,
                payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """)


def _reset_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_nflverse_draft_values")
        cursor.execute("DELETE FROM raw.raw_ingest_batch")


def _build_csv(rows):
    fieldnames = ["pick", "stuart", "johnson", "hill", "otc", "pff"]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_draft_values_ingests_rows_and_metadata():
    _ensure_raw_tables()
    _reset_raw_tables()

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            INSERT INTO raw.raw_nflverse_draft_values (pick, payload)
            VALUES (999, '{}'::jsonb)
            """)

    content = _build_csv(
        [
            {
                "pick": "1",
                "stuart": "34.6",
                "johnson": "3000",
                "hill": "1000",
                "otc": "1462",
                "pff": "1000",
            },
            {
                "pick": "2",
                "stuart": "33.0",
                "johnson": "2600",
                "hill": "717",
                "otc": "1300",
                "pff": "950",
            },
            {
                "pick": "3",
                "stuart": "31.5",
                "johnson": "2200",
                "hill": "514",
                "otc": "1200",
                "pff": "900",
            },
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = content
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_nflverse_draft_values.requests.get",
        return_value=response,
    ):
        call_command(
            "import_nflverse_draft_values",
            batch_size=1,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            SELECT pick, stuart, johnson, hill, otc, pff
            FROM raw.raw_nflverse_draft_values
            ORDER BY pick
            """)
        rows = cursor.fetchall()
        assert len(rows) == 3
        assert rows[0] == (1, 34.6, 3000.0, 1000.0, 1462.0, 1000.0)
        assert rows[2] == (3, 31.5, 2200.0, 514.0, 1200.0, 900.0)

        cursor.execute("""
            SELECT dataset_name, source_version, row_count, metadata->>'status'
            FROM raw.raw_ingest_batch
            ORDER BY id DESC
            LIMIT 1
            """)
        batch = cursor.fetchone()
        assert batch == ("draft_values", "all", 3, "ok")

        cursor.execute(
            "SELECT COUNT(*) FROM raw.raw_nflverse_draft_values WHERE pick=999"
        )
        old_count = cursor.fetchone()[0]
        assert old_count == 0


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_draft_values_dry_run_writes_nothing():
    _ensure_raw_tables()
    _reset_raw_tables()

    content = _build_csv(
        [
            {
                "pick": "1",
                "stuart": "34.6",
                "johnson": "3000",
                "hill": "1000",
                "otc": "1462",
                "pff": "1000",
            }
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = content
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_nflverse_draft_values.requests.get",
        return_value=response,
    ):
        call_command(
            "import_nflverse_draft_values",
            dry_run=True,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM raw.raw_nflverse_draft_values")
        draft_values_count = cursor.fetchone()[0]
        assert draft_values_count == 0

        cursor.execute("SELECT COUNT(*) FROM raw.raw_ingest_batch")
        batch_count = cursor.fetchone()[0]
        assert batch_count == 0
