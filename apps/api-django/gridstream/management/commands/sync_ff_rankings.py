"""
Sync FantasyPros Expert Consensus Rankings (ECR) from DynastyProcess.

Data sources:
  Historical (2019-2024): db_fpecr.csv.gz — weekly positional ECR (ecr_type='wp')
  Current week:           fp_latest_weekly.csv — current week with pos_rank built in

Columns available (no nflverse_id): player, pos, team, ecr, sd, best, worst, scrape_date
Player matching: name + position (normalised). No gsis_id available from FP.

Season/week mapping: derived from game dates already in the DB.
  - Each scrape_date is mapped to the game week whose dates are nearest.
  - "Nearest" = scrape_date falls within [game_week_first_game - 2, game_week_last_game + 2].

Usage:
    python manage.py sync_ff_rankings                  # all historical weeks
    python manage.py sync_ff_rankings --season 2024    # one season
    python manage.py sync_ff_rankings --current        # only current week (fp_latest_weekly)
    python manage.py sync_ff_rankings --dry-run
"""

import csv
import gzip
import io
import logging
import re
from collections import defaultdict
from datetime import date, timedelta

import requests
from django.db import transaction

from gridstream.cache import cache_delete_pattern
from gridstream.models import Game, Player, PlayerFFRanking

from ._base import ImportBaseCommand

logger = logging.getLogger(__name__)

HISTORICAL_URL = (
    "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr.csv.gz"
)
CURRENT_WEEK_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/fp_latest_weekly.csv"

FANTASY_POSITIONS = {"QB", "RB", "WR", "TE", "K", "PK"}
# ECR type for weekly positional rankings in the historical file
WEEKLY_ECR_TYPES = {"wp"}


class Command(ImportBaseCommand):
    help = "Sync FantasyPros ECR weekly rankings from DynastyProcess."

    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.add_argument(
            "--current",
            action="store_true",
            help="Only sync current week from fp_latest_weekly.csv.",
        )
        parser.set_defaults(batch_size=500)

    def handle(self, *args, **options):
        self.batch_size = options["batch_size"]
        self.dry_run = options["dry_run"]
        requested_seasons = options.get("season")
        current_only = options.get("current", False)

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        # ── Build date→(season,week) mapping from game DB ────────────────
        with self.timed_operation("Building date→week mapping from game DB"):
            week_map = self._build_date_week_map()
        self.stdout.write(f"  {len(week_map)} game-weeks indexed")
        if not week_map:
            self.stderr.write(
                self.style.ERROR("No games in DB — cannot map ECR dates to weeks.")
            )
            return

        # ── Build player name+pos lookup cache ───────────────────────────
        with self.timed_operation("Building player cache"):
            name_cache = {}
            for p in Player.objects.using("nfl").all():
                # Primary key: display_name + position
                name_cache[self._np_key(p.display_name, p.position)] = p
                # Also index short_name if set
                if p.short_name:
                    name_cache[self._np_key(p.short_name, p.position)] = p
        self.stdout.write(f"  {len(name_cache)} player name+pos entries in cache")

        total_created = 0
        total_updated = 0

        # ── Current week ─────────────────────────────────────────────────
        if current_only:
            created, updated = self._sync_current_week(week_map, name_cache)
            total_created += created
            total_updated += updated
        else:
            # ── Historical (all weekly ECR rows) ─────────────────────────
            created, updated = self._sync_historical(
                week_map, name_cache, requested_seasons
            )
            total_created += created
            total_updated += updated

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone! {total_created} created, {total_updated} updated."
            )
        )
        if not self.dry_run and (total_created or total_updated):
            # Player detail payloads are cached for 15m; clear so ECR appears immediately.
            cleared = cache_delete_pattern("gridstream:players:*")
            self.stdout.write(f"  Cleared {cleared} cached player detail keys")

    # ── Historical sync ───────────────────────────────────────────────────

    def _sync_historical(self, week_map, name_cache, requested_seasons):
        with self.timed_operation("Downloading historical ECR (db_fpecr.csv.gz)"):
            try:
                resp = requests.get(HISTORICAL_URL, timeout=120)
                resp.raise_for_status()
            except Exception as exc:
                self.stderr.write(self.style.ERROR(f"Download failed: {exc}"))
                return 0, 0

        raw = gzip.decompress(resp.content)
        all_rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))
        self.stdout.write(f"  Fetched {len(all_rows):,} rows total")

        # Filter to weekly positional ECR only + fantasy positions
        rows = [
            r
            for r in all_rows
            if r.get("ecr_type", "") in WEEKLY_ECR_TYPES
            and r.get("pos", "").upper() in FANTASY_POSITIONS
        ]
        self.stdout.write(f"  After type+position filter: {len(rows):,} weekly rows")

        # Map scrape_date to (season, week)
        dated = []
        unmapped = 0
        for r in rows:
            scrape_str = r.get("scrape_date", "")
            if not scrape_str:
                unmapped += 1
                continue
            try:
                scrape_date = date.fromisoformat(scrape_str)
            except ValueError:
                unmapped += 1
                continue
            season_week = self._date_to_season_week(scrape_date, week_map)
            if not season_week:
                unmapped += 1
                continue
            season, week = season_week
            if requested_seasons and season not in set(requested_seasons):
                continue
            r["_season"] = season
            r["_week"] = week
            dated.append(r)

        if unmapped:
            self.stdout.write(
                self.style.WARNING(f"  Could not map {unmapped} rows to season/week")
            )
        self.stdout.write(f"  Rows with season+week resolved: {len(dated):,}")

        return self._write_rows(dated, name_cache)

    # ── Current-week sync ─────────────────────────────────────────────────

    def _sync_current_week(self, week_map, name_cache):
        with self.timed_operation(
            "Downloading current-week ECR (fp_latest_weekly.csv)"
        ):
            try:
                resp = requests.get(CURRENT_WEEK_URL, timeout=30)
                resp.raise_for_status()
            except Exception as exc:
                self.stderr.write(self.style.ERROR(f"Download failed: {exc}"))
                return 0, 0

        all_rows = list(csv.DictReader(io.StringIO(resp.text)))
        rows = [
            r
            for r in all_rows
            if r.get("pos", r.get("page_pos", "")).upper() in FANTASY_POSITIONS
        ]
        self.stdout.write(f"  {len(rows)} current-week rows (after position filter)")

        # Determine season/week from scrape_date
        sample_date = None
        for r in rows:
            try:
                sample_date = date.fromisoformat(r.get("scrape_date", ""))
                break
            except ValueError:
                continue

        season_week = (
            self._date_to_season_week(sample_date, week_map) if sample_date else None
        )
        if not season_week:
            self.stderr.write(
                self.style.ERROR(
                    "Cannot determine current season/week from scrape_date"
                )
            )
            return 0, 0

        season, week = season_week
        self.stdout.write(f"  Current week: Season {season}, Week {week}")

        # current-week file has pos_rank like "QB1"; extract the numeric part
        _pos_rank_re = re.compile(r"\d+")
        for r in rows:
            r["_season"] = season
            r["_week"] = week
            r.setdefault("player", r.get("player_name", ""))
            r.setdefault("pos", r.get("page_pos", ""))
            # Parse "QB1" / "WR3" / "RB2" → integer
            m = _pos_rank_re.search(str(r.get("pos_rank", "")))
            r["pos_rank"] = m.group() if m else ""

        return self._write_rows(rows, name_cache, has_pos_rank=True)

    # ── Shared write logic ────────────────────────────────────────────────

    def _write_rows(self, rows, name_cache, has_pos_rank=False):
        # Group by (season, week, pos) to compute position rank (unless already provided)
        if not has_pos_rank:
            groups: dict[tuple, list] = defaultdict(list)
            for r in rows:
                groups[(r["_season"], r["_week"], r.get("pos", "").upper())].append(r)
            for group_rows in groups.values():
                group_rows.sort(key=lambda x: self.safe_float(x.get("ecr"), 999))
                for i, r in enumerate(group_rows):
                    r["_pos_rank"] = i + 1
        else:
            for r in rows:
                r["_pos_rank"] = self.safe_int(r.get("pos_rank")) or None

        created = 0
        updated = 0
        skipped = 0
        batch = []

        for row in rows:
            season = row["_season"]
            week = row["_week"]
            pos = row.get("pos", "").upper()
            # Normalise "PK" (some FP kicker pages use PK) to "K"
            if pos == "PK":
                pos = "K"

            player_name = self.safe_str(row.get("player") or row.get("player_name", ""))
            player = name_cache.get(self._np_key(player_name, pos))
            # Fuzzy fallback: try without position (last name only)
            if not player:
                last_name = (
                    player_name.strip().split()[-1] if player_name.strip() else ""
                )
                for key, p in name_cache.items():
                    if key.split("|")[0].endswith(last_name.lower()) and key.endswith(
                        f"|{pos}"
                    ):
                        player = p
                        break

            if not player:
                skipped += 1
                continue

            ecr = self.safe_float(row.get("ecr"))
            if ecr is None:
                skipped += 1
                continue

            defaults = {
                "position": pos,
                "rank": ecr,
                "rank_sd": self.safe_float(row.get("sd")),
                "rank_best": self.safe_int(row.get("best")),
                "rank_worst": self.safe_int(row.get("worst")),
                "position_rank": row.get("_pos_rank"),
            }
            batch.append((player, season, week, defaults))

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
            self.stdout.write(
                self.style.WARNING(f"  Skipped {skipped} rows (no player match)")
            )

        return created, updated

    # ── Helpers ───────────────────────────────────────────────────────────

    def _build_date_week_map(self):
        """
        Returns list of dicts: {season, week, min_date, max_date}.
        Each entry covers one game week. A scrape_date is mapped to the
        entry whose [min_date - 2, max_date + 2] window contains it.
        """
        # Get all distinct (season_year, week, game_date) from DB
        from django.db.models import Min, Max

        entries = (
            Game.objects.using("nfl")
            .values("season__year", "week", "season_type")
            .annotate(min_date=Min("game_date"), max_date=Max("game_date"))
        )
        week_map = []
        for e in entries:
            week_map.append(
                {
                    "season": e["season__year"],
                    "week": e["week"],
                    "min_date": e["min_date"],
                    "max_date": e["max_date"],
                }
            )
        return week_map

    def _date_to_season_week(self, d: date, week_map):
        """Find the (season, week) whose game dates bracket d (±2 days)."""
        if not d:
            return None
        for entry in week_map:
            low = entry["min_date"] - timedelta(days=2)
            high = entry["max_date"] + timedelta(days=2)
            if low <= d <= high:
                return (entry["season"], entry["week"])
        return None

    def _np_key(self, name: str, pos: str) -> str:
        return f"{name.lower().strip()}|{pos.upper().strip()}"

    def _flush_batch(self, batch):
        created = 0
        updated = 0
        if self.dry_run:
            return len(batch), 0
        with transaction.atomic(using="nfl"):
            for player, season, week, defaults in batch:
                _, was_created = PlayerFFRanking.objects.using("nfl").update_or_create(
                    player=player,
                    season=season,
                    week=week,
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
        return created, updated
