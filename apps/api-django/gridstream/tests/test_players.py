"""Tests for /players/ endpoints — list, detail, gamelog, splits."""

import pytest
from django.db import connections
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
        first_row = resp.data["results"][0]
        assert "career_receiving_yards" in first_row
        assert "career_passing_yards" in first_row
        assert "career_completion_pct" in first_row
        assert "career_scrimmage_yards" in first_row
        assert "career_tackles_total" in first_row

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

    def test_filter_by_position_alias_t_includes_ol_group(self, api_client, team_sea, db):
        from gridstream.models import Player

        Player.objects.using("nfl").create(
            gsis_id="00-OL-TACKLE",
            display_name="Charles Cross",
            first_name="Charles",
            last_name="Cross",
            position="OL",
            position_group="OL",
            current_team=team_sea,
            roster_status="ACT",
            is_active=True,
        )

        url = reverse("player-list")
        resp = api_client.get(url, {"position": "T"})

        assert resp.status_code == status.HTTP_200_OK
        names = [p["display_name"] for p in resp.data["results"]]
        assert "Charles Cross" in names

    def test_ol_position_facets_split_center_guard_tackle(self, api_client, team_sea, db):
        from gridstream.models import Player

        Player.objects.using("nfl").create(
            gsis_id="00-OL-CENTER",
            display_name="Center Example",
            first_name="Center",
            last_name="Example",
            position="C",
            position_group="OL",
            current_team=team_sea,
            roster_status="ACT",
            is_active=True,
        )
        Player.objects.using("nfl").create(
            gsis_id="00-OL-GUARD",
            display_name="Guard Example",
            first_name="Guard",
            last_name="Example",
            position="G",
            position_group="OL",
            current_team=team_sea,
            roster_status="ACT",
            is_active=True,
        )
        Player.objects.using("nfl").create(
            gsis_id="00-OL-TACKLE-LIKE",
            display_name="Tackle Example",
            first_name="Tackle",
            last_name="Example",
            position="OL",
            position_group="OL",
            current_team=team_sea,
            roster_status="ACT",
            is_active=True,
        )

        url = reverse("player-list")
        facets_resp = api_client.get(url, {"is_active": "true"})
        assert facets_resp.status_code == status.HTTP_200_OK
        facets_by_key = {
            row["key"]: row["count"] for row in facets_resp.data["facets"]["position"]
        }
        assert facets_by_key.get("C") == 1
        assert facets_by_key.get("G") == 1
        assert facets_by_key.get("T") == 1

        tackle_resp = api_client.get(url, {"position": "T", "is_active": "true"})
        tackle_names = {row["display_name"] for row in tackle_resp.data["results"]}
        assert "Tackle Example" in tackle_names
        assert "Center Example" not in tackle_names
        assert "Guard Example" not in tackle_names

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

    def test_active_scope_excludes_retired_status_even_if_is_active_true(
        self, api_client, player_qb, db
    ):
        from gridstream.models import Player

        Player.objects.using("nfl").create(
            gsis_id="00-RET-STILL-TRUE",
            display_name="Retired But Marked Active",
            first_name="Retired",
            last_name="ButActive",
            position="QB",
            roster_status="RET",
            is_active=True,
        )

        url = reverse("player-list")

        default_resp = api_client.get(url)
        default_names = [p["display_name"] for p in default_resp.data["results"]]
        assert "Retired But Marked Active" not in default_names

        explicit_active_resp = api_client.get(url, {"is_active": "true"})
        explicit_active_names = [p["display_name"] for p in explicit_active_resp.data["results"]]
        assert "Retired But Marked Active" not in explicit_active_names

        inactive_resp = api_client.get(url, {"is_active": "false", "scope": "all"})
        inactive_names = [p["display_name"] for p in inactive_resp.data["results"]]
        assert "Retired But Marked Active" in inactive_names

    def test_active_scope_keeps_game_day_inactive_players(
        self, api_client, player_qb, db
    ):
        from gridstream.models import Player

        Player.objects.using("nfl").create(
            gsis_id="00-INA-ROSTERED",
            display_name="Inactive But Rostered",
            first_name="Inactive",
            last_name="Rostered",
            position="QB",
            roster_status="INA",
            is_active=True,
            current_team=player_qb.current_team,
        )

        url = reverse("player-list")
        resp = api_client.get(url, {"is_active": "true"})

        names = {row["display_name"] for row in resp.data["results"]}
        assert "Inactive But Rostered" in names

    def test_filter_by_roster_status_inactive_without_is_active_override(
        self, api_client, player_qb, db
    ):
        from gridstream.models import Player

        Player.objects.using("nfl").create(
            gsis_id="00-RET-FILTER-ONLY",
            display_name="Roster Inactive Filter",
            first_name="Roster",
            last_name="Inactive",
            position="QB",
            roster_status="RET",
            is_active=False,
        )

        url = reverse("player-list")
        resp = api_client.get(url, {"roster_status": "Inactive", "scope": "all"})

        names = {row["display_name"] for row in resp.data["results"]}
        assert "Roster Inactive Filter" in names
        assert player_qb.display_name not in names

    def test_filter_by_roster_status_active_and_retired_excludes_free_agents(
        self, api_client, player_qb, db
    ):
        from gridstream.models import Player

        Player.objects.using("nfl").create(
            gsis_id="00-RET-MULTI",
            display_name="Roster Multi Inactive",
            first_name="Roster",
            last_name="MultiInactive",
            position="QB",
            roster_status="RET",
            is_active=False,
        )
        Player.objects.using("nfl").create(
            gsis_id="00-FA-MULTI",
            display_name="Roster Multi Free Agent",
            first_name="Roster",
            last_name="MultiFreeAgent",
            position="QB",
            roster_status="ACT",
            is_active=True,
            current_team=None,
        )

        url = reverse("player-list")
        resp = api_client.get(
            url,
            {"roster_status": "Active,Retired", "scope": "all"},
        )

        names = {row["display_name"] for row in resp.data["results"]}
        assert player_qb.display_name in names
        assert "Roster Multi Inactive" in names
        assert "Roster Multi Free Agent" not in names

    def test_default_active_scope_hides_stale_unattached_players(self, api_client, db):
        from gridstream.models import Player

        Player.objects.using("nfl").create(
            gsis_id="00-STALE-FA",
            display_name="Old Free Agent",
            first_name="Old",
            last_name="Agent",
            position="WR",
            roster_status="ACT",
            draft_year=2001,
            current_team=None,
            is_active=True,
        )

        url = reverse("player-list")
        scoped = api_client.get(url)
        scoped_names = {row["display_name"] for row in scoped.data["results"]}
        assert "Old Free Agent" not in scoped_names

        unscoped = api_client.get(url, {"scope": "all"})
        unscoped_names = {row["display_name"] for row in unscoped.data["results"]}
        assert "Old Free Agent" in unscoped_names

    def test_default_list_excludes_inactive_players(self, api_client, player_qb, db):
        from gridstream.models import Player

        Player.objects.using("nfl").create(
            gsis_id="00-RETIRED-DEFAULT",
            display_name="Inactive By Default",
            first_name="Inactive",
            last_name="Default",
            position="QB",
            roster_status="RET",
            is_active=False,
        )

        url = reverse("player-list")
        resp = api_client.get(url)

        names = [p["display_name"] for p in resp.data["results"]]
        assert "Inactive By Default" not in names

    def test_filter_by_team_not(self, api_client, player_qb, player_wr, player_was_qb):
        url = reverse("player-list")
        resp = api_client.get(url, {"team_not": "SEA"})

        names = [p["display_name"] for p in resp.data["results"]]
        assert "Geno Smith" not in names
        assert "DK Metcalf" not in names
        assert "Jayden Daniels" in names

    def test_list_rolls_up_starts_and_snaps_from_raw(
        self, api_client, player_qb, player_game_stats_qb
    ):
        with connections["nfl"].cursor() as cursor:
            cursor.execute("CREATE SCHEMA IF NOT EXISTS raw")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS raw.raw_nflverse_snap_counts (
                    id BIGSERIAL PRIMARY KEY,
                    season INTEGER,
                    week INTEGER,
                    game_id TEXT,
                    team TEXT,
                    player_id TEXT,
                    player_name TEXT,
                    offense_snaps INTEGER,
                    defense_snaps INTEGER,
                    special_snaps INTEGER,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS raw.raw_nflverse_depth_charts (
                    id BIGSERIAL PRIMARY KEY,
                    season INTEGER,
                    week INTEGER,
                    team TEXT,
                    player_id TEXT,
                    player_name TEXT,
                    position TEXT,
                    depth_rank INTEGER,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb
                )
            """)
            cursor.execute(
                "DELETE FROM raw.raw_nflverse_snap_counts WHERE player_id IN (%s, %s)",
                [player_qb.pfr_id, player_qb.gsis_id],
            )
            cursor.execute(
                "DELETE FROM raw.raw_nflverse_depth_charts WHERE player_id = %s",
                [player_qb.gsis_id],
            )
            cursor.execute(
                """
                INSERT INTO raw.raw_nflverse_snap_counts (
                    season, week, game_id, team, player_id, player_name,
                    offense_snaps, defense_snaps, special_snaps, payload
                ) VALUES
                (2024, 1, '2024_01_SEA_WAS', 'SEA', %s, 'Geno Smith', 62, 0, 0, '{"offense_pct":"100%%"}'::jsonb),
                (2024, 2, '2024_02_SEA_NE', 'SEA', %s, 'Geno Smith', 33, 0, 0, '{"offense_pct":"90%%"}'::jsonb)
                """,
                [player_qb.pfr_id, player_qb.gsis_id],
            )
            cursor.execute(
                """
                INSERT INTO raw.raw_nflverse_depth_charts (
                    season, week, team, player_id, player_name, position, depth_rank, payload
                ) VALUES
                (2024, 1, 'SEA', %s, 'Geno Smith', 'QB', 1, '{}'::jsonb),
                (2024, 2, 'SEA', %s, 'Geno Smith', 'QB', 1, '{}'::jsonb)
                """,
                [player_qb.gsis_id, player_qb.gsis_id],
            )

        url = reverse("player-list")
        resp = api_client.get(url, {"search": "Geno"})

        assert resp.status_code == status.HTTP_200_OK
        row = resp.data["results"][0]
        assert row["offensive_snaps"] == 95
        assert row["games_started"] == 2
        assert row["snap_pct"] == pytest.approx(95.0)

    def test_filter_by_season_played(self, api_client, player_qb, player_wr, player_game_stats_qb):
        url = reverse("player-list")

        # QB fixture has a 2024 game stats row; WR fixture has none.
        resp = api_client.get(url, {"season": 2024})

        assert resp.status_code == status.HTTP_200_OK
        names = [p["display_name"] for p in resp.data["results"]]
        assert "Geno Smith" in names
        assert "DK Metcalf" not in names

    def test_filter_by_multiple_draft_years(self, api_client, player_qb, player_wr, player_was_qb):
        url = reverse("player-list")
        resp = api_client.get(url, {"draft_year": "2013,2024"})

        assert resp.status_code == status.HTTP_200_OK
        names = {row["display_name"] for row in resp.data["results"]}
        assert "Geno Smith" in names
        assert "Jayden Daniels" in names
        assert "DK Metcalf" not in names

    def test_filter_by_multiple_seasons_played(
        self,
        api_client,
        player_qb,
        player_wr,
        player_game_stats_qb,
        game_live,
        team_sea,
        team_was,
    ):
        from gridstream.models import PlayerGameStats

        PlayerGameStats.objects.using("nfl").create(
            player=player_wr,
            game=game_live,
            team=team_sea,
            opponent=team_was,
            season_year=2023,
            week=10,
            receptions=6,
            receiving_yards=78,
            receiving_tds=1,
        )

        url = reverse("player-list")
        resp = api_client.get(url, {"season": "2024,2023"})

        assert resp.status_code == status.HTTP_200_OK
        names = {row["display_name"] for row in resp.data["results"]}
        assert "Geno Smith" in names
        assert "DK Metcalf" in names

    def test_stats_scope_can_limit_rollups_to_season_or_week(
        self, api_client, player_qb, player_game_stats_qb, game_live, team_sea, team_was, db
    ):
        from gridstream.models import PlayerGameStats

        PlayerGameStats.objects.using("nfl").create(
            player=player_qb,
            game=game_live,
            team=team_sea,
            opponent=team_was,
            season_year=2024,
            week=18,
            completions=10,
            pass_attempts=16,
            passing_yards=125,
            passing_tds=1,
            interceptions_thrown=0,
        )

        url = reverse("player-list")
        season_resp = api_client.get(
            url,
            {"search": "Geno", "stats_season": 2024},
        )
        assert season_resp.status_code == status.HTTP_200_OK
        season_row = season_resp.data["results"][0]
        assert season_row["games_played"] == 2
        assert season_row["career_passing_yards"] == 405

        week_resp = api_client.get(
            url,
            {"search": "Geno", "stats_season": 2024, "stats_week": 1},
        )
        assert week_resp.status_code == status.HTTP_200_OK
        week_row = week_resp.data["results"][0]
        assert week_row["games_played"] == 1
        assert week_row["career_passing_yards"] == 280

    def test_stats_scope_team_filters_use_boxscore_team_and_require_stats_rows(
        self, api_client, game_live, team_sea, team_was, db
    ):
        from gridstream.models import Player, PlayerGameStats

        player_with_stats = Player.objects.using("nfl").create(
            gsis_id="00-WAS-STATS-ONLY",
            display_name="Stats Team Match QB",
            first_name="Stats",
            last_name="Match",
            position="QB",
            position_group="QB",
            current_team=team_sea,  # intentionally stale/mismatched
            roster_status="ACT",
            is_active=True,
        )
        player_without_stats = Player.objects.using("nfl").create(
            gsis_id="00-WAS-NO-STATS",
            display_name="No Stats QB",
            first_name="No",
            last_name="Stats",
            position="QB",
            position_group="QB",
            current_team=team_was,
            roster_status="ACT",
            is_active=True,
        )
        PlayerGameStats.objects.using("nfl").create(
            player=player_with_stats,
            game=game_live,
            team=team_was,
            opponent=team_sea,
            season_year=2025,
            week=1,
            completions=18,
            pass_attempts=27,
            passing_yards=242,
            passing_tds=2,
        )

        url = reverse("player-list")
        resp = api_client.get(
            url,
            {
                "team": "WAS",
                "position": "QB",
                "stats_season": 2025,
                "stats_week": 1,
            },
        )

        assert resp.status_code == status.HTTP_200_OK
        names = {row["display_name"] for row in resp.data["results"]}
        assert "Stats Team Match QB" in names
        assert "No Stats QB" not in names

    def test_stats_scope_team_filters_do_not_multiply_stat_aggregates(
        self, api_client, game_live, game_final, team_sea, team_was, db
    ):
        from gridstream.models import Player, PlayerGameStats

        player = Player.objects.using("nfl").create(
            gsis_id="00-WAS-NO-FANOUT",
            display_name="No Fanout QB",
            first_name="No",
            last_name="Fanout",
            position="QB",
            position_group="QB",
            current_team=team_was,
            roster_status="ACT",
            is_active=True,
        )

        PlayerGameStats.objects.using("nfl").create(
            player=player,
            game=game_live,
            team=team_was,
            opponent=team_sea,
            season_year=2025,
            week=1,
            completions=18,
            pass_attempts=27,
            passing_yards=242,
            passing_tds=2,
            interceptions_thrown=1,
        )
        PlayerGameStats.objects.using("nfl").create(
            player=player,
            game=game_final,
            team=team_was,
            opponent=team_sea,
            season_year=2025,
            week=2,
            completions=12,
            pass_attempts=19,
            passing_yards=161,
            passing_tds=1,
            interceptions_thrown=0,
        )
        url = reverse("player-list")
        resp = api_client.get(
            url,
            {
                "team": "WAS",
                "position": "QB",
                "stats_season": 2025,
                "search": "No Fanout",
            },
        )

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data["results"]) == 1
        row = resp.data["results"][0]
        assert row["display_name"] == "No Fanout QB"
        assert row["games_played"] == 2
        assert row["career_pass_attempts"] == 46
        assert row["career_completions"] == 30
        assert row["career_passing_yards"] == 403
        assert row["career_passing_tds"] == 3
        assert row["career_interceptions_thrown"] == 1
        expected_a = max(0.0, min(2.375, ((30 / 46) - 0.3) * 5.0))
        expected_b = max(0.0, min(2.375, ((403 / 46) - 3.0) * 0.25))
        expected_c = max(0.0, min(2.375, (3 / 46) * 20.0))
        expected_d = max(0.0, min(2.375, 2.375 - ((1 / 46) * 25.0)))
        expected_rating = ((expected_a + expected_b + expected_c + expected_d) / 6.0) * 100.0
        assert row["career_passer_rating"] == pytest.approx(expected_rating, abs=0.01)

    def test_list_includes_global_facets(self, api_client, player_qb, player_wr):
        url = reverse("player-list")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert "facets" in resp.data
        assert "team" in resp.data["facets"]
        assert "rosterStatus" in resp.data["facets"]
        team_keys = {row["key"] for row in resp.data["facets"]["team"]}
        assert "SEA" in team_keys
        roster_labels = {row["label"] for row in resp.data["facets"]["rosterStatus"]}
        assert "Active" in roster_labels

    def test_ordering_by_games_played_desc(
        self, api_client, player_qb, player_wr, player_game_stats_qb
    ):
        url = reverse("player-list")
        resp = api_client.get(url, {"ordering": "-games_played"})

        assert resp.status_code == status.HTTP_200_OK
        names = [row["display_name"] for row in resp.data["results"]]
        assert names[0] == "Geno Smith"
        assert names[-1] == "DK Metcalf"


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
