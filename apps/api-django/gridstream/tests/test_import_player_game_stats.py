import csv
import gzip
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
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_player_stats (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                season INTEGER,
                week INTEGER,
                game_id TEXT,
                player_id TEXT,
                player_name TEXT,
                team TEXT,
                opponent TEXT,
                position TEXT,
                payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_pbp (
                id BIGSERIAL PRIMARY KEY,
                game_id TEXT NOT NULL,
                play_id TEXT NOT NULL,
                season INTEGER,
                week INTEGER,
                posteam TEXT,
                defteam TEXT,
                payload JSONB NOT NULL
            )
            """)


def _reset_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_nflverse_player_stats")
        cursor.execute("DELETE FROM raw.raw_ingest_batch")
        cursor.execute("DELETE FROM raw.raw_nflverse_pbp")


def _build_gz_csv(rows):
    fieldnames = [
        "player_id",
        "player_name",
        "player_display_name",
        "position",
        "season",
        "week",
        "season_type",
        "team",
        "opponent_team",
        "passing_yards",
        "fantasy_points",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return gzip.compress(buf.getvalue().encode("utf-8"))


@pytest.mark.django_db(databases=["nfl"])
def test_import_player_game_stats_ingests_raw_rows_and_metadata():
    _ensure_raw_tables()
    _reset_raw_tables()

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            INSERT INTO raw.raw_nflverse_player_stats (
                season, week, player_id, payload
            ) VALUES (2024, 1, 'old-row', '{}'::jsonb)
            """)
        cursor.execute("""
            INSERT INTO raw.raw_nflverse_pbp (
                game_id, play_id, season, week, posteam, defteam, payload
            ) VALUES
            ('2024_01_NYJ_SF', '100', 2024, 1, 'NYJ', 'SF', '{"season_type":"REG"}'::jsonb),
            ('2024_01_NYJ_SF', '101', 2024, 1, 'SF', 'NYJ', '{"season_type":"REG"}'::jsonb)
            """)

    content = _build_gz_csv(
        [
            {
                "player_id": "00-0023459",
                "player_name": "A.Rodgers",
                "player_display_name": "Aaron Rodgers",
                "position": "QB",
                "season": "2024",
                "week": "1",
                "season_type": "REG",
                "team": "NYJ",
                "opponent_team": "SF",
                "passing_yards": "167",
                "fantasy_points": "8.58",
            },
            {
                "player_id": "00-0039163",
                "player_name": "B.Purdy",
                "player_display_name": "Brock Purdy",
                "position": "QB",
                "season": "2024",
                "week": "1",
                "season_type": "REG",
                "team": "SF",
                "opponent_team": "NYJ",
                "passing_yards": "231",
                "fantasy_points": "17.24",
            },
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = content
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_player_game_stats.requests.get",
        return_value=response,
    ) as mock_get:
        call_command(
            "import_player_game_stats",
            season=[2024],
            batch_size=1,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    called_url = mock_get.call_args.args[0]
    assert called_url.endswith("/stats_player_week_2024.csv.gz")

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            SELECT player_id, game_id, team, opponent, payload->>'passing_yards'
            FROM raw.raw_nflverse_player_stats
            WHERE season = 2024
            ORDER BY player_id
            """)
        rows = cursor.fetchall()
        assert len(rows) == 2
        assert rows[0] == ("00-0023459", "2024_01_NYJ_SF", "NYJ", "SF", "167")
        assert rows[1] == ("00-0039163", "2024_01_NYJ_SF", "SF", "NYJ", "231")

        cursor.execute("""
            SELECT dataset_name, source_version, row_count, metadata->>'status'
            FROM raw.raw_ingest_batch
            ORDER BY id DESC
            LIMIT 1
            """)
        batch = cursor.fetchone()
        assert batch == ("player_stats", "2024", 2, "ok")

        cursor.execute(
            "SELECT COUNT(*) FROM raw.raw_nflverse_player_stats WHERE player_id = 'old-row'"
        )
        old_count = cursor.fetchone()[0]
        assert old_count == 0


@pytest.mark.django_db(databases=["nfl"])
def test_import_player_game_stats_dry_run_writes_nothing():
    _ensure_raw_tables()
    _reset_raw_tables()

    content = _build_gz_csv(
        [
            {
                "player_id": "00-0023459",
                "player_name": "A.Rodgers",
                "player_display_name": "Aaron Rodgers",
                "position": "QB",
                "season": "2024",
                "week": "1",
                "season_type": "REG",
                "team": "NYJ",
                "opponent_team": "SF",
                "passing_yards": "167",
                "fantasy_points": "8.58",
            }
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = content
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_player_game_stats.requests.get",
        return_value=response,
    ):
        call_command(
            "import_player_game_stats",
            season=[2024],
            dry_run=True,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM raw.raw_nflverse_player_stats")
        stats_count = cursor.fetchone()[0]
        assert stats_count == 0

        cursor.execute("SELECT COUNT(*) FROM raw.raw_ingest_batch")
        batch_count = cursor.fetchone()[0]
        assert batch_count == 0
