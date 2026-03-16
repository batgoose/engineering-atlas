import json
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from gridstream.management.commands.bootstrap_nfl_v2 import Command


def test_bootstrap_runs_expected_command_sequence():
    seen = []

    def fake_call_command(name, *args, **kwargs):
        seen.append((name, kwargs))
        if name == "check_data_health":
            kwargs["stdout"].write(
                json.dumps(
                    {
                        "checks": [{"name": "Games", "status": "OK", "detail": "1"}],
                        "suggestions": [],
                    }
                )
            )

    with patch(
        "gridstream.management.commands.bootstrap_nfl_v2.call_command",
        side_effect=fake_call_command,
    ):
        call_command(
            "bootstrap_nfl_v2",
            database="nfl",
            skip_raw_ingest=True,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    command_names = [name for name, _kwargs in seen]
    assert command_names == [
        "migrate",
        "seed_teams",
        "materialize_plays",
        "seed_venues",
        "seed_players",
        "enrich_players",
        "seed_social_accounts",
        "sync_rosters",
        "import_games",
        "normalize_venues",
        "import_drives",
        "import_plays",
        "import_player_game_stats",
        "import_team_game_stats",
        "materialize_player_game_stats",
        "materialize_team_game_stats",
        "import_nflverse_snap_counts",
        "import_nflverse_depth_charts",
        "sync_player_positions",
        "import_nflverse_standings",
        "import_nflverse_draft_picks",
        "import_nflverse_draft_values",
        "import_nflverse_trades",
        "check_data_health",
    ]
    assert seen[0][1]["database"] == "nfl"
    assert seen[-1][1]["json"] is True


def test_bootstrap_strict_qa_fails_on_warning():
    def fake_call_command(name, *args, **kwargs):
        if name == "check_data_health":
            kwargs["stdout"].write(
                json.dumps(
                    {
                        "checks": [
                            {
                                "name": "ESPN Sync",
                                "status": "WARN",
                                "detail": "stale",
                            }
                        ],
                        "suggestions": [],
                    }
                )
            )

    with patch(
        "gridstream.management.commands.bootstrap_nfl_v2.call_command",
        side_effect=fake_call_command,
    ):
        with pytest.raises(CommandError, match="strict mode"):
            call_command(
                "bootstrap_nfl_v2",
                database="nfl",
                skip_migrate=True,
                skip_raw_ingest=True,
                skip_core_transforms=True,
                strict_qa=True,
                stdout=StringIO(),
                stderr=StringIO(),
                verbosity=0,
            )


def test_bootstrap_raw_stage_writes_fallback_batch_if_missing():
    with patch.object(Command, "_run_shell_command", return_value=None), patch.object(
        Command,
        "_get_raw_play_stats",
        side_effect=[
            {"table_exists": True, "row_count": 100},
            {"table_exists": True, "row_count": 140},
        ],
    ), patch.object(
        Command,
        "_get_raw_batch_count",
        side_effect=[10, 10],
    ), patch.object(
        Command,
        "_insert_fallback_raw_batch",
    ) as insert_fallback:
        call_command(
            "bootstrap_nfl_v2",
            database="nfl",
            skip_migrate=True,
            skip_core_transforms=True,
            skip_qa=True,
            raw_ingest_cmd="echo ingest",
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    insert_fallback.assert_called_once()


def test_bootstrap_include_espn_sync_runs_probability_import():
    seen = []

    def fake_call_command(name, *args, **kwargs):
        seen.append((name, kwargs))
        if name == "check_data_health":
            kwargs["stdout"].write(
                json.dumps(
                    {
                        "checks": [{"name": "Games", "status": "OK", "detail": "1"}],
                        "suggestions": [],
                    }
                )
            )

    with patch(
        "gridstream.management.commands.bootstrap_nfl_v2.call_command",
        side_effect=fake_call_command,
    ):
        call_command(
            "bootstrap_nfl_v2",
            database="nfl",
            skip_raw_ingest=True,
            include_espn_sync=True,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    command_names = [name for name, _kwargs in seen]
    sync_idx = command_names.index("sync_espn_games")
    prob_idx = command_names.index("import_espn_probabilities")
    qa_idx = command_names.index("check_data_health")
    assert sync_idx < prob_idx < qa_idx
