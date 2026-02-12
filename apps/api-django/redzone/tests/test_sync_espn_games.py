"""
tests for the espn sync flow and redzone models

uses mocked espn responses to verify mapping and idempotency
"""

from datetime import date
from unittest.mock import MagicMock, patch

from django.test import TestCase

from redzone.models import (
    Drive,
    Game,
    GameLeader,
    Play,
    ScoringPlay,
    Season,
    Team,
    Venue,
)


# fixtures

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
                                                "position": {
                                                    "abbreviation": "QB"
                                                },
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
                                                "position": {
                                                    "abbreviation": "QB"
                                                },
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


# tests


class ESPNSyncTestBase(TestCase):
    """base class with shared team fixtures"""

    databases = {"default", "nfl"}

    @classmethod
    def setUpTestData(cls):
        cls.sea = Team.objects.using("nfl").create(
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
        cls.ne = Team.objects.using("nfl").create(
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


class SyncESPNGamesTest(ESPNSyncTestBase):
    """tests for sync_espn_games command"""

    @patch("redzone.management.commands.sync_espn_games.requests.get")
    def test_sync_creates_game(self, mock_get):
        """scoreboard sync creates a game record"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = MOCK_SCOREBOARD
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        from django.core.management import call_command

        call_command("sync_espn_games", verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")
        self.assertEqual(game.home_team, self.ne)
        self.assertEqual(game.away_team, self.sea)
        self.assertEqual(game.home_score, 13)
        self.assertEqual(game.away_score, 29)
        self.assertEqual(game.status, "final")
        self.assertEqual(game.game_note, "Super Bowl LX")
        self.assertEqual(game.broadcast_names, ["NBC", "Peacock"])
        self.assertAlmostEqual(game.spread, 5.5)
        self.assertAlmostEqual(game.total, 42.5)

    @patch("redzone.management.commands.sync_espn_games.requests.get")
    def test_sync_creates_season(self, mock_get):
        """sync creates a season record"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = MOCK_SCOREBOARD
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        from django.core.management import call_command

        call_command("sync_espn_games", verbosity=0)

        season = Season.objects.using("nfl").get(year=2025)
        self.assertTrue(season.is_active)

    @patch("redzone.management.commands.sync_espn_games.requests.get")
    def test_sync_creates_venue(self, mock_get):
        """sync creates a venue from espn data"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = MOCK_SCOREBOARD
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        from django.core.management import call_command

        call_command("sync_espn_games", verbosity=0)

        venue = Venue.objects.using("nfl").get(espn_id="3948")
        self.assertEqual(venue.name, "Levi's Stadium")
        self.assertEqual(venue.city, "Santa Clara")
        self.assertFalse(venue.is_indoor)

    @patch("redzone.management.commands.sync_espn_games.requests.get")
    def test_sync_quarter_scores(self, mock_get):
        """sync maps linescore data to quarter score fields"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = MOCK_SCOREBOARD
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        from django.core.management import call_command

        call_command("sync_espn_games", verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")
        self.assertEqual(game.home_score_q1, 0)
        self.assertEqual(game.home_score_q4, 13)
        self.assertEqual(game.away_score_q1, 3)
        self.assertEqual(game.away_score_q4, 17)

    @patch("redzone.management.commands.sync_espn_games.requests.get")
    def test_sync_idempotent(self, mock_get):
        """running sync twice does not create duplicate games"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = MOCK_SCOREBOARD
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        from django.core.management import call_command

        call_command("sync_espn_games", verbosity=0)
        call_command("sync_espn_games", verbosity=0)

        count = Game.objects.using("nfl").filter(espn_event_id="401772988").count()
        self.assertEqual(count, 1)

    @patch("redzone.management.commands.sync_espn_games.requests.get")
    def test_sync_leaders(self, mock_get):
        """sync creates gameleader records"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = MOCK_SCOREBOARD
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        from django.core.management import call_command

        call_command("sync_espn_games", verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")
        leaders = GameLeader.objects.using("nfl").filter(game=game)
        self.assertEqual(leaders.count(), 2)  # one per team (passing only in mock)

        sea_leader = leaders.get(team=self.sea, category="passing")
        self.assertEqual(sea_leader.athlete_name, "Sam Darnold")
        self.assertEqual(sea_leader.display_value, "206 YDS, 1 TD")


class SyncESPNFullTest(ESPNSyncTestBase):
    """tests for --full sync"""

    @patch("redzone.management.commands.sync_espn_games.requests.get")
    def test_full_sync_creates_drives_and_plays(self, mock_get):
        """full sync creates drive and play records"""

        def side_effect(url, **kwargs):
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.raise_for_status = MagicMock()
            if "summary" in url:
                mock_resp.json.return_value = MOCK_SUMMARY
            else:
                mock_resp.json.return_value = MOCK_SCOREBOARD
            return mock_resp

        mock_get.side_effect = side_effect

        from django.core.management import call_command

        call_command("sync_espn_games", full=True, verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")

        # drives
        drives = Drive.objects.using("nfl").filter(game=game)
        self.assertEqual(drives.count(), 1)
        drive = drives.first()
        self.assertEqual(drive.team, self.sea)
        self.assertEqual(drive.total_yards, 22)
        self.assertEqual(drive.play_count, 4)
        self.assertEqual(drive.result, "punt")

        # plays
        plays = Play.objects.using("nfl").filter(game=game)
        self.assertEqual(plays.count(), 2)

        first_play = plays.get(sequence=1)
        self.assertEqual(first_play.play_type, "run")
        self.assertEqual(first_play.yards_gained, 10)
        self.assertEqual(first_play.down, 1)
        self.assertEqual(first_play.distance, 10)

        second_play = plays.get(sequence=2)
        self.assertEqual(second_play.play_type, "pass")
        self.assertEqual(second_play.yards_gained, 12)

    @patch("redzone.management.commands.sync_espn_games.requests.get")
    def test_full_sync_creates_scoring_plays(self, mock_get):
        """full sync creates scoringplay records"""

        def side_effect(url, **kwargs):
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.raise_for_status = MagicMock()
            if "summary" in url:
                mock_resp.json.return_value = MOCK_SUMMARY
            else:
                mock_resp.json.return_value = MOCK_SCOREBOARD
            return mock_resp

        mock_get.side_effect = side_effect

        from django.core.management import call_command

        call_command("sync_espn_games", full=True, verbosity=0)

        game = Game.objects.using("nfl").get(espn_event_id="401772988")
        scoring = ScoringPlay.objects.using("nfl").filter(game=game)
        self.assertEqual(scoring.count(), 1)

        sp = scoring.first()
        self.assertEqual(sp.team, self.sea)
        self.assertEqual(sp.score_type, "FG")
        self.assertEqual(sp.quarter, 1)
        self.assertEqual(sp.away_score_after, 3)


class StatusMappingTest(TestCase):
    """tests for the status mapping helper"""

    def test_status_mappings(self):
        from redzone.management.commands.sync_espn_games import Command

        cmd = Command()

        cases = [
            ({"type": {"state": "pre", "name": "STATUS_SCHEDULED"}}, "scheduled"),
            (
                {"type": {"state": "in", "name": "STATUS_IN_PROGRESS"}},
                "in_progress",
            ),
            ({"type": {"state": "in", "name": "STATUS_HALFTIME"}}, "halftime"),
            ({"type": {"state": "in", "name": "STATUS_DELAYED"}}, "delayed"),
            (
                {
                    "type": {"state": "post", "name": "STATUS_FINAL"},
                    "period": 4,
                },
                "final",
            ),
            (
                {
                    "type": {"state": "post", "name": "STATUS_FINAL"},
                    "period": 5,
                },
                "final_ot",
            ),
        ]

        for status_dict, expected in cases:
            result = cmd._map_status(status_dict)
            self.assertEqual(
                result,
                expected,
                f"_map_status({status_dict}) = {result}, want {expected}",
            )

    def test_play_type_mappings(self):
        from redzone.management.commands.sync_espn_games import Command

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
            self.assertEqual(
                result,
                expected,
                f"_map_play_type({espn_type!r}) = {result!r}, want {expected!r}",
            )
