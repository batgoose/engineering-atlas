"""
sync nfl scoreboard data from espn into django game models

use defaults for current week or pass flags for backfills and dry runs

examples:
    # sync current week
    python manage.py sync_espn_games

    # sync specific week (historical seasons supported)
    python manage.py sync_espn_games --season 2023 --week 1 --season-type 2

    # sync postseason
    python manage.py sync_espn_games --season 2023 --week 5 --season-type 3

    # sync with full summary (drives, plays, boxscore)
    python manage.py sync_espn_games --season 2023 --week 1 --full

    # dry run
    python manage.py sync_espn_games --dry-run

note on historical seasons:
    ESPN's scoreboard API ignores year= and week= params for historical seasons
    and always returns the current week.  When --season and --week are both
    given, we look up the exact date range from the ESPN calendar API and use
    the dates=YYYYMMDD-YYYYMMDD param instead, which works reliably for any
    season back to at least 2000.
"""

import json
import logging
import re
from datetime import datetime
from typing import Optional

import requests
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from gridstream.models import (
    Drive,
    Game,
    GameLeader,
    GameOfficial,
    Play,
    Player,
    PlayerGameStats,
    PlayerInjury,
    ScoringPlay,
    Season,
    Team,
    TeamGameStats,
    Venue,
    WinProbabilityPlay,
)
from gridstream.venue_metadata import infer_is_indoor, infer_roof_type

logger = logging.getLogger(__name__)

ESPN_SCOREBOARD_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
)
ESPN_SUMMARY_URL = (
    "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary"
    "?event={event_id}"
)
# Calendar API: returns startDate/endDate for a specific week so we can build
# a dates=YYYYMMDD-YYYYMMDD param that works for historical seasons.
ESPN_CALENDAR_URL = (
    "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
    "/seasons/{year}/types/{season_type}/weeks/{week}"
)

SEASON_TYPE_MAP = {1: "PRE", 2: "REG", 3: "POST"}
SEASON_TYPE_INT_MAP = {v: k for k, v in SEASON_TYPE_MAP.items()}


class Command(BaseCommand):
    help = "Sync NFL game data from ESPN scoreboard API into Django models."

    def add_arguments(self, parser):
        parser.add_argument("--season", type=int, help="NFL season year")
        parser.add_argument("--week", type=int, help="Week number")
        parser.add_argument(
            "--season-type",
            type=int,
            default=2,
            choices=[1, 2, 3],
            help="1=preseason, 2=regular, 3=postseason",
        )
        parser.add_argument(
            "--full",
            action="store_true",
            help="Also fetch game summaries (drives, plays, boxscore)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be synced without writing to DB",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        full = options["full"]

        # Build scoreboard params.
        # ESPN ignores year= and week= for historical seasons (pre-2024 approximately).
        # When both --season and --week are given we fetch the exact date range from
        # the ESPN calendar API and pass dates=YYYYMMDD-YYYYMMDD instead.
        params: dict = {}
        if options["season"] and options["week"]:
            dates_str = self._fetch_week_dates(
                options["season"], options["season_type"], options["week"]
            )
            if dates_str:
                params["dates"] = dates_str
                self.stdout.write(
                    f"Using dates={dates_str} for season {options['season']} "
                    f"week {options['week']} (type {options['season_type']})"
                )
            else:
                # Calendar lookup failed; fall back to year/week (works for recent seasons)
                logger.warning(
                    "Calendar lookup failed, falling back to year/week params"
                )
                params["year"] = options["season"]
                params["week"] = options["week"]
                params["seasontype"] = options["season_type"]
        elif options["season"]:
            params["year"] = options["season"]
            params["seasontype"] = options["season_type"]
        elif options["season_type"]:
            params["seasontype"] = options["season_type"]

        self.stdout.write(f"Fetching ESPN scoreboard... {params or '(current week)'}")

        try:
            resp = requests.get(ESPN_SCOREBOARD_URL, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            raise CommandError(f"ESPN fetch failed: {e}")

        # When using dates= the response omits season/week metadata; fall back
        # to the requested values so Season.get_or_create works correctly.
        season_year = data.get("season", {}).get("year") or options.get("season")
        season_type_int = data.get("season", {}).get("type") or options.get(
            "season_type", 2
        )
        season_type = SEASON_TYPE_MAP.get(season_type_int, "REG")
        week_number = data.get("week", {}).get("number") or options.get("week")
        events = data.get("events", [])

        # Validate that ESPN returned the season we requested.
        # Without a valid dates= param, ESPN ignores year/week for historical
        # seasons and silently returns the current week instead.
        if options["season"] and season_year and season_year != options["season"]:
            self.stdout.write(
                f"  [skip] ESPN returned {season_year} wk {week_number}"
                f" (wanted {options['season']} wk {options.get('week', '?')})"
            )
            return

        self.stdout.write(
            f"Season {season_year}, Week {week_number}, "
            f"Type {season_type}, Games: {len(events)}"
        )

        if dry_run:
            for ev in events:
                self.stdout.write(f"  [DRY RUN] {ev.get('shortName', ev['id'])}")
            return

        # ensure season exists
        season_obj, _ = Season.objects.using("nfl").get_or_create(
            year=season_year,
            defaults={"is_active": True, "current_week": week_number},
        )

        created_count = 0
        updated_count = 0

        for ev in events:
            game, was_created = self._sync_event(
                ev, season_obj, week_number, season_type
            )
            if was_created:
                created_count += 1
            else:
                updated_count += 1

            if full and game:
                self._sync_summary(game, ev["id"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Done: {created_count} created, {updated_count} updated"
            )
        )

    @transaction.atomic(using="nfl")
    def _sync_event(self, event: dict, season: Season, week: int, season_type: str):
        """create or update a game from one espn event"""
        event_id = event["id"]
        comp = event["competitions"][0]
        status = event.get("status", {})

        # resolve teams
        home_data = away_data = None
        for c in comp.get("competitors", []):
            if c["homeAway"] == "home":
                home_data = c
            else:
                away_data = c

        if not home_data or not away_data:
            logger.warning(f"Skipping event {event_id}: missing competitor data")
            return None, False

        home_team = self._resolve_team(home_data["team"])
        away_team = self._resolve_team(away_data["team"])

        if not home_team or not away_team:
            logger.warning(f"Skipping event {event_id}: unknown team(s)")
            return None, False

        # resolve venue
        venue = self._resolve_venue(comp.get("venue", {}))

        # parse date
        game_date = None
        game_time = None
        if event.get("date"):
            try:
                dt = datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
                game_date = dt.date()
                game_time = dt.time()
            except (ValueError, TypeError):
                pass

        # map status
        django_status = self._map_status(status)

        # parse scores
        home_score = int(home_data.get("score", "0") or "0")
        away_score = int(away_data.get("score", "0") or "0")

        # quarter scores from linescores
        home_q_scores = [
            int(ls.get("value", 0)) for ls in home_data.get("linescores", [])
        ]
        away_q_scores = [
            int(ls.get("value", 0)) for ls in away_data.get("linescores", [])
        ]

        # odds
        spread = total = home_ml = away_ml = None
        odds_provider = ""
        if comp.get("odds"):
            o = comp["odds"][0]
            spread = o.get("spread")
            total = o.get("overUnder")
            odds_provider = o.get("provider", {}).get("name", "")
            if o.get("homeTeamOdds"):
                home_ml = o["homeTeamOdds"].get("moneyLine")
            if o.get("awayTeamOdds"):
                away_ml = o["awayTeamOdds"].get("moneyLine")

        # weather
        weather = event.get("weather") or {}
        weather_temp = weather.get("temperature")
        weather_condition = weather.get("displayValue", "")
        weather_cond_id = None
        if weather.get("conditionId"):
            try:
                weather_cond_id = int(weather["conditionId"])
            except (ValueError, TypeError):
                pass

        # broadcast
        broadcast_names = []
        broadcast_network = ""
        if comp.get("broadcasts"):
            broadcast_names = comp["broadcasts"][0].get("names", [])
            if broadcast_names:
                broadcast_network = broadcast_names[0]

        # game note
        game_note = ""
        if comp.get("notes"):
            game_note = comp["notes"][0].get("headline", "")

        # team records
        home_record = away_record = ""
        for r in home_data.get("records", []):
            if r["type"] == "total":
                home_record = r["summary"]
        for r in away_data.get("records", []):
            if r["type"] == "total":
                away_record = r["summary"]

        is_division_game = (
            bool(home_team.division)
            and bool(away_team.division)
            and home_team.division == away_team.division
        )

        defaults = {
            "season": season,
            "week": week,
            "game_date": game_date,
            "game_time": game_time,
            "season_type": season_type,
            "home_team": home_team,
            "away_team": away_team,
            "venue": venue,
            "div_game": is_division_game,
            "is_division_game": is_division_game,
            "status": django_status,
            "quarter": status.get("period", 0),
            "clock": status.get("displayClock", ""),
            "home_score": home_score,
            "away_score": away_score,
            "home_score_q1": home_q_scores[0] if len(home_q_scores) > 0 else 0,
            "home_score_q2": home_q_scores[1] if len(home_q_scores) > 1 else 0,
            "home_score_q3": home_q_scores[2] if len(home_q_scores) > 2 else 0,
            "home_score_q4": home_q_scores[3] if len(home_q_scores) > 3 else 0,
            "home_score_ot": home_q_scores[4] if len(home_q_scores) > 4 else 0,
            "away_score_q1": away_q_scores[0] if len(away_q_scores) > 0 else 0,
            "away_score_q2": away_q_scores[1] if len(away_q_scores) > 1 else 0,
            "away_score_q3": away_q_scores[2] if len(away_q_scores) > 2 else 0,
            "away_score_q4": away_q_scores[3] if len(away_q_scores) > 3 else 0,
            "away_score_ot": away_q_scores[4] if len(away_q_scores) > 4 else 0,
            "spread_line": spread,
            "total_line": total,
            "spread": spread,
            "total": total,
            "home_moneyline": home_ml,
            "away_moneyline": away_ml,
            "odds_provider": odds_provider,
            "weather_temp": weather_temp,
            "weather_condition": weather_condition,
            "weather_condition_id": weather_cond_id,
            "broadcast_network": broadcast_network,
            "broadcast_names": broadcast_names,
            "game_note": game_note,
            "home_record": home_record,
            "away_record": away_record,
        }

        game, created = Game.objects.using("nfl").update_or_create(
            espn_event_id=event_id,
            defaults=defaults,
        )

        # sync game leaders
        self._sync_leaders(game, home_data, away_data)

        action = "created" if created else "updated"
        self.stdout.write(
            f"  {action}: {away_team.abbreviation}@{home_team.abbreviation} "
            f"({django_status}) {away_score}-{home_score}"
        )

        return game, created

    def _sync_leaders(self, game: Game, home_data: dict, away_data: dict):
        """sync game leaders from competitor data"""
        for comp_data in [home_data, away_data]:
            team = self._resolve_team(comp_data["team"])
            if not team:
                continue

            for leader_cat in comp_data.get("leaders", []):
                category = {
                    "passingLeader": "passing",
                    "rushingLeader": "rushing",
                    "receivingLeader": "receiving",
                }.get(leader_cat.get("name"))

                if not category or not leader_cat.get("leaders"):
                    continue

                l = leader_cat["leaders"][0]
                athlete = l.get("athlete", {})

                GameLeader.objects.using("nfl").update_or_create(
                    game=game,
                    team=team,
                    category=category,
                    defaults={
                        "athlete_espn_id": athlete.get("id", ""),
                        "athlete_name": athlete.get("fullName", ""),
                        "athlete_headshot_url": athlete.get("headshot", ""),
                        "athlete_jersey": athlete.get("jersey", ""),
                        "athlete_position": (
                            athlete.get("position", {}).get("abbreviation", "")
                        ),
                        "display_value": l.get("displayValue", ""),
                    },
                )

    def _sync_summary(self, game: Game, event_id: str):
        """fetch and sync game summary data"""
        self.stdout.write(f"  Fetching summary for {event_id}...")

        try:
            resp = requests.get(ESPN_SUMMARY_URL.format(event_id=event_id), timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            logger.error(f"Summary fetch failed for {event_id}: {e}")
            return

        drives_data = data.get("drives", {})
        all_drives = drives_data.get("previous", [])
        if drives_data.get("current"):
            all_drives.append(drives_data["current"])

        play_sequence = 0
        with transaction.atomic(using="nfl"):
            for i, drive_data in enumerate(all_drives, 1):
                team = (
                    Team.objects.using("nfl")
                    .filter(
                        abbreviation=drive_data.get("team", {}).get("abbreviation", "")
                    )
                    .first()
                )

                if not team:
                    continue

                drive, _ = Drive.objects.using("nfl").update_or_create(
                    game=game,
                    drive_number=i,
                    defaults={
                        "team": team,
                        "description": drive_data.get("description", ""),
                        "start_quarter": (
                            drive_data.get("start", {}).get("period", {}).get("number")
                        ),
                        "start_clock": (
                            drive_data.get("start", {})
                            .get("clock", {})
                            .get("displayValue", "")
                        ),
                        "start_yardline": drive_data.get("start", {}).get("yardLine"),
                        "end_quarter": (
                            drive_data.get("end", {}).get("period", {}).get("number")
                        ),
                        "end_clock": (
                            drive_data.get("end", {})
                            .get("clock", {})
                            .get("displayValue", "")
                        ),
                        "end_yardline": drive_data.get("end", {}).get("yardLine"),
                        "total_yards": drive_data.get("yards", 0),
                        "play_count": drive_data.get("offensivePlays", 0),
                        "time_elapsed": (
                            drive_data.get("timeElapsed", {}).get("displayValue", "")
                        ),
                        "result": self._map_drive_result(drive_data.get("result", "")),
                        "is_score": drive_data.get("isScore", False),
                    },
                )

                # sync plays in this drive
                for play_data in drive_data.get("plays", []):
                    play_sequence += 1
                    self._sync_play(game, drive, team, play_data, play_sequence)

            # sync scoring plays
            for seq, sp_data in enumerate(data.get("scoringPlays", []), 1):
                sp_team = (
                    Team.objects.using("nfl")
                    .filter(
                        abbreviation=sp_data.get("team", {}).get("abbreviation", "")
                    )
                    .first()
                )
                if sp_team:
                    ScoringPlay.objects.using("nfl").update_or_create(
                        game=game,
                        sequence=seq,
                        defaults={
                            "team": sp_team,
                            "quarter": sp_data.get("period", {}).get("number", 0),
                            "clock": (sp_data.get("clock", {}).get("displayValue", "")),
                            "score_type": self._map_score_type(
                                sp_data.get("scoringType", {}).get("abbreviation", "")
                            ),
                            "description": sp_data.get("text", ""),
                            "home_score_after": sp_data.get("homeScore", 0),
                            "away_score_after": sp_data.get("awayScore", 0),
                        },
                    )

            team_boxscore_rows = self._sync_team_boxscore(game, data)
            player_boxscore_rows = self._sync_player_boxscore(game, data)
            odds_updated = self._sync_pickcenter_odds(game, data)
            game_info_updated = self._sync_game_info_context(game, data)
            official_rows = self._sync_game_officials(game, data)
            injury_rows = self._sync_injuries(game, data)
            summary_written = self._store_raw_summary(game, event_id, data)
            probability_rows = self._store_win_probabilities(game, event_id, data)

        details = [
            f"{len(all_drives)} drives",
            f"{play_sequence} plays",
            f"{team_boxscore_rows} team boxscore rows",
            f"{player_boxscore_rows} player boxscore rows",
            f"{probability_rows} win-prob rows",
            f"{official_rows} officials",
            f"{injury_rows} injuries",
        ]
        if odds_updated:
            details.append("pickcenter odds")
        if game_info_updated:
            details.append("gameInfo")
        if summary_written:
            details.append("raw summary")

        self.stdout.write(f"    Synced {', '.join(details)}")

    def _sync_play(
        self, game: Game, drive: Drive, team: Team, play_data: dict, sequence: int
    ):
        """sync one play record"""
        play_type = self._map_play_type(play_data.get("type", {}).get("text", ""))
        start = play_data.get("start", {})
        end = play_data.get("end", {})

        Play.objects.using("nfl").update_or_create(
            game=game,
            sequence=sequence,
            defaults={
                "drive": drive,
                "espn_play_id": play_data.get("id", ""),
                "quarter": play_data.get("period", {}).get("number"),
                "clock": play_data.get("clock", {}).get("displayValue", ""),
                "down": start.get("down"),
                "distance": start.get("distance"),
                "yard_line": start.get("yardsToEndzone"),
                "down_distance_text": start.get("downDistanceText", ""),
                "possession_team": team,
                "play_type": play_type,
                "description": play_data.get("text", ""),
                "short_description": play_data.get("shortText", ""),
                "yards_gained": play_data.get("statYardage"),
                "is_scoring_play": play_data.get("scoringPlay", False),
                "home_score_after": play_data.get("homeScore", 0),
                "away_score_after": play_data.get("awayScore", 0),
                "end_down": end.get("down"),
                "end_distance": end.get("distance"),
                "end_yard_line": end.get("yardsToEndzone"),
            },
        )

    def _sync_pickcenter_odds(self, game: Game, summary_data: dict) -> bool:
        """apply richer odds from summary.pickcenter when available"""
        pickcenter = summary_data.get("pickcenter") or []
        if not pickcenter:
            return False

        pick = next((p for p in pickcenter if isinstance(p, dict)), None)
        if not pick:
            return False

        spread = self._parse_float(
            (
                ((pick.get("pointSpread") or {}).get("home") or {})
                .get("close", {})
                .get("line")
            )
        )
        if spread is None:
            spread = self._parse_float(pick.get("spread"))

        spread_open = self._parse_float(
            (
                ((pick.get("pointSpread") or {}).get("home") or {})
                .get("open", {})
                .get("line")
            )
        )

        total = self._parse_float(pick.get("overUnder"))
        if total is None:
            total = self._parse_float(
                (
                    ((pick.get("total") or {}).get("over") or {})
                    .get("close", {})
                    .get("line")
                )
            )
        total_open = self._parse_float(
            ((pick.get("total") or {}).get("over") or {}).get("open", {}).get("line")
        )

        home_ml = self._parse_int((pick.get("homeTeamOdds") or {}).get("moneyLine"))
        away_ml = self._parse_int((pick.get("awayTeamOdds") or {}).get("moneyLine"))
        if home_ml is None:
            home_ml = self._parse_int(
                (
                    ((pick.get("moneyline") or {}).get("home") or {})
                    .get("close", {})
                    .get("odds")
                )
            )
        if away_ml is None:
            away_ml = self._parse_int(
                (
                    ((pick.get("moneyline") or {}).get("away") or {})
                    .get("close", {})
                    .get("odds")
                )
            )

        odds_provider = (pick.get("provider") or {}).get("name", "")
        has_value = any(
            [
                spread is not None,
                total is not None,
                home_ml is not None,
                away_ml is not None,
                spread_open is not None,
                total_open is not None,
                bool(odds_provider),
            ]
        )
        if not has_value:
            return False

        Game.objects.using("nfl").filter(pk=game.pk).update(
            spread_line=spread,
            total_line=total,
            spread=spread,
            total=total,
            home_moneyline=home_ml,
            away_moneyline=away_ml,
            spread_open=spread_open,
            total_open=total_open,
            odds_provider=odds_provider or game.odds_provider,
        )

        game.spread_line = spread
        game.total_line = total
        game.spread = spread
        game.total = total
        game.home_moneyline = home_ml
        game.away_moneyline = away_ml
        game.spread_open = spread_open
        game.total_open = total_open
        if odds_provider:
            game.odds_provider = odds_provider
        return True

    def _sync_game_info_context(self, game: Game, summary_data: dict) -> bool:
        """sync game-level context from summary.gameInfo (attendance/officials)."""
        game_info = summary_data.get("gameInfo") or {}
        if not isinstance(game_info, dict):
            return False

        attendance = self._parse_int(game_info.get("attendance"))
        referee = self._extract_referee_name(game_info.get("officials") or [])
        if referee:
            referee = referee.strip()

        has_value = attendance is not None or bool(referee)
        if not has_value:
            return False

        update_referee = referee if referee else game.referee
        Game.objects.using("nfl").filter(pk=game.pk).update(
            attendance=attendance,
            referee=update_referee,
        )
        game.attendance = attendance
        if referee:
            game.referee = referee
        return True

    def _sync_game_officials(self, game: Game, summary_data: dict) -> int:
        """sync officiating crew rows from summary.gameInfo.officials."""
        game_info = summary_data.get("gameInfo") or {}
        if not isinstance(game_info, dict):
            return 0

        officials = game_info.get("officials")
        if not isinstance(officials, list):
            return 0

        GameOfficial.objects.using("nfl").filter(game=game).delete()

        rows = []
        seen = set()
        for seq, row in enumerate(officials, start=1):
            if not isinstance(row, dict):
                continue
            name = str(row.get("displayName") or row.get("fullName") or "").strip()
            if not name:
                continue
            position = row.get("position") or {}
            role = str(
                position.get("displayName") or position.get("name") or ""
            ).strip()
            dedupe_key = (name, role)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            rows.append(
                GameOfficial(
                    game=game,
                    sequence=seq,
                    name=name,
                    position=role,
                )
            )

        if rows:
            GameOfficial.objects.using("nfl").bulk_create(rows)
        return len(rows)

    def _sync_injuries(self, game: Game, summary_data: dict) -> int:
        """sync game-day injury rows from summary.injuries."""
        injuries_payload = summary_data.get("injuries")
        if not isinstance(injuries_payload, list):
            return 0

        team_abbrs = [
            str((row.get("team") or {}).get("abbreviation") or "").strip().upper()
            for row in injuries_payload
            if isinstance(row, dict)
        ]
        teams_by_abbr = {
            t.abbreviation: t
            for t in Team.objects.using("nfl")
            .filter(abbreviation__in=team_abbrs)
            .only("id", "abbreviation")
        }

        player_ids = set()
        for team_block in injuries_payload:
            if not isinstance(team_block, dict):
                continue
            for injury in team_block.get("injuries") or []:
                athlete = (injury or {}).get("athlete") or {}
                athlete_id = str(athlete.get("id") or "").strip()
                if athlete_id:
                    player_ids.add(athlete_id)
        players_by_espn = {
            p.espn_id: p
            for p in Player.objects.using("nfl")
            .filter(espn_id__in=list(player_ids))
            .only("id", "espn_id", "display_name", "current_team_id")
        }

        PlayerInjury.objects.using("nfl").filter(game=game).delete()

        rows = []
        sequence = 0
        for team_block in injuries_payload:
            if not isinstance(team_block, dict):
                continue

            team_abbr = (
                str(((team_block.get("team") or {}).get("abbreviation") or ""))
                .strip()
                .upper()
            )
            team = teams_by_abbr.get(team_abbr)

            for injury in team_block.get("injuries") or []:
                if not isinstance(injury, dict):
                    continue

                athlete = injury.get("athlete") or {}
                athlete_id = str(athlete.get("id") or "").strip()
                player_name = str(
                    athlete.get("displayName") or athlete.get("fullName") or ""
                ).strip()

                status = str(injury.get("status") or "").strip()
                if not status:
                    status = str(
                        ((injury.get("type") or {}).get("abbreviation") or "")
                    ).strip()

                details = injury.get("details") or {}
                description = str(
                    details.get("type")
                    or details.get("detail")
                    or details.get("description")
                    or ""
                ).strip()

                availability = str(
                    details.get("availability") or details.get("status") or status or ""
                ).strip()

                player = players_by_espn.get(athlete_id)
                if not player and player_name:
                    qs = Player.objects.using("nfl").filter(display_name=player_name)
                    if team:
                        player = qs.filter(current_team=team).first() or qs.first()
                    else:
                        player = qs.first()

                sequence += 1
                rows.append(
                    PlayerInjury(
                        game=game,
                        team=team,
                        player=player,
                        sequence=sequence,
                        player_name=player_name,
                        player_espn_id=athlete_id,
                        status=status,
                        description=description,
                        game_day_availability=availability,
                    )
                )

        if rows:
            PlayerInjury.objects.using("nfl").bulk_create(rows)
        return len(rows)

    def _extract_referee_name(self, officials: list) -> str:
        if not isinstance(officials, list):
            return ""

        def _display_name(row: dict) -> str:
            return str(row.get("displayName") or row.get("fullName") or "").strip()

        for row in officials:
            if not isinstance(row, dict):
                continue
            position = row.get("position") or {}
            label = str(
                position.get("displayName") or position.get("name") or ""
            ).strip()
            if label.lower() == "referee":
                return _display_name(row)

        for row in officials:
            if isinstance(row, dict):
                name = _display_name(row)
                if name:
                    return name
        return ""

    def _sync_team_boxscore(self, game: Game, summary_data: dict) -> int:
        """sync ESPN boxscore team totals into TeamGameStats"""
        teams_payload = (summary_data.get("boxscore") or {}).get("teams") or []
        if not teams_payload:
            return 0

        abbrs = [
            (t.get("team") or {}).get("abbreviation", "")
            for t in teams_payload
            if (t.get("team") or {}).get("abbreviation")
        ]
        teams_by_abbr = {
            t.abbreviation: t
            for t in Team.objects.using("nfl")
            .filter(abbreviation__in=abbrs)
            .only("id", "abbreviation")
        }

        synced = 0
        for team_data in teams_payload:
            team_abbr = (team_data.get("team") or {}).get("abbreviation", "")
            team = teams_by_abbr.get(team_abbr)
            if not team:
                continue

            is_home = team.id == game.home_team_id
            opponent = game.away_team if is_home else game.home_team
            stats_by_name = {
                s.get("name"): s
                for s in (team_data.get("statistics") or [])
                if s.get("name")
            }

            third_conv, third_att = self._parse_int_pair(
                self._stat_display(stats_by_name, "thirdDownEff"), "-"
            )
            fourth_conv, fourth_att = self._parse_int_pair(
                self._stat_display(stats_by_name, "fourthDownEff"), "-"
            )
            rz_scores, rz_att = self._parse_int_pair(
                self._stat_display(stats_by_name, "redZoneAttempts"), "-"
            )
            pass_comp, pass_att = self._parse_int_pair(
                self._stat_display(stats_by_name, "completionAttempts"), "/"
            )
            sacks_allowed, sack_yards = self._parse_int_pair(
                self._stat_display(stats_by_name, "sacksYardsLost"), "-"
            )
            penalties, penalty_yards = self._parse_int_pair(
                self._stat_display(stats_by_name, "totalPenaltiesYards"), "-"
            )

            possession_time = self._stat_display(stats_by_name, "possessionTime")
            possession_seconds = self._parse_int(
                (stats_by_name.get("possessionTime") or {}).get("value")
            )
            if possession_seconds is None:
                possession_seconds = self._clock_to_seconds(possession_time) or 0

            defaults = {
                "opponent": opponent,
                "season_year": game.season_id,
                "week": game.week,
                "is_home": is_home,
                "total_yards": self._stat_int(stats_by_name, "totalYards") or 0,
                "total_plays": self._stat_int(stats_by_name, "totalOffensivePlays")
                or 0,
                "first_downs": self._stat_int(stats_by_name, "firstDowns") or 0,
                "first_downs_passing": self._stat_int(
                    stats_by_name, "firstDownsPassing"
                )
                or 0,
                "first_downs_rushing": self._stat_int(
                    stats_by_name, "firstDownsRushing"
                )
                or 0,
                "first_downs_penalty": self._stat_int(
                    stats_by_name, "firstDownsPenalty"
                )
                or 0,
                "third_down_attempts": third_att or 0,
                "third_down_conversions": third_conv or 0,
                "fourth_down_attempts": fourth_att or 0,
                "fourth_down_conversions": fourth_conv or 0,
                "redzone_attempts": rz_att or 0,
                "redzone_scores": rz_scores or 0,
                "pass_completions": pass_comp or 0,
                "pass_attempts": pass_att or 0,
                "pass_yards": self._stat_int(stats_by_name, "netPassingYards") or 0,
                "pass_ints": self._stat_int(stats_by_name, "interceptions") or 0,
                "sacks_allowed": sacks_allowed or 0,
                "sack_yards_allowed": sack_yards or 0,
                "rush_attempts": self._stat_int(stats_by_name, "rushingAttempts") or 0,
                "rush_yards": self._stat_int(stats_by_name, "rushingYards") or 0,
                "turnovers": self._stat_int(stats_by_name, "turnovers") or 0,
                "fumbles_lost": self._stat_int(stats_by_name, "fumblesLost") or 0,
                "defensive_tds": self._stat_int(stats_by_name, "defensiveTouchdowns")
                or 0,
                "penalties": penalties or 0,
                "penalty_yards": penalty_yards or 0,
                "time_of_possession": possession_time,
                "time_of_possession_seconds": possession_seconds,
                "points_scored": game.home_score if is_home else game.away_score,
                "points_allowed": game.away_score if is_home else game.home_score,
            }

            TeamGameStats.objects.using("nfl").update_or_create(
                team=team,
                game=game,
                defaults=defaults,
            )
            synced += 1

        return synced

    def _sync_player_boxscore(self, game: Game, summary_data: dict) -> int:
        """sync ESPN boxscore player stats into PlayerGameStats (best effort)"""
        players_payload = (summary_data.get("boxscore") or {}).get("players") or []
        if not players_payload:
            return 0

        total_synced = 0
        for team_block in players_payload:
            team_abbr = (team_block.get("team") or {}).get("abbreviation", "")
            team = Team.objects.using("nfl").filter(abbreviation=team_abbr).first()
            if not team:
                continue

            opponent = (
                game.away_team if team.id == game.home_team_id else game.home_team
            )
            athlete_ids = {
                str((ath.get("athlete") or {}).get("id"))
                for stat_group in (team_block.get("statistics") or [])
                for ath in (stat_group.get("athletes") or [])
                if (ath.get("athlete") or {}).get("id")
            }
            players_by_espn = {
                p.espn_id: p
                for p in Player.objects.using("nfl")
                .filter(espn_id__in=athlete_ids)
                .only("id", "espn_id", "display_name")
            }

            rows_by_player = {}
            for stat_group in team_block.get("statistics") or []:
                group_name = (stat_group.get("name") or "").lower()
                keys = stat_group.get("keys") or []
                for athlete_row in stat_group.get("athletes") or []:
                    athlete = athlete_row.get("athlete") or {}
                    athlete_id = str(athlete.get("id") or "").strip()
                    if not athlete_id:
                        continue

                    player = players_by_espn.get(athlete_id)
                    if not player:
                        athlete_name = (
                            athlete.get("fullName") or athlete.get("displayName") or ""
                        ).strip()
                        if athlete_name:
                            player = (
                                Player.objects.using("nfl")
                                .filter(display_name=athlete_name, current_team=team)
                                .first()
                            )
                            if not player:
                                player = (
                                    Player.objects.using("nfl")
                                    .filter(display_name=athlete_name)
                                    .first()
                                )
                        if player:
                            players_by_espn[athlete_id] = player
                    if not player:
                        continue

                    entry = rows_by_player.get(player.id)
                    if not entry:
                        entry = {
                            "player": player,
                            "stats": self._base_player_boxscore_defaults(),
                        }
                        rows_by_player[player.id] = entry

                    key_values = self._zip_values(keys, athlete_row.get("stats") or [])
                    self._apply_player_group_stats(
                        entry["stats"], group_name, key_values
                    )

            for entry in rows_by_player.values():
                defaults = entry["stats"]
                defaults.update(
                    {
                        "team": team,
                        "opponent": opponent,
                        "season_year": game.season_id,
                        "week": game.week,
                        "season_type": game.season_type,
                    }
                )
                PlayerGameStats.objects.using("nfl").update_or_create(
                    player=entry["player"],
                    game=game,
                    defaults=defaults,
                )
                total_synced += 1

        return total_synced

    def _base_player_boxscore_defaults(self) -> dict:
        return {
            "completions": 0,
            "pass_attempts": 0,
            "passing_yards": 0,
            "passing_tds": 0,
            "interceptions_thrown": 0,
            "sacks_taken": 0,
            "sack_yards_lost": 0,
            "passer_rating": None,
            "qbr": None,
            "carries": 0,
            "rushing_yards": 0,
            "rushing_tds": 0,
            "rushing_long": 0,
            "receptions": 0,
            "targets": 0,
            "receiving_yards": 0,
            "receiving_tds": 0,
            "receiving_long": 0,
            "tackles_total": 0,
            "tackles_solo": 0,
            "tackles_assists": 0,
            "tackles_for_loss": 0.0,
            "sacks_made": 0.0,
            "qb_hits": 0,
            "passes_defended": 0,
            "interceptions_caught": 0,
            "interception_yards": 0,
            "interception_tds": 0,
            "fumble_recoveries": 0,
            "defensive_tds": 0,
            "safeties": 0,
            "blocked_kicks": 0,
            "kick_return_attempts": 0,
            "kick_return_yards": 0,
            "kick_return_tds": 0,
            "punt_return_attempts": 0,
            "punt_return_yards": 0,
            "punt_return_tds": 0,
            "fg_attempts": 0,
            "fg_made": 0,
            "fg_long": 0,
            "pat_attempts": 0,
            "pat_made": 0,
            "pat_missed": 0,
            "punt_attempts": 0,
            "punt_yards": 0,
            "punt_long": 0,
            "punt_inside_20": 0,
            "punt_touchbacks": 0,
        }

    def _apply_player_group_stats(self, dest: dict, group_name: str, values: dict):
        if group_name == "passing":
            comp, att = self._parse_int_pair(
                values.get("completions/passingAttempts"), "/"
            )
            self._set_if_not_none(dest, "completions", comp)
            self._set_if_not_none(dest, "pass_attempts", att)
            self._set_if_not_none(
                dest, "passing_yards", self._parse_int(values.get("passingYards"))
            )
            self._set_if_not_none(
                dest, "passing_tds", self._parse_int(values.get("passingTouchdowns"))
            )
            self._set_if_not_none(
                dest,
                "interceptions_thrown",
                self._parse_int(values.get("interceptions")),
            )
            sacks, sack_yards = self._parse_int_pair(
                values.get("sacks-sackYardsLost"), "-"
            )
            self._set_if_not_none(dest, "sacks_taken", sacks)
            self._set_if_not_none(dest, "sack_yards_lost", sack_yards)
            self._set_if_not_none(dest, "qbr", self._parse_float(values.get("adjQBR")))
            self._set_if_not_none(
                dest, "passer_rating", self._parse_float(values.get("QBRating"))
            )
            return

        if group_name == "rushing":
            self._set_if_not_none(
                dest, "carries", self._parse_int(values.get("rushingAttempts"))
            )
            self._set_if_not_none(
                dest, "rushing_yards", self._parse_int(values.get("rushingYards"))
            )
            self._set_if_not_none(
                dest, "rushing_tds", self._parse_int(values.get("rushingTouchdowns"))
            )
            self._set_if_not_none(
                dest, "rushing_long", self._parse_int(values.get("longRushing"))
            )
            return

        if group_name == "receiving":
            self._set_if_not_none(
                dest, "receptions", self._parse_int(values.get("receptions"))
            )
            self._set_if_not_none(
                dest, "targets", self._parse_int(values.get("receivingTargets"))
            )
            self._set_if_not_none(
                dest, "receiving_yards", self._parse_int(values.get("receivingYards"))
            )
            self._set_if_not_none(
                dest,
                "receiving_tds",
                self._parse_int(values.get("receivingTouchdowns")),
            )
            self._set_if_not_none(
                dest, "receiving_long", self._parse_int(values.get("longReception"))
            )
            return

        if group_name == "fumbles":
            self._set_if_not_none(
                dest,
                "fumble_recoveries",
                self._parse_int(values.get("fumblesRecovered")),
            )
            return

        if group_name == "defensive":
            self._set_if_not_none(
                dest, "tackles_total", self._parse_int(values.get("totalTackles"))
            )
            self._set_if_not_none(
                dest, "tackles_solo", self._parse_int(values.get("soloTackles"))
            )
            self._set_if_not_none(
                dest, "tackles_assists", self._parse_int(values.get("assistedTackles"))
            )
            self._set_if_not_none(
                dest,
                "tackles_for_loss",
                self._parse_float(values.get("tacklesForLoss")),
            )
            self._set_if_not_none(
                dest, "sacks_made", self._parse_float(values.get("sacks"))
            )
            self._set_if_not_none(
                dest, "qb_hits", self._parse_int(values.get("QBHits"))
            )
            self._set_if_not_none(
                dest, "passes_defended", self._parse_int(values.get("passesDefended"))
            )
            self._set_if_not_none(
                dest,
                "defensive_tds",
                self._parse_int(values.get("defensiveTouchdowns")),
            )
            self._set_if_not_none(
                dest, "safeties", self._parse_int(values.get("safeties"))
            )
            self._set_if_not_none(
                dest, "blocked_kicks", self._parse_int(values.get("blockedKicks"))
            )
            return

        if group_name == "interceptions":
            self._set_if_not_none(
                dest,
                "interceptions_caught",
                self._parse_int(values.get("interceptions")),
            )
            self._set_if_not_none(
                dest,
                "interception_yards",
                self._parse_int(values.get("interceptionYards")),
            )
            self._set_if_not_none(
                dest,
                "interception_tds",
                self._parse_int(values.get("interceptionTouchdowns")),
            )
            return

        if group_name == "kickreturns":
            self._set_if_not_none(
                dest, "kick_return_attempts", self._parse_int(values.get("kickReturns"))
            )
            self._set_if_not_none(
                dest,
                "kick_return_yards",
                self._parse_int(values.get("kickReturnYards")),
            )
            self._set_if_not_none(
                dest,
                "kick_return_tds",
                self._parse_int(values.get("kickReturnTouchdowns")),
            )
            return

        if group_name == "puntreturns":
            self._set_if_not_none(
                dest, "punt_return_attempts", self._parse_int(values.get("puntReturns"))
            )
            self._set_if_not_none(
                dest,
                "punt_return_yards",
                self._parse_int(values.get("puntReturnYards")),
            )
            self._set_if_not_none(
                dest,
                "punt_return_tds",
                self._parse_int(values.get("puntReturnTouchdowns")),
            )
            return

        if group_name == "kicking":
            fg_made, fg_attempts = self._parse_int_pair(
                values.get("fieldGoalsMade/fieldGoalAttempts"), "/"
            )
            self._set_if_not_none(dest, "fg_made", fg_made)
            self._set_if_not_none(dest, "fg_attempts", fg_attempts)
            self._set_if_not_none(
                dest, "fg_long", self._parse_int(values.get("longFieldGoalMade"))
            )
            pat_made, pat_attempts = self._parse_int_pair(
                values.get("extraPointsMade/extraPointAttempts"), "/"
            )
            self._set_if_not_none(dest, "pat_made", pat_made)
            self._set_if_not_none(dest, "pat_attempts", pat_attempts)
            if pat_made is not None and pat_attempts is not None:
                dest["pat_missed"] = max(0, pat_attempts - pat_made)
            return

        if group_name == "punting":
            self._set_if_not_none(
                dest, "punt_attempts", self._parse_int(values.get("punts"))
            )
            self._set_if_not_none(
                dest, "punt_yards", self._parse_int(values.get("puntYards"))
            )
            self._set_if_not_none(
                dest, "punt_long", self._parse_int(values.get("longPunt"))
            )
            self._set_if_not_none(
                dest, "punt_inside_20", self._parse_int(values.get("puntsInside20"))
            )
            self._set_if_not_none(
                dest, "punt_touchbacks", self._parse_int(values.get("touchbacks"))
            )

    def _store_raw_summary(self, game: Game, event_id: str, summary_data: dict) -> bool:
        """persist the full ESPN summary snapshot into raw schema"""
        if not self._raw_table_exists("raw.raw_espn_summary"):
            return False

        game_date = self._summary_game_datetime(summary_data)
        with connections["nfl"].cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO raw.raw_espn_summary (
                    batch_id,
                    espn_event_id,
                    season,
                    week,
                    season_type,
                    game_date,
                    summary_payload
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    None,
                    event_id,
                    game.season_id,
                    game.week,
                    SEASON_TYPE_INT_MAP.get(game.season_type),
                    game_date,
                    json.dumps(summary_data),
                ),
            )
        return True

    def _store_win_probabilities(
        self, game: Game, event_id: str, summary_data: dict
    ) -> int:
        """persist ESPN win probability timeline rows into raw + model tables."""
        timeline = summary_data.get("winprobability") or []
        if not isinstance(timeline, list):
            timeline = []

        play_lookup = self._play_lookup(game)
        raw_rows = []
        model_rows_by_seq = {}
        play_wp_updates = {}

        for idx, point in enumerate(timeline, start=1):
            if not isinstance(point, dict):
                continue

            play_id = str(point.get("playId") or "").strip() or None
            linked_play = play_lookup.get(play_id) if play_id else None

            sequence = self._parse_int(point.get("sequenceNumber"))
            if sequence is None and linked_play:
                sequence = linked_play.get("sequence")
            if sequence is None:
                sequence = idx

            seconds_left = self._parse_int(point.get("secondsLeft"))
            if seconds_left is None and linked_play:
                seconds_left = linked_play.get("seconds_left")

            home_win_pct = self._parse_float(point.get("homeWinPercentage"))
            tie_pct = self._parse_float(point.get("tiePercentage"))
            away_win_pct = self._parse_float(point.get("awayWinPercentage"))
            if away_win_pct is None and home_win_pct is not None:
                away_win_pct = max(0.0, 1.0 - home_win_pct - (tie_pct or 0.0))

            raw_rows.append(
                (
                    None,
                    event_id,
                    play_id,
                    sequence,
                    seconds_left,
                    home_win_pct,
                    away_win_pct,
                    tie_pct,
                    json.dumps(point),
                )
            )

            model_rows_by_seq[sequence] = WinProbabilityPlay(
                game=game,
                play_id=linked_play.get("id") if linked_play else None,
                espn_play_id=play_id or "",
                sequence=sequence,
                seconds_left=seconds_left,
                home_win_pct=home_win_pct,
                away_win_pct=away_win_pct,
                tie_pct=tie_pct,
                source="espn_summary",
            )

            if linked_play and (home_win_pct is not None or away_win_pct is not None):
                play_wp_updates[linked_play["id"]] = (home_win_pct, away_win_pct)

        WinProbabilityPlay.objects.using("nfl").filter(game=game).delete()
        model_rows = [model_rows_by_seq[k] for k in sorted(model_rows_by_seq)]
        if model_rows:
            WinProbabilityPlay.objects.using("nfl").bulk_create(model_rows)

        for play_id, (home_win_pct, away_win_pct) in play_wp_updates.items():
            update_data = {}
            if home_win_pct is not None:
                update_data["home_wp"] = home_win_pct
            if away_win_pct is not None:
                update_data["away_wp"] = away_win_pct
            if update_data:
                Play.objects.using("nfl").filter(pk=play_id).update(**update_data)

        if self._raw_table_exists("raw.raw_espn_probabilities"):
            with connections["nfl"].cursor() as cursor:
                cursor.execute(
                    "DELETE FROM raw.raw_espn_probabilities WHERE espn_event_id = %s",
                    [event_id],
                )
                if raw_rows:
                    cursor.executemany(
                        """
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
                        """,
                        raw_rows,
                    )

        return len(model_rows)

    def _summary_game_datetime(self, summary_data: dict):
        header = summary_data.get("header") or {}
        comps = header.get("competitions") or []
        if comps:
            raw_date = (comps[0] or {}).get("date", "")
            if raw_date:
                try:
                    return datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
                except (TypeError, ValueError):
                    return None
        return None

    def _play_lookup(self, game: Game) -> dict:
        lookup = {}
        for play in (
            Play.objects.using("nfl")
            .filter(game=game)
            .only("id", "espn_play_id", "sequence", "quarter", "clock")
        ):
            play_id = str(play.espn_play_id or "").strip()
            if not play_id:
                continue
            seconds_left = self._estimate_seconds_left(play.quarter, play.clock)
            lookup[play_id] = {
                "id": play.id,
                "sequence": play.sequence,
                "seconds_left": seconds_left,
            }
        return lookup

    def _estimate_seconds_left(self, quarter, clock) -> Optional[int]:
        q = self._parse_int(quarter)
        seconds = self._clock_to_seconds(clock)
        if q is None or seconds is None:
            return None
        if q <= 4:
            return max(0, (4 - q) * 900 + seconds)
        return seconds

    def _raw_table_exists(self, table_name: str) -> bool:
        cache = getattr(self, "_raw_table_exists_cache", {})
        if table_name in cache:
            return cache[table_name]

        with connections["nfl"].cursor() as cursor:
            cursor.execute("SELECT to_regclass(%s)", [table_name])
            exists = cursor.fetchone()[0] is not None

        cache[table_name] = exists
        self._raw_table_exists_cache = cache
        return exists

    def _stat_display(self, stats_by_name: dict, key: str) -> str:
        return str((stats_by_name.get(key) or {}).get("displayValue") or "").strip()

    def _stat_int(self, stats_by_name: dict, key: str) -> Optional[int]:
        stat = stats_by_name.get(key) or {}
        value = self._parse_int(stat.get("value"))
        if value is not None:
            return value
        display_value = str(stat.get("displayValue") or "").strip()
        if "/" in display_value or "-" in display_value:
            return None
        return self._parse_int(display_value)

    def _zip_values(self, keys: list, values: list) -> dict:
        out = {}
        for idx, key in enumerate(keys):
            out[key] = values[idx] if idx < len(values) else None
        return out

    def _set_if_not_none(self, data: dict, key: str, value):
        if value is not None:
            data[key] = value

    def _parse_int_pair(self, value, sep: str) -> tuple[Optional[int], Optional[int]]:
        text = str(value or "").strip()
        if not text or text in {"-", "--"}:
            return None, None
        parts = text.split(sep, 1)
        if len(parts) != 2:
            return None, None
        return self._parse_int(parts[0]), self._parse_int(parts[1])

    def _parse_int(self, value) -> Optional[int]:
        parsed = self._parse_float(value)
        if parsed is None:
            return None
        try:
            return int(parsed)
        except (TypeError, ValueError):
            return None

    def _parse_float(self, value) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)

        text = str(value).strip()
        if not text or text in {"-", "--"}:
            return None
        match = re.search(r"[-+]?\d*\.?\d+", text.replace(",", ""))
        if not match:
            return None
        try:
            return float(match.group())
        except (TypeError, ValueError):
            return None

    def _clock_to_seconds(self, clock) -> Optional[int]:
        text = str(clock or "").strip()
        if not text or ":" not in text:
            return None
        mins, secs = text.split(":", 1)
        mins_val = self._parse_int(mins)
        secs_val = self._parse_int(secs)
        if mins_val is None or secs_val is None:
            return None
        return mins_val * 60 + secs_val

    def _fetch_week_dates(
        self, year: int, season_type: int, week: int
    ) -> Optional[str]:
        """Return 'YYYYMMDD-YYYYMMDD' date range for a week from the ESPN calendar API.

        ESPN's calendar API gives us the exact startDate/endDate for any week in any
        season, which we use to build the dates= param for the scoreboard endpoint.
        Returns None if the lookup fails (caller should fall back to year/week params).
        """
        url = ESPN_CALENDAR_URL.format(year=year, season_type=season_type, week=week)
        try:
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            cal = resp.json()
        except requests.RequestException as e:
            logger.warning(f"ESPN calendar lookup failed ({url}): {e}")
            return None

        start_raw = cal.get("startDate", "")
        end_raw = cal.get("endDate", "")
        if not start_raw or not end_raw:
            logger.warning(f"ESPN calendar response missing dates: {cal.keys()}")
            return None

        try:
            start_dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
            end_dt = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
            return f"{start_dt.strftime('%Y%m%d')}-{end_dt.strftime('%Y%m%d')}"
        except (ValueError, TypeError) as e:
            logger.warning(
                f"Could not parse calendar dates ({start_raw}, {end_raw}): {e}"
            )
            return None

    def _resolve_team(self, team_data: dict) -> Optional[Team]:
        """look up a team by espn id or abbreviation"""
        espn_id = team_data.get("id", "")
        abbr = team_data.get("abbreviation", "")

        team = Team.objects.using("nfl").filter(espn_id=espn_id).first()
        if not team and abbr:
            team = Team.objects.using("nfl").filter(abbreviation=abbr).first()
        return team

    def _resolve_venue(self, venue_data: dict) -> Optional[Venue]:
        """look up or create a venue from espn data"""
        venue_id = str(venue_data.get("id") or "").strip()
        venue_name = str(venue_data.get("fullName") or "").strip()
        if not venue_id and not venue_name:
            return None

        venue = None
        if venue_id:
            venue = Venue.objects.using("nfl").filter(espn_id=venue_id).first()

        if venue is None and venue_name:
            matches = Venue.objects.using("nfl").filter(name=venue_name).order_by("id")
            if venue_id:
                venue = matches.filter(espn_id=venue_id).first()
            if venue is None:
                venue = matches.filter(espn_id="").first() or matches.first()

        grass_flag = venue_data.get("grass")
        if grass_flag is True:
            surface = "grass"
        elif grass_flag is False:
            surface = "turf"
        else:
            surface = ""

        indoor_flag = venue_data.get("indoor")
        inferred_roof = infer_roof_type(
            venue_name=venue_name,
            current_roof=venue.roof_type if venue else "",
            espn_indoor=bool(indoor_flag) if indoor_flag is not None else None,
        )
        inferred_indoor = infer_is_indoor(inferred_roof)

        defaults = {
            "espn_id": venue_id,
            "name": venue_name,
            "city": venue_data.get("address", {}).get("city", ""),
            "state": venue_data.get("address", {}).get("state", ""),
            "roof_type": inferred_roof,
            "is_indoor": inferred_indoor,
            "surface": surface,
        }

        if venue is None:
            venue = Venue.objects.using("nfl").create(**defaults)
            return venue

        updates = []
        if venue_id and venue.espn_id != venue_id:
            venue.espn_id = venue_id
            updates.append("espn_id")
        if venue_name and venue.name != venue_name:
            venue.name = venue_name
            updates.append("name")
        city = venue_data.get("address", {}).get("city", "")
        if city and venue.city != city:
            venue.city = city
            updates.append("city")
        state = venue_data.get("address", {}).get("state", "")
        if state and venue.state != state:
            venue.state = state
            updates.append("state")
        if surface and venue.surface != surface:
            venue.surface = surface
            updates.append("surface")

        reconciled_roof = infer_roof_type(
            venue_name=venue_name or venue.name,
            current_roof=venue.roof_type,
            espn_indoor=bool(indoor_flag) if indoor_flag is not None else None,
        )
        if venue.roof_type != reconciled_roof:
            venue.roof_type = reconciled_roof
            updates.append("roof_type")

        reconciled_indoor = infer_is_indoor(reconciled_roof)
        if venue.is_indoor != reconciled_indoor:
            venue.is_indoor = reconciled_indoor
            updates.append("is_indoor")

        if updates:
            venue.save(using="nfl", update_fields=updates)
        return venue

    def _map_status(self, status: dict) -> str:
        state = status.get("type", {}).get("state", "pre")
        name = status.get("type", {}).get("name", "")
        period = status.get("period", 0)

        if state == "pre":
            return "scheduled"
        elif state == "in":
            if "HALFTIME" in name:
                return "halftime"
            if "END_PERIOD" in name:
                return "end_period"
            if "DELAYED" in name:
                return "delayed"
            return "in_progress"
        elif state == "post":
            if period > 4:
                return "final_ot"
            return "final"
        return "scheduled"

    def _map_play_type(self, espn_type: str) -> str:
        t = espn_type.lower()
        if "rush" in t:
            return "run"
        if "pass" in t and ("reception" in t or "completion" in t):
            return "pass"
        if "pass" in t and "incompletion" in t:
            return "pass"
        if "sack" in t:
            return "pass"
        if "punt" in t:
            return "punt"
        if "kickoff" in t:
            return "kickoff"
        if "field goal" in t:
            return "field_goal"
        if "extra point" in t:
            return "extra_point"
        if "two-point" in t or "two point" in t:
            return "two_point_attempt"
        if "kneel" in t:
            return "qb_kneel"
        if "spike" in t:
            return "qb_spike"
        if "penalty" in t:
            return "no_play"
        return ""

    def _map_score_type(self, abbr: str) -> str:
        mapping = {
            "TD": "TD",
            "FG": "FG",
            "PAT": "PAT",
            "XP": "PAT",
            "2PT": "2PT",
            "CONV": "2PT",
            "SF": "SFTY",
            "SAF": "SFTY",
        }
        return mapping.get(abbr.upper(), abbr.upper()[:5])

    def _map_drive_result(self, result_text: str) -> str:
        raw = str(result_text or "").strip().lower()
        if not raw:
            return ""

        normalized = raw.replace("-", " ").replace("/", " ").replace("_", " ")
        compact = "_".join(normalized.split())

        mapping = {
            "touchdown": "touchdown",
            "field_goal": "field_goal",
            "made_field_goal": "field_goal",
            "missed_field_goal": "missed_fg",
            "missed_fg": "missed_fg",
            "punt": "punt",
            "interception": "turnover",
            "fumble": "turnover",
            "turnover": "turnover",
            "turnover_on_downs": "turnover_on_downs",
            "downs": "turnover_on_downs",
            "safety": "safety",
            "end_of_half": "end_of_half",
            "end_of_game": "end_of_game",
        }
        if compact in mapping:
            return mapping[compact]

        if "touchdown" in compact:
            return "touchdown"
        if "field_goal" in compact and "miss" in compact:
            return "missed_fg"
        if "field_goal" in compact:
            return "field_goal"
        if "turnover_on_down" in compact:
            return "turnover_on_downs"
        if "turnover" in compact or "interception" in compact or "fumble" in compact:
            return "turnover"
        if "safety" in compact:
            return "safety"
        if "punt" in compact:
            return "punt"
        if "end_of_half" in compact:
            return "end_of_half"
        if "end_of_game" in compact:
            return "end_of_game"

        return compact[:20]
