from io import StringIO
from unittest.mock import Mock, patch

import pytest
from django.core.management import call_command

from gridstream.management.commands.sync_college_history import Command, _extract_year
from gridstream.models import Player, PlayerCollegeHistory

pytestmark = [pytest.mark.django_db(databases=["default", "nfl"])]


def _mock_json_response(payload: dict) -> Mock:
    response = Mock()
    response.raise_for_status = Mock()
    response.json = Mock(return_value=payload)
    return response


def test_extract_year_handles_valid_and_invalid_values():
    assert _extract_year("2022-01-01T00:00:00Z") == 2022
    assert _extract_year("2019") == 2019
    assert _extract_year("not-a-date") is None
    assert _extract_year(None) is None


def test_query_contains_pfr_id_normalization_replace():
    cmd = Command()
    captured_query = {}

    def _fake_get(url, params=None, timeout=None, headers=None):
        captured_query["query"] = params["query"]
        return _mock_json_response({"results": {"bindings": []}})

    with patch(
        "gridstream.management.commands.sync_college_history.requests.get",
        side_effect=_fake_get,
    ):
        rows = cmd._query_wikidata_chunk(["MahoPa00"])

    assert rows == []
    assert 'REPLACE(STR(?pfr_ref), "^.*/", "") AS ?pfr_id' in captured_query["query"]


def test_build_entries_filters_high_school_and_sets_primary_and_sequence(player_was_qb):
    cmd = Command()
    rows = [
        {"college": "Arizona State", "start_year": 2019, "end_year": 2021},
        {"college": "LSU", "start_year": 2022, "end_year": 2023},
        {"college": "LSU", "start_year": 2021, "end_year": 2024},
        {"college": "Some High School", "start_year": 2017, "end_year": 2018},
    ]

    entries = cmd._build_entries_for_player(player_was_qb, rows)

    assert [entry.college for entry in entries] == ["Arizona State", "LSU"]
    assert [entry.sequence for entry in entries] == [1, 2]
    assert [entry.is_primary for entry in entries] == [False, True]
    assert entries[1].start_year == 2021
    assert entries[1].end_year == 2024


def test_sync_college_history_command_writes_rows(db, team_sea):
    player = Player.objects.using("nfl").create(
        gsis_id="00-TEST-COLLEGE-1",
        pfr_id="MahoPa00",
        display_name="Patrick Mahomes",
        first_name="Patrick",
        last_name="Mahomes",
        position="QB",
        position_group="QB",
        current_team=team_sea,
        college="Texas Tech",
        is_active=True,
    )

    payload = {
        "results": {
            "bindings": [
                {
                    "pfr_id": {"value": "MahoPa00"},
                    "collegeLabel": {"value": "Texas Tech"},
                    "start": {"value": "2014-01-01T00:00:00Z"},
                    "end": {"value": "2016-01-01T00:00:00Z"},
                },
                {
                    "pfr_id": {"value": "MahoPa00"},
                    "collegeLabel": {"value": "Texas Tech"},
                    "start": {"value": "2013-01-01T00:00:00Z"},
                    "end": {"value": "2016-01-01T00:00:00Z"},
                },
                {
                    "pfr_id": {"value": "MahoPa00"},
                    "collegeLabel": {"value": "Whitehouse High School"},
                    "start": {"value": "2010-01-01T00:00:00Z"},
                    "end": {"value": "2012-01-01T00:00:00Z"},
                },
            ]
        }
    }

    with patch(
        "gridstream.management.commands.sync_college_history.requests.get",
        return_value=_mock_json_response(payload),
    ):
        call_command(
            "sync_college_history",
            chunk_size=50,
            batch_size=50,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    rows = list(
        PlayerCollegeHistory.objects.using("nfl")
        .filter(player=player)
        .order_by("sequence")
    )
    assert len(rows) == 1
    assert rows[0].college == "Texas Tech"
    assert rows[0].start_year == 2013
    assert rows[0].end_year == 2016
    assert rows[0].is_primary is True
