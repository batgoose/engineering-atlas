from datetime import date
from io import StringIO

import pytest
from django.core.management import call_command

from gridstream.models import Game, Season, Team, Venue


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
def test_normalize_venues_merges_duplicates_and_repairs_indoor_flag():
    sea = Team.objects.using("nfl").create(
        **_team_kwargs("26", "SEA", "Seattle", "Seahawks", "NFC", "NFC West")
    )
    ne = Team.objects.using("nfl").create(
        **_team_kwargs("17", "NE", "New England", "Patriots", "AFC", "AFC East")
    )
    season = Season.objects.using("nfl").create(year=2025)

    canonical = Venue.objects.using("nfl").create(
        espn_id="",
        name="Ford Field",
        city="",
        state="",
        roof_type="outdoors",
        is_indoor=False,
    )
    duplicate = Venue.objects.using("nfl").create(
        espn_id="3727",
        name="Ford Field",
        city="Detroit",
        state="MI",
        roof_type="outdoors",
        is_indoor=False,
    )

    game = Game.objects.using("nfl").create(
        espn_event_id="401000777",
        season=season,
        week=1,
        game_date=date(2025, 9, 7),
        season_type="REG",
        home_team=ne,
        away_team=sea,
        venue=duplicate,
    )

    call_command(
        "normalize_venues",
        stdout=StringIO(),
        stderr=StringIO(),
        verbosity=0,
    )

    venues = list(Venue.objects.using("nfl").filter(name="Ford Field").order_by("id"))
    assert len(venues) == 1
    venue = venues[0]
    assert venue.id == duplicate.id
    assert venue.espn_id == "3727"
    assert venue.city == "Detroit"
    assert venue.state == "MI"
    assert venue.roof_type == "dome"
    assert venue.is_indoor is True

    game.refresh_from_db(using="nfl")
    assert game.venue_id == duplicate.id
