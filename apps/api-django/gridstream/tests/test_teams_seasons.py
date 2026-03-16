"""Tests for /seasons/ and /teams/ endpoints."""

from datetime import date
from unittest.mock import patch

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

    def test_roster_includes_free_agency_statuses(
        self, api_client, team_sea, team_was, player_qb, player_wr, db
    ):
        from gridstream.models import Player, TeamFreeAgentTrackerEntry

        current_year = date.today().year
        player_te = Player.objects.using("nfl").create(
            gsis_id="00-0099999",
            espn_id="9999999",
            display_name="Noah Fant",
            short_name="N. Fant",
            first_name="Noah",
            last_name="Fant",
            jersey_number="87",
            position="TE",
            position_group="TE",
            current_team=team_sea,
            roster_status="ACT",
            headshot_url="https://a.espncdn.com/i/headshots/nfl/players/full/9999999.png",
            is_active=True,
        )

        TeamFreeAgentTrackerEntry.objects.using("nfl").create(
            team=team_sea,
            season=current_year,
            player=player_qb,
            player_name=player_qb.display_name,
            fa_type="UFA",
            signed_with_team=team_sea,
            tracker_status="re_signed",
            source_url="https://www.ourlads.com/nfl-free-agent-tracker/team/seattle-seahawks/2026",
        )
        TeamFreeAgentTrackerEntry.objects.using("nfl").create(
            team=team_was,
            season=current_year,
            player=player_wr,
            player_name=player_wr.display_name,
            fa_type="UFA",
            signed_with_team=team_sea,
            tracker_status="signed_elsewhere",
            source_url="https://www.ourlads.com/nfl-free-agent-tracker/team/washington-commanders/2026",
        )
        TeamFreeAgentTrackerEntry.objects.using("nfl").create(
            team=team_sea,
            season=current_year,
            player=player_te,
            player_name=player_te.display_name,
            fa_type="RFA",
            tracker_status="unsigned",
            source_url="https://www.ourlads.com/nfl-free-agent-tracker/team/seattle-seahawks/2026",
        )

        url = reverse("team-roster", kwargs={"abbreviation": "SEA"})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        rows = {row["display_name"]: row for row in resp.data}
        assert rows["Geno Smith"]["free_agency_status"] == "RE_SIGNED_2026"
        assert rows["Geno Smith"]["free_agency_status_display"] == "RE-SIGNED 2026"
        assert rows["DK Metcalf"]["free_agency_status"] == "ACQUIRED_FA_OR_TRADE_2026"
        assert rows["DK Metcalf"]["free_agency_status_display"] == "ACQUIRED 2026"
        assert rows["Noah Fant"]["free_agency_status"] == "RFA"
        assert rows["Noah Fant"]["free_agency_status_display"] == "RFA"

    def test_roster_keeps_active_status_for_re_signed_player_with_stale_contract_row(
        self, api_client, team_sea, player_qb
    ):
        from gridstream.models import (
            PlayerContract,
            PlayerTransaction,
            TeamFreeAgentTrackerEntry,
        )

        current_year = date.today().year
        player_qb.current_team = team_sea
        player_qb.roster_status = "ACT"
        player_qb.is_active = True
        player_qb.years_experience = 6
        player_qb.save(using="nfl")

        PlayerContract.objects.using("nfl").create(
            player=player_qb,
            team=team_sea,
            is_active=True,
            year_signed=current_year - 1,
            years=1,
            total_value=3000000,
            apy=3000000,
            guaranteed=1400000,
            year_details=[{"year": current_year - 1, "team": "SEA"}],
        )
        TeamFreeAgentTrackerEntry.objects.using("nfl").create(
            team=team_sea,
            season=current_year,
            player=player_qb,
            player_name=player_qb.display_name,
            fa_type="UFA",
            signed_with_team=team_sea,
            tracker_status="re_signed",
            source_url="https://www.ourlads.com/nfl-free-agent-tracker/team/seattle-seahawks/2026",
        )
        PlayerTransaction.objects.using("nfl").create(
            player=player_qb,
            transaction_type="signed",
            date=date(current_year, 2, 23),
            from_team=None,
            to_team=team_sea,
            description="Spotrac: Signed a 2 year extension with Seattle",
            season=current_year,
        )

        url = reverse("team-roster", kwargs={"abbreviation": "SEA"})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        row = next(
            player for player in resp.data if player["display_name"] == "Geno Smith"
        )
        assert row["current_team_abbr"] == "SEA"
        assert row["roster_status"] == "ACT"
        assert row["roster_status_display"] == "Active"
        assert row["is_active"] is True
        assert row["free_agency_status"] == "RE_SIGNED_2026"

    def test_roster_handles_missing_tracker_table(
        self, api_client, team_sea, player_qb
    ):
        from django.db.utils import ProgrammingError

        url = reverse("team-roster", kwargs={"abbreviation": "SEA"})

        with patch(
            "gridstream.views.TeamFreeAgentTrackerEntry.objects.filter",
            side_effect=ProgrammingError(
                'relation "gridstream_teamfreeagenttrackerentry" does not exist'
            ),
        ):
            resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data[0]["display_name"] == "Geno Smith"
        assert resp.data[0]["free_agency_status"] is None
        assert resp.data[0]["free_agency_status_display"] is None


class TestTeamFreeAgentTracker:
    def test_draft_outlook_uses_nfl_com_2026_team_needs(self, team_was):
        from gridstream.views import _build_team_draft_outlook

        with patch(
            "gridstream.views._fetch_tankathon_draft_rows", return_value=[]
        ), patch(
            "gridstream.views._fetch_nfl_draft_iq_consensus", return_value={}
        ), patch(
            "gridstream.views._fetch_nfl_draft_iq_true_adp_players", return_value=[]
        ):
            result = _build_team_draft_outlook(
                team=team_was,
                season_year=2026,
                unsigned_entries=[],
                incoming_entries=[],
                re_signed_entries=[],
                cuts=[],
                signed_elsewhere=[],
            )

        assert [entry["key"] for entry in result["team_needs"]] == [
            "EDGE",
            "WR",
            "LB",
            "CB",
            "TE",
        ]
        assert result["team_needs"][0]["detail"] == (
            "Priority #1 from NFL.com's Round 1 needs board"
        )
        assert result["draft_targets"] == []
        assert (
            result["draft_targets_source_url"]
            == "https://www.nfldraftiq.com/draft-consensus"
        )

    def test_draft_outlook_builds_targets_for_first_pick(self, team_was, team_sea):
        from gridstream.models import DraftProspect
        from gridstream.views import _build_team_draft_outlook

        consensus_rows = {
            "decisive": [],
            "indecisive": [
                {
                    "player_id": 2001,
                    "name": "Arvell Reese",
                    "position": "LB",
                    "school": "Ohio State",
                    "collegeLogoUrl": "https://example.com/osu.png",
                    "range": "Pick 2-12",
                    "teamBreakdown": [
                        {
                            "teamId": 32,
                            "teamName": "Washington Commanders",
                            "mockCount": 7,
                        }
                    ],
                    "imageUrl": "https://example.com/arvell.png",
                },
                {
                    "player_id": 2002,
                    "name": "Rueben Bain",
                    "position": "ED",
                    "school": "Miami (FL)",
                    "collegeLogoUrl": "https://example.com/miami.png",
                    "range": "Pick 2-20",
                    "teamBreakdown": [
                        {
                            "teamId": 32,
                            "teamName": "Washington Commanders",
                            "mockCount": 16,
                        }
                    ],
                    "imageUrl": "https://example.com/bain.png",
                },
                {
                    "player_id": 2003,
                    "name": "David Bailey",
                    "position": "ED",
                    "school": "Texas Tech",
                    "collegeLogoUrl": "https://example.com/ttu.png",
                    "range": "Pick 2-16",
                    "teamBreakdown": [
                        {
                            "teamId": 32,
                            "teamName": "Washington Commanders",
                            "mockCount": 32,
                        }
                    ],
                    "imageUrl": "https://example.com/bailey.png",
                },
                {
                    "player_id": 2004,
                    "name": "Caleb Downs",
                    "position": "S",
                    "school": "Ohio State",
                    "collegeLogoUrl": "https://example.com/osu2.png",
                    "range": "Pick 2-16",
                    "teamBreakdown": [
                        {
                            "teamId": 32,
                            "teamName": "Washington Commanders",
                            "mockCount": 10,
                        }
                    ],
                    "imageUrl": "https://example.com/downs.png",
                },
                {
                    "player_id": 2005,
                    "name": "Sonny Styles",
                    "position": "LB",
                    "school": "Ohio State",
                    "collegeLogoUrl": "https://example.com/osu3.png",
                    "range": "Pick 2-21",
                    "teamBreakdown": [
                        {
                            "teamId": 32,
                            "teamName": "Washington Commanders",
                            "mockCount": 20,
                        }
                    ],
                    "imageUrl": "https://example.com/styles.png",
                },
                {
                    "player_id": 2006,
                    "name": "Mansoor Delane",
                    "position": "CB",
                    "school": "LSU",
                    "collegeLogoUrl": "https://example.com/lsu.png",
                    "range": "Pick 4-20",
                    "teamBreakdown": [
                        {
                            "teamId": 32,
                            "teamName": "Washington Commanders",
                            "mockCount": 4,
                        }
                    ],
                    "imageUrl": "https://example.com/delane.png",
                },
            ],
        }
        true_adp_rows = [
            {"player_id": 2001, "true_adp": 3.3, "overall_rank": 2},
            {"player_id": 2002, "true_adp": 4.6, "overall_rank": 3},
            {"player_id": 2003, "true_adp": 6.2, "overall_rank": 4},
            {"player_id": 2004, "true_adp": 6.3, "overall_rank": 5},
            {"player_id": 2005, "true_adp": 10.7, "overall_rank": 10},
            {"player_id": 2006, "true_adp": 10.8, "overall_rank": 11},
        ]
        DraftProspect.objects.using("nfl").create(
            season=2026,
            source="nfldraftbuzz",
            source_slug="David-Bailey-DE-Stanford",
            source_url="https://www.nfldraftbuzz.com/Player/David-Bailey-DE-Stanford",
            name="David Bailey",
            position="EDGE",
            school="Stanford",
            class_year="Senior",
            hometown="Pittsburgh, PA",
            role="Speed rusher",
            jersey_number="4",
            overall_rating=89.7,
            overall_rank=5,
            position_rank=2,
            position_rank_group="EDGE",
            draft_projection="1st - Mid 1st",
            all_scouts_overall_rank=14.9,
            all_scouts_position_rank=2.0,
            height="6-4",
            weight=251,
            forty_yard=4.50,
            hand_size="9 5/8",
            arm_length="33 1/8",
            age=21.4,
            bio="David Bailey transferred to Stanford after a breakout season.",
            summary="Explosive first step with real edge speed.",
            strengths=["Explosive get-off", "Wins with speed-to-power"],
            weaknesses=["Needs more counters inside"],
            honors=["2025 All-ACC First Team"],
            production_stats=[
                {"label": "Sacks", "value": "13.5", "percentile": 96},
                {"label": "TFL", "value": "18", "percentile": 94},
            ],
            scouting_grades=[
                {"label": "Pass Rush", "value": "94%", "percent": 94},
                {"label": "Run Defense", "value": "81%", "percent": 81},
            ],
            measurable_percentiles=[
                {"label": "Forty", "value": "4.50", "percentile": 88},
            ],
            recruiting_ratings=[
                {"label": "247", "value": "95/100"},
            ],
            comparison_players=[
                {
                    "name": "Rashan Gary",
                    "school": "Michigan",
                    "similarity": 71,
                    "source_url": "https://www.nfldraftbuzz.com/Player/Rashan-Gary-LB-Michigan",
                }
            ],
            source_last_updated=date(2026, 1, 23),
        )
        DraftProspect.objects.using("nfl").create(
            season=2026,
            source="nfldraftbuzz",
            source_slug="Rueben-BainJr-DL-MiamiFL",
            source_url="https://www.nfldraftbuzz.com/Player/Rueben-BainJr-DL-MiamiFL",
            name="Rueben Bain Jr.",
            position="DE/EDGE",
            school="Miami",
            overall_rank=3,
            draft_projection="1st - Top 5",
            summary="Explosive edge defender with a hybrid alignment profile.",
            strengths=[
                "Explosive get-off",
                "Heavy hands",
            ],
            weaknesses=[
                "Shorter arms than a prototype edge",
            ],
        )

        with patch(
            "gridstream.views._fetch_tankathon_draft_rows",
            return_value=[
                {
                    "round": 1,
                    "overall_pick": 7,
                    "current_team_abbr": "WAS",
                    "original_team_abbr": "WAS",
                    "compensatory": False,
                },
                {
                    "round": 1,
                    "overall_pick": 12,
                    "current_team_abbr": "SEA",
                    "original_team_abbr": "SEA",
                    "compensatory": False,
                },
            ],
        ), patch(
            "gridstream.views._fetch_nfl_draft_iq_consensus",
            return_value=consensus_rows,
        ), patch(
            "gridstream.views._fetch_nfl_draft_iq_true_adp_players",
            return_value=true_adp_rows,
        ):
            result = _build_team_draft_outlook(
                team=team_was,
                season_year=2026,
                unsigned_entries=[],
                incoming_entries=[],
                re_signed_entries=[],
                cuts=[],
                signed_elsewhere=[],
            )

        assert result["draft_picks"][0]["overall_pick"] == 7
        assert [entry["name"] for entry in result["draft_targets"]] == [
            "David Bailey",
            "Rueben Bain",
            "Sonny Styles",
            "Arvell Reese",
            "Caleb Downs",
        ]
        assert result["draft_targets"][0]["team_mock_count"] == 32
        assert result["draft_targets"][0]["overall_rank"] == 4
        assert result["draft_targets"][0]["need_key"] == "EDGE"
        assert result["draft_targets"][0]["need_label"] == "Edge"
        assert "Washington Commanders" in result["draft_targets"][0]["fit_reason"]
        assert (
            result["draft_targets_source_url"]
            == "https://www.nfldraftiq.com/draft-consensus"
        )
        assert (
            result["draft_targets"][0]["source_url"]
            == "https://www.nfldraftbuzz.com/Player/David-Bailey-DE-Stanford"
        )
        assert (
            result["draft_targets"][0]["source_label"] == "NFLDraftBuzz scouting report"
        )
        assert result["draft_targets"][0]["buzz_overall_rating"] == 89.7
        assert result["draft_targets"][0]["strengths"] == [
            "Explosive get-off",
            "Wins with speed-to-power",
        ]
        assert result["draft_targets"][0]["production_stats"][0]["label"] == "Sacks"
        fit_logos = {
            entry["team_detail"]["abbreviation"]: entry["team_detail"]["logo_url"]
            for entry in result["draft_targets"][0]["fit_teams"]
        }
        assert fit_logos["WAS"].endswith("/wsh.png")
        assert all(
            "secondary_logo_white" not in (logo or "") for logo in fit_logos.values()
        )
        bain_target = next(
            entry for entry in result["draft_targets"] if entry["name"] == "Rueben Bain"
        )
        assert (
            bain_target["source_url"]
            == "https://www.nfldraftbuzz.com/Player/Rueben-BainJr-DL-MiamiFL"
        )
        assert (
            bain_target["summary"]
            == "Explosive edge defender with a hybrid alignment profile."
        )
        assert bain_target["strengths"] == [
            "Explosive get-off",
            "Heavy hands",
        ]
        assert all(
            (entry.get("overall_pick") or 999) <= 20
            for entry in bain_target["fit_teams"]
        )
        assert [
            entry["team_detail"]["abbreviation"]
            for entry in result["draft_targets"][0]["fit_teams"][:2]
        ] == [
            "WAS",
            "SEA",
        ]
        assert result["draft_targets"][0]["fit_teams"][0]["pick_label"] == "Pick #7"
        assert result["draft_targets"][0]["fit_teams"][1]["pick_label"] == "Pick #12"

    def test_tracker_returns_team_rows(
        self, api_client, team_sea, team_was, player_qb, player_was_qb
    ):
        from gridstream.models import (
            Player,
            PlayerContract,
            PlayerTransaction,
            TeamFreeAgentTrackerEntry,
        )

        current_year = date.today().year
        PlayerContract.objects.using("nfl").create(
            player=player_was_qb,
            team=team_was,
            is_active=True,
            year_signed=current_year,
            years=2,
            total_value=12000000,
            apy=6000000,
            guaranteed=9000000,
            otc_url="https://overthecap.com/player/example",
        )
        TeamFreeAgentTrackerEntry.objects.using("nfl").create(
            team=team_was,
            season=current_year,
            player=player_was_qb,
            player_name=player_was_qb.display_name,
            ourlads_player_id="4432577",
            position="QB",
            fa_type="UFA",
            signed_with_team=team_was,
            tracker_status="re_signed",
            source_url="https://www.ourlads.com/nfl-free-agent-tracker/team/washington-commanders/2026",
        )
        PlayerContract.objects.using("nfl").create(
            player=player_qb,
            team=team_was,
            is_active=True,
            year_signed=current_year,
            years=1,
            total_value=4000000,
            apy=4000000,
            guaranteed=2500000,
            otc_url="https://overthecap.com/player/geno-smith",
        )
        TeamFreeAgentTrackerEntry.objects.using("nfl").create(
            team=team_sea,
            season=current_year,
            player=player_qb,
            player_name=player_qb.display_name,
            ourlads_player_id="3917315",
            position="QB",
            fa_type="UFA",
            signed_with_team=team_was,
            tracker_status="signed_elsewhere",
            source_url="https://www.ourlads.com/nfl-free-agent-tracker/team/seattle-seahawks/2026",
        )
        departed_player = Player.objects.using("nfl").create(
            gsis_id="00-0092002",
            espn_id="92002",
            display_name="Released Elsewhere Sample",
            short_name="R. Sample",
            first_name="Released",
            last_name="Sample",
            jersey_number="29",
            position="CB",
            position_group="CB",
            current_team=None,
            roster_status="UFA",
            rookie_season=current_year - 4,
            draft_year=current_year - 4,
            is_active=True,
        )
        TeamFreeAgentTrackerEntry.objects.using("nfl").create(
            team=team_was,
            season=current_year,
            player=departed_player,
            player_name=departed_player.display_name,
            ourlads_player_id="9990001",
            position="CB",
            fa_type="UFA",
            signed_with_team=None,
            tracker_status="unsigned",
            source_url="https://www.ourlads.com/nfl-free-agent-tracker/team/washington-commanders/2026",
        )
        PlayerTransaction.objects.using("nfl").create(
            player=player_was_qb,
            transaction_type="released",
            date=date(current_year, 3, 5),
            from_team=team_was,
            description="Released ahead of the new league year",
            season=current_year,
        )
        PlayerTransaction.objects.using("nfl").create(
            player=player_was_qb,
            transaction_type="released",
            date=date(current_year, 3, 6),
            from_team=team_was,
            description="Released ahead of the new league year",
            season=current_year,
        )
        PlayerTransaction.objects.using("nfl").create(
            player=departed_player,
            transaction_type="signed",
            date=date(current_year, 3, 7),
            to_team=team_sea,
            description="Signed elsewhere after release",
            season=current_year,
        )
        extension_player = Player.objects.using("nfl").create(
            gsis_id="00-0099999",
            espn_id="9999999",
            display_name="Terry Sample",
            short_name="T. Sample",
            first_name="Terry",
            last_name="Sample",
            jersey_number="17",
            position="WR",
            position_group="WR",
            current_team=team_was,
            roster_status="ACT",
            rookie_season=current_year - 4,
            draft_year=current_year - 4,
            is_active=True,
        )
        PlayerContract.objects.using("nfl").create(
            player=extension_player,
            team=team_was,
            is_active=True,
            year_signed=current_year,
            years=3,
            total_value=27000000,
            apy=9000000,
            guaranteed=18000000,
            otc_url="https://overthecap.com/player/terry-sample",
        )
        stale_extension_player = Player.objects.using("nfl").create(
            gsis_id="00-0099998",
            espn_id="9999998",
            display_name="Old Contract Sample",
            short_name="O. Sample",
            first_name="Old",
            last_name="Sample",
            jersey_number="18",
            position="DE",
            position_group="DL",
            current_team=team_was,
            roster_status="ACT",
            rookie_season=current_year - 5,
            draft_year=current_year - 5,
            is_active=True,
        )
        PlayerContract.objects.using("nfl").create(
            player=stale_extension_player,
            team=team_was,
            is_active=True,
            year_signed=current_year - 1,
            years=2,
            total_value=8000000,
            apy=4000000,
            guaranteed=3000000,
            otc_url="https://overthecap.com/player/old-contract-sample",
        )

        url = reverse("team-free-agent-tracker", kwargs={"abbreviation": "WAS"})
        with patch(
            "gridstream.views._build_team_draft_outlook",
            return_value={
                "source_url": "https://www.tankathon.com/nfl/full_draft",
                "draft_picks": [
                    {
                        "round": 1,
                        "overall_pick": 29,
                        "current_team_abbr": "WAS",
                        "original_team_abbr": "WAS",
                        "compensatory": False,
                    }
                ],
                "team_needs": [
                    {
                        "key": "CB",
                        "label": "Cornerback",
                        "score": 5,
                        "detail": "2 under contract · 1 leaving / unsigned",
                    }
                ],
                "draft_targets_source_url": "https://www.nfldraftiq.com/draft-consensus",
                "draft_targets": [
                    {
                        "player_id": 2001,
                        "name": "Arvell Reese",
                        "position": "LB",
                        "school": "Ohio State",
                        "range": "Pick 2-12",
                        "team_mock_count": 7,
                        "total_mock_count": 82,
                        "consensus_type": "indecisive",
                        "overall_rank": 2,
                        "true_adp": 3.3,
                    }
                ],
            },
        ):
            resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["season"] == current_year
        assert resp.data["team"]["abbreviation"] == "WAS"
        assert resp.data["count"] == 2
        results_by_name = {row["player_name"]: row for row in resp.data["results"]}
        assert results_by_name["Jayden Daniels"]["tracker_status"] == "re_signed"
        assert (
            results_by_name["Jayden Daniels"]["signed_with_team_detail"]["abbreviation"]
            == "WAS"
        )
        assert results_by_name["Jayden Daniels"]["contract_detail"] == {
            "year_signed": current_year,
            "years": 2,
            "total_value": 12000000,
            "apy": 6000000,
            "guaranteed": 9000000,
            "is_active": True,
            "otc_url": "https://overthecap.com/player/example",
        }
        assert (
            results_by_name["Released Elsewhere Sample"]["tracker_status"] == "unsigned"
        )
        assert resp.data["incoming_count"] == 1
        assert resp.data["incoming_results"][0]["player_name"] == "Geno Smith"
        assert resp.data["incoming_results"][0]["team_detail"]["abbreviation"] == "SEA"
        assert (
            resp.data["incoming_results"][0]["signed_with_team_detail"]["abbreviation"]
            == "WAS"
        )
        assert resp.data["incoming_results"][0]["contract_detail"] == {
            "year_signed": current_year,
            "years": 1,
            "total_value": 4000000,
            "apy": 4000000,
            "guaranteed": 2500000,
            "is_active": True,
            "otc_url": "https://overthecap.com/player/geno-smith",
        }
        assert resp.data["cuts_count"] == 1
        assert resp.data["cuts"][0]["player_name"] == "Jayden Daniels"
        assert resp.data["cuts"][0]["transaction_type"] == "released"
        assert resp.data["cuts"][0]["date"] == str(date(current_year, 3, 6))
        assert resp.data["signed_elsewhere_count"] == 1
        assert (
            resp.data["signed_elsewhere"][0]["player_name"]
            == "Released Elsewhere Sample"
        )
        assert (
            resp.data["signed_elsewhere"][0]["to_team_detail"]["abbreviation"] == "SEA"
        )
        assert resp.data["contract_changes_count"] == 1
        assert resp.data["contract_changes"][0]["player_name"] == "Terry Sample"
        assert resp.data["contract_changes"][0]["year_signed"] == current_year
        assert resp.data["contract_changes"][0]["apy"] == 9000000
        assert {entry["player_name"] for entry in resp.data["contract_changes"]} == {
            "Terry Sample"
        }
        assert (
            resp.data["draft_source_url"] == "https://www.tankathon.com/nfl/full_draft"
        )
        assert resp.data["draft_picks"][0]["overall_pick"] == 29
        assert resp.data["team_needs"][0]["key"] == "CB"
        assert (
            resp.data["draft_targets_source_url"]
            == "https://www.nfldraftiq.com/draft-consensus"
        )
        assert resp.data["draft_targets"][0]["name"] == "Arvell Reese"

    def test_tracker_uses_spotrac_contract_fallback_for_incoming_signing(
        self, api_client, team_was, team_sea
    ):
        from gridstream.models import (
            Player,
            PlayerTransaction,
            TeamFreeAgentTrackerEntry,
        )

        current_year = date.today().year
        incoming_player = Player.objects.using("nfl").create(
            gsis_id="00-0093001",
            espn_id="93001",
            display_name="Tim Settle",
            short_name="T. Settle",
            first_name="Tim",
            last_name="Settle",
            jersey_number="99",
            position="DT",
            position_group="DL",
            current_team=team_was,
            roster_status="ACT",
            rookie_season=current_year - 6,
            draft_year=current_year - 6,
            is_active=True,
        )
        TeamFreeAgentTrackerEntry.objects.using("nfl").create(
            team=team_sea,
            season=current_year,
            player=incoming_player,
            player_name=incoming_player.display_name,
            ourlads_player_id="25264",
            position="DT",
            fa_type="UFA",
            signed_with_team=team_was,
            tracker_status="signed_elsewhere",
            source_url="https://www.ourlads.com/nfl-free-agent-tracker/team/seattle-seahawks/2026",
        )
        PlayerTransaction.objects.using("nfl").create(
            player=incoming_player,
            transaction_type="signed",
            date=date(current_year, 3, 8),
            from_team=team_sea,
            to_team=team_was,
            description="Spotrac: Signed a 3 year $24 million contract with Washington (WAS)",
            contract_years=3,
            contract_total_value=24000000,
            contract_apy=8000000,
            contract_guaranteed=0,
            season=current_year,
        )

        url = reverse("team-free-agent-tracker", kwargs={"abbreviation": "WAS"})
        with patch(
            "gridstream.views._build_team_draft_outlook",
            return_value={
                "source_url": None,
                "draft_picks": [],
                "team_needs": [],
                "draft_targets_source_url": None,
                "draft_targets": [],
            },
        ):
            resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["incoming_count"] == 1
        assert resp.data["incoming_results"][0]["player_name"] == "Tim Settle"
        assert resp.data["incoming_results"][0]["contract_detail"] == {
            "year_signed": current_year,
            "years": 3,
            "total_value": 24000000,
            "apy": 8000000,
            "guaranteed": None,
            "is_active": True,
            "otc_url": None,
        }

    def test_tracker_handles_missing_tracker_table(self, api_client, team_was):
        from django.db.utils import ProgrammingError

        url = reverse("team-free-agent-tracker", kwargs={"abbreviation": "WAS"})

        with patch(
            "gridstream.views.TeamFreeAgentTrackerEntry.objects.filter",
            side_effect=ProgrammingError(
                'relation "gridstream_teamfreeagenttrackerentry" does not exist'
            ),
        ), patch(
            "gridstream.views._build_team_draft_outlook",
            return_value={
                "source_url": None,
                "draft_picks": [],
                "team_needs": [],
                "draft_targets_source_url": None,
                "draft_targets": [],
            },
        ):
            resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["team"]["abbreviation"] == "WAS"
        assert resp.data["count"] == 0
        assert resp.data["results"] == []
        assert resp.data["incoming_count"] == 0
        assert resp.data["incoming_results"] == []
        assert resp.data["cuts_count"] == 0
        assert resp.data["cuts"] == []
        assert resp.data["signed_elsewhere_count"] == 0
        assert resp.data["signed_elsewhere"] == []
        assert resp.data["contract_changes_count"] == 0
        assert resp.data["contract_changes"] == []
        assert resp.data["draft_picks"] == []
        assert resp.data["team_needs"] == []
        assert resp.data["draft_targets"] == []


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


class TestTeamDvoa:
    def test_dvoa_rankings_returns_latest_season_by_default(
        self, api_client, team_sea, team_was
    ):
        from gridstream.models import TeamDvoaRating

        TeamDvoaRating.objects.using("nfl").create(
            team=team_sea,
            season=2024,
            season_type="REG",
            week=18,
            total_dvoa=8.1,
            total_dvoa_rank=9,
        )
        TeamDvoaRating.objects.using("nfl").create(
            team=team_was,
            season=2024,
            season_type="REG",
            week=18,
            total_dvoa=-3.4,
            total_dvoa_rank=19,
        )
        TeamDvoaRating.objects.using("nfl").create(
            team=team_sea,
            season=2025,
            season_type="REG",
            week=18,
            total_dvoa=14.2,
            total_dvoa_rank=5,
        )
        TeamDvoaRating.objects.using("nfl").create(
            team=team_was,
            season=2025,
            season_type="REG",
            week=18,
            total_dvoa=7.8,
            total_dvoa_rank=10,
        )

        url = reverse("team-dvoa-rankings")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["season"] == 2025
        assert resp.data["season_type"] == "REG"
        assert resp.data["count"] == 2
        assert resp.data["results"][0]["team"]["abbreviation"] == "SEA"
        assert resp.data["results"][0]["total_dvoa_rank"] == 5

    def test_team_dvoa_history_groups_reg_and_post(self, api_client, team_sea):
        from gridstream.models import TeamDvoaRating

        TeamDvoaRating.objects.using("nfl").create(
            team=team_sea,
            season=2023,
            season_type="REG",
            week=18,
            total_dvoa=3.1,
            total_dvoa_rank=14,
        )
        TeamDvoaRating.objects.using("nfl").create(
            team=team_sea,
            season=2024,
            season_type="POST",
            week=22,
            total_dvoa=5.5,
            total_dvoa_rank=12,
        )
        TeamDvoaRating.objects.using("nfl").create(
            team=team_sea,
            season=2025,
            season_type="REG",
            week=18,
            total_dvoa=14.2,
            total_dvoa_rank=5,
        )

        url = reverse("team-dvoa", kwargs={"abbreviation": "SEA"})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["team"]["abbreviation"] == "SEA"
        assert len(resp.data["history"]["REG"]) == 2
        assert len(resp.data["history"]["POST"]) == 1
        assert resp.data["latest"]["REG"]["season"] == 2025
        assert resp.data["latest"]["POST"]["season"] == 2024

    def test_team_rankings_includes_dvoa_fields(
        self, api_client, team_sea, team_was, game_final, team_game_stats_sea
    ):
        from gridstream.models import TeamDvoaRating, TeamGameStats

        TeamGameStats.objects.using("nfl").create(
            team=team_was,
            game=game_final,
            opponent=team_sea,
            season_year=2024,
            week=1,
            is_home=False,
            total_yards=330,
            pass_yards=230,
            rush_yards=100,
            points_scored=20,
            points_allowed=26,
            turnovers=2,
            takeaways=1,
            offensive_epa=-3.8,
            defensive_epa=3.1,
            time_of_possession_seconds=1665,
        )

        TeamDvoaRating.objects.using("nfl").create(
            team=team_sea,
            season=2024,
            season_type="REG",
            week=18,
            total_dvoa=12.4,
            offense_dvoa=10.2,
            defense_dvoa=-6.8,
            special_teams_dvoa=2.5,
            weighted_total_dvoa=13.7,
            total_dvoa_rank=4,
        )
        TeamDvoaRating.objects.using("nfl").create(
            team=team_was,
            season=2024,
            season_type="REG",
            week=18,
            total_dvoa=-4.6,
            offense_dvoa=-2.3,
            defense_dvoa=4.2,
            special_teams_dvoa=-1.1,
            weighted_total_dvoa=-5.2,
            total_dvoa_rank=21,
        )

        url = reverse("team-rankings")
        resp = api_client.get(url, {"season": 2024, "abbr": "SEA"})

        assert resp.status_code == status.HTTP_200_OK
        assert "dvoa_total" in resp.data
        assert "dvoa_offense" in resp.data
        assert "dvoa_defense" in resp.data
        assert "dvoa_special_teams" in resp.data
        assert "dvoa_weighted" in resp.data

        total = resp.data["dvoa_total"]
        assert total["label"] == "Total DVOA"
        assert total["league_rank"] == 1
        assert total["value"] == pytest.approx(12.4)
