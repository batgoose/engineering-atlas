"""
Shared test fixtures for Redzone API tests.

Creates a realistic mini-dataset: 2 teams, a venue, a season,
2 games (one final, one in-progress), players, drives, plays,
and stats — enough to exercise every endpoint and serializer.

All fixtures use the 'nfl' database via the db_router.
"""

import pytest
from datetime import date, time, datetime, timezone
from django.test import override_settings
from rest_framework.test import APIClient

from redzone.cache import cache_delete_pattern
from redzone.models import (
    Team,
    TeamLogo,
    Venue,
    Player,
    PlayerContract,
    PlayerCombine,
    PlayerCollegeHistory,
    PlayerTransaction,
    SocialAccount,
    GameHashtag,
    NewsSource,
    Season,
    Game,
    GameLeader,
    GameLink,
    Drive,
    Play,
    ScoringPlay,
    PlayerGameStats,
    TeamGameStats,
    Playbook,
    PlaybookEntry,
)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture(autouse=True)
def clear_redzone_cache_between_tests(request):
    """
    Prevent cross-test leakage from Redis-backed endpoint caching.

    Cache unit tests mock cache internals directly and should not be touched.
    """
    if "test_cache.py" in str(request.fspath):
        yield
        return

    cache_delete_pattern("redzone:*")
    yield
    cache_delete_pattern("redzone:*")


@pytest.fixture
def season(db):
    return Season.objects.using("nfl").create(
        year=2024,
        start_date=date(2024, 9, 5),
        end_date=date(2025, 2, 9),
        current_week=18,
        is_active=True,
    )


@pytest.fixture
def venue(db):
    return Venue.objects.using("nfl").create(
        espn_id="3673",
        name="Lumen Field",
        city="Seattle",
        state="WA",
        latitude=47.5952,
        longitude=-122.3316,
        roof_type="outdoors",
        surface="fieldturf",
    )


@pytest.fixture
def team_sea(db):
    team = Team.objects.using("nfl").create(
        espn_id="26",
        abbreviation="SEA",
        slug="seattle-seahawks",
        location="Seattle",
        name="Seahawks",
        display_name="Seattle Seahawks",
        short_display_name="Seahawks",
        nickname="Seahawks",
        color_primary="002244",
        color_secondary="69BE28",
        conference="NFC",
        division="NFC West",
        is_active=True,
    )
    TeamLogo.objects.using("nfl").create(
        team=team,
        logo_type="default",
        url="https://a.espncdn.com/i/teamlogos/nfl/500/sea.png",
        width=500,
        height=500,
    )
    TeamLogo.objects.using("nfl").create(
        team=team,
        logo_type="dark",
        url="https://a.espncdn.com/i/teamlogos/nfl/500-dark/sea.png",
    )
    return team


@pytest.fixture
def team_was(db):
    team = Team.objects.using("nfl").create(
        espn_id="28",
        abbreviation="WAS",
        slug="washington-commanders",
        location="Washington",
        name="Commanders",
        display_name="Washington Commanders",
        short_display_name="Commanders",
        nickname="Commanders",
        color_primary="5A1414",
        color_secondary="FFB612",
        conference="NFC",
        division="NFC East",
        is_active=True,
    )
    TeamLogo.objects.using("nfl").create(
        team=team,
        logo_type="default",
        url="https://a.espncdn.com/i/teamlogos/nfl/500/was.png",
        width=500,
        height=500,
    )
    return team


@pytest.fixture
def player_qb(db, team_sea):
    """A starting QB on SEA."""
    return Player.objects.using("nfl").create(
        gsis_id="00-0033873",
        espn_id="3917315",
        pfr_id="SmitGe00",
        display_name="Geno Smith",
        short_name="G. Smith",
        first_name="Geno",
        last_name="Smith",
        jersey_number="7",
        position="QB",
        position_group="QB",
        current_team=team_sea,
        roster_status="ACT",
        headshot_url="https://a.espncdn.com/i/headshots/nfl/players/full/3917315.png",
        height="6-3",
        height_inches=75,
        weight=221,
        birth_date=date(1990, 10, 10),
        college="West Virginia",
        draft_year=2013,
        draft_round=2,
        draft_pick=7,
        draft_overall=39,
        draft_team=None,
        is_undrafted=False,
        rookie_season=2013,
        years_experience=12,
        is_active=True,
    )


@pytest.fixture
def player_wr(db, team_sea):
    """A WR on SEA."""
    return Player.objects.using("nfl").create(
        gsis_id="00-0036322",
        espn_id="4047646",
        display_name="DK Metcalf",
        short_name="D. Metcalf",
        first_name="DK",
        last_name="Metcalf",
        jersey_number="14",
        position="WR",
        position_group="WR",
        current_team=team_sea,
        roster_status="ACT",
        headshot_url="https://a.espncdn.com/i/headshots/nfl/players/full/4047646.png",
        height="6-4",
        height_inches=76,
        weight=235,
        college="Ole Miss",
        draft_year=2019,
        draft_round=2,
        draft_pick=32,
        draft_overall=64,
        is_active=True,
    )


@pytest.fixture
def player_was_qb(db, team_was):
    """A QB on WAS."""
    return Player.objects.using("nfl").create(
        gsis_id="00-0039163",
        espn_id="4432577",
        display_name="Jayden Daniels",
        short_name="J. Daniels",
        first_name="Jayden",
        last_name="Daniels",
        jersey_number="5",
        position="QB",
        position_group="QB",
        current_team=team_was,
        roster_status="ACT",
        headshot_url="https://a.espncdn.com/i/headshots/nfl/players/full/4432577.png",
        college="LSU",
        draft_year=2024,
        draft_round=1,
        draft_pick=2,
        draft_overall=2,
        rookie_season=2024,
        is_active=True,
    )


@pytest.fixture
def player_contract(db, player_qb, team_sea):
    return PlayerContract.objects.using("nfl").create(
        player=player_qb,
        team=team_sea,
        is_active=True,
        year_signed=2023,
        years=3,
        total_value=75000000,
        apy=25000000,
        guaranteed=40000000,
        apy_cap_pct=10.5,
    )


@pytest.fixture
def player_combine(db, player_wr):
    return PlayerCombine.objects.using("nfl").create(
        player=player_wr,
        season=2019,
        position="WR",
        height_inches=76.0,
        weight=228,
        forty_yard=4.33,
        bench_press=27,
        vertical_jump=40.5,
        broad_jump=134,
        three_cone=7.38,
    )


@pytest.fixture
def player_college(db, player_wr):
    return PlayerCollegeHistory.objects.using("nfl").create(
        player=player_wr,
        college="Ole Miss",
        conference="SEC",
        start_year=2017,
        end_year=2018,
        is_redshirt=True,
        redshirt_year=2017,
        is_primary=True,
        sequence=1,
    )


@pytest.fixture
def social_account_team(db, team_sea):
    return SocialAccount.objects.using("nfl").create(
        team=team_sea,
        platform="twitter",
        account_type="official",
        handle="Seahawks",
        url="https://twitter.com/Seahawks",
        display_name="Seattle Seahawks",
        is_verified=True,
    )


@pytest.fixture
def social_account_player(db, player_qb):
    return SocialAccount.objects.using("nfl").create(
        player=player_qb,
        platform="instagram",
        account_type="personal",
        handle="genosmith",
        url="https://instagram.com/genosmith",
        is_verified=True,
    )


@pytest.fixture
def game_final(db, season, team_sea, team_was, venue):
    """A completed regular season game."""
    return Game.objects.using("nfl").create(
        espn_event_id="401772001",
        nflverse_game_id="2024_01_WAS_SEA",
        season=season,
        week=1,
        game_date=date(2024, 9, 8),
        game_time=time(16, 25),
        season_type="REG",
        home_team=team_sea,
        away_team=team_was,
        venue=venue,
        is_division_game=False,
        status="final",
        quarter=4,
        home_score=26,
        away_score=20,
        home_score_q1=7,
        home_score_q2=10,
        home_score_q3=3,
        home_score_q4=6,
        away_score_q1=3,
        away_score_q2=7,
        away_score_q3=7,
        away_score_q4=3,
        spread=-3.5,
        total=43.5,
        broadcast_network="FOX",
        home_record="1-0",
        away_record="0-1",
        home_coach="Mike Macdonald",
        away_coach="Dan Quinn",
        home_qb_name="Geno Smith",
        away_qb_name="Jayden Daniels",
    )


@pytest.fixture
def game_live(db, season, team_sea, team_was, venue):
    """A game currently in progress."""
    return Game.objects.using("nfl").create(
        espn_event_id="401772099",
        nflverse_game_id="2024_18_SEA_WAS",
        season=season,
        week=18,
        game_date=date.today(),
        game_time=time(13, 0),
        season_type="REG",
        home_team=team_was,
        away_team=team_sea,
        venue=venue,
        status="in_progress",
        quarter=3,
        clock="7:22",
        home_score=14,
        away_score=17,
        possession_team=team_sea,
        broadcast_network="CBS",
    )


@pytest.fixture
def drive(db, game_final, team_sea):
    return Drive.objects.using("nfl").create(
        game=game_final,
        team=team_sea,
        drive_number=1,
        description="8 plays, 75 yards, 4:12",
        start_quarter=1,
        start_clock="15:00",
        start_yardline=25,
        end_quarter=1,
        end_clock="10:48",
        end_yardline=0,
        total_yards=75,
        play_count=8,
        first_downs=4,
        time_elapsed="4:12",
        result="touchdown",
        is_score=True,
    )


@pytest.fixture
def plays(db, game_final, drive, team_sea, team_was):
    """Create a few plays for the completed game."""
    play_data = [
        {
            "sequence": 0,
            "espn_play_id": "1001",
            "quarter": 1,
            "clock": "15:00",
            "down": 1,
            "distance": 10,
            "yard_line": 75,
            "possession_team": team_sea,
            "defensive_team": team_was,
            "play_type": "run",
            "short_description": "G.Smith rush left for 5 yards",
            "description": "Geno Smith rush to the left for 5 yards to the SEA 30.",
            "yards_gained": 5.0,
            "down_distance_text": "1st & 10",
            "rusher_player_name": "G.Smith",
            "rusher_player_id": "00-0033873",
            "epa": 0.15,
        },
        {
            "sequence": 1,
            "espn_play_id": "1002",
            "quarter": 1,
            "clock": "14:22",
            "down": 2,
            "distance": 5,
            "yard_line": 70,
            "possession_team": team_sea,
            "defensive_team": team_was,
            "play_type": "pass",
            "short_description": "G.Smith pass to D.Metcalf for 30 yards",
            "description": "Geno Smith pass deep middle to DK Metcalf for 30 yards to the WAS 40.",
            "yards_gained": 30.0,
            "complete_pass": True,
            "first_down": True,
            "down_distance_text": "2nd & 5",
            "passer_player_name": "G.Smith",
            "passer_player_id": "00-0033873",
            "receiver_player_name": "D.Metcalf",
            "receiver_player_id": "00-0036322",
            "air_yards": 20.0,
            "yards_after_catch": 10.0,
            "pass_location": "middle",
            "epa": 2.1,
        },
        {
            "sequence": 2,
            "espn_play_id": "1003",
            "quarter": 1,
            "clock": "13:45",
            "down": 1,
            "distance": 10,
            "yard_line": 40,
            "possession_team": team_sea,
            "defensive_team": team_was,
            "play_type": "pass",
            "short_description": "G.Smith pass to D.Metcalf for 40 yard TD",
            "description": "Geno Smith pass deep left to DK Metcalf for 40 yards, TOUCHDOWN.",
            "yards_gained": 40.0,
            "complete_pass": True,
            "touchdown": True,
            "is_scoring_play": True,
            "home_score_after": 7,
            "down_distance_text": "1st & 10",
            "passer_player_name": "G.Smith",
            "receiver_player_name": "D.Metcalf",
            "air_yards": 35.0,
            "yards_after_catch": 5.0,
            "epa": 4.5,
        },
    ]

    created = []
    for data in play_data:
        data["game"] = game_final
        data["drive"] = drive
        play = Play.objects.using("nfl").create(**data)
        created.append(play)
    return created


@pytest.fixture
def scoring_play(db, game_final, plays, team_sea):
    td_play = plays[2]  # The touchdown
    return ScoringPlay.objects.using("nfl").create(
        game=game_final,
        play=td_play,
        team=team_sea,
        quarter=1,
        clock="13:45",
        score_type="TD",
        description="DK Metcalf 40 yard TD reception from Geno Smith",
        home_score_after=7,
        away_score_after=0,
        sequence=1,
    )


@pytest.fixture
def game_leader(db, game_final, team_sea, player_qb):
    return GameLeader.objects.using("nfl").create(
        game=game_final,
        team=team_sea,
        category="passing",
        player=player_qb,
        athlete_espn_id="3917315",
        athlete_name="Geno Smith",
        athlete_headshot_url="https://a.espncdn.com/i/headshots/nfl/players/full/3917315.png",
        athlete_jersey="7",
        athlete_position="QB",
        display_value="280 YDS, 2 TD",
        stat_value=280.0,
    )


@pytest.fixture
def player_game_stats_qb(db, player_qb, game_final, team_sea, team_was, season):
    return PlayerGameStats.objects.using("nfl").create(
        player=player_qb,
        game=game_final,
        team=team_sea,
        opponent=team_was,
        season_year=2024,
        week=1,
        completions=22,
        pass_attempts=31,
        passing_yards=280,
        passing_tds=2,
        interceptions_thrown=1,
        carries=3,
        rushing_yards=15,
        rushing_tds=0,
        passer_rating=105.3,
    )


@pytest.fixture
def player_game_stats_wr(db, player_wr, game_final, team_sea, team_was, season):
    return PlayerGameStats.objects.using("nfl").create(
        player=player_wr,
        game=game_final,
        team=team_sea,
        opponent=team_was,
        season_year=2024,
        week=1,
        receptions=6,
        targets=9,
        receiving_yards=120,
        receiving_tds=1,
        receiving_long=40,
    )


@pytest.fixture
def team_game_stats_sea(db, team_sea, team_was, game_final):
    return TeamGameStats.objects.using("nfl").create(
        team=team_sea,
        game=game_final,
        opponent=team_was,
        season_year=2024,
        week=1,
        is_home=True,
        total_yards=380,
        total_plays=62,
        first_downs=22,
        pass_completions=22,
        pass_attempts=31,
        pass_yards=280,
        pass_tds=2,
        rush_attempts=28,
        rush_yards=100,
        rush_tds=1,
        turnovers=1,
        points_scored=26,
        points_allowed=20,
        time_of_possession="32:15",
        time_of_possession_seconds=1935,
    )


@pytest.fixture
def news_source_league(db):
    return NewsSource.objects.using("nfl").create(
        name="ESPN NFL News",
        source_type="espn_league",
        entity_type="league",
        url_template="https://site.api.espn.com/apis/site/v2/sports/football/nfl/news",
        cache_ttl_seconds=300,
        is_active=True,
        priority=1,
    )


@pytest.fixture
def news_source_team(db, team_sea):
    return NewsSource.objects.using("nfl").create(
        name="ESPN Seahawks News",
        source_type="espn_team",
        entity_type="team",
        team=team_sea,
        url_template="https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team={espn_id}",
        cache_ttl_seconds=300,
        is_active=True,
        priority=5,
    )


@pytest.fixture
def playbook(db, game_final):
    return Playbook.objects.using("nfl").create(
        name="SEA vs WAS Week 1 Highlights",
        description="Key plays from the Week 1 matchup",
        source_game=game_final,
        is_full_game=False,
        play_count=3,
    )


@pytest.fixture
def playbook_entries(db, playbook, plays):
    entries = []
    for i, play in enumerate(plays):
        entry = PlaybookEntry.objects.using("nfl").create(
            playbook=playbook,
            play=play,
            sequence=i + 1,
            delay_seconds=5.0 if i == 0 else 8.0,
        )
        entries.append(entry)
    return entries
