"""
Import individual plays from raw nflverse play-by-play data.

Maps the 52 available columns to the Play model. Fields that require
columns not present in our schema (desc, first_down_*, fumble_lost,
pass_location, run_location, run_gap, wp, cpoe, etc.) are left null.

Strategy: Delete existing plays for the season, then bulk_create.
This is much faster than update_or_create for 50k+ rows per season.

Populates: Play
Requires: Games and Teams already imported.

Usage:
    python manage.py import_plays
    python manage.py import_plays --season 2024 --batch-size 10000
"""

from django.db import transaction

from gridstream.models import Drive, Game, Play, Team

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}


class Command(ImportBaseCommand):
    help = "Import plays from raw nflverse play-by-play data."

    def handle(self, *args, **options):
        self.batch_size = options["batch_size"]
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        if not self.raw_table_exists("plays"):
            self.stderr.write(self.style.ERROR("No 'plays' table found."))
            return

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

        seasons = self.resolve_seasons(requested)
        sw = self.season_where()

        self.stdout.write(f"Importing plays for {len(seasons)} seasons")

        total_created = 0

        for year in seasons:
            self.log_season_header(year)

            # Count
            with self.get_nfl_cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM plays WHERE {sw}", [year])
                row_count = cursor.fetchone()[0]

            self.stdout.write(f"  {row_count:,} plays in raw table")

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
                with self.get_nfl_cursor() as cursor:
                    cursor.execute(
                        f"SELECT * FROM plays WHERE {sw} ORDER BY game_id, play_id",
                        [year],
                    )
                    col_names = [d[0] for d in cursor.description]

                    while True:
                        rows = cursor.fetchmany(self.batch_size)
                        if not rows:
                            break
                        for raw_row in rows:
                            row = dict(zip(col_names, raw_row))
                            play = self._build_play(row)
                            if play:
                                batch.append(play)

                            if len(batch) >= self.batch_size:
                                with transaction.atomic(using="nfl"):
                                    Play.objects.using("nfl").bulk_create(batch)
                                created += len(batch)
                                batch = []

                            progress += 1
                            if progress % 50000 == 0:
                                self.stdout.write(
                                    f"    ... {progress:,} / {row_count:,}"
                                )

                    if batch:
                        with transaction.atomic(using="nfl"):
                            Play.objects.using("nfl").bulk_create(batch)
                        created += len(batch)

            self.stdout.write(f"  Plays created: {created:,}")
            total_created += created

        self.stdout.write(
            self.style.SUCCESS(f"\nDone! {total_created:,} plays imported.")
        )

    def _build_play(self, row):
        game_id_str = row.get("game_id", "")
        game = self.game_cache.get(game_id_str)
        if not game:
            return None

        play_id = self.safe_int(row.get("play_id"))
        if play_id is None:
            return None

        posteam_abbr = self.safe_str(row.get("posteam", ""))
        defteam_abbr = self.safe_str(row.get("defteam", ""))
        possession_team = self.team_cache.get(posteam_abbr) or self.team_cache.get(
            TEAM_ABBR_MAP.get(posteam_abbr, "")
        )
        defensive_team = self.team_cache.get(defteam_abbr) or self.team_cache.get(
            TEAM_ABBR_MAP.get(defteam_abbr, "")
        )

        # Drive link
        drive_num = self.safe_int(row.get("drive"))
        drive = self.drive_cache.get((game_id_str, drive_num)) if drive_num else None

        # Clock display
        qtr_secs = self.safe_int(row.get("quarter_seconds_remaining"), 0)
        clock_display = f"{qtr_secs // 60}:{qtr_secs % 60:02d}" if qtr_secs else ""

        # Play type normalization
        play_type = self.safe_str(row.get("play_type", ""))

        return Play(
            game=game,
            drive=drive,
            nflverse_play_id=float(play_id),
            sequence=play_id,  # play_id is already int (cast from double)
            # Situation
            quarter=self.safe_int(row.get("qtr")),
            clock=clock_display,
            game_seconds_remaining=self.safe_int(row.get("game_seconds_remaining")),
            half_seconds_remaining=self.safe_int(row.get("half_seconds_remaining")),
            quarter_seconds_remaining=qtr_secs,
            down=self.safe_int(row.get("down")),
            distance=self.safe_int(row.get("ydstogo")),
            yard_line=self.safe_int(row.get("yardline_100")),
            side_of_field=self.safe_str(row.get("side_of_field", "")),
            # Teams
            possession_team=possession_team,
            defensive_team=defensive_team,
            # Play info
            play_type=play_type,
            yards_gained=self.safe_float(row.get("yards_gained")),
            # Flags (stored as real 0/1 in the raw table)
            touchdown=self.safe_bool(row.get("touchdown")),
            interception=self.safe_bool(row.get("interception")),
            fumble=self.safe_bool(row.get("fumble")),
            sack=self.safe_bool(row.get("sack")),
            penalty=self.safe_bool(row.get("penalty")),
            complete_pass=self.safe_bool(row.get("complete_pass")),
            # Formation
            shotgun=self.safe_bool(row.get("shotgun")),
            no_huddle=self.safe_bool(row.get("no_huddle")),
            # Pass detail
            air_yards=self.safe_float(row.get("air_yards")),
            yards_after_catch=self.safe_float(row.get("yards_after_catch")),
            # Kicking
            field_goal_result=self.safe_str(row.get("field_goal_result", "")),
            kick_distance=self.safe_float(row.get("kick_distance")),
            # Penalty detail
            penalty_type=self.safe_str(row.get("penalty_type", "")),
            penalty_yards=self.safe_int(row.get("penalty_yards")),
            # Player references
            passer_player_id=self.safe_str(row.get("passer_player_id", "")),
            passer_player_name=self.safe_str(row.get("passer_player_name", "")),
            rusher_player_id=self.safe_str(row.get("rusher_player_id", "")),
            rusher_player_name=self.safe_str(row.get("rusher_player_name", "")),
            receiver_player_id=self.safe_str(row.get("receiver_player_id", "")),
            receiver_player_name=self.safe_str(row.get("receiver_player_name", "")),
            # Analytics
            epa=self.safe_float(row.get("epa")),
            wpa=self.safe_float(row.get("wpa")),
            success=self.safe_float(row.get("success")),
        )
