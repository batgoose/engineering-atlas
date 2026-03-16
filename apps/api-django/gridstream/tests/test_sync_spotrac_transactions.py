from io import StringIO
from unittest.mock import Mock, patch

import pytest
from django.core.management import call_command

from gridstream.management.commands.sync_spotrac_transactions import (
    _build_players_by_key,
    _extract_spotrac_free_agent_contracts,
    _extract_spotrac_transactions,
    _match_player,
)

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


def test_extract_spotrac_transactions_parses_release_rows():
    html = """
    <ul>
      <li class="list-group-item d-flex list-group-item-secondary justify-content-between align-items-center">
        <span class="col-md-8 col-sm-8">
          <a href="https://www.spotrac.com/nfl/player/_/id/47741/tyler-biadasz" class="text-danger h4">Tyler Biadasz (C)</a>
          <small class="d-block"><strong>Feb 27, 2026</strong> - Released by Washington (WAS), clearing $2.85M of cap space</small>
        </span>
      </li>
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <span class="col-md-8 col-sm-8">
          <a href="https://www.spotrac.com/nfl/player/_/id/21752/marshon-lattimore" class="text-danger h4">Marshon Lattimore (CB)</a>
          <small class="d-block"><strong>Mar 02, 2026</strong> - Released by Washington (WAS), clearing $18.5M of cap space</small>
        </span>
      </li>
    </ul>
    """

    entries = _extract_spotrac_transactions(
        "https://www.spotrac.com/nfl/transactions/_/team/was",
        html,
        2026,
    )

    assert len(entries) == 2
    assert entries[0].player_name == "Tyler Biadasz"
    assert entries[0].position == "C"
    assert (
        entries[0].detail
        == "Released by Washington (WAS), clearing $2.85M of cap space"
    )
    assert entries[1].player_name == "Marshon Lattimore"
    assert entries[1].position == "CB"


def test_extract_spotrac_free_agent_contracts_parses_contract_rows():
    html = """
    <table>
      <tbody>
        <tr class="">
          <td class=" text-center  px-0 text-muted">
            <img src="https://media.spotrac.com/images/thumb/hou.png" width="25" />
            <span class="d-none">HOU</span>
          </td>
          <td class=" text-center px-0 text-muted">
            <i class="fa-solid fa-arrow-right"></i>
          </td>
          <td class=" text-center  px-0 text-muted">
            <img src="https://media.spotrac.com/images/thumb/was_2022.png" width="25" />
            <span class="d-none">WAS</span>
          </td>
          <td class="text-left" data-order="Settle">
            <a href="https://www.spotrac.com/nfl/player/_/id/25264/tim-settle" class="link">Tim Settle</a>
          </td>
          <td class=" text-center">DL</td>
          <td class=" text-center w-50px text-center " data-sort="3">3</td>
          <td class=" text-center  text-center " data-sort="24000000">$24,000,000</td>
          <td class=" text-center text-center " data-sort="8000000">$8,000,000</td>
          <td class=" text-center text-center " data-sort="0">$0</td>
          <td class=" text-center text-center " data-sort="0">$0</td>
          <td class=" text-center text-nowrap text-center " data-sort=""></td>
        </tr>
      </tbody>
    </table>
    """

    entries = _extract_spotrac_free_agent_contracts(
        "https://www.spotrac.com/nfl/free-agents",
        html,
    )

    assert len(entries) == 1
    assert entries[0].player_name == "Tim Settle"
    assert entries[0].from_team_abbr == "HOU"
    assert entries[0].to_team_abbr == "WAS"
    assert entries[0].years == 3
    assert entries[0].total_value == 24000000
    assert entries[0].apy == 8000000
    assert entries[0].guaranteed == 0


def test_sync_spotrac_transactions_creates_release_and_updates_player(team_was):
    from gridstream.models import Player, PlayerTransaction

    player = Player.objects.using("nfl").create(
        gsis_id="00-0091001",
        espn_id="47741",
        display_name="Tyler Biadasz",
        short_name="T. Biadasz",
        first_name="Tyler",
        last_name="Biadasz",
        position="C",
        position_group="OL",
        current_team=team_was,
        roster_status="ACT",
        is_active=True,
    )

    html = """
    <ul>
      <li class="list-group-item d-flex list-group-item-secondary justify-content-between align-items-center">
        <span class="col-md-8 col-sm-8">
          <a href="https://www.spotrac.com/nfl/player/_/id/47741/tyler-biadasz" class="text-danger h4">Tyler Biadasz (C)</a>
          <small class="d-block"><strong>Feb 27, 2026</strong> - Released by Washington (WAS), clearing $2.85M of cap space</small>
        </span>
      </li>
    </ul>
    """

    response = Mock()
    response.text = html
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.sync_spotrac_transactions.requests.Session.get",
        return_value=response,
    ):
        call_command(
            "sync_spotrac_transactions", season=2026, team=["WAS"], stdout=StringIO()
        )

    player.refresh_from_db(using="nfl")
    transaction = PlayerTransaction.objects.using("nfl").get(
        player=player,
        transaction_type="released",
    )

    assert transaction.date.isoformat() == "2026-02-27"
    assert transaction.from_team == team_was
    assert transaction.to_team is None
    assert "Spotrac: Released by Washington" in transaction.description
    assert player.current_team is None
    assert player.roster_status == "UFA"
    assert player.is_active is True


def test_sync_spotrac_transactions_global_page_captures_signed_elsewhere(team_was):
    from gridstream.models import Player, PlayerTransaction, Team

    team_lac = Team.objects.using("nfl").create(
        espn_id="24",
        abbreviation="LAC",
        slug="los-angeles-chargers",
        location="Los Angeles",
        name="Chargers",
        display_name="Los Angeles Chargers",
        short_display_name="Chargers",
        color_primary="0080C6",
        conference="AFC",
        division="AFC West",
        is_active=True,
    )
    player = Player.objects.using("nfl").create(
        gsis_id="00-0091002",
        espn_id="47741",
        display_name="Tyler Biadasz",
        short_name="T. Biadasz",
        first_name="Tyler",
        last_name="Biadasz",
        position="C",
        position_group="OL",
        current_team=team_was,
        roster_status="ACT",
        is_active=True,
    )

    was_html = """
    <ul>
      <li class="list-group-item d-flex list-group-item-secondary justify-content-between align-items-center">
        <span class="col-md-8 col-sm-8">
          <a href="https://www.spotrac.com/nfl/player/_/id/47741/tyler-biadasz" class="text-danger h4">Tyler Biadasz (C)</a>
          <small class="d-block"><strong>Feb 27, 2026</strong> - Released by Washington (WAS), clearing $2.85M of cap space</small>
        </span>
      </li>
    </ul>
    """
    global_html = """
    <ul>
      <li class="list-group-item d-flex list-group-item-secondary justify-content-between align-items-center">
        <span class="col-md-8 col-sm-8">
          <a href="https://www.spotrac.com/nfl/player/_/id/47741/tyler-biadasz" class="text-danger h4">Tyler Biadasz (C)</a>
          <small class="d-block"><strong>Mar 06, 2026</strong> - Signed a 3 year $30 million contract with Los Angeles (LAC)</small>
        </span>
      </li>
    </ul>
    """

    was_response = Mock()
    was_response.text = was_html
    was_response.raise_for_status = Mock()
    global_response = Mock()
    global_response.text = global_html
    global_response.raise_for_status = Mock()
    free_agents_response = Mock()
    free_agents_response.text = "<html></html>"
    free_agents_response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.sync_spotrac_transactions.requests.Session.get",
        side_effect=[was_response, global_response, free_agents_response],
    ):
        call_command(
            "sync_spotrac_transactions", season=2026, team=["WAS"], stdout=StringIO()
        )

    player.refresh_from_db(using="nfl")
    signed_txn = PlayerTransaction.objects.using("nfl").get(
        player=player,
        transaction_type="signed",
    )

    assert signed_txn.date.isoformat() == "2026-03-06"
    assert signed_txn.to_team == team_lac
    assert player.current_team == team_lac
    assert player.roster_status == "ACT"


def test_sync_spotrac_transactions_enriches_signed_transaction_with_contract_terms(
    team_was,
):
    from gridstream.models import Player, PlayerTransaction, Team

    team_hou = Team.objects.using("nfl").create(
        espn_id="34",
        abbreviation="HOU",
        slug="houston-texans",
        location="Houston",
        name="Texans",
        display_name="Houston Texans",
        short_display_name="Texans",
        color_primary="03202F",
        conference="AFC",
        division="AFC South",
        is_active=True,
    )
    player = Player.objects.using("nfl").create(
        gsis_id="00-0091003",
        espn_id="25264",
        display_name="Tim Settle",
        short_name="T. Settle",
        first_name="Tim",
        last_name="Settle",
        position="DT",
        position_group="DL",
        current_team=team_was,
        roster_status="ACT",
        is_active=True,
    )

    global_html = """
    <ul>
      <li class="list-group-item d-flex list-group-item-secondary justify-content-between align-items-center">
        <span class="col-md-8 col-sm-8">
          <a href="https://www.spotrac.com/nfl/player/_/id/25264/tim-settle" class="text-danger h4">Tim Settle (DL)</a>
          <small class="d-block"><strong>Mar 08, 2026</strong> - Signed a 3 year $24 million contract with Washington (WAS)</small>
        </span>
      </li>
    </ul>
    """
    free_agents_html = """
    <table>
      <tbody>
        <tr class="">
          <td><span class="d-none">HOU</span></td>
          <td><i class="fa-solid fa-arrow-right"></i></td>
          <td><span class="d-none">WAS</span></td>
          <td><a href="https://www.spotrac.com/nfl/player/_/id/25264/tim-settle" class="link">Tim Settle</a></td>
          <td>DL</td>
          <td>3</td>
          <td>$24,000,000</td>
          <td>$8,000,000</td>
          <td>$0</td>
          <td>$0</td>
          <td></td>
        </tr>
      </tbody>
    </table>
    """

    team_response = Mock()
    team_response.text = "<html></html>"
    team_response.raise_for_status = Mock()
    global_response = Mock()
    global_response.text = global_html
    global_response.raise_for_status = Mock()
    free_agents_response = Mock()
    free_agents_response.text = free_agents_html
    free_agents_response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.sync_spotrac_transactions.requests.Session.get",
        side_effect=[team_response, global_response, free_agents_response],
    ):
        call_command(
            "sync_spotrac_transactions", season=2026, team=["WAS"], stdout=StringIO()
        )

    transaction = PlayerTransaction.objects.using("nfl").get(
        player=player,
        transaction_type="signed",
    )
    assert transaction.to_team == team_was
    assert transaction.from_team == team_hou
    assert transaction.contract_years == 3
    assert transaction.contract_total_value == 24000000
    assert transaction.contract_apy == 8000000
    assert transaction.contract_guaranteed == 0


def test_match_player_handles_suffix_and_hyphenated_last_names():
    from gridstream.models import Player

    westbrook = Player.objects.using("nfl").create(
        gsis_id="00-0092001",
        espn_id="1001",
        display_name="Nick Westbrook-Ikhine",
        short_name="N. Westbrook-Ikhine",
        first_name="Nick",
        last_name="Westbrook-Ikhine",
        position="WR",
        position_group="WR",
    )
    franklin = Player.objects.using("nfl").create(
        gsis_id="00-0092002",
        espn_id="1002",
        display_name="Sam Franklin Jr.",
        short_name="S. Franklin",
        first_name="Sam",
        last_name="Franklin",
        suffix="Jr.",
        position="S",
        position_group="DB",
    )
    paul = Player.objects.using("nfl").create(
        gsis_id="00-0092003",
        espn_id="1003",
        display_name="Chris Paul",
        short_name="C. Paul",
        first_name="Chris",
        last_name="Paul",
        position="LB",
        position_group="LB",
    )

    players_by_key = _build_players_by_key([westbrook, franklin, paul])

    assert _match_player("Nick Westbrook", "WR", players_by_key) == westbrook
    assert _match_player("Sam Franklin", "S", players_by_key) == franklin
    assert _match_player("Chris Paul Jr.", "LB", players_by_key) == paul
