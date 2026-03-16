"""
Import ESPN win-probability timeline rows into raw.raw_espn_probabilities.

Source:
    raw.raw_espn_summary (latest summary snapshot per ESPN event)

This command is idempotent for the selected events: it deletes existing
raw_espn_probabilities rows for those event IDs, then inserts rebuilt rows.
Rows are keyed to plays where possible by joining:
    gridstream_game.espn_event_id -> gridstream_play.espn_play_id

examples:
    # import all seasons available in raw_espn_summary
    python manage.py import_espn_probabilities

    # limit to specific season(s)
    python manage.py import_espn_probabilities --season 2025

    # only specific event IDs
    python manage.py import_espn_probabilities --event-id 401772988 401772901

    # dry run
    python manage.py import_espn_probabilities --season 2025 --dry-run
"""

import hashlib
import json
from datetime import UTC, datetime
from typing import Optional

from django.core.management.base import CommandError
from django.db import transaction

from gridstream.models import Play, WinProbabilityPlay

from ._base import ImportBaseCommand


class Command(ImportBaseCommand):
    help = (
        "Import ESPN win-probability timeline from raw.raw_espn_summary "
        "into raw.raw_espn_probabilities + gridstream_winprobabilityplay."
    )

    INSERT_SQL = """
        INSERT INTO raw.raw_espn_probabilities (
            batch_id,
            espn_event_id,
            play_id,
            sequence,
            seconds_left,
            home_win_pct,
            away_win_pct,
            tie_pct,
            probability_payload
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
    """

    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.add_argument(
            "--event-id",
            dest="event_ids",
            nargs="*",
            default=[],
            help="Only process these ESPN event IDs.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Optional max number of events to process (for testing).",
        )

    def handle(self, *args, **options):
        self.batch_size = max(1, options["batch_size"])
        self.dry_run = options["dry_run"]
        requested_seasons = options.get("season")
        event_ids = [
            str(e).strip() for e in (options.get("event_ids") or []) if str(e).strip()
        ]
        limit = max(0, options.get("limit") or 0)

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        self._ensure_required_tables()

        summaries = self._load_latest_summaries(
            seasons=requested_seasons,
            event_ids=event_ids,
            limit=limit,
        )
        if not summaries:
            self.stdout.write(
                self.style.WARNING(
                    "No raw ESPN summaries found for the requested scope."
                )
            )
            return

        scope_events = [row["espn_event_id"] for row in summaries]
        play_lookup = self._build_play_lookup(scope_events)
        checksum = self._build_checksum(summaries)

        batch_id = None
        if not self.dry_run:
            batch_id = self._begin_batch(
                requested_seasons=requested_seasons,
                source_checksum=checksum,
                event_count=len(scope_events),
            )

        inserted = 0
        deleted = 0
        events_with_timeline = 0
        model_inserted = 0
        model_deleted = 0
        play_updates = 0

        try:
            with transaction.atomic(using="nfl"):
                if scope_events:
                    deleted = self._delete_existing(scope_events)

                inserted, events_with_timeline = self._ingest_probabilities(
                    summaries=summaries,
                    play_lookup=play_lookup,
                    batch_id=batch_id,
                )
                model_deleted, model_inserted, play_updates = (
                    self._rebuild_model_probabilities(
                        event_ids=scope_events,
                        play_lookup=play_lookup,
                    )
                )
        except Exception as exc:
            if batch_id is not None:
                self._complete_batch(
                    batch_id=batch_id,
                    row_count=0,
                    status="failed",
                    error=str(exc),
                    processed_events=len(scope_events),
                    events_with_timeline=events_with_timeline,
                )
            raise

        if batch_id is not None:
            self._complete_batch(
                batch_id=batch_id,
                row_count=inserted,
                status="ok",
                error=None,
                processed_events=len(scope_events),
                events_with_timeline=events_with_timeline,
            )

        self.stdout.write(
            self.style.SUCCESS(
                "Done! "
                f"{inserted:,} probability rows inserted, "
                f"{deleted:,} deleted, "
                f"{events_with_timeline:,}/{len(scope_events):,} events with timeline data. "
                f"WinProbabilityPlay: {model_inserted:,} inserted, "
                f"{model_deleted:,} deleted, "
                f"{play_updates:,} linked play updates."
            )
        )

    def _ensure_required_tables(self):
        with self.get_nfl_cursor() as cursor:
            cursor.execute("""
                SELECT
                    to_regclass('raw.raw_espn_summary'),
                    to_regclass('raw.raw_espn_probabilities'),
                    to_regclass('raw.raw_ingest_batch'),
                    to_regclass('gridstream_winprobabilityplay')
            """)
            (
                summary_table,
                probs_table,
                ingest_batch_table,
                win_prob_model_table,
            ) = cursor.fetchone()

        if not summary_table:
            raise CommandError(
                "Missing table raw.raw_espn_summary. Run migrations first."
            )
        if not probs_table:
            raise CommandError(
                "Missing table raw.raw_espn_probabilities. Run migrations first."
            )
        if not ingest_batch_table and not self.dry_run:
            raise CommandError(
                "Missing table raw.raw_ingest_batch. Run migrations first."
            )
        if not win_prob_model_table and not self.dry_run:
            raise CommandError(
                "Missing table gridstream_winprobabilityplay. Run migrations first."
            )

    def _load_latest_summaries(self, seasons, event_ids, limit):
        where_clauses = []
        params = []

        if seasons:
            where_clauses.append("season = ANY(%s)")
            params.append([int(s) for s in seasons])
        if event_ids:
            where_clauses.append("espn_event_id = ANY(%s)")
            params.append(event_ids)

        where_sql = ""
        if where_clauses:
            where_sql = "WHERE " + " AND ".join(where_clauses)

        sql = f"""
            SELECT DISTINCT ON (espn_event_id)
                espn_event_id,
                season,
                week,
                season_type,
                game_date,
                summary_payload
            FROM raw.raw_espn_summary
            {where_sql}
            ORDER BY espn_event_id, ingested_at DESC, id DESC
        """

        with self.get_nfl_cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            columns = [d[0] for d in cursor.description]

        out = [dict(zip(columns, row)) for row in rows]
        out.sort(
            key=lambda r: (r.get("season") or 0, r.get("week") or 0, r["espn_event_id"])
        )
        if limit > 0:
            out = out[:limit]
        return out

    def _build_play_lookup(self, event_ids):
        if not event_ids:
            return {}

        sql = """
            SELECT
                g.espn_event_id,
                g.id AS game_id,
                p.id AS play_id,
                p.espn_play_id,
                p.sequence,
                p.quarter,
                p.clock
            FROM gridstream_play p
            JOIN gridstream_game g ON g.id = p.game_id
            WHERE g.espn_event_id = ANY(%s)
                AND p.espn_play_id IS NOT NULL
                AND p.espn_play_id <> ''
        """

        lookup = {}
        with self.get_nfl_cursor() as cursor:
            cursor.execute(sql, [event_ids])
            for (
                event_id,
                game_id,
                play_id,
                espn_play_id,
                sequence,
                quarter,
                clock,
            ) in cursor.fetchall():
                game_event = str(event_id)
                key = str(espn_play_id).strip()
                if not key:
                    continue
                event_lookup = lookup.setdefault(game_event, {})
                if key in event_lookup:
                    continue
                event_lookup[key] = {
                    "game_id": self.safe_int(game_id),
                    "play_id": self.safe_int(play_id),
                    "sequence": self.safe_int(sequence),
                    "seconds_left": self._estimate_seconds_left(quarter, clock),
                }
        return lookup

    def _rebuild_model_probabilities(self, event_ids, play_lookup):
        if self.dry_run or not event_ids:
            return 0, 0, 0

        game_id_by_event = {}
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                """
                SELECT espn_event_id, id
                FROM gridstream_game
                WHERE espn_event_id = ANY(%s)
                """,
                [event_ids],
            )
            for event_id, game_id in cursor.fetchall():
                game_id_by_event[str(event_id)] = self.safe_int(game_id)

        game_ids = sorted({gid for gid in game_id_by_event.values() if gid is not None})
        if not game_ids:
            return 0, 0, 0

        deleted, _detail = (
            WinProbabilityPlay.objects.using("nfl")
            .filter(game_id__in=game_ids)
            .delete()
        )

        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    espn_event_id,
                    play_id,
                    sequence,
                    seconds_left,
                    home_win_pct,
                    away_win_pct,
                    tie_pct
                FROM raw.raw_espn_probabilities
                WHERE espn_event_id = ANY(%s)
                ORDER BY espn_event_id, sequence, id
                """,
                [event_ids],
            )
            raw_rows = cursor.fetchall()

        rows_by_key = {}
        fallback_sequence_by_event = {}
        play_updates = {}

        for (
            event_id,
            espn_play_id,
            sequence,
            seconds_left,
            home_win_pct,
            away_win_pct,
            tie_pct,
        ) in raw_rows:
            event_key = str(event_id)
            game_id = game_id_by_event.get(event_key)
            if game_id is None:
                continue

            seq = self.safe_int(sequence)
            if seq is None:
                next_seq = fallback_sequence_by_event.get(event_key, 0) + 1
                fallback_sequence_by_event[event_key] = next_seq
                seq = next_seq

            play_id_str = self.safe_str(espn_play_id, default="")
            linked_play = (
                play_lookup.get(event_key, {}).get(play_id_str) if play_id_str else None
            )
            play_id_fk = linked_play.get("play_id") if linked_play else None

            home_win = self.safe_float(home_win_pct)
            away_win = self.safe_float(away_win_pct)
            tie = self.safe_float(tie_pct)
            seconds = self.safe_int(seconds_left)

            rows_by_key[(game_id, seq)] = WinProbabilityPlay(
                game_id=game_id,
                play_id=play_id_fk,
                espn_play_id=play_id_str,
                sequence=seq,
                seconds_left=seconds,
                home_win_pct=home_win,
                away_win_pct=away_win,
                tie_pct=tie,
                source="raw_espn_probabilities",
            )

            if play_id_fk and (home_win is not None or away_win is not None):
                play_updates[play_id_fk] = (home_win, away_win)

        model_rows = list(rows_by_key.values())
        if model_rows:
            WinProbabilityPlay.objects.using("nfl").bulk_create(
                model_rows,
                batch_size=self.batch_size,
            )

        updated_play_count = 0
        for play_id, (home_win, away_win) in play_updates.items():
            update_data = {}
            if home_win is not None:
                update_data["home_wp"] = home_win
            if away_win is not None:
                update_data["away_wp"] = away_win
            if not update_data:
                continue
            changed = Play.objects.using("nfl").filter(pk=play_id).update(**update_data)
            if changed:
                updated_play_count += 1

        return deleted, len(model_rows), updated_play_count

    def _delete_existing(self, event_ids):
        if self.dry_run or not event_ids:
            return 0
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                "DELETE FROM raw.raw_espn_probabilities WHERE espn_event_id = ANY(%s)",
                [event_ids],
            )
            return cursor.rowcount

    def _ingest_probabilities(self, summaries, play_lookup, batch_id):
        rows = []
        events_with_timeline = 0

        for summary_row in summaries:
            event_id = str(summary_row["espn_event_id"])
            payload = self._coerce_payload(summary_row.get("summary_payload"))
            timeline = payload.get("winprobability") or []
            if not isinstance(timeline, list):
                continue
            if timeline:
                events_with_timeline += 1

            event_play_lookup = play_lookup.get(event_id, {})
            for idx, point in enumerate(timeline, start=1):
                if not isinstance(point, dict):
                    continue

                play_id = self.safe_str(point.get("playId"), default="")
                play_id = play_id or None
                linked_play = event_play_lookup.get(play_id) if play_id else None

                sequence = self.safe_int(point.get("sequenceNumber"))
                if sequence is None and linked_play:
                    sequence = linked_play.get("sequence")
                if sequence is None:
                    sequence = idx

                seconds_left = self.safe_int(point.get("secondsLeft"))
                if seconds_left is None and linked_play:
                    seconds_left = linked_play.get("seconds_left")

                home_win = self.safe_float(point.get("homeWinPercentage"))
                tie_pct = self.safe_float(point.get("tiePercentage"))
                away_win = self.safe_float(point.get("awayWinPercentage"))
                if away_win is None and home_win is not None:
                    away_win = max(0.0, 1.0 - home_win - (tie_pct or 0.0))

                rows.append(
                    (
                        batch_id,
                        event_id,
                        play_id,
                        sequence,
                        seconds_left,
                        home_win,
                        away_win,
                        tie_pct,
                        json.dumps(point),
                    )
                )

        if self.dry_run:
            return len(rows), events_with_timeline

        inserted = 0
        for i in range(0, len(rows), self.batch_size):
            chunk = rows[i : i + self.batch_size]
            with self.get_nfl_cursor() as cursor:
                cursor.executemany(self.INSERT_SQL, chunk)
            inserted += len(chunk)

        return inserted, events_with_timeline

    def _estimate_seconds_left(self, quarter, clock) -> Optional[int]:
        quarter_num = self.safe_int(quarter)
        clock_seconds = self._clock_to_seconds(clock)
        if quarter_num is None or clock_seconds is None:
            return None
        if quarter_num <= 4:
            return max(0, ((4 - quarter_num) * 900) + clock_seconds)
        return clock_seconds

    def _clock_to_seconds(self, clock) -> Optional[int]:
        text = self.safe_str(clock, default="")
        if not text or ":" not in text:
            return None
        mins, secs = text.split(":", 1)
        mins_value = self.safe_int(mins)
        secs_value = self.safe_int(secs)
        if mins_value is None or secs_value is None:
            return None
        return (mins_value * 60) + secs_value

    def _begin_batch(self, requested_seasons, source_checksum, event_count):
        season_values = sorted({int(s) for s in (requested_seasons or [])})
        if season_values:
            source_version = f"{season_values[0]}-{season_values[-1]}"
        else:
            source_version = "all"

        metadata = json.dumps(
            {
                "status": "started",
                "ingest_tool": "django.import_espn_probabilities",
                "target_table": "raw.raw_espn_probabilities",
                "event_count": event_count,
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
                    "espn",
                    "probabilities",
                    "raw.raw_espn_summary",
                    "summary_payload.winprobability",
                    source_version,
                    source_checksum,
                    metadata,
                ),
            )
            return cursor.fetchone()[0]

    def _complete_batch(
        self,
        batch_id,
        row_count,
        status,
        error,
        processed_events,
        events_with_timeline,
    ):
        metadata_patch = {
            "status": status,
            "processed_rows": row_count,
            "processed_events": processed_events,
            "events_with_timeline": events_with_timeline,
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

    def _build_checksum(self, summaries):
        digest = hashlib.sha256()
        for row in summaries:
            digest.update(str(row.get("espn_event_id") or "").encode("utf-8"))
            digest.update(str(row.get("season") or "").encode("utf-8"))
            digest.update(str(row.get("week") or "").encode("utf-8"))
            payload = self._coerce_payload(row.get("summary_payload"))
            timeline = payload.get("winprobability") or []
            digest.update(str(len(timeline)).encode("utf-8"))
        return digest.hexdigest()

    def _coerce_payload(self, payload):
        if isinstance(payload, dict):
            return payload
        if isinstance(payload, str):
            try:
                parsed = json.loads(payload)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                return {}
        return {}
