"""Tests for the Redis caching layer."""

import pytest
from unittest.mock import patch, MagicMock
from gridstream.cache import (
    cache_key,
    cache_get,
    cache_set,
    cache_delete_pattern,
    cached_view,
    invalidate_game,
    invalidate_team,
    invalidate_player,
    TTL_LONG,
    TTL_SHORT,
    _params_hash,
)


class TestCacheKeyGeneration:
    def test_simple_key(self):
        key = cache_key("games", "2024_01")
        assert key == "gridstream:games:2024_01"

    def test_key_with_no_identifier(self):
        key = cache_key("standings")
        assert key == "gridstream:standings"

    def test_key_with_params(self):
        key = cache_key("games", "", {"season": 2024, "week": 1})
        assert key.startswith("gridstream:games:")
        # Should include a hash suffix
        parts = key.split(":")
        assert len(parts) == 3

    def test_key_with_identifier_and_params(self):
        key = cache_key("news", "SEA", {"page": 1})
        assert key.startswith("gridstream:news:SEA:")

    def test_params_hash_is_deterministic(self):
        params = {"season": 2024, "week": 1}
        h1 = _params_hash(params)
        h2 = _params_hash(params)
        assert h1 == h2

    def test_params_hash_is_order_independent(self):
        h1 = _params_hash({"a": 1, "b": 2})
        h2 = _params_hash({"b": 2, "a": 1})
        assert h1 == h2

    def test_different_params_produce_different_hashes(self):
        h1 = _params_hash({"season": 2024})
        h2 = _params_hash({"season": 2023})
        assert h1 != h2


class TestCacheGetSet:
    @patch("gridstream.cache.get_redis")
    def test_cache_set_and_get(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        # Set
        mock_redis.setex.return_value = True
        cache_set("test_key", {"foo": "bar"}, TTL_LONG)
        mock_redis.setex.assert_called_once()

        # Verify the TTL and key were passed correctly
        call_args = mock_redis.setex.call_args
        assert call_args[0][0] == "test_key"
        assert call_args[0][1] == TTL_LONG

    @patch("gridstream.cache.get_redis")
    def test_cache_get_returns_none_on_miss(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.get.return_value = None

        result = cache_get("nonexistent")
        assert result is None

    @patch("gridstream.cache.get_redis")
    def test_cache_get_returns_deserialized_data(self, mock_get_redis):
        import json

        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.get.return_value = json.dumps({"score": 42})

        result = cache_get("test_key")
        assert result == {"score": 42}

    @patch("gridstream.cache.get_redis")
    def test_cache_get_handles_redis_error(self, mock_get_redis):
        import redis

        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.get.side_effect = redis.RedisError("Connection refused")

        result = cache_get("test_key")
        assert result is None  # Graceful degradation

    @patch("gridstream.cache.get_redis")
    def test_cache_set_handles_redis_error(self, mock_get_redis):
        import redis

        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis
        mock_redis.setex.side_effect = redis.RedisError("Connection refused")

        # Should not raise — just log warning
        cache_set("test_key", {"data": True}, TTL_LONG)


class TestCacheInvalidation:
    @patch("gridstream.cache.cache_delete_pattern")
    def test_invalidate_game_clears_related_keys(self, mock_delete):
        mock_delete.return_value = 0
        invalidate_game(42)

        # Should clear game data, plays, drives, and standings
        assert mock_delete.call_count == 4
        patterns = [call[0][0] for call in mock_delete.call_args_list]
        assert "gridstream:games:42*" in patterns
        assert "gridstream:game_plays:42*" in patterns
        assert "gridstream:game_drives:42*" in patterns
        assert "gridstream:standings*" in patterns

    @patch("gridstream.cache.cache_delete_pattern")
    def test_invalidate_team_clears_related_keys(self, mock_delete):
        mock_delete.return_value = 0
        invalidate_team("SEA")

        assert mock_delete.call_count == 3
        patterns = [call[0][0] for call in mock_delete.call_args_list]
        assert "gridstream:teams:SEA*" in patterns
        assert "gridstream:roster:SEA*" in patterns
        assert "gridstream:standings*" in patterns

    @patch("gridstream.cache.cache_delete_pattern")
    def test_invalidate_player_clears_related_keys(self, mock_delete):
        mock_delete.return_value = 0
        invalidate_player(99)

        assert mock_delete.call_count == 2
        patterns = [call[0][0] for call in mock_delete.call_args_list]
        assert "gridstream:players:99*" in patterns
        assert "gridstream:gamelog:99*" in patterns


class TestCachedViewDecorator:
    @patch("gridstream.cache.cache_get")
    @patch("gridstream.cache.cache_set")
    def test_decorator_returns_cached_data(self, mock_set, mock_get):
        from rest_framework.response import Response

        mock_get.return_value = {"cached": True}

        @cached_view("test_resource", ttl=TTL_LONG)
        def my_view(self, request, *args, **kwargs):
            # This should NOT be called on cache hit
            return Response({"fresh": True})

        # Create a mock request
        mock_request = MagicMock()
        mock_request.query_params = {}

        result = my_view(None, mock_request)
        assert result.data == {"cached": True}
        mock_set.assert_not_called()  # No write on cache hit

    @patch("gridstream.cache.cache_get")
    @patch("gridstream.cache.cache_set")
    def test_decorator_caches_on_miss(self, mock_set, mock_get):
        from rest_framework.response import Response

        mock_get.return_value = None  # Cache miss

        @cached_view("test_resource", ttl=TTL_SHORT)
        def my_view(self, request, *args, **kwargs):
            return Response({"fresh": True})

        mock_request = MagicMock()
        mock_request.query_params = {}

        # Mock the response having status_code attribute
        result = my_view(None, mock_request)
        mock_set.assert_called_once()
        assert mock_set.call_args[0][2] == TTL_SHORT
