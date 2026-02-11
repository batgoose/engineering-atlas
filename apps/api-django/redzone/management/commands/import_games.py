"""
Import games from raw nflverse play-by-play data.

Derives game records by aggregating distinct game_id rows from the plays
table. Since the Rust parser loaded a 52-column subset, we have:
  - game_id, home_team, away_team, game_date, season_type, week
  - stadium, weather, surface, roof
  - Scores must be derived from final-play touchdown/field_goal tallies
    (no home_score/away_score columns available)

Populates: Season, Venue, Game

Usage:
    python manage.py import_games
    python manage.py import_games --season 2024
"""

from django.db import transaction

from redzone.models import Game, Season, Team, Venue

from ._base import ImportBaseCommand

# Historical team abbreviations that changed
TEAM_ABBR_MAP = {
    "STL": "LA", "SD": "LAC", "OAK": "LV",
}


class Command(ImportBaseCommand):
    help = "Import games from raw nflverse play-by-play data."

    def handle(self, *args, **options):
        self.batch_size = options["batch_size"]
        self.dry_run = options["dry_run"]
        requested = options.get("season")

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        if not self.raw_table_exists("plays"):
            self.stderr.write(self.style.ERROR("No 'plays' table found."))
            return

        # Build caches
        self.team_cache = {t.abbreviation: t for t in Team.objects.using("nfl").all()}
        for old, new in TEAM_ABBR_MAP.items():
            if new in self.team_cache and old not in self.team_cache:
                self.team_cache[old] = self.team_cache[new]

        seasons = self.resolve_seasons(requested)
        sw = self.season_where()

        self.stdout.write(f"Importing games for {len(seasons)} seasons: {seasons[0]}–{seasons[-1]}")

        total_created = 0
        total_updated = 0

        for year in seasons:
            self.log_season_header(year)

            if not self.dry_run:
                Season.objects.using("nfl").get_or_create(year=year)

            with self.timed_operation(f"Querying games for {year}"):
                with self.get_nfl_cursor() as cursor:
                    cursor.execute(f"""
                        SELECT
                            game_id,
                            home_team,
                            away_team,
                            MIN(game_date) as game_date,
                            MAX(season_type) as season_type,
                            MAX(week) as week,
                            MAX(stadium) as stadium,
                            MAX(weather) as weather,
                            MAX(surface) as surface,
                            MAX(roof) as roof
                        FROM plays
                        WHERE {sw}
                        GROUP BY game_id, home_team, away_team
                        ORDER BY MAX(week), game_id
                    """, [year])
                    col_names = [d[0] for d in cursor.description]
                    rows = [dict(zip(col_names, r)) for r in cursor.fetchall()]

            self.stdout.write(f"  Found {len(rows)} games")

            if self.dry_run:
                total_created += len(rows)
                continue

            created = 0
            updated = 0

            with self.timed_operation(f"Writing games for {year}"):
                with transaction.atomic(using="nfl"):
                    for row in rows:
                        c, u = self._process_game(row, year)
                        created += c
                        updated += u

            self.stdout.write(f"  Games: {created} created, {updated} updated")
            total_created += created
            total_updated += updated

        self.stdout.write(
            self.style.SUCCESS(f"\nDone! {total_created} created, {total_updated} updated.")
        )

    def _process_game(self, row, season_year):
        game_id = row["game_id"]
        home_abbr = self.safe_str(row.get("home_team", ""))
        away_abbr = self.safe_str(row.get("away_team", ""))

        home_team = self.team_cache.get(home_abbr) or self.team_cache.get(
            TEAM_ABBR_MAP.get(home_abbr, "")
        )
        away_team = self.team_cache.get(away_abbr) or self.team_cache.get(
            TEAM_ABBR_MAP.get(away_abbr, "")
        )

        if not home_team or not away_team:
            self.stderr.write(
                self.style.WARNING(f"  Unknown team in {game_id}: {home_abbr} / {away_abbr}")
            )
            return 0, 0

        season = Season.objects.using("nfl").get(year=season_year)
        week = self.safe_int(row.get("week"))

        # Determine season type
        raw_type = self.safe_str(row.get("season_type", ""))
        if raw_type in ("POST", "post"):
            season_type = "POST"
        else:
            season_type = "REG"

        # Game type from season_type
        game_type = "REG"
        if season_type == "POST":
            if week and week >= 22:
                game_type = "SB"
            elif week and week >= 21:
                game_type = "CON"
            elif week and week >= 20:
                game_type = "DIV"
            else:
                game_type = "WC"

        # Venue — needs city (required field), so only create if we have a name
        venue = None
        stadium_name = self.safe_str(row.get("stadium", ""))
        if stadium_name:
            venue, _ = Venue.objects.using("nfl").get_or_create(
                name=stadium_name,
                defaults={
                    "city": "",  # unknown from PBP data
                    "roof_type": self._map_roof(self.safe_str(row.get("roof", ""))),
                    "surface": self.safe_str(row.get("surface", "")),
                },
            )

        # Date — required field. Fall back to Jan 1 of the season if missing.
        game_date = row.get("game_date")
        if not game_date:
            from datetime import date
            game_date = date(season_year, 9, 1)  # approximate start of season

        # espn_event_id is unique+required — use nflverse game_id as placeholder
        # since we don't have ESPN IDs from PBP data
        espn_placeholder = f"nflv_{game_id}"

        defaults = {
            "nflverse_game_id": game_id,
            "season": season,
            "season_type": season_type,
            "week": week,
            "home_team": home_team,
            "away_team": away_team,
            "venue": venue,
            "game_date": game_date,
            "status": "final",
        }

        # Weather parsing: nflverse weather is like "Temp: 72°F, Humidity: 65%, ..."
        weather_str = self.safe_str(row.get("weather", ""))
        if weather_str:
            defaults["weather_detail"] = weather_str
            if "Temp:" in weather_str:
                try:
                    temp_part = weather_str.split("Temp:")[1].split(",")[0].strip()
                    temp_val = int("".join(c for c in temp_part if c.isdigit() or c == "-"))
                    defaults["weather_temp"] = temp_val
                except (ValueError, IndexError):
                    pass

        # Try lookup by nflverse_game_id first, then create with espn placeholder
        try:
            game_obj = Game.objects.using("nfl").get(nflverse_game_id=game_id)
            for k, v in defaults.items():
                setattr(game_obj, k, v)
            game_obj.save(using="nfl")
            return 0, 1
        except Game.DoesNotExist:
            defaults["espn_event_id"] = espn_placeholder
            Game.objects.using("nfl").create(**defaults)
            return 1, 0

    def _map_roof(self, raw_roof):
        """Map nflverse roof values to Venue.ROOF_CHOICES."""
        mapping = {
            "outdoors": "outdoors",
            "dome": "dome",
            "closed": "dome",
            "retractable": "retractable",
            "open": "outdoors",
        }
        return mapping.get(raw_roof.lower(), "outdoors") if raw_roof else "outdoors"
