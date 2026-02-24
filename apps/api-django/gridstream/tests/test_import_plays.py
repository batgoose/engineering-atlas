import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connections

from gridstream.models import Play


def _ensure_raw_pbp_table():
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


@pytest.mark.django_db(databases=["default", "nfl"])
def test_import_plays_maps_total_epa_fields_from_raw_payload(game_final, drive):
    _ensure_raw_pbp_table()

    with connections["nfl"].cursor() as cursor:
        cursor.execute(
            "DELETE FROM raw.raw_nflverse_pbp WHERE game_id = %s",
            [game_final.nflverse_game_id],
        )
        cursor.execute(
            """
            INSERT INTO raw.raw_nflverse_pbp (
                game_id, play_id, season, week, posteam, defteam, payload
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            [
                game_final.nflverse_game_id,
                "1001",
                game_final.season.year,
                game_final.week,
                "SEA",
                "WAS",
                json.dumps(
                    {
                        "play_id": "1001",
                        "drive": str(drive.drive_number),
                        "qtr": "1",
                        "quarter_seconds_remaining": "900",
                        "half_seconds_remaining": "1800",
                        "game_seconds_remaining": "3600",
                        "down": "1",
                        "ydstogo": "10",
                        "yardline_100": "75",
                        "side_of_field": "SEA",
                        "play_type": "pass",
                        "desc": "(15:00) Q.Back pass short right to W.Receiver to SEA 33 for 8 yards.",
                        "yards_gained": "8",
                        "complete_pass": "1",
                        "epa": "0.32",
                        "total_home_epa": "2.75",
                        "total_away_epa": "-1.40",
                    }
                ),
            ],
        )

    call_command(
        "import_plays",
        season=[game_final.season.year],
        batch_size=1000,
        stdout=StringIO(),
        stderr=StringIO(),
        verbosity=0,
    )

    play = (
        Play.objects.using("nfl")
        .filter(game=game_final, sequence=1001)
        .order_by("id")
        .first()
    )
    assert play is not None
    assert play.total_home_epa == pytest.approx(2.75)
    assert play.total_away_epa == pytest.approx(-1.40)
    assert play.epa == pytest.approx(0.32)
    assert (
        play.description
        == "(15:00) Q.Back pass short right to W.Receiver to SEA 33 for 8 yards."
    )
    assert play.short_description == play.description
