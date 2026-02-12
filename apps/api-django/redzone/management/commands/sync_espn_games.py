"""
sync nfl scoreboard data from espn into django game models

use defaults for current week or pass flags for backfills and dry runs

examples:
    # sync current week
    python manage.py sync_espn_games

    # sync specific week
    python manage.py sync_espn_games --season 2025 --week 1 --season-type 2

    # sync with full summary (drives, plays, boxscore)
    python manage.py sync_espn_games --full

    # dry run
    python manage.py sync_espn_games --dry-run
"""

import json
import logging
from datetime import datetime
from typing import Optional

import requests
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from redzone.models import (
    Drive,
    Game,
    GameLeader,
    Play,
    Player,
    ScoringPlay,
    Season,
    Team,
    Venue,
)

logger = logging.getLogger(__name__)

ESPN_SCOREBOARD_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
)
ESPN_SUMMARY_URL = (
    "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary"
    "?event={event_id}"
)

SEASON_TYPE_MAP = {1: "PRE", 2: "REG", 3: "POST"}


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

        # build scoreboard url
        params = {}
        if options["season"]:
            params["year"] = options["season"]
        if options["week"]:
            params["week"] = options["week"]
        if options["season_type"]:
            params["seasontype"] = options["season_type"]

        self.stdout.write(f"Fetching ESPN scoreboard... {params or '(current week)'}")

        try:
            resp = requests.get(ESPN_SCOREBOARD_URL, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            raise CommandError(f"ESPN fetch failed: {e}")

        season_year = data.get("season", {}).get("year")
        season_type_int = data.get("season", {}).get("type", 2)
        season_type = SEASON_TYPE_MAP.get(season_type_int, "REG")
        week_number = data.get("week", {}).get("number")
        events = data.get("events", [])

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

        defaults = {
            "season": season,
            "week": week,
            "game_date": game_date,
            "game_time": game_time,
            "season_type": season_type,
            "home_team": home_team,
            "away_team": away_team,
            "venue": venue,
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

        for i, drive_data in enumerate(all_drives, 1):
            team = (
                Team.objects.using("nfl")
                .filter(abbreviation=drive_data.get("team", {}).get("abbreviation", ""))
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
                    "result": (drive_data.get("result", "").lower().replace(" ", "_")),
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
                .filter(abbreviation=sp_data.get("team", {}).get("abbreviation", ""))
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

        self.stdout.write(f"    Synced {len(all_drives)} drives, {play_sequence} plays")

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
        if not venue_data.get("id"):
            return None

        venue, _ = Venue.objects.using("nfl").get_or_create(
            espn_id=venue_data["id"],
            defaults={
                "name": venue_data.get("fullName", ""),
                "city": venue_data.get("address", {}).get("city", ""),
                "state": venue_data.get("address", {}).get("state", ""),
                "is_indoor": venue_data.get("indoor", False),
                "surface": "grass" if venue_data.get("grass") else "turf",
            },
        )
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
