import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connections


def _ensure_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS raw")
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
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS plays (
                game_id TEXT,
                play_id DOUBLE PRECISION,
                old_game_id TEXT,
                drive DOUBLE PRECISION,
                home_team TEXT,
                away_team TEXT,
                posteam TEXT,
                posteam_type TEXT,
                defteam TEXT,
                game_date DATE,
                season_type TEXT,
                week INTEGER,
                stadium TEXT,
                weather TEXT,
                surface TEXT,
                roof TEXT,
                qtr INTEGER,
                quarter_seconds_remaining REAL,
                half_seconds_remaining REAL,
                game_seconds_remaining REAL,
                down INTEGER,
                ydstogo INTEGER,
                yardline_100 INTEGER,
                side_of_field TEXT,
                shotgun INTEGER,
                no_huddle INTEGER,
                play_type TEXT,
                yards_gained REAL,
                air_yards REAL,
                yards_after_catch REAL,
                epa REAL,
                wpa REAL,
                success REAL,
                passer_player_id TEXT,
                passer_player_name TEXT,
                rusher_player_id TEXT,
                rusher_player_name TEXT,
                receiver_player_id TEXT,
                receiver_player_name TEXT,
                touchdown REAL,
                interception REAL,
                fumble REAL,
                sack REAL,
                complete_pass REAL,
                pass_touchdown REAL,
                rush_touchdown REAL,
                field_goal_result TEXT,
                kick_distance REAL,
                punt_blocked REAL,
                penalty REAL,
                penalty_type TEXT,
                penalty_yards REAL
            )
            """)


def _reset_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_nflverse_pbp")
        cursor.execute("DELETE FROM plays")


@pytest.mark.django_db(databases=["nfl"])
def test_materialize_plays_replaces_season_rows():
    _ensure_tables()
    _reset_tables()

    payload = {
        "play_id": "45",
        "drive": "3.0",
        "home_team": "KC",
        "away_team": "BAL",
        "posteam": "KC",
        "defteam": "BAL",
        "game_date": "2024-09-05",
        "season_type": "REG",
        "week": "1",
        "stadium": "GEHA Field at Arrowhead Stadium",
        "qtr": "1.0",
        "quarter_seconds_remaining": "900.0",
        "half_seconds_remaining": "1800.0",
        "game_seconds_remaining": "3600.0",
        "down": "1.0",
        "ydstogo": "10.0",
        "yardline_100": "75.0",
        "side_of_field": "KC",
        "shotgun": "1.0",
        "no_huddle": "0.0",
        "play_type": "pass",
        "yards_gained": "12.0",
        "epa": "0.4",
        "wpa": "0.02",
        "success": "1.0",
        "passer_player_id": "00-0033873",
        "passer_player_name": "P.Mahomes",
        "receiver_player_id": "00-0033875",
        "receiver_player_name": "T.Kelce",
        "touchdown": "0.0",
        "interception": "0.0",
        "fumble": "0.0",
        "sack": "0.0",
        "complete_pass": "1.0",
        "pass_touchdown": "0.0",
        "rush_touchdown": "0.0",
        "field_goal_result": "",
        "kick_distance": "",
        "punt_blocked": "0.0",
        "penalty": "0.0",
        "penalty_type": "",
        "penalty_yards": "",
    }

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            INSERT INTO plays (game_id, play_id, qtr)
            VALUES ('2024_01_OLD_OLD', 1, 1)
            """)
        cursor.execute(
            """
            INSERT INTO raw.raw_nflverse_pbp (
                game_id, play_id, season, week, posteam, defteam, payload
            ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            [
                "2024_01_KC_BAL",
                "45",
                2024,
                1,
                "KC",
                "BAL",
                json.dumps(payload),
            ],
        )

    call_command(
        "materialize_plays",
        season=[2024],
        stdout=StringIO(),
        stderr=StringIO(),
        verbosity=0,
    )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            SELECT game_id, play_id, qtr, ydstogo, play_type, passer_player_name
            FROM plays
            ORDER BY game_id, play_id
            """)
        rows = cursor.fetchall()

    assert rows == [("2024_01_KC_BAL", 45.0, 1, 10, "pass", "P.Mahomes")]
