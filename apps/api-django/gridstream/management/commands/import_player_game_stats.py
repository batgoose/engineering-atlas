"""
Import raw nflverse player stats into raw.raw_nflverse_player_stats.

Source dataset:
    https://github.com/nflverse/nflverse-data/releases/tag/stats_player
    stats_player_week_<season>.csv.gz

This command writes source-faithful rows into the raw schema (no PBP-derived
aggregation), and records one metadata row per season in raw.raw_ingest_batch.
"""

import csv
import gzip
import hashlib
import io
import json
from datetime import UTC, datetime

import requests
from django.core.management.base import CommandError
from django.db import transaction

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}
BASE_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player"
INSERT_SQL = """
    INSERT INTO raw.raw_nflverse_player_stats (
        batch_id,
        season,
        week,
        game_id,
        player_id,
        player_name,
        team,
        opponent,
        position,
        payload
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
"""


class Command(ImportBaseCommand):
    help = "Import nflverse player_stats dataset into raw.raw_nflverse_player_stats."

    def handle(self, *args, **options):
        self.batch_size = max(1, options["batch_size"])
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        self._ensure_required_tables()
        seasons = self._resolve_target_seasons(requested)
        if not seasons:
            self.stdout.write(
                self.style.WARNING("No seasons selected; nothing to import.")
            )
            return

        self.stdout.write(
            f"Importing raw player stats for {len(seasons)} seasons: "
            f"{seasons[0]}-{seasons[-1]}"
        )

        total_inserted = 0
        total_deleted = 0
        total_missing_game_id = 0

        for year in seasons:
            self.log_season_header(year)
            source_file = f"stats_player_week_{year}.csv.gz"
            source_url = f"{BASE_URL}/{source_file}"

            with self.timed_operation(f"Downloading {source_file}"):
                downloaded = self._download_source(source_url)

            if downloaded is None:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Skipping {year}: source file not found (404)."
                    )
                )
                continue

            content, checksum = downloaded
            batch_id = None
            if not self.dry_run:
                batch_id = self._begin_batch(
                    season=year,
                    source_url=source_url,
                    source_file=source_file,
                    checksum=checksum,
                )

            try:
                with transaction.atomic(using="nfl"):
                    deleted, inserted, missing_game_id = self._ingest_season(
                        season=year,
                        batch_id=batch_id,
                        content=content,
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

            total_deleted += deleted
            total_inserted += inserted
            total_missing_game_id += missing_game_id

            self.stdout.write(
                f"  Deleted {deleted:,} existing rows, inserted {inserted:,} rows"
            )
            if missing_game_id:
                self.stdout.write(
                    self.style.WARNING(
                        f"  {missing_game_id:,} rows had no game_id match in "
                        "raw.raw_nflverse_pbp"
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(
                "\nDone! "
                f"{total_inserted:,} inserted, {total_deleted:,} deleted, "
                f"{total_missing_game_id:,} rows without game_id mapping."
            )
        )

    def _ensure_required_tables(self):
        with self.get_nfl_cursor() as cursor:
            cursor.execute("""
                SELECT
                    to_regclass('raw.raw_nflverse_player_stats'),
                    to_regclass('raw.raw_ingest_batch')
                """)
            player_stats_table, ingest_batch_table = cursor.fetchone()

        if not player_stats_table:
            raise CommandError(
                "Missing table raw.raw_nflverse_player_stats. Run migrations first."
            )
        if not ingest_batch_table:
            raise CommandError(
                "Missing table raw.raw_ingest_batch. Run migrations first."
            )

    def _resolve_target_seasons(self, requested):
        if requested:
            return sorted({int(s) for s in requested})

        seasons = []
        with self.get_nfl_cursor() as cursor:
            cursor.execute("SELECT to_regclass('raw.raw_nflverse_pbp')")
            has_pbp = cursor.fetchone()[0]
            if has_pbp:
                cursor.execute(
                    "SELECT DISTINCT season FROM raw.raw_nflverse_pbp "
                    "WHERE season IS NOT NULL ORDER BY season"
                )
                seasons = [r[0] for r in cursor.fetchall()]

        if seasons:
            return seasons

        current_year = datetime.now(tz=UTC).year
        return list(range(1999, current_year + 1))

    def _download_source(self, url):
        response = requests.get(
            url,
            timeout=180,
            headers={"User-Agent": "engineering-atlas/import_player_game_stats"},
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        content = response.content
        checksum = hashlib.sha256(content).hexdigest()
        return content, checksum

    def _begin_batch(self, season, source_url, source_file, checksum):
        metadata = json.dumps(
            {
                "season": season,
                "status": "started",
                "ingest_tool": "django.import_player_game_stats",
                "target_table": "raw.raw_nflverse_player_stats",
            }
        )
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
                    "nflverse",
                    "player_stats",
                    source_url,
                    source_file,
                    str(season),
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

    def _ingest_season(self, season, batch_id, content):
        game_lookup, team_only_lookup = self._build_game_lookup(season)

        deleted = 0
        if not self.dry_run:
            with self.get_nfl_cursor() as cursor:
                cursor.execute(
                    "DELETE FROM raw.raw_nflverse_player_stats WHERE season = %s",
                    [season],
                )
                deleted = cursor.rowcount

        inserted = 0
        missing_game_id = 0
        chunk = []

        with gzip.GzipFile(fileobj=io.BytesIO(content), mode="rb") as gz:
            text_stream = io.TextIOWrapper(gz, encoding="utf-8", newline="")
            reader = csv.DictReader(text_stream)

            for row in reader:
                season_value = self.safe_int(row.get("season"), season) or season
                week = self.safe_int(row.get("week"))
                season_type = self._normalize_season_type(row.get("season_type"))
                team = self._canonical_team(row.get("team"))
                opponent = self._canonical_team(row.get("opponent_team"))
                game_id = game_lookup.get((week, season_type, team, opponent))
                if not game_id:
                    game_id = team_only_lookup.get((week, season_type, team))
                if not game_id:
                    missing_game_id += 1

                player_id = self.safe_str(row.get("player_id"), default="")
                player_name = self.safe_str(
                    row.get("player_display_name") or row.get("player_name"), default=""
                )
                position = self.safe_str(row.get("position"), default="")
                payload = json.dumps(self._normalize_payload(row))

                chunk.append(
                    (
                        batch_id,
                        season_value,
                        week,
                        game_id,
                        player_id or None,
                        player_name or None,
                        team or None,
                        opponent or None,
                        position or None,
                        payload,
                    )
                )

                if len(chunk) >= self.batch_size:
                    inserted += self._flush_chunk(chunk)
                    chunk = []

        if chunk:
            inserted += self._flush_chunk(chunk)

        return deleted, inserted, missing_game_id

    def _flush_chunk(self, chunk):
        if self.dry_run:
            return len(chunk)

        with self.get_nfl_cursor() as cursor:
            cursor.executemany(INSERT_SQL, chunk)
        return len(chunk)

    def _build_game_lookup(self, season):
        with self.get_nfl_cursor() as cursor:
            cursor.execute("SELECT to_regclass('raw.raw_nflverse_pbp')")
            has_pbp = cursor.fetchone()[0]
            if not has_pbp:
                return {}, {}

            cursor.execute(
                """
                SELECT DISTINCT
                    week,
                    COALESCE(NULLIF(payload->>'season_type', ''), 'REG') AS season_type,
                    posteam,
                    defteam,
                    game_id
                FROM raw.raw_nflverse_pbp
                WHERE season = %s
                    AND week IS NOT NULL
                    AND posteam IS NOT NULL
                    AND posteam <> ''
                    AND defteam IS NOT NULL
                    AND defteam <> ''
                """,
                [season],
            )
            rows = cursor.fetchall()

        lookup = {}
        team_only_lookup = {}
        ambiguous = set()
        ambiguous_team_only = set()
        for week, season_type, posteam, defteam, game_id in rows:
            key = (
                self.safe_int(week),
                self._normalize_season_type(season_type),
                self._canonical_team(posteam),
                self._canonical_team(defteam),
            )
            if key in ambiguous or not all(key) or not game_id:
                continue
            existing = lookup.get(key)
            if existing and existing != game_id:
                ambiguous.add(key)
                lookup.pop(key, None)
                continue
            lookup[key] = game_id

            team_key = (key[0], key[1], key[2])
            if team_key in ambiguous_team_only:
                continue
            existing_team = team_only_lookup.get(team_key)
            if existing_team and existing_team != game_id:
                ambiguous_team_only.add(team_key)
                team_only_lookup.pop(team_key, None)
                continue
            team_only_lookup[team_key] = game_id

        return lookup, team_only_lookup

    def _canonical_team(self, team_abbr):
        abbr = self.safe_str(team_abbr, default="").upper()
        if not abbr:
            return ""
        return TEAM_ABBR_MAP.get(abbr, abbr)

    def _normalize_season_type(self, season_type):
        normalized = self.safe_str(season_type, default="REG").upper()
        if normalized in {"REG", "POST", "PRE"}:
            return normalized
        return "REG"

    def _normalize_payload(self, row):
        payload = {}
        for key, value in row.items():
            if value is None:
                payload[key] = None
                continue
            stripped = str(value).strip()
            payload[key] = stripped if stripped else None
        return payload
