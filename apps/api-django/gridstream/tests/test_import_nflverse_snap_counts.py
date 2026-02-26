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
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_snap_counts (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                season INTEGER,
                week INTEGER,
                game_id TEXT,
                team TEXT,
                player_id TEXT,
                player_name TEXT,
                offense_snaps INTEGER,
                defense_snaps INTEGER,
                special_snaps INTEGER,
                payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """)


def _reset_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_nflverse_snap_counts")
        cursor.execute("DELETE FROM raw.raw_ingest_batch")


def _build_csv(rows):
    fieldnames = [
        "game_id",
        "pfr_game_id",
        "season",
        "game_type",
        "week",
        "player",
        "pfr_player_id",
        "position",
        "team",
        "opponent",
        "offense_snaps",
        "offense_pct",
        "defense_snaps",
        "defense_pct",
        "st_snaps",
        "st_pct",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _release_payload():
    return {
        "assets": [
            {
                "name": "snap_counts_2024.csv",
                "browser_download_url": "https://example.test/snap_counts_2024.csv",
            },
            {
                "name": "snap_counts_2023.csv",
                "browser_download_url": "https://example.test/snap_counts_2023.csv",
            },
        ]
    }


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_snap_counts_ingests_rows_and_metadata():
    _ensure_raw_tables()
    _reset_raw_tables()

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            INSERT INTO raw.raw_nflverse_snap_counts (
                season, game_id, team, payload
            ) VALUES (2024, 'old_game', 'OLD', '{}'::jsonb)
            """)

    csv_2024 = _build_csv(
        [
            {
                "game_id": "2024_01_BUF_ARI",
                "pfr_game_id": "202409080buf",
                "season": "2024",
                "game_type": "REG",
                "week": "1",
                "player": "Spencer Brown",
                "pfr_player_id": "BrowSp00",
                "position": "T",
                "team": "BUF",
                "opponent": "ARI",
                "offense_snaps": "62",
                "offense_pct": "1.0",
                "defense_snaps": "0",
                "defense_pct": "0.0",
                "st_snaps": "6",
                "st_pct": "0.22",
            },
            {
                "game_id": "2024_01_KC_LV",
                "pfr_game_id": "202409080kan",
                "season": "2024",
                "game_type": "REG",
                "week": "1",
                "player": "John Smith",
                "pfr_player_id": "SmitJo00",
                "position": "WR",
                "team": "OAK",
                "opponent": "KC",
                "offense_snaps": "24",
                "offense_pct": "0.41",
                "defense_snaps": "0",
                "defense_pct": "0.0",
                "st_snaps": "0",
                "st_pct": "0.0",
            },
        ]
    )
    csv_2023 = _build_csv(
        [
            {
                "game_id": "2023_01_NYJ_BUF",
                "pfr_game_id": "202309100buf",
                "season": "2023",
                "game_type": "REG",
                "week": "1",
                "player": "Jane Doe",
                "pfr_player_id": "DoeJa00",
                "position": "CB",
                "team": "NYJ",
                "opponent": "BUF",
                "offense_snaps": "0",
                "offense_pct": "0",
                "defense_snaps": "45",
                "defense_pct": "0.72",
                "st_snaps": "8",
                "st_pct": "0.25",
            }
        ]
    )

    def fake_get(url, *args, **kwargs):
        if (
            "api.github.com/repos/nflverse/nflverse-data/releases/tags/snap_counts"
            in url
        ):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.json.return_value = _release_payload()
            return resp
        if url.endswith("snap_counts_2024.csv"):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.content = csv_2024
            return resp
        if url.endswith("snap_counts_2023.csv"):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.content = csv_2023
            return resp
        raise AssertionError(f"Unexpected URL: {url}")

    with patch(
        "gridstream.management.commands.import_nflverse_snap_counts.requests.get",
        side_effect=fake_get,
    ):
        call_command(
            "import_nflverse_snap_counts",
            season=[2024],
            batch_size=1,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            SELECT season, week, game_id, team, player_id, player_name,
                   offense_snaps, defense_snaps, special_snaps
            FROM raw.raw_nflverse_snap_counts
            ORDER BY game_id
            """)
        rows = cursor.fetchall()
        assert len(rows) == 2
        assert rows[0] == (
            2024,
            1,
            "2024_01_BUF_ARI",
            "BUF",
            "BrowSp00",
            "Spencer Brown",
            62,
            0,
            6,
        )
        assert rows[1] == (
            2024,
            1,
            "2024_01_KC_LV",
            "LV",
            "SmitJo00",
            "John Smith",
            24,
            0,
            0,
        )

        cursor.execute("""
            SELECT dataset_name, source_version, row_count, metadata->>'status'
            FROM raw.raw_ingest_batch
            ORDER BY id DESC
            LIMIT 1
            """)
        batch = cursor.fetchone()
        assert batch == ("snap_counts", "2024-2024", 2, "ok")

        cursor.execute(
            "SELECT COUNT(*) FROM raw.raw_nflverse_snap_counts WHERE team = 'OLD'"
        )
        old_count = cursor.fetchone()[0]
        assert old_count == 0


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_snap_counts_dry_run_writes_nothing():
    _ensure_raw_tables()
    _reset_raw_tables()

    csv_2024 = _build_csv(
        [
            {
                "game_id": "2024_01_BUF_ARI",
                "pfr_game_id": "202409080buf",
                "season": "2024",
                "game_type": "REG",
                "week": "1",
                "player": "Spencer Brown",
                "pfr_player_id": "BrowSp00",
                "position": "T",
                "team": "BUF",
                "opponent": "ARI",
                "offense_snaps": "62",
                "offense_pct": "1.0",
                "defense_snaps": "0",
                "defense_pct": "0.0",
                "st_snaps": "6",
                "st_pct": "0.22",
            }
        ]
    )

    def fake_get(url, *args, **kwargs):
        if (
            "api.github.com/repos/nflverse/nflverse-data/releases/tags/snap_counts"
            in url
        ):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.json.return_value = _release_payload()
            return resp
        if url.endswith("snap_counts_2024.csv"):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.content = csv_2024
            return resp
        raise AssertionError(f"Unexpected URL: {url}")

    with patch(
        "gridstream.management.commands.import_nflverse_snap_counts.requests.get",
        side_effect=fake_get,
    ):
        call_command(
            "import_nflverse_snap_counts",
            season=[2024],
            dry_run=True,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM raw.raw_nflverse_snap_counts")
        snap_count = cursor.fetchone()[0]
        assert snap_count == 0

        cursor.execute("SELECT COUNT(*) FROM raw.raw_ingest_batch")
        batch_count = cursor.fetchone()[0]
        assert batch_count == 0
