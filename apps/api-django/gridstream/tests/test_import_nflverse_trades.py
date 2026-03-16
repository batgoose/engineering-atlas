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
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_trades (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                season INTEGER,
                week INTEGER,
                transaction_id TEXT,
                team TEXT,
                player_id TEXT,
                player_name TEXT,
                payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """)


def _reset_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_nflverse_trades")
        cursor.execute("DELETE FROM raw.raw_ingest_batch")


def _build_csv(rows):
    fieldnames = [
        "trade_id",
        "season",
        "trade_date",
        "gave",
        "received",
        "pick_season",
        "pick_round",
        "pick_number",
        "conditional",
        "pfr_id",
        "pfr_name",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_trades_ingests_rows_and_metadata():
    _ensure_raw_tables()
    _reset_raw_tables()

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            INSERT INTO raw.raw_nflverse_trades (season, transaction_id, team, payload)
            VALUES (2024, 'old_trade', 'OLD', '{}'::jsonb)
            """)

    content = _build_csv(
        [
            {
                "trade_id": "9001",
                "season": "2024",
                "trade_date": "2024-03-10",
                "gave": "OAK",
                "received": "KC",
                "pick_season": "",
                "pick_round": "",
                "pick_number": "",
                "conditional": "",
                "pfr_id": "SmitJo00",
                "pfr_name": "John Smith",
            },
            {
                "trade_id": "9001",
                "season": "2024",
                "trade_date": "2024-03-10",
                "gave": "KC",
                "received": "OAK",
                "pick_season": "2025",
                "pick_round": "3",
                "pick_number": "94",
                "conditional": "0",
                "pfr_id": "",
                "pfr_name": "",
            },
            {
                "trade_id": "8000",
                "season": "2023",
                "trade_date": "2023-03-10",
                "gave": "NYJ",
                "received": "GB",
                "pick_season": "",
                "pick_round": "",
                "pick_number": "",
                "conditional": "",
                "pfr_id": "DoeJa00",
                "pfr_name": "Jane Doe",
            },
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = content
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_nflverse_trades.requests.get",
        return_value=response,
    ):
        call_command(
            "import_nflverse_trades",
            season=[2024],
            batch_size=1,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            SELECT season, transaction_id, team, player_id, player_name
            FROM raw.raw_nflverse_trades
            ORDER BY transaction_id, team
            """)
        rows = cursor.fetchall()
        assert len(rows) == 2
        assert rows[0] == (2024, "9001", "KC", None, None)
        assert rows[1] == (2024, "9001", "LV", "SmitJo00", "John Smith")

        cursor.execute("""
            SELECT dataset_name, source_version, row_count, metadata->>'status'
            FROM raw.raw_ingest_batch
            ORDER BY id DESC
            LIMIT 1
            """)
        batch = cursor.fetchone()
        assert batch == ("trades", "2024-2024", 2, "ok")

        cursor.execute(
            "SELECT COUNT(*) FROM raw.raw_nflverse_trades WHERE team = 'OLD'"
        )
        old_count = cursor.fetchone()[0]
        assert old_count == 0


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_trades_dry_run_writes_nothing():
    _ensure_raw_tables()
    _reset_raw_tables()

    content = _build_csv(
        [
            {
                "trade_id": "9001",
                "season": "2024",
                "trade_date": "2024-03-10",
                "gave": "OAK",
                "received": "KC",
                "pick_season": "",
                "pick_round": "",
                "pick_number": "",
                "conditional": "",
                "pfr_id": "SmitJo00",
                "pfr_name": "John Smith",
            }
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = content
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_nflverse_trades.requests.get",
        return_value=response,
    ):
        call_command(
            "import_nflverse_trades",
            season=[2024],
            dry_run=True,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM raw.raw_nflverse_trades")
        trades_count = cursor.fetchone()[0]
        assert trades_count == 0

        cursor.execute("SELECT COUNT(*) FROM raw.raw_ingest_batch")
        batch_count = cursor.fetchone()[0]
        assert batch_count == 0
