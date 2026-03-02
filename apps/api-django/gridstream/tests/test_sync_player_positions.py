import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connections

from gridstream.models import Player

pytestmark = [pytest.mark.django_db(databases=["default", "nfl"])]


def _ensure_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS raw")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_depth_charts (
                id BIGSERIAL PRIMARY KEY,
                season INTEGER,
                week INTEGER,
                player_id TEXT,
                position TEXT,
                depth_rank INTEGER,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb
            )
            """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_snap_counts (
                id BIGSERIAL PRIMARY KEY,
                season INTEGER,
                week INTEGER,
                player_id TEXT,
                offense_snaps INTEGER,
                defense_snaps INTEGER,
                special_snaps INTEGER,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb
            )
            """)


class TestSyncPlayerPositions:
    def test_backfills_oline_split_from_depth_charts(self, db, team_sea):
        _ensure_raw_tables()

        player = Player.objects.using("nfl").create(
            gsis_id="00-OL-TST-1",
            pfr_id="TestPl01",
            display_name="Test Tackle",
            first_name="Test",
            last_name="Tackle",
            position="OL",
            position_group="OL",
            current_team=team_sea,
            roster_status="ACT",
            is_active=True,
        )

        with connections["nfl"].cursor() as cursor:
            cursor.execute(
                "DELETE FROM raw.raw_nflverse_depth_charts WHERE player_id = %s",
                [player.gsis_id],
            )
            cursor.execute(
                """
                INSERT INTO raw.raw_nflverse_depth_charts (
                    season, week, player_id, position, depth_rank, payload
                ) VALUES
                    (2024, 18, %s, 'OL', 1, %s::jsonb),
                    (2025, 1, %s, 'OL', 1, %s::jsonb)
                """,
                [
                    player.gsis_id,
                    json.dumps({"pos_abb": "LG", "depth_position": "LG"}),
                    player.gsis_id,
                    json.dumps({"pos_abb": "LT", "depth_position": "LT"}),
                ],
            )

        call_command("sync_player_positions", stdout=StringIO(), stderr=StringIO())

        player.refresh_from_db(using="nfl")
        assert player.position == "T"
        assert player.position_group == "OL"
        assert player.depth_chart_position == "LT"

    def test_falls_back_to_snap_counts_when_depth_missing(self, db, team_sea):
        _ensure_raw_tables()

        player = Player.objects.using("nfl").create(
            gsis_id="00-OL-TST-2",
            pfr_id="SnapPl01",
            display_name="Test Guard",
            first_name="Test",
            last_name="Guard",
            position="OL",
            position_group="OL",
            current_team=team_sea,
            roster_status="ACT",
            is_active=True,
        )

        with connections["nfl"].cursor() as cursor:
            cursor.execute(
                "DELETE FROM raw.raw_nflverse_depth_charts WHERE player_id = %s",
                [player.gsis_id],
            )
            cursor.execute(
                "DELETE FROM raw.raw_nflverse_snap_counts WHERE player_id = %s",
                [player.pfr_id],
            )
            cursor.execute(
                """
                INSERT INTO raw.raw_nflverse_snap_counts (
                    season, week, player_id, offense_snaps, defense_snaps, special_snaps, payload
                ) VALUES
                    (2025, 1, %s, 60, 0, 0, %s::jsonb)
                """,
                [
                    player.pfr_id,
                    json.dumps({"position": "RG"}),
                ],
            )

        call_command("sync_player_positions", stdout=StringIO(), stderr=StringIO())

        player.refresh_from_db(using="nfl")
        assert player.position == "G"
        assert player.position_group == "OL"
        assert player.depth_chart_position == "RG"
