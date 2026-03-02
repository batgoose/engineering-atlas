from datetime import date
from io import StringIO
from unittest.mock import Mock, patch

import pytest
from django.core.management import call_command

from gridstream.management.commands.sync_madden_ratings import Command, _current_madden_year
from gridstream.models import PlayerMaddenRating

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


def _mock_response(text: str = "", content: bytes | None = None) -> Mock:
    response = Mock()
    response.status_code = 200
    response.text = text
    response.content = content if content is not None else text.encode("utf-8")
    response.raise_for_status = Mock()
    return response


def test_current_madden_year_rollover():
    assert _current_madden_year(date(2026, 3, 2)) == 26
    assert _current_madden_year(date(2026, 9, 1)) == 27
    assert _current_madden_year(date(2025, 3, 1)) == 25


def test_parse_madden_page_extracts_major_scores_and_attrs():
    html = """
    <html>
      <head>
        <title>DK Metcalf Madden 26 Rating (Seattle Seahawks )</title>
      </head>
      <body>
        <p>plays at the Wide Receiver (WR) position for the Seattle Seahawks.</p>
        <script>
          new Chart(document.getElementById("chartjs-radar"), {
            data: {
              labels: ["Overall", "General", "Passing", "Receiving", "Ball-carrying", "Defense", "Blocking", "Kicking"],
              datasets: [{ data: [93, 88, 24, 91, 85, 30, 45, 20] }]
            }
          });
        </script>
        <ul>
          <li class="mb-1"><span class="95.00 attribute-box highest">95</span> Speed</li>
          <li class="mb-1"><span class="96.00 attribute-box highest">96</span> Catching</li>
          <li class="mb-1"><span class="92.00 attribute-box highest">92</span> Route Running Short</li>
          <li class="mb-1"><span class="62.00 attribute-box low">62</span> Run Block</li>
        </ul>
      </body>
    </html>
    """
    cmd = Command()
    parsed = cmd._parse_maddenratings_player_page(
        html,
        source_url="https://www.maddenratings.com/dk-metcalf",
        expected_year=26,
    )

    assert parsed is not None
    assert parsed.name == "DK Metcalf"
    assert parsed.position == "WR"
    assert parsed.ratings["overall"] == 93
    assert parsed.ratings["general_rating"] == 88
    assert parsed.ratings["passing_rating"] == 24
    assert parsed.ratings["receiving_rating"] == 91
    assert parsed.ratings["ball_carrier_rating"] == 85
    assert parsed.ratings["defense_rating"] == 30
    assert parsed.ratings["blocking_rating"] == 45
    assert parsed.ratings["kicking_rating"] == 20
    assert parsed.ratings["speed"] == 95
    assert parsed.ratings["catching"] == 96
    assert parsed.ratings["route_running"] == 92
    assert parsed.ratings["run_block"] == 62


def test_parse_madden_page_falls_back_to_years_table_overall():
    html = """
    <html>
      <head>
        <title>Brad Hawkins Madden 26 Rating (NFL Free Agent )</title>
      </head>
      <body>
        <table>
          <tbody>
            <tr><td>Madden NFL 26</td><td class="text-center"><span class="49.00 attribute-box">49</span></td></tr>
            <tr><td>Madden NFL 25</td><td class="text-center"><span class="52.00 attribute-box">52</span></td></tr>
          </tbody>
        </table>
        <script>
          new Chart(document.getElementById("chartjs-dashboard-line-player"), {
            data: { datasets: [{ data: [49, 49, 49] }] }
          });
        </script>
      </body>
    </html>
    """
    cmd = Command()
    parsed = cmd._parse_maddenratings_player_page(
        html,
        source_url="https://www.maddenratings.com/brad-hawkins",
        expected_year=26,
    )

    assert parsed is not None
    assert parsed.name == "Brad Hawkins"
    assert parsed.ratings["overall"] == 49
    # No radar block in this page shape.
    assert parsed.ratings.get("general_rating") is None


def test_sync_madden_26_scrapes_sitemap_and_updates_player(player_wr):
    sitemap_index = """
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://www.maddenratings.com/post-sitemap.xml</loc></sitemap>
    </sitemapindex>
    """
    sitemap_posts = """
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://www.maddenratings.com/dk-metcalf</loc></url>
    </urlset>
    """
    player_page = """
    <html>
      <head><title>DK Metcalf Madden 26 Rating (Seattle Seahawks )</title></head>
      <body>
        <p>DK Metcalf is a player who plays at the Wide Receiver (WR) position for the Seattle Seahawks.</p>
        <script>
          new Chart(document.getElementById("chartjs-radar"), {
            data: {
              labels: ["Overall", "General", "Passing", "Receiving", "Ball-carrying", "Defense", "Blocking", "Kicking"],
              datasets: [{ data: [93, 88, 24, 91, 85, 30, 45, 20] }]
            }
          });
        </script>
        <ul>
          <li class="mb-1"><span class="95.00 attribute-box highest">95</span> Speed</li>
          <li class="mb-1"><span class="96.00 attribute-box highest">96</span> Catching</li>
          <li class="mb-1"><span class="92.00 attribute-box highest">92</span> Route Running Short</li>
          <li class="mb-1"><span class="62.00 attribute-box low">62</span> Run Block</li>
        </ul>
      </body>
    </html>
    """

    responses = iter(
        [
            _mock_response(text=sitemap_index),
            _mock_response(text=sitemap_posts),
            _mock_response(text=player_page),
        ]
    )

    with patch(
        "gridstream.management.commands.sync_madden_ratings.requests.get",
        side_effect=lambda *args, **kwargs: next(responses),
    ):
        call_command(
            "sync_madden_ratings",
            year=26,
            batch_size=50,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    rating = PlayerMaddenRating.objects.using("nfl").get(player=player_wr, madden_year=26)
    assert rating.overall == 93
    assert rating.general_rating == 88
    assert rating.passing_rating == 24
    assert rating.receiving_rating == 91
    assert rating.ball_carrier_rating == 85
    assert rating.defense_rating == 30
    assert rating.blocking_rating == 45
    assert rating.kicking_rating == 20
    assert rating.speed == 95
    assert rating.catching == 96
    assert rating.route_running == 92
    assert rating.run_block == 62
