"""Tests for the news proxy endpoints — external APIs are mocked."""

import pytest
from unittest.mock import patch, MagicMock
from django.urls import reverse
from rest_framework import status

pytestmark = [
    pytest.mark.django_db(databases=["default", "nfl"]),
]


# Sample ESPN API response for mocking
MOCK_ESPN_RESPONSE = {
    "articles": [
        {
            "headline": "Seahawks crush Commanders in Week 1",
            "description": "Geno Smith threw for 280 yards and 2 TDs...",
            "published": "2024-09-08T23:30:00Z",
            "type": "article",
            "links": {"web": {"href": "https://www.espn.com/nfl/story/_/id/12345"}},
            "images": [{"url": "https://a.espncdn.com/photo/2024/0908/example.jpg"}],
            "categories": [{"description": "Seattle Seahawks"}],
        },
        {
            "headline": "Week 1 Recap: All the action",
            "description": "A full rundown of every game in Week 1...",
            "published": "2024-09-08T22:00:00Z",
            "type": "article",
            "links": {"web": {"href": "https://www.espn.com/nfl/story/_/id/12346"}},
            "images": [],
            "categories": [],
        },
    ]
}

MOCK_REDDIT_RESPONSE = {
    "data": {
        "children": [
            {
                "data": {
                    "title": "Post Game Thread: Seahawks defeat Commanders 26-20",
                    "selftext": "What a game! Geno was incredible today...",
                    "permalink": "/r/nfl/comments/abc123/post_game_thread/",
                    "created_utc": 1725839400.0,
                    "subreddit": "nfl",
                    "link_flair_text": "Post Game Thread",
                    "score": 5420,
                    "num_comments": 1832,
                    "stickied": False,
                    "preview": {},
                }
            },
            {
                "data": {
                    "title": "This is a stickied post",
                    "selftext": "Rules reminder",
                    "permalink": "/r/nfl/comments/sticky/",
                    "created_utc": 1725800000.0,
                    "subreddit": "nfl",
                    "stickied": True,
                    "score": 10,
                    "num_comments": 5,
                }
            },
        ]
    }
}


class TestNewsLeague:
    @patch("gridstream.news_proxy.cache_get", return_value=None)
    @patch("gridstream.news_proxy.cache_set")
    @patch("gridstream.news_proxy._fetch_url")
    def test_league_news_fetches_and_normalizes(
        self,
        mock_fetch,
        mock_cache_set,
        mock_cache_get,
        api_client,
        news_source_league,
    ):
        mock_fetch.return_value = MOCK_ESPN_RESPONSE

        url = reverse("news-league")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 2

        article = resp.data[0]
        assert article["headline"] == "Seahawks crush Commanders in Week 1"
        assert article["source"] == "ESPN"
        assert article["url"] == "https://www.espn.com/nfl/story/_/id/12345"
        assert (
            article["image_url"] == "https://a.espncdn.com/photo/2024/0908/example.jpg"
        )

    @patch("gridstream.news_proxy.cache_get", return_value=None)
    @patch("gridstream.news_proxy.cache_set")
    @patch("gridstream.news_proxy._fetch_url")
    def test_league_news_sorted_by_date(
        self,
        mock_fetch,
        mock_cache_set,
        mock_cache_get,
        api_client,
        news_source_league,
    ):
        mock_fetch.return_value = MOCK_ESPN_RESPONSE

        url = reverse("news-league")
        resp = api_client.get(url)

        # Most recent first
        dates = [a["published"] for a in resp.data]
        assert dates == sorted(dates, reverse=True)

    @patch("gridstream.news_proxy.cache_get")
    def test_league_news_returns_cached(
        self, mock_cache_get, api_client, news_source_league
    ):
        cached_data = [{"headline": "Cached article", "source": "ESPN"}]
        mock_cache_get.return_value = cached_data

        url = reverse("news-league")
        resp = api_client.get(url)

        assert resp.data == cached_data

    @patch("gridstream.news_proxy.cache_get", return_value=None)
    @patch("gridstream.news_proxy.cache_set")
    @patch("gridstream.news_proxy._fetch_url")
    def test_league_news_limit_param(
        self,
        mock_fetch,
        mock_cache_set,
        mock_cache_get,
        api_client,
        news_source_league,
    ):
        mock_fetch.return_value = MOCK_ESPN_RESPONSE

        url = reverse("news-league")
        resp = api_client.get(url, {"limit": 1})

        assert len(resp.data) == 1

    @patch("gridstream.news_proxy.cache_get", return_value=None)
    @patch("gridstream.news_proxy.cache_set")
    @patch("gridstream.news_proxy._fetch_url")
    def test_league_news_handles_fetch_failure(
        self,
        mock_fetch,
        mock_cache_set,
        mock_cache_get,
        api_client,
        news_source_league,
    ):
        mock_fetch.return_value = None

        url = reverse("news-league")
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data == []


class TestNewsTeam:
    @patch("gridstream.news_proxy.cache_get", return_value=None)
    @patch("gridstream.news_proxy.cache_set")
    @patch("gridstream.news_proxy._fetch_url")
    def test_team_news_fetches_for_team(
        self,
        mock_fetch,
        mock_cache_set,
        mock_cache_get,
        api_client,
        team_sea,
        news_source_team,
    ):
        mock_fetch.return_value = MOCK_ESPN_RESPONSE

        url = reverse("news-team", kwargs={"team_abbr": "SEA"})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) >= 1

    def test_team_news_404_for_invalid_team(self, api_client, db):
        url = reverse("news-team", kwargs={"team_abbr": "ZZZ"})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_404_NOT_FOUND

    @patch("gridstream.news_proxy.cache_get", return_value=None)
    @patch("gridstream.news_proxy.cache_set")
    @patch("gridstream.news_proxy._fetch_url")
    def test_team_news_case_insensitive(
        self,
        mock_fetch,
        mock_cache_set,
        mock_cache_get,
        api_client,
        team_sea,
        news_source_team,
    ):
        mock_fetch.return_value = MOCK_ESPN_RESPONSE

        url = reverse("news-team", kwargs={"team_abbr": "sea"})
        resp = api_client.get(url)

        assert resp.status_code == status.HTTP_200_OK


class TestNewsNormalization:
    """Test the article normalization functions directly."""

    def test_espn_normalization_extracts_fields(self):
        from gridstream.news_proxy import _normalize_espn_articles

        articles = _normalize_espn_articles(MOCK_ESPN_RESPONSE)

        assert len(articles) == 2
        assert articles[0]["headline"] == "Seahawks crush Commanders in Week 1"
        assert articles[0]["source"] == "ESPN"
        assert articles[0]["type"] == "article"
        assert "Seattle Seahawks" in articles[0]["categories"]

    def test_espn_normalization_handles_missing_images(self):
        from gridstream.news_proxy import _normalize_espn_articles

        articles = _normalize_espn_articles(MOCK_ESPN_RESPONSE)
        assert articles[1]["image_url"] == ""  # Second article has no images

    def test_espn_normalization_handles_none(self):
        from gridstream.news_proxy import _normalize_espn_articles

        articles = _normalize_espn_articles(None)
        assert articles == []

    def test_reddit_normalization(self):
        from gridstream.news_proxy import _normalize_reddit_posts

        posts = _normalize_reddit_posts(MOCK_REDDIT_RESPONSE)

        # Stickied post should be excluded
        assert len(posts) == 1
        post = posts[0]
        assert "Post Game Thread" in post["headline"]
        assert post["source"] == "r/nfl"
        assert post["score"] == 5420
        assert post["num_comments"] == 1832
        assert "Post Game Thread" in post["categories"]

    def test_reddit_normalization_handles_none(self):
        from gridstream.news_proxy import _normalize_reddit_posts

        posts = _normalize_reddit_posts(None)
        assert posts == []
