"""
Merge ESPN-synced game records into their matching nflverse game records.

After running sync_espn_backfill, the DB has two parallel sets of game records:
  - nflverse games (espn_event_id LIKE 'nflv_%') — have play-by-play but no real
    ESPN metadata (scores, weather, headshots, etc.)
  - ESPN-synced games — have real scores/weather/leaders but no play-by-play

This command matches each ESPN record to its nflverse counterpart by
(season, home_team, away_team, season_type), copies the ESPN metadata across,
re-links child records (GameLeader, Drive, Play, ScoringPlay), then deletes
the now-redundant ESPN-only record.

Run this once after the initial backfill.  Subsequent sync_espn_games calls
should use the real espn_event_id for update_or_create so they hit the merged
record directly.

examples:
    python manage.py merge_espn_games
    python manage.py merge_espn_games --dry-run
"""

import logging

from django.core.management.base import BaseCommand
from django.db import transaction

from gridstream.models import Drive, Game, GameLeader, Play, ScoringPlay

logger = logging.getLogger(__name__)

ESPN_FIELDS = [
    "espn_event_id",
    "home_score",
    "away_score",
    "home_score_q1",
    "home_score_q2",
    "home_score_q3",
    "home_score_q4",
    "home_score_ot",
    "away_score_q1",
    "away_score_q2",
    "away_score_q3",
    "away_score_q4",
    "away_score_ot",
    "status",
    "quarter",
    "clock",
    "weather_temp",
    "weather_condition",
    "weather_condition_id",
    "spread",
    "total",
    "home_moneyline",
    "away_moneyline",
    "odds_provider",
    "broadcast_network",
    "broadcast_names",
    "game_note",
    "home_record",
    "away_record",
]


class Command(BaseCommand):
    help = "Merge ESPN game records into nflverse game records and remove duplicates."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would happen without writing to DB",
        )

    @transaction.atomic(using="nfl")
    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        espn_games = Game.objects.using("nfl").exclude(
            espn_event_id__startswith="nflv_"
        )
        total = espn_games.count()
        self.stdout.write(
            f"ESPN-only records to process: {total}" + (" [DRY RUN]" if dry_run else "")
        )

        merged = 0
        kept = 0
        skipped = 0

        for espn_game in espn_games.select_related("home_team", "away_team"):
            # Find the matching nflverse game
            nfl_game = (
                Game.objects.using("nfl")
                .filter(
                    espn_event_id__startswith="nflv_",
                    season_id=espn_game.season_id,
                    home_team_id=espn_game.home_team_id,
                    away_team_id=espn_game.away_team_id,
                    season_type=espn_game.season_type,
                )
                .first()
            )

            if not nfl_game:
                self.stdout.write(
                    f"  [no match] {espn_game.espn_event_id} "
                    f"{espn_game.season_id} {espn_game.season_type} wk{espn_game.week} "
                    f"{espn_game.away_team.abbreviation}@{espn_game.home_team.abbreviation}"
                )
                kept += 1
                continue

            if dry_run:
                self.stdout.write(
                    f"  [merge] {espn_game.espn_event_id} → {nfl_game.espn_event_id} "
                    f"({espn_game.away_team.abbreviation}@{espn_game.home_team.abbreviation} "
                    f"{espn_game.season_id} wk{espn_game.week})"
                )
                merged += 1
                continue

            # Re-link child records first (removes FK deps on espn_game),
            # then delete the ESPN shell, then update the nflverse record.
            # This order avoids unique-constraint violations on espn_event_id.

            # Leaders: always take ESPN (headshots/stats not in nflverse)
            GameLeader.objects.using("nfl").filter(game=nfl_game).delete()
            GameLeader.objects.using("nfl").filter(game=espn_game).update(game=nfl_game)

            # Drives/Plays/ScoringPlays: prefer nflverse (richer PBP data).
            # If nflverse game has no drives yet, migrate ESPN drives instead.
            nfl_has_drives = Drive.objects.using("nfl").filter(game=nfl_game).exists()
            if nfl_has_drives:
                # Drop ESPN drives — nflverse PBP wins
                Play.objects.using("nfl").filter(drive__game=espn_game).delete()
                Drive.objects.using("nfl").filter(game=espn_game).delete()
                ScoringPlay.objects.using("nfl").filter(game=espn_game).delete()
            else:
                Drive.objects.using("nfl").filter(game=espn_game).update(game=nfl_game)
                Play.objects.using("nfl").filter(game=espn_game).update(game=nfl_game)
                ScoringPlay.objects.using("nfl").filter(game=espn_game).update(
                    game=nfl_game
                )

            # Stash the ESPN metadata we want before deleting
            espn_data = {field: getattr(espn_game, field) for field in ESPN_FIELDS}
            espn_game.delete(using="nfl")

            # Now safe to set the real ESPN ID on the nflverse record
            for field, value in espn_data.items():
                setattr(nfl_game, field, value)
            # Preserve the nflverse week (convention differs from ESPN for POST games)
            nfl_game.save(using="nfl")
            merged += 1

        label = "DRY RUN " if dry_run else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"\n{label}Done: {merged} merged, {kept} kept (no nflverse match), {skipped} skipped"
            )
        )
