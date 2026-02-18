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
      /players/?position_group=WR&is_active=true
      /players/?search=mahomes
    """

    team = django_filters.CharFilter(
        field_name="current_team__abbreviation", lookup_expr="iexact"
    )
    position = django_filters.CharFilter(lookup_expr="iexact")
    position_group = django_filters.CharFilter(lookup_expr="iexact")
    roster_status = django_filters.CharFilter()
    is_active = django_filters.BooleanFilter()
    draft_year = django_filters.NumberFilter()
    college = django_filters.CharFilter(lookup_expr="icontains")

    search = django_filters.CharFilter(method="filter_search")

    class Meta:
        model = Player
        fields = []

    def filter_search(self, queryset, name, value):
        """Full-text-ish search across name fields."""
        return queryset.filter(
            Q(display_name__icontains=value)
            | Q(first_name__icontains=value)
            | Q(last_name__icontains=value)
            | Q(gsis_id__iexact=value)
            | Q(espn_id__iexact=value)
        )


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
    """Filter transactions by type, team, date range."""

    transaction_type = django_filters.CharFilter()
    team = django_filters.CharFilter(method="filter_team")
    season = django_filters.NumberFilter()
    date_from = django_filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="date", lookup_expr="lte")

    class Meta:
        model = PlayerTransaction
        fields = []

    def filter_team(self, queryset, name, value):
        abbr = value.upper()
        return queryset.filter(
            Q(from_team__abbreviation=abbr) | Q(to_team__abbreviation=abbr)
        )
