"""
Enrich game records with ESPN summary data: play descriptions, scoring plays,
and game leaders (headshots).

The nflverse import gives us play structure (type, yard line, yards gained,
down/distance) but no text descriptions, no scoring-play timeline, and no
headshots.  This command fetches the ESPN summary for every game that has a
real ESPN event ID and replaces the nflverse plays/drives with ESPN plays
(which include description text), adds scoring plays, and adds leaders.

Run once after sync_espn_backfill + merge_espn_games.  Safe to re-run; each
game is processed atomically (clear + re-import).

examples:
    # enrich all games
    python manage.py enrich_espn_summaries

    # only a specific season range
    python manage.py enrich_espn_summaries --start-season 2015 --end-season 2025

    # single game (useful for testing / fixing one-off issues)
    python manage.py enrich_espn_summaries --game-id 7275

    # faster — reduce delay if ESPN isn't rate-limiting
    python manage.py enrich_espn_summaries --delay 0.1
"""

import time
import logging
from typing import Optional

import requests
from django.core.management.base import BaseCommand
from django.db import transaction

from gridstream.management.commands.sync_espn_games import (
    ESPN_SUMMARY_URL,
    Command as SyncCommand,
)
from gridstream.models import Drive, Game, GameLeader, Play, ScoringPlay

logger = logging.getLogger(__name__)

# Map ESPN leader category names → our internal category strings
LEADER_CATEGORY_MAP = {
    # Summary endpoint names
    "passingYards": "passing",
    "rushingYards": "rushing",
    "receivingYards": "receiving",
    "sacks": "sacks",
    "totalTackles": "tackles",
    "interceptions": "interceptions",
    # Scoreboard endpoint names (fallback)
    "passingLeader": "passing",
    "rushingLeader": "rushing",
    "receivingLeader": "receiving",
}


class Command(BaseCommand):
    help = "Enrich games with ESPN summary: play descriptions, scoring plays, leaders."

    def add_arguments(self, parser):
        parser.add_argument(
            "--start-season",
            type=int,
            help="Only process games from this season onward",
        )
        parser.add_argument(
            "--end-season",
            type=int,
            help="Only process games up to this season",
        )
        parser.add_argument(
            "--game-id",
            type=int,
            help="Process only this specific game ID (for testing/fixing)",
        )
        parser.add_argument(
            "--delay",
            type=float,
            default=0.2,
            help="Seconds to sleep between ESPN requests (default 0.2)",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-enrich games that already have scoring plays (default: skip them)",
        )

    def handle(self, *args, **options):
        delay = options["delay"]
        force = options["force"]

        games_qs = (
            Game.objects.using("nfl")
            .exclude(espn_event_id__startswith="nflv_")
            .select_related("home_team", "away_team")
            .order_by("season_id", "week", "id")
        )

        if options.get("game_id"):
            games_qs = games_qs.filter(id=options["game_id"])
        if options.get("start_season"):
            games_qs = games_qs.filter(season_id__gte=options["start_season"])
        if options.get("end_season"):
            games_qs = games_qs.filter(season_id__lte=options["end_season"])

        # By default skip games that already have scoring plays (already enriched).
        # Use --force to re-process everything.
        # Use a subquery (EXISTS) instead of a Python set to avoid generating
        # a massive NOT IN (...) clause that chokes the query planner.
        if not force:
            games_qs = games_qs.filter(scoring_plays__isnull=True)

        total = games_qs.count()
        self.stdout.write(
            f"Enriching {total} games"
            + (
                " (--force: re-enriching all)"
                if force
                else " (skipping already-enriched)"
            )
        )

        # Reuse _sync_play / _map_score_type / _map_play_type from the sync command
        sync_cmd = SyncCommand()

        enriched = 0
        errors = 0

        for i, game in enumerate(games_qs, 1):
            label = (
                f"{game.away_team.abbreviation}@{game.home_team.abbreviation} "
                f"{game.season_id} wk{game.week}"
            )

            try:
                data = self._fetch_summary(game.espn_event_id)
                if data is None:
                    errors += 1
                    continue

                with transaction.atomic(using="nfl"):
                    n_plays = self._replace_drives_and_plays(game, data, sync_cmd)
                    n_sp = self._replace_scoring_plays(game, data, sync_cmd)
                    n_leaders = self._replace_leaders(game, data, sync_cmd)

                enriched += 1
                if i % 100 == 0 or i <= 3 or game.id == options.get("game_id"):
                    self.stdout.write(
                        f"  [{i}/{total}] {label} — "
                        f"{n_plays} plays, {n_sp} scoring, {n_leaders} leaders"
                    )

            except Exception as e:
                logger.error(
                    f"Failed to enrich game {game.id} ({label}): {e}", exc_info=True
                )
                errors += 1

            time.sleep(delay)

        self.stdout.write(
            self.style.SUCCESS(f"\nDone: {enriched} enriched, {errors} errors")
        )

    # ------------------------------------------------------------------
    # private helpers
    # ------------------------------------------------------------------

    def _fetch_summary(self, espn_event_id: str) -> Optional[dict]:
        try:
            resp = requests.get(
                ESPN_SUMMARY_URL.format(event_id=espn_event_id),
                timeout=20,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            logger.warning(f"Summary fetch failed for {espn_event_id}: {e}")
            return None

    def _replace_drives_and_plays(
        self, game: Game, data: dict, sync_cmd: SyncCommand
    ) -> int:
        """Delete existing drives/plays and import fresh ESPN data. Returns play count.

        IMPORTANT: only replaces when ESPN actually has drives with plays.
        If ESPN has no drive data (common for pre-2003 games), we leave the
        existing nflverse plays intact so structural animation data is preserved.
        """
        drives_data = data.get("drives", {})
        all_drives = list(drives_data.get("previous", []))
        if drives_data.get("current"):
            all_drives.append(drives_data["current"])

        # Count ESPN plays available before touching the DB
        espn_play_count = sum(len(d.get("plays", [])) for d in all_drives)
        if espn_play_count == 0:
            # ESPN has no play-level data for this game — keep nflverse plays
            return 0

        # Delete plays before drives (FK constraint order)
        Play.objects.using("nfl").filter(game=game).delete()
        Drive.objects.using("nfl").filter(game=game).delete()

        play_sequence = 0

        for i, drive_data in enumerate(all_drives, 1):
            team = sync_cmd._resolve_team(drive_data.get("team", {}))
            if not team:
                continue

            drive, _ = Drive.objects.using("nfl").update_or_create(
                game=game,
                drive_number=i,
                defaults={
                    "team": team,
                    "description": drive_data.get("description", ""),
                    "start_quarter": (
                        drive_data.get("start", {}).get("period", {}).get("number")
                    ),
                    "start_clock": (
                        drive_data.get("start", {})
                        .get("clock", {})
                        .get("displayValue", "")
                    ),
                    "start_yardline": drive_data.get("start", {}).get("yardLine"),
                    "end_quarter": (
                        drive_data.get("end", {}).get("period", {}).get("number")
                    ),
                    "end_clock": (
                        drive_data.get("end", {})
                        .get("clock", {})
                        .get("displayValue", "")
                    ),
                    "end_yardline": drive_data.get("end", {}).get("yardLine"),
                    "total_yards": drive_data.get("yards", 0),
                    "play_count": drive_data.get("offensivePlays", 0),
                    "time_elapsed": (
                        drive_data.get("timeElapsed", {}).get("displayValue", "")
                    ),
                    "result": (drive_data.get("result", "").lower().replace(" ", "_")),
                    "is_score": drive_data.get("isScore", False),
                },
            )

            for play_data in drive_data.get("plays", []):
                play_sequence += 1
                sync_cmd._sync_play(game, drive, team, play_data, play_sequence)

        return play_sequence

    def _replace_scoring_plays(
        self, game: Game, data: dict, sync_cmd: SyncCommand
    ) -> int:
        """Delete and re-import scoring plays. Returns count."""
        ScoringPlay.objects.using("nfl").filter(game=game).delete()

        count = 0
        for seq, sp_data in enumerate(data.get("scoringPlays", []), 1):
            sp_team = sync_cmd._resolve_team(sp_data.get("team", {}))
            if not sp_team:
                continue

            ScoringPlay.objects.using("nfl").create(
                game=game,
                sequence=seq,
                team=sp_team,
                quarter=sp_data.get("period", {}).get("number", 0),
                clock=sp_data.get("clock", {}).get("displayValue", ""),
                score_type=sync_cmd._map_score_type(
                    sp_data.get("scoringType", {}).get("abbreviation", "")
                ),
                description=sp_data.get("text", ""),
                home_score_after=sp_data.get("homeScore", 0),
                away_score_after=sp_data.get("awayScore", 0),
            )
            count += 1

        return count

    def _replace_leaders(self, game: Game, data: dict, sync_cmd: SyncCommand) -> int:
        """Delete and re-import game leaders. Returns count."""
        GameLeader.objects.using("nfl").filter(game=game).delete()

        count = 0
        for team_section in data.get("leaders", []):
            team = sync_cmd._resolve_team(team_section.get("team", {}))
            if not team:
                continue

            for cat_data in team_section.get("leaders", []):
                cat_name = cat_data.get("name", "")
                category = LEADER_CATEGORY_MAP.get(cat_name)
                if not category or not cat_data.get("leaders"):
                    continue

                l = cat_data["leaders"][0]
                athlete = l.get("athlete", {})

                # Headshot may be a plain URL string or {"href": "..."}
                headshot = athlete.get("headshot", "")
                if isinstance(headshot, dict):
                    headshot = headshot.get("href", "")

                GameLeader.objects.using("nfl").create(
                    game=game,
                    team=team,
                    category=category,
                    athlete_espn_id=athlete.get("id", ""),
                    athlete_name=athlete.get("fullName", ""),
                    athlete_headshot_url=headshot or "",
                    athlete_jersey=athlete.get("jersey", ""),
                    athlete_position=(
                        athlete.get("position", {}).get("abbreviation", "")
                    ),
                    display_value=l.get("displayValue", ""),
                )
                count += 1

        return count
