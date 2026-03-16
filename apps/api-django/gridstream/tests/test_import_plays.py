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
        cursor.execute(
            """
            INSERT INTO raw.raw_nflverse_pbp (
                game_id, play_id, season, week, posteam, defteam, payload
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            [
                game_final.nflverse_game_id,
                "1004",
                game_final.season.year,
                game_final.week,
                "SEA",
                "WAS",
                json.dumps(
                    {
                        "play_id": "1004",
                        "drive": str(drive.drive_number),
                        "qtr": "4",
                        "quarter_seconds_remaining": "0",
                        "play_type": "no_play",
                        "desc": "END GAME",
                        "total_home_score": str(game_final.home_score),
                        "total_away_score": str(game_final.away_score),
                    }
                ),
            ],
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
                "1007",
                game_final.season.year,
                game_final.week,
                "SEA",
                "WAS",
                json.dumps(
                    {
                        "play_id": "1007",
                        "drive": str(drive.drive_number),
                        "qtr": "4",
                        "quarter_seconds_remaining": "0",
                        "play_type": "no_play",
                        "desc": "END GAME",
                        "total_home_score": str(game_final.home_score),
                        "total_away_score": str(game_final.away_score),
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


@pytest.mark.django_db(databases=["default", "nfl"])
def test_import_plays_maps_home_away_scores_from_raw_payload(game_final, drive):
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
                "1002",
                game_final.season.year,
                game_final.week,
                "SEA",
                "WAS",
                json.dumps(
                    {
                        "play_id": "1002",
                        "drive": str(drive.drive_number),
                        "qtr": "2",
                        "quarter_seconds_remaining": "431",
                        "play_type": "run",
                        "desc": "(7:11) R.Runner right guard to WAS 24 for 6 yards.",
                        "yards_gained": "6",
                        "total_home_score": "14",
                        "total_away_score": "10",
                    }
                ),
            ],
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
                "1006",
                game_final.season.year,
                game_final.week,
                "SEA",
                "WAS",
                json.dumps(
                    {
                        "play_id": "1006",
                        "drive": str(drive.drive_number),
                        "qtr": "4",
                        "quarter_seconds_remaining": "0",
                        "play_type": "no_play",
                        "desc": "END GAME",
                        "total_home_score": str(game_final.home_score),
                        "total_away_score": str(game_final.away_score),
                    }
                ),
            ],
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
                "1003",
                game_final.season.year,
                game_final.week,
                "WAS",
                "SEA",
                json.dumps(
                    {
                        "play_id": "1003",
                        "drive": str(drive.drive_number),
                        "qtr": "2",
                        "quarter_seconds_remaining": "402",
                        "play_type": "pass",
                        "desc": "(6:42) Q.Pass short left to X.Receiver for 8 yards.",
                        "yards_gained": "8",
                        "posteam_score_post": "13",
                        "defteam_score_post": "14",
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

    play_from_totals = (
        Play.objects.using("nfl")
        .filter(game=game_final, sequence=1002)
        .order_by("id")
        .first()
    )
    assert play_from_totals is not None
    assert play_from_totals.home_score_after == 14
    assert play_from_totals.away_score_after == 10

    play_from_post_scores = (
        Play.objects.using("nfl")
        .filter(game=game_final, sequence=1003)
        .order_by("id")
        .first()
    )
    assert play_from_post_scores is not None
    assert play_from_post_scores.home_score_after == 14
    assert play_from_post_scores.away_score_after == 13


@pytest.mark.django_db(databases=["default", "nfl"])
def test_import_plays_maps_extended_tracking_probability_and_penalty_fields(
    game_final, drive
):
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
                "1011",
                game_final.season.year,
                game_final.week,
                "WAS",
                "SEA",
                json.dumps(
                    {
                        "play_id": "1011",
                        "nfl_api_id": "4000001011",
                        "drive": str(drive.drive_number),
                        "qtr": "3",
                        "quarter_seconds_remaining": "12",
                        "half_seconds_remaining": "912",
                        "game_seconds_remaining": "1812",
                        "down": "4",
                        "ydstogo": "7",
                        "yardline_100": "60",
                        "side_of_field": "WAS",
                        "play_type": "pass",
                        "desc": "(0:12) PENALTY on WAS-75-C.Paul, False Start, 5 yards, enforced at WAS 33 - No Play.",
                        "short_description": "Penalty on WAS",
                        "yards_gained": "0",
                        "penalty": "1",
                        "penalty_type": "False Start",
                        "penalty_yards": "5",
                        "penalty_player_name": "C.Paul",
                        "penalty_player_id": "00-0030000",
                        "penalty_team": "WAS",
                        "blocked_player_name": "J.Doe",
                        "blocked_player_id": "00-0099999",
                        "pass_attempt": "1",
                        "rush_attempt": "0",
                        "special_teams_play": "0",
                        "st_play_type": "none",
                        "first_down": "0",
                        "fumble_lost": "0",
                        "timeout": "1",
                        "timeout_team": "WAS",
                        "home_timeouts_remaining": "2",
                        "away_timeouts_remaining": "1",
                        "pass_location": "right",
                        "cp": "0.5805860161781311",
                        "cpoe": "41.94139838218689",
                        "td_prob": "0.2980305552482605",
                        "fg_prob": "0.21804311871528625",
                        "home_wp": "0.5815390050411224",
                        "away_wp": "0.41846099495887756",
                        "vegas_wp": "0.44",
                        "vegas_home_wp": "0.56",
                        "ep": "1.27",
                        "no_score_prob": "0.31",
                        "score_differential": "-3",
                        "drive_start_transition": "KICKOFF",
                        "drive_end_transition": "PUNT",
                        "drive_yards_penalized": "5",
                        "series_result": "PUNT",
                        "end_yard_line": "67",
                        "total_home_score": "17",
                        "total_away_score": "14",
                        "time_of_day": "2026-01-04T20:10:12Z",
                    }
                ),
            ],
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
                "1012",
                game_final.season.year,
                game_final.week,
                "WAS",
                "SEA",
                json.dumps(
                    {
                        "play_id": "1012",
                        "drive": str(drive.drive_number),
                        "qtr": "4",
                        "quarter_seconds_remaining": "0",
                        "play_type": "no_play",
                        "desc": "END GAME",
                        "total_home_score": str(game_final.home_score),
                        "total_away_score": str(game_final.away_score),
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
        .filter(game=game_final, sequence=1011)
        .order_by("id")
        .first()
    )
    assert play is not None
    assert play.clock == "0:12"
    assert play.down_distance_text == "4th & 7"
    assert play.penalty is True
    assert play.penalty_type == "False Start"
    assert play.penalty_player_name == "C.Paul"
    assert play.penalty_team == "WAS"
    assert play.blocked_player_name == "J.Doe"
    assert play.blocked_player_id == "00-0099999"
    assert play.timeout is True
    assert play.timeout_team == "WAS"
    assert play.pass_attempt is True
    assert play.pass_location == "right"
    assert play.home_wp == pytest.approx(0.5815390050411224)
    assert play.away_wp == pytest.approx(0.41846099495887756)
    assert play.cp == pytest.approx(0.5805860161781311)
    assert play.cpoe == pytest.approx(41.94139838218689)
    assert play.td_prob == pytest.approx(0.2980305552482605)
    assert play.fg_prob == pytest.approx(0.21804311871528625)
    assert play.drive_start_transition == "KICKOFF"
    assert play.drive_end_transition == "PUNT"
    assert play.drive_yards_penalized == 5
    assert play.series_result == "PUNT"
    assert play.end_yard_line == 67
    assert play.wall_clock is not None


@pytest.mark.django_db(databases=["default", "nfl"])
def test_import_plays_clamps_scores_to_monotonic_game_progress(game_final, drive):
    _ensure_raw_pbp_table()
    game_final.status = "in_progress"
    game_final.save(using="nfl", update_fields=["status"])

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
                "1004",
                game_final.season.year,
                game_final.week,
                "SEA",
                "WAS",
                json.dumps(
                    {
                        "play_id": "1004",
                        "drive": str(drive.drive_number),
                        "qtr": "2",
                        "quarter_seconds_remaining": "100",
                        "play_type": "run",
                        "desc": "(1:40) R.Runner left guard to WAS 30 for 3 yards.",
                        "yards_gained": "3",
                        "total_home_score": "7",
                        "total_away_score": "3",
                    }
                ),
            ],
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
                "1005",
                game_final.season.year,
                game_final.week,
                "SEA",
                "WAS",
                json.dumps(
                    {
                        "play_id": "1005",
                        "drive": str(drive.drive_number),
                        "qtr": "2",
                        "quarter_seconds_remaining": "70",
                        "play_type": "pass",
                        "desc": "(1:10) Q.Pass incomplete.",
                        "yards_gained": "0",
                        # Raw source occasionally regresses score snapshots on
                        # admin/no-play rows. Import should never decrease.
                        "total_home_score": "3",
                        "total_away_score": "3",
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

    first = (
        Play.objects.using("nfl")
        .filter(game=game_final, sequence=1004)
        .order_by("id")
        .first()
    )
    second = (
        Play.objects.using("nfl")
        .filter(game=game_final, sequence=1005)
        .order_by("id")
        .first()
    )
    assert first is not None
    assert second is not None
    assert first.home_score_after == 7
    assert first.away_score_after == 3
    assert second.home_score_after == 7
    assert second.away_score_after == 3


@pytest.mark.django_db(databases=["default", "nfl"])
def test_import_plays_reconciles_last_play_to_game_final_score(game_final, drive):
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
                "1006",
                game_final.season.year,
                game_final.week,
                "SEA",
                "WAS",
                json.dumps(
                    {
                        "play_id": "1006",
                        "drive": str(drive.drive_number),
                        "qtr": "4",
                        "quarter_seconds_remaining": "45",
                        "play_type": "pass",
                        "desc": "(:45) Q.Pass complete for 9 yards.",
                        "yards_gained": "9",
                        # Intentionally stale/low final score snapshot from source.
                        "total_home_score": "19",
                        "total_away_score": "13",
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

    last_play = (
        Play.objects.using("nfl").filter(game=game_final).order_by("-sequence").first()
    )
    assert last_play is not None
    assert last_play.home_score_after == game_final.home_score
    assert last_play.away_score_after == game_final.away_score
