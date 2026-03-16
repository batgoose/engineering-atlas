import json
from datetime import date
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connections

from gridstream.models import Game, Player, PlayerGameStats, Season, Team


def _ensure_raw_table():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS raw")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_player_stats (
                id BIGSERIAL PRIMARY KEY,
                season INTEGER,
                week INTEGER,
                game_id TEXT,
                player_id TEXT,
                team TEXT,
                opponent TEXT,
                payload JSONB NOT NULL
            )
            """)


def _reset_raw_table():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_nflverse_player_stats")


@pytest.mark.django_db(databases=["nfl"])
def test_materialize_player_game_stats_inserts_modeled_rows():
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
    player = Player.objects.using("nfl").create(
        gsis_id="00-0033873",
        first_name="Patrick",
        last_name="Mahomes",
        display_name="Patrick Mahomes",
        short_name="P. Mahomes",
        position="QB",
        current_team=team_home,
    )

    payload = {
        "season_type": "REG",
        "week": "1",
        "completions": "20",
        "attempts": "28",
        "passing_yards": "291",
        "passing_tds": "2",
        "passing_interceptions": "1",
        "sacks_suffered": "3",
        "sack_yards_lost": "-18",
        "sack_fumbles": "1",
        "sack_fumbles_lost": "0",
        "passing_first_downs": "15",
        "carries": "5",
        "rushing_yards": "21",
        "rushing_tds": "0",
        "receptions": "0",
        "targets": "0",
        "receiving_yards": "0",
        "def_tackles_solo": "0",
        "def_tackle_assists": "0",
        "def_sacks": "0",
        "kickoff_returns": "0",
        "punt_returns": "0",
        "special_teams_tds": "0",
        "fg_att": "0",
        "fg_made": "0",
        "pat_att": "0",
        "pat_made": "0",
        "pat_missed": "0",
        "fantasy_points": "18.74",
        "fantasy_points_ppr": "18.74",
    }

    with connections["nfl"].cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO raw.raw_nflverse_player_stats (
                season,
                week,
                game_id,
                player_id,
                team,
                opponent,
                payload
            ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            [
                2024,
                1,
                game.nflverse_game_id,
                player.gsis_id,
                "KC",
                "BAL",
                json.dumps(payload),
            ],
        )

    call_command(
        "materialize_player_game_stats",
        season=[2024],
        stdout=StringIO(),
        stderr=StringIO(),
        verbosity=0,
    )

    row = PlayerGameStats.objects.using("nfl").get(player=player, game=game)
    assert row.team_id == team_home.id
    assert row.opponent_id == team_away.id
    assert row.pass_attempts == 28
    assert row.passing_yards == 291
    assert row.sacks_taken == 3
    assert row.sack_yards_lost == 18
    assert row.passing_first_downs == 15
    assert row.fantasy_points_standard == 18.74
