import json
from datetime import date
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connections

from gridstream.models import Game, Play, Season, Team, WinProbabilityPlay


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
            CREATE TABLE IF NOT EXISTS raw.raw_espn_summary (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                espn_event_id TEXT NOT NULL,
                season INTEGER,
                week INTEGER,
                season_type INTEGER,
                game_date TIMESTAMPTZ,
                summary_payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_espn_probabilities (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                espn_event_id TEXT NOT NULL,
                play_id TEXT,
                sequence INTEGER,
                seconds_left INTEGER,
                home_win_pct DOUBLE PRECISION,
                away_win_pct DOUBLE PRECISION,
                tie_pct DOUBLE PRECISION,
                probability_payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)


def _reset_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_espn_probabilities")
        cursor.execute("DELETE FROM raw.raw_espn_summary")
        cursor.execute("DELETE FROM raw.raw_ingest_batch")


@pytest.fixture
def seeded_game(db):
    season = Season.objects.using("nfl").create(
        year=2025,
        is_active=True,
        current_week=1,
    )
    sea = Team.objects.using("nfl").create(
        espn_id="26",
        abbreviation="SEA",
        slug="seattle-seahawks",
        location="Seattle",
        name="Seahawks",
        display_name="Seattle Seahawks",
        short_display_name="Seahawks",
        color_primary="002a5c",
        conference="NFC",
        division="NFC West",
    )
    ne = Team.objects.using("nfl").create(
        espn_id="17",
        abbreviation="NE",
        slug="new-england-patriots",
        location="New England",
        name="Patriots",
        display_name="New England Patriots",
        short_display_name="Patriots",
        color_primary="002a5c",
        conference="AFC",
        division="AFC East",
    )
    game = Game.objects.using("nfl").create(
        espn_event_id="401772988",
        season=season,
        week=1,
        game_date=date(2025, 9, 7),
        home_team=ne,
        away_team=sea,
    )
    Play.objects.using("nfl").create(
        game=game,
        sequence=11,
        espn_play_id="40177298801",
        quarter=1,
        clock="15:00",
    )
    Play.objects.using("nfl").create(
        game=game,
        sequence=12,
        espn_play_id="40177298802",
        quarter=1,
        clock="14:20",
    )
    return game


@pytest.mark.django_db(databases=["nfl"])
def test_import_espn_probabilities_ingests_rows_and_metadata(seeded_game):
    _ensure_raw_tables()
    _reset_raw_tables()

    old_payload = {
        "winprobability": [
            {
                "homeWinPercentage": 0.99,
                "tiePercentage": 0.0,
                "playId": "40177298899",
            }
        ]
    }
    new_payload = {
        "winprobability": [
            {
                "homeWinPercentage": 0.45,
                "tiePercentage": 0.0,
                "playId": "40177298801",
            },
            {
                "homeWinPercentage": 0.40,
                "tiePercentage": 0.0,
                "playId": "40177298802",
            },
        ]
    }

    with connections["nfl"].cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO raw.raw_espn_summary (
                espn_event_id, season, week, season_type, summary_payload, ingested_at
            ) VALUES (%s, %s, %s, %s, %s::jsonb, NOW() - INTERVAL '1 day')
            """,
            ("401772988", 2025, 1, 2, json.dumps(old_payload)),
        )
        cursor.execute(
            """
            INSERT INTO raw.raw_espn_summary (
                espn_event_id, season, week, season_type, summary_payload, ingested_at
            ) VALUES (%s, %s, %s, %s, %s::jsonb, NOW())
            """,
            ("401772988", 2025, 1, 2, json.dumps(new_payload)),
        )
        cursor.execute(
            """
            INSERT INTO raw.raw_espn_probabilities (
                espn_event_id, play_id, sequence, seconds_left, home_win_pct, away_win_pct, tie_pct, probability_payload
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                "401772988",
                "old",
                1,
                10,
                0.1,
                0.9,
                0.0,
                json.dumps({"old": True}),
            ),
        )

    call_command(
        "import_espn_probabilities",
        season=[2025],
        batch_size=1,
        stdout=StringIO(),
        stderr=StringIO(),
        verbosity=0,
    )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            SELECT play_id, sequence, seconds_left, home_win_pct, away_win_pct, tie_pct
            FROM raw.raw_espn_probabilities
            WHERE espn_event_id = '401772988'
            ORDER BY sequence
        """)
        rows = cursor.fetchall()
        assert len(rows) == 2
        assert rows[0] == ("40177298801", 11, 3600, 0.45, 0.55, 0.0)
        assert rows[1] == ("40177298802", 12, 3560, 0.4, 0.6, 0.0)

        cursor.execute("""
            SELECT dataset_name, source_version, row_count, metadata->>'status'
            FROM raw.raw_ingest_batch
            ORDER BY id DESC
            LIMIT 1
        """)
        batch = cursor.fetchone()
        assert batch == ("probabilities", "2025-2025", 2, "ok")

    model_rows = (
        WinProbabilityPlay.objects.using("nfl")
        .filter(game__espn_event_id="401772988")
        .order_by("sequence")
    )
    assert model_rows.count() == 2
    assert model_rows[0].home_win_pct == pytest.approx(0.45)
    assert model_rows[0].away_win_pct == pytest.approx(0.55)
    assert model_rows[0].source == "raw_espn_probabilities"
    assert model_rows[1].home_win_pct == pytest.approx(0.4)
    assert model_rows[1].away_win_pct == pytest.approx(0.6)

    play_1 = Play.objects.using("nfl").get(espn_play_id="40177298801")
    play_2 = Play.objects.using("nfl").get(espn_play_id="40177298802")
    assert play_1.home_wp == pytest.approx(0.45)
    assert play_1.away_wp == pytest.approx(0.55)
    assert play_2.home_wp == pytest.approx(0.4)
    assert play_2.away_wp == pytest.approx(0.6)


@pytest.mark.django_db(databases=["nfl"])
def test_import_espn_probabilities_dry_run_writes_nothing(seeded_game):
    _ensure_raw_tables()
    _reset_raw_tables()

    payload = {
        "winprobability": [
            {
                "homeWinPercentage": 0.45,
                "tiePercentage": 0.0,
                "playId": "40177298801",
            }
        ]
    }
    with connections["nfl"].cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO raw.raw_espn_summary (
                espn_event_id, season, week, season_type, summary_payload
            ) VALUES (%s, %s, %s, %s, %s::jsonb)
            """,
            ("401772988", 2025, 1, 2, json.dumps(payload)),
        )

    call_command(
        "import_espn_probabilities",
        season=[2025],
        dry_run=True,
        stdout=StringIO(),
        stderr=StringIO(),
        verbosity=0,
    )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM raw.raw_espn_probabilities")
        probs_count = cursor.fetchone()[0]
        assert probs_count == 0

        cursor.execute("SELECT COUNT(*) FROM raw.raw_ingest_batch")
        batch_count = cursor.fetchone()[0]
        assert batch_count == 0

    assert WinProbabilityPlay.objects.using("nfl").count() == 0
