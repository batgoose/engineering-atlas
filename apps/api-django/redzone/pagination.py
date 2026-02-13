"""
Redzone pagination classes.

Uses cursor-based pagination for the play-by-play dataset (1.2M+ rows)
and standard page-number pagination for smaller collections.
"""

from rest_framework.pagination import CursorPagination, PageNumberPagination


class StandardPagination(PageNumberPagination):
    """Default pagination for most endpoints."""

    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


class LargePagination(PageNumberPagination):
    """For endpoints that commonly return bigger result sets (game lists, rosters)."""

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class PlayPagination(CursorPagination):
    """
    Cursor pagination for play-by-play data.

    Cursor-based pagination is essential here because:
    - The plays table has 1.2M+ rows
    - OFFSET-based pagination degrades badly past page ~100
    - Plays are naturally ordered by (game, sequence)
    """

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
    ordering = "sequence"


class StatsGamelogPagination(PageNumberPagination):
    """For player gamelogs — typically a full season fits on one page."""

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 50


class FantasyLeaderPagination(PageNumberPagination):
    """Fantasy leaderboard — top N players per week/season."""

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
