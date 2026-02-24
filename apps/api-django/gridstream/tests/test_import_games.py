import csv
import io
from io import StringIO
from unittest.mock import Mock, patch

import pytest
from django.core.management import call_command

from gridstream.models import Game, GameLeader, Season, Team, Venue

FIELDNAMES = [
    "game_id",
    "season",
    "game_type",
    "week",
    "gameday",
    "weekday",
    "gametime",
    "away_team",
    "away_score",
    "home_team",
    "home_score",
    "location",
    "result",
    "total",
    "overtime",
    "old_game_id",
    "gsis",
    "nfl_detail_id",
    "pfr",
    "pff",
    "espn",
    "ftn",
    "away_rest",
    "home_rest",
    "away_moneyline",
    "home_moneyline",
    "spread_line",
    "away_spread_odds",
    "home_spread_odds",
    "total_line",
    "under_odds",
    "over_odds",
    "div_game",
    "roof",
    "surface",
    "temp",
    "wind",
    "away_qb_id",
    "home_qb_id",
    "away_qb_name",
    "home_qb_name",
    "away_coach",
    "home_coach",
    "referee",
    "stadium_id",
    "stadium",
]


def _build_csv(rows):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDNAMES)
    writer.writeheader()
    for row in rows:
        payload = {k: row.get(k, "") for k in FIELDNAMES}
        writer.writerow(payload)
    return buf.getvalue().encode("utf-8")


def _team_kwargs(espn_id, abbr, location, name, conference, division):
    return {
        "espn_id": espn_id,
        "abbreviation": abbr,
        "slug": f"{location.lower().replace(' ', '-')}-{name.lower()}",
        "location": location,
        "name": name,
        "display_name": f"{location} {name}",
        "short_display_name": name,
        "color_primary": "002a5c",
        "conference": conference,
        "division": division,
    }


@pytest.mark.django_db(databases=["nfl"])
def test_import_games_uses_games_csv_and_populates_fields():
    Team.objects.using("nfl").create(
        **_team_kwargs("16", "ATL", "Atlanta", "Falcons", "NFC", "NFC South")
    )
    Team.objects.using("nfl").create(
        **_team_kwargs("23", "MIN", "Minnesota", "Vikings", "NFC", "NFC North")
    )

    csv_bytes = _build_csv(
        [
            {
                "game_id": "1999_01_MIN_ATL",
                "season": "1999",
                "game_type": "REG",
                "week": "1",
                "gameday": "1999-09-12",
                "weekday": "Sunday",
                "gametime": "13:00",
                "away_team": "MIN",
                "away_score": "17",
                "home_team": "ATL",
                "home_score": "14",
                "overtime": "0",
                "pfr": "199909120atl",
                "espn": "190912001",
                "away_rest": "7",
                "home_rest": "7",
                "away_moneyline": "130",
                "home_moneyline": "-150",
                "spread_line": "-4",
                "away_spread_odds": "-108",
                "home_spread_odds": "-112",
                "total_line": "49",
                "under_odds": "-105",
                "over_odds": "-115",
                "div_game": "0",
                "roof": "dome",
                "surface": "astroturf",
                "temp": "72",
                "wind": "5",
                "away_qb_name": "Randall Cunningham",
                "home_qb_name": "Chris Chandler",
                "away_coach": "Dennis Green",
                "home_coach": "Dan Reeves",
                "referee": "Gerry Austin",
                "stadium_id": "ATL00",
                "stadium": "Georgia Dome",
            }
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = csv_bytes
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_games.requests.get",
        return_value=response,
    ):
        call_command(
            "import_games",
            season=[1999],
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    game = Game.objects.using("nfl").get(nflverse_game_id="1999_01_MIN_ATL")
    assert game.espn_event_id == "190912001"
    assert game.pfr_game_id == "199909120atl"
    assert game.home_team.abbreviation == "ATL"
    assert game.away_team.abbreviation == "MIN"
    assert game.status == "final"
    assert game.overtime is False
    assert game.home_score == 14
    assert game.away_score == 17
    assert game.home_coach == "Dan Reeves"
    assert game.away_coach == "Dennis Green"
    assert game.home_qb_name == "Chris Chandler"
    assert game.away_qb_name == "Randall Cunningham"
    assert game.referee == "Gerry Austin"
    assert game.attendance is None
    assert game.home_rest == 7
    assert game.away_rest == 7
    assert game.div_game is False
    assert game.spread == pytest.approx(-4.0)
    assert game.total == pytest.approx(49.0)
    assert game.spread_line == pytest.approx(-4.0)
    assert game.total_line == pytest.approx(49.0)
    assert game.home_moneyline == -150
    assert game.away_moneyline == 130
    assert game.home_spread_odds == -112
    assert game.away_spread_odds == -108
    assert game.under_odds == -105
    assert game.over_odds == -115
    assert game.weather_temp == 72
    assert game.weather_wind == "5 mph"
    assert game.is_division_game is False
    assert Season.objects.using("nfl").filter(year=1999).exists()

    venue = Venue.objects.using("nfl").get(espn_id="ATL00")
    assert venue.name == "Georgia Dome"
    assert venue.roof_type == "dome"
    assert venue.is_indoor is True


@pytest.mark.django_db(databases=["nfl"])
def test_import_games_maps_historical_team_abbreviations():
    Team.objects.using("nfl").create(
        **_team_kwargs("12", "KC", "Kansas City", "Chiefs", "AFC", "AFC West")
    )
    Team.objects.using("nfl").create(
        **_team_kwargs("13", "LV", "Las Vegas", "Raiders", "AFC", "AFC West")
    )

    csv_bytes = _build_csv(
        [
            {
                "game_id": "2020_01_OAK_KC",
                "season": "2020",
                "game_type": "REG",
                "week": "1",
                "gameday": "2020-09-13",
                "gametime": "16:25",
                "away_team": "OAK",
                "away_score": "24",
                "home_team": "KC",
                "home_score": "31",
                "overtime": "1",
                "espn": "401220111",
                "div_game": "1",
                "stadium": "Arrowhead Stadium",
            }
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = csv_bytes
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_games.requests.get",
        return_value=response,
    ):
        call_command(
            "import_games",
            season=[2020],
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    game = Game.objects.using("nfl").get(nflverse_game_id="2020_01_OAK_KC")
    assert game.away_team.abbreviation == "LV"
    assert game.home_team.abbreviation == "KC"
    assert game.status == "final_ot"
    assert game.overtime is True
    assert game.quarter == 5
    assert game.div_game is True
    assert game.is_division_game is True


@pytest.mark.django_db(databases=["nfl"])
def test_import_games_applies_known_espn_event_id_override():
    Team.objects.using("nfl").create(
        **_team_kwargs("10", "TEN", "Tennessee", "Titans", "AFC", "AFC Central")
    )
    Team.objects.using("nfl").create(
        **_team_kwargs("2", "BUF", "Buffalo", "Bills", "AFC", "AFC East")
    )

    csv_bytes = _build_csv(
        [
            {
                "game_id": "1999_18_BUF_TEN",
                "season": "1999",
                "game_type": "WC",
                "week": "18",
                "gameday": "2000-01-08",
                "gametime": "13:00",
                "away_team": "BUF",
                "away_score": "16",
                "home_team": "TEN",
                "home_score": "22",
                # Known bad value in source; command should override this.
                "espn": "200109010",
                "stadium": "Nissan Stadium",
            }
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = csv_bytes
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_games.requests.get",
        return_value=response,
    ):
        call_command(
            "import_games",
            season=[1999],
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    game = Game.objects.using("nfl").get(nflverse_game_id="1999_18_BUF_TEN")
    assert game.espn_event_id == "200108010"


@pytest.mark.django_db(databases=["nfl"])
def test_import_games_sets_retractable_roof_overrides():
    Team.objects.using("nfl").create(
        **_team_kwargs("16", "DAL", "Dallas", "Cowboys", "NFC", "NFC East")
    )
    Team.objects.using("nfl").create(
        **_team_kwargs("23", "NYG", "New York", "Giants", "NFC", "NFC East")
    )

    csv_bytes = _build_csv(
        [
            {
                "game_id": "2024_01_NYG_DAL",
                "season": "2024",
                "game_type": "REG",
                "week": "1",
                "gameday": "2024-09-08",
                "gametime": "20:20",
                "away_team": "NYG",
                "away_score": "10",
                "home_team": "DAL",
                "home_score": "24",
                "espn": "401000001",
                "div_game": "1",
                "roof": "open",
                "surface": "fieldturf",
                "stadium_id": "DAL00",
                "stadium": "AT&T Stadium",
            }
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = csv_bytes
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_games.requests.get",
        return_value=response,
    ):
        call_command(
            "import_games",
            season=[2024],
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    venue = Venue.objects.using("nfl").get(espn_id="DAL00")
    assert venue.name == "AT&T Stadium"
    assert venue.roof_type == "retractable"
    assert venue.is_indoor is False


@pytest.mark.django_db(databases=["nfl"])
def test_import_games_merges_duplicate_nflverse_and_espn_rows():
    sea = Team.objects.using("nfl").create(
        **_team_kwargs("26", "SEA", "Seattle", "Seahawks", "NFC", "NFC West")
    )
    ne = Team.objects.using("nfl").create(
        **_team_kwargs("17", "NE", "New England", "Patriots", "AFC", "AFC East")
    )
    season = Season.objects.using("nfl").create(year=2025)

    canonical = Game.objects.using("nfl").create(
        espn_event_id="nflv_2025_01_SEA_NE",
        nflverse_game_id="2025_01_SEA_NE",
        season=season,
        week=1,
        game_date="2025-09-07",
        season_type="REG",
        home_team=ne,
        away_team=sea,
    )
    duplicate = Game.objects.using("nfl").create(
        espn_event_id="401772988",
        nflverse_game_id="",
        season=season,
        week=1,
        game_date="2025-09-07",
        season_type="REG",
        home_team=ne,
        away_team=sea,
    )
    GameLeader.objects.using("nfl").create(
        game=duplicate,
        team=sea,
        category="passing",
        athlete_name="Sam Darnold",
        display_value="202 YDS, 1 TD",
    )

    csv_bytes = _build_csv(
        [
            {
                "game_id": "2025_01_SEA_NE",
                "season": "2025",
                "game_type": "REG",
                "week": "1",
                "gameday": "2025-09-07",
                "gametime": "20:20",
                "away_team": "SEA",
                "away_score": "29",
                "home_team": "NE",
                "home_score": "13",
                "espn": "401772988",
                "div_game": "0",
                "stadium": "Gillette Stadium",
            }
        ]
    )
    response = Mock()
    response.status_code = 200
    response.content = csv_bytes
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_games.requests.get",
        return_value=response,
    ):
        call_command(
            "import_games",
            season=[2025],
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    games = list(
        Game.objects.using("nfl")
        .filter(nflverse_game_id="2025_01_SEA_NE")
        .order_by("id")
    )
    assert len(games) == 1
    assert games[0].id == canonical.id
    assert games[0].espn_event_id == "401772988"
    assert not Game.objects.using("nfl").filter(id=duplicate.id).exists()

    leader = GameLeader.objects.using("nfl").get(athlete_name="Sam Darnold")
    assert leader.game_id == canonical.id


@pytest.mark.django_db(databases=["nfl"])
def test_import_games_dry_run_writes_nothing():
    Team.objects.using("nfl").create(
        **_team_kwargs("16", "ATL", "Atlanta", "Falcons", "NFC", "NFC South")
    )
    Team.objects.using("nfl").create(
        **_team_kwargs("23", "MIN", "Minnesota", "Vikings", "NFC", "NFC North")
    )

    csv_bytes = _build_csv(
        [
            {
                "game_id": "1999_01_MIN_ATL",
                "season": "1999",
                "game_type": "REG",
                "week": "1",
                "gameday": "1999-09-12",
                "away_team": "MIN",
                "away_score": "17",
                "home_team": "ATL",
                "home_score": "14",
                "espn": "190912001",
            }
        ]
    )
    response = Mock()
    response.status_code = 200
    response.content = csv_bytes
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_games.requests.get",
        return_value=response,
    ):
        call_command(
            "import_games",
            season=[1999],
            dry_run=True,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    assert Game.objects.using("nfl").count() == 0
