"""
Gridstream API ViewSets.

Endpoints:
  /games/                       — scoreboard (by season/week)
  /games/live/                  — live game hydration for WebSocket bridge
  /games/{id}/                  — game detail
  /games/{id}/plays/            — play-by-play (cursor paginated)
  /games/{id}/drives/           — drive summaries
  /games/{id}/boxscore/         — player + team stats for a game
  /teams/                       — all teams
  /teams/{abbr}/                — team detail
  /teams/{abbr}/roster/         — current roster
  /teams/{abbr}/schedule/       — team schedule for a season
  /players/                     — player search/list
  /players/{id}/                — player profile
  /players/{id}/gamelog/         — player game log
  /standings/                   — conference/division standings
  /fantasy/leaders/             — weekly/seasonal fantasy leaders
  /seasons/                     — season metadata
  /news/{entity}/{id}/          — proxied news feeds
  /transactions/                — recent roster transactions
"""

import logging
from collections import defaultdict

from django.db.models import Q, F, Sum, Count, Case, When, Value, IntegerField
from django.db.models.functions import Coalesce
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import NotFound

from .models import (
    Team,
    Venue,
    Player,
    PlayerTransaction,
    Season,
    Game,
    Drive,
    Play,
    PlayerGameStats,
    TeamGameStats,
    Playbook,
    PlaybookEntry,
)
from .serializers import (
    TeamListSerializer,
    TeamDetailSerializer,
    TeamMinimalSerializer,
    VenueSerializer,
    PlayerListSerializer,
    PlayerDetailSerializer,
    PlayerTransactionSerializer,
    SeasonSerializer,
    GameListSerializer,
    GameDetailSerializer,
    DriveSerializer,
    PlaySerializer,
    PlayDetailSerializer,
    PlayerGameStatsSerializer,
    PlayerGameStatsCompactSerializer,
    TeamGameStatsSerializer,
    StandingsEntrySerializer,
    PlaybookSerializer,
    PlaybookEntrySerializer,
)
from .filters import (
    GameFilter,
    PlayFilter,
    DriveFilter,
    PlayerFilter,
    PlayerGameStatsFilter,
    TeamGameStatsFilter,
    PlayerTransactionFilter,
)
from .pagination import (
    StandardPagination,
    LargePagination,
    PlayPagination,
    StatsGamelogPagination,
    FantasyLeaderPagination,
)
from .cache import (
    cached_view,
    cache_key,
    cache_get,
    cache_set,
    TTL_LONG,
    TTL_MEDIUM,
    TTL_SHORT,
    TTL_VERY_LONG,
    TTL_NEWS,
)

logger = logging.getLogger(__name__)


# =============================================================================
# SEASONS
# =============================================================================


class SeasonViewSet(viewsets.ReadOnlyModelViewSet):
    """NFL season metadata."""

    queryset = Season.objects.all()
    serializer_class = SeasonSerializer
    pagination_class = None  # Only ~25 seasons — no pagination needed

    @cached_view("seasons", ttl=TTL_VERY_LONG)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def current(self, request):
        """Return the current active season."""
        season = Season.objects.filter(is_active=True).first()
        if not season:
            season = Season.objects.order_by("-year").first()
        if not season:
            raise NotFound("No seasons found.")
        return Response(SeasonSerializer(season).data)


# =============================================================================
# TEAMS
# =============================================================================


class TeamViewSet(viewsets.ReadOnlyModelViewSet):
    """
    NFL teams.

    List: all 32 active teams (+ historical if ?include_inactive=true)
    Detail: lookup by abbreviation (SEA, NE, WAS, etc.)
    """

    serializer_class = TeamListSerializer
    pagination_class = None  # 32 teams — no pagination
    lookup_field = "abbreviation"
    lookup_url_kwarg = "abbreviation"

    def get_queryset(self):
        qs = Team.objects.prefetch_related("logos")
        if not self.request.query_params.get("include_inactive"):
            qs = qs.filter(is_active=True)
        return qs

    def get_serializer_class(self):
        if self.action == "retrieve":
            return TeamDetailSerializer
        return TeamListSerializer

    @cached_view("teams", ttl=TTL_LONG)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @cached_view("teams", ttl=TTL_MEDIUM)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=["get"], url_path="roster")
    def roster(self, request, abbreviation=None):
        """
        GET /teams/{abbr}/roster/

        Returns the current roster grouped by position_group.
        Filters: ?position=QB, ?roster_status=ACT
        """
        team = self.get_object()
        players = (
            Player.objects.filter(current_team=team, is_active=True)
            .select_related("current_team")
            .order_by("position_group", "last_name")
        )

        # Apply optional filters
        position = request.query_params.get("position")
        if position:
            players = players.filter(position__iexact=position)

        roster_status = request.query_params.get("roster_status")
        if roster_status:
            players = players.filter(roster_status=roster_status)

        serializer = PlayerListSerializer(players, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="schedule")
    def schedule(self, request, abbreviation=None):
        """
        GET /teams/{abbr}/schedule/?season=2024

        Returns all games for this team in a season.
        """
        team = self.get_object()
        season_year = request.query_params.get("season")

        games = (
            Game.objects.filter(Q(home_team=team) | Q(away_team=team))
            .select_related("home_team", "away_team", "venue", "season")
            .prefetch_related("home_team__logos", "away_team__logos", "leaders__team")
            .order_by("game_date", "game_time")
        )

        if season_year:
            games = games.filter(season__year=int(season_year))

        serializer = GameListSerializer(games, many=True)
        return Response(serializer.data)


# =============================================================================
# PLAYERS
# =============================================================================


class PlayerViewSet(viewsets.ReadOnlyModelViewSet):
    """
    NFL players.

    List: paginated player search with rich filtering
    Detail: full player profile with contracts, combine, college, social
    """

    filterset_class = PlayerFilter
    pagination_class = StandardPagination

    def get_queryset(self):
        if self.action == "retrieve":
            return Player.objects.select_related(
                "current_team", "draft_team"
            ).prefetch_related(
                "current_team__logos",
                "draft_team__logos",
                "contracts__team",
                "combine_results",
                "college_history",
                "social_accounts",
            )
        return Player.objects.select_related("current_team").order_by(
            "-is_active", "last_name", "first_name"
        )

    def get_serializer_class(self):
        if self.action == "retrieve":
            return PlayerDetailSerializer
        return PlayerListSerializer

    @cached_view("players", ttl=TTL_MEDIUM)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=["get"], url_path="gamelog")
    def gamelog(self, request, pk=None):
        """
        GET /players/{id}/gamelog/?season=2024

        Per-game stats for this player, most recent first.
        """
        player = self.get_object()
        stats = (
            PlayerGameStats.objects.filter(player=player)
            .select_related("team", "opponent", "player")
            .order_by("-season_year", "-week")
        )

        # Season filter
        season = request.query_params.get("season")
        if season:
            stats = stats.filter(season_year=int(season))

        season_type = request.query_params.get("season_type")
        if season_type:
            stats = stats.filter(season_type=season_type)

        paginator = StatsGamelogPagination()
        page = paginator.paginate_queryset(stats, request)
        serializer = PlayerGameStatsSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    @action(detail=True, methods=["get"], url_path="splits")
    def splits(self, request, pk=None):
        """
        GET /players/{id}/splits/?season=2024

        Aggregated stats: home/away, by opponent, by month.
        Returns pre-aggregated data for the frontend splits tables.
        """
        player = self.get_object()
        season = request.query_params.get("season")

        stats_qs = PlayerGameStats.objects.filter(player=player)
        if season:
            stats_qs = stats_qs.filter(season_year=int(season))

        # Build cache key
        ck = cache_key("splits", str(player.pk), {"season": season})
        cached = cache_get(ck)
        if cached:
            return Response(cached)

        # Home / Away split
        home_stats = stats_qs.filter(game__home_team=F("team")).aggregate(
            games=Count("id"),
            pass_yds=Coalesce(Sum("passing_yards"), 0),
            pass_tds=Coalesce(Sum("passing_tds"), 0),
            rush_yds=Coalesce(Sum("rushing_yards"), 0),
            rush_tds=Coalesce(Sum("rushing_tds"), 0),
            rec_yds=Coalesce(Sum("receiving_yards"), 0),
            rec_tds=Coalesce(Sum("receiving_tds"), 0),
            ppr=Coalesce(Sum("fantasy_points_ppr"), 0.0),
        )

        away_stats = stats_qs.exclude(game__home_team=F("team")).aggregate(
            games=Count("id"),
            pass_yds=Coalesce(Sum("passing_yards"), 0),
            pass_tds=Coalesce(Sum("passing_tds"), 0),
            rush_yds=Coalesce(Sum("rushing_yards"), 0),
            rush_tds=Coalesce(Sum("rushing_tds"), 0),
            rec_yds=Coalesce(Sum("receiving_yards"), 0),
            rec_tds=Coalesce(Sum("receiving_tds"), 0),
            ppr=Coalesce(Sum("fantasy_points_ppr"), 0.0),
        )

        result = {
            "home": home_stats,
            "away": away_stats,
        }

        cache_set(ck, result, TTL_LONG)
        return Response(result)


# =============================================================================
# GAMES
# =============================================================================


class GameViewSet(viewsets.ReadOnlyModelViewSet):
    """
    NFL games — the central resource.

    List: scoreboard view, filterable by season/week/team/status
    Detail: full game data with scoring plays
    Nested: /games/{id}/plays/, /games/{id}/drives/, /games/{id}/boxscore/
    """

    filterset_class = GameFilter
    pagination_class = LargePagination
    lookup_field = "pk"

    def get_queryset(self):
        base = Game.objects.select_related(
            "home_team", "away_team", "venue", "season", "possession_team"
        ).prefetch_related(
            "home_team__logos",
            "away_team__logos",
            "leaders__team",
        )

        if self.action == "retrieve":
            base = base.prefetch_related(
                "links",
                "hashtags",
                "scoring_plays__team",
            )

        return base.order_by("-game_date", "-game_time")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return GameDetailSerializer
        return GameListSerializer

    def list(self, request, *args, **kwargs):
        """
        GET /games/?season=2024&week=1

        Scoreboard endpoint. Caches completed weeks for 1 hour,
        current/live weeks for 30 seconds.
        """
        season = request.query_params.get("season")
        week = request.query_params.get("week")
        status_filter = request.query_params.get("status")

        # Determine TTL based on whether we're looking at completed games
        ttl = TTL_LONG
        if status_filter in ("in_progress", "halftime", "scheduled"):
            ttl = TTL_SHORT

        ck = cache_key("games", "", dict(request.query_params))
        cached = cache_get(ck)
        if cached:
            return Response(cached)

        response = super().list(request, *args, **kwargs)

        if response.status_code == 200:
            cache_set(ck, response.data, ttl)

        return response

    @cached_view("games", ttl=TTL_LONG)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    # -----------------------------------------------------------------
    # LIVE HYDRATION — the WebSocket bridge endpoint
    # -----------------------------------------------------------------
    @action(detail=False, methods=["get"], url_path="live")
    def live(self, request):
        """
        GET /games/live/

        Returns all games currently in progress, at halftime, or scheduled
        for today. This is the hydration endpoint — the frontend calls this
        on page load, renders the scoreboard with server data, then the
        Gridstream WebSocket takes over for real-time updates.

        Very short cache TTL (30s) since these games are actively updating.
        """
        ck = cache_key("games_live")
        cached = cache_get(ck)
        if cached:
            return Response(cached)

        live_statuses = ["in_progress", "halftime", "end_period", "delayed"]

        # Get today's games + any still in progress from previous days
        from django.utils import timezone

        today = timezone.localdate()

        games = (
            self.get_queryset()
            .filter(
                Q(status__in=live_statuses) | Q(game_date=today, status="scheduled")
            )
            .order_by("game_time", "game_date")
        )

        serializer = GameListSerializer(games, many=True)
        data = serializer.data

        cache_set(ck, data, TTL_SHORT)
        return Response(data)

    # -----------------------------------------------------------------
    # PLAYS — nested under game
    # -----------------------------------------------------------------
    @action(detail=True, methods=["get"], url_path="plays")
    def plays(self, request, pk=None):
        """
        GET /games/{id}/plays/?quarter=4&play_type=pass

        Cursor-paginated play-by-play data.
        Uses PlaySerializer for standard view, PlayDetailSerializer
        if ?detail=true is passed.
        """
        game = self.get_object()

        plays_qs = (
            Play.objects.filter(game=game)
            .select_related("possession_team", "defensive_team")
            .order_by("sequence")
        )

        # Apply filters
        filterset = PlayFilter(request.query_params, queryset=plays_qs)
        plays_qs = filterset.qs

        # Choose serializer
        use_detail = request.query_params.get("detail", "").lower() == "true"
        serializer_class = PlayDetailSerializer if use_detail else PlaySerializer

        paginator = PlayPagination()
        page = paginator.paginate_queryset(plays_qs, request)
        serializer = serializer_class(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    # -----------------------------------------------------------------
    # DRIVES — nested under game
    # -----------------------------------------------------------------
    @action(detail=True, methods=["get"], url_path="drives")
    def drives(self, request, pk=None):
        """
        GET /games/{id}/drives/

        Drive summaries for the game, optionally filtered by team or result.
        """
        game = self.get_object()

        drives_qs = (
            Drive.objects.filter(game=game)
            .select_related("team")
            .order_by("drive_number")
        )

        filterset = DriveFilter(request.query_params, queryset=drives_qs)
        drives_qs = filterset.qs

        serializer = DriveSerializer(drives_qs, many=True)
        return Response(serializer.data)

    # -----------------------------------------------------------------
    # BOXSCORE — nested under game
    # -----------------------------------------------------------------
    @action(detail=True, methods=["get"], url_path="boxscore")
    def boxscore(self, request, pk=None):
        """
        GET /games/{id}/boxscore/

        Returns team stats and player stats grouped by team.
        Cached for 1 hour for completed games.
        """
        game = self.get_object()

        ck = cache_key("boxscore", str(game.pk))
        cached = cache_get(ck)
        if cached:
            return Response(cached)

        # Team stats
        team_stats = TeamGameStats.objects.filter(game=game).select_related(
            "team", "opponent"
        )
        team_stats_data = TeamGameStatsSerializer(team_stats, many=True).data

        # Player stats — grouped by team, sorted by fantasy points
        player_stats = (
            PlayerGameStats.objects.filter(game=game)
            .select_related("player", "team", "opponent")
            .order_by("team", "-fantasy_points_ppr")
        )

        player_stats_data = PlayerGameStatsSerializer(player_stats, many=True).data

        # Group player stats by team
        by_team = defaultdict(list)
        for ps in player_stats_data:
            by_team[ps["team_abbr"]].append(ps)

        result = {
            "team_stats": team_stats_data,
            "player_stats": dict(by_team),
        }

        # Long TTL for completed games, short for live
        ttl = TTL_LONG if game.status in ("final", "final_ot") else TTL_SHORT
        cache_set(ck, result, ttl)

        return Response(result)


# =============================================================================
# STANDINGS
# =============================================================================


class StandingsViewSet(viewsets.ViewSet):
    """
    GET /standings/?season=2024

    Computes conference/division standings from game results.
    Heavily cached since standings only change after games complete.
    """

    def list(self, request):
        season_year = request.query_params.get("season")
        if not season_year:
            # Default to current or most recent season
            season = Season.objects.filter(is_active=True).first()
            if not season:
                season = Season.objects.order_by("-year").first()
            if not season:
                return Response([])
            season_year = season.year
        else:
            season_year = int(season_year)

        ck = cache_key("standings", str(season_year))
        cached = cache_get(ck)
        if cached:
            return Response(cached)

        standings = self._compute_standings(season_year)
        cache_set(ck, standings, TTL_LONG)
        return Response(standings)

    def _compute_standings(self, season_year):
        """Build standings from completed regular-season games."""

        teams = Team.objects.filter(is_active=True).prefetch_related("logos")
        team_map = {t.pk: t for t in teams}

        # All completed regular season games for the year
        games = Game.objects.filter(
            season__year=season_year,
            season_type="REG",
            status__in=["final", "final_ot"],
        ).select_related("home_team", "away_team")

        # Initialize records
        records = {}
        for team in teams:
            records[team.pk] = {
                "team": team,
                "conference": team.conference,
                "division": team.division,
                "wins": 0,
                "losses": 0,
                "ties": 0,
                "division_wins": 0,
                "division_losses": 0,
                "conference_wins": 0,
                "conference_losses": 0,
                "points_for": 0,
                "points_against": 0,
                "results": [],  # for streak / last_5 calc
            }

        for game in games:
            home_id = game.home_team_id
            away_id = game.away_team_id

            if home_id not in records or away_id not in records:
                continue

            home_rec = records[home_id]
            away_rec = records[away_id]

            home_rec["points_for"] += game.home_score
            home_rec["points_against"] += game.away_score
            away_rec["points_for"] += game.away_score
            away_rec["points_against"] += game.home_score

            is_div = game.is_division_game
            same_conf = (
                team_map.get(home_id, None)
                and team_map.get(away_id, None)
                and team_map[home_id].conference == team_map[away_id].conference
            )

            if game.home_score > game.away_score:
                home_rec["wins"] += 1
                home_rec["results"].append("W")
                away_rec["losses"] += 1
                away_rec["results"].append("L")
                if is_div:
                    home_rec["division_wins"] += 1
                    away_rec["division_losses"] += 1
                if same_conf:
                    home_rec["conference_wins"] += 1
                    away_rec["conference_losses"] += 1
            elif game.away_score > game.home_score:
                away_rec["wins"] += 1
                away_rec["results"].append("W")
                home_rec["losses"] += 1
                home_rec["results"].append("L")
                if is_div:
                    away_rec["division_wins"] += 1
                    home_rec["division_losses"] += 1
                if same_conf:
                    away_rec["conference_wins"] += 1
                    home_rec["conference_losses"] += 1
            else:
                home_rec["ties"] += 1
                home_rec["results"].append("T")
                away_rec["ties"] += 1
                away_rec["results"].append("T")

        # Compute derived fields and serialize
        standings = []
        for rec in records.values():
            total = rec["wins"] + rec["losses"] + rec["ties"]
            rec["win_pct"] = (
                round((rec["wins"] + rec["ties"] * 0.5) / total, 3) if total else 0.0
            )
            rec["point_diff"] = rec["points_for"] - rec["points_against"]

            # Streak
            results = rec["results"]
            streak = ""
            if results:
                last = results[-1]
                count = 0
                for r in reversed(results):
                    if r == last:
                        count += 1
                    else:
                        break
                streak = f"{last}{count}"
            rec["streak"] = streak

            # Last 5
            last_5 = results[-5:] if results else []
            w5 = last_5.count("W")
            l5 = last_5.count("L")
            rec["last_5"] = f"{w5}-{l5}"

            # Serialize team
            rec["team"] = TeamMinimalSerializer(rec["team"]).data
            del rec["results"]

            standings.append(rec)

        # Sort by division, then win pct, then point diff
        standings.sort(
            key=lambda x: (
                x["conference"],
                x["division"],
                -x["win_pct"],
                -x["point_diff"],
            )
        )

        return standings


# =============================================================================
# FANTASY LEADERS
# =============================================================================


class FantasyLeadersViewSet(viewsets.ViewSet):
    """
    GET /fantasy/leaders/?season=2024&week=1&scoring=ppr&position=QB

    Fantasy points leaderboard. Supports weekly or season-total views.
    """

    def list(self, request):
        season = request.query_params.get("season")
        week = request.query_params.get("week")
        scoring = request.query_params.get("scoring", "ppr")
        position = request.query_params.get("position")
        position_group = request.query_params.get("position_group")

        # Map scoring format to field
        scoring_field = {
            "standard": "fantasy_points_standard",
            "ppr": "fantasy_points_ppr",
            "half_ppr": "fantasy_points_half_ppr",
        }.get(scoring, "fantasy_points_ppr")

        ck = cache_key("fantasy_leaders", "", dict(request.query_params))
        cached = cache_get(ck)
        if cached:
            return Response(cached)

        if week:
            # Weekly leaders — single-game stats
            data = self._weekly_leaders(
                season, week, scoring_field, position, position_group
            )
        else:
            # Season totals
            data = self._season_leaders(season, scoring_field, position, position_group)

        cache_set(ck, data, TTL_LONG)
        return Response(data)

    def _weekly_leaders(self, season, week, scoring_field, position, position_group):
        qs = PlayerGameStats.objects.select_related("player", "team").order_by(
            f"-{scoring_field}"
        )

        if season:
            qs = qs.filter(season_year=int(season))
        if week:
            qs = qs.filter(week=int(week))
        if position:
            qs = qs.filter(player__position__iexact=position)
        if position_group:
            qs = qs.filter(player__position_group__iexact=position_group)

        # Only include players who actually played
        qs = qs.exclude(**{scoring_field: None}).exclude(**{scoring_field: 0})

        paginator = FantasyLeaderPagination()
        page = paginator.paginate_queryset(qs, self.request)
        return PlayerGameStatsCompactSerializer(page, many=True).data

    def _season_leaders(self, season, scoring_field, position, position_group):
        qs = PlayerGameStats.objects.filter(season_type="REG").values(
            "player",
            "player__display_name",
            "player__position",
            "player__headshot_url",
            "team__abbreviation",
        )

        if season:
            qs = qs.filter(season_year=int(season))
        if position:
            qs = qs.filter(player__position__iexact=position)
        if position_group:
            qs = qs.filter(player__position_group__iexact=position_group)

        qs = qs.annotate(
            total_points=Sum(scoring_field),
            games_played=Count("id"),
            total_pass_yds=Sum("passing_yards"),
            total_pass_tds=Sum("passing_tds"),
            total_rush_yds=Sum("rushing_yards"),
            total_rush_tds=Sum("rushing_tds"),
            total_rec=Sum("receptions"),
            total_rec_yds=Sum("receiving_yards"),
            total_rec_tds=Sum("receiving_tds"),
        ).order_by("-total_points")[:100]

        # Reshape for frontend
        results = []
        for row in qs:
            results.append(
                {
                    "player": row["player"],
                    "player_name": row["player__display_name"],
                    "player_position": row["player__position"],
                    "player_headshot": row["player__headshot_url"],
                    "team_abbr": row["team__abbreviation"],
                    "games_played": row["games_played"],
                    "total_points": round(row["total_points"] or 0, 2),
                    "ppg": round(
                        (row["total_points"] or 0) / max(row["games_played"], 1), 2
                    ),
                    "passing_yards": row["total_pass_yds"] or 0,
                    "passing_tds": row["total_pass_tds"] or 0,
                    "rushing_yards": row["total_rush_yds"] or 0,
                    "rushing_tds": row["total_rush_tds"] or 0,
                    "receptions": row["total_rec"] or 0,
                    "receiving_yards": row["total_rec_yds"] or 0,
                    "receiving_tds": row["total_rec_tds"] or 0,
                }
            )

        return results


# =============================================================================
# TRANSACTIONS
# =============================================================================


class TransactionViewSet(viewsets.ReadOnlyModelViewSet):
    """Recent roster transactions — filterable by team, type, date range."""

    serializer_class = PlayerTransactionSerializer
    filterset_class = PlayerTransactionFilter
    pagination_class = StandardPagination

    def get_queryset(self):
        return PlayerTransaction.objects.select_related(
            "player", "from_team", "to_team"
        ).order_by("-date")


# =============================================================================
# VENUES
# =============================================================================


class VenueViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Venue.objects.all()
    serializer_class = VenueSerializer
    pagination_class = None

    @cached_view("venues", ttl=TTL_VERY_LONG)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)


# =============================================================================
# PLAYBOOK (Simulation)
# =============================================================================


class PlaybookViewSet(viewsets.ReadOnlyModelViewSet):
    """Curated playbooks for simulation/testing."""

    queryset = Playbook.objects.all()
    serializer_class = PlaybookSerializer
    pagination_class = StandardPagination

    @action(detail=True, methods=["get"], url_path="entries")
    def entries(self, request, pk=None):
        """GET /playbooks/{id}/entries/ — ordered plays in this playbook."""
        playbook = self.get_object()
        entries = (
            PlaybookEntry.objects.filter(playbook=playbook)
            .select_related("play__possession_team", "play__game")
            .order_by("sequence")
        )

        serializer = PlaybookEntrySerializer(entries, many=True)
        return Response(serializer.data)
