"""
Sync NFL Next Gen Stats (NGS) from nflverse-data GitHub releases.

Data source: nflverse-data nextgen_stats release
URLs:
    https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_passing.csv.gz
    https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_rushing.csv.gz
    https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_receiving.csv.gz

Available from 2016. Week 0 rows = season aggregates.
Player matching: uses player_gsis_id column (exact join).

Key metrics stored in metrics JSON:
    passing:   avg_time_to_throw, completion_percentage_above_expectation (CPOE),
               avg_intended_air_yards, aggressiveness, passer_rating
    rushing:   efficiency, avg_time_to_los, rush_yards_over_expected_per_att,
               expected_rush_yards, rush_attempts
    receiving: avg_separation, avg_cushion, avg_intended_air_yards,
               percent_share_of_intended_air_yards, avg_yac_above_expectation

Usage:
    python manage.py sync_nextgen_stats
    python manage.py sync_nextgen_stats --season 2024
    python manage.py sync_nextgen_stats --stat-type rushing
    python manage.py sync_nextgen_stats --dry-run
"""

import csv
import gzip
import io
import logging

import requests
from django.db import transaction

from gridstream.models import Player, PlayerNextGenStats

from ._base import ImportBaseCommand

logger = logging.getLogger(__name__)

NGS_BASE_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/"
)
NGS_TYPES = ["passing", "rushing", "receiving"]

# Fields to extract from each stat type (stored in metrics JSON)
NGS_FIELDS = {
    "passing": [
        "attempts",
        "pass_yards",
        "pass_touchdowns",
        "interceptions",
        "passer_rating",
        "completion_percentage",
        "expected_completion_percentage",
        "completion_percentage_above_expectation",
        "avg_time_to_throw",
        "avg_completed_air_yards",
        "avg_intended_air_yards",
        "avg_air_yards_differential",
        "aggressiveness",
        "max_completed_air_distance",
        "avg_air_yards_to_sticks",
        "avg_air_distance",
        "max_air_distance",
    ],
    "rushing": [
        "rush_attempts",
        "rush_yards",
        "avg_rush_yards",
        "rush_touchdowns",
        "expected_rush_yards",
        "rush_yards_over_expected",
        "rush_yards_over_expected_per_att",
        "efficiency",
        "percent_attempts_gte_eight_defenders",
        "avg_time_to_los",
    ],
    "receiving": [
        "targets",
        "receptions",
        "catch_percentage",
        "yards",
        "rec_touchdowns",
        "avg_yac",
        "avg_yac_above_expectation",
        "avg_cushion",
        "avg_separation",
        "avg_intended_air_yards",
        "percent_share_of_intended_air_yards",
    ],
}


class Command(ImportBaseCommand):
    help = "Sync NFL Next Gen Stats (NGS) from nflverse-data releases."

    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.add_argument(
            "--stat-type",
            choices=NGS_TYPES,
            default=None,
            help="Only sync one stat type. Omit to sync all three.",
        )
        parser.set_defaults(batch_size=2000)

    def handle(self, *args, **options):
        self.batch_size = options["batch_size"]
        self.dry_run = options["dry_run"]
        requested_seasons = options.get("season")
        stat_types = [options["stat_type"]] if options.get("stat_type") else NGS_TYPES

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        # Build player gsis_id cache once
        with self.timed_operation("Building player cache"):
            gsis_cache = {
                p.gsis_id: p
                for p in Player.objects.using("nfl").all()
                if p.gsis_id
            }
        self.stdout.write(f"  {len(gsis_cache):,} players in cache")

        total_created = 0
        total_updated = 0

        for stat_type in stat_types:
            self.log_season_header(stat_type.upper())
            url = f"{NGS_BASE_URL}ngs_{stat_type}.csv.gz"

            # Download
            with self.timed_operation(f"Downloading ngs_{stat_type}.csv.gz"):
                try:
                    resp = requests.get(url, timeout=120)
                    resp.raise_for_status()
                except Exception as exc:
                    self.stderr.write(self.style.ERROR(f"  Download failed: {exc}"))
                    continue

            raw = gzip.decompress(resp.content)
            rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))
            self.stdout.write(f"  Fetched {len(rows):,} rows")

            # Filter by season
            if requested_seasons:
                rows = [
                    r for r in rows
                    if self.safe_int(r.get("season")) in set(requested_seasons)
                ]
                self.stdout.write(f"  After season filter: {len(rows):,} rows")

            # Filter: only REG and POST, skip aggregates that lack gsis_id
            rows = [
                r for r in rows
                if r.get("player_gsis_id") and r.get("player_gsis_id").strip()
                and r.get("season_type", "REG") in ("REG", "POST")
            ]
            self.stdout.write(f"  After gsis_id filter: {len(rows):,} rows")

            created = 0
            updated = 0
            skipped = 0
            batch = []

            with self.timed_operation(f"Writing {stat_type} NGS"):
                for row in rows:
                    gsis_id = self.safe_str(row.get("player_gsis_id", ""))
                    player = gsis_cache.get(gsis_id)
                    if not player:
                        skipped += 1
                        continue

                    season = self.safe_int(row.get("season"))
                    week = self.safe_int(row.get("week"), 0) or 0
                    season_type = self.safe_str(row.get("season_type", "REG"))

                    if not season:
                        skipped += 1
                        continue

                    # Extract only the fields we care about
                    metrics = {}
                    for field in NGS_FIELDS.get(stat_type, []):
                        val = self.safe_float(row.get(field))
                        if val is not None:
                            metrics[field] = round(val, 4)

                    batch.append((player, season, week, season_type, stat_type, metrics))

                    if len(batch) >= self.batch_size:
                        c, u = self._flush_batch(batch)
                        created += c
                        updated += u
                        batch = []

                if batch:
                    c, u = self._flush_batch(batch)
                    created += c
                    updated += u

            if skipped:
                self.stdout.write(self.style.WARNING(f"  Skipped {skipped} (no player match)"))
            self.stdout.write(f"  {stat_type}: {created} created, {updated} updated")
            total_created += created
            total_updated += updated

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone! {total_created} created, {total_updated} updated."
            )
        )

    def _flush_batch(self, batch):
        created = 0
        updated = 0
        if self.dry_run:
            return len(batch), 0
        with transaction.atomic(using="nfl"):
            for player, season, week, season_type, stat_type, metrics in batch:
                _, was_created = PlayerNextGenStats.objects.using("nfl").update_or_create(
                    player=player,
                    season=season,
                    week=week,
                    stat_type=stat_type,
                    defaults={
                        "season_type": season_type,
                        "metrics": metrics,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
        return created, updated
