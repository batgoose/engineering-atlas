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
        from gridstream.serializers import TeamMinimalSerializer

        data = TeamMinimalSerializer(team_sea).data
        assert "logo_url" in data
        assert "espncdn.com" in data["logo_url"]
        assert data["abbreviation"] == "SEA"

    def test_logo_url_prefers_default(self, team_sea):
        from gridstream.serializers import TeamMinimalSerializer

        data = TeamMinimalSerializer(team_sea).data
        # Should pick the "default" logo type over "dark"
        assert "500/sea.png" in data["logo_url"]

    def test_logo_url_prefers_color_espn_logo_when_default_missing(self, db):
        from gridstream.models import Team, TeamLogo
        from gridstream.serializers import TeamMinimalSerializer

        team = Team.objects.using("nfl").create(
            espn_id="77",
            abbreviation="LVR",
            slug="las-vegas-raiders",
            location="Las Vegas",
            name="Raiders",
            display_name="Las Vegas Raiders",
            short_display_name="Raiders",
            color_primary="000000",
            color_secondary="a5acaf",
            conference="AFC",
            division="AFC West",
            is_active=True,
        )
        TeamLogo.objects.using("nfl").create(
            team=team,
            logo_type="dark",
            url="https://example.com/lvr-dark.png",
        )
        TeamLogo.objects.using("nfl").create(
            team=team,
            logo_type="scoreboard",
            url="https://example.com/lvr-scoreboard.png",
        )

        data = TeamMinimalSerializer(team).data
        assert data["logo_url"] == "https://a.espncdn.com/i/teamlogos/nfl/500/lvr.png"

    def test_logo_url_omits_dark_only_logo(self, db):
        from gridstream.models import Team, TeamLogo
        from gridstream.serializers import TeamMinimalSerializer

        team = Team.objects.using("nfl").create(
            espn_id="88",
            abbreviation="MONO",
            slug="mono-team",
            location="Mono City",
            name="Mono",
            display_name="Mono Team",
            short_display_name="Mono",
            color_primary="111111",
            color_secondary="cccccc",
            conference="AFC",
            division="AFC East",
            is_active=True,
        )
        TeamLogo.objects.using("nfl").create(
            team=team,
            logo_type="dark",
            url="https://example.com/mono-dark.png",
        )

        data = TeamMinimalSerializer(team).data
        assert data["logo_url"] is None


class TestGameListSerializer:
    def test_serializes_all_scoreboard_fields(self, game_final):
        from gridstream.serializers import GameListSerializer

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
        from gridstream.serializers import GameListSerializer

        data = GameListSerializer(game_final).data

        assert data["home_score_q1"] == 7
        assert data["home_score_q2"] == 10
        assert data["away_score_q4"] == 3


class TestPlaySerializerLayers:
    def test_base_play_serializer_excludes_analytics(self, plays):
        from gridstream.serializers import PlaySerializer

        data = PlaySerializer(plays[0]).data
        assert "epa" not in data
        assert "air_yards" not in data
        assert "wpa" not in data

    def test_detail_play_serializer_includes_analytics(self, plays):
        from gridstream.serializers import PlayDetailSerializer

        play = plays[1]  # The 30-yard pass
        play.timeout = True
        play.timeout_team = "SEA"
        play.home_timeouts_remaining = 2
        play.away_timeouts_remaining = 3
        play.punt_returner_player_name = "D. Dallas"
        play.kickoff_returner_player_name = "D. Dallas"
        play.interception_player_name = "K. Curl"
        play.fumble_recovery_1_player_name = "B. Wagner"
        play.sack_player_name = "M. Parsons"
        play.penalty_player_name = "J. Reed"
        play.home_wp = 0.67
        play.away_wp = 0.33
        play.total_home_epa = 12.4
        play.total_away_epa = -6.9
        play.ep = 2.4
        play.score_differential = 6
        play.drive_start_transition = "Following Punt"
        play.series_result = "First Down"
        play.save(
            using="nfl",
            update_fields=[
                "timeout",
                "timeout_team",
                "home_timeouts_remaining",
                "away_timeouts_remaining",
                "punt_returner_player_name",
                "kickoff_returner_player_name",
                "interception_player_name",
                "fumble_recovery_1_player_name",
                "sack_player_name",
                "penalty_player_name",
                "home_wp",
                "away_wp",
                "total_home_epa",
                "total_away_epa",
                "ep",
                "score_differential",
                "drive_start_transition",
                "series_result",
            ],
        )

        data = PlayDetailSerializer(play).data
        assert "epa" in data
        assert "air_yards" in data
        assert "wpa" in data
        assert "pass_location" in data
        assert "timeout" in data
        assert "punt_returner_player_name" in data
        assert "kickoff_returner_player_name" in data
        assert "interception_player_name" in data
        assert "fumble_recovery_1_player_name" in data
        assert "sack_player_name" in data
        assert "penalty_player_name" in data
        assert "home_wp" in data
        assert "away_wp" in data
        assert "total_home_epa" in data
        assert "total_away_epa" in data
        assert "ep" in data
        assert "score_differential" in data
        assert "series_result" in data
        assert "drive_start_transition" in data
        assert data["air_yards"] == 20.0
        assert data["timeout"] is True
        assert data["home_wp"] == pytest.approx(0.67)
        assert data["total_home_epa"] == pytest.approx(12.4)
        assert data["total_away_epa"] == pytest.approx(-6.9)


class TestPlayerGameStatsSerializer:
    def test_includes_player_metadata(self, player_game_stats_qb):
        from gridstream.serializers import PlayerGameStatsSerializer

        data = PlayerGameStatsSerializer(player_game_stats_qb).data
        assert data["player_name"] == "Geno Smith"
        assert data["team_abbr"] == "SEA"
        assert data["opponent_abbr"] == "WAS"
        assert data["player_position"] == "QB"
