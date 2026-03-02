"""
Management command: sync_pro_bowl_allpro

Fetches Pro Bowl roster selections and AP All-Pro (first/second team) from
Wikipedia and stores them in PlayerAward.

Wikipedia sources (both via the action API, no scraping):
  All-Pro : en.wikipedia.org/wiki/{season}_All-Pro_Team
  Pro Bowl: en.wikipedia.org/wiki/{season+1}_Pro_Bowl_Games   (2023+)
            en.wikipedia.org/wiki/{season+1}_Pro_Bowl         (2000-2022)

Award IDs used (stored in espn_award_id column):
  "probowl"   – Pro Bowl roster selection
  "allpro_1"  – AP First-Team All-Pro
  "allpro_2"  – AP Second-Team All-Pro

Usage:
    python manage.py sync_pro_bowl_allpro
    python manage.py sync_pro_bowl_allpro --season 2024
    python manage.py sync_pro_bowl_allpro --start-season 2008
    python manage.py sync_pro_bowl_allpro --type allpro
    python manage.py sync_pro_bowl_allpro --dry-run
"""
import datetime
import json
import logging
import re
import time
import unicodedata
import urllib.parse
import urllib.request

from django.core.management.base import BaseCommand

from gridstream.models import Player, PlayerAward

logger = logging.getLogger(__name__)

WIKI_API = "https://en.wikipedia.org/w/api.php"
REQUEST_DELAY = 0.5  # seconds between Wikipedia API calls

AWARD_PROBOWL = "probowl"
AWARD_ALLPRO_1 = "allpro_1"
AWARD_ALLPRO_2 = "allpro_2"

# Regex: link inner text that belongs to a team/season/position, not a player
_NON_PLAYER_RE = re.compile(
    r"season|\bBills\b|\bChiefs\b|\bPatriots\b|\bBroncos\b|\bRavens\b|"
    r"\bEagles\b|\b49ers\b|\bCowboys\b|\bBears\b|\bLions\b|\bFalcons\b|"
    r"\bRams\b|\bBengals\b|\bTexans\b|\bSeahawks\b|\bVikings\b|\bChargers\b|"
    r"\bRaiders\b|\bDolphins\b|\bGiants\b|\bSteelers\b|\bTitans\b|\bColts\b|"
    r"\bJaguars\b|\bJets\b|\bBrowns\b|\bPanthers\b|\bSaints\b|\bCardinals\b|"
    r"\bCommanders\b|\bPackers\b|\bBuccaneers\b|\bAFC\b|\bNFC\b|\bNFL\b|"
    r"\bAssociated Press\b|\bPress\b|[Rr]eturn specialist|"
    r"\bNBC\b|\bCBS\b|\bFox\b|\bABC\b|\bESPN\b|\bNFL Network\b|\bPeacock\b|"
    r"\bDisney\b|\bDeportes\b|Sports\b|Stadium\b|Arena\b|Field\b|Dome\b|"
    r"\bRedskins\b|\bOilers\b|\bBrowns\b|\bHelmet\b|"
    r"[Qq]uarterback|[Rr]unning back|[Ww]ide receiver|[Tt]ight end|"
    r"[Ff]ullback|[Cc]enter|[Gg]uard|[Tt]ackle|[Ll]inebacker|[Cc]ornerback|"
    r"[Ss]afety|\bkicker\b|\bpunter\b|[Ss]napper|[Ee]dge|[Dd]efensive|"
    r"[Oo]ffensive|[Ss]pecial team|returner|gridiron|football\b|"
    r"[Ss]uper Bowl|[Pp]ro Bowl|All-Pro|All Pro",
    re.IGNORECASE,
)

# Generational suffix at end of a normalized name (after _normalize: no punctuation)
_GEN_SUFFIX_RE = re.compile(r"\s+(?:i{1,3}|iv|vi{0,3}|ix|xi{0,2}|jr|sr)$", re.IGNORECASE)


# ─── Wikipedia helpers ────────────────────────────────────────────────────────


_WIKI_HEADERS = {
    "User-Agent": "EngineeringAtlas/1.0 (nfl-analytics-platform; contact@example.com) Python/3",
    "Accept": "application/json",
}


def _fetch_wikitext(page_title: str) -> str | None:
    """Fetch wikitext for a Wikipedia page via the action API."""
    url = (
        f"{WIKI_API}?action=parse"
        f"&page={urllib.parse.quote(page_title.replace(' ', '_'))}"
        f"&prop=wikitext&format=json"
    )
    try:
        req = urllib.request.Request(url, headers=_WIKI_HEADERS)
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        if "error" in data:
            return None
        wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "")
        # Follow redirects
        m = re.match(r"#REDIRECT\s*\[\[([^\]]+)\]\]", wikitext, re.IGNORECASE)
        if m:
            return _fetch_wikitext(m.group(1))
        return wikitext
    except Exception as exc:
        logger.warning("Failed to fetch Wikipedia '%s': %s", page_title, exc)
        return None


# ─── Link / name helpers ──────────────────────────────────────────────────────


def _wiki_display(link_inner: str) -> str:
    """
    Extract the display part of a wikitext link inner string.
      'Josh Allen'                        → 'Josh Allen'
      'James Cook (running back)|James Cook' → 'James Cook'
    """
    if "|" in link_inner:
        return link_inner.split("|", 1)[1].strip()
    return link_inner.strip()


def _is_player_link(link_inner: str, display: str) -> bool:
    """Return True when the link looks like a player rather than a team/position."""
    if _NON_PLAYER_RE.search(link_inner):
        return False
    # Players have at least two words (first + last name)
    words = display.split()
    return len(words) >= 2


def _normalize(name: str) -> str:
    """Lowercase, strip accents, keep only letters and spaces, collapse whitespace."""
    nfkd = unicodedata.normalize("NFD", name)
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    stripped = re.sub(r"[^a-z ]", "", ascii_str.lower())
    return re.sub(r"\s+", " ", stripped).strip()


# ─── Player lookup ─────────────────────────────────────────────────────────────


def _build_lookup() -> dict[str, int]:
    """Map normalized player name variants → Player PK."""
    lookup: dict[str, int] = {}
    for pk, display, first, last in Player.objects.using("nfl").values_list(
        "pk", "display_name", "first_name", "last_name"
    ):
        for raw in (display, f"{first} {last}"):
            key = _normalize(raw)
            if key and key not in lookup:
                lookup[key] = pk
            # Also index the same name with generational suffix stripped.
            # e.g. "deebo samuel sr" → also index "deebo samuel"
            #      "pat surtain ii"  → also index "pat surtain"
            stripped = _GEN_SUFFIX_RE.sub("", key).strip()
            if stripped and stripped != key and stripped not in lookup:
                lookup[stripped] = pk

        # Also index "FullFirstName RestOfDisplay" when the display uses a nickname.
        # e.g. display="Pat Surtain II", first_name="Patrick"
        #      → also index "patrick surtain ii"
        tokens = display.split()
        if len(tokens) > 1 and first and tokens[0].lower() != first.lower():
            alt_key = _normalize(f"{first} {' '.join(tokens[1:])}")
            if alt_key and alt_key not in lookup:
                lookup[alt_key] = pk

    return lookup


def _collapse_initials(key: str) -> str:
    """
    Collapse consecutive single-letter tokens (initials).
    "t j watt" → "tj watt"   (Wikipedia "T. J. Watt" vs DB "T.J. Watt")
    """
    result: list[str] = []
    buf: list[str] = []
    for token in key.split():
        if len(token) == 1:
            buf.append(token)
        else:
            if buf:
                result.append("".join(buf))
                buf = []
            result.append(token)
    if buf:
        result.append("".join(buf))
    return " ".join(result)


def _lookup_player(name: str, lookup: dict[str, int]) -> int | None:
    """
    Look up a player by name with fallbacks:
    1. Exact normalized match
    2. Collapse single-letter initials (T. J. → TJ)
    3. Strip trailing generational suffix (III, Jr, etc.) and try again
    """
    key = _normalize(name)
    pk = lookup.get(key)
    if pk:
        return pk

    # Collapse initials: "t j watt" → "tj watt"
    collapsed = _collapse_initials(key)
    if collapsed != key:
        pk = lookup.get(collapsed)
        if pk:
            return pk

    # Strip generational suffix (e.g. "Jessie Bates III" → "Jessie Bates",
    # "Byron Murphy Jr" → "Byron Murphy")
    for base in (key, collapsed):
        stripped = _GEN_SUFFIX_RE.sub("", base).strip()
        if stripped != base:
            pk = lookup.get(stripped)
            if pk:
                return pk
    return None


# ─── All-Pro parser ────────────────────────────────────────────────────────────


def _parse_all_pro(wikitext: str) -> list[tuple[str, str, str]]:
    """
    Parse AP All-Pro selections from a Wikipedia All-Pro Team page.

    Strategy: for every player wiki-link found, look at the text that follows
    it (up to the next entry break: <br />, table-row marker, or section).
    If that context contains "(AP" (but not "(AP-2"), → first team.
    If it contains "(AP-2"                            → second team.
    Non-AP entries (PFWA/TSN only) are skipped.

    Returns list of (player_display_name, award_id, description).
    """
    results: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()

    for m in re.finditer(r"\[\[([^\]]+)\]\]", wikitext):
        link_inner = m.group(1)
        display = _wiki_display(link_inner)
        if not _is_player_link(link_inner, display):
            continue

        # Grab context after this link, up to the next entry break
        pos = m.end()
        raw_ctx = wikitext[pos : pos + 400]
        breaks = [
            raw_ctx.find(x)
            for x in ("<br", "\n|-", "\n|", "\n!", "==")
            if raw_ctx.find(x) != -1
        ]
        ctx_end = min(breaks) if breaks else len(raw_ctx)
        ctx = raw_ctx[:ctx_end]

        if "(AP-2" in ctx or "(AP-2t" in ctx:
            award_id, desc = AWARD_ALLPRO_2, "Second-Team All-Pro"
        elif "(AP" in ctx:
            award_id, desc = AWARD_ALLPRO_1, "First-Team All-Pro"
        else:
            continue  # Not an AP selection

        key = (_normalize(display), award_id)
        if key not in seen:
            seen.add(key)
            results.append((display, award_id, desc))

    return results


# ─── Pro Bowl parser ───────────────────────────────────────────────────────────


def _parse_pro_bowl(wikitext: str) -> list[str]:
    """
    Extract player names from a Pro Bowl Wikipedia page.

    Handles three historical formats:
    - Newest (2023+):  "==Rosters==" with table cells and wiki links
    - Middle (2013-2022): "==AFC rosters==" / "==NFC rosters==" with wiki links
    - Older (2010-2016): "==Starting lineups==" with wiki links AND/OR
                         "{{NFLplayer|num|name|team}}" templates in roster sections

    Strategy:
    1. Find the roster section start (earliest of several heading patterns)
    2. Extract wiki links from table cell lines
    3. Also extract names from {{NFLplayer}} templates anywhere in the section
    """
    # Locate the start of roster content — pick the earliest matching heading
    _ROSTER_PATTERNS = [
        r"==\s*Rosters?\s*==",
        r"==\s*AFC\s+rosters?\s*==",
        r"==\s*NFC\s+rosters?\s*==",
        r"==\s*Starting\s+lineups?\s*==",   # 2010-2016 format
        r"==\s*Team\s+\w+\s*==",            # "Team Rice", "Team Carter" etc.
    ]
    starts = [
        m.start()
        for pat in _ROSTER_PATTERNS
        for m in [re.search(pat, wikitext, re.IGNORECASE)]
        if m
    ]
    roster_start = min(starts) if starts else None

    if roster_start is not None:
        section = wikitext[roster_start:]
        # Stop at definitely post-roster sections
        end_m = re.search(
            r"\n==\s*(?:Number\s+of|Broadcasting|Cheerleader|Reference|External|"
            r"Box\s+score|Scoring\s+summary|Selected\s+and|List\s+of\s+Referee)",
            section,
            re.IGNORECASE,
        )
        if end_m:
            section = section[: end_m.start()]
    else:
        # Fallback: skip the infobox by starting from the first level-2 heading
        first_sec = re.search(r"\n==\s*[^=]", wikitext)
        section = wikitext[first_sec.start() :] if first_sec else wikitext

    seen: set[str] = set()
    players: list[str] = []

    # ── Method 1: wiki links in table cell lines ──────────────────────────────
    cell_lines = [
        line
        for line in section.splitlines()
        if line.startswith("|") and not line.startswith(("|-", "|}", "|+"))
    ]
    table_text = "\n".join(cell_lines)

    for link_m in re.finditer(r"\[\[([^\]]+)\]\]", table_text):
        inner = link_m.group(1)
        display = _wiki_display(inner)
        if _is_player_link(inner, display) and display not in seen:
            seen.add(display)
            players.append(display)

    # ── Method 2: {{NFLplayer|num|name|team}} templates ───────────────────────
    # Used in 2010-2016 era Pro Bowl pages for bullet-point roster sections.
    # Pattern: {{NFLplayer|jersey_num|player_name|(team)}}
    for tmpl_m in re.finditer(
        r"\{\{NFLplayer\s*\|[^|{}\n]*\|\s*([^|{}\n]+?)\s*[\|{}]",
        section,
    ):
        display = tmpl_m.group(1).strip()
        if display and len(display.split()) >= 2 and not _NON_PLAYER_RE.search(display):
            if display not in seen:
                seen.add(display)
                players.append(display)

    return players


# ─── DB write helper ───────────────────────────────────────────────────────────


def _upsert(player_pk: int, season: int, award_id: str, name: str, description: str, dry_run: bool) -> str:
    """Write one award row; return 'created' | 'updated' | 'dry'."""
    if dry_run:
        return "dry"
    _, was_created = PlayerAward.objects.using("nfl").update_or_create(
        player_id=player_pk,
        season=season,
        espn_award_id=award_id,
        defaults={"name": name, "description": description},
    )
    return "created" if was_created else "updated"


# ─── Django management command ─────────────────────────────────────────────────


class Command(BaseCommand):
    help = "Sync Pro Bowl and AP All-Pro selections from Wikipedia into PlayerAward."

    def add_arguments(self, parser):
        parser.add_argument("--season", type=int, default=None,
                            help="Sync a single season (e.g. 2024).")
        parser.add_argument("--start-season", type=int, default=2000,
                            help="Earliest season to sync (default 2000).")
        parser.add_argument("--end-season", type=int, default=None,
                            help="Latest season to sync (default: current year).")
        parser.add_argument("--type", choices=["probowl", "allpro", "both"],
                            default="both", dest="sync_type")
        parser.add_argument("--dry-run", action="store_true",
                            help="Fetch and parse but do not write to DB.")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        sync_type = options["sync_type"]

        if options["season"]:
            seasons = [options["season"]]
        else:
            start = options["start_season"]
            end = options["end_season"] or datetime.date.today().year
            seasons = list(range(start, end + 1))

        self.stdout.write("Building player name lookup…")
        lookup = _build_lookup()
        self.stdout.write(f"  {len(lookup)} name variants loaded")

        totals = {"created": 0, "updated": 0, "dry": 0, "unmatched": 0}

        for season in seasons:
            if sync_type in ("allpro", "both"):
                self._sync_allpro(season, lookup, dry_run, totals)
                time.sleep(REQUEST_DELAY)

            if sync_type in ("probowl", "both"):
                self._sync_probowl(season, lookup, dry_run, totals)
                time.sleep(REQUEST_DELAY)

        self.stdout.write(self.style.SUCCESS(
            f"\nDone. created={totals['created']}, updated={totals['updated']}, "
            f"dry={totals['dry']}, unmatched={totals['unmatched']}"
        ))

    # ── All-Pro ─────────────────────────────────────────────────────────────

    def _sync_allpro(self, season: int, lookup: dict, dry_run: bool, totals: dict):
        page = f"{season} All-Pro Team"
        wikitext = _fetch_wikitext(page)
        if not wikitext:
            logger.debug("All-Pro page not found for season %s", season)
            return

        entries = _parse_all_pro(wikitext)
        season_counts: dict[str, int] = {}

        for display, award_id, desc in entries:
            player_pk = _lookup_player(display, lookup)
            if not player_pk:
                logger.debug("All-Pro unmatched: '%s' (%s)", display, season)
                totals["unmatched"] += 1
                if dry_run:
                    self.stdout.write(f"  [UNMATCHED] {season} {desc}: {display}")
                continue

            result = _upsert(player_pk, season, award_id, desc,
                             f"AP {desc}", dry_run)
            totals[result] += 1
            season_counts[result] = season_counts.get(result, 0) + 1
            if dry_run:
                self.stdout.write(f"  [DRY] {season} {desc}: {display}")

        if any(season_counts.values()):
            self.stdout.write(
                f"  {season} All-Pro: "
                + ", ".join(f"{v} {k}" for k, v in season_counts.items())
                + f" ({len(entries)} entries parsed)"
            )

    # ── Pro Bowl ─────────────────────────────────────────────────────────────

    def _sync_probowl(self, season: int, lookup: dict, dry_run: bool, totals: dict):
        # Pro Bowl is played in the year after the season ends
        pb_year = season + 1

        # Try "Pro Bowl Games" (2023+) first, then "Pro Bowl" (older format)
        wikitext = _fetch_wikitext(f"{pb_year} Pro Bowl Games")
        if not wikitext:
            wikitext = _fetch_wikitext(f"{pb_year} Pro Bowl")
        if not wikitext:
            logger.debug("Pro Bowl page not found for season %s (pb_year=%s)", season, pb_year)
            return

        player_names = _parse_pro_bowl(wikitext)
        season_counts: dict[str, int] = {}

        for display in player_names:
            player_pk = _lookup_player(display, lookup)
            if not player_pk:
                logger.debug("Pro Bowl unmatched: '%s' (%s)", display, season)
                totals["unmatched"] += 1
                if dry_run:
                    self.stdout.write(f"  [UNMATCHED] {season} Pro Bowl: {display}")
                continue

            result = _upsert(player_pk, season, AWARD_PROBOWL, "Pro Bowl",
                             "NFL Pro Bowl selection", dry_run)
            totals[result] += 1
            season_counts[result] = season_counts.get(result, 0) + 1
            if dry_run:
                self.stdout.write(f"  [DRY] {season} Pro Bowl: {display}")

        if any(season_counts.values()):
            self.stdout.write(
                f"  {season} Pro Bowl: "
                + ", ".join(f"{v} {k}" for k, v in season_counts.items())
                + f" ({len(player_names)} parsed)"
            )
