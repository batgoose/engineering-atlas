"""
Import authoritative nflverse games dataset into Gridstream Game records.

Source dataset:
    https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv

This command replaces the old PBP group-by derivation with nflverse's
schedule/results source of truth, including ESPN IDs, division flag,
coach/QB metadata, rest days, referee, and closing lines.

Usage:
    python manage.py import_games
    python manage.py import_games --season 2024
    python manage.py import_games --dry-run
"""

import csv
import hashlib
import io
from datetime import datetime

import requests
from django.core.management.base import CommandError
from django.db import transaction

from gridstream.models import Game, Season, Team, Venue
from gridstream.venue_metadata import infer_is_indoor, infer_roof_type, map_roof_type

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}
ESPN_EVENT_ID_OVERRIDES = {
    # nflverse games.csv carries an ESPN typo for the 1999 WC BUF@TEN game.
    "1999_18_BUF_TEN": "200108010",
}
SOURCE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
SOURCE_FILE = "games.csv"
POSTSEASON_GAME_TYPES = {"WC", "DIV", "CON", "SB"}
GAME_TYPE_NOTE_MAP = {
    "WC": "Wild Card",
    "DIV": "Divisional",
    "CON": "Conference Championship",
    "SB": "Super Bowl",
}


class Command(ImportBaseCommand):
    help = "Import games from authoritative nflverse games.csv dataset."

    def handle(self, *args, **options):
        self.batch_size = max(1, options["batch_size"])
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        self._ensure_prerequisites()
        self.team_cache = self._build_team_cache()

        with self.timed_operation(f"Downloading {SOURCE_FILE}"):
            content, _checksum = self._download_source()

        all_rows = self._parse_rows(content)
        seasons_in_file = sorted({r["season"] for r in all_rows if r.get("season")})
        target_seasons = self._resolve_target_seasons(requested, seasons_in_file)
        if not target_seasons:
            self.stdout.write(
                self.style.WARNING("No seasons selected; nothing to import.")
            )
            return

        target_set = set(target_seasons)
        rows = [row for row in all_rows if row.get("season") in target_set]
        rows.sort(
            key=lambda r: (
                r.get("season") or 0,
                r.get("week") or 0,
                r.get("nflverse_game_id") or "",
            )
        )

        self.stdout.write(
            f"Importing games for {len(target_seasons)} seasons: "
            f"{target_seasons[0]}-{target_seasons[-1]} ({len(rows):,} rows)"
        )

        if self.dry_run:
            for row in rows[: min(5, len(rows))]:
                self.stdout.write(
                    "  [DRY RUN] "
                    f"{row['nflverse_game_id']} "
                    f"{row['away_team']}@{row['home_team']} "
                    f"wk{row.get('week')}"
                )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Dry run complete. Would process {len(rows):,} game rows."
                )
            )
            return

        for year in target_seasons:
            Season.objects.using("nfl").get_or_create(
                year=year, defaults={"is_active": False}
            )

        created = 0
        updated = 0
        merged = 0
        skipped = 0

        with self.timed_operation("Writing game rows"):
            with transaction.atomic(using="nfl"):
                for row in rows:
                    action = self._upsert_game(row)
                    if action == "created":
                        created += 1
                    elif action == "updated":
                        updated += 1
                    elif action == "merged":
                        merged += 1
                    else:
                        skipped += 1

        self.stdout.write(
            self.style.SUCCESS(
                "Done! "
                f"{created:,} created, {updated:,} updated, {merged:,} merged duplicates, "
                f"{skipped:,} skipped."
            )
        )

    # ------------------------------------------------------------------
    # Core ingest logic
    # ------------------------------------------------------------------

    def _upsert_game(self, row):
        nflverse_game_id = row["nflverse_game_id"]
        espn_event_id = row["espn_event_id"]
        home_team = self.team_cache.get(row["home_team"])
        away_team = self.team_cache.get(row["away_team"])

        if not home_team or not away_team:
            self.stdout.write(
                self.style.WARNING(
                    f"  [skip] Unknown team(s) for {nflverse_game_id}: "
                    f"{row['away_team']}@{row['home_team']}"
                )
            )
            return "skipped"

        season = Season.objects.using("nfl").get(year=row["season"])
        venue = self._resolve_venue(
            stadium_id=row.get("stadium_id"),
            stadium_name=row.get("stadium_name"),
            roof=row.get("roof"),
            surface=row.get("surface"),
        )

        defaults = {
            "espn_event_id": espn_event_id,
            "nflverse_game_id": nflverse_game_id,
            "pfr_game_id": row.get("pfr_game_id") or "",
            "season": season,
            "week": row.get("week"),
            "game_date": row.get("game_date"),
            "game_time": row.get("game_time"),
            "season_type": row.get("season_type"),
            "home_team": home_team,
            "away_team": away_team,
            "venue": venue,
            "div_game": row.get("div_game", False),
            "is_division_game": row.get("is_division_game", False),
            "game_note": row.get("game_note") or "",
            "status": row.get("status"),
            "quarter": row.get("quarter"),
            "home_score": row.get("home_score") or 0,
            "away_score": row.get("away_score") or 0,
            "spread_line": row.get("spread_line"),
            "total_line": row.get("total_line"),
            "spread": row.get("spread_line"),
            "total": row.get("total_line"),
            "home_moneyline": row.get("home_moneyline"),
            "away_moneyline": row.get("away_moneyline"),
            "away_spread_odds": row.get("away_spread_odds"),
            "home_spread_odds": row.get("home_spread_odds"),
            "under_odds": row.get("under_odds"),
            "over_odds": row.get("over_odds"),
            "odds_provider": "nflverse games.csv",
            "weather_temp": row.get("temp"),
            "weather_wind": row.get("weather_wind") or "",
            "weather_detail": row.get("weather_detail") or "",
            "home_qb_name": row.get("home_qb_name") or "",
            "away_qb_name": row.get("away_qb_name") or "",
            "home_coach": row.get("home_coach") or "",
            "away_coach": row.get("away_coach") or "",
            "referee": row.get("referee") or "",
            "attendance": row.get("attendance"),
            "away_rest": row.get("away_rest"),
            "home_rest": row.get("home_rest"),
            "overtime": row.get("overtime", False),
        }

        game_by_nflverse = (
            Game.objects.using("nfl")
            .filter(nflverse_game_id=nflverse_game_id)
            .order_by("id")
            .first()
        )
        game_by_espn = (
            Game.objects.using("nfl")
            .filter(espn_event_id=espn_event_id)
            .order_by("id")
            .first()
        )

        canonical = None
        action = "updated"
        if game_by_nflverse and game_by_espn and game_by_nflverse.id != game_by_espn.id:
            canonical = self._choose_canonical_game(game_by_nflverse, game_by_espn)
            duplicate = (
                game_by_espn
                if canonical.id == game_by_nflverse.id
                else game_by_nflverse
            )
            self._relink_game_foreign_keys(
                from_game_id=duplicate.id, to_game_id=canonical.id
            )
            duplicate.delete(using="nfl")
            action = "merged"
        elif game_by_nflverse:
            canonical = game_by_nflverse
        elif game_by_espn:
            canonical = game_by_espn
        else:
            canonical = Game.objects.using("nfl").create(**defaults)
            return "created"

        for key, value in defaults.items():
            setattr(canonical, key, value)
        canonical.save(using="nfl")
        return action

    def _choose_canonical_game(self, game_a: Game, game_b: Game) -> Game:
        """Prefer record already carrying nflverse_game_id and richer child data."""
        if game_a.nflverse_game_id and not game_b.nflverse_game_id:
            return game_a
        if game_b.nflverse_game_id and not game_a.nflverse_game_id:
            return game_b

        a_play_count = game_a.plays.count()
        b_play_count = game_b.plays.count()
        if a_play_count != b_play_count:
            return game_a if a_play_count > b_play_count else game_b
        return game_a if game_a.id < game_b.id else game_b

    def _relink_game_foreign_keys(self, from_game_id: int, to_game_id: int):
        """Move all FK references from duplicate Game row to canonical Game row."""
        with self.get_nfl_cursor() as cursor:
            cursor.execute("""
                SELECT
                    quote_ident(ns.nspname) || '.' || quote_ident(cls.relname) AS table_name,
                    quote_ident(att.attname) AS column_name
                FROM pg_constraint con
                JOIN pg_class cls ON cls.oid = con.conrelid
                JOIN pg_namespace ns ON ns.oid = cls.relnamespace
                JOIN unnest(con.conkey) AS c(attnum) ON TRUE
                JOIN pg_attribute att
                    ON att.attrelid = cls.oid
                    AND att.attnum = c.attnum
                WHERE con.contype = 'f'
                    AND con.confrelid = 'gridstream_game'::regclass
                ORDER BY table_name, column_name
                """)
            fk_targets = cursor.fetchall()

        with self.get_nfl_cursor() as cursor:
            for table_name, column_name in fk_targets:
                cursor.execute(
                    f"UPDATE {table_name} SET {column_name} = %s WHERE {column_name} = %s",
                    [to_game_id, from_game_id],
                )

    # ------------------------------------------------------------------
    # Parse and transform helpers
    # ------------------------------------------------------------------

    def _ensure_prerequisites(self):
        team_count = Team.objects.using("nfl").count()
        if team_count == 0:
            raise CommandError(
                "No teams found. Run `python manage.py seed_teams` first."
            )

    def _build_team_cache(self):
        cache = {t.abbreviation: t for t in Team.objects.using("nfl").all()}
        for old_abbr, new_abbr in TEAM_ABBR_MAP.items():
            if new_abbr in cache and old_abbr not in cache:
                cache[old_abbr] = cache[new_abbr]
        return cache

    def _download_source(self):
        response = requests.get(
            SOURCE_URL,
            timeout=180,
            headers={"User-Agent": "engineering-atlas/import_games"},
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
            week = self.safe_int(row.get("week"))
            game_id = self.safe_str(row.get("game_id"), default="")
            home_team = self._canonical_team(row.get("home_team"))
            away_team = self._canonical_team(row.get("away_team"))
            game_date = self._parse_date(row.get("gameday"))

            if (
                season is None
                or not game_id
                or not home_team
                or not away_team
                or not game_date
            ):
                continue

            game_type = self.safe_str(row.get("game_type"), default="REG").upper()
            overtime = self.safe_bool(row.get("overtime"))
            spread_line = self.safe_float(row.get("spread_line"))
            if spread_line is not None:
                spread_line = round(spread_line, 3)
            total_line = self.safe_float(row.get("total_line"))
            if total_line is not None:
                total_line = round(total_line, 3)

            wind_value = self.safe_str(row.get("wind"), default="")
            wind_int = self.safe_int(wind_value)
            if wind_int is not None:
                weather_wind = f"{wind_int} mph"
            else:
                weather_wind = wind_value

            roof = self.safe_str(row.get("roof"), default="")
            surface = self.safe_str(row.get("surface"), default="")
            temp = self.safe_int(row.get("temp"))
            weather_parts = []
            if roof:
                weather_parts.append(f"roof={roof}")
            if surface:
                weather_parts.append(f"surface={surface}")
            if temp is not None:
                weather_parts.append(f"temp={temp}")
            if weather_wind:
                weather_parts.append(f"wind={weather_wind}")
            weather_detail = "; ".join(weather_parts)

            rows.append(
                {
                    "nflverse_game_id": game_id,
                    "season": season,
                    "week": week,
                    "season_type": self._map_season_type(game_type),
                    "game_note": GAME_TYPE_NOTE_MAP.get(game_type, ""),
                    "game_date": game_date,
                    "game_time": self._parse_time(row.get("gametime")),
                    "home_team": home_team,
                    "away_team": away_team,
                    "home_score": self.safe_int(row.get("home_score")) or 0,
                    "away_score": self.safe_int(row.get("away_score")) or 0,
                    "status": "final_ot" if overtime else "final",
                    "quarter": 5 if overtime else 4,
                    "overtime": overtime,
                    "espn_event_id": self._build_espn_event_id(row),
                    "pfr_game_id": self.safe_str(row.get("pfr"), default=""),
                    "div_game": self.safe_bool(row.get("div_game")),
                    "is_division_game": self.safe_bool(row.get("div_game")),
                    "away_rest": self.safe_int(row.get("away_rest")),
                    "home_rest": self.safe_int(row.get("home_rest")),
                    "spread_line": spread_line,
                    "spread": spread_line,
                    "total_line": total_line,
                    "total": total_line,
                    "away_moneyline": self.safe_int(row.get("away_moneyline")),
                    "home_moneyline": self.safe_int(row.get("home_moneyline")),
                    "away_spread_odds": self.safe_int(row.get("away_spread_odds")),
                    "home_spread_odds": self.safe_int(row.get("home_spread_odds")),
                    "under_odds": self.safe_int(row.get("under_odds")),
                    "over_odds": self.safe_int(row.get("over_odds")),
                    "attendance": None,
                    "temp": temp,
                    "weather_wind": weather_wind,
                    "weather_detail": weather_detail,
                    "away_qb_name": self.safe_str(row.get("away_qb_name"), default=""),
                    "home_qb_name": self.safe_str(row.get("home_qb_name"), default=""),
                    "away_coach": self.safe_str(row.get("away_coach"), default=""),
                    "home_coach": self.safe_str(row.get("home_coach"), default=""),
                    "referee": self.safe_str(row.get("referee"), default=""),
                    "roof": roof,
                    "surface": surface,
                    "stadium_id": self.safe_str(row.get("stadium_id"), default=""),
                    "stadium_name": self.safe_str(row.get("stadium"), default=""),
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
                        f"Requested seasons not in {SOURCE_FILE}: {missing}"
                    )
                )
            return sorted(requested_set & available_set)
        return seasons_in_file

    def _resolve_venue(
        self, stadium_id: str, stadium_name: str, roof: str, surface: str
    ):
        if not stadium_name:
            return None

        mapped_roof = infer_roof_type(
            venue_name=stadium_name,
            raw_roof=roof,
        )
        defaults = {
            "name": stadium_name,
            "city": "",
            "surface": surface,
            "roof_type": mapped_roof,
            "is_indoor": infer_is_indoor(mapped_roof),
        }

        lookup_kwargs = {}
        if stadium_id:
            lookup_kwargs["espn_id"] = stadium_id
        else:
            lookup_kwargs["name"] = stadium_name

        venue, _ = Venue.objects.using("nfl").get_or_create(
            **lookup_kwargs,
            defaults=defaults,
        )

        updates = []
        if not venue.name and stadium_name:
            venue.name = stadium_name
            updates.append("name")
        if surface and venue.surface != surface:
            venue.surface = surface
            updates.append("surface")
        mapped_roof = infer_roof_type(
            venue_name=stadium_name or venue.name,
            raw_roof=roof,
            current_roof=venue.roof_type,
        )
        if venue.roof_type != mapped_roof:
            venue.roof_type = mapped_roof
            updates.append("roof_type")
        indoor_flag = infer_is_indoor(mapped_roof)
        if venue.is_indoor != indoor_flag:
            venue.is_indoor = indoor_flag
            updates.append("is_indoor")
        if updates:
            venue.save(using="nfl", update_fields=updates)
        return venue

    def _canonical_team(self, abbr):
        value = self.safe_str(abbr, default="").upper()
        if not value:
            return ""
        return TEAM_ABBR_MAP.get(value, value)

    def _parse_date(self, value):
        raw = self.safe_str(value, default="")
        if not raw:
            return None
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            return None

    def _parse_time(self, value):
        raw = self.safe_str(value, default="")
        if not raw:
            return None
        for fmt in ("%H:%M", "%H:%M:%S"):
            try:
                return datetime.strptime(raw, fmt).time()
            except ValueError:
                continue
        return None

    def _build_espn_event_id(self, row):
        game_id = self.safe_str(row.get("game_id"), default="")
        override = ESPN_EVENT_ID_OVERRIDES.get(game_id)
        if override:
            return override
        espn = self.safe_str(row.get("espn"), default="")
        if espn:
            return espn
        return f"nflv_{game_id}"

    def _map_season_type(self, game_type: str):
        if game_type == "PRE":
            return "PRE"
        if game_type in POSTSEASON_GAME_TYPES:
            return "POST"
        return "REG"

    def _map_roof(self, raw_roof):
        return map_roof_type(self.safe_str(raw_roof, default=""))

    def _is_indoor_roof(self, raw_roof):
        return infer_is_indoor(self._map_roof(raw_roof))
