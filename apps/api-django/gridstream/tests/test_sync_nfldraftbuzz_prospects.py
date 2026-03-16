from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.management import call_command

from gridstream.models import DraftProspect

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


def _scraper_payload():
    return {
        "source": "nfldraftbuzz",
        "season": 2026,
        "source_url": "https://www.nfldraftbuzz.com/positions/ALL/1/2026",
        "prospects": [
            {
                "source_slug": "Caleb-Downs-DB-Alabama",
                "source_url": "https://www.nfldraftbuzz.com/Player/Caleb-Downs-DB-Alabama",
                "source_label": "NFLDraftBuzz scouting report",
                "name": "Caleb Downs",
                "position": "S",
                "school": "Ohio State",
                "class_year": "Junior",
                "hometown": "Hoschton, GA",
                "role": "Zone Slot/Nickel Safety",
                "jersey_number": "2",
                "image_url": "https://www.nfldraftbuzz.com/Content/PlayerHeadShots/Caleb-Downs-DB-Alabama.png",
                "college_logo_url": "https://www.nfldraftbuzz.com/Content/collmascots/ohio-state-buckeyes.png",
                "draft_year": 2026,
                "source_last_updated": "2026-01-23",
                "buzz_overall_rating": 92.0,
                "buzz_overall_rank": 1,
                "buzz_position_rank": 1,
                "buzz_position_rank_group": "DB",
                "draft_projection": "1st - Top 5",
                "all_scouts_overall_rank": 3.7,
                "all_scouts_position_rank": 1.0,
                "height": "6-0",
                "weight": 206,
                "forty_yard": 4.45,
                "hand_size": "9 1/2",
                "arm_length": "30 1/4",
                "age": 21.2,
                "birth_date": "2004-12-10",
                "college_games": 42,
                "college_snaps": 2354,
                "bio": "Football family background.",
                "summary": "Versatile safety with elite instincts.",
                "strengths": ["Elite processor", "Versatile coverage piece"],
                "weaknesses": ["Can be overaggressive"],
                "honors": ["2025 Jim Thorpe Award"],
                "production_stats": [
                    {"label": "Interceptions", "value": "2", "percentile": 25},
                    {"label": "Tackles", "value": "68", "percentile": 52},
                ],
                "scouting_grades": [
                    {"label": "Coverage", "value": "100%", "percent": 100},
                ],
                "measurable_percentiles": [
                    {"label": "Forty", "value": "4.45", "percentile": 86},
                ],
                "recruiting_ratings": [
                    {"label": "ESPN", "value": "91/100"},
                ],
                "comparison_players": [
                    {
                        "name": "Jaquan Brisker",
                        "school": "Penn State",
                        "similarity": 75,
                        "source_url": "https://www.nfldraftbuzz.com/Player/Jaquan-Brisker-DB-PennState",
                    }
                ],
            }
        ],
    }


class TestSyncNflDraftBuzzProspects:
    def test_sync_creates_and_updates_prospect(self, tmp_path: Path):
        input_path = tmp_path / "nfldraftbuzz.json"
        input_path.write_text(json.dumps(_scraper_payload()))

        call_command(
            "sync_nfldraftbuzz_prospects", season=2026, input_json=str(input_path)
        )
        call_command(
            "sync_nfldraftbuzz_prospects", season=2026, input_json=str(input_path)
        )

        prospect = DraftProspect.objects.using("nfl").get(
            season=2026,
            source="nfldraftbuzz",
            source_slug="Caleb-Downs-DB-Alabama",
        )
        assert prospect.name == "Caleb Downs"
        assert prospect.school == "Ohio State"
        assert prospect.overall_rating == 92.0
        assert prospect.strengths == ["Elite processor", "Versatile coverage piece"]
        assert prospect.production_stats[0]["label"] == "Interceptions"
        assert DraftProspect.objects.using("nfl").count() == 1

    @patch("gridstream.management.commands.sync_nfldraftbuzz_prospects.subprocess.run")
    @patch("gridstream.management.commands.sync_nfldraftbuzz_prospects.shutil.which")
    def test_saved_html_dir_invokes_parser(self, mock_which, mock_run, tmp_path: Path):
        mock_which.return_value = "/usr/bin/node"
        payload = _scraper_payload()
        mock_run.return_value = SimpleNamespace(
            returncode=0,
            stdout=json.dumps(payload),
            stderr="",
        )
        saved_dir = tmp_path / "saved"
        saved_dir.mkdir()

        call_command(
            "sync_nfldraftbuzz_prospects",
            season=2026,
            saved_html_dir=str(saved_dir),
            limit=1,
            concurrency=2,
        )

        command = mock_run.call_args[0][0]
        assert "--saved-html-dir" in command
        assert str(saved_dir) in command
        assert "--limit" in command
        assert "--concurrency" in command
        assert DraftProspect.objects.using("nfl").count() == 1

    @patch("gridstream.management.commands.sync_nfldraftbuzz_prospects.subprocess.run")
    def test_input_json_import_does_not_call_parser(self, mock_run, tmp_path: Path):
        input_path = tmp_path / "nfldraftbuzz.json"
        input_path.write_text(json.dumps(_scraper_payload()))

        call_command(
            "sync_nfldraftbuzz_prospects", season=2026, input_json=str(input_path)
        )

        prospect = DraftProspect.objects.using("nfl").get(
            season=2026,
            source="nfldraftbuzz",
            source_slug="Caleb-Downs-DB-Alabama",
        )
        assert prospect.name == "Caleb Downs"
        mock_run.assert_not_called()

    def test_partial_overlay_preserves_existing_board_fields(self, tmp_path: Path):
        base_path = tmp_path / "base.json"
        overlay_path = tmp_path / "overlay.json"
        base_path.write_text(json.dumps(_scraper_payload()))
        overlay_path.write_text(
            json.dumps(
                {
                    "source": "nfldraftbuzz",
                    "season": 2026,
                    "prospects": [
                        {
                            "source_slug": "Caleb-Downs-DB-Alabama",
                            "source_url": "https://www.nfldraftbuzz.com/Player/Caleb-Downs-DB-Alabama",
                            "name": "Caleb Downs",
                            "summary": "Updated summary",
                            "strengths": ["Instinctive"],
                        }
                    ],
                }
            )
        )

        call_command(
            "sync_nfldraftbuzz_prospects",
            season=2026,
            input_json=str(base_path),
        )
        call_command(
            "sync_nfldraftbuzz_prospects",
            season=2026,
            input_json=str(overlay_path),
        )

        prospect = DraftProspect.objects.using("nfl").get(
            season=2026,
            source="nfldraftbuzz",
            source_slug="Caleb-Downs-DB-Alabama",
        )
        assert prospect.summary == "Updated summary"
        assert prospect.strengths == ["Instinctive"]
        assert prospect.height == "6-0"
        assert prospect.weight == 206
        assert prospect.overall_rank == 1
        assert prospect.image_url

    def test_dry_run_skips_database_writes(self, capsys, tmp_path: Path):
        input_path = tmp_path / "nfldraftbuzz.json"
        input_path.write_text(json.dumps(_scraper_payload()))

        call_command(
            "sync_nfldraftbuzz_prospects",
            season=2026,
            input_json=str(input_path),
            dry_run=True,
        )

        captured = capsys.readouterr()
        assert "Parsed 1 NFLDraftBuzz prospects for 2026." in captured.out
        assert DraftProspect.objects.using("nfl").count() == 0
