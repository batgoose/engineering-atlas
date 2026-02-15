"""Tests for /seasons/ and /teams/ endpoints."""

import pytest
from django.urls import reverse
from rest_framework import status

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


# =============================================================================
# SEASONS
# =============================================================================


class TestSeasonEndpoints:
    def test_list_seasons(self, api_client, season):
        url = reverse("season-list")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 1
        assert resp.data[0]["year"] == 2024
        assert resp.data[0]["is_active"] is True
        assert resp.data[0]["current_week"] == 18

    def test_current_season(self, api_client, season):
        url = reverse("season-current")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["year"] == 2024
        assert resp.data["is_active"] is True

    def test_current_season_falls_back_to_most_recent(self, api_client, db):
        """When no active season, return the most recent one."""
        from gridstream.models import Season

        Season.objects.using("nfl").create(year=2023, is_active=False)
        Season.objects.using("nfl").create(year=2022, is_active=False)

        url = reverse("season-current")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["year"] == 2023


# =============================================================================
# TEAMS
# =============================================================================


class TestTeamList:
    def test_list_returns_active_teams(self, api_client, team_sea, team_was):
        url = reverse("team-list")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        abbrs = [t["abbreviation"] for t in resp.data]
        assert "SEA" in abbrs
        assert "WAS" in abbrs

    def test_list_excludes_inactive_by_default(self, api_client, team_sea, db):
        from gridstream.models import Team

        Team.objects.using("nfl").create(
            espn_id="99",
            abbreviation="STL",
            slug="st-louis-rams",
            location="St. Louis",
            name="Rams",
            display_name="St. Louis Rams",
            short_display_name="Rams",
            color_primary="003594",
            conference="NFC",
            division="NFC West",
            is_active=False,
        )

        url = reverse("team-list")
        resp = api_client.get(url)

        abbrs = [t["abbreviation"] for t in resp.data]
        assert "STL" not in abbrs

    def test_list_includes_inactive_with_param(self, api_client, team_sea, db):
        from gridstream.models import Team

        Team.objects.using("nfl").create(
            espn_id="99",
            abbreviation="STL",
            slug="st-louis-rams",
            location="St. Louis",
            name="Rams",
            display_name="St. Louis Rams",
            short_display_name="Rams",
            color_primary="003594",
            conference="NFC",
            division="NFC West",
            is_active=False,
        )

        url = reverse("team-list")
        resp = api_client.get(url, {"include_inactive": "true"})

        abbrs = [t["abbreviation"] for t in resp.data]
        assert "STL" in abbrs

    def test_list_includes_logos(self, api_client, team_sea):
        url = reverse("team-list")
        resp = api_client.get(url)

        sea_data = next(t for t in resp.data if t["abbreviation"] == "SEA")
        assert len(sea_data["logos"]) == 2
        logo_types = [l["logo_type"] for l in sea_data["logos"]]
        assert "default" in logo_types
        assert "dark" in logo_types


class TestTeamDetail:
    def test_retrieve_by_abbreviation(self, api_client, team_sea, social_account_team):
        url = reverse("team-detail", kwargs={"abbreviation": "SEA"})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["abbreviation"] == "SEA"
        assert resp.data["display_name"] == "Seattle Seahawks"
        assert resp.data["conference"] == "NFC"
        assert resp.data["division"] == "NFC West"
        assert len(resp.data["social_accounts"]) >= 1
        assert resp.data["social_accounts"][0]["handle"] == "Seahawks"

    def test_retrieve_nonexistent_returns_404(self, api_client, db):
        url = reverse("team-detail", kwargs={"abbreviation": "ZZZ"})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_404_NOT_FOUND


class TestTeamRoster:
    def test_roster_returns_active_players(
        self, api_client, team_sea, player_qb, player_wr
    ):
        url = reverse("team-roster", kwargs={"abbreviation": "SEA"})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 2
        names = [p["display_name"] for p in resp.data]
        assert "Geno Smith" in names
        assert "DK Metcalf" in names

    def test_roster_filter_by_position(
        self, api_client, team_sea, player_qb, player_wr
    ):
        url = reverse("team-roster", kwargs={"abbreviation": "SEA"})
        resp = api_client.get(url, {"position": "QB"})

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 1
        assert resp.data[0]["position"] == "QB"

    def test_roster_includes_team_abbreviation(self, api_client, team_sea, player_qb):
        url = reverse("team-roster", kwargs={"abbreviation": "SEA"})
        resp = api_client.get(url)

        assert resp.data[0]["current_team_abbr"] == "SEA"


class TestTeamSchedule:
    def test_schedule_returns_team_games(
        self, api_client, team_sea, game_final, game_live
    ):
        url = reverse("team-schedule", kwargs={"abbreviation": "SEA"})
        resp = api_client.get(url, {"season": 2024})

        assert resp.status_code == status.HTTP_200_OK
        # SEA is in both test games (home in final, away in live)
        assert len(resp.data) == 2

    def test_schedule_includes_team_details(self, api_client, team_sea, game_final):
        url = reverse("team-schedule", kwargs={"abbreviation": "SEA"})
        resp = api_client.get(url, {"season": 2024})

        game_data = resp.data[0]
        assert "home_team_detail" in game_data
        assert "away_team_detail" in game_data
        assert game_data["home_team_detail"]["abbreviation"] == "SEA"
