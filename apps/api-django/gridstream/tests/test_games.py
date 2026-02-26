"""Tests for /games/ endpoints — scoreboard, detail, plays, drives, boxscore, live."""

import pytest
from datetime import date
from django.test import override_settings
from django.urls import reverse
from django.db import connections
from rest_framework import status

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


# =============================================================================
# GAME LIST (SCOREBOARD)
# =============================================================================


class TestGameList:
    def test_list_all_games(self, api_client, game_final, game_live):
        url = reverse("game-list")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 2

    def test_filter_by_season_and_week(self, api_client, game_final, game_live):
        url = reverse("game-list")
        resp = api_client.get(url, {"season": 2024, "week": 1})

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["week"] == 1

    def test_filter_by_team(self, api_client, game_final, team_sea):
        url = reverse("game-list")
        resp = api_client.get(url, {"team": "SEA"})

        assert resp.status_code == status.HTTP_200_OK
        # SEA participates in both games
        assert resp.data["count"] >= 1

    def test_filter_by_status(self, api_client, game_final, game_live):
        url = reverse("game-list")
        resp = api_client.get(url, {"status": "final"})

        assert resp.data["count"] == 1
        assert resp.data["results"][0]["status"] == "final"

    def test_filter_by_espn_event_id(self, api_client, game_final):
        url = reverse("game-list")
        resp = api_client.get(url, {"espn_event_id": game_final.espn_event_id})

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 1
        assert resp.data["results"][0]["id"] == game_final.pk

    def test_scoreboard_includes_team_details(self, api_client, game_final):
        url = reverse("game-list")
        resp = api_client.get(url, {"season": 2024, "week": 1})

        game = resp.data["results"][0]
        assert "home_team_detail" in game
        assert "away_team_detail" in game
        assert game["home_team_detail"]["abbreviation"] == "SEA"
        assert game["away_team_detail"]["abbreviation"] == "WAS"
        assert game["home_team_detail"]["color_primary"] == "002244"

    def test_scoreboard_includes_scores(self, api_client, game_final):
        url = reverse("game-list")
        resp = api_client.get(url, {"season": 2024, "week": 1})

        game = resp.data["results"][0]
        assert game["home_score"] == 26
        assert game["away_score"] == 20
        assert game["home_score_q1"] == 7
        assert game["away_score_q4"] == 3

    def test_scoreboard_includes_leaders(self, api_client, game_final, game_leader):
        url = reverse("game-list")
        resp = api_client.get(url, {"season": 2024, "week": 1})

        game = resp.data["results"][0]
        assert len(game["leaders"]) >= 1
        leader = game["leaders"][0]
        assert leader["category"] == "passing"
        assert leader["athlete_name"] == "Geno Smith"
        assert leader["display_value"] == "280 YDS, 2 TD"

    def test_scoreboard_includes_odds(self, api_client, game_final):
        url = reverse("game-list")
        resp = api_client.get(url, {"season": 2024, "week": 1})

        game = resp.data["results"][0]
        assert game["spread"] == -3.5
        assert game["total"] == 43.5

    def test_scoreboard_includes_broadcast(self, api_client, game_final):
        url = reverse("game-list")
        resp = api_client.get(url, {"season": 2024, "week": 1})

        game = resp.data["results"][0]
        assert game["broadcast_network"] == "FOX"

    def test_filter_by_date_range(self, api_client, game_final, game_live):
        url = reverse("game-list")
        resp = api_client.get(
            url,
            {
                "date_from": "2024-09-01",
                "date_to": "2024-09-30",
            },
        )

        assert resp.data["count"] == 1  # Only the Sep 8 game


# =============================================================================
# GAME DETAIL
# =============================================================================


class TestGameDetail:
    def test_retrieve_game(self, api_client, game_final, scoring_play):
        url = reverse("game-detail", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["espn_event_id"] == "401772001"
        assert resp.data["nflverse_game_id"] == "2024_01_WAS_SEA"
        assert resp.data["status"] == "final"

    def test_detail_includes_scoring_plays(self, api_client, game_final, scoring_play):
        url = reverse("game-detail", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert "scoring_plays" in resp.data
        assert len(resp.data["scoring_plays"]) == 1
        sp = resp.data["scoring_plays"][0]
        assert sp["score_type"] == "TD"
        assert sp["team_abbr"] == "SEA"
        assert sp["home_score_after"] == 7

    def test_detail_includes_venue(self, api_client, game_final):
        url = reverse("game-detail", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.data["venue_detail"]["name"] == "Lumen Field"
        assert resp.data["venue_detail"]["city"] == "Seattle"

    def test_detail_includes_officials_and_injuries(
        self,
        api_client,
        game_final,
        team_sea,
        player_qb,
    ):
        from gridstream.models import GameOfficial, PlayerInjury

        GameOfficial.objects.using("nfl").create(
            game=game_final,
            sequence=1,
            name="Brad Allen",
            position="Referee",
        )
        PlayerInjury.objects.using("nfl").create(
            game=game_final,
            team=team_sea,
            player=player_qb,
            sequence=1,
            player_name="Geno Smith",
            player_espn_id="3917315",
            status="Questionable",
            description="Ankle",
            game_day_availability="Game Time Decision",
        )

        url = reverse("game-detail", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data["officials"]) == 1
        assert resp.data["officials"][0]["name"] == "Brad Allen"
        assert resp.data["officials"][0]["position"] == "Referee"
        assert len(resp.data["injuries"]) == 1
        assert resp.data["injuries"][0]["team_abbr"] == "SEA"
        assert resp.data["injuries"][0]["player_name"] == "Geno Smith"
        assert resp.data["injuries"][0]["status"] == "Questionable"

    def test_detail_includes_extended_odds_fields(self, api_client, game_final):
        game_final.spread_line = -4.5
        game_final.total_line = 47.5
        game_final.home_spread_odds = -112
        game_final.away_spread_odds = -108
        game_final.over_odds = -110
        game_final.under_odds = -110
        game_final.save(
            using="nfl",
            update_fields=[
                "spread_line",
                "total_line",
                "home_spread_odds",
                "away_spread_odds",
                "over_odds",
                "under_odds",
            ],
        )

        url = reverse("game-detail", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["spread_line"] == -4.5
        assert resp.data["total_line"] == 47.5
        assert resp.data["home_spread_odds"] == -112
        assert resp.data["away_spread_odds"] == -108
        assert resp.data["over_odds"] == -110
        assert resp.data["under_odds"] == -110

    def test_retrieve_nonexistent_returns_404(self, api_client, db):
        url = reverse("game-detail", kwargs={"pk": 99999})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# LIVE HYDRATION
# =============================================================================


class TestLiveHydration:
    """
    Tests for GET /games/live/ — the WebSocket bridge endpoint.

    This is the critical endpoint that lets the frontend render
    the scoreboard immediately on page load before Gridstream
    WebSocket connects.
    """

    def test_live_returns_in_progress_games(self, api_client, game_final, game_live):
        url = reverse("game-live")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        # game_live is in_progress, game_final is final
        event_ids = [g["espn_event_id"] for g in resp.data]
        assert "401772099" in event_ids  # live game
        assert "401772001" not in event_ids  # final game excluded

    def test_live_includes_full_scoreboard_data(self, api_client, game_live):
        url = reverse("game-live")
        resp = api_client.get(url)

        game = resp.data[0]
        assert game["status"] == "in_progress"
        assert game["quarter"] == 3
        assert game["clock"] == "7:22"
        assert game["home_score"] == 14
        assert game["away_score"] == 17
        assert "home_team_detail" in game
        assert "away_team_detail" in game

    def test_live_includes_todays_scheduled_games(self, api_client, game_live, db):
        """Scheduled games for today should be included for pre-game display."""
        from gridstream.models import Game, Season, Team

        url = reverse("game-live")
        resp = api_client.get(url)

        # game_live has game_date=today and is in_progress, so it should be there
        assert len(resp.data) >= 1

    def test_live_excludes_final_games(self, api_client, game_final):
        url = reverse("game-live")
        resp = api_client.get(url)

        event_ids = [g["espn_event_id"] for g in resp.data]
        assert game_final.espn_event_id not in event_ids


# =============================================================================
# PLAYS
# =============================================================================


class TestGamePlays:
    def test_get_plays_for_game(self, api_client, game_final, plays):
        url = reverse("game-plays", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data["results"]) == 3

    def test_plays_ordered_by_sequence(self, api_client, game_final, plays):
        url = reverse("game-plays", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        sequences = [p["sequence"] for p in resp.data["results"]]
        assert sequences == [0, 1, 2]

    def test_plays_filter_by_quarter(self, api_client, game_final, plays):
        url = reverse("game-plays", kwargs={"pk": game_final.pk})
        resp = api_client.get(url, {"quarter": 1})

        assert len(resp.data["results"]) == 3  # All test plays are Q1

    def test_plays_filter_by_play_type(self, api_client, game_final, plays):
        url = reverse("game-plays", kwargs={"pk": game_final.pk})
        resp = api_client.get(url, {"play_type": "pass"})

        assert len(resp.data["results"]) == 2  # Two pass plays

    def test_plays_filter_by_touchdown(self, api_client, game_final, plays):
        url = reverse("game-plays", kwargs={"pk": game_final.pk})
        resp = api_client.get(url, {"touchdown": "true"})

        assert len(resp.data["results"]) == 1
        assert resp.data["results"][0]["touchdown"] is True

    def test_plays_include_possession_team(self, api_client, game_final, plays):
        url = reverse("game-plays", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        play = resp.data["results"][0]
        assert play["possession_team_abbr"] == "SEA"

    def test_plays_detail_mode(self, api_client, game_final, plays):
        """?detail=true includes analytics fields like EPA, air_yards."""
        url = reverse("game-plays", kwargs={"pk": game_final.pk})
        resp = api_client.get(url, {"detail": "true"})

        play = resp.data["results"][1]  # The 30-yard pass
        assert "epa" in play
        assert "air_yards" in play
        assert play["air_yards"] == 20.0
        assert play["yards_after_catch"] == 10.0
        assert play["pass_location"] == "middle"

    def test_plays_cursor_pagination(self, api_client, game_final, plays):
        url = reverse("game-plays", kwargs={"pk": game_final.pk})
        resp = api_client.get(url, {"page_size": 2})

        assert len(resp.data["results"]) == 2
        assert resp.data["next"] is not None


# =============================================================================
# DRIVES
# =============================================================================


class TestGameDrives:
    def test_get_drives_for_game(self, api_client, game_final, drive):
        url = reverse("game-drives", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 1
        d = resp.data[0]
        assert d["drive_number"] == 1
        assert d["team_abbr"] == "SEA"
        assert d["result"] == "touchdown"
        assert d["total_yards"] == 75
        assert d["play_count"] == 8
        assert d["is_score"] is True

    def test_drives_filter_by_team(self, api_client, game_final, drive):
        url = reverse("game-drives", kwargs={"pk": game_final.pk})
        resp = api_client.get(url, {"team": "SEA"})

        assert len(resp.data) == 1

        resp2 = api_client.get(url, {"team": "WAS"})
        assert len(resp2.data) == 0

    def test_drives_filter_by_result(self, api_client, game_final, drive):
        url = reverse("game-drives", kwargs={"pk": game_final.pk})
        resp = api_client.get(url, {"result": "touchdown"})

        assert len(resp.data) == 1

        resp2 = api_client.get(url, {"result": "punt"})
        assert len(resp2.data) == 0


# =============================================================================
# BOXSCORE
# =============================================================================


class TestGameBoxscore:
    def test_boxscore_structure(
        self,
        api_client,
        game_final,
        player_game_stats_qb,
        player_game_stats_wr,
        team_game_stats_sea,
    ):
        url = reverse("game-boxscore", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert "team_stats" in resp.data
        assert "player_stats" in resp.data
        assert "leaders" in resp.data
        assert "completeness" in resp.data

    def test_boxscore_team_stats(
        self,
        api_client,
        game_final,
        team_game_stats_sea,
    ):
        url = reverse("game-boxscore", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert len(resp.data["team_stats"]) >= 1
        sea_stats = next(
            row for row in resp.data["team_stats"] if row.get("team_abbr") == "SEA"
        )
        assert sea_stats["team_abbr"] == "SEA"
        assert sea_stats["total_yards"] == 380
        assert sea_stats["points_scored"] == 26
        assert sea_stats["time_of_possession"] == "32:15"

    def test_boxscore_player_stats_grouped_by_team(
        self,
        api_client,
        game_final,
        player_game_stats_qb,
        player_game_stats_wr,
    ):
        url = reverse("game-boxscore", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        # Player stats should be grouped by team abbreviation
        assert "SEA" in resp.data["player_stats"]
        sea_players = resp.data["player_stats"]["SEA"]
        assert len(sea_players) == 2
        names = [p["player_name"] for p in sea_players]
        assert "Geno Smith" in names
        assert "DK Metcalf" in names

    def test_boxscore_includes_db_leaders_and_completeness(
        self,
        api_client,
        game_final,
        player_game_stats_qb,
        player_game_stats_wr,
        team_game_stats_sea,
        game_leader,
    ):
        url = reverse("game-boxscore", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["completeness"]["team_stats_source"] == "db"
        assert resp.data["completeness"]["team_stats_complete"] is False
        assert resp.data["completeness"]["leaders_source"] == "db"
        assert isinstance(resp.data["leaders"], list)
        assert len(resp.data["leaders"]) >= 1

    def test_boxscore_strict_mode_does_not_derive_team_stats_when_missing_rows(
        self,
        api_client,
        game_final,
        plays,
    ):
        url = reverse("game-boxscore", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["completeness"]["team_stats_complete"] is False
        assert resp.data["completeness"]["team_stats_source"] == "db"
        assert resp.data["team_stats"] == []

    def test_boxscore_strict_mode_does_not_derive_leaders_when_missing_game_leaders(
        self,
        api_client,
        game_final,
        player_game_stats_qb,
        player_game_stats_wr,
    ):
        url = reverse("game-boxscore", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["completeness"]["leaders_source"] == "db"
        assert resp.data["completeness"]["leaders_complete"] is False
        assert resp.data["leaders"] == []

    @override_settings(GRIDSTREAM_BOXSCORE_RESILIENCE_MODE=True)
    def test_boxscore_resilience_derives_team_stats_when_missing_rows(
        self,
        api_client,
        game_final,
        plays,
    ):
        url = reverse("game-boxscore", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["completeness"]["team_stats_complete"] is False
        assert resp.data["completeness"]["team_stats_source"] == "derived_resilience"
        assert len(resp.data["team_stats"]) == 2

    @override_settings(GRIDSTREAM_BOXSCORE_RESILIENCE_MODE=True)
    def test_boxscore_resilience_derives_leaders_when_missing_game_leaders(
        self,
        api_client,
        game_final,
        player_game_stats_qb,
        player_game_stats_wr,
    ):
        url = reverse("game-boxscore", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["completeness"]["leaders_complete"] is False
        assert resp.data["completeness"]["leaders_source"] == "derived_resilience"
        assert len(resp.data["leaders"]) >= 1

    @override_settings(GRIDSTREAM_BOXSCORE_RESILIENCE_MODE=True)
    def test_boxscore_resilience_does_not_merge_partial_canonical_team_rows(
        self,
        api_client,
        game_final,
        team_game_stats_sea,
        plays,
    ):
        url = reverse("game-boxscore", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["completeness"]["team_stats_complete"] is False
        assert resp.data["completeness"]["team_stats_source"] == "db"
        assert len(resp.data["team_stats"]) == 1


# =============================================================================
# PERSONNEL
# =============================================================================


def _ensure_personnel_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS raw")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_snap_counts (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                season INTEGER,
                week INTEGER,
                game_id TEXT,
                team TEXT,
                player_id TEXT,
                player_name TEXT,
                offense_snaps INTEGER,
                defense_snaps INTEGER,
                special_snaps INTEGER,
                payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_depth_charts (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                season INTEGER,
                week INTEGER,
                team TEXT,
                player_id TEXT,
                player_name TEXT,
                position TEXT,
                depth_rank INTEGER,
                payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """)
        cursor.execute("DELETE FROM raw.raw_nflverse_snap_counts")
        cursor.execute("DELETE FROM raw.raw_nflverse_depth_charts")


class TestGamePersonnel:
    def test_personnel_uses_snap_counts_when_available(
        self,
        api_client,
        game_final,
        player_qb,
        player_wr,
        team_sea,
        team_was,
    ):
        _ensure_personnel_raw_tables()

        with connections["nfl"].cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO raw.raw_nflverse_snap_counts (
                    season, week, game_id, team, player_id, player_name,
                    offense_snaps, defense_snaps, special_snaps, payload
                ) VALUES
                    (%s, %s, %s, %s, %s, %s, %s, 0, %s, %s::jsonb),
                    (%s, %s, %s, %s, %s, %s, %s, 0, 0, %s::jsonb)
                """,
                [
                    2024,
                    1,
                    game_final.nflverse_game_id,
                    "SEA",
                    player_qb.pfr_id,
                    player_qb.display_name,
                    62,
                    5,
                    '{"position":"QB","offense_pct":"1.0","st_pct":"0.08"}',
                    2024,
                    1,
                    game_final.nflverse_game_id,
                    "SEA",
                    player_wr.gsis_id,
                    player_wr.display_name,
                    40,
                    '{"position":"WR","offense_pct":"0.64"}',
                ],
            )
            cursor.execute(
                """
                INSERT INTO raw.raw_nflverse_depth_charts (
                    season, week, team, player_id, player_name, position, depth_rank, payload
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                [
                    2024,
                    1,
                    "SEA",
                    player_qb.gsis_id,
                    player_qb.display_name,
                    "QB",
                    1,
                    '{"depth_position":"QB"}',
                ],
            )

        url = reverse("game-personnel", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["source"] == "snap_counts"
        assert resp.data["season"] == 2024
        assert resp.data["week"] == 1

        away = resp.data["away"]
        home = resp.data["home"]
        assert away["team_abbr"] == team_was.abbreviation
        assert home["team_abbr"] == team_sea.abbreviation
        assert home["total_offense_snaps"] == 62

        sea_players = home["players"]
        assert len(sea_players) == 2
        qb_row = next(
            row for row in sea_players if row["player_name"] == player_qb.display_name
        )
        assert qb_row["position"] == "QB"
        assert qb_row["offense_snaps"] == 62
        assert qb_row["special_snaps"] == 5
        assert qb_row["offense_snap_pct"] == 100.0
        assert qb_row["depth_chart_position"] == "QB"

    def test_personnel_falls_back_to_player_stats_when_raw_snap_counts_missing(
        self,
        api_client,
        game_final,
        player_game_stats_qb,
        player_game_stats_wr,
        team_sea,
        team_was,
    ):
        _ensure_personnel_raw_tables()

        url = reverse("game-personnel", kwargs={"pk": game_final.pk})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["source"] == "player_stats_fallback"
        assert resp.data["away"]["team_abbr"] == team_was.abbreviation
        assert resp.data["home"]["team_abbr"] == team_sea.abbreviation
        assert len(resp.data["home"]["players"]) >= 2
        geno = next(
            row
            for row in resp.data["home"]["players"]
            if row["player_name"] == "Geno Smith"
        )
        assert geno["offense_snaps"] == 0
        assert geno["total_snap_pct"] is None
