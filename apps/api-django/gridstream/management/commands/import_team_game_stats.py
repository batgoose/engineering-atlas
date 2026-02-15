"""
Import team game stats aggregated from play-by-play data.

Available columns for aggregation:
    posteam, defteam, play_type, yards_gained, touchdown, pass_touchdown,
    rush_touchdown, interception, fumble, sack, complete_pass, penalty,
    penalty_type, penalty_yards, epa, down, yardline_100, drive,
    field_goal_result, game_seconds_remaining

NOT available: first_down_pass, first_down_rush, first_down_penalty,
    fumble_lost, return_touchdown, penalty_team, home_score, away_score

Populates: TeamGameStats
Requires: Games and Teams already imported.

Usage:
    python manage.py import_team_game_stats
    python manage.py import_team_game_stats --season 2024
"""

from django.db import transaction

from gridstream.models import Game, Team, TeamGameStats

from ._base import ImportBaseCommand

TEAM_ABBR_MAP = {"STL": "LA", "SD": "LAC", "OAK": "LV"}


class Command(ImportBaseCommand):
    help = "Import team game stats aggregated from play-by-play data."

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

        sw = self.season_where()
        seasons = self.resolve_seasons(requested)
        self.stdout.write(f"Importing team stats for {len(seasons)} seasons")

        total_created = 0
        total_updated = 0

        for year in seasons:
            self.log_season_header(year)

            with self.timed_operation(f"Aggregating team stats for {year}"):
                with self.get_nfl_cursor() as cursor:
                    cursor.execute(self._team_stats_sql(sw), [year, year])
                    col_names = [d[0] for d in cursor.description]
                    rows = [dict(zip(col_names, r)) for r in cursor.fetchall()]

            self.stdout.write(f"  Found {len(rows)} team-game rows")

            if self.dry_run:
                total_created += len(rows)
                continue

            created = 0
            updated = 0
            skipped = 0
            batch = []

            with self.timed_operation(f"Writing team stats for {year}"):
                for row in rows:
                    game_id = self.safe_str(row.get("game_id", ""))
                    game = self.game_cache.get(game_id)
                    team_abbr = self.safe_str(row.get("posteam", ""))
                    team = self.team_cache.get(team_abbr) or self.team_cache.get(
                        TEAM_ABBR_MAP.get(team_abbr, "")
                    )

                    if not game or not team:
                        skipped += 1
                        continue

                    is_home = game.home_team == team
                    opponent = game.away_team if is_home else game.home_team

                    defaults = {
                        "opponent": opponent,
                        "season_year": year,
                        "week": game.week,
                        "is_home": is_home,
                        # Offense
                        "total_yards": self.safe_int(row.get("total_yards"), 0),
                        "total_plays": self.safe_int(row.get("total_plays"), 0),
                        # Passing
                        "pass_completions": self.safe_int(row.get("pass_comp"), 0),
                        "pass_attempts": self.safe_int(row.get("pass_att"), 0),
                        "pass_yards": self.safe_int(row.get("pass_yards"), 0),
                        "pass_tds": self.safe_int(row.get("pass_tds"), 0),
                        "pass_ints": self.safe_int(row.get("pass_ints"), 0),
                        "sacks_allowed": self.safe_int(row.get("sacks_allowed"), 0),
                        # Rushing
                        "rush_attempts": self.safe_int(row.get("rush_att"), 0),
                        "rush_yards": self.safe_int(row.get("rush_yards"), 0),
                        "rush_tds": self.safe_int(row.get("rush_tds"), 0),
                        # Turnovers (approximate — no fumble_lost column in raw data)
                        "turnovers": self.safe_int(row.get("turnovers"), 0),
                        "interceptions_lost": self.safe_int(row.get("pass_ints"), 0),
                        # Penalties (approximate — no penalty_team in raw data)
                        "penalties": self.safe_int(row.get("penalties"), 0),
                        "penalty_yards": self.safe_int(row.get("penalty_yds"), 0),
                        # Conversions
                        "third_down_attempts": self.safe_int(
                            row.get("third_down_att"), 0
                        ),
                        "fourth_down_attempts": self.safe_int(
                            row.get("fourth_down_att"), 0
                        ),
                        # Red zone
                        "redzone_attempts": self.safe_int(row.get("redzone_att"), 0),
                        # Defense
                        "sacks_made": self.safe_float(row.get("def_sacks"), 0),
                        "takeaways": self.safe_int(row.get("def_takeaways"), 0),
                        "interceptions_caught": self.safe_int(row.get("def_ints"), 0),
                        # EPA
                        "offensive_epa": self.safe_float(row.get("off_epa")),
                        "defensive_epa": self.safe_float(row.get("def_epa")),
                        "passing_epa": self.safe_float(row.get("pass_epa")),
                        "rushing_epa": self.safe_float(row.get("rush_epa")),
                    }
                    batch.append((team, game, defaults))

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
                self.stdout.write(self.style.WARNING(f"  Skipped {skipped}"))
            self.stdout.write(f"  Team stats: {created} created, {updated} updated")
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
        with transaction.atomic(using="nfl"):
            for team, game, defaults in batch:
                _, was_created = TeamGameStats.objects.using("nfl").update_or_create(
                    team=team,
                    game=game,
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
        return created, updated

    def _team_stats_sql(self, season_where):
        """
        Aggregate team stats from the 52-column plays table.

        Two CTEs: offense (grouped by posteam) and defense (grouped by defteam).
        No first_down_* columns available, no penalty_team, no score columns.
        """
        return f"""
        WITH offense AS (
            SELECT
                game_id,
                posteam,
                -- Total offense
                SUM(CASE WHEN play_type IN ('run', 'pass') AND sack = 0 THEN yards_gained
                         ELSE 0 END)::int as total_yards,
                COUNT(*) FILTER (
                    WHERE play_type IN ('run', 'pass') OR sack = 1
                ) as total_plays,
                -- Passing
                COUNT(*) FILTER (WHERE complete_pass = 1) as pass_comp,
                COUNT(*) FILTER (WHERE play_type = 'pass' AND sack = 0) as pass_att,
                SUM(CASE WHEN play_type = 'pass' AND sack = 0 THEN yards_gained ELSE 0 END)::int as pass_yards,
                COUNT(*) FILTER (WHERE pass_touchdown = 1) as pass_tds,
                COUNT(*) FILTER (WHERE interception = 1) as pass_ints,
                COUNT(*) FILTER (WHERE sack = 1) as sacks_allowed,
                -- Rushing
                COUNT(*) FILTER (WHERE play_type = 'run') as rush_att,
                SUM(CASE WHEN play_type = 'run' THEN yards_gained ELSE 0 END)::int as rush_yards,
                COUNT(*) FILTER (WHERE rush_touchdown = 1) as rush_tds,
                -- Turnovers (interceptions + fumbles — no fumble_lost column)
                COUNT(*) FILTER (WHERE interception = 1 OR fumble = 1) as turnovers,
                COUNT(*) FILTER (WHERE fumble = 1) as fumbles,
                -- Penalties (no penalty_team column, so this counts all penalties
                -- on plays where this team had possession — approximate)
                COUNT(*) FILTER (WHERE penalty = 1) as penalties,
                SUM(CASE WHEN penalty = 1 THEN penalty_yards ELSE 0 END)::int as penalty_yds,
                -- 3rd/4th down attempts
                COUNT(*) FILTER (WHERE down = 3 AND play_type IN ('run', 'pass')) as third_down_att,
                COUNT(*) FILTER (WHERE down = 4 AND play_type IN ('run', 'pass')) as fourth_down_att,
                -- Red zone
                COUNT(DISTINCT drive) FILTER (
                    WHERE yardline_100 <= 20 AND play_type IN ('run', 'pass')
                ) as redzone_att,
                -- EPA
                SUM(epa) as off_epa,
                SUM(epa) FILTER (WHERE play_type = 'pass' OR sack = 1) as pass_epa,
                SUM(epa) FILTER (WHERE play_type = 'run') as rush_epa
            FROM plays
            WHERE {season_where}
                AND posteam IS NOT NULL
                AND posteam != ''
            GROUP BY game_id, posteam
        ),
        defense AS (
            SELECT
                game_id,
                defteam as team,
                COUNT(*) FILTER (WHERE sack = 1) as def_sacks,
                COUNT(*) FILTER (WHERE interception = 1 OR fumble = 1) as def_takeaways,
                COUNT(*) FILTER (WHERE interception = 1) as def_ints,
                SUM(epa) as def_epa
            FROM plays
            WHERE {season_where}
                AND defteam IS NOT NULL
                AND defteam != ''
            GROUP BY game_id, defteam
        )
        SELECT
            o.game_id,
            o.posteam,
            o.total_yards, o.total_plays,
            o.pass_comp, o.pass_att, o.pass_yards, o.pass_tds, o.pass_ints,
            o.sacks_allowed,
            o.rush_att, o.rush_yards, o.rush_tds,
            o.turnovers, o.fumbles,
            o.penalties, o.penalty_yds,
            o.third_down_att, o.fourth_down_att,
            o.redzone_att,
            o.off_epa, o.pass_epa, o.rush_epa,
            COALESCE(d.def_sacks, 0) as def_sacks,
            COALESCE(d.def_takeaways, 0) as def_takeaways,
            COALESCE(d.def_ints, 0) as def_ints,
            d.def_epa
        FROM offense o
        LEFT JOIN defense d ON o.game_id = d.game_id AND o.posteam = d.team
        ORDER BY o.game_id, o.posteam
        """
