"""
Gridstream News Proxy.

Reads NewsSource model configs to know which external APIs to hit,
fetches articles, caches in Redis, and returns a unified feed.

The key insight: we don't store articles in the database. NewsSource
defines *where* to get news (ESPN team API, RSS feeds, Reddit).
Articles are fetched live and cached in Redis with short TTLs
(typically 5 min, configurable per source).

Endpoints:
  GET /news/league/               — league-wide news
  GET /news/team/{team_abbr}/     — team-specific news
  GET /news/player/{espn_id}/     — player-specific news (future)
"""

import logging
from datetime import datetime, timezone

import requests
from django.http import JsonResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import NewsSource, Team
from .cache import cache_key, cache_get, cache_set, TTL_NEWS

logger = logging.getLogger(__name__)

# ESPN API base — no auth required for public endpoints
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"

# Request timeout for external APIs (seconds)
FETCH_TIMEOUT = 10


def _fetch_url(url: str) -> dict | None:
    """Fetch a URL with timeout and error handling. Returns JSON or None."""
    try:
        resp = requests.get(
            url,
            timeout=FETCH_TIMEOUT,
            headers={
                "User-Agent": "Gridstream/1.0 (Engineering Atlas)",
            },
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        logger.warning("Failed to fetch %s: %s", url, exc)
        return None


def _normalize_espn_articles(raw: dict | None) -> list[dict]:
    """
    Transform ESPN's article format into our unified news schema.

    ESPN returns: { "articles": [{ "headline", "description", "published",
                    "links": {"web": {"href": ...}}, "images": [...] }] }
    """
    if not raw:
        return []

    articles = raw.get("articles", [])
    normalized = []

    for article in articles:
        images = article.get("images", [])
        image_url = images[0].get("url", "") if images else ""

        links = article.get("links", {})
        web_link = links.get("web", {}).get("href", "")

        # Categories / type
        categories = article.get("categories", [])
        category_names = []
        for cat in categories:
            if "description" in cat:
                category_names.append(cat["description"])

        normalized.append(
            {
                "headline": article.get("headline", ""),
                "description": article.get("description", ""),
                "published": article.get("published", ""),
                "url": web_link,
                "image_url": image_url,
                "source": "ESPN",
                "type": article.get("type", "article"),
                "categories": category_names,
            }
        )

    return normalized


def _normalize_reddit_posts(raw: dict | None) -> list[dict]:
    """
    Transform Reddit's JSON format into our unified news schema.

    Reddit .json returns: { "data": { "children": [{ "data": {...} }] } }
    """
    if not raw:
        return []

    children = raw.get("data", {}).get("children", [])
    posts = []

    for child in children:
        data = child.get("data", {})
        if data.get("stickied"):
            continue

        created_utc = data.get("created_utc", 0)
        published = (
            datetime.fromtimestamp(created_utc, timezone.utc).isoformat()
            if created_utc
            else ""
        )

        # Get thumbnail or preview image
        image_url = ""
        preview = data.get("preview", {})
        if preview:
            images = preview.get("images", [])
            if images:
                image_url = (
                    images[0].get("source", {}).get("url", "").replace("&amp;", "&")
                )

        posts.append(
            {
                "headline": data.get("title", ""),
                "description": data.get("selftext", "")[:300],
                "published": published,
                "url": f"https://reddit.com{data.get('permalink', '')}",
                "image_url": image_url,
                "source": f"r/{data.get('subreddit', 'nfl')}",
                "type": "reddit_post",
                "categories": (
                    [data.get("link_flair_text", "")]
                    if data.get("link_flair_text")
                    else []
                ),
                "score": data.get("score", 0),
                "num_comments": data.get("num_comments", 0),
            }
        )

    return posts


def _fetch_source(source: NewsSource, context: dict) -> list[dict]:
    """
    Fetch articles from a single NewsSource config, using the right
    normalizer based on source_type.
    """
    # Build the URL from the template
    url = source.url_template.format(**context)

    raw = _fetch_url(url)

    if source.source_type.startswith("espn"):
        return _normalize_espn_articles(raw)
    elif source.source_type == "reddit":
        return _normalize_reddit_posts(raw)
    elif source.source_type == "rss":
        # RSS support is a future enhancement — would use feedparser
        logger.info("RSS source %s not yet implemented", source.name)
        return []
    else:
        return []


# =============================================================================
# API Views
# =============================================================================


@api_view(["GET"])
def news_league(request):
    """GET /news/league/ — aggregated league-wide news."""
    ck = cache_key("news", "league")
    cached = cache_get(ck)
    if cached:
        return Response(cached)

    sources = NewsSource.objects.filter(entity_type="league", is_active=True).order_by(
        "priority"
    )

    all_articles = []
    for source in sources:
        articles = _fetch_source(source, {})
        all_articles.extend(articles)

    # Sort by published date, most recent first
    all_articles.sort(key=lambda a: a.get("published", ""), reverse=True)

    # Limit total articles
    limit = int(request.query_params.get("limit", 25))
    all_articles = all_articles[:limit]

    cache_set(ck, all_articles, TTL_NEWS)
    return Response(all_articles)


@api_view(["GET"])
def news_team(request, team_abbr):
    """GET /news/team/{team_abbr}/ — news for a specific team."""
    team_abbr = team_abbr.upper()

    ck = cache_key("news", f"team_{team_abbr}")
    cached = cache_get(ck)
    if cached:
        return Response(cached)

    try:
        team = Team.objects.get(abbreviation=team_abbr)
    except Team.DoesNotExist:
        return Response({"error": f"Team '{team_abbr}' not found"}, status=404)

    # Get team-specific sources
    sources = NewsSource.objects.filter(
        entity_type="team", team=team, is_active=True
    ).order_by("priority")

    # Also include league-wide sources
    league_sources = NewsSource.objects.filter(
        entity_type="league", is_active=True
    ).order_by("priority")

    context = {
        "team_id": team.pk,
        "espn_id": team.espn_id,
        "abbreviation": team.abbreviation,
        "slug": team.slug,
    }

    all_articles = []

    for source in list(sources) + list(league_sources):
        try:
            articles = _fetch_source(source, context)
            all_articles.extend(articles)
        except (KeyError, ValueError) as exc:
            logger.warning("Failed to format URL for source %s: %s", source.name, exc)
            continue

    all_articles.sort(key=lambda a: a.get("published", ""), reverse=True)

    limit = int(request.query_params.get("limit", 25))
    all_articles = all_articles[:limit]

    cache_set(ck, all_articles, TTL_NEWS)
    return Response(all_articles)


@api_view(["GET"])
def news_player(request, espn_id):
    """GET /news/player/{espn_id}/ — news for a specific player."""
    ck = cache_key("news", f"player_{espn_id}")
    cached = cache_get(ck)
    if cached:
        return Response(cached)

    sources = NewsSource.objects.filter(entity_type="player", is_active=True).order_by(
        "priority"
    )

    context = {"espn_id": espn_id, "player_id": espn_id}

    all_articles = []
    for source in sources:
        try:
            articles = _fetch_source(source, context)
            all_articles.extend(articles)
        except (KeyError, ValueError) as exc:
            logger.warning("Failed to format URL for source %s: %s", source.name, exc)
            continue

    all_articles.sort(key=lambda a: a.get("published", ""), reverse=True)

    limit = int(request.query_params.get("limit", 15))
    all_articles = all_articles[:limit]

    cache_set(ck, all_articles, TTL_NEWS)
    return Response(all_articles)
