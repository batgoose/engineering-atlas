import csv
import io
from io import StringIO
from unittest.mock import Mock, patch

import pytest
from django.core.management import call_command
from django.db import connections

from gridstream.models import Season, Team, TeamStanding


def _ensure_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS raw")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_ingest_batch (
                id BIGSERIAL PRIMARY KEY,
                source_system TEXT NOT NULL,
                dataset_name TEXT NOT NULL,
                source_url TEXT,
                source_file TEXT,
                source_version TEXT,
                source_checksum TEXT,
                loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                row_count INTEGER NOT NULL DEFAULT 0,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb
            )
            """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw.raw_nflverse_standings (
                id BIGSERIAL PRIMARY KEY,
                batch_id BIGINT NULL,
                season INTEGER,
                week INTEGER,
                team TEXT,
                conference TEXT,
                division TEXT,
                wins INTEGER,
                losses INTEGER,
                ties INTEGER,
                payload JSONB NOT NULL,
                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """)


def _reset_raw_tables():
    with connections["nfl"].cursor() as cursor:
        cursor.execute("DELETE FROM raw.raw_nflverse_standings")
        cursor.execute("DELETE FROM raw.raw_ingest_batch")


def _build_csv(rows):
    fieldnames = [
        "season",
        "conf",
        "division",
        "team",
        "wins",
        "losses",
        "ties",
        "pct",
        "div_rank",
        "scored",
        "allowed",
        "net",
        "sov",
        "sos",
        "seed",
        "playoff",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _seed_teams_and_season():
    Season.objects.using("nfl").get_or_create(year=2024, defaults={"is_active": True})
    Team.objects.using("nfl").get_or_create(
        abbreviation="KC",
        defaults={
            "espn_id": "12",
            "slug": "kansas-city-chiefs",
            "location": "Kansas City",
            "name": "Chiefs",
            "display_name": "Kansas City Chiefs",
            "short_display_name": "Chiefs",
            "nickname": "Chiefs",
            "color_primary": "E31837",
            "color_secondary": "FFB81C",
            "conference": "AFC",
            "division": "AFC West",
            "is_active": True,
        },
    )
    Team.objects.using("nfl").get_or_create(
        abbreviation="NYJ",
        defaults={
            "espn_id": "20",
            "slug": "new-york-jets",
            "location": "New York",
            "name": "Jets",
            "display_name": "New York Jets",
            "short_display_name": "Jets",
            "nickname": "Jets",
            "color_primary": "125740",
            "color_secondary": "FFFFFF",
            "conference": "AFC",
            "division": "AFC East",
            "is_active": True,
        },
    )


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_standings_ingests_rows_and_metadata():
    _ensure_raw_tables()
    _reset_raw_tables()
    _seed_teams_and_season()

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            INSERT INTO raw.raw_nflverse_standings (
                season, team, payload
            ) VALUES (2024, 'OLD', '{}'::jsonb)
            """)

    content = _build_csv(
        [
            {
                "season": "2024",
                "conf": "AFC",
                "division": "AFC East",
                "team": "NYJ",
                "wins": "8",
                "losses": "9",
                "ties": "0",
                "pct": "0.471",
                "div_rank": "3",
                "scored": "301",
                "allowed": "355",
                "net": "-54",
                "sov": "0.430",
                "sos": "0.500",
                "seed": "",
                "playoff": "",
            },
            {
                "season": "2024",
                "conf": "AFC",
                "division": "AFC West",
                "team": "KC",
                "wins": "12",
                "losses": "5",
                "ties": "0",
                "pct": "0.706",
                "div_rank": "1",
                "scored": "430",
                "allowed": "320",
                "net": "110",
                "sov": "0.560",
                "sos": "0.520",
                "seed": "2",
                "playoff": "WonDiv",
            },
            {
                "season": "2023",
                "conf": "AFC",
                "division": "AFC West",
                "team": "DEN",
                "wins": "8",
                "losses": "9",
                "ties": "0",
                "pct": "0.471",
                "div_rank": "2",
                "scored": "357",
                "allowed": "322",
                "net": "35",
                "sov": "0.430",
                "sos": "0.500",
                "seed": "",
                "playoff": "",
            },
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = content
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_nflverse_standings.requests.get",
        return_value=response,
    ):
        call_command(
            "import_nflverse_standings",
            season=[2024],
            batch_size=1,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("""
            SELECT season, team, conference, division, wins, losses, ties
            FROM raw.raw_nflverse_standings
            ORDER BY team
            """)
        rows = cursor.fetchall()
        assert len(rows) == 2
        assert rows[0] == (2024, "KC", "AFC", "AFC West", 12, 5, 0)
        assert rows[1] == (2024, "NYJ", "AFC", "AFC East", 8, 9, 0)

        cursor.execute("""
            SELECT dataset_name, source_version, row_count, metadata->>'status'
            FROM raw.raw_ingest_batch
            ORDER BY id DESC
            LIMIT 1
            """)
        batch = cursor.fetchone()
        assert batch == ("standings", "2024-2024", 2, "ok")

        cursor.execute(
            "SELECT COUNT(*) FROM raw.raw_nflverse_standings WHERE team = 'OLD'"
        )
        old_count = cursor.fetchone()[0]
        assert old_count == 0

    standings = (
        TeamStanding.objects.using("nfl")
        .select_related("team")
        .filter(season_id=2024)
        .order_by("team__abbreviation")
    )
    assert standings.count() == 2

    kc = standings[0]
    assert kc.team.abbreviation == "KC"
    assert kc.pct == pytest.approx(0.706)
    assert kc.div_rank == 1
    assert kc.seed == 2
    assert kc.point_diff == 110
    assert kc.sov == pytest.approx(0.560)
    assert kc.sos == pytest.approx(0.520)
    assert kc.playoff_clincher == "WonDiv"

    nyj = standings[1]
    assert nyj.team.abbreviation == "NYJ"
    assert nyj.pct == pytest.approx(0.471)
    assert nyj.div_rank == 3
    assert nyj.seed is None
    assert nyj.point_diff == -54


@pytest.mark.django_db(databases=["nfl"])
def test_import_nflverse_standings_dry_run_writes_nothing():
    _ensure_raw_tables()
    _reset_raw_tables()
    _seed_teams_and_season()

    content = _build_csv(
        [
            {
                "season": "2024",
                "conf": "AFC",
                "division": "AFC East",
                "team": "NYJ",
                "wins": "8",
                "losses": "9",
                "ties": "0",
                "pct": "0.471",
                "div_rank": "3",
                "scored": "301",
                "allowed": "355",
                "net": "-54",
                "sov": "0.430",
                "sos": "0.500",
                "seed": "",
                "playoff": "",
            }
        ]
    )

    response = Mock()
    response.status_code = 200
    response.content = content
    response.raise_for_status = Mock()

    with patch(
        "gridstream.management.commands.import_nflverse_standings.requests.get",
        return_value=response,
    ):
        call_command(
            "import_nflverse_standings",
            season=[2024],
            dry_run=True,
            stdout=StringIO(),
            stderr=StringIO(),
            verbosity=0,
        )

    with connections["nfl"].cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM raw.raw_nflverse_standings")
        standings_count = cursor.fetchone()[0]
        assert standings_count == 0

        cursor.execute("SELECT COUNT(*) FROM raw.raw_ingest_batch")
        batch_count = cursor.fetchone()[0]
        assert batch_count == 0

    standings_count = TeamStanding.objects.using("nfl").count()
    assert standings_count == 0
