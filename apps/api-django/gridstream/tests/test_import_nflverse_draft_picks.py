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
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_draft_picks (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                season INTEGER,
                round INTEGER,
                pick_in_round INTEGER,
                overall_pick INTEGER,
                team TEXT,
                player_id TEXT,
                player_name TEXT,
                payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """)


def _reset_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_nflverse_draft_picks")
        cursor.execute("DELETE FROM raw.raw_ingest_batch")


def _build_csv(rows):
    fieldnames = [
        "season",
        "team",
        "round",
        "pick",
        "pfr_id",
        "pfr_name",
        "player_id",
        "side",
        "category",
        "position",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_draft_picks_ingests_rows_and_metadata():
    _ensure_raw_tables()
    _reset_raw_tables()

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            INSERT INTO raw.raw_nflverse_draft_picks (
                season, overall_pick, team, payload
            ) VALUES (2024, 999, 'OLD', '{}'::jsonb)
            """)

    content = _build_csv(
        [
            {
                "season": "2024",
                "team": "CHI",
                "round": "1",
                "pick": "1",
                "pfr_id": "WillCa00",
                "pfr_name": "Caleb Williams",
                "player_id": "00-0039963",
                "side": "O",
                "category": "QB",
                "position": "QB",
            },
            {
                "season": "2024",
                "team": "WAS",
                "round": "1",
                "pick": "2",
                "pfr_id": "DaniJa06",
                "pfr_name": "Jayden Daniels",
                "player_id": "00-0039163",
                "side": "O",
                "category": "QB",
                "position": "QB",
            },
            {
                "season": "2024",
                "team": "NE",
                "round": "2",
                "pick": "33",
                "pfr_id": "MayeDr00",
                "pfr_name": "Drake Maye",
                "player_id": "00-0039981",
                "side": "O",
                "category": "QB",
                "position": "QB",
            },
            {
                "season": "2023",
                "team": "CAR",
                "round": "1",
                "pick": "1",
                "pfr_id": "YounBr01",
                "pfr_name": "Bryce Young",
                "player_id": "00-0039152",
                "side": "O",
                "category": "QB",
                "position": "QB",
            },
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = content
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_nflverse_draft_picks.requests.get",
        return_value=response,
    ):
        call_command(
            "import_nflverse_draft_picks",
            season=[2024],
            batch_size=1,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            SELECT season, round, pick_in_round, overall_pick, team, player_name
            FROM raw.raw_nflverse_draft_picks
            ORDER BY overall_pick
            """)
        rows = cursor.fetchall()
        assert len(rows) == 3
        assert rows[0] == (2024, 1, 1, 1, "CHI", "Caleb Williams")
        assert rows[1] == (2024, 1, 2, 2, "WAS", "Jayden Daniels")
        assert rows[2] == (2024, 2, 1, 33, "NE", "Drake Maye")

        cursor.execute("""
            SELECT dataset_name, source_version, row_count, metadata->>'status'
            FROM raw.raw_ingest_batch
            ORDER BY id DESC
            LIMIT 1
            """)
        batch = cursor.fetchone()
        assert batch == ("draft_picks", "2024-2024", 3, "ok")

        cursor.execute(
            "SELECT COUNT(*) FROM raw.raw_nflverse_draft_picks WHERE team = 'OLD'"
        )
        old_count = cursor.fetchone()[0]
        assert old_count == 0


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_draft_picks_dry_run_writes_nothing():
    _ensure_raw_tables()
    _reset_raw_tables()

    content = _build_csv(
        [
            {
                "season": "2024",
                "team": "CHI",
                "round": "1",
                "pick": "1",
                "pfr_id": "WillCa00",
                "pfr_name": "Caleb Williams",
                "player_id": "00-0039963",
                "side": "O",
                "category": "QB",
                "position": "QB",
            }
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = content
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_nflverse_draft_picks.requests.get",
        return_value=response,
    ):
        call_command(
            "import_nflverse_draft_picks",
            season=[2024],
            dry_run=True,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM raw.raw_nflverse_draft_picks")
        draft_picks_count = cursor.fetchone()[0]
        assert draft_picks_count == 0

        cursor.execute("SELECT COUNT(*) FROM raw.raw_ingest_batch")
        batch_count = cursor.fetchone()[0]
        assert batch_count == 0
