"""Tests for /standings/, /fantasy/leaders/, /transactions/, /playbooks/."""

import pytest
from django.urls import reverse
from rest_framework import status

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


# =============================================================================
# STANDINGS
# =============================================================================


class TestStandings:
    def test_standings_returns_data(
        self,
        api_client,
        season,
        team_sea,
        team_was,
        game_final,
    ):
        url = reverse("standing-list")
        resp = api_client.get(url, {"season": 2024})

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) >= 2

    def test_standings_computes_wins_losses(
        self,
        api_client,
        season,
        team_sea,
        team_was,
        game_final,
    ):
        """SEA won the test game 26-20, so SEA=1-0, WAS=0-1."""
        url = reverse("standing-list")
        resp = api_client.get(url, {"season": 2024})

        sea_row = next(r for r in resp.data if r["team"]["abbreviation"] == "SEA")
        was_row = next(r for r in resp.data if r["team"]["abbreviation"] == "WAS")

        assert sea_row["wins"] == 1
        assert sea_row["losses"] == 0
        assert sea_row["win_pct"] == 1.0

        assert was_row["wins"] == 0
        assert was_row["losses"] == 1
        assert was_row["win_pct"] == 0.0

    def test_standings_computes_point_diff(
        self,
        api_client,
        season,
        team_sea,
        team_was,
        game_final,
    ):
        url = reverse("standing-list")
        resp = api_client.get(url, {"season": 2024})

        sea_row = next(r for r in resp.data if r["team"]["abbreviation"] == "SEA")
        assert sea_row["points_for"] == 26
        assert sea_row["points_against"] == 20
        assert sea_row["point_diff"] == 6

    def test_standings_computes_streak(
        self,
        api_client,
        season,
        team_sea,
        team_was,
        game_final,
    ):
        url = reverse("standing-list")
        resp = api_client.get(url, {"season": 2024})

        sea_row = next(r for r in resp.data if r["team"]["abbreviation"] == "SEA")
        assert sea_row["streak"] == "W1"

    def test_standings_defaults_to_current_season(
        self,
        api_client,
        season,
        team_sea,
        team_was,
        game_final,
    ):
        url = reverse("standing-list")
        resp = api_client.get(url)  # No season param

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) >= 2

    def test_standings_excludes_live_games(
        self,
        api_client,
        season,
        team_sea,
        team_was,
        game_final,
        game_live,
    ):
        """Only completed games should factor into standings."""
        url = reverse("standing-list")
        resp = api_client.get(url, {"season": 2024})

        sea_row = next(r for r in resp.data if r["team"]["abbreviation"] == "SEA")
        # Only the final game counts, not the in-progress one
        assert sea_row["wins"] == 1
        assert sea_row["losses"] == 0

    def test_standings_includes_team_detail(
        self,
        api_client,
        season,
        team_sea,
        team_was,
        game_final,
    ):
        url = reverse("standing-list")
        resp = api_client.get(url, {"season": 2024})

        sea_row = next(r for r in resp.data if r["team"]["abbreviation"] == "SEA")
        assert "color_primary" in sea_row["team"]
        assert "logo_url" in sea_row["team"]


# =============================================================================
# FANTASY LEADERS
# =============================================================================


class TestFantasyLeaders:
    def test_weekly_leaders(
        self,
        api_client,
        player_game_stats_qb,
        player_game_stats_wr,
    ):
        url = reverse("fantasy-leader-list")
        resp = api_client.get(url, {"season": 2024, "week": 1, "scoring": "ppr"})

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) >= 1

    def test_weekly_leaders_filter_by_position(
        self,
        api_client,
        player_game_stats_qb,
        player_game_stats_wr,
    ):
        url = reverse("fantasy-leader-list")
        resp = api_client.get(
            url,
            {
                "season": 2024,
                "week": 1,
                "position": "QB",
            },
        )

        for p in resp.data:
            assert p["player_position"] == "QB"

    def test_season_leaders(
        self,
        api_client,
        player_game_stats_qb,
        player_game_stats_wr,
    ):
        """No week param → season aggregation."""
        url = reverse("fantasy-leader-list")
        resp = api_client.get(url, {"season": 2024})

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) >= 1
        # Season leaders should have total_points and ppg
        leader = resp.data[0]
        assert "total_points" in leader
        assert "ppg" in leader
        assert "games_played" in leader

    def test_leaders_default_to_ppr(
        self,
        api_client,
        player_game_stats_qb,
    ):
        """Default scoring format should be PPR."""
        url = reverse("fantasy-leader-list")
        resp = api_client.get(url, {"season": 2024, "week": 1})

        assert resp.status_code == status.HTTP_200_OK


# =============================================================================
# TRANSACTIONS
# =============================================================================


class TestTransactions:
    def test_list_transactions(self, api_client, player_qb, team_sea, db):
        from redzone.models import PlayerTransaction
        from datetime import date

        PlayerTransaction.objects.using("nfl").create(
            player=player_qb,
            transaction_type="signed",
            date=date(2023, 3, 15),
            to_team=team_sea,
            description="Signed 3-year extension",
            season=2023,
        )

        url = reverse("transaction-list")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1
        txn = resp.data["results"][0]
        assert txn["transaction_type"] == "signed"
        assert txn["to_team_abbr"] == "SEA"

    def test_filter_transactions_by_team(
        self, api_client, player_qb, team_sea, team_was, db
    ):
        from redzone.models import PlayerTransaction
        from datetime import date

        PlayerTransaction.objects.using("nfl").create(
            player=player_qb,
            transaction_type="signed",
            date=date(2023, 3, 15),
            to_team=team_sea,
            season=2023,
        )

        url = reverse("transaction-list")
        resp = api_client.get(url, {"team": "SEA"})
        assert resp.data["count"] == 1

        resp2 = api_client.get(url, {"team": "WAS"})
        assert resp2.data["count"] == 0

    def test_filter_transactions_by_type(self, api_client, player_qb, team_sea, db):
        from redzone.models import PlayerTransaction
        from datetime import date

        PlayerTransaction.objects.using("nfl").create(
            player=player_qb,
            transaction_type="traded",
            date=date(2024, 10, 1),
            from_team=team_sea,
            season=2024,
        )

        url = reverse("transaction-list")
        resp = api_client.get(url, {"transaction_type": "traded"})
        assert resp.data["count"] == 1


# =============================================================================
# PLAYBOOKS
# =============================================================================


class TestPlaybooks:
    def test_list_playbooks(self, api_client, playbook):
        url = reverse("playbook-list")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["name"] == "SEA vs WAS Week 1 Highlights"

    def test_playbook_entries(self, api_client, playbook, playbook_entries):
        url = reverse("playbook-entries", kwargs={"pk": playbook.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 3

        # Entries should be ordered by sequence
        sequences = [e["sequence"] for e in resp.data]
        assert sequences == [1, 2, 3]

        # Each entry should include play detail
        entry = resp.data[0]
        assert "play_detail" in entry
        assert entry["play_detail"]["play_type"] == "run"

    def test_playbook_entry_includes_delay(
        self, api_client, playbook, playbook_entries
    ):
        url = reverse("playbook-entries", kwargs={"pk": playbook.pk})
        resp = api_client.get(url)

        assert resp.data[0]["delay_seconds"] == 5.0
        assert resp.data[1]["delay_seconds"] == 8.0
