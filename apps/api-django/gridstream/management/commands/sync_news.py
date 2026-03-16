"""
Management command: sync_news

Fetches and persists news articles from three sources:
  1. ESPN API    — league-wide + per-team news (structured JSON, entity-tagged)
  2. RotoWire    — player-centric RSS (injuries, depth chart, fantasy notes)
  3. Pro Football Rumors — transaction/contract RSS

Articles are stored in NewsArticle and tagged with Team/Player M2M relations
so team pages, player pages, and game pages can query them directly.

Deduplication is by `external_id` (source-prefixed stable key).
Only articles published on or after --since date are kept (default: 2026-01-01).

Usage:
    python manage.py sync_news
    python manage.py sync_news --since 2025-01-01
    python manage.py sync_news --source espn
    python manage.py sync_news --dry-run
"""

import hashlib
import html
import logging
import re
import time
from datetime import datetime, timezone

import feedparser
import requests
from django.core.management.base import BaseCommand
from django.db import transaction

from gridstream.models import NewsArticle, Player, Team

logger = logging.getLogger(__name__)

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
ROTOWIRE_RSS = "https://www.rotowire.com/rss/news.php?sport=NFL"
PFR_RSS = "https://www.profootballrumors.com/feed"

FETCH_TIMEOUT = 15
TEAM_DELAY = 0.3  # seconds between ESPN team requests to be polite


def _fetch_json(url: str) -> dict | None:
    try:
        resp = requests.get(
            url,
            timeout=FETCH_TIMEOUT,
            headers={"User-Agent": "Gridstream/1.0 (Engineering Atlas)"},
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        logger.warning("fetch_json failed %s: %s", url, exc)
        return None


def _html_to_paragraphs(html_text: str) -> str:
    """Convert HTML to plain text with paragraph breaks preserved."""
    text = re.sub(r"<p[^>]*>", "", html_text, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _scrape_espn_body(url: str) -> tuple[str, str]:
    """Fetch an ESPN article page and extract (author, body). Returns ('', '') on failure."""
    if not url:
        return "", ""
    try:
        resp = requests.get(
            url,
            timeout=FETCH_TIMEOUT,
            headers={"User-Agent": "Gridstream/1.0 (Engineering Atlas)"},
        )
        resp.raise_for_status()
        text = resp.text

        # Author — JSON-LD first (most reliable), then HTML byline patterns
        author = ""
        jsonld_m = re.search(r'"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"', text)
        if jsonld_m:
            author = html.unescape(jsonld_m.group(1)).strip()
        if not author:
            for pattern in [
                r'<span[^>]+class="[^"]*byline__author[^"]*"[^>]*>(.*?)</span>',
                r'<div[^>]+class="[^"]*author-block__author[^"]*"[^>]*>(.*?)</div>',
                r'<a[^>]+class="[^"]*author-name[^"]*"[^>]*>(.*?)</a>',
            ]:
                m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
                if m:
                    author = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
                    if author:
                        break

        # Body — find article-body section, extract paragraphs within reasonable window
        body = ""
        body_m = re.search(r'class="[^"]*article-body[^"]*"', text, re.IGNORECASE)
        if body_m:
            section = text[body_m.start() : body_m.start() + 25000]
            paras = re.findall(r"<p[^>]*>(.*?)</p>", section, re.IGNORECASE | re.DOTALL)
            para_texts = [html.unescape(re.sub(r"<[^>]+>", "", p)).strip() for p in paras]
            # Drop navigation/jump-link paragraphs (ESPN in-page nav, not content)
            body = "\n\n".join(t for t in para_texts if t and not t.startswith("Jump to:"))

        return author, body
    except Exception as exc:
        logger.warning("_scrape_espn_body failed %s: %s", url, exc)
        return "", ""


def _fetch_rss(url: str):
    """Fetch and parse an RSS feed. Returns feedparser result or None."""
    try:
        resp = requests.get(
            url,
            timeout=FETCH_TIMEOUT,
            headers={"User-Agent": "Gridstream/1.0 (Engineering Atlas)"},
        )
        resp.raise_for_status()
        return feedparser.parse(resp.content)
    except requests.RequestException as exc:
        logger.warning("fetch_rss failed %s: %s", url, exc)
        return None


def _stable_id(prefix: str, value: str) -> str:
    """Generate a short stable external_id from a prefix + arbitrary value."""
    h = hashlib.sha1(value.encode()).hexdigest()[:16]
    return f"{prefix}_{h}"


def _parse_dt(value: str | None) -> datetime | None:
    """Parse an ISO datetime string into a timezone-aware datetime, or None."""
    if not value:
        return None
    # feedparser gives us time_struct tuples on entries; handle both formats
    for fmt in (
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S+00:00",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S GMT",
    ):
        try:
            dt = datetime.strptime(value.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    logger.debug("Could not parse datetime: %r", value)
    return None


def _feedparser_dt(entry) -> datetime | None:
    """Extract published datetime from a feedparser entry."""
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        import calendar
        ts = calendar.timegm(entry.published_parsed)
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    # fallback to string
    raw = getattr(entry, "published", None) or getattr(entry, "updated", None)
    return _parse_dt(raw)


# =============================================================================
# Entity lookup tables (built once per run)
# =============================================================================


class EntityIndex:
    """
    In-memory lookup for fast entity matching during article tagging.
    Loaded once per sync run to avoid N+1 DB queries.
    """

    def __init__(self):
        # ESPN ID → Team
        self.team_by_espn_id: dict[str, Team] = {}
        # abbreviation (upper) → Team
        self.team_by_abbr: dict[str, Team] = {}
        # nickname/display_name (lower) → Team  e.g. "giants" → NYG
        self.team_by_nickname: dict[str, Team] = {}
        # ESPN ID → Player
        self.player_by_espn_id: dict[str, Player] = {}
        # display_name (lower) → Player
        self.player_by_name: dict[str, Player] = {}

    def load(self):
        for team in Team.objects.using("nfl").all():
            if team.espn_id:
                self.team_by_espn_id[str(team.espn_id)] = team
            self.team_by_abbr[team.abbreviation.upper()] = team
            # nickname ("Giants") and display_name ("New York Giants") lookups
            if team.nickname:
                self.team_by_nickname[team.nickname.lower()] = team
            self.team_by_nickname[team.display_name.lower()] = team

        for player in Player.objects.using("nfl").filter(is_active=True).select_related(
            "current_team"
        ):
            if player.espn_id:
                self.player_by_espn_id[str(player.espn_id)] = player
            self.player_by_name[player.display_name.lower()] = player

    def teams_from_espn_categories(self, categories: list) -> list[Team]:
        teams = []
        for cat in categories:
            if cat.get("type") == "team":
                tid = str(cat.get("teamId", cat.get("id", "")))
                t = self.team_by_espn_id.get(tid)
                if t:
                    teams.append(t)
        return teams

    def players_from_espn_categories(self, categories: list) -> list[Player]:
        players = []
        for cat in categories:
            if cat.get("type") == "athlete":
                pid = str(cat.get("athleteId", cat.get("id", "")))
                p = self.player_by_espn_id.get(pid)
                if p:
                    players.append(p)
        return players

    def players_from_text(self, text: str) -> list[Player]:
        """
        Fuzzy name match: check if any known player display_name appears in
        the article text. Only matches names ≥ 8 chars to reduce false hits.
        """
        text_lower = text.lower()
        return [
            p
            for name, p in self.player_by_name.items()
            if len(name) >= 8 and name in text_lower
        ]

    def teams_from_text(self, text: str) -> list[Team]:
        """Match team abbreviations and nicknames in text."""
        found: list[Team] = []
        seen_ids: set[int] = set()

        def _add(team: Team) -> None:
            if team.id not in seen_ids:
                seen_ids.add(team.id)
                found.append(team)

        # Abbreviation match — case-sensitive so "was" doesn't match WAS, "ne" ≠ NE
        for abbr, team in self.team_by_abbr.items():
            if re.search(r"\b" + re.escape(abbr) + r"\b", text):
                _add(team)

        # Nickname / full name match (Giants, Browns, New York Giants …)
        text_lower = text.lower()
        for name, team in self.team_by_nickname.items():
            if len(name) >= 5 and re.search(r"\b" + re.escape(name) + r"\b", text_lower):
                _add(team)

        return found


# =============================================================================
# ESPN
# =============================================================================


def fetch_espn_league(since: datetime, idx: EntityIndex) -> list[dict]:
    """Fetch league-wide ESPN news, multiple pages."""
    articles = []
    page = 1
    while True:
        url = f"{ESPN_BASE}/news?limit=100&page={page}"
        raw = _fetch_json(url)
        if not raw:
            break
        batch = raw.get("articles", [])
        if not batch:
            break

        for article in batch:
            a = _normalize_espn(article, idx)
            if a and a["published_at"] >= since:
                articles.append(a)

        # If we got a full page, check if there's more; ESPN doesn't always
        # paginate cleanly so stop if any article is older than since
        oldest = min((a["published_at"] for a in articles), default=since)
        if oldest < since or len(batch) < 100:
            break
        page += 1

    return articles


def fetch_espn_teams(since: datetime, idx: EntityIndex, stdout=None) -> list[dict]:
    """Fetch per-team ESPN news for all 32 teams."""
    articles = []
    teams = list(Team.objects.using("nfl").exclude(espn_id="").values_list("espn_id", flat=True))

    for i, espn_id in enumerate(teams):
        url = f"{ESPN_BASE}/teams/{espn_id}/news?limit=50"
        raw = _fetch_json(url)
        if raw:
            for article in raw.get("articles", []):
                a = _normalize_espn(article, idx)
                if a and a["published_at"] >= since:
                    articles.append(a)
        if stdout and (i + 1) % 8 == 0:
            stdout.write(f"  ESPN teams: {i + 1}/{len(teams)}...")
        time.sleep(TEAM_DELAY)

    return articles


def _normalize_espn(article: dict, idx: EntityIndex) -> dict | None:
    article_id = str(article.get("id", ""))
    if not article_id:
        return None

    published = _parse_dt(article.get("published", ""))
    if not published:
        return None

    images = article.get("images", [])
    image_url = images[0].get("url", "") if images else ""

    links = article.get("links", {})
    url = links.get("web", {}).get("href", "")

    categories = article.get("categories", [])

    return {
        "source": "espn",
        "external_id": f"espn_{article_id}",
        "headline": html.unescape(article.get("headline", "")).strip(),
        "summary": html.unescape(article.get("description", "") or "").strip(),
        "author": "",
        "body": "",
        "url": url,
        "image_url": image_url,
        "published_at": published,
        "teams": idx.teams_from_espn_categories(categories),
        "players": idx.players_from_espn_categories(categories),
    }


# =============================================================================
# RotoWire RSS
# =============================================================================


def fetch_rotowire(since: datetime, idx: EntityIndex) -> list[dict]:
    feed = _fetch_rss(ROTOWIRE_RSS)
    if not feed:
        return []

    articles = []
    for entry in feed.entries:
        published = _feedparser_dt(entry)
        if not published or published < since:
            continue

        guid = getattr(entry, "id", None) or getattr(entry, "link", "")
        external_id = _stable_id("rotowire", guid)

        headline = html.unescape(getattr(entry, "title", "")).strip()
        summary = html.unescape(getattr(entry, "summary", "") or "").strip()
        url = getattr(entry, "link", "")

        # RotoWire items often embed images in <description> HTML or <enclosure>
        image_url = ""
        for enc in getattr(entry, "enclosures", []):
            if enc.get("type", "").startswith("image/"):
                image_url = enc.get("url", "")
                break
        if not image_url:
            for mc in getattr(entry, "media_content", []):
                if mc.get("medium") == "image" or mc.get("type", "").startswith("image"):
                    image_url = mc.get("url", "")
                    break

        # Entity matching: player name usually precedes ":" in headline
        # e.g. "Romeo Doubs: Signed to 1-Year Deal With GB"
        search_text = headline + " " + summary
        players = idx.players_from_text(search_text)
        teams = idx.teams_from_text(search_text)

        # Also try to get team from "POSITION - TEAM_ABBR" pattern in summary
        m = re.search(r"\b([A-Z]{2,3})\b", summary[:60])
        if m:
            t = idx.team_by_abbr.get(m.group(1))
            if t and t not in teams:
                teams.append(t)

        articles.append(
            {
                "source": "rotowire",
                "external_id": external_id,
                "headline": headline,
                "summary": summary,
                "author": "",
                "body": summary,  # RotoWire blurbs are already short and complete
                "url": url,
                "image_url": image_url,
                "published_at": published,
                "teams": teams,
                "players": players,
            }
        )

    return articles


# =============================================================================
# Pro Football Rumors RSS
# =============================================================================


def fetch_pfr(since: datetime, idx: EntityIndex) -> list[dict]:
    feed = _fetch_rss(PFR_RSS)
    if not feed:
        return []

    articles = []
    for entry in feed.entries:
        published = _feedparser_dt(entry)
        if not published or published < since:
            continue

        guid = getattr(entry, "id", None) or getattr(entry, "link", "")
        external_id = _stable_id("pfr", guid)

        headline = html.unescape(getattr(entry, "title", "")).strip()
        # Prefer Atom full-content field (full HTML); fall back to RSS summary
        content_list = getattr(entry, "content", None)
        if content_list and isinstance(content_list, list) and content_list[0].get("value"):
            raw_body_html = content_list[0]["value"]
        else:
            raw_body_html = getattr(entry, "summary", "")
        body = _html_to_paragraphs(raw_body_html)
        summary = body[:600].rstrip()
        author = html.unescape(getattr(entry, "author", "") or "").strip()
        url = getattr(entry, "link", "")

        # Image from <media:content> or <media:thumbnail>
        image_url = ""
        for mc in getattr(entry, "media_content", []):
            if mc.get("url"):
                image_url = mc["url"]
                break
        if not image_url:
            thumb = getattr(entry, "media_thumbnail", None)
            if thumb:
                image_url = thumb[0].get("url", "") if isinstance(thumb, list) else ""

        # PFR RSS includes explicit team/player tags — use them as primary source
        rss_tags = [html.unescape(t.get("term", "")) for t in getattr(entry, "tags", [])]
        teams: list = []
        players: list = []
        seen_team_ids: set = set()
        seen_player_ids: set = set()
        for term in rss_tags:
            term_lower = term.lower()
            # Try team nickname/name match first
            team = idx.team_by_nickname.get(term_lower)
            if team and team.id not in seen_team_ids:
                teams.append(team)
                seen_team_ids.add(team.id)
                continue
            # Try player display_name match
            player = idx.player_by_name.get(term_lower)
            if player and player.id not in seen_player_ids:
                players.append(player)
                seen_player_ids.add(player.id)

        # Fall back to text scanning only if RSS tags gave nothing
        if not teams and not players:
            search_text = headline + " " + summary
            players = idx.players_from_text(search_text)
            teams = idx.teams_from_text(search_text)

        articles.append(
            {
                "source": "pfr",
                "external_id": external_id,
                "headline": headline,
                "summary": summary,
                "author": author,
                "body": body,
                "url": url,
                "image_url": image_url,
                "published_at": published,
                "teams": teams,
                "players": players,
            }
        )

    return articles


# =============================================================================
# ESPN body enrichment (scrape full article pages)
# =============================================================================


def enrich_espn_bodies(articles: list[dict], stdout=None) -> None:
    """Scrape ESPN article pages to populate body + author. Mutates articles in-place."""
    espn_articles = [a for a in articles if a.get("source") == "espn" and a.get("url")]
    if not espn_articles:
        return
    if stdout:
        stdout.write(f"  Scraping {len(espn_articles)} ESPN article pages...")
    enriched = 0
    for i, a in enumerate(espn_articles):
        author, body = _scrape_espn_body(a["url"])
        a["author"] = author
        a["body"] = body
        if body:
            enriched += 1
        if i < len(espn_articles) - 1:
            time.sleep(TEAM_DELAY)
    if stdout:
        stdout.write(f"  {enriched}/{len(espn_articles)} ESPN articles got body text")


# =============================================================================
# Persistence
# =============================================================================


def save_articles(articles: list[dict], dry_run: bool) -> tuple[int, int]:
    """
    Upsert articles into NewsArticle. Returns (created, skipped).
    Uses get_or_create to avoid duplicates; updates nothing on existing rows
    since article content doesn't change after publish.
    """
    created = skipped = 0

    # Deduplicate within the batch (ESPN team endpoints return duplicates)
    seen: set[str] = set()
    unique: list[dict] = []
    for a in articles:
        if a["external_id"] not in seen:
            seen.add(a["external_id"])
            unique.append(a)

    for a in unique:
        if dry_run:
            created += 1
            continue

        with transaction.atomic(using="nfl"):
            obj, was_created = NewsArticle.objects.using("nfl").get_or_create(
                external_id=a["external_id"],
                defaults={
                    "source": a["source"],
                    "headline": a["headline"],
                    "summary": a["summary"],
                    "author": a.get("author", ""),
                    "body": a.get("body", ""),
                    "url": a["url"],
                    "image_url": a.get("image_url", ""),
                    "published_at": a["published_at"],
                },
            )

            if was_created:
                created += 1
            else:
                updated_fields = []
                for field in ("headline", "summary", "author", "body"):
                    val = a.get(field, "")
                    if getattr(obj, field) != val:
                        setattr(obj, field, val)
                        updated_fields.append(field)
                if updated_fields:
                    obj.save(using="nfl", update_fields=updated_fields)
                skipped += 1

            # Always refresh M2M tags (improves on re-run when matching improves)
            if a["teams"]:
                obj.teams.set(a["teams"])
            if a["players"]:
                obj.players.set(a["players"])

    return created, skipped


# =============================================================================
# Command
# =============================================================================


class Command(BaseCommand):
    help = "Sync news articles from ESPN, RotoWire, and Pro Football Rumors"

    def add_arguments(self, parser):
        parser.add_argument(
            "--since",
            default="2026-01-01",
            help="Only ingest articles published on or after this date (YYYY-MM-DD)",
        )
        parser.add_argument(
            "--source",
            choices=["espn", "rotowire", "pfr", "all"],
            default="all",
            help="Which source(s) to sync (default: all)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Fetch and count articles without writing to the database",
        )

    def handle(self, *args, **options):
        since_str = options["since"]
        source = options["source"]
        dry_run = options["dry_run"]

        since = datetime(
            *[int(x) for x in since_str.split("-")], tzinfo=timezone.utc
        )

        if dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN — nothing will be written"))

        self.stdout.write(f"Loading entity index...")
        idx = EntityIndex()
        idx.load()
        self.stdout.write(
            f"  {len(idx.team_by_abbr)} teams, "
            f"{len(idx.player_by_name)} active players indexed"
        )

        all_articles: list[dict] = []

        # ── ESPN ─────────────────────────────────────────────────────────────
        if source in ("espn", "all"):
            self.stdout.write("\nFetching ESPN league news...")
            league_articles = fetch_espn_league(since, idx)
            self.stdout.write(f"  {len(league_articles)} league articles")

            self.stdout.write("Fetching ESPN team news (32 teams, ~10s)...")
            team_articles = fetch_espn_teams(since, idx, stdout=self.stdout)
            self.stdout.write(f"  {len(team_articles)} team articles")

            espn_articles = league_articles + team_articles
            enrich_espn_bodies(espn_articles, stdout=self.stdout)
            all_articles.extend(espn_articles)

        # ── RotoWire ─────────────────────────────────────────────────────────
        if source in ("rotowire", "all"):
            self.stdout.write("\nFetching RotoWire RSS...")
            rw_articles = fetch_rotowire(since, idx)
            self.stdout.write(f"  {len(rw_articles)} articles")
            all_articles.extend(rw_articles)

        # ── Pro Football Rumors ───────────────────────────────────────────────
        if source in ("pfr", "all"):
            self.stdout.write("\nFetching Pro Football Rumors RSS...")
            pfr_articles = fetch_pfr(since, idx)
            self.stdout.write(f"  {len(pfr_articles)} articles")
            all_articles.extend(pfr_articles)

        # ── Persist ───────────────────────────────────────────────────────────
        self.stdout.write(
            f"\nTotal fetched: {len(all_articles)} articles "
            f"(before dedup). Saving..."
        )
        created, skipped = save_articles(all_articles, dry_run)

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone! {created} new articles created, {skipped} already existed."
            )
        )
