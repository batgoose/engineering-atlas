from io import StringIO
from unittest.mock import Mock, patch

import pytest
from django.core.management import call_command

from gridstream.models import Team, TeamDvoaRating

pytestmark = [pytest.mark.django_db(databases=["default", "nfl"])]


def _mock_json_response(payload: dict) -> Mock:
    response = Mock()
    response.status_code = 200
    response.json = Mock(return_value=payload)
    response.raise_for_status = Mock()
    return response


def _create_lv_team():
    return Team.objects.using("nfl").create(
        espn_id="13",
        abbreviation="LV",
        slug="las-vegas-raiders",
        location="Las Vegas",
        name="Raiders",
        display_name="Las Vegas Raiders",
        short_display_name="Raiders",
        nickname="Raiders",
        color_primary="000000",
        color_secondary="A5ACAF",
        conference="AFC",
        division="AFC West",
        is_active=True,
    )


def test_sync_dvoa_ratings_ingests_regular_and_playoff(team_sea, team_was):
    _create_lv_team()

    regular_payload = {
        "2025": {
            "SEA": {
                "team": "SEA",
                "year": 2025,
                "week": 18,
                "total_dvoa_rank": 5,
                "total_dvoa": "16.5%",
                "last_week": "6",
                "non_adj_tot_voi": "15.2%",
                "w_l": "12-5",
                "offense_dvoa": "12.1%",
                "offense_rank": 6,
                "defense_dvoa": "-8.4%",
                "defense_rank": 4,
                "special_teams_dvoa": "3.2%",
                "special_teams_rank": 8,
                "offense_voa_unadj": "10.1%",
                "defense_voa_unadj": "-7.2%",
                "special_voa_unadj": "2.7%",
                "estim_wins": "11.8",
                "rank1": 5,
                "wei_dvoa": "18.0%",
                "rank2": 7,
                "past_schedule": "1.5%",
                "rank3": 11,
                "future_schedule": "0.0%",
                "rank4": 16,
                "var": "6.9%",
                "rank5": 4,
            },
            "OAK": {
                "team": "OAK",
                "year": 2025,
                "week": 18,
                "total_dvoa_rank": 20,
                "total_dvoa": "-4.2%",
                "w_l": "8-9",
            },
        }
    }
    playoff_payload = {
        "2025": {
            "SEA": {
                "team": "SEA",
                "year": 2025,
                "week": 22,
                "rank1": 4,
                "total_dvoa": "17.4%",
                "last_week": "5",
                "w_l": "12-5",
                "offense_dvoa": "11.9%",
                "rank2": 7,
                "defense_dvoa": "-9.1%",
                "rank3": 3,
                "special_teams_dvoa": "3.9%",
                "rank4": 6,
                "wei_dvoa": "20.6%",
                "rank5": 3,
                "last_week_wei": "4",
                "wei_offense": "13.8%",
                "rank6": 5,
                "wei_defense": "-10.1%",
                "rank7": 2,
                "wei_st": "4.2%",
                "rank8": 6,
            }
        }
    }

    responses = iter(
        [
            _mock_json_response(regular_payload),
            _mock_json_response(playoff_payload),
        ]
    )

    with patch(
        "gridstream.management.commands.sync_dvoa_ratings.requests.get",
        side_effect=lambda *args, **kwargs: next(responses),
    ):
        call_command(
            "sync_dvoa_ratings",
            batch_size=100,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    sea_reg = TeamDvoaRating.objects.using("nfl").get(
        team=team_sea,
        season=2025,
        season_type="REG",
        week=18,
    )
    assert sea_reg.total_dvoa_rank == 5
    assert sea_reg.total_dvoa == pytest.approx(16.5)
    assert sea_reg.offense_dvoa == pytest.approx(12.1)
    assert sea_reg.defense_dvoa == pytest.approx(-8.4)
    assert sea_reg.special_teams_dvoa == pytest.approx(3.2)
    assert sea_reg.weighted_total_dvoa == pytest.approx(18.0)
    assert sea_reg.metrics_raw["total_dvoa"] == "16.5%"

    sea_post = TeamDvoaRating.objects.using("nfl").get(
        team=team_sea,
        season=2025,
        season_type="POST",
        week=22,
    )
    assert sea_post.total_dvoa_rank == 4
    assert sea_post.weighted_total_dvoa_rank == 3
    assert sea_post.weighted_offense_dvoa == pytest.approx(13.8)
    assert sea_post.weighted_defense_dvoa == pytest.approx(-10.1)
    assert sea_post.weighted_special_teams_dvoa == pytest.approx(4.2)

    lv_reg = TeamDvoaRating.objects.using("nfl").get(
        team__abbreviation="LV",
        season=2025,
        season_type="REG",
        week=18,
    )
    assert lv_reg.total_dvoa_rank == 20
    assert lv_reg.total_dvoa == pytest.approx(-4.2)


def test_sync_dvoa_ratings_respects_season_filter(team_sea):
    regular_payload = {
        "2024": {
            "SEA": {
                "team": "SEA",
                "year": 2024,
                "week": 18,
                "total_dvoa_rank": 9,
                "total_dvoa": "6.2%",
                "w_l": "10-7",
            }
        },
        "2025": {
            "SEA": {
                "team": "SEA",
                "year": 2025,
                "week": 18,
                "total_dvoa_rank": 5,
                "total_dvoa": "16.5%",
                "w_l": "12-5",
            }
        },
    }
    playoff_payload = {
        "2024": {},
        "2025": {},
    }

    responses = iter(
        [
            _mock_json_response(regular_payload),
            _mock_json_response(playoff_payload),
        ]
    )

    with patch(
        "gridstream.management.commands.sync_dvoa_ratings.requests.get",
        side_effect=lambda *args, **kwargs: next(responses),
    ):
        call_command(
            "sync_dvoa_ratings",
            season=[2024],
            batch_size=100,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    seasons = set(TeamDvoaRating.objects.using("nfl").values_list("season", flat=True))
    assert seasons == {2024}
