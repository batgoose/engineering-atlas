"""
Import nfldata standings into raw.raw_nflverse_standings.

Source dataset:
    https://raw.githubusercontent.com/nflverse/nfldata/master/data/standings.csv

This command writes source-faithful rows into the raw schema and records one
metadata row per run in raw.raw_ingest_batch.
"""

import csv
import hashlib
import io
import json
from datetime import UTC, datetime

import requests
from django.core.management.base import CommandError
from django.db import transaction

from gridstream.models import Season, Team, TeamStanding

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}
SOURCE_URL = (
    "https://raw.githubusercontent.com/nflverse/nfldata/master/data/standings.csv"
)
SOURCE_FILE = "standings.csv"
INSERT_SQL = """
    INSERT INTO raw.raw_nflverse_standings (
        batch_id,
        season,
        week,
        team,
        conference,
        division,
        wins,
        losses,
        ties,
        payload
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
"""


class Command(ImportBaseCommand):
    help = "Import nfldata standings into raw.raw_nflverse_standings."

    def handle(self, *args, **options):
        self.batch_size = max(1, options["batch_size"])
        self.dry_run = options["dry_run"]
        requested = options.get("season")
        self._missing_team_warnings = set()

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        self._ensure_required_tables()
        self.team_cache = self._build_team_cache()

        with self.timed_operation(f"Downloading {SOURCE_FILE}"):
            content, checksum = self._download_source()
        all_rows = self._parse_rows(content)
        seasons_in_file = sorted({r["season"] for r in all_rows if r.get("season")})
        target_seasons = self._resolve_target_seasons(requested, seasons_in_file)

        if not target_seasons:
            self.stdout.write(
                self.style.WARNING("No seasons selected; nothing to import.")
            )
            return

        target_set = set(target_seasons)
        rows = [r for r in all_rows if r.get("season") in target_set]

        self.stdout.write(
            f"Importing standings for {len(target_seasons)} seasons: "
            f"{target_seasons[0]}-{target_seasons[-1]} "
            f"({len(rows):,} rows)"
        )

        batch_id = None
        if not self.dry_run:
            batch_id = self._begin_batch(
                seasons=target_seasons,
                checksum=checksum,
            )

        try:
            with transaction.atomic(using="nfl"):
                deleted = self._delete_existing_rows(target_seasons)
                deleted_team_standings = self._delete_existing_team_standings(
                    target_seasons
                )
                inserted = self._insert_rows(rows, batch_id)
                inserted_team_standings, skipped_team_standings = (
                    self._insert_team_standings(rows, target_seasons)
                )
        except Exception as exc:
            if batch_id is not None:
                self._complete_batch(
                    batch_id=batch_id,
                    row_count=0,
                    processed_rows=0,
                    status="failed",
                    error=str(exc),
                )
            raise

        if batch_id is not None:
            self._complete_batch(
                batch_id=batch_id,
                row_count=inserted,
                processed_rows=inserted,
                status="ok",
                error=None,
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Done! {inserted:,} inserted, {deleted:,} deleted "
                f"across {len(target_seasons)} seasons. "
                f"TeamStanding: {inserted_team_standings:,} inserted, "
                f"{deleted_team_standings:,} deleted, "
                f"{skipped_team_standings:,} skipped."
            )
        )

    def _ensure_required_tables(self):
        with self.get_nfl_cursor() as cursor:
            cursor.execute("""
                SELECT
                    to_regclass('raw.raw_nflverse_standings'),
                    to_regclass('raw.raw_ingest_batch'),
                    to_regclass('gridstream_teamstanding')
                """)
            standings_table, ingest_batch_table, team_standings_table = (
                cursor.fetchone()
            )

        if not standings_table:
            raise CommandError(
                "Missing table raw.raw_nflverse_standings. Run migrations first."
            )
        if not ingest_batch_table:
            raise CommandError(
                "Missing table raw.raw_ingest_batch. Run migrations first."
            )
        if not team_standings_table:
            raise CommandError(
                "Missing table gridstream_teamstanding. Run migrations first."
            )

    def _build_team_cache(self):
        cache = {team.abbreviation: team for team in Team.objects.using("nfl").all()}
        for old_abbr, new_abbr in TEAM_ABBR_MAP.items():
            if new_abbr in cache and old_abbr not in cache:
                cache[old_abbr] = cache[new_abbr]
        return cache

    def _download_source(self):
        response = requests.get(
            SOURCE_URL,
            timeout=180,
            headers={"User-Agent": "engineering-atlas/import_nflverse_standings"},
        )
        response.raise_for_status()
        content = response.content
        checksum = hashlib.sha256(content).hexdigest()
        return content, checksum

    def _parse_rows(self, content):
        text = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        rows = []
        for row in reader:
            season = self.safe_int(row.get("season"))
            if season is None:
                continue

            normalized = self._normalize_payload(row)
            rows.append(
                {
                    "season": season,
                    "week": self.safe_int(row.get("week")),
                    "team": self._canonical_team(row.get("team")),
                    "conference": self.safe_str(row.get("conf"), default="") or None,
                    "division": self.safe_str(row.get("division"), default="") or None,
                    "wins": self.safe_int(row.get("wins")),
                    "losses": self.safe_int(row.get("losses")),
                    "ties": self.safe_int(row.get("ties")),
                    "pct": self.safe_float(row.get("pct")),
                    "div_rank": self.safe_int(row.get("div_rank")),
                    "points_for": self.safe_int(row.get("scored")),
                    "points_against": self.safe_int(row.get("allowed")),
                    "point_diff": self.safe_int(row.get("net")),
                    "sov": self.safe_float(row.get("sov")),
                    "sos": self.safe_float(row.get("sos")),
                    "seed": self.safe_int(row.get("seed")),
                    "streak": self.safe_str(row.get("streak"), default=""),
                    "last_5": self.safe_str(row.get("last_5"), default=""),
                    "playoff_clincher": self.safe_str(row.get("playoff"), default=""),
                    "payload": json.dumps(normalized),
                }
            )
        return rows

    def _resolve_target_seasons(self, requested, seasons_in_file):
        if requested:
            requested_set = {int(s) for s in requested}
            available_set = set(seasons_in_file)
            missing = sorted(requested_set - available_set)
            if missing:
                self.stdout.write(
                    self.style.WARNING(
                        f"Requested seasons not in standings.csv: {missing}"
                    )
                )
            return sorted(requested_set & available_set)
        return seasons_in_file

    def _begin_batch(self, seasons, checksum):
        metadata = json.dumps(
            {
                "status": "started",
                "ingest_tool": "django.import_nflverse_standings",
                "target_table": "raw.raw_nflverse_standings",
                "season_count": len(seasons),
                "season_min": min(seasons),
                "season_max": max(seasons),
            }
        )
        source_version = f"{min(seasons)}-{max(seasons)}"
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO raw.raw_ingest_batch (
                    source_system,
                    dataset_name,
                    source_url,
                    source_file,
                    source_version,
                    source_checksum,
                    metadata
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                RETURNING id
                """,
                (
                    "nfldata",
                    "standings",
                    SOURCE_URL,
                    SOURCE_FILE,
                    source_version,
                    checksum,
                    metadata,
                ),
            )
            return cursor.fetchone()[0]

    def _complete_batch(self, batch_id, row_count, processed_rows, status, error):
        metadata_patch = {
            "status": status,
            "processed_rows": processed_rows,
            "finished_at": datetime.now(tz=UTC).isoformat(),
            "error": error or "",
        }
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                """
                UPDATE raw.raw_ingest_batch
                SET row_count = %s,
                    metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
                WHERE id = %s
                """,
                (row_count, json.dumps(metadata_patch), batch_id),
            )

    def _delete_existing_rows(self, seasons):
        if self.dry_run:
            return 0
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                "DELETE FROM raw.raw_nflverse_standings WHERE season = ANY(%s)",
                [seasons],
            )
            return cursor.rowcount

    def _delete_existing_team_standings(self, seasons):
        if self.dry_run:
            return 0
        deleted, _detail = (
            TeamStanding.objects.using("nfl").filter(season_id__in=seasons).delete()
        )
        return deleted

    def _insert_rows(self, rows, batch_id):
        inserted = 0
        chunk = []

        for row in rows:
            chunk.append(
                (
                    batch_id,
                    row["season"],
                    row["week"],
                    row["team"] or None,
                    row["conference"],
                    row["division"],
                    row["wins"],
                    row["losses"],
                    row["ties"],
                    row["payload"],
                )
            )
            if len(chunk) >= self.batch_size:
                inserted += self._flush_chunk(chunk)
                chunk = []

        if chunk:
            inserted += self._flush_chunk(chunk)
        return inserted

    def _flush_chunk(self, chunk):
        if self.dry_run:
            return len(chunk)
        with self.get_nfl_cursor() as cursor:
            cursor.executemany(INSERT_SQL, chunk)
        return len(chunk)

    def _insert_team_standings(self, rows, target_seasons):
        if self.dry_run:
            return len(rows), 0

        season_map = {
            season.year: season
            for season in Season.objects.using("nfl").filter(year__in=target_seasons)
        }
        missing_seasons = sorted(set(target_seasons) - set(season_map.keys()))
        for year in missing_seasons:
            season_map[year], _ = Season.objects.using("nfl").get_or_create(
                year=year,
                defaults={"is_active": False},
            )

        rows_to_create = []
        skipped = 0

        for row in rows:
            season = season_map.get(row["season"])
            team = self.team_cache.get(row["team"])

            if season is None or team is None:
                skipped += 1
                if team is None and row["team"] not in self._missing_team_warnings:
                    self._missing_team_warnings.add(row["team"])
                    self.stdout.write(
                        self.style.WARNING(
                            f"  [skip] Team not found for standings row: {row['team']}"
                        )
                    )
                continue

            wins = row["wins"] or 0
            losses = row["losses"] or 0
            ties = row["ties"] or 0
            games_played = wins + losses + ties
            pct = row["pct"]
            if pct is None:
                pct = (
                    round((wins + 0.5 * ties) / games_played, 3)
                    if games_played
                    else 0.0
                )

            point_diff = row["point_diff"]
            if (
                point_diff is None
                and row["points_for"] is not None
                and row["points_against"] is not None
            ):
                point_diff = row["points_for"] - row["points_against"]

            rows_to_create.append(
                TeamStanding(
                    season=season,
                    team=team,
                    conference=row["conference"] or "",
                    division=row["division"] or "",
                    wins=wins,
                    losses=losses,
                    ties=ties,
                    pct=pct,
                    div_rank=row["div_rank"],
                    seed=row["seed"],
                    points_for=row["points_for"],
                    points_against=row["points_against"],
                    point_diff=point_diff or 0,
                    sov=row["sov"],
                    sos=row["sos"],
                    streak=row["streak"],
                    last_5=row["last_5"],
                    playoff_clincher=row["playoff_clincher"],
                )
            )

        if rows_to_create:
            TeamStanding.objects.using("nfl").bulk_create(
                rows_to_create,
                batch_size=self.batch_size,
            )

        return len(rows_to_create), skipped

    def _canonical_team(self, team_abbr):
        abbr = self.safe_str(team_abbr, default="").upper()
        if not abbr:
            return ""
        return TEAM_ABBR_MAP.get(abbr, abbr)

    def _normalize_payload(self, row):
        payload = {}
        for key, value in row.items():
            if value is None:
                payload[key] = None
                continue
            stripped = str(value).strip()
            payload[key] = stripped if stripped else None
        return payload
