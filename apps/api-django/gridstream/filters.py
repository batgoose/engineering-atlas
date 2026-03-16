"""
Gridstream filter classes.

Provides rich filtering for the API endpoints, especially for the
play-by-play and stats tables which are the largest datasets.

OpenAPI prep note:
  If/when schema generation is enabled, mirror these filter fields in
  operation parameter docs so frontend query-builder tooling can consume
  them directly.
"""

import django_filters
from django.db.models import Q
from .models import (
    Game,
    Play,
    Drive,
    Player,
    PlayerGameStats,
    TeamGameStats,
    PlayerTransaction,
)


class GameFilter(django_filters.FilterSet):
    """
    Filter games by season, week, team, status, and date range.

    Examples:
      /games/?season=2024&week=1
      /games/?season=2024&season_type=POST
      /games/?team=SEA
      /games/?status=in_progress
      /games/?date_from=2024-09-05&date_to=2024-09-10
    """

    season = django_filters.NumberFilter(field_name="season__year")
    week = django_filters.NumberFilter()
    season_type = django_filters.CharFilter()
    status = django_filters.CharFilter()
    espn_event_id = django_filters.CharFilter(lookup_expr="exact")
    nflverse_game_id = django_filters.CharFilter(lookup_expr="exact")

    team = django_filters.CharFilter(method="filter_team")
    home_team = django_filters.CharFilter(
        field_name="home_team__abbreviation", lookup_expr="iexact"
    )
    away_team = django_filters.CharFilter(
        field_name="away_team__abbreviation", lookup_expr="iexact"
    )

    date_from = django_filters.DateFilter(field_name="game_date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="game_date", lookup_expr="lte")

    is_division_game = django_filters.BooleanFilter()

    class Meta:
        model = Game
        fields = []

    def filter_team(self, queryset, name, value):
        """Filter where team is either home or away."""
        abbr = value.upper()
        return queryset.filter(
            Q(home_team__abbreviation=abbr) | Q(away_team__abbreviation=abbr)
        )


class PlayFilter(django_filters.FilterSet):
    """
    Filter plays within a game or across games.

    Designed for both play-by-play views and analytical queries.

    Examples:
      /games/{id}/plays/?quarter=4&play_type=pass
      /games/{id}/plays/?down=3&touchdown=true
      /games/{id}/plays/?drive={drive_id}
    """

    quarter = django_filters.NumberFilter()
    play_type = django_filters.CharFilter()
    down = django_filters.NumberFilter()
    drive = django_filters.NumberFilter(field_name="drive_id")

    touchdown = django_filters.BooleanFilter()
    interception = django_filters.BooleanFilter()
    fumble = django_filters.BooleanFilter()
    sack = django_filters.BooleanFilter()
    penalty = django_filters.BooleanFilter()
    first_down = django_filters.BooleanFilter()
    is_scoring_play = django_filters.BooleanFilter()

    possession_team = django_filters.CharFilter(
        field_name="possession_team__abbreviation", lookup_expr="iexact"
    )

    # Analytics range filters
    epa_min = django_filters.NumberFilter(field_name="epa", lookup_expr="gte")
    epa_max = django_filters.NumberFilter(field_name="epa", lookup_expr="lte")

    class Meta:
        model = Play
        fields = []


class DriveFilter(django_filters.FilterSet):
    """Filter drives within a game."""

    team = django_filters.CharFilter(
        field_name="team__abbreviation", lookup_expr="iexact"
    )
    result = django_filters.CharFilter()
    is_score = django_filters.BooleanFilter()
    quarter = django_filters.NumberFilter(field_name="start_quarter")

    class Meta:
        model = Drive
        fields = []


class PlayerFilter(django_filters.FilterSet):
    """
    Filter players by team, position, status, draft info.

    Examples:
      /players/?team=SEA&position=QB
      /players/?team_not=SEA
      /players/?position_group=WR&is_active=true
      /players/?search=mahomes
    """

    team = django_filters.CharFilter(method="filter_team")
    team_not = django_filters.CharFilter(method="filter_team_not")
    position = django_filters.CharFilter(method="filter_position")
    position_group = django_filters.CharFilter(lookup_expr="iexact")
    roster_status = django_filters.CharFilter(method="filter_roster_status")
    is_active = django_filters.BooleanFilter(method="filter_is_active")
    draft_year = django_filters.CharFilter(method="filter_draft_year")
    season = django_filters.CharFilter(method="filter_season")
    college = django_filters.CharFilter(lookup_expr="icontains")

    search = django_filters.CharFilter(method="filter_search")

    POSITION_FACET_ORDER = [
        "QB",
        "RB",
        "WR",
        "TE",
        "FB",
        "OL",
        "C",
        "G",
        "T",
        "K",
        "P",
        "LS",
        "DL",
        "EDGE",
        "DE",
        "DT",
        "NT",
        "LB",
        "OLB",
        "ILB",
        "MLB",
        "CB",
        "S",
        "FS",
        "SS",
        "DB",
    ]

    OL_CENTER_CODES = {"C"}
    OL_GUARD_CODES = {"G", "OG", "LG", "RG"}
    OL_TACKLE_CODES = {"T", "OT", "LT", "RT"}
    OL_ALL_CODES = OL_CENTER_CODES | OL_GUARD_CODES | OL_TACKLE_CODES | {"OL"}
    POSITION_ALIASES = {
        "OL": OL_ALL_CODES,
        "DL": {"DL", "DE", "DT", "NT", "EDGE"},
        "LB": {"LB", "OLB", "ILB", "MLB"},
        "DB": {"DB", "CB", "S", "FS", "SS"},
        "S": {"S", "FS", "SS"},
        "DE": {"DE", "EDGE"},
        "EDGE": {"EDGE", "DE"},
        "K": {"K"},
        "P": {"P"},
        "LS": {"LS"},
    }
    # League-inactive scope should only capture out-of-league statuses.
    # Game-day inactive players (INA) are still in-league and should remain
    # visible under League Active unless explicitly filtered by roster status.
    INACTIVE_ROSTER_CODES = {"RET", "CUT"}

    class Meta:
        model = Player
        fields = []

    @staticmethod
    def _parse_team_values(value):
        return {
            token.strip().upper()
            for token in str(value or "").split(",")
            if token and token.strip()
        }

    @staticmethod
    def _parse_token_values(value):
        return {
            token.strip().upper()
            for token in str(value or "").split(",")
            if token and token.strip()
        }

    @staticmethod
    def _parse_int_values(value):
        values = set()
        for token in str(value or "").split(","):
            token = token.strip()
            if not token:
                continue
            try:
                values.add(int(token))
            except (TypeError, ValueError):
                continue
        return values

    @staticmethod
    def _parse_positive_int(value):
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    def _parse_stats_scope(self):
        if not getattr(self, "request", None):
            return None, None
        stats_season = self._parse_positive_int(
            self.request.query_params.get("stats_season")
        )
        stats_week = self._parse_positive_int(
            self.request.query_params.get("stats_week")
        )
        if stats_season is None:
            return None, None
        return stats_season, stats_week

    @classmethod
    def position_clause_for_token(cls, token):
        token = str(token or "").strip().upper()
        if not token:
            return Q()

        if token == "C":
            return (
                Q(position__in=cls.OL_CENTER_CODES)
                | Q(position_group__in=cls.OL_CENTER_CODES)
                | Q(depth_chart_position__in=cls.OL_CENTER_CODES)
            )

        if token == "G":
            return (
                Q(position__in=cls.OL_GUARD_CODES)
                | Q(position_group__in=cls.OL_GUARD_CODES)
                | Q(depth_chart_position__in=cls.OL_GUARD_CODES)
            )

        if token == "T":
            # Tackle slice:
            # 1) explicit tackle labels, or
            # 2) OL-group players that are not already marked center/guard.
            return (
                Q(position__in=cls.OL_TACKLE_CODES)
                | Q(position_group__in=cls.OL_TACKLE_CODES)
                | Q(depth_chart_position__in=cls.OL_TACKLE_CODES)
                | Q(position="OL")
                | (
                    Q(position_group="OL")
                    & ~Q(position__in=(cls.OL_CENTER_CODES | cls.OL_GUARD_CODES))
                )
            )

        expanded = cls.POSITION_ALIASES.get(token, {token})
        return (
            Q(position__in=expanded)
            | Q(position_group__in=expanded)
            | Q(depth_chart_position__in=expanded)
        )

    def filter_team(self, queryset, name, value):
        teams = self._parse_team_values(value)
        if not teams:
            return queryset

        include_free_agents = "FA" in teams
        active_teams = {abbr for abbr in teams if abbr != "FA"}
        stats_season, stats_week = self._parse_stats_scope()

        stats_team_player_ids = None
        if active_teams and stats_season is not None:
            stats_team_rows = PlayerGameStats.objects.filter(
                team__abbreviation__in=active_teams,
                season_year=stats_season,
            )
            if stats_week is not None:
                stats_team_rows = stats_team_rows.filter(week=stats_week)
            stats_team_player_ids = stats_team_rows.values("player_id")

        if include_free_agents and active_teams:
            team_clause = Q(current_team__abbreviation__in=active_teams) | Q(
                current_team__isnull=True
            )
            if stats_team_player_ids is not None:
                team_clause |= Q(pk__in=stats_team_player_ids)
            return queryset.filter(team_clause)
        if include_free_agents:
            return queryset.filter(current_team__isnull=True)
        if stats_team_player_ids is not None:
            return queryset.filter(
                Q(current_team__abbreviation__in=active_teams)
                | Q(pk__in=stats_team_player_ids)
            )
        return queryset.filter(current_team__abbreviation__in=active_teams)

    def filter_team_not(self, queryset, name, value):
        teams = self._parse_team_values(value)
        if not teams:
            return queryset

        exclude_free_agents = "FA" in teams
        active_teams = {abbr for abbr in teams if abbr != "FA"}
        stats_season, stats_week = self._parse_stats_scope()
        filtered = queryset
        if active_teams:
            filtered = filtered.exclude(current_team__abbreviation__in=active_teams)
            if stats_season is not None:
                stats_exclude_rows = PlayerGameStats.objects.filter(
                    team__abbreviation__in=active_teams,
                    season_year=stats_season,
                )
                if stats_week is not None:
                    stats_exclude_rows = stats_exclude_rows.filter(week=stats_week)
                filtered = filtered.exclude(
                    pk__in=stats_exclude_rows.values("player_id")
                )
        if exclude_free_agents:
            filtered = filtered.exclude(current_team__isnull=True)
        return filtered

    def filter_position(self, queryset, name, value):
        """
        Position filter with alias expansion for common OL/defense shorthand.

        Example: position=T matches OL tackle records even if source data stores
        OL data without explicit T labels.
        """
        tokens = self._parse_token_values(value)
        if not tokens:
            return queryset

        clause = Q()
        for token in tokens:
            clause |= self.position_clause_for_token(token)
        return queryset.filter(clause)

    def filter_roster_status(self, queryset, name, value):
        """
        Supports human labels from UI + code values.
        """
        tokens = self._parse_token_values(value)
        if not tokens:
            return queryset

        clause = Q()
        for token in tokens:
            if token in {"FREE AGENT", "FA", "UFA", "RFA"}:
                clause |= Q(current_team__isnull=True) & self.active_league_clause()
                continue
            if token in {"ACTIVE", "ACT"}:
                clause |= Q(
                    roster_status="ACT", current_team__isnull=False, is_active=True
                )
                continue
            if token in {"INACTIVE", "INA"}:
                clause |= Q(roster_status="INA") | self.inactive_league_clause()
                continue
            if token in {"RETIRED", "RET"}:
                clause |= Q(roster_status="RET")
                continue
            if token in {"RELEASED", "CUT"}:
                clause |= Q(roster_status="CUT")
                continue
            if token in {"INJURED RESERVE", "RESERVE/INJURED", "IR", "RES"}:
                clause |= Q(roster_status="RES")
                continue
            if token in {"PRACTICE SQUAD", "PRACTICE", "PRA"}:
                clause |= Q(roster_status="PRA")
                continue
            clause |= Q(roster_status=token)
        return queryset.filter(clause)

    def filter_draft_year(self, queryset, name, value):
        years = self._parse_int_values(value)
        if not years:
            return queryset
        return queryset.filter(draft_year__in=years)

    @classmethod
    def active_league_clause(cls):
        """
        Active league scope should exclude out-of-league statuses even if stale
        source data still marks is_active=True.
        """
        return Q(is_active=True) & ~Q(roster_status__in=cls.INACTIVE_ROSTER_CODES)

    @classmethod
    def inactive_league_clause(cls):
        return Q(is_active=False) | Q(roster_status__in=cls.INACTIVE_ROSTER_CODES)

    def filter_is_active(self, queryset, name, value):
        if value is True:
            return queryset.filter(self.active_league_clause())
        if value is False:
            return queryset.filter(self.inactive_league_clause())
        return queryset

    def filter_search(self, queryset, name, value):
        """Full-text-ish search across name fields."""
        return queryset.filter(
            Q(display_name__icontains=value)
            | Q(first_name__icontains=value)
            | Q(last_name__icontains=value)
            | Q(gsis_id__iexact=value)
            | Q(espn_id__iexact=value)
        )

    def filter_season(self, queryset, name, value):
        """
        Players who appeared in at least one game in the requested season list.

        Uses modeled PlayerGameStats linkage rather than entry-year heuristics.
        """
        seasons = self._parse_int_values(value)
        if not seasons:
            return queryset
        player_ids = PlayerGameStats.objects.filter(season_year__in=seasons).values(
            "player_id"
        )
        return queryset.filter(pk__in=player_ids)


class PlayerGameStatsFilter(django_filters.FilterSet):
    """
    Filter player game stats — for gamelogs and box scores.

    Examples:
      /players/{id}/gamelog/?season=2024
      /fantasy/leaders/?season=2024&week=1&position=QB
    """

    season = django_filters.NumberFilter(field_name="season_year")
    week = django_filters.NumberFilter()
    season_type = django_filters.CharFilter()
    team = django_filters.CharFilter(
        field_name="team__abbreviation", lookup_expr="iexact"
    )
    position = django_filters.CharFilter(
        field_name="player__position", lookup_expr="iexact"
    )
    position_group = django_filters.CharFilter(
        field_name="player__position_group", lookup_expr="iexact"
    )

    # Fantasy point minimums (useful for filtering out zero-stat rows)
    min_ppr = django_filters.NumberFilter(
        field_name="fantasy_points_ppr", lookup_expr="gte"
    )

    class Meta:
        model = PlayerGameStats
        fields = []


class TeamGameStatsFilter(django_filters.FilterSet):
    season = django_filters.NumberFilter(field_name="season_year")
    week = django_filters.NumberFilter()

    class Meta:
        model = TeamGameStats
        fields = []


class PlayerTransactionFilter(django_filters.FilterSet):
    """Filter transactions by type, team, date range, or position group."""

    transaction_type = django_filters.CharFilter()
    team = django_filters.CharFilter(method="filter_team")
    season = django_filters.NumberFilter()
    date_from = django_filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="date", lookup_expr="lte")
    position = django_filters.CharFilter(method="filter_position")

    class Meta:
        model = PlayerTransaction
        fields = []

    def filter_team(self, queryset, name, value):
        abbr = value.upper()
        return queryset.filter(
            Q(from_team__abbreviation=abbr) | Q(to_team__abbreviation=abbr)
        )

    def filter_position(self, queryset, name, value):
        pos = value.upper()
        # Expand grouped positions to all DB variants
        _groups = {
            "OL": ["OL", "T", "G", "C", "LS", "FB"],
            "DL": ["DL", "DE", "DT", "NT"],
            "DB": ["DB", "CB", "S", "SS", "FS"],
            "LB": ["LB", "ILB", "OLB", "MLB"],
            "K": ["K", "P"],
        }
        positions = _groups.get(pos, [pos])
        return queryset.filter(player__position__in=positions)
