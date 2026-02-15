"""
Tests for the ESPN sync flow and gridstream models.

Uses mocked ESPN responses to verify mapping and idempotency.
"""

import pytest
from datetime import date
from unittest.mock import MagicMock, patch

from django.core.management import call_command

from gridstream.models import (
    Drive,
    Game,
    GameLeader,
    Play,
    ScoringPlay,
    Season,
    Team,
    Venue,
)

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


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
