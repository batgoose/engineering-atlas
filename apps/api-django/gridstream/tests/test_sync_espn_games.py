"""
Tests for the ESPN sync flow and gridstream models.

Uses mocked ESPN responses to verify mapping and idempotency.
"""

import pytest
from datetime import date
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.db import connections

from gridstream.models import (
    Drive,
    Game,
    GameLeader,
    GameOfficial,
    Player,
    PlayerGameStats,
    PlayerInjury,
    Play,
    ScoringPlay,
    Season,
    Team,
    TeamGameStats,
    Venue,
    WinProbabilityPlay,
)

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


def _ensure_raw_espn_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS raw")
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


def _reset_raw_espn_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_espn_probabilities")
        cursor.execute("DELETE FROM raw.raw_espn_summary")


# =============================================================================
# MOCK ESPN RESPONSES
# =============================================================================

MOCK_SCOREBOARD = {
    "season": {"year": 2025, "type": 3},
    "week": {"number": 5},
    "events": [
        {
            "id": "401772988",
            "date": "2026-02-08T23:30Z",
            "name": "Seattle Seahawks at New England Patriots",
            "shortName": "SEA @ NE",
            "competitions": [
                {
                    "id": "401772988",
                    "date": "2026-02-08T23:30Z",
                    "competitors": [
                        {
                            "id": "17",
                            "homeAway": "home",
                            "score": "13",
                            "team": {
                                "id": "17",
                                "abbreviation": "NE",
                                "displayName": "New England Patriots",
                                "shortDisplayName": "Patriots",
                                "location": "New England",
                                "name": "Patriots",
                                "color": "002a5c",
                                "alternateColor": "c60c30",
                                "logo": "https://a.espncdn.com/ne.png",
                            },
                            "records": [{"type": "total", "summary": "14-3"}],
                            "leaders": [
                                {
                                    "name": "passingLeader",
                                    "leaders": [
                                        {
                                            "displayValue": "180 YDS, 1 TD",
                                            "athlete": {
                                                "id": "4567890",
                                                "fullName": "Drake Maye",
                                                "headshot": "https://a.espncdn.com/maye.png",
                                                "jersey": "10",
                                                "position": {"abbreviation": "QB"},
                                            },
                                        }
                                    ],
                                }
                            ],
                            "linescores": [
                                {"value": 0},
                                {"value": 0},
                                {"value": 0},
                                {"value": 13},
                            ],
                        },
                        {
                            "id": "26",
                            "homeAway": "away",
                            "score": "29",
                            "team": {
                                "id": "26",
                                "abbreviation": "SEA",
                                "displayName": "Seattle Seahawks",
                                "shortDisplayName": "Seahawks",
                                "location": "Seattle",
                                "name": "Seahawks",
                                "color": "002a5c",
                                "alternateColor": "69be28",
                                "logo": "https://a.espncdn.com/sea.png",
                            },
                            "records": [{"type": "total", "summary": "14-3"}],
                            "leaders": [
                                {
                                    "name": "passingLeader",
                                    "leaders": [
                                        {
                                            "displayValue": "206 YDS, 1 TD",
                                            "athlete": {
                                                "id": "1234567",
                                                "fullName": "Sam Darnold",
                                                "headshot": "https://a.espncdn.com/darnold.png",
                                                "jersey": "14",
                                                "position": {"abbreviation": "QB"},
                                            },
                                        }
                                    ],
                                }
                            ],
                            "linescores": [
                                {"value": 3},
                                {"value": 6},
                                {"value": 3},
                                {"value": 17},
                            ],
                        },
                    ],
                    "odds": [
                        {
                            "provider": {"name": "DraftKings"},
                            "details": "NE -5.5",
                            "overUnder": 42.5,
                            "spread": 5.5,
                        }
                    ],
                    "broadcasts": [{"names": ["NBC", "Peacock"], "market": "national"}],
                    "venue": {
                        "id": "3948",
                        "fullName": "Levi's Stadium",
                        "address": {
                            "city": "Santa Clara",
                            "state": "CA",
                            "country": "US",
                        },
                        "indoor": False,
                        "grass": False,
                    },
                    "notes": [{"type": "event", "headline": "Super Bowl LX"}],
                    "status": {
                        "clock": 0.0,
                        "displayClock": "0:00",
                        "period": 4,
                        "type": {
                            "id": "3",
                            "name": "STATUS_FINAL",
                            "state": "post",
                            "completed": True,
                            "detail": "Final",
                        },
                    },
                }
            ],
            "status": {
                "clock": 0.0,
                "displayClock": "0:00",
                "period": 4,
                "type": {
                    "id": "3",
                    "name": "STATUS_FINAL",
                    "state": "post",
                    "completed": True,
                    "detail": "Final",
                },
            },
            "weather": {
                "temperature": 58,
                "displayValue": "Partly Cloudy",
                "conditionId": "3",
            },
        }
    ],
}

MOCK_SUMMARY = {
    "drives": {
        "previous": [
            {
                "id": "1",
                "description": "8 plays, 75 yards, 3:42",
                "team": {"abbreviation": "SEA"},
                "start": {
                    "period": {"number": 1},
                    "clock": {"displayValue": "15:00"},
                    "yardLine": 25,
                },
                "end": {
                    "period": {"number": 1},
                    "clock": {"displayValue": "11:18"},
                    "yardLine": 47,
                },
                "timeElapsed": {"displayValue": "3:42"},
                "yards": 22,
                "isScore": False,
                "offensivePlays": 4,
                "result": "Punt",
                "shortDisplayResult": "PUNT",
                "plays": [
                    {
                        "id": "40177298801",
                        "type": {"id": "24", "text": "Rush", "abbreviation": "RUSH"},
                        "text": "K.Walker left end for 10 yards.",
                        "shortText": "K.Walker rush for 10 yds",
                        "homeScore": 0,
                        "awayScore": 0,
                        "period": {"number": 1},
                        "clock": {"value": 900, "displayValue": "15:00"},
                        "scoringPlay": False,
                        "start": {
                            "down": 1,
                            "distance": 10,
                            "yardLine": 25,
                            "yardsToEndzone": 75,
                            "downDistanceText": "1st & 10 at SEA 25",
                            "team": {"id": "26"},
                        },
                        "end": {
                            "down": 1,
                            "distance": 10,
                            "yardLine": 35,
                            "yardsToEndzone": 65,
                            "team": {"id": "26"},
                        },
                        "statYardage": 10,
                        "scoringType": {"name": "none", "abbreviation": "NONE"},
                    },
                    {
                        "id": "40177298802",
                        "type": {
                            "id": "67",
                            "text": "Pass Reception",
                            "abbreviation": "REC",
                        },
                        "text": "S.Darnold pass short left to A.Barner for 12 yards.",
                        "shortText": "S.Darnold pass to A.Barner for 12 yds",
                        "homeScore": 0,
                        "awayScore": 0,
                        "period": {"number": 1},
                        "clock": {"value": 860, "displayValue": "14:20"},
                        "scoringPlay": False,
                        "start": {
                            "down": 1,
                            "distance": 10,
                            "yardLine": 35,
                            "yardsToEndzone": 65,
                            "downDistanceText": "1st & 10 at SEA 35",
                            "team": {"id": "26"},
                        },
                        "end": {
                            "down": 1,
                            "distance": 10,
                            "yardLine": 47,
                            "yardsToEndzone": 53,
                            "team": {"id": "26"},
                        },
                        "statYardage": 12,
                        "scoringType": {"name": "none", "abbreviation": "NONE"},
                    },
                ],
            },
        ],
        "current": None,
    },
    "scoringPlays": [
        {
            "id": "40177298820",
            "type": {"text": "Field Goal", "abbreviation": "FG"},
            "text": "J.Myers 42 yard field goal is GOOD.",
            "homeScore": 0,
            "awayScore": 3,
            "period": {"number": 1},
            "clock": {"displayValue": "11:58"},
            "team": {"id": "26", "abbreviation": "SEA"},
            "scoringType": {"name": "field-goal", "abbreviation": "FG"},
        }
    ],
    "winprobability": [
        {
            "homeWinPercentage": 0.45,
            "tiePercentage": 0.0,
            "playId": "40177298801",
        },
        {
            "homeWinPercentage": 0.4,
            "tiePercentage": 0.0,
            "playId": "40177298802",
        },
    ],
    "pickcenter": [
        {
            "provider": {"name": "Draft Kings"},
            "spread": 4.5,
            "overUnder": 45.5,
            "homeTeamOdds": {"teamId": "17", "moneyLine": 190},
            "awayTeamOdds": {"teamId": "26", "moneyLine": -230},
            "pointSpread": {
                "home": {"close": {"line": "+4.5"}, "open": {"line": "+3.5"}},
                "away": {"close": {"line": "-4.5"}, "open": {"line": "-3.5"}},
            },
            "total": {
                "over": {"close": {"line": "o45.5"}, "open": {"line": "o46.5"}},
                "under": {"close": {"line": "u45.5"}, "open": {"line": "u46.5"}},
            },
        }
    ],
    "gameInfo": {
        "attendance": 70823,
        "officials": [
            {
                "displayName": "Dana McKenzie",
                "position": {"displayName": "Down Judge", "id": "112"},
            }
        ],
    },
    "injuries": [
        {
            "team": {"abbreviation": "SEA"},
            "injuries": [
                {
                    "status": "Questionable",
                    "athlete": {"id": "1234567", "displayName": "Sam Darnold"},
                    "type": {"abbreviation": "Q"},
                    "details": {"type": "Undisclosed"},
                }
            ],
        }
    ],
    "header": {"competitions": [{"date": "2026-02-08T23:30Z"}]},
    "boxscore": {
        "teams": [
            {
                "team": {"abbreviation": "SEA"},
                "statistics": [
                    {"name": "firstDowns", "displayValue": "20", "value": 20.0},
                    {
                        "name": "firstDownsPassing",
                        "displayValue": "11",
                        "value": 11.0,
                    },
                    {
                        "name": "firstDownsRushing",
                        "displayValue": "9",
                        "value": 9.0,
                    },
                    {"name": "firstDownsPenalty", "displayValue": "0", "value": 0.0},
                    {"name": "thirdDownEff", "displayValue": "4-16", "value": 0.25},
                    {"name": "fourthDownEff", "displayValue": "0-0", "value": "-"},
                    {
                        "name": "totalOffensivePlays",
                        "displayValue": "71",
                        "value": 71.0,
                    },
                    {"name": "totalYards", "displayValue": "335", "value": "-"},
                    {"name": "netPassingYards", "displayValue": "194", "value": 194.0},
                    {
                        "name": "completionAttempts",
                        "displayValue": "19/38",
                        "value": "-",
                    },
                    {"name": "interceptions", "displayValue": "0", "value": 0.0},
                    {"name": "sacksYardsLost", "displayValue": "1-8", "value": "-"},
                    {"name": "rushingYards", "displayValue": "141", "value": 141.0},
                    {"name": "rushingAttempts", "displayValue": "32", "value": 32.0},
                    {"name": "redZoneAttempts", "displayValue": "1-4", "value": 0.25},
                    {
                        "name": "totalPenaltiesYards",
                        "displayValue": "4-25",
                        "value": "-",
                    },
                    {"name": "turnovers", "displayValue": "0", "value": "-"},
                    {"name": "fumblesLost", "displayValue": "0", "value": 0.0},
                    {
                        "name": "defensiveTouchdowns",
                        "displayValue": "1",
                        "value": 1.0,
                    },
                    {
                        "name": "possessionTime",
                        "displayValue": "33:11",
                        "value": 1991,
                    },
                ],
            },
            {
                "team": {"abbreviation": "NE"},
                "statistics": [
                    {"name": "firstDowns", "displayValue": "18", "value": 18.0},
                    {
                        "name": "firstDownsPassing",
                        "displayValue": "14",
                        "value": 14.0,
                    },
                    {
                        "name": "firstDownsRushing",
                        "displayValue": "2",
                        "value": 2.0,
                    },
                    {"name": "firstDownsPenalty", "displayValue": "2", "value": 2.0},
                    {"name": "thirdDownEff", "displayValue": "6-15", "value": 0.4},
                    {"name": "fourthDownEff", "displayValue": "0-0", "value": "-"},
                    {
                        "name": "totalOffensivePlays",
                        "displayValue": "67",
                        "value": 67.0,
                    },
                    {"name": "totalYards", "displayValue": "331", "value": "-"},
                    {"name": "netPassingYards", "displayValue": "252", "value": 252.0},
                    {
                        "name": "completionAttempts",
                        "displayValue": "27/43",
                        "value": "-",
                    },
                    {"name": "interceptions", "displayValue": "2", "value": 2.0},
                    {"name": "sacksYardsLost", "displayValue": "6-43", "value": "-"},
                    {"name": "rushingYards", "displayValue": "79", "value": 79.0},
                    {"name": "rushingAttempts", "displayValue": "18", "value": 18.0},
                    {"name": "redZoneAttempts", "displayValue": "1-1", "value": 1.0},
                    {
                        "name": "totalPenaltiesYards",
                        "displayValue": "3-25",
                        "value": "-",
                    },
                    {"name": "turnovers", "displayValue": "3", "value": "-"},
                    {"name": "fumblesLost", "displayValue": "1", "value": 1.0},
                    {
                        "name": "defensiveTouchdowns",
                        "displayValue": "0",
                        "value": 0.0,
                    },
                    {
                        "name": "possessionTime",
                        "displayValue": "26:49",
                        "value": 1609,
                    },
                ],
            },
        ],
        "players": [
            {
                "team": {"abbreviation": "SEA"},
                "statistics": [
                    {
                        "name": "passing",
                        "keys": [
                            "completions/passingAttempts",
                            "passingYards",
                            "passingTouchdowns",
                            "interceptions",
                            "sacks-sackYardsLost",
                            "adjQBR",
                            "QBRating",
                        ],
                        "athletes": [
                            {
                                "athlete": {
                                    "id": "1234567",
                                    "displayName": "Sam Darnold",
                                    "fullName": "Sam Darnold",
                                },
                                "stats": [
                                    "19/38",
                                    "202",
                                    "1",
                                    "0",
                                    "1-8",
                                    "53.0",
                                    "74.7",
                                ],
                            }
                        ],
                    },
                    {
                        "name": "rushing",
                        "keys": [
                            "rushingAttempts",
                            "rushingYards",
                            "rushingTouchdowns",
                            "longRushing",
                        ],
                        "athletes": [
                            {
                                "athlete": {
                                    "id": "1234567",
                                    "displayName": "Sam Darnold",
                                    "fullName": "Sam Darnold",
                                },
                                "stats": ["2", "5", "0", "11"],
                            }
                        ],
                    },
                ],
            },
            {
                "team": {"abbreviation": "NE"},
                "statistics": [
                    {
                        "name": "passing",
                        "keys": [
                            "completions/passingAttempts",
                            "passingYards",
                            "passingTouchdowns",
                            "interceptions",
                            "sacks-sackYardsLost",
                            "adjQBR",
                            "QBRating",
                        ],
                        "athletes": [
                            {
                                "athlete": {
                                    "id": "4567890",
                                    "displayName": "Drake Maye",
                                    "fullName": "Drake Maye",
                                },
                                "stats": [
                                    "27/43",
                                    "295",
                                    "1",
                                    "2",
                                    "6-43",
                                    "64.1",
                                    "71.0",
                                ],
                            }
                        ],
                    }
                ],
            },
        ],
    },
}


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def espn_teams(db):
    """The two teams referenced in the mock ESPN data."""
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
    return sea, ne


@pytest.fixture
def espn_players(db, espn_teams):
    sea, ne = espn_teams
    sam = Player.objects.using("nfl").create(
        gsis_id="00-0099991",
        espn_id="1234567",
        first_name="Sam",
        last_name="Darnold",
        display_name="Sam Darnold",
        position="QB",
        current_team=sea,
    )
    drake = Player.objects.using("nfl").create(
        gsis_id="00-0099992",
        espn_id="4567890",
        first_name="Drake",
        last_name="Maye",
        display_name="Drake Maye",
        position="QB",
        current_team=ne,
    )
    return sam, drake


@pytest.fixture
def mock_scoreboard_response():
    """A mock requests.get that returns the scoreboard payload."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_SCOREBOARD
    mock_resp.raise_for_status = MagicMock()
    return mock_resp


@pytest.fixture
def mock_full_sync_response():
    """A mock requests.get that routes scoreboard vs summary URLs."""

    def side_effect(url, **kwargs):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        if "summary" in url:
            mock_resp.json.return_value = MOCK_SUMMARY
        else:
            mock_resp.json.return_value = MOCK_SCOREBOARD
        return mock_resp

    return side_effect


# =============================================================================
# SCOREBOARD SYNC
# =============================================================================


class TestSyncESPNGames:
    """Tests for the sync_espn_games management command."""

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_sync_creates_game(self, mock_get, espn_teams, mock_scoreboard_response):
        sea, ne = espn_teams
        mock_get.return_value = mock_scoreboard_response

        call_command("sync_espn_games", verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")
        assert game.home_team == ne
        assert game.away_team == sea
        assert game.home_score == 13
        assert game.away_score == 29
        assert game.status == "final"
        assert game.game_note == "Super Bowl LX"
        assert game.broadcast_names == ["NBC", "Peacock"]
        assert game.spread == pytest.approx(5.5)
        assert game.total == pytest.approx(42.5)

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_sync_creates_season(self, mock_get, espn_teams, mock_scoreboard_response):
        mock_get.return_value = mock_scoreboard_response

        call_command("sync_espn_games", verbosity=0)

        season = Season.objects.using("nfl").get(year=2025)
        assert season.is_active is True

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_sync_creates_venue(self, mock_get, espn_teams, mock_scoreboard_response):
        mock_get.return_value = mock_scoreboard_response

        call_command("sync_espn_games", verbosity=0)

        venue = Venue.objects.using("nfl").get(espn_id="3948")
        assert venue.name == "Levi's Stadium"
        assert venue.city == "Santa Clara"
        assert venue.is_indoor is False

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_sync_quarter_scores(self, mock_get, espn_teams, mock_scoreboard_response):
        mock_get.return_value = mock_scoreboard_response

        call_command("sync_espn_games", verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")
        assert game.home_score_q1 == 0
        assert game.home_score_q4 == 13
        assert game.away_score_q1 == 3
        assert game.away_score_q4 == 17

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_sync_idempotent(self, mock_get, espn_teams, mock_scoreboard_response):
        """Running sync twice does not create duplicate games."""
        mock_get.return_value = mock_scoreboard_response

        call_command("sync_espn_games", verbosity=0)
        call_command("sync_espn_games", verbosity=0)

        count = Game.objects.using("nfl").filter(espn_event_id="401772988").count()
        assert count == 1

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_sync_leaders(self, mock_get, espn_teams, mock_scoreboard_response):
        sea, ne = espn_teams
        mock_get.return_value = mock_scoreboard_response

        call_command("sync_espn_games", verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")
        leaders = GameLeader.objects.using("nfl").filter(game=game)
        assert leaders.count() == 2  # one per team (passing only in mock)

        sea_leader = leaders.get(team=sea, category="passing")
        assert sea_leader.athlete_name == "Sam Darnold"
        assert sea_leader.display_value == "206 YDS, 1 TD"


# =============================================================================
# FULL SYNC (with drives, plays, scoring plays)
# =============================================================================


class TestSyncESPNFull:
    """Tests for --full sync that pulls game summary data."""

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_full_sync_creates_drives_and_plays(
        self,
        mock_get,
        espn_teams,
        mock_full_sync_response,
    ):
        sea, ne = espn_teams
        mock_get.side_effect = mock_full_sync_response

        call_command("sync_espn_games", full=True, verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")

        # Drives
        drives = Drive.objects.using("nfl").filter(game=game)
        assert drives.count() == 1
        drive = drives.first()
        assert drive.team == sea
        assert drive.total_yards == 22
        assert drive.play_count == 4
        assert drive.result == "punt"

        # Plays
        plays = Play.objects.using("nfl").filter(game=game)
        assert plays.count() == 2

        first_play = plays.get(sequence=1)
        assert first_play.play_type == "run"
        assert first_play.yards_gained == 10
        assert first_play.down == 1
        assert first_play.distance == 10

        second_play = plays.get(sequence=2)
        assert second_play.play_type == "pass"
        assert second_play.yards_gained == 12

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_full_sync_creates_scoring_plays(
        self,
        mock_get,
        espn_teams,
        mock_full_sync_response,
    ):
        sea, ne = espn_teams
        mock_get.side_effect = mock_full_sync_response

        call_command("sync_espn_games", full=True, verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")
        scoring = ScoringPlay.objects.using("nfl").filter(game=game)
        assert scoring.count() == 1

        sp = scoring.first()
        assert sp.team == sea
        assert sp.score_type == "FG"
        assert sp.quarter == 1
        assert sp.away_score_after == 3

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_full_sync_applies_pickcenter_odds(
        self,
        mock_get,
        espn_teams,
        mock_full_sync_response,
    ):
        mock_get.side_effect = mock_full_sync_response

        call_command("sync_espn_games", full=True, verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")
        assert game.spread == pytest.approx(4.5)
        assert game.total == pytest.approx(45.5)
        assert game.spread_line == pytest.approx(4.5)
        assert game.total_line == pytest.approx(45.5)
        assert game.home_moneyline == 190
        assert game.away_moneyline == -230
        assert game.spread_open == pytest.approx(3.5)
        assert game.total_open == pytest.approx(46.5)
        assert game.odds_provider == "Draft Kings"

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_full_sync_writes_raw_summary_and_probabilities(
        self,
        mock_get,
        espn_teams,
        mock_full_sync_response,
    ):
        _ensure_raw_espn_tables()
        _reset_raw_espn_tables()
        mock_get.side_effect = mock_full_sync_response

        call_command("sync_espn_games", full=True, verbosity=0)

        with connections["nfl"].cursor() as cursor:
            cursor.execute("""
                SELECT summary_payload->'gameInfo'->>'attendance'
                FROM raw.raw_espn_summary
                WHERE espn_event_id = '401772988'
                ORDER BY id DESC
                LIMIT 1
            """)
            summary_row = cursor.fetchone()
            assert summary_row is not None
            assert summary_row[0] == "70823"

            cursor.execute("""
                SELECT play_id, sequence, seconds_left, home_win_pct, away_win_pct
                FROM raw.raw_espn_probabilities
                WHERE espn_event_id = '401772988'
                ORDER BY sequence
            """)
            probs = cursor.fetchall()
            assert len(probs) == 2
            assert probs[0][0] == "40177298801"
            assert probs[0][1] == 1
            assert probs[0][2] == 3600
            assert probs[0][3] == pytest.approx(0.45)
            assert probs[0][4] == pytest.approx(0.55)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")
        assert game.attendance == 70823
        assert game.referee == "Dana McKenzie"

        officials = GameOfficial.objects.using("nfl").filter(game=game)
        assert officials.count() == 1
        official = officials.first()
        assert official.name == "Dana McKenzie"
        assert official.position == "Down Judge"

        injuries = PlayerInjury.objects.using("nfl").filter(game=game)
        assert injuries.count() == 1
        injury = injuries.first()
        assert injury.player_espn_id == "1234567"
        assert injury.player_name == "Sam Darnold"
        assert injury.status == "Questionable"
        assert injury.description == "Undisclosed"

        model_probs = (
            WinProbabilityPlay.objects.using("nfl")
            .filter(game=game)
            .order_by("sequence")
        )
        assert model_probs.count() == 2
        assert model_probs[0].home_win_pct == pytest.approx(0.45)
        assert model_probs[0].away_win_pct == pytest.approx(0.55)

        play_1 = Play.objects.using("nfl").get(game=game, sequence=1)
        play_2 = Play.objects.using("nfl").get(game=game, sequence=2)
        assert play_1.home_wp == pytest.approx(0.45)
        assert play_1.away_wp == pytest.approx(0.55)
        assert play_2.home_wp == pytest.approx(0.4)
        assert play_2.away_wp == pytest.approx(0.6)

    @patch("gridstream.management.commands.sync_espn_games.requests.get")
    def test_full_sync_creates_team_and_player_boxscore_stats(
        self,
        mock_get,
        espn_teams,
        espn_players,
        mock_full_sync_response,
    ):
        sea, ne = espn_teams
        sam, drake = espn_players
        mock_get.side_effect = mock_full_sync_response

        call_command("sync_espn_games", full=True, verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")

        team_stats = TeamGameStats.objects.using("nfl").filter(game=game)
        assert team_stats.count() == 2

        sea_stats = team_stats.get(team=sea)
        assert sea_stats.total_yards == 335
        assert sea_stats.third_down_conversions == 4
        assert sea_stats.third_down_attempts == 16
        assert sea_stats.time_of_possession == "33:11"
        assert sea_stats.time_of_possession_seconds == 1991

        player_stats = PlayerGameStats.objects.using("nfl").filter(game=game)
        assert player_stats.count() == 2

        sam_stats = player_stats.get(player=sam)
        assert sam_stats.team == sea
        assert sam_stats.opponent == ne
        assert sam_stats.completions == 19
        assert sam_stats.pass_attempts == 38
        assert sam_stats.passing_yards == 202
        assert sam_stats.passing_tds == 1
        assert sam_stats.sacks_taken == 1
        assert sam_stats.sack_yards_lost == 8
        assert sam_stats.carries == 2
        assert sam_stats.rushing_yards == 5
        assert sam_stats.qbr == pytest.approx(53.0)
        assert sam_stats.passer_rating == pytest.approx(74.7)

        drake_stats = player_stats.get(player=drake)
        assert drake_stats.team == ne
        assert drake_stats.opponent == sea
        assert drake_stats.completions == 27
        assert drake_stats.pass_attempts == 43
        assert drake_stats.interceptions_thrown == 2


# =============================================================================
# STATUS & PLAY TYPE MAPPING
# =============================================================================


class TestStatusMapping:
    """Tests for the status and play type mapping helpers."""

    def test_status_mappings(self):
        from gridstream.management.commands.sync_espn_games import Command

        cmd = Command()

        cases = [
            ({"type": {"state": "pre", "name": "STATUS_SCHEDULED"}}, "scheduled"),
            ({"type": {"state": "in", "name": "STATUS_IN_PROGRESS"}}, "in_progress"),
            ({"type": {"state": "in", "name": "STATUS_HALFTIME"}}, "halftime"),
            ({"type": {"state": "in", "name": "STATUS_DELAYED"}}, "delayed"),
            ({"type": {"state": "post", "name": "STATUS_FINAL"}, "period": 4}, "final"),
            (
                {"type": {"state": "post", "name": "STATUS_FINAL"}, "period": 5},
                "final_ot",
            ),
        ]

        for status_dict, expected in cases:
            result = cmd._map_status(status_dict)
            assert (
                result == expected
            ), f"_map_status({status_dict}) = {result}, want {expected}"

    def test_play_type_mappings(self):
        from gridstream.management.commands.sync_espn_games import Command

        cmd = Command()

        cases = [
            ("Rush", "run"),
            ("Pass Reception", "pass"),
            ("Pass Incompletion", "pass"),
            ("Sack", "pass"),
            ("Punt", "punt"),
            ("Kickoff", "kickoff"),
            ("Field Goal Good", "field_goal"),
            ("Extra Point Good", "extra_point"),
            ("Two-Point Conversion", "two_point_attempt"),
            ("QB Kneel", "qb_kneel"),
            ("Penalty", "no_play"),
        ]

        for espn_type, expected in cases:
            result = cmd._map_play_type(espn_type)
            assert (
                result == expected
            ), f"_map_play_type({espn_type!r}) = {result!r}, want {expected!r}"

    def test_drive_result_mapping_and_truncation(self):
        from gridstream.management.commands.sync_espn_games import Command

        cmd = Command()

        assert cmd._map_drive_result("Turnover on Downs") == "turnover_on_downs"
        assert cmd._map_drive_result("Missed Field Goal") == "missed_fg"

        # Unknown long values should be truncated to Drive.result max length.
        value = cmd._map_drive_result("End Of Fourth Quarter With Timeout")
        assert len(value) <= 20


@pytest.mark.django_db(databases=["nfl"])
def test_resolve_venue_updates_existing_roof_metadata():
    from gridstream.management.commands.sync_espn_games import Command

    existing = Venue.objects.using("nfl").create(
        espn_id="",
        name="Ford Field",
        city="",
        state="",
        roof_type="outdoors",
        is_indoor=False,
        surface="",
    )

    cmd = Command()
    venue = cmd._resolve_venue(
        {
            "id": "3727",
            "fullName": "Ford Field",
            "address": {"city": "Detroit", "state": "MI"},
            "indoor": True,
            "grass": False,
        }
    )

    existing.refresh_from_db(using="nfl")
    assert venue.id == existing.id
    assert existing.espn_id == "3727"
    assert existing.city == "Detroit"
    assert existing.state == "MI"
    assert existing.surface == "turf"
    assert existing.roof_type == "dome"
    assert existing.is_indoor is True
