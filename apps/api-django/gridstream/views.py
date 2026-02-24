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

OpenAPI prep note:
  When Swagger/OpenAPI wiring is added, annotate these ViewSets with
  drf-spectacular decorators (`@extend_schema`, `@extend_schema_view`)
  so each custom action (`live`, `plays`, `drives`, `boxscore`, etc.)
  has explicit request/response examples.
"""

import logging
from collections import defaultdict

from django.conf import settings
from django.db.models import Q, F, Sum, Count, Case, When, Value, IntegerField
from django.db.models.functions import Coalesce
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import NotFound

# Optional OpenAPI decorators.
# If drf-spectacular is not installed yet, these no-op shims let us keep
# endpoint annotation intent close to the code without breaking runtime.
try:
    from drf_spectacular.utils import extend_schema, extend_schema_view
except Exception:  # pragma: no cover - exercised only when package absent

    def extend_schema(*args, **kwargs):
        def _decorator(obj):
            return obj

        return _decorator

    def extend_schema_view(**kwargs):
        def _decorator(obj):
            return obj

        return _decorator


from .models import (
    Team,
    Venue,
    Player,
    PlayerTransaction,
    Season,
    Game,
    GameLeader,
    Drive,
    Play,
    PlayerGameStats,
    TeamGameStats,
    Playbook,
    PlaybookEntry,
    PlayerFFRanking,
    PlayerNextGenStats,
    TeamStanding,
)
from .serializers import (
    TeamListSerializer,
    TeamDetailSerializer,
    VenueSerializer,
    PlayerListSerializer,
    PlayerDetailSerializer,
    PlayerTransactionSerializer,
    SeasonSerializer,
    GameListSerializer,
    GameDetailSerializer,
    GameLeaderSerializer,
    DriveSerializer,
    PlaySerializer,
    PlayDetailSerializer,
    PlayerGameStatsSerializer,
    PlayerGameStatsCompactSerializer,
    TeamGameStatsSerializer,
    TeamStandingSerializer,
    PlaybookSerializer,
    PlaybookEntrySerializer,
    PlayerFFRankingSerializer,
    PlayerNextGenStatsSerializer,
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

    @action(detail=False, methods=["get"], url_path="advanced")
    def advanced(self, request):
        """
        GET /players/advanced/?gsis_id={gsis_id}&season={year}&week={week}

        Returns ECR (FantasyPros Expert Consensus Rankings) and NFL Next Gen
        Stats for a player in a specific week. Used by the PlayerStatsPanel to
        enrich the click-through player info with positional rankings and
        advanced tracking metrics.

        Response shape:
        {
          "ecr": {
            "position": "WR", "rank": 8.0, "rank_sd": 1.4,
            "rank_best": 5, "rank_worst": 12, "position_rank": 3
          } | null,
          "ngs_passing":   { ...metrics } | null,
          "ngs_rushing":   { ...metrics } | null,
          "ngs_receiving": { ...metrics } | null
        }
        """
        gsis_id = request.query_params.get("gsis_id", "").strip()
        season = request.query_params.get("season")
        week = request.query_params.get("week")

        if not gsis_id:
            return Response(
                {"error": "gsis_id is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            player = Player.objects.using("nfl").get(gsis_id=gsis_id)
        except Player.DoesNotExist:
            return Response(
                {
                    "ecr": None,
                    "ngs_passing": None,
                    "ngs_rushing": None,
                    "ngs_receiving": None,
                }
            )

        season_int = int(season) if season else None
        week_int = int(week) if week else None

        # ECR ranking — exact week, then nearest prior week in season, then any week in season
        ecr_data = None
        if season_int and week_int:
            ecr = (
                PlayerFFRanking.objects.using("nfl")
                .filter(player=player, season=season_int, week__lte=week_int)
                .order_by("-week")
                .first()
            )
            if ecr is None:
                # Try any week in the season (e.g. current week > game week)
                ecr = (
                    PlayerFFRanking.objects.using("nfl")
                    .filter(player=player, season=season_int)
                    .order_by("week")
                    .first()
                )
            if ecr:
                ecr_data = PlayerFFRankingSerializer(ecr).data

        # NGS — try exact week first, fall back to season aggregate (week=0)
        ngs_result = {}
        for stat_type in ("passing", "rushing", "receiving"):
            ngs = None
            if season_int and week_int:
                ngs = (
                    PlayerNextGenStats.objects.using("nfl")
                    .filter(
                        player=player,
                        season=season_int,
                        week=week_int,
                        stat_type=stat_type,
                    )
                    .first()
                )
            if ngs is None and season_int:
                # Fall back to season aggregate
                ngs = (
                    PlayerNextGenStats.objects.using("nfl")
                    .filter(
                        player=player, season=season_int, week=0, stat_type=stat_type
                    )
                    .first()
                )
            ngs_result[f"ngs_{stat_type}"] = (
                PlayerNextGenStatsSerializer(ngs).data["metrics"] if ngs else None
            )

        return Response({"ecr": ecr_data, **ngs_result})


# =============================================================================
# GAMES
# =============================================================================


@extend_schema_view(
    list=extend_schema(
        summary="List games",
        description="Scoreboard endpoint filtered by season/week/team/status.",
        tags=["games"],
    ),
    retrieve=extend_schema(
        summary="Retrieve game detail",
        description="Single-game detail payload used for Gridstream hydration.",
        tags=["games"],
    ),
)
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
                "officials",
                "injuries__team",
                "injuries__player",
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
    @extend_schema(
        summary="List live/scheduled-today games",
        description="Hydration endpoint used before WebSocket updates start.",
        tags=["games"],
    )
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
    @extend_schema(
        summary="List plays for game",
        description="Cursor-paginated play-by-play feed for a game.",
        tags=["games", "plays"],
    )
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
    @extend_schema(
        summary="List drives for game",
        description="Drive summaries for a game, optionally filterable by team/result.",
        tags=["games", "drives"],
    )
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
    @extend_schema(
        summary="Get game boxscore",
        description="Returns team stats, player stats, and leader data for one game.",
        tags=["games", "boxscore"],
    )
    @action(detail=True, methods=["get"], url_path="boxscore")
    def boxscore(self, request, pk=None):
        """
        GET /games/{id}/boxscore/

        Returns team stats and player stats grouped by team.
        Uses canonical TeamGameStats/GameLeader rows by default.
        Optional narrow fallback derivation is available only when
        GRIDSTREAM_BOXSCORE_RESILIENCE_MODE=true.
        Cached for 1 hour for completed games.
        """
        game = self.get_object()
        resilience_mode = bool(
            getattr(settings, "GRIDSTREAM_BOXSCORE_RESILIENCE_MODE", False)
        )

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

        away_abbr = game.away_team.abbreviation
        home_abbr = game.home_team.abbreviation

        def _parse_clock_seconds(clock):
            if not clock:
                return 0
            try:
                mins, secs = str(clock).split(":")
                return max(0, int(mins) * 60 + int(secs))
            except Exception:
                return 0

        def _format_clock(seconds):
            total = max(0, int(seconds))
            mins = total // 60
            secs = total % 60
            return f"{mins}:{secs:02d}"

        def _derive_team_stats_from_plays():
            plays_qs = (
                Play.objects.filter(game=game)
                .select_related("possession_team")
                .order_by("sequence")
            )
            drives_qs = Drive.objects.filter(game=game).select_related("team")

            stats = {
                away_abbr: {
                    "team_abbr": away_abbr,
                    "total_yards": 0,
                    "pass_yards": 0,
                    "rush_yards": 0,
                    "first_downs": 0,
                    "third_down_attempts": 0,
                    "third_down_conversions": 0,
                    "turnovers": 0,
                    "penalties": 0,
                    "penalty_yards": 0,
                    "sacks_made": 0,
                    "time_of_possession_seconds": 0,
                },
                home_abbr: {
                    "team_abbr": home_abbr,
                    "total_yards": 0,
                    "pass_yards": 0,
                    "rush_yards": 0,
                    "first_downs": 0,
                    "third_down_attempts": 0,
                    "third_down_conversions": 0,
                    "turnovers": 0,
                    "penalties": 0,
                    "penalty_yards": 0,
                    "sacks_made": 0,
                    "time_of_possession_seconds": 0,
                },
            }

            for drive in drives_qs:
                team_abbr = getattr(drive.team, "abbreviation", "")
                if team_abbr in stats:
                    stats[team_abbr][
                        "time_of_possession_seconds"
                    ] += _parse_clock_seconds(drive.time_elapsed)

            for play in plays_qs:
                offense_abbr = (
                    getattr(play.possession_team, "abbreviation", "")
                    if play.possession_team_id
                    else ""
                )
                if offense_abbr not in stats:
                    continue

                defense_abbr = home_abbr if offense_abbr == away_abbr else away_abbr
                offense = stats[offense_abbr]
                defense = stats[defense_abbr]

                play_type = (play.play_type or "").lower()
                yards = int(round(play.yards_gained or 0))

                if (play.down or 0) == 3:
                    offense["third_down_attempts"] += 1
                    if play.first_down or play.touchdown:
                        offense["third_down_conversions"] += 1

                if play.first_down:
                    offense["first_downs"] += 1

                if play.interception or play.fumble_lost:
                    offense["turnovers"] += 1

                if play.penalty:
                    offense["penalties"] += 1
                    offense["penalty_yards"] += max(0, int(play.penalty_yards or 0))

                if play.sack:
                    defense["sacks_made"] += 1
                    offense["pass_yards"] += yards
                    continue

                if play_type in ("pass", "two_point_attempt"):
                    if play.complete_pass or yards != 0:
                        offense["pass_yards"] += yards
                elif play_type in ("run", "rush", "qb_kneel", "qb_scramble"):
                    offense["rush_yards"] += yards

            for abbr in (away_abbr, home_abbr):
                stats[abbr]["total_yards"] = (
                    stats[abbr]["pass_yards"] + stats[abbr]["rush_yards"]
                )
                stats[abbr]["time_of_possession"] = _format_clock(
                    stats[abbr]["time_of_possession_seconds"]
                )

            return [stats[away_abbr], stats[home_abbr]]

        def _format_passing_line(row):
            comp = int(row.get("completions") or 0)
            att = int(row.get("pass_attempts") or 0)
            yds = int(row.get("passing_yards") or 0)
            td = int(row.get("passing_tds") or 0)
            ints = int(row.get("interceptions_thrown") or 0)
            parts = [f"{comp}/{att}", f"{yds} YDS"]
            if td > 0:
                parts.append(f"{td} TD")
            if ints > 0:
                parts.append(f"{ints} INT")
            return " · ".join(parts)

        def _format_rushing_line(row):
            car = int(row.get("carries") or 0)
            yds = int(row.get("rushing_yards") or 0)
            td = int(row.get("rushing_tds") or 0)
            parts = [f"{car} CAR", f"{yds} YDS"]
            if td > 0:
                parts.append(f"{td} TD")
            return " · ".join(parts)

        def _format_receiving_line(row):
            rec = int(row.get("receptions") or 0)
            yds = int(row.get("receiving_yards") or 0)
            td = int(row.get("receiving_tds") or 0)
            parts = [f"{rec} REC", f"{yds} YDS"]
            if td > 0:
                parts.append(f"{td} TD")
            return " · ".join(parts)

        def _pick_best(rows, predicate, score):
            best = None
            best_score = float("-inf")
            for row in rows:
                if not predicate(row):
                    continue
                row_score = score(row)
                if row_score > best_score:
                    best = row
                    best_score = row_score
            return best

        def _derive_leaders_from_player_stats(rows_by_team):
            result_rows = []
            for team_abbr in (away_abbr, home_abbr):
                rows = rows_by_team.get(team_abbr, [])
                if not rows:
                    continue

                passing = _pick_best(
                    rows,
                    lambda r: int(r.get("pass_attempts") or 0) > 0
                    or int(r.get("passing_yards") or 0) != 0
                    or int(r.get("passing_tds") or 0) > 0,
                    lambda r: int(r.get("passing_yards") or 0) * 10000
                    + int(r.get("passing_tds") or 0) * 100
                    + int(r.get("pass_attempts") or 0),
                )
                rushing = _pick_best(
                    rows,
                    lambda r: int(r.get("carries") or 0) > 0
                    or int(r.get("rushing_yards") or 0) != 0
                    or int(r.get("rushing_tds") or 0) > 0,
                    lambda r: int(r.get("rushing_yards") or 0) * 10000
                    + int(r.get("rushing_tds") or 0) * 100
                    + int(r.get("carries") or 0),
                )
                receiving = _pick_best(
                    rows,
                    lambda r: int(r.get("receptions") or 0) > 0
                    or int(r.get("receiving_yards") or 0) != 0
                    or int(r.get("receiving_tds") or 0) > 0,
                    lambda r: int(r.get("receiving_yards") or 0) * 10000
                    + int(r.get("receiving_tds") or 0) * 100
                    + int(r.get("receptions") or 0),
                )

                if passing:
                    result_rows.append(
                        {
                            "team_abbr": team_abbr,
                            "category": "passing",
                            "athlete_name": passing.get("player_name") or "—",
                            "display_value": _format_passing_line(passing),
                        }
                    )
                if rushing:
                    result_rows.append(
                        {
                            "team_abbr": team_abbr,
                            "category": "rushing",
                            "athlete_name": rushing.get("player_name") or "—",
                            "display_value": _format_rushing_line(rushing),
                        }
                    )
                if receiving:
                    result_rows.append(
                        {
                            "team_abbr": team_abbr,
                            "category": "receiving",
                            "athlete_name": receiving.get("player_name") or "—",
                            "display_value": _format_receiving_line(receiving),
                        }
                    )
            return result_rows

        team_stats_team_abbrs = {
            row.get("team_abbr") for row in team_stats_data if row.get("team_abbr")
        }
        team_stats_complete = (
            away_abbr in team_stats_team_abbrs and home_abbr in team_stats_team_abbrs
        )
        team_stats_source = "db"
        if resilience_mode and not team_stats_data:
            team_stats_data = _derive_team_stats_from_plays()
            team_stats_source = "derived_resilience"
            logger.warning(
                "Boxscore resilience fallback used for team stats (game_id=%s)", game.pk
            )

        leaders_qs = GameLeader.objects.filter(game=game).select_related("team")
        leaders_data = GameLeaderSerializer(leaders_qs, many=True).data
        leaders_complete = len(leaders_data) >= 6
        leaders_source = "db"
        if resilience_mode and not leaders_data:
            leaders_data = _derive_leaders_from_player_stats(dict(by_team))
            leaders_source = "derived_resilience"
            logger.warning(
                "Boxscore resilience fallback used for leaders (game_id=%s)", game.pk
            )

        result = {
            "team_stats": team_stats_data,
            "player_stats": dict(by_team),
            "leaders": leaders_data,
            "completeness": {
                "team_stats_complete": team_stats_complete,
                "player_stats_complete": len(player_stats_data) > 0,
                "leaders_complete": leaders_complete,
                "team_stats_source": team_stats_source,
                "leaders_source": leaders_source,
            },
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

    Reads persisted standings from TeamStanding rows.
    Heavily cached since standings only change when imports run.
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

        ck = cache_key("standings", str(season_year), dict(request.query_params))
        cached = cache_get(ck)
        if cached:
            return Response(cached)

        standings_qs = (
            TeamStanding.objects.filter(season_id=season_year)
            .select_related("team")
            .prefetch_related("team__logos")
        )

        conference = request.query_params.get("conference")
        if conference:
            standings_qs = standings_qs.filter(conference__iexact=conference)

        division = request.query_params.get("division")
        if division:
            standings_qs = standings_qs.filter(division__iexact=division)

        standings_qs = standings_qs.order_by(
            "conference",
            "division",
            Coalesce("div_rank", Value(999)),
            "-pct",
            "-point_diff",
            "-wins",
            "team__abbreviation",
        )

        standings = TeamStandingSerializer(standings_qs, many=True).data
        cache_set(ck, standings, TTL_LONG)
        return Response(standings)


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
