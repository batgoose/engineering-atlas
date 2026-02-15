"""Tests for /players/ endpoints — list, detail, gamelog, splits."""

import pytest
from django.urls import reverse
from rest_framework import status

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


# =============================================================================
# PLAYER LIST & SEARCH
# =============================================================================


class TestPlayerList:
    def test_list_players(self, api_client, player_qb, player_wr):
        url = reverse("player-list")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 2

    def test_filter_by_team(self, api_client, player_qb, player_wr, player_was_qb):
        url = reverse("player-list")
        resp = api_client.get(url, {"team": "SEA"})

        assert resp.data["count"] == 2  # QB + WR on SEA
        names = [p["display_name"] for p in resp.data["results"]]
        assert "Jayden Daniels" not in names

    def test_filter_by_position(self, api_client, player_qb, player_wr, player_was_qb):
        url = reverse("player-list")
        resp = api_client.get(url, {"position": "QB"})

        assert resp.data["count"] == 2  # Both QBs
        positions = {p["position"] for p in resp.data["results"]}
        assert positions == {"QB"}

    def test_filter_by_position_group(self, api_client, player_qb, player_wr):
        url = reverse("player-list")
        resp = api_client.get(url, {"position_group": "WR"})

        assert resp.data["count"] == 1
        assert resp.data["results"][0]["display_name"] == "DK Metcalf"

    def test_search_by_name(self, api_client, player_qb, player_wr, player_was_qb):
        url = reverse("player-list")
        resp = api_client.get(url, {"search": "Metcalf"})

        assert resp.data["count"] == 1
        assert resp.data["results"][0]["display_name"] == "DK Metcalf"

    def test_search_by_partial_name(self, api_client, player_qb, player_wr):
        url = reverse("player-list")
        resp = api_client.get(url, {"search": "geno"})

        assert resp.data["count"] == 1
        assert resp.data["results"][0]["display_name"] == "Geno Smith"

    def test_search_by_gsis_id(self, api_client, player_qb):
        url = reverse("player-list")
        resp = api_client.get(url, {"search": "00-0033873"})

        assert resp.data["count"] == 1

    def test_list_includes_team_abbreviation(self, api_client, player_qb):
        url = reverse("player-list")
        resp = api_client.get(url)

        player = resp.data["results"][0]
        assert "current_team_abbr" in player
        assert player["current_team_abbr"] == "SEA"

    def test_list_includes_team_colors(self, api_client, player_qb):
        url = reverse("player-list")
        resp = api_client.get(url)

        player = resp.data["results"][0]
        assert player["current_team_colors"]["primary"] == "002244"
        assert player["current_team_colors"]["secondary"] == "69BE28"

    def test_filter_by_active_status(self, api_client, player_qb, db):
        from gridstream.models import Player

        Player.objects.using("nfl").create(
            gsis_id="00-RETIRED",
            display_name="Retired Guy",
            first_name="Retired",
            last_name="Guy",
            position="QB",
            is_active=False,
        )

        url = reverse("player-list")
        resp = api_client.get(url, {"is_active": "true"})

        names = [p["display_name"] for p in resp.data["results"]]
        assert "Retired Guy" not in names


# =============================================================================
# PLAYER DETAIL
# =============================================================================


class TestPlayerDetail:
    def test_retrieve_player(
        self,
        api_client,
        player_qb,
        player_contract,
        social_account_player,
    ):
        url = reverse("player-detail", kwargs={"pk": player_qb.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        data = resp.data
        assert data["display_name"] == "Geno Smith"
        assert data["position"] == "QB"
        assert data["jersey_number"] == "7"
        assert data["gsis_id"] == "00-0033873"

    def test_detail_includes_current_team(self, api_client, player_qb):
        url = reverse("player-detail", kwargs={"pk": player_qb.pk})
        resp = api_client.get(url)

        assert resp.data["current_team_detail"]["abbreviation"] == "SEA"

    def test_detail_includes_contracts(self, api_client, player_qb, player_contract):
        url = reverse("player-detail", kwargs={"pk": player_qb.pk})
        resp = api_client.get(url)

        assert len(resp.data["contracts"]) == 1
        contract = resp.data["contracts"][0]
        assert contract["total_value"] == 75000000
        assert contract["apy"] == 25000000
        assert contract["years"] == 3
        assert contract["team_abbr"] == "SEA"

    def test_detail_includes_combine(self, api_client, player_wr, player_combine):
        url = reverse("player-detail", kwargs={"pk": player_wr.pk})
        resp = api_client.get(url)

        assert len(resp.data["combine_results"]) == 1
        combine = resp.data["combine_results"][0]
        assert combine["forty_yard"] == 4.33
        assert combine["bench_press"] == 27

    def test_detail_includes_college_history(
        self, api_client, player_wr, player_college
    ):
        url = reverse("player-detail", kwargs={"pk": player_wr.pk})
        resp = api_client.get(url)

        assert len(resp.data["college_history"]) == 1
        ch = resp.data["college_history"][0]
        assert ch["college"] == "Ole Miss"
        assert ch["conference"] == "SEC"
        assert ch["is_redshirt"] is True

    def test_detail_includes_social_accounts(
        self, api_client, player_qb, social_account_player
    ):
        url = reverse("player-detail", kwargs={"pk": player_qb.pk})
        resp = api_client.get(url)

        assert len(resp.data["social_accounts"]) == 1
        sa = resp.data["social_accounts"][0]
        assert sa["platform"] == "instagram"
        assert sa["handle"] == "genosmith"

    def test_detail_includes_bio_fields(self, api_client, player_qb):
        url = reverse("player-detail", kwargs={"pk": player_qb.pk})
        resp = api_client.get(url)

        assert resp.data["height"] == "6-3"
        assert resp.data["height_inches"] == 75
        assert resp.data["weight"] == 221
        assert resp.data["college"] == "West Virginia"
        assert resp.data["draft_year"] == 2013
        assert resp.data["draft_round"] == 2
        assert resp.data["draft_overall"] == 39

    def test_retrieve_nonexistent_returns_404(self, api_client, db):
        url = reverse("player-detail", kwargs={"pk": 99999})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# PLAYER GAMELOG
# =============================================================================


class TestPlayerGamelog:
    def test_gamelog_returns_stats(
        self,
        api_client,
        player_qb,
        player_game_stats_qb,
    ):
        url = reverse("player-gamelog", kwargs={"pk": player_qb.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1
        stat = resp.data["results"][0]
        assert stat["passing_yards"] == 280
        assert stat["passing_tds"] == 2
        assert stat["completions"] == 22
        assert stat["pass_attempts"] == 31

    def test_gamelog_filter_by_season(
        self,
        api_client,
        player_qb,
        player_game_stats_qb,
    ):
        url = reverse("player-gamelog", kwargs={"pk": player_qb.pk})

        # Correct season
        resp = api_client.get(url, {"season": 2024})
        assert resp.data["count"] == 1

        # Wrong season
        resp = api_client.get(url, {"season": 2023})
        assert resp.data["count"] == 0

    def test_gamelog_includes_opponent(
        self,
        api_client,
        player_qb,
        player_game_stats_qb,
    ):
        url = reverse("player-gamelog", kwargs={"pk": player_qb.pk})
        resp = api_client.get(url)

        stat = resp.data["results"][0]
        assert stat["opponent_abbr"] == "WAS"
        assert stat["team_abbr"] == "SEA"

    def test_gamelog_includes_fantasy_points(
        self,
        api_client,
        player_qb,
        player_game_stats_qb,
    ):
        url = reverse("player-gamelog", kwargs={"pk": player_qb.pk})
        resp = api_client.get(url)

        stat = resp.data["results"][0]
        # Fantasy points are auto-computed on save
        assert stat["fantasy_points_ppr"] is not None
        assert stat["fantasy_points_standard"] is not None


# =============================================================================
# PLAYER SPLITS
# =============================================================================


class TestPlayerSplits:
    def test_splits_returns_home_away(
        self,
        api_client,
        player_qb,
        player_game_stats_qb,
    ):
        url = reverse("player-splits", kwargs={"pk": player_qb.pk})
        resp = api_client.get(url, {"season": 2024})

        assert resp.status_code == status.HTTP_200_OK
        assert "home" in resp.data
        assert "away" in resp.data

        # Our test game has SEA as home team
        assert resp.data["home"]["games"] == 1
        assert resp.data["home"]["pass_yds"] == 280
        assert resp.data["away"]["games"] == 0
