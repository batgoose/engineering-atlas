"""
Redzone Redis caching layer.

TTL strategy:
  - Completed games, historical stats, standings: 1 hour (LONG)
  - Player/team metadata: 15 minutes (MEDIUM)
  - Live game state, news feeds: 30 seconds (SHORT)
  - Schedules, season info: 6 hours (VERY_LONG)

Cache keys follow the pattern: redzone:{resource}:{identifier}:{params_hash}
"""

import hashlib
import json
import logging
from functools import wraps
from typing import Any

import redis
from django.conf import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# TTL tiers (seconds)
# ---------------------------------------------------------------------------
TTL_VERY_LONG = 60 * 60 * 6  # 6 hours  — season metadata, schedules
TTL_LONG = 60 * 60  # 1 hour   — completed games, historical stats
TTL_MEDIUM = 60 * 15  # 15 min  — player/team metadata
TTL_SHORT = 30  # 30 sec  — live game state, news
TTL_NEWS = 300  # 5 min   — news feed (matches NewsSource.cache_ttl_seconds default)

# ---------------------------------------------------------------------------
# Connection pool (lazy singleton)
# ---------------------------------------------------------------------------
_pool = None


def get_redis() -> redis.Redis:
    """Return a Redis client from the shared connection pool."""
    global _pool
    if _pool is None:
        _pool = redis.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=20,
        )
    return redis.Redis(connection_pool=_pool)


# ---------------------------------------------------------------------------
# Key helpers
# ---------------------------------------------------------------------------
def _params_hash(params: dict) -> str:
    """Deterministic short hash of query parameters for cache key suffix."""
    raw = json.dumps(params, sort_keys=True, default=str)
    return hashlib.md5(raw.encode()).hexdigest()[:10]


def cache_key(resource: str, identifier: str = "", params: dict | None = None) -> str:
    """
    Build a namespaced cache key.

    Examples:
      cache_key("games", "2025_01")           → "redzone:games:2025_01"
      cache_key("standings", params={...})     → "redzone:standings:a1b2c3d4e5"
      cache_key("news", "SEA", {"page": 1})   → "redzone:news:SEA:f6e7d8c9b0"
    """
    parts = ["redzone", resource]
    if identifier:
        parts.append(str(identifier))
    if params:
        parts.append(_params_hash(params))
    return ":".join(parts)


# ---------------------------------------------------------------------------
# Core get / set
# ---------------------------------------------------------------------------
def cache_get(key: str) -> Any | None:
    """Fetch JSON-deserialized value from Redis. Returns None on miss or error."""
    try:
        raw = get_redis().get(key)
        if raw is not None:
            return json.loads(raw)
    except (redis.RedisError, json.JSONDecodeError) as exc:
        logger.warning("Redis GET failed for %s: %s", key, exc)
    return None


def cache_set(key: str, value: Any, ttl: int = TTL_LONG) -> None:
    """Serialize value to JSON and store with a TTL."""
    try:
        get_redis().setex(key, ttl, json.dumps(value, default=str))
    except redis.RedisError as exc:
        logger.warning("Redis SET failed for %s: %s", key, exc)


def cache_delete_pattern(pattern: str) -> int:
    """Delete all keys matching a glob pattern. Returns count deleted."""
    r = get_redis()
    count = 0
    try:
        cursor = 0
        while True:
            cursor, keys = r.scan(cursor, match=pattern, count=200)
            if keys:
                count += r.delete(*keys)
            if cursor == 0:
                break
    except redis.RedisError as exc:
        logger.warning("Redis DELETE pattern failed for %s: %s", pattern, exc)
    return count


# ---------------------------------------------------------------------------
# Decorator for view-level caching
# ---------------------------------------------------------------------------
def cached_view(resource: str, ttl: int = TTL_LONG, key_func=None):
    """
    Decorator for DRF viewset list/retrieve actions.

    Usage on a ViewSet method:

        @cached_view("games", ttl=TTL_LONG)
        def list(self, request, *args, **kwargs):
            ...

    The decorator checks Redis first. On miss it calls the wrapped method,
    caches the response data, and returns normally.

    `key_func(request, *args, **kwargs)` can override key generation.
    """

    def decorator(view_method):
        @wraps(view_method)
        def wrapper(self, request, *args, **kwargs):
            # Build cache key from request path + query params
            if key_func:
                ck = key_func(request, *args, **kwargs)
            else:
                identifier = kwargs.get("pk", "") or kwargs.get("abbreviation", "")
                params = dict(request.query_params)
                ck = cache_key(resource, str(identifier), params)

            # Try cache
            cached = cache_get(ck)
            if cached is not None:
                from rest_framework.response import Response

                return Response(cached)

            # Cache miss — execute view
            response = view_method(self, request, *args, **kwargs)

            # Only cache successful responses
            if response.status_code == 200 and hasattr(response, "data"):
                cache_set(ck, response.data, ttl)

            return response

        return wrapper

    return decorator


# ---------------------------------------------------------------------------
# Invalidation helpers
# ---------------------------------------------------------------------------
def invalidate_game(game_id: int) -> None:
    """Clear all cached data related to a specific game."""
    cache_delete_pattern(f"redzone:games:{game_id}*")
    cache_delete_pattern(f"redzone:game_plays:{game_id}*")
    cache_delete_pattern(f"redzone:game_drives:{game_id}*")
    cache_delete_pattern("redzone:standings*")


def invalidate_team(abbreviation: str) -> None:
    """Clear cached data for a team."""
    cache_delete_pattern(f"redzone:teams:{abbreviation}*")
    cache_delete_pattern(f"redzone:roster:{abbreviation}*")
    cache_delete_pattern("redzone:standings*")


def invalidate_player(player_id: int) -> None:
    """Clear cached data for a player."""
    cache_delete_pattern(f"redzone:players:{player_id}*")
    cache_delete_pattern(f"redzone:gamelog:{player_id}*")
