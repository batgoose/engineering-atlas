"""
Import individual plays from raw nflverse play-by-play data.

Primary source is `raw.raw_nflverse_pbp` (full payload JSON). If that table is
missing, this command falls back to the legacy `plays` projection.

Strategy: Delete existing plays for the season, then bulk_create.
This is much faster than update_or_create for 50k+ rows per season.

Populates: Play
Requires: Games and Teams already imported.

Usage:
    python manage.py import_plays
    python manage.py import_plays --season 2024 --batch-size 10000
"""

import json

from django.core.management.base import CommandError
from django.db import transaction
from django.utils.dateparse import parse_datetime

from gridstream.models import Drive, Game, Play, Team

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}


class Command(ImportBaseCommand):
    help = "Import plays from raw nflverse play-by-play data."
    RAW_SOURCE_TABLE = "raw.raw_nflverse_pbp"
    LEGACY_SOURCE_TABLE = "plays"

    def handle(self, *args, **options):
        self.batch_size = options["batch_size"]
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        source_mode = self._resolve_source_mode()
        source_label = (
            self.RAW_SOURCE_TABLE if source_mode == "raw" else self.LEGACY_SOURCE_TABLE
        )

        self.team_cache = {t.abbreviation: t for t in Team.objects.using("nfl").all()}
        for old, new in TEAM_ABBR_MAP.items():
            if new in self.team_cache and old not in self.team_cache:
                self.team_cache[old] = self.team_cache[new]

        self.game_cache = {
            g.nflverse_game_id: g for g in Game.objects.using("nfl").all()
        }

        # Cache drives for FK linking: (game_id, drive_number) -> Drive
        self.drive_cache = {}
        for d in Drive.objects.using("nfl").select_related("game").all():
            if d.game and d.game.nflverse_game_id:
                self.drive_cache[(d.game.nflverse_game_id, d.drive_number)] = d

        seasons = self._resolve_source_seasons(requested, source_mode)

        self.stdout.write(
            f"Importing plays for {len(seasons)} seasons from {source_label}"
        )

        total_created = 0

        for year in seasons:
            self.log_season_header(year)
            self._score_state_by_game_id = {}

            # Count
            row_count = self._count_source_rows(year, source_mode)

            self.stdout.write(f"  {row_count:,} plays in source table")

            if self.dry_run:
                total_created += row_count
                continue

            # Delete existing plays for this season's games
            game_ids = [
                gid
                for gid, g in self.game_cache.items()
                if g.season and g.season.year == year
            ]
            if game_ids:
                with self.timed_operation(f"Deleting existing plays for {year}"):
                    Play.objects.using("nfl").filter(
                        game__nflverse_game_id__in=game_ids
                    ).delete()

            # Stream and bulk create
            created = 0
            batch = []
            progress = 0

            with self.timed_operation(f"Importing {row_count:,} plays for {year}"):
                for row in self._iter_source_rows(year, source_mode):
                    play = self._build_play(row)
                    if play:
                        self._clamp_scores_to_game_progress(play)
                        batch.append(play)

                    if len(batch) >= self.batch_size:
                        with transaction.atomic(using="nfl"):
                            Play.objects.using("nfl").bulk_create(batch)
                        created += len(batch)
                        batch = []

                    progress += 1
                    if progress % 50000 == 0:
                        self.stdout.write(f"    ... {progress:,} / {row_count:,}")

                if batch:
                    with transaction.atomic(using="nfl"):
                        Play.objects.using("nfl").bulk_create(batch)
                    created += len(batch)

            self.stdout.write(f"  Plays created: {created:,}")
            reconciled = self._reconcile_last_play_scores_to_game_final(year)
            if reconciled:
                self.stdout.write(
                    f"  Final-score reconciliations applied: {reconciled:,}"
                )
            total_created += created

        self.stdout.write(
            self.style.SUCCESS(f"\nDone! {total_created:,} plays imported.")
        )

    def _resolve_source_mode(self):
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                "SELECT to_regclass('raw.raw_nflverse_pbp'), to_regclass('plays')"
            )
            raw_table, legacy_table = cursor.fetchone()

        if raw_table:
            return "raw"
        if legacy_table:
            return "legacy"

        raise CommandError(
            "No source table found. Expected raw.raw_nflverse_pbp or plays."
        )

    def _resolve_source_seasons(self, requested, source_mode):
        if source_mode == "raw":
            with self.get_nfl_cursor() as cursor:
                cursor.execute(
                    "SELECT DISTINCT season FROM raw.raw_nflverse_pbp "
                    "WHERE season IS NOT NULL ORDER BY season"
                )
                available = [r[0] for r in cursor.fetchall()]
            if requested:
                missing = set(requested) - set(available)
                if missing:
                    self.stderr.write(
                        self.style.WARNING(
                            f"Not in {self.RAW_SOURCE_TABLE}: {sorted(missing)}"
                        )
                    )
                return sorted(set(requested) & set(available))
            return available

        return self.resolve_seasons(requested, table=self.LEGACY_SOURCE_TABLE)

    def _count_source_rows(self, season, source_mode):
        with self.get_nfl_cursor() as cursor:
            if source_mode == "raw":
                cursor.execute(
                    """
                    SELECT COUNT(*)
                    FROM raw.raw_nflverse_pbp
                    WHERE season = %s
                        AND game_id IS NOT NULL
                        AND game_id <> ''
                        AND COALESCE(NULLIF(payload->>'play_id', ''), NULLIF(play_id, '')) IS NOT NULL
                    """,
                    [season],
                )
            else:
                sw = self.season_where(self.LEGACY_SOURCE_TABLE)
                cursor.execute(
                    f"SELECT COUNT(*) FROM {self.LEGACY_SOURCE_TABLE} WHERE {sw}",
                    [season],
                )
            return cursor.fetchone()[0]

    def _iter_source_rows(self, season, source_mode):
        if source_mode == "raw":
            sql = """
                SELECT
                    game_id,
                    COALESCE(NULLIF(payload->>'play_id', ''), NULLIF(play_id, '')) AS play_id,
                    posteam,
                    defteam,
                    payload
                FROM raw.raw_nflverse_pbp
                WHERE season = %s
                    AND game_id IS NOT NULL
                    AND game_id <> ''
                    AND COALESCE(NULLIF(payload->>'play_id', ''), NULLIF(play_id, '')) IS NOT NULL
                ORDER BY
                    game_id,
                    CASE
                        WHEN COALESCE(NULLIF(payload->>'play_id', ''), NULLIF(play_id, ''))
                            ~ '^-?[0-9]+(\\.[0-9]+)?$'
                        THEN COALESCE(NULLIF(payload->>'play_id', ''), NULLIF(play_id, ''))::double precision
                        ELSE NULL
                    END,
                    COALESCE(NULLIF(payload->>'play_id', ''), NULLIF(play_id, ''))
            """
        else:
            sw = self.season_where(self.LEGACY_SOURCE_TABLE)
            sql = (
                f"SELECT * FROM {self.LEGACY_SOURCE_TABLE} WHERE {sw} "
                "ORDER BY game_id, play_id"
            )

        with self.get_nfl_cursor() as cursor:
            cursor.execute(sql, [season])
            col_names = [d[0] for d in cursor.description]

            while True:
                rows = cursor.fetchmany(self.batch_size)
                if not rows:
                    break
                for raw_row in rows:
                    yield dict(zip(col_names, raw_row))

    def _row_value(self, row, key, default=None):
        value = row.get(key)
        if value not in (None, ""):
            return value

        payload = row.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
                row["payload"] = payload
            except json.JSONDecodeError:
                payload = None
        if isinstance(payload, dict):
            payload_value = payload.get(key)
            if payload_value not in (None, ""):
                return payload_value

        return default

    def _build_play(self, row):
        game_id_str = self.safe_str(self._row_value(row, "game_id", ""))
        game = self.game_cache.get(game_id_str)
        if not game:
            return None

        play_id = self.safe_int(self._row_value(row, "play_id"))
        if play_id is None:
            return None

        posteam_abbr = self.safe_str(self._row_value(row, "posteam", ""))
        defteam_abbr = self.safe_str(self._row_value(row, "defteam", ""))
        possession_team = self.team_cache.get(posteam_abbr) or self.team_cache.get(
            TEAM_ABBR_MAP.get(posteam_abbr, "")
        )
        defensive_team = self.team_cache.get(defteam_abbr) or self.team_cache.get(
            TEAM_ABBR_MAP.get(defteam_abbr, "")
        )

        # Drive link
        drive_num = self.safe_int(self._row_value(row, "drive"))
        drive = self.drive_cache.get((game_id_str, drive_num)) if drive_num else None
        home_score_after, away_score_after = self._resolve_play_scores_after(
            row=row,
            game=game,
            posteam_abbr=posteam_abbr,
            defteam_abbr=defteam_abbr,
        )

        # Clock display
        qtr_secs = self.safe_int(
            self._row_value(row, "quarter_seconds_remaining"), None
        )
        clock_display = (
            f"{qtr_secs // 60}:{qtr_secs % 60:02d}" if qtr_secs is not None else ""
        )

        down = self.safe_int(self._row_value(row, "down"))
        distance = self.safe_int(self._row_value(row, "ydstogo"))
        down_distance_text = self.safe_str(
            self._row_value(row, "down_distance_text", "")
        )
        if not down_distance_text and down and distance is not None:
            suffix = (
                "th" if down not in (1, 2, 3) else {1: "st", 2: "nd", 3: "rd"}[down]
            )
            down_distance_text = f"{down}{suffix} & {max(0, distance)}"

        # Play type normalization
        play_type = self.safe_str(self._row_value(row, "play_type", ""))
        pass_location = self.safe_str(self._row_value(row, "pass_location", "")).lower()
        if pass_location not in {"left", "middle", "right"}:
            pass_location = ""
        run_location = self.safe_str(self._row_value(row, "run_location", "")).lower()
        if run_location not in {"left", "middle", "right"}:
            run_location = ""
        run_gap = self.safe_str(self._row_value(row, "run_gap", "")).lower()
        if run_gap not in {"guard", "tackle", "end"}:
            run_gap = ""
        description = self.safe_str(
            self._row_value(
                row,
                "desc",
                self._row_value(
                    row,
                    "description",
                    self._row_value(row, "play_description", ""),
                ),
            ),
        )
        short_description = self.safe_str(
            self._row_value(
                row,
                "short_description",
                self._row_value(row, "short_desc", description),
            ),
            default=description,
        )
        if len(short_description) > 200:
            short_description = short_description[:197].rstrip() + "..."

        timeout_team = self.safe_str(self._row_value(row, "timeout_team", ""))
        timeout_team = self._normalize_team_abbr(timeout_team) if timeout_team else ""

        penalty_team = self.safe_str(self._row_value(row, "penalty_team", ""))
        penalty_team = self._normalize_team_abbr(penalty_team) if penalty_team else ""

        return_team = self.safe_str(self._row_value(row, "return_team", ""))
        return_team = self._normalize_team_abbr(return_team) if return_team else ""

        wall_clock_raw = self.safe_str(
            self._row_value(
                row,
                "time_of_day",
                self._row_value(row, "end_clock_time", ""),
            )
        )
        wall_clock = parse_datetime(wall_clock_raw) if wall_clock_raw else None

        return Play(
            game=game,
            drive=drive,
            nflverse_play_id=float(play_id),
            sequence=play_id,  # play_id is already int (cast from double)
            # Situation
            quarter=self.safe_int(self._row_value(row, "qtr")),
            clock=clock_display,
            game_seconds_remaining=self.safe_int(
                self._row_value(row, "game_seconds_remaining")
            ),
            half_seconds_remaining=self.safe_int(
                self._row_value(row, "half_seconds_remaining")
            ),
            quarter_seconds_remaining=qtr_secs,
            down=down,
            distance=distance,
            yard_line=self.safe_int(self._row_value(row, "yardline_100")),
            side_of_field=self.safe_str(self._row_value(row, "side_of_field", "")),
            down_distance_text=down_distance_text,
            # Teams
            possession_team=possession_team,
            defensive_team=defensive_team,
            # Play info
            play_type=play_type,
            description=description,
            short_description=short_description,
            yards_gained=self.safe_float(self._row_value(row, "yards_gained")),
            is_scoring_play=self.safe_bool(
                self._row_value(
                    row,
                    "is_scoring_play",
                    self._row_value(
                        row,
                        "score_play",
                        self._row_value(row, "sp"),
                    ),
                )
            ),
            # Flags (stored as real 0/1 in the raw table)
            touchdown=self.safe_bool(self._row_value(row, "touchdown")),
            interception=self.safe_bool(self._row_value(row, "interception")),
            fumble=self.safe_bool(self._row_value(row, "fumble")),
            fumble_lost=self.safe_bool(self._row_value(row, "fumble_lost")),
            sack=self.safe_bool(self._row_value(row, "sack")),
            penalty=self.safe_bool(self._row_value(row, "penalty")),
            complete_pass=self.safe_bool(self._row_value(row, "complete_pass")),
            first_down=self.safe_bool(self._row_value(row, "first_down")),
            timeout=self.safe_bool(self._row_value(row, "timeout")),
            timeout_team=timeout_team,
            home_timeouts_remaining=self.safe_int(
                self._row_value(row, "home_timeouts_remaining")
            ),
            away_timeouts_remaining=self.safe_int(
                self._row_value(row, "away_timeouts_remaining")
            ),
            pass_attempt=self.safe_bool(self._row_value(row, "pass_attempt")),
            rush_attempt=self.safe_bool(self._row_value(row, "rush_attempt")),
            kickoff_attempt=self.safe_bool(self._row_value(row, "kickoff_attempt")),
            punt_attempt=self.safe_bool(self._row_value(row, "punt_attempt")),
            extra_point_attempt=self.safe_bool(
                self._row_value(row, "extra_point_attempt")
            ),
            two_point_attempt=self.safe_bool(self._row_value(row, "two_point_attempt")),
            special_teams_play=self.safe_bool(
                self._row_value(row, "special_teams_play")
            ),
            st_play_type=self.safe_str(self._row_value(row, "st_play_type", "")),
            touchback=self.safe_bool(self._row_value(row, "touchback")),
            out_of_bounds=self.safe_bool(self._row_value(row, "out_of_bounds")),
            punt_inside_twenty=self.safe_bool(
                self._row_value(row, "punt_inside_twenty")
            ),
            punt_fair_catch=self.safe_bool(self._row_value(row, "punt_fair_catch")),
            kickoff_fair_catch=self.safe_bool(
                self._row_value(row, "kickoff_fair_catch")
            ),
            kickoff_in_endzone=self.safe_bool(
                self._row_value(row, "kickoff_in_endzone")
            ),
            return_yards=self.safe_int(self._row_value(row, "return_yards")),
            return_team=return_team,
            # Score after this play
            home_score_after=home_score_after,
            away_score_after=away_score_after,
            # End state
            end_down=self.safe_int(self._row_value(row, "end_down")),
            end_distance=self.safe_int(self._row_value(row, "end_distance")),
            end_yard_line=self.safe_int(self._row_value(row, "end_yard_line")),
            # Formation
            shotgun=self.safe_bool(self._row_value(row, "shotgun")),
            no_huddle=self.safe_bool(self._row_value(row, "no_huddle")),
            qb_dropback=self.safe_bool(self._row_value(row, "qb_dropback")),
            qb_scramble=self.safe_bool(self._row_value(row, "qb_scramble")),
            # Pass detail
            air_yards=self.safe_float(self._row_value(row, "air_yards")),
            yards_after_catch=self.safe_float(
                self._row_value(row, "yards_after_catch")
            ),
            pass_location=pass_location,
            run_location=run_location,
            run_gap=run_gap,
            # Kicking
            field_goal_result=self.safe_str(
                self._row_value(row, "field_goal_result", "")
            ),
            kick_distance=self.safe_float(self._row_value(row, "kick_distance")),
            # Penalty detail
            penalty_type=self.safe_str(self._row_value(row, "penalty_type", "")),
            penalty_yards=self.safe_int(self._row_value(row, "penalty_yards")),
            penalty_player_name=self.safe_str(
                self._row_value(row, "penalty_player_name", "")
            ),
            penalty_player_id=self.safe_str(
                self._row_value(row, "penalty_player_id", "")
            ),
            penalty_team=penalty_team,
            # Player references
            passer_player_id=self.safe_str(
                self._row_value(row, "passer_player_id", "")
            ),
            passer_player_name=self.safe_str(
                self._row_value(row, "passer_player_name", "")
            ),
            rusher_player_id=self.safe_str(
                self._row_value(row, "rusher_player_id", "")
            ),
            rusher_player_name=self.safe_str(
                self._row_value(row, "rusher_player_name", "")
            ),
            receiver_player_id=self.safe_str(
                self._row_value(row, "receiver_player_id", "")
            ),
            receiver_player_name=self.safe_str(
                self._row_value(row, "receiver_player_name", "")
            ),
            punt_returner_player_name=self.safe_str(
                self._row_value(row, "punt_returner_player_name", "")
            ),
            punt_returner_player_id=self.safe_str(
                self._row_value(row, "punt_returner_player_id", "")
            ),
            kickoff_returner_player_name=self.safe_str(
                self._row_value(row, "kickoff_returner_player_name", "")
            ),
            kickoff_returner_player_id=self.safe_str(
                self._row_value(row, "kickoff_returner_player_id", "")
            ),
            blocked_player_name=self.safe_str(
                self._row_value(row, "blocked_player_name", "")
            ),
            blocked_player_id=self.safe_str(
                self._row_value(row, "blocked_player_id", "")
            ),
            interception_player_name=self.safe_str(
                self._row_value(row, "interception_player_name", "")
            ),
            interception_player_id=self.safe_str(
                self._row_value(row, "interception_player_id", "")
            ),
            fumble_recovery_1_player_name=self.safe_str(
                self._row_value(row, "fumble_recovery_1_player_name", "")
            ),
            fumble_recovery_1_team=self.safe_str(
                self._row_value(row, "fumble_recovery_1_team", "")
            ),
            fumble_recovery_1_yards=self.safe_int(
                self._row_value(row, "fumble_recovery_1_yards")
            ),
            sack_player_name=self.safe_str(
                self._row_value(row, "sack_player_name", "")
            ),
            sack_player_id=self.safe_str(self._row_value(row, "sack_player_id", "")),
            tackle_for_loss_1_player_name=self.safe_str(
                self._row_value(row, "tackle_for_loss_1_player_name", "")
            ),
            pass_defense_1_player_name=self.safe_str(
                self._row_value(row, "pass_defense_1_player_name", "")
            ),
            # Analytics
            epa=self.safe_float(self._row_value(row, "epa")),
            total_home_epa=self.safe_float(self._row_value(row, "total_home_epa")),
            total_away_epa=self.safe_float(self._row_value(row, "total_away_epa")),
            wpa=self.safe_float(self._row_value(row, "wpa")),
            success=self.safe_float(self._row_value(row, "success")),
            home_wp=self.safe_float(self._row_value(row, "home_wp")),
            away_wp=self.safe_float(self._row_value(row, "away_wp")),
            vegas_wp=self.safe_float(self._row_value(row, "vegas_wp")),
            vegas_home_wp=self.safe_float(self._row_value(row, "vegas_home_wp")),
            ep=self.safe_float(self._row_value(row, "ep")),
            cp=self.safe_float(self._row_value(row, "cp")),
            cpoe=self.safe_float(self._row_value(row, "cpoe")),
            td_prob=self.safe_float(self._row_value(row, "td_prob")),
            fg_prob=self.safe_float(self._row_value(row, "fg_prob")),
            no_score_prob=self.safe_float(self._row_value(row, "no_score_prob")),
            score_differential=self.safe_int(
                self._row_value(row, "score_differential")
            ),
            drive_start_transition=self.safe_str(
                self._row_value(row, "drive_start_transition", "")
            ),
            drive_end_transition=self.safe_str(
                self._row_value(row, "drive_end_transition", "")
            ),
            drive_yards_penalized=self.safe_int(
                self._row_value(row, "drive_yards_penalized")
            ),
            series_result=self.safe_str(self._row_value(row, "series_result", "")),
            wall_clock=wall_clock,
        )

    def _normalize_team_abbr(self, abbr):
        normalized = self.safe_str(abbr, "")
        return TEAM_ABBR_MAP.get(normalized, normalized)

    def _resolve_play_scores_after(self, row, game, posteam_abbr, defteam_abbr):
        total_home_score = self.safe_int(self._row_value(row, "total_home_score"))
        total_away_score = self.safe_int(self._row_value(row, "total_away_score"))
        if total_home_score is not None and total_away_score is not None:
            return total_home_score, total_away_score

        posteam_score_post = self.safe_int(self._row_value(row, "posteam_score_post"))
        defteam_score_post = self.safe_int(self._row_value(row, "defteam_score_post"))
        if posteam_score_post is not None and defteam_score_post is not None:
            home_abbr = self._normalize_team_abbr(game.home_team.abbreviation)
            away_abbr = self._normalize_team_abbr(game.away_team.abbreviation)
            posteam_norm = self._normalize_team_abbr(posteam_abbr)
            defteam_norm = self._normalize_team_abbr(defteam_abbr)

            if posteam_norm == home_abbr and defteam_norm == away_abbr:
                return posteam_score_post, defteam_score_post
            if posteam_norm == away_abbr and defteam_norm == home_abbr:
                return defteam_score_post, posteam_score_post
            if posteam_norm == home_abbr:
                return posteam_score_post, defteam_score_post
            if posteam_norm == away_abbr:
                return defteam_score_post, posteam_score_post
            if defteam_norm == home_abbr:
                return defteam_score_post, posteam_score_post
            if defteam_norm == away_abbr:
                return posteam_score_post, defteam_score_post

        return total_home_score or 0, total_away_score or 0

    def _clamp_scores_to_game_progress(self, play):
        game_id = play.game_id
        prev_home, prev_away = self._score_state_by_game_id.get(game_id, (0, 0))
        max_home = self.safe_int(play.game.home_score, 0) or 0
        max_away = self.safe_int(play.game.away_score, 0) or 0

        home_after = self.safe_int(play.home_score_after, 0) or 0
        away_after = self.safe_int(play.away_score_after, 0) or 0

        home_after = min(max(home_after, prev_home), max_home)
        away_after = min(max(away_after, prev_away), max_away)

        play.home_score_after = home_after
        play.away_score_after = away_after
        self._score_state_by_game_id[game_id] = (home_after, away_after)

    def _reconcile_last_play_scores_to_game_final(self, season):
        with self.get_nfl_cursor() as cursor:
            cursor.execute(
                """
                WITH last_play AS (
                    SELECT DISTINCT ON (p.game_id)
                        p.id AS play_id,
                        p.game_id,
                        p.away_score_after,
                        p.home_score_after
                    FROM gridstream_play p
                    JOIN gridstream_game g ON g.id = p.game_id
                    WHERE g.season_id = %s
                    ORDER BY p.game_id, p.sequence DESC
                ),
                mismatches AS (
                    SELECT lp.play_id, g.away_score, g.home_score
                    FROM last_play lp
                    JOIN gridstream_game g ON g.id = lp.game_id
                    WHERE g.status IN ('final', 'final_ot')
                      AND (
                          COALESCE(lp.away_score_after, 0) <> COALESCE(g.away_score, 0)
                          OR COALESCE(lp.home_score_after, 0) <> COALESCE(g.home_score, 0)
                      )
                ),
                updated AS (
                    UPDATE gridstream_play p
                    SET
                        away_score_after = m.away_score,
                        home_score_after = m.home_score
                    FROM mismatches m
                    WHERE p.id = m.play_id
                    RETURNING p.id
                )
                SELECT COUNT(*) FROM updated
                """,
                [season],
            )
            return cursor.fetchone()[0]
