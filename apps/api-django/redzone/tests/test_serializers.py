"""Tests for serializer behavior and model methods."""

import pytest
from rest_framework import status

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


# =============================================================================
# FANTASY POINT CALCULATION
# =============================================================================


class TestFantasyPointCalculation:
    """Test the PlayerGameStats.calculate_fantasy_points method."""

    def test_standard_scoring(self, player_game_stats_qb):
        pts = player_game_stats_qb.calculate_fantasy_points("standard")
        # 280 * 0.04 = 11.2 (passing yards)
        # 2 * 4 = 8 (passing TDs)
        # 1 * -2 = -2 (interception)
        # 15 * 0.1 = 1.5 (rushing yards)
        # Total = 18.7
        assert pts == 18.7

    def test_ppr_scoring(self, player_game_stats_wr):
        pts = player_game_stats_wr.calculate_fantasy_points("ppr")
        # 120 * 0.1 = 12.0 (receiving yards)
        # 1 * 6 = 6 (receiving TDs)
        # 6 * 1.0 = 6.0 (receptions in PPR)
        # Total = 24.0
        assert pts == 24.0

    def test_half_ppr_scoring(self, player_game_stats_wr):
        pts = player_game_stats_wr.calculate_fantasy_points("half_ppr")
        # 120 * 0.1 = 12.0
        # 1 * 6 = 6
        # 6 * 0.5 = 3.0 (half PPR)
        # Total = 21.0
        assert pts == 21.0

    def test_auto_compute_on_save(self, player_game_stats_qb):
        """Fantasy points should be auto-computed when model saves."""
        assert player_game_stats_qb.fantasy_points_standard is not None
        assert player_game_stats_qb.fantasy_points_ppr is not None
        assert player_game_stats_qb.fantasy_points_half_ppr is not None

        # PPR >= half_ppr >= standard (when receptions > 0)
        assert player_game_stats_qb.fantasy_points_standard == 18.7

    def test_wr_ppr_higher_than_standard(self, player_game_stats_wr):
        """WR with receptions should score more in PPR than standard."""
        assert (
            player_game_stats_wr.fantasy_points_ppr
            > player_game_stats_wr.fantasy_points_standard
        )
        assert (
            player_game_stats_wr.fantasy_points_half_ppr
            > player_game_stats_wr.fantasy_points_standard
        )
        assert (
            player_game_stats_wr.fantasy_points_ppr
            > player_game_stats_wr.fantasy_points_half_ppr
        )


# =============================================================================
# SERIALIZER FIELD COVERAGE
# =============================================================================


class TestTeamMinimalSerializer:
    def test_includes_logo_url(self, team_sea):
        from redzone.serializers import TeamMinimalSerializer

        data = TeamMinimalSerializer(team_sea).data
        assert "logo_url" in data
        assert "espncdn.com" in data["logo_url"]
        assert data["abbreviation"] == "SEA"

    def test_logo_url_prefers_default(self, team_sea):
        from redzone.serializers import TeamMinimalSerializer

        data = TeamMinimalSerializer(team_sea).data
        # Should pick the "default" logo type over "dark"
        assert "500/sea.png" in data["logo_url"]


class TestGameListSerializer:
    def test_serializes_all_scoreboard_fields(self, game_final):
        from redzone.serializers import GameListSerializer

        data = GameListSerializer(game_final).data

        required_fields = [
            "id",
            "espn_event_id",
            "week",
            "game_date",
            "status",
            "home_score",
            "away_score",
            "spread",
            "total",
            "broadcast_network",
            "home_record",
            "away_record",
        ]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

    def test_serializes_quarter_scores(self, game_final):
        from redzone.serializers import GameListSerializer

        data = GameListSerializer(game_final).data

        assert data["home_score_q1"] == 7
        assert data["home_score_q2"] == 10
        assert data["away_score_q4"] == 3


class TestPlaySerializerLayers:
    def test_base_play_serializer_excludes_analytics(self, plays):
        from redzone.serializers import PlaySerializer

        data = PlaySerializer(plays[0]).data
        assert "epa" not in data
        assert "air_yards" not in data
        assert "wpa" not in data

    def test_detail_play_serializer_includes_analytics(self, plays):
        from redzone.serializers import PlayDetailSerializer

        data = PlayDetailSerializer(plays[1]).data  # The 30-yard pass
        assert "epa" in data
        assert "air_yards" in data
        assert "wpa" in data
        assert "pass_location" in data
        assert data["air_yards"] == 20.0


class TestPlayerGameStatsSerializer:
    def test_includes_player_metadata(self, player_game_stats_qb):
        from redzone.serializers import PlayerGameStatsSerializer

        data = PlayerGameStatsSerializer(player_game_stats_qb).data
        assert data["player_name"] == "Geno Smith"
        assert data["team_abbr"] == "SEA"
        assert data["opponent_abbr"] == "WAS"
        assert data["player_position"] == "QB"
