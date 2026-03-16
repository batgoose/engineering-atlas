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
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_depth_charts (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                season INTEGER,
                week INTEGER,
                team TEXT,
                player_id TEXT,
                player_name TEXT,
                position TEXT,
                depth_rank INTEGER,
                payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """)


def _reset_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_nflverse_depth_charts")
        cursor.execute("DELETE FROM raw.raw_ingest_batch")


def _build_csv(rows):
    fieldnames = [
        "season",
        "club_code",
        "week",
        "game_type",
        "depth_team",
        "last_name",
        "first_name",
        "football_name",
        "formation",
        "gsis_id",
        "jersey_number",
        "position",
        "elias_id",
        "depth_position",
        "full_name",
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
                "name": "depth_charts_2024.csv",
                "browser_download_url": "https://example.test/depth_charts_2024.csv",
            },
            {
                "name": "depth_charts_2023.csv",
                "browser_download_url": "https://example.test/depth_charts_2023.csv",
            },
        ]
    }


def _build_modern_csv(rows):
    fieldnames = [
        "dt",
        "team",
        "player_name",
        "espn_id",
        "gsis_id",
        "pos_grp_id",
        "pos_grp",
        "pos_id",
        "pos_name",
        "pos_abb",
        "pos_slot",
        "pos_rank",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_depth_charts_ingests_rows_and_metadata():
    _ensure_raw_tables()
    _reset_raw_tables()

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            INSERT INTO raw.raw_nflverse_depth_charts (
                season, team, payload
            ) VALUES (2024, 'OLD', '{}'::jsonb)
            """)

    csv_2024 = _build_csv(
        [
            {
                "season": "2024",
                "club_code": "NE",
                "week": "1",
                "game_type": "REG",
                "depth_team": "1",
                "last_name": "Maye",
                "first_name": "Drake",
                "football_name": "Drake",
                "formation": "Offense",
                "gsis_id": "00-0039981",
                "jersey_number": "10",
                "position": "QB",
                "elias_id": "MAY123",
                "depth_position": "QB",
                "full_name": "Drake Maye",
            },
            {
                "season": "2024",
                "club_code": "OAK",
                "week": "1",
                "game_type": "REG",
                "depth_team": "3",
                "last_name": "Carlson",
                "first_name": "Daniel",
                "football_name": "Daniel",
                "formation": "Special Teams",
                "gsis_id": "00-0034787",
                "jersey_number": "2",
                "position": "K",
                "elias_id": "CAR987",
                "depth_position": "K",
                "full_name": "Daniel Carlson",
            },
        ]
    )
    csv_2023 = _build_csv(
        [
            {
                "season": "2023",
                "club_code": "BUF",
                "week": "1",
                "game_type": "REG",
                "depth_team": "1",
                "last_name": "Allen",
                "first_name": "Josh",
                "football_name": "Josh",
                "formation": "Offense",
                "gsis_id": "00-0034857",
                "jersey_number": "17",
                "position": "QB",
                "elias_id": "ALL001",
                "depth_position": "QB",
                "full_name": "Josh Allen",
            }
        ]
    )

    def fake_get(url, *args, **kwargs):
        if (
            "api.github.com/repos/nflverse/nflverse-data/releases/tags/depth_charts"
            in url
        ):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.json.return_value = _release_payload()
            return resp
        if url.endswith("depth_charts_2024.csv"):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.content = csv_2024
            return resp
        if url.endswith("depth_charts_2023.csv"):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.content = csv_2023
            return resp
        raise AssertionError(f"Unexpected URL: {url}")

    with patch(
        "gridstream.management.commands.import_nflverse_depth_charts.requests.get",
        side_effect=fake_get,
    ):
        call_command(
            "import_nflverse_depth_charts",
            season=[2024],
            batch_size=1,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            SELECT season, week, team, player_id, player_name, position, depth_rank
            FROM raw.raw_nflverse_depth_charts
            ORDER BY player_name
            """)
        rows = cursor.fetchall()
        assert len(rows) == 2
        assert rows[0] == (2024, 1, "LV", "00-0034787", "Daniel Carlson", "K", 3)
        assert rows[1] == (2024, 1, "NE", "00-0039981", "Drake Maye", "QB", 1)

        cursor.execute("""
            SELECT dataset_name, source_version, row_count, metadata->>'status'
            FROM raw.raw_ingest_batch
            ORDER BY id DESC
            LIMIT 1
            """)
        batch = cursor.fetchone()
        assert batch == ("depth_charts", "2024-2024", 2, "ok")

        cursor.execute(
            "SELECT COUNT(*) FROM raw.raw_nflverse_depth_charts WHERE team = 'OLD'"
        )
        old_count = cursor.fetchone()[0]
        assert old_count == 0


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_depth_charts_dry_run_writes_nothing():
    _ensure_raw_tables()
    _reset_raw_tables()

    csv_2024 = _build_csv(
        [
            {
                "season": "2024",
                "club_code": "NE",
                "week": "1",
                "game_type": "REG",
                "depth_team": "1",
                "last_name": "Maye",
                "first_name": "Drake",
                "football_name": "Drake",
                "formation": "Offense",
                "gsis_id": "00-0039981",
                "jersey_number": "10",
                "position": "QB",
                "elias_id": "MAY123",
                "depth_position": "QB",
                "full_name": "Drake Maye",
            }
        ]
    )

    def fake_get(url, *args, **kwargs):
        if (
            "api.github.com/repos/nflverse/nflverse-data/releases/tags/depth_charts"
            in url
        ):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.json.return_value = _release_payload()
            return resp
        if url.endswith("depth_charts_2024.csv"):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.content = csv_2024
            return resp
        raise AssertionError(f"Unexpected URL: {url}")

    with patch(
        "gridstream.management.commands.import_nflverse_depth_charts.requests.get",
        side_effect=fake_get,
    ):
        call_command(
            "import_nflverse_depth_charts",
            season=[2024],
            dry_run=True,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM raw.raw_nflverse_depth_charts")
        depth_count = cursor.fetchone()[0]
        assert depth_count == 0

        cursor.execute("SELECT COUNT(*) FROM raw.raw_ingest_batch")
        batch_count = cursor.fetchone()[0]
        assert batch_count == 0


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_depth_charts_supports_modern_schema_without_week():
    _ensure_raw_tables()
    _reset_raw_tables()

    csv_2025 = _build_modern_csv(
        [
            {
                "dt": "2026-02-25T07:49:28Z",
                "team": "ARI",
                "player_name": "Josh Sweat",
                "espn_id": "3693166",
                "gsis_id": "00-0034381",
                "pos_grp_id": "16",
                "pos_grp": "Base 4-3 D",
                "pos_id": "11",
                "pos_name": "Left Defensive End",
                "pos_abb": "LDE",
                "pos_slot": "1",
                "pos_rank": "1",
            },
            {
                "dt": "2026-02-25T07:49:28Z",
                "team": "OAK",
                "player_name": "Daniel Carlson",
                "espn_id": "3045147",
                "gsis_id": "00-0034787",
                "pos_grp_id": "5",
                "pos_grp": "Special Teams",
                "pos_id": "6",
                "pos_name": "Place Kicker",
                "pos_abb": "PK",
                "pos_slot": "1",
                "pos_rank": "2",
            },
        ]
    )

    release_payload = {
        "assets": [
            {
                "name": "depth_charts_2025.csv",
                "browser_download_url": "https://example.test/depth_charts_2025.csv",
            }
        ]
    }

    def fake_get(url, *args, **kwargs):
        if (
            "api.github.com/repos/nflverse/nflverse-data/releases/tags/depth_charts"
            in url
        ):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.json.return_value = release_payload
            return resp
        if url.endswith("depth_charts_2025.csv"):
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = Mock()
            resp.content = csv_2025
            return resp
        raise AssertionError(f"Unexpected URL: {url}")

    with patch(
        "gridstream.management.commands.import_nflverse_depth_charts.requests.get",
        side_effect=fake_get,
    ):
        call_command(
            "import_nflverse_depth_charts",
            season=[2025],
            batch_size=1,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            SELECT season, week, team, player_id, player_name, position, depth_rank
            FROM raw.raw_nflverse_depth_charts
            ORDER BY player_name
            """)
        rows = cursor.fetchall()
        assert rows == [
            (2025, None, "LV", "00-0034787", "Daniel Carlson", "PK", 2),
            (2025, None, "ARI", "00-0034381", "Josh Sweat", "LDE", 1),
        ]
