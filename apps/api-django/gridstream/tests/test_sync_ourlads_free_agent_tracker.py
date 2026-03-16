"""Tests for the Ourlads free-agent tracker sync parser."""

import pytest

from gridstream.management.commands.sync_ourlads_free_agent_tracker import (
    _extract_tracker_entries,
)


def test_extract_tracker_entries_parses_rows_and_team_codes():
    html = """
    <table>
      <tbody id="ctl00_phContent_dcTBody">
        <tr>
          <td>
            <a href="https://www.ourlads.com/nfldepthcharts/player/40387"><b>Biadasz, Tyler</b></a>
          </td>
          <td><a href="/nfldepthcharts/depthchart/WAS">WAS</a></td>
          <td>C</td>
          <td>CC</td>
          <td><a href="/nfldepthcharts/depthchart/WAS">WAS</a></td>
        </tr>
        <tr>
          <td>
            <a href="https://www.ourlads.com/nfldepthcharts/player/12345"><b>Example, Player Jr.</b></a>
          </td>
          <td><a href="/nfldepthcharts/depthchart/ARZ">ARZ</a></td>
          <td>WR</td>
          <td>UFA</td>
          <td>&nbsp;</td>
        </tr>
      </tbody>
    </table>
    """

    entries = _extract_tracker_entries(
        "https://www.ourlads.com/nfl-free-agent-tracker/team/washington-commanders/2026",
        html,
    )

    assert len(entries) == 2
    assert entries[0].player_name == "Biadasz, Tyler"
    assert entries[0].ourlads_player_id == "40387"
    assert entries[0].position == "C"
    assert entries[0].fa_type == "CC"
    assert entries[0].signed_with_team_abbr == "WAS"
    assert entries[1].player_name == "Example, Player Jr."
    assert entries[1].ourlads_player_id == "12345"
    assert entries[1].fa_type == "UFA"
    assert entries[1].signed_with_team_abbr is None


def test_extract_tracker_entries_returns_empty_list_without_tracker_table():
    entries = _extract_tracker_entries(
        "https://www.ourlads.com/nfl-free-agent-tracker/team/washington-commanders/2026",
        "<html><body><table><tbody><tr><td>No tracker</td></tr></tbody></table></body></html>",
    )

    assert entries == []
