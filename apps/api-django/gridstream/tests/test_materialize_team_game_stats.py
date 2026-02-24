import json
from datetime import date
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connections

from gridstream.models import Game, Season, Team, TeamGameStats


def _ensure_raw_table():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS raw")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_team_stats (
                id BIGSERIAL PRIMARY KEY,
                season INTEGER,
                week INTEGER,
                game_id TEXT,
                team TEXT,
                opponent TEXT,
                home_away TEXT,
                payload JSONB NOT NULL
            )
            """)


def _reset_raw_table():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_nflverse_team_stats")


@pytest.mark.django_db(databases=["nfl"])
def test_materialize_team_game_stats_inserts_modeled_rows():
    _ensure_raw_table()
    _reset_raw_table()

    season = Season.objects.using("nfl").create(
        year=2024, current_week=1, is_active=True
    )
    team_home = Team.objects.using("nfl").create(
        espn_id="1",
        abbreviation="KC",
        slug="kansas-city-chiefs",
        location="Kansas City",
        name="Chiefs",
        display_name="Kansas City Chiefs",
        short_display_name="Chiefs",
        color_primary="E31837",
        color_secondary="FFB81C",
        conference="AFC",
        division="AFC West",
        is_active=True,
    )
    team_away = Team.objects.using("nfl").create(
        espn_id="2",
        abbreviation="BAL",
        slug="baltimore-ravens",
        location="Baltimore",
        name="Ravens",
        display_name="Baltimore Ravens",
        short_display_name="Ravens",
        color_primary="241773",
        color_secondary="9E7C0C",
        conference="AFC",
        division="AFC North",
        is_active=True,
    )
    game = Game.objects.using("nfl").create(
        nflverse_game_id="2024_01_BAL_KC",
        season=season,
        week=1,
        game_date=date(2024, 9, 5),
        home_team=team_home,
        away_team=team_away,
        season_type="REG",
        home_score=27,
        away_score=20,
    )

    payload = {
        "week": "1",
        "attempts": "31",
        "carries": "29",
        "passing_yards": "302",
        "rushing_yards": "118",
        "misc_yards": "7",
        "passing_first_downs": "13",
        "rushing_first_downs": "7",
        "completions": "22",
        "passing_tds": "3",
        "passing_interceptions": "1",
        "sacks_suffered": "2",
        "sack_yards_lost": "-14",
        "rushing_tds": "1",
        "rushing_fumbles_lost": "0",
        "sack_fumbles_lost": "0",
        "def_sacks": "4",
        "def_interceptions": "1",
        "fumble_recovery_opp": "1",
        "def_tds": "1",
        "def_safeties": "0",
        "fg_blocked": "0",
        "pat_blocked": "0",
        "gwfg_blocked": "0",
        "special_teams_tds": "0",
        "punt_return_yards": "12",
        "kickoff_return_yards": "45",
        "penalties": "6",
        "penalty_yards": "48",
        "passing_epa": "3.2",
        "rushing_epa": "1.1",
        "season_type": "REG",
    }

    with connections["nfl"].cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO raw.raw_nflverse_team_stats (
                season,
                week,
                game_id,
                team,
                opponent,
                home_away,
                payload
            ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            [2024, 1, game.nflverse_game_id, "KC", "BAL", "home", json.dumps(payload)],
        )

    call_command(
        "materialize_team_game_stats",
        season=[2024],
        stdout=StringIO(),
        stderr=StringIO(),
        verbosity=0,
    )

    row = TeamGameStats.objects.using("nfl").get(team=team_home, game=game)
    assert row.opponent_id == team_away.id
    assert row.is_home is True
    assert row.total_yards == 427
    assert row.total_plays == 60
    assert row.first_downs == 20
    assert row.pass_attempts == 31
    assert row.rush_attempts == 29
    assert row.turnovers == 1
    assert row.takeaways == 2
    assert row.points_scored == 27
    assert row.points_allowed == 20
