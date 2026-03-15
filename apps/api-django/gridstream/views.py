"""
Gridstream API ViewSets.

Endpoints:
  /games/                       — scoreboard (by season/week)
  /games/live/                  — live game hydration for WebSocket bridge
  /games/{id}/                  — game detail
  /games/{id}/plays/            — play-by-play (cursor paginated)
  /games/{id}/drives/           — drive summaries
  /games/{id}/boxscore/         — player + team stats for a game
  /games/{id}/personnel/        — per-team snap usage + active player usage
  /teams/                       — all teams
  /teams/{abbr}/                — team detail
  /teams/{abbr}/roster/         — current roster
  /teams/{abbr}/free-agent-tracker/ — Ourlads-style free-agent tracker
  /teams/{abbr}/schedule/       — team schedule for a season
  /teams/{abbr}/season-stats/   — per-season aggregate stats for a team
  /teams/{abbr}/game-log/       — per-game results with box stats for a team
  /teams/{abbr}/dvoa/           — DVOA history + latest snapshots for a team
  /teams/dvoa/                  — league-wide team DVOA snapshots by season
  /teams/rankings/              — league/conf/div stat rankings (?season=&abbr=)
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
import re
from datetime import date
from collections import defaultdict
from functools import lru_cache

import requests
from django.conf import settings
from django.db import connections
from django.db.models import (
    Q,
    F,
    Sum,
    Count,
    Min,
    Max,
    Case,
    When,
    Value,
    IntegerField,
    FloatField,
    ExpressionWrapper,
    Avg,
    OuterRef,
    Subquery,
    Exists,
    Prefetch,
)
from django.db.models.functions import Coalesce, Greatest, Least
from django.db.models.expressions import RawSQL
from django.db.utils import OperationalError, ProgrammingError
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import NotFound
from rest_framework.filters import OrderingFilter

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
    PlayerContract,
    PlayerTransaction,
    DraftProspect,
    DraftProspectRanking,
    DraftMockDraft,
    TeamFreeAgentTrackerEntry,
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
    TeamDvoaRating,
    TeamRbsdmMetric,
    PlayerRbsdmQbMetric,
)
from .serializers import (
    TeamListSerializer,
    TeamMinimalSerializer,
    TeamDetailSerializer,
    VenueSerializer,
    PlayerListSerializer,
    PlayerDetailSerializer,
    PlayerTransactionSerializer,
    TeamFreeAgentTrackerEntrySerializer,
    TeamFreeAgencyTransactionSerializer,
    TeamFreeAgencyContractChangeSerializer,
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
    TeamDvoaRatingSerializer,
    TeamRbsdmMetricSerializer,
    PlayerRbsdmQbMetricSerializer,
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

TEAM_ABBR_NORMALIZE = {"LAR": "LA", "STL": "LA", "SD": "LAC", "OAK": "LV"}
TEAM_ABBR_TO_OURLADS_CODE = {"ARI": "ARZ", "LA": "LAR"}

FREE_AGENCY_STATUS_DISPLAY = {
    "ACQUIRED_FA_OR_TRADE_2026": "ACQUIRED 2026",
    "RE_SIGNED_2026": "RE-SIGNED 2026",
    "UFA": "UFA",
    "RFA": "RFA",
    "ERFA": "ERFA",
}
TANKATHON_FULL_DRAFT_URL = "https://www.tankathon.com/nfl/full_draft"
NFL_DRAFT_IQ_DRAFT_CONSENSUS_URL = "https://www.nfldraftiq.com/api/draft-consensus"
NFL_DRAFT_IQ_DRAFT_CONSENSUS_PAGE_URL = "https://www.nfldraftiq.com/draft-consensus"
NFL_DRAFT_IQ_TRUE_ADP_URL = "https://www.nfldraftiq.com/api/true-adp/players"
NFL_DRAFT_IQ_TRUE_ADP_PAGE_URL = "https://www.nfldraftiq.com/"
NFL_DRAFT_IQ_TIMEFRAME_DAYS = 14
NFL_DRAFT_IQ_LIMIT = 200
TANKATHON_ROUND_BLOCK_RE = re.compile(
    r'<div class="round-title">(?P<title>[^<]+)</div><table class="full-draft">(?P<body>.*?)</table>',
    re.IGNORECASE | re.DOTALL,
)
TANKATHON_PICK_ROW_RE = re.compile(
    r'<tr><td class="pick-number">(?P<overall>\d+)(?P<extra>.*?)</td>\s*<td>(?P<body>.*?)</td></tr>',
    re.IGNORECASE | re.DOTALL,
)
TANKATHON_LOGO_CODE_RE = re.compile(r"/nfl/(?P<code>[a-z0-9_]+)\.svg", re.IGNORECASE)
TANKATHON_TRADE_FROM_RE = re.compile(
    r'<div class="trade">.*?<span class="desktop">(?P<abbr>[A-Z]{2,3})</span>',
    re.IGNORECASE | re.DOTALL,
)
NFL_DRAFT_IQ_PICK_RANGE_RE = re.compile(
    r"Pick\s+(?P<start>\d+)\s*-\s*(?P<end>\d+)", re.IGNORECASE
)
TANKATHON_TEAM_CODE_OVERRIDES = {"WSH": "WAS"}
NFL_COM_2026_DRAFT_NEEDS_URL = (
    "https://www.nfl.com/news/2026-nfl-draft-order-round-1-needs-for-all-32-teams"
)
TEAM_NEED_LABELS = {
    "QB": "Quarterback",
    "RB": "Running back",
    "WR": "Wide receiver",
    "TE": "Tight end",
    "OL": "Offensive line",
    "EDGE": "Edge",
    "DL": "Defensive line",
    "LB": "Linebacker",
    "CB": "Cornerback",
    "S": "Safety",
    "K": "Kicker",
    "P": "Punter",
    "LS": "Long snapper",
}
NFL_COM_2026_TEAM_NEEDS = {
    "TEN": ["WR", "Edge", "CB", "OL", "DL"],
    "NYG": ["WR", "OL", "CB", "LB", "DL"],
    "CLE": ["QB", "OL", "WR", "CB", "LB"],
    "WAS": ["Edge", "WR", "LB", "CB", "TE"],
    "NO": ["Edge", "WR", "CB", "OL", "DL"],
    "KC": ["CB", "RB", "S", "WR", "OL"],
    "CIN": ["Edge", "OL", "CB", "DL", "S"],
    "MIA": ["QB", "WR", "CB", "Edge", "OL"],
    "LA": ["OL", "WR", "CB", "Edge", "QB"],
    "DET": ["OL", "Edge", "DL", "CB", "S"],
    "CHI": ["S", "DL", "CB", "Edge", "OL"],
    "ARI": ["QB", "OL", "S", "RB", "Edge"],
    "SEA": ["CB", "RB", "OL", "WR", "Edge"],
    "BAL": ["Edge", "DL", "OL", "S", "WR"],
    "TB": ["Edge", "LB", "TE", "CB", "OL"],
    "IND": ["Edge", "OL", "S", "WR", "DL"],
    "NYJ": ["QB", "Edge", "CB", "WR", "OL"],
    "PIT": ["QB", "WR", "CB", "S", "OL"],
    "ATL": ["DL", "WR", "CB", "LB", "Edge"],
    "DAL": ["Edge", "CB", "LB", "S", "OL"],
    "MIN": ["S", "CB", "OL", "WR", "LB"],
    "CAR": ["OL", "Edge", "LB", "S", "WR"],
    "GB": ["CB", "OL", "DL", "LB", "Edge"],
    "JAX": ["CB", "LB", "OL", "S", "DL"],
    "PHI": ["Edge", "CB", "TE", "OL", "S"],
    "BUF": ["Edge", "WR", "OL", "CB", "S"],
    "SF": ["WR", "OL", "Edge", "S", "CB"],
    "HOU": ["OL", "DL", "S", "Edge", "LB"],
    "DEN": ["LB", "TE", "DL", "RB", "OL"],
    "NE": ["Edge", "OL", "S", "WR", "DL"],
    "LV": ["QB", "OL", "WR", "CB", "Edge"],
    "LAC": ["OL", "Edge", "DL", "S", "CB"],
}
TEAM_NEED_TARGETS = {
    "QB": 2,
    "RB": 3,
    "WR": 5,
    "TE": 3,
    "OL": 8,
    "EDGE": 4,
    "DL": 4,
    "LB": 4,
    "CB": 4,
    "S": 3,
    "K": 1,
    "P": 1,
    "LS": 1,
}


def _current_free_agency_year() -> int:
    return date.today().year


def _normalize_team_abbreviation_for_ourlads(team_abbr: str | None) -> str:
    abbr = str(team_abbr or "").upper().strip()
    if not abbr:
        return ""
    return TEAM_ABBR_TO_OURLADS_CODE.get(abbr, abbr)


def _derive_team_roster_free_agency_status(
    team: Team, entry: TeamFreeAgentTrackerEntry
):
    if entry.signed_with_team_id == team.id:
        if entry.team_id == team.id:
            return "RE_SIGNED_2026"
        return "ACQUIRED_FA_OR_TRADE_2026"
    if entry.team_id == team.id and entry.signed_with_team_id is None:
        fa_type = (entry.fa_type or "").upper().strip()
        if fa_type in {"UFA", "RFA", "ERFA"}:
            return fa_type
    return None


def _canonical_name_key(value):
    if not value:
        return ""
    return "".join(ch for ch in str(value).lower() if ch.isalnum())


PERSON_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def _person_name_match_keys(value) -> set[str]:
    if not value:
        return set()

    raw = str(value).strip()
    keys = {_canonical_name_key(raw)}
    tokens = [token for token in re.split(r"\s+", raw) if token]
    if tokens:
        normalized_tokens = [
            re.sub(r"[^a-z0-9]", "", token.lower()) for token in tokens
        ]
        if normalized_tokens and normalized_tokens[-1] in PERSON_NAME_SUFFIXES:
            stripped = " ".join(tokens[:-1]).strip()
            if stripped:
                keys.add(_canonical_name_key(stripped))
    return {key for key in keys if key}


def _initial_last_name_key(value):
    if not value:
        return ""
    parts = [part for part in str(value).strip().split() if part]
    if len(parts) < 2:
        return ""
    return _canonical_name_key(f"{parts[0][0]}{parts[-1]}")


def _is_missing_relation_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg and "relation" in msg


@lru_cache(maxsize=16)
def _raw_table_exists_cached(table_name):
    with connections["nfl"].cursor() as cursor:
        cursor.execute("SELECT to_regclass(%s)", [table_name])
        return cursor.fetchone()[0] is not None


def _normalize_tankathon_team_code(value: str | None) -> str:
    token = str(value or "").upper().strip()
    if not token:
        return ""
    return TANKATHON_TEAM_CODE_OVERRIDES.get(token, token)


def _fetch_tankathon_draft_rows() -> list[dict]:
    cache_key_value = "gridstream:tankathon:nfl:full_draft"
    cached = cache_get(cache_key_value)
    if isinstance(cached, list):
        return cached

    try:
        response = requests.get(
            TANKATHON_FULL_DRAFT_URL,
            timeout=20,
            headers={"User-Agent": "engineering-atlas/team-draft-outlook"},
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("Failed to fetch Tankathon full draft page: %s", exc)
        return []

    rows: list[dict] = []
    for round_match in TANKATHON_ROUND_BLOCK_RE.finditer(response.text or ""):
        title = str(round_match.group("title") or "").strip()
        digits = "".join(ch for ch in title if ch.isdigit())
        if not digits:
            continue
        round_number = int(digits)
        round_body = round_match.group("body") or ""
        for row_match in TANKATHON_PICK_ROW_RE.finditer(round_body):
            overall_pick = int(row_match.group("overall"))
            row_body = row_match.group("body") or ""
            logo_match = TANKATHON_LOGO_CODE_RE.search(row_body)
            if not logo_match:
                continue
            current_team = _normalize_tankathon_team_code(logo_match.group("code"))
            if not current_team:
                continue
            trade_match = TANKATHON_TRADE_FROM_RE.search(row_body)
            original_team = (
                _normalize_tankathon_team_code(trade_match.group("abbr"))
                if trade_match
                else current_team
            )
            rows.append(
                {
                    "round": round_number,
                    "overall_pick": overall_pick,
                    "current_team_abbr": current_team,
                    "original_team_abbr": original_team,
                    "compensatory": "plus-circle" in (row_match.group("extra") or ""),
                }
            )

    if rows:
        cache_set(cache_key_value, rows, ttl=TTL_LONG)
    return rows


def _fetch_nfl_draft_iq_consensus() -> dict:
    cache_key_value = f"gridstream:nfldraftiq:draft-consensus:{NFL_DRAFT_IQ_TIMEFRAME_DAYS}:{NFL_DRAFT_IQ_LIMIT}"
    cached = cache_get(cache_key_value)
    if isinstance(cached, dict):
        return cached

    try:
        response = requests.get(
            NFL_DRAFT_IQ_DRAFT_CONSENSUS_URL,
            params={
                "timeframeDays": NFL_DRAFT_IQ_TIMEFRAME_DAYS,
                "limit": NFL_DRAFT_IQ_LIMIT,
            },
            timeout=20,
            headers={"User-Agent": "engineering-atlas/team-draft-outlook"},
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Failed to fetch NFL Draft IQ consensus data: %s", exc)
        return {}

    if isinstance(payload, dict):
        cache_set(cache_key_value, payload, ttl=TTL_MEDIUM)
        return payload
    return {}


def _fetch_nfl_draft_iq_true_adp_players() -> list[dict]:
    cache_key_value = f"gridstream:nfldraftiq:true-adp:{NFL_DRAFT_IQ_TIMEFRAME_DAYS}:{NFL_DRAFT_IQ_LIMIT}"
    cached = cache_get(cache_key_value)
    if isinstance(cached, list):
        return cached

    try:
        response = requests.get(
            NFL_DRAFT_IQ_TRUE_ADP_URL,
            params={
                "timeframeDays": NFL_DRAFT_IQ_TIMEFRAME_DAYS,
                "limit": NFL_DRAFT_IQ_LIMIT,
            },
            timeout=20,
            headers={"User-Agent": "engineering-atlas/team-draft-outlook"},
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Failed to fetch NFL Draft IQ true ADP data: %s", exc)
        return []

    rows = (
        payload.get("data", {}).get("players", []) if isinstance(payload, dict) else []
    )
    if isinstance(rows, list):
        cache_set(cache_key_value, rows, ttl=TTL_MEDIUM)
        return rows
    return []


def _parse_draft_iq_pick_range(value: str | None) -> tuple[int | None, int | None]:
    match = NFL_DRAFT_IQ_PICK_RANGE_RE.search(str(value or ""))
    if not match:
        return None, None
    try:
        return int(match.group("start")), int(match.group("end"))
    except (TypeError, ValueError):
        return None, None


def _coerce_int(value) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_float(value) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _position_to_need_bucket(
    position: str | None,
    position_group: str | None = None,
    depth_position: str | None = None,
):
    depth_token = str(depth_position or "").upper().strip()
    token = depth_token or str(position or "").upper().strip()
    group = str(position_group or "").upper().strip()
    if token == "QB" or group == "QB":
        return "QB"
    if token in {"RB", "FB"} or group == "RB":
        return "RB"
    if token in {"WR", "LWR", "SWR", "RWR"} or group == "WR":
        return "WR"
    if token == "TE" or group == "TE":
        return "TE"
    if token in {"C", "G", "T", "OG", "OT", "LT", "RT", "LG", "RG", "OL"} or group in {
        "OL",
        "C",
        "G",
        "T",
        "OG",
        "OT",
    }:
        return "OL"
    if token in {"EDGE", "ED", "DE"} or group in {"EDGE", "ED", "DE"}:
        return "EDGE"
    if token in {"DT", "NT", "DL", "DI"} or group in {"DT", "NT", "DL"}:
        return "DL"
    if token in {"LB", "ILB", "MLB", "OLB", "LOLB", "ROLB", "SLB", "WLB"} or group in {
        "LB",
        "ILB",
        "MLB",
        "OLB",
    }:
        return "LB"
    if token in {"CB", "LCB", "RCB", "NB"} or group == "CB":
        return "CB"
    if token in {"S", "FS", "SS"} or group in {"S", "DB"}:
        return "S"
    if token == "K" or group == "K":
        return "K"
    if token in {"P", "PT"} or group == "P":
        return "P"
    if token == "LS" or group == "LS":
        return "LS"
    return None


def _build_source_backed_team_needs(
    team_abbr: str | None, season_year: int
) -> list[dict]:
    if season_year != 2026:
        return []

    raw_needs = NFL_COM_2026_TEAM_NEEDS.get(str(team_abbr or "").upper().strip())
    if not raw_needs:
        return []

    needs = []
    for index, raw_need in enumerate(raw_needs):
        key = str(raw_need or "").upper().strip()
        if not key:
            continue
        needs.append(
            {
                "key": key,
                "label": TEAM_NEED_LABELS.get(key, str(raw_need).title()),
                "score": len(raw_needs) - index,
                "detail": f"Priority #{index + 1} from NFL.com's Round 1 needs board",
            }
        )
    return needs


def _build_team_draft_targets(
    team: Team, draft_picks: list[dict], team_needs: list[dict]
) -> dict:
    first_pick = None
    if draft_picks:
        first_pick = min(
            (
                row.get("overall_pick")
                for row in draft_picks
                if isinstance(row.get("overall_pick"), int)
            ),
            default=None,
        )

    if first_pick is None:
        return {"source_url": NFL_DRAFT_IQ_DRAFT_CONSENSUS_PAGE_URL, "targets": []}

    team_names = {
        str(team.display_name or "").strip(),
        str(team.short_display_name or "").strip(),
        " ".join(part for part in [team.location, team.name] if part).strip(),
    }
    team_names = {value for value in team_names if value}

    need_priority = {
        str(entry.get("key") or "").upper().strip(): index
        for index, entry in enumerate(team_needs)
        if entry.get("key")
    }
    need_label_by_key = {
        str(entry.get("key") or "")
        .upper()
        .strip(): str(entry.get("label") or "")
        .strip()
        for entry in team_needs
        if entry.get("key")
    }

    true_adp_rows = _fetch_nfl_draft_iq_true_adp_players()
    true_adp_by_player_id = {
        _coerce_int(row.get("player_id")): row
        for row in true_adp_rows
        if _coerce_int(row.get("player_id"))
    }
    consensus_payload = _fetch_nfl_draft_iq_consensus()
    candidates: dict[int, dict] = {}

    def _register_candidate(row: dict, team_mock_count: int, consensus_type: str):
        player_id = _coerce_int(row.get("player_id"))
        if player_id is None:
            return

        range_start, range_end = _parse_draft_iq_pick_range(row.get("range"))
        range_midpoint = None
        if range_start is not None and range_end is not None:
            range_midpoint = (range_start + range_end) / 2
            if first_pick < range_start - 8 or first_pick > range_end + 8:
                return

        true_adp_row = true_adp_by_player_id.get(player_id, {})
        true_adp = _coerce_float(true_adp_row.get("true_adp"))
        overall_rank = _coerce_int(true_adp_row.get("overall_rank"))
        position_bucket = _position_to_need_bucket(row.get("position"))
        need_index = need_priority.get(str(position_bucket or "").upper())
        need_label = need_label_by_key.get(str(position_bucket or "").upper()) or (
            TEAM_NEED_LABELS.get(position_bucket, position_bucket)
            if position_bucket
            else None
        )
        need_bonus = max(0, 10 - (need_index * 2)) if need_index is not None else 0
        talent_bonus = max(0, 20 - overall_rank) if overall_rank is not None else 0
        distance_anchor = true_adp if true_adp is not None else range_midpoint
        pick_distance = (
            abs(distance_anchor - first_pick) if distance_anchor is not None else 0
        )
        score = float(team_mock_count + need_bonus + talent_bonus - pick_distance)
        total_mock_count = _coerce_int(row.get("mockCount"))
        if total_mock_count is None:
            total_mock_count = sum(
                _coerce_int(team_row.get("mockCount")) or 0
                for team_row in row.get("teamBreakdown", [])
                if isinstance(team_row, dict)
            )

        existing = candidates.get(player_id)
        candidate = {
            "player_id": player_id,
            "name": str(row.get("name") or "").strip(),
            "position": str(row.get("position") or "").strip(),
            "school": str(row.get("school") or "").strip(),
            "college_logo_url": row.get("collegeLogoUrl"),
            "image_url": row.get("imageUrl"),
            "range": str(row.get("range") or "").strip() or None,
            "team_mock_count": team_mock_count,
            "total_mock_count": total_mock_count,
            "consensus_type": consensus_type,
            "overall_rank": overall_rank,
            "true_adp": true_adp,
            "need_key": position_bucket,
            "need_label": need_label,
            "fit_reason": (
                f"Matches {team.display_name}'s #{need_index + 1} need at {need_label}"
                if need_index is not None and need_label
                else None
            ),
            "score": score,
        }
        if existing is None or candidate["score"] > existing["score"]:
            candidates[player_id] = candidate

    for row in consensus_payload.get("decisive", []):
        if not isinstance(row, dict):
            continue
        if str(row.get("team") or "").strip() not in team_names:
            continue
        _register_candidate(row, _coerce_int(row.get("mockCount")) or 0, "decisive")

    for row in consensus_payload.get("indecisive", []):
        if not isinstance(row, dict):
            continue
        team_match = None
        for team_row in row.get("teamBreakdown", []):
            if not isinstance(team_row, dict):
                continue
            if str(team_row.get("teamName") or "").strip() in team_names:
                team_match = team_row
                break
        if not team_match:
            continue
        _register_candidate(
            row, _coerce_int(team_match.get("mockCount")) or 0, "indecisive"
        )

    targets = sorted(
        candidates.values(),
        key=lambda row: (
            -float(row.get("score") or 0),
            -int(row.get("team_mock_count") or 0),
            float(row.get("true_adp") or 999),
            str(row.get("name") or ""),
        ),
    )[:5]

    if len(targets) < 5:
        seen_ids = {
            entry["player_id"]
            for entry in targets
            if entry.get("player_id") is not None
        }
        for row in true_adp_rows:
            player_id = _coerce_int(row.get("player_id"))
            if player_id is None or player_id in seen_ids:
                continue
            position_bucket = _position_to_need_bucket(row.get("position"))
            if position_bucket == "QB" and "QB" not in need_priority:
                continue
            need_index = need_priority.get(str(position_bucket or "").upper())
            if need_priority and need_index is None:
                continue
            need_label = need_label_by_key.get(str(position_bucket or "").upper()) or (
                TEAM_NEED_LABELS.get(position_bucket, position_bucket)
                if position_bucket
                else None
            )
            overall_rank = _coerce_int(row.get("overall_rank"))
            true_adp = _coerce_float(row.get("true_adp"))
            pick_distance = abs((true_adp or first_pick) - first_pick)
            if pick_distance > 12:
                continue
            targets.append(
                {
                    "player_id": player_id,
                    "name": str(row.get("name") or "").strip(),
                    "position": str(row.get("position") or "").strip(),
                    "school": str(row.get("school") or "").strip(),
                    "college_logo_url": row.get("college_logo_url"),
                    "image_url": row.get("imageUrl"),
                    "range": None,
                    "team_mock_count": 0,
                    "total_mock_count": _coerce_int(row.get("total_sources")),
                    "consensus_type": "board",
                    "overall_rank": overall_rank,
                    "true_adp": true_adp,
                    "need_key": position_bucket,
                    "need_label": need_label,
                    "fit_reason": (
                        f"Matches {team.display_name}'s #{need_index + 1} need at {need_label}"
                        if need_index is not None and need_label
                        else None
                    ),
                    "score": float(40 - pick_distance),
                }
            )
            seen_ids.add(player_id)
            if len(targets) >= 5:
                break

    return {
        "source_url": NFL_DRAFT_IQ_DRAFT_CONSENSUS_PAGE_URL,
        "targets": targets[:5],
    }


def _draft_prospect_position_tokens(value: str | None) -> set[str]:
    raw = str(value or "").upper().strip()
    if not raw:
        return set()

    normalized = raw.replace(" ", "")
    tokens = {normalized}
    tokens.update(token for token in re.split(r"[^A-Z]+", normalized) if token)
    bucket = _position_to_need_bucket(normalized)
    if bucket:
        tokens.add(bucket)

    alias_map = {
        "ED": {"EDGE", "DE"},
        "EDGE": {"ED", "DE"},
        "DE": {"EDGE", "ED"},
        "LB": {"ILB", "OLB", "MLB"},
        "DB": {"CB", "S"},
        "S": {"DB"},
        "CB": {"DB"},
        "OT": {"OL"},
        "OG": {"OL"},
        "C": {"OL"},
    }
    expanded = set(tokens)
    for token in list(tokens):
        expanded.update(alias_map.get(token, set()))
    return {token for token in expanded if token}


def _serialize_team_minimal_reference(team: Team) -> dict:
    espn_logo_key = {
        "WAS": "wsh",
        "LA": "lar",
    }.get(
        str(team.abbreviation or "").upper().strip(),
        str(team.abbreviation or "").lower().strip(),
    )
    color_logo_url = (
        f"https://a.espncdn.com/i/teamlogos/nfl/500/{espn_logo_key}.png"
        if espn_logo_key
        else None
    )
    return {
        "id": team.id,
        "abbreviation": team.abbreviation,
        "display_name": team.display_name,
        "short_display_name": team.short_display_name,
        "color_primary": team.color_primary,
        "color_secondary": team.color_secondary,
        "logo_url": color_logo_url,
    }


def _parse_draft_projection_pick_range(
    value: str | None,
) -> tuple[int | None, int | None]:
    raw = str(value or "").upper().strip()
    if not raw:
        return None, None
    if "UDFA" in raw:
        return 257, 300

    round_match = re.search(r"\b([1-7])(ST|ND|RD|TH)\b", raw)
    top_match = re.search(r"TOP\s+(\d+)", raw)
    if top_match:
        try:
            top_value = int(top_match.group(1))
        except (TypeError, ValueError):
            top_value = None
        if top_value:
            if round_match and int(round_match.group(1)) > 1:
                round_num = int(round_match.group(1))
                round_start = 1 + ((round_num - 1) * 32)
                return round_start, min(
                    round_num * 32, round_start + max(top_value - 1, 7)
                )
            return 1, top_value

    if not round_match:
        return None, None

    round_num = int(round_match.group(1))
    round_start = 1 + ((round_num - 1) * 32)
    round_end = round_num * 32
    if "EARLY" in raw or "TOP" in raw:
        return round_start, min(round_end, round_start + 10)
    if "MID" in raw:
        return min(round_end, round_start + 10), min(round_end, round_start + 21)
    if "LATE" in raw:
        return max(round_start, round_end - 10), round_end
    return round_start, round_end


def _estimate_draft_target_pick_window(
    target: dict,
) -> tuple[int | None, int | None, float | None]:
    range_start, range_end = _parse_draft_iq_pick_range(target.get("range"))
    projection_start, projection_end = _parse_draft_projection_pick_range(
        target.get("draft_projection")
    )

    anchor = _coerce_float(target.get("true_adp"))
    if anchor is None:
        anchor_rank = _coerce_int(target.get("overall_rank")) or _coerce_int(
            target.get("buzz_overall_rank")
        )
        if anchor_rank is not None:
            anchor = float(anchor_rank)

    window_start = None
    window_end = None
    if range_start is not None and range_end is not None:
        # Treat an explicit consensus range as a hard pick window.
        window_start = range_start
        window_end = range_end
    elif projection_start is not None and projection_end is not None:
        window_start = projection_start
        window_end = projection_end

    if anchor is not None and not (range_start is not None and range_end is not None):
        buffer = (
            5 if anchor <= 16 else 7 if anchor <= 40 else 10 if anchor <= 80 else 14
        )
        anchor_start = max(1, int(anchor - buffer))
        anchor_end = max(anchor_start, int(anchor + buffer))
        window_start = (
            min(window_start, anchor_start)
            if window_start is not None
            else anchor_start
        )
        window_end = (
            max(window_end, anchor_end) if window_end is not None else anchor_end
        )

    return window_start, window_end, anchor


def _attach_draft_fit_teams(
    targets: list[dict], season_year: int, draft_rows: list[dict]
) -> list[dict]:
    if not targets or not draft_rows:
        return targets

    try:
        teams = list(
            Team.objects.using("nfl")
            .filter(is_active=True)
            .prefetch_related("logos")
            .only(
                "id",
                "abbreviation",
                "display_name",
                "short_display_name",
                "color_primary",
                "color_secondary",
            )
        )
    except (ProgrammingError, OperationalError):
        return targets

    team_refs: dict[str, dict] = {}
    team_needs_by_abbr: dict[str, dict[str, dict]] = {}
    for team in teams:
        team_needs = _build_source_backed_team_needs(team.abbreviation, season_year)
        if not team_needs:
            continue
        team_refs[str(team.abbreviation or "").upper().strip()] = (
            _serialize_team_minimal_reference(team)
        )
        team_needs_by_abbr[str(team.abbreviation or "").upper().strip()] = {
            str(entry.get("key") or "")
            .upper()
            .strip(): {
                **entry,
                "rank": index + 1,
            }
            for index, entry in enumerate(team_needs)
            if entry.get("key")
        }

    if not team_refs:
        return [{**target, "fit_teams": []} for target in targets]

    picks_by_team: dict[str, list[dict]] = defaultdict(list)
    for row in draft_rows:
        team_abbr = str(row.get("current_team_abbr") or "").upper().strip()
        overall_pick = _coerce_int(row.get("overall_pick"))
        if not team_abbr or overall_pick is None or team_abbr not in team_refs:
            continue
        picks_by_team[team_abbr].append(row)

    enriched_targets: list[dict] = []
    for target in targets:
        need_key = str(
            target.get("need_key")
            or _position_to_need_bucket(target.get("position"))
            or ""
        ).upper()
        if not need_key:
            enriched_targets.append({**target, "fit_teams": []})
            continue

        window_start, window_end, anchor = _estimate_draft_target_pick_window(target)
        fit_teams = []
        for team_abbr, needs_by_key in team_needs_by_abbr.items():
            need_entry = needs_by_key.get(need_key)
            if need_entry is None:
                continue

            team_picks = picks_by_team.get(team_abbr, [])
            if not team_picks:
                continue

            candidate_picks = []
            for pick in team_picks:
                overall_pick = _coerce_int(pick.get("overall_pick"))
                if overall_pick is None:
                    continue
                if (
                    window_start is not None
                    and window_end is not None
                    and not (window_start <= overall_pick <= window_end)
                ):
                    continue
                candidate_picks.append(pick)

            if not candidate_picks:
                continue

            candidate_picks.sort(
                key=lambda row: (
                    _coerce_int(row.get("overall_pick")) or 999,
                    _coerce_int(row.get("round")) or 99,
                )
            )
            first_pick = candidate_picks[0]
            first_pick_number = _coerce_int(first_pick.get("overall_pick"))
            if first_pick_number is None:
                continue
            relevant_pick_numbers = [
                pick_number
                for pick_number in (
                    _coerce_int(row.get("overall_pick")) for row in candidate_picks
                )
                if pick_number is not None
            ]
            pick_label = (
                f"Picks {', '.join(f'#{pick_number}' for pick_number in relevant_pick_numbers)}"
                if len(relevant_pick_numbers) > 1
                else f"Pick #{first_pick_number}"
            )
            need_rank = _coerce_int(need_entry.get("rank")) or 99
            fit_teams.append(
                {
                    "team_detail": team_refs[team_abbr],
                    "need_key": need_key,
                    "need_label": need_entry.get("label"),
                    "need_rank": need_rank,
                    "pick_label": pick_label,
                    "round": _coerce_int(first_pick.get("round")),
                    "overall_pick": first_pick_number,
                }
            )

        fit_teams.sort(
            key=lambda row: (
                int(row.get("overall_pick") or 999),
                int(row.get("need_rank") or 99),
                str(row.get("team_detail", {}).get("display_name") or ""),
            )
        )
        enriched_targets.append(
            {
                **target,
                "fit_teams": fit_teams,
            }
        )

    return enriched_targets


def _serialize_draft_prospect_for_target(prospect: DraftProspect) -> dict:
    return {
        "source_url": prospect.source_url or None,
        "source_label": "NFLDraftBuzz scouting report",
        "class_year": prospect.class_year or None,
        "hometown": prospect.hometown or None,
        "role": prospect.role or None,
        "jersey_number": prospect.jersey_number or None,
        "draft_year": prospect.season,
        "draft_projection": prospect.draft_projection or None,
        "buzz_overall_rating": prospect.overall_rating,
        "buzz_overall_rank": prospect.overall_rank,
        "buzz_position_rank": prospect.position_rank,
        "buzz_position_rank_group": prospect.position_rank_group or None,
        "all_scouts_overall_rank": prospect.all_scouts_overall_rank,
        "all_scouts_position_rank": prospect.all_scouts_position_rank,
        "height": prospect.height or None,
        "weight": prospect.weight,
        "forty_yard": prospect.forty_yard,
        "hand_size": prospect.hand_size or None,
        "arm_length": prospect.arm_length or None,
        "age": prospect.age,
        "birth_date": prospect.birth_date.isoformat() if prospect.birth_date else None,
        "source_last_updated": (
            prospect.source_last_updated.isoformat()
            if prospect.source_last_updated
            else None
        ),
        "college_games": prospect.college_games,
        "college_snaps": prospect.college_snaps,
        "bio": prospect.bio or None,
        "summary": prospect.summary or None,
        "strengths": list(prospect.strengths or []),
        "weaknesses": list(prospect.weaknesses or []),
        "honors": list(prospect.honors or []),
        "production_stats": list(prospect.production_stats or []),
        "scouting_grades": list(prospect.scouting_grades or []),
        "measurable_percentiles": list(prospect.measurable_percentiles or []),
        "recruiting_ratings": list(prospect.recruiting_ratings or []),
        "comparison_players": list(prospect.comparison_players or []),
        "image_url": prospect.image_url or None,
        "college_logo_url": prospect.college_logo_url or None,
    }


def _attach_draft_prospect_details(targets: list[dict], season_year: int) -> list[dict]:
    if not targets:
        return targets

    try:
        prospects = list(
            DraftProspect.objects.using("nfl")
            .filter(season=season_year, source="nfldraftbuzz")
            .only(
                "id",
                "name",
                "position",
                "school",
                "class_year",
                "hometown",
                "role",
                "jersey_number",
                "source_url",
                "image_url",
                "college_logo_url",
                "overall_rating",
                "overall_rank",
                "position_rank",
                "position_rank_group",
                "draft_projection",
                "all_scouts_overall_rank",
                "all_scouts_position_rank",
                "height",
                "weight",
                "forty_yard",
                "hand_size",
                "arm_length",
                "age",
                "birth_date",
                "source_last_updated",
                "college_games",
                "college_snaps",
                "bio",
                "summary",
                "strengths",
                "weaknesses",
                "honors",
                "production_stats",
                "scouting_grades",
                "measurable_percentiles",
                "recruiting_ratings",
                "comparison_players",
            )
        )
    except (ProgrammingError, OperationalError):
        return targets

    prospects_by_name: dict[str, list[DraftProspect]] = defaultdict(list)
    for prospect in prospects:
        for key in _person_name_match_keys(prospect.name):
            prospects_by_name[key].append(prospect)

    enriched_targets: list[dict] = []
    for target in targets:
        candidate_map: dict[int, DraftProspect] = {}
        for target_name_key in _person_name_match_keys(target.get("name")):
            for candidate in prospects_by_name.get(target_name_key, []):
                candidate_map[candidate.id] = candidate
        candidates = list(candidate_map.values())
        if not candidates:
            enriched_targets.append(target)
            continue

        target_school_key = _canonical_name_key(target.get("school"))
        target_position_tokens = _draft_prospect_position_tokens(target.get("position"))
        target_rank = _coerce_int(target.get("overall_rank"))

        def _candidate_score(prospect: DraftProspect):
            school_score = (
                0
                if target_school_key
                and _canonical_name_key(prospect.school) == target_school_key
                else 1
            )
            position_score = (
                0
                if target_position_tokens
                and target_position_tokens
                & _draft_prospect_position_tokens(prospect.position)
                else 1
            )
            rank_score = abs((prospect.overall_rank or 999) - (target_rank or 999))
            return (school_score, position_score, rank_score, prospect.id)

        best = sorted(candidates, key=_candidate_score)[0]
        enriched_targets.append(
            {**target, **_serialize_draft_prospect_for_target(best)}
        )

    return enriched_targets


def _build_team_draft_outlook(
    team: Team,
    season_year: int,
    unsigned_entries: list[TeamFreeAgentTrackerEntry],
    incoming_entries: list[TeamFreeAgentTrackerEntry],
    re_signed_entries: list[TeamFreeAgentTrackerEntry],
    cuts: list[PlayerTransaction],
    signed_elsewhere: list[PlayerTransaction],
) -> dict:
    draft_rows = _fetch_tankathon_draft_rows()
    draft_picks = sorted(
        (
            row
            for row in draft_rows
            if row.get("current_team_abbr") == team.abbreviation
        ),
        key=lambda row: (
            _coerce_int(row.get("round")) or 99,
            _coerce_int(row.get("overall_pick")) or 999,
        ),
    )

    source_backed_needs = _build_source_backed_team_needs(
        team.abbreviation, season_year
    )
    if source_backed_needs:
        team_needs = source_backed_needs
    else:
        active_players = list(
            Player.objects.using("nfl")
            .filter(current_team=team, is_active=True)
            .exclude(roster_status__in=["UFA", "RET", "CUT"])
            .only(
                "id",
                "display_name",
                "position",
                "position_group",
                "depth_chart_position",
                "roster_status",
            )
        )

        bucket_members: dict[str, set[str]] = defaultdict(set)
        bucket_additions: dict[str, set[str]] = defaultdict(set)
        bucket_departures: dict[str, set[str]] = defaultdict(set)

        def _person_key(player_id, name: str | None) -> str:
            return str(player_id) if player_id else _canonical_name_key(name)

        for player in active_players:
            bucket = _position_to_need_bucket(
                player.position, player.position_group, player.depth_chart_position
            )
            if not bucket:
                continue
            bucket_members[bucket].add(_person_key(player.id, player.display_name))

        for entry in list(incoming_entries) + list(re_signed_entries):
            bucket = _position_to_need_bucket(entry.position)
            if not bucket:
                continue
            bucket_additions[bucket].add(
                _person_key(entry.player_id, entry.player_name)
            )

        for entry in unsigned_entries:
            bucket = _position_to_need_bucket(entry.position)
            if not bucket:
                continue
            bucket_departures[bucket].add(
                _person_key(entry.player_id, entry.player_name)
            )

        for txn in list(cuts) + list(signed_elsewhere):
            player = getattr(txn, "player", None)
            bucket = _position_to_need_bucket(
                getattr(player, "position", None) or None,
                getattr(player, "position_group", None) or None,
            )
            if not bucket:
                bucket = _position_to_need_bucket(
                    getattr(player, "position", None)
                    or getattr(txn, "player_position", None)
                    or None
                )
            if not bucket:
                continue
            bucket_departures[bucket].add(
                _person_key(
                    getattr(player, "id", None),
                    getattr(player, "display_name", None),
                )
            )

        team_needs = []
        for bucket, target in TEAM_NEED_TARGETS.items():
            active_count = len(bucket_members[bucket] | bucket_additions[bucket])
            departure_count = len(bucket_departures[bucket])
            score = max(target - active_count, 0) * 2 + departure_count
            if active_count <= 1 and bucket in {"OL", "CB", "EDGE", "WR"}:
                score += 1
            if score <= 0:
                continue
            detail_bits = [f"{active_count} under contract"]
            if departure_count:
                detail_bits.append(f"{departure_count} leaving / unsigned")
            team_needs.append(
                {
                    "key": bucket,
                    "label": TEAM_NEED_LABELS.get(bucket, bucket),
                    "score": score,
                    "detail": " · ".join(detail_bits),
                }
            )

        team_needs.sort(key=lambda row: (-row["score"], row["label"]))

    draft_targets = _build_team_draft_targets(team, draft_picks, team_needs)
    draft_targets["targets"] = _attach_draft_prospect_details(
        list(draft_targets.get("targets", [])), season_year
    )
    draft_targets["targets"] = _attach_draft_fit_teams(
        list(draft_targets.get("targets", [])),
        season_year,
        draft_rows,
    )
    return {
        "season": season_year,
        "source_url": TANKATHON_FULL_DRAFT_URL,
        "draft_picks": draft_picks,
        "team_needs": team_needs[:5],
        "draft_targets_source_url": draft_targets.get("source_url"),
        "draft_targets": draft_targets.get("targets", []),
    }


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

        player_ids = list(players.values_list("id", flat=True))
        serializer = PlayerListSerializer(players, many=True)
        payload = list(serializer.data)

        status_by_player_id = {}
        if player_ids:
            try:
                tracker_entries = (
                    TeamFreeAgentTrackerEntry.objects.filter(
                        season=_current_free_agency_year(), player_id__in=player_ids
                    )
                    .filter(Q(team=team) | Q(signed_with_team=team))
                    .select_related("team", "signed_with_team")
                    .order_by("player_id", "team__abbreviation", "fa_type")
                )
                priority = {
                    "RE_SIGNED_2026": 0,
                    "ACQUIRED_FA_OR_TRADE_2026": 1,
                    "ERFA": 2,
                    "RFA": 3,
                    "UFA": 4,
                }
                for entry in tracker_entries:
                    status_code = _derive_team_roster_free_agency_status(team, entry)
                    if not status_code or not entry.player_id:
                        continue
                    current = status_by_player_id.get(entry.player_id)
                    current_priority = priority.get(current, 99)
                    next_priority = priority.get(status_code, 99)
                    if current is None or next_priority < current_priority:
                        status_by_player_id[entry.player_id] = status_code
            except (ProgrammingError, OperationalError) as exc:
                if _is_missing_relation_error(exc):
                    logger.warning(
                        "Free-agent tracker table unavailable; returning roster without enrichment for %s: %s",
                        team.abbreviation,
                        exc,
                    )
                else:
                    raise

        for row in payload:
            player_id = row.get("id")
            status_code = status_by_player_id.get(player_id)
            row["free_agency_status"] = status_code
            row["free_agency_status_display"] = (
                FREE_AGENCY_STATUS_DISPLAY.get(status_code) if status_code else None
            )

        return Response(payload)

    @action(detail=True, methods=["get"], url_path="free-agent-tracker")
    @cached_view("teams", ttl=TTL_MEDIUM)
    def free_agent_tracker(self, request, abbreviation=None):
        """
        GET /teams/{abbr}/free-agent-tracker/?season=2026

        Returns the Ourlads-style team free-agent tracker for a calendar year.
        """
        team = self.get_object()
        season = request.query_params.get("season")
        try:
            season_year = (
                int(season) if season is not None else _current_free_agency_year()
            )
        except (TypeError, ValueError):
            season_year = _current_free_agency_year()

        tracker_player_ids: set[int] = set()
        entries_list: list[TeamFreeAgentTrackerEntry] = []
        incoming_entries_list: list[TeamFreeAgentTrackerEntry] = []
        incoming_data = []
        try:
            base_tracker_qs = (
                TeamFreeAgentTrackerEntry.objects.filter(season=season_year)
                .select_related("team", "signed_with_team", "player")
                .prefetch_related(
                    "team__logos",
                    "signed_with_team__logos",
                    Prefetch(
                        "player__contracts",
                        queryset=PlayerContract.objects.select_related("team").order_by(
                            "-is_active", "-year_signed", "-created_at"
                        ),
                    ),
                    Prefetch(
                        "player__transactions",
                        queryset=PlayerTransaction.objects.select_related(
                            "from_team", "to_team"
                        ).order_by("-date", "-created_at"),
                    ),
                )
            )
            entries = base_tracker_qs.filter(team=team).order_by("player_name")
            incoming_entries = (
                base_tracker_qs.filter(signed_with_team=team)
                .exclude(team=team)
                .order_by("player_name")
            )
            entries_list = list(entries)
            incoming_entries_list = list(incoming_entries)

            data = TeamFreeAgentTrackerEntrySerializer(entries_list, many=True).data
            incoming_data = TeamFreeAgentTrackerEntrySerializer(
                incoming_entries_list, many=True
            ).data
            tracker_player_ids = {
                entry.player_id
                for entry in entries_list + incoming_entries_list
                if entry.player_id
            }
        except (ProgrammingError, OperationalError) as exc:
            if _is_missing_relation_error(exc):
                logger.warning(
                    "Free-agent tracker table unavailable; returning empty payload for %s season %s: %s",
                    team.abbreviation,
                    season_year,
                    exc,
                )
                data = []
                incoming_data = []
            else:
                raise

        cuts_qs = (
            PlayerTransaction.objects.filter(
                from_team=team,
                date__year=season_year,
                transaction_type__in=["released", "waived", "waived_injured"],
            )
            .select_related("player", "from_team", "to_team")
            .prefetch_related("from_team__logos", "to_team__logos")
            .order_by("-date", "player__display_name")
        )
        seen_cut_players: set[int] = set()
        cuts = []
        for txn in cuts_qs:
            if txn.player_id and txn.player_id in seen_cut_players:
                continue
            if txn.player_id:
                seen_cut_players.add(txn.player_id)
            cuts.append(txn)
        cuts_data = TeamFreeAgencyTransactionSerializer(cuts, many=True).data

        signed_elsewhere_player_ids = tracker_player_ids | {
            txn.player_id for txn in cuts if txn.player_id
        }
        signed_elsewhere_qs = (
            PlayerTransaction.objects.filter(
                season=season_year,
                player_id__in=signed_elsewhere_player_ids,
                transaction_type__in=["signed", "signed_ps", "claimed", "traded"],
                to_team__isnull=False,
            )
            .exclude(to_team=team)
            .select_related("player", "from_team", "to_team")
            .prefetch_related("from_team__logos", "to_team__logos")
            .order_by("-date", "player__display_name")
        )
        seen_signed_elsewhere: set[int] = set()
        signed_elsewhere = []
        for txn in signed_elsewhere_qs:
            if not txn.player_id or txn.player_id in seen_signed_elsewhere:
                continue
            seen_signed_elsewhere.add(txn.player_id)
            signed_elsewhere.append(txn)
        signed_elsewhere_data = TeamFreeAgencyTransactionSerializer(
            signed_elsewhere, many=True
        ).data

        unsigned_entries = [
            entry
            for entry in entries_list
            if not entry.signed_with_team_id
            and (entry.fa_type or "").upper().strip() in {"UFA", "RFA", "ERFA"}
        ]
        re_signed_entries = [
            entry for entry in entries_list if entry.signed_with_team_id == team.id
        ]
        draft_outlook = _build_team_draft_outlook(
            team=team,
            season_year=season_year,
            unsigned_entries=unsigned_entries,
            incoming_entries=incoming_entries_list,
            re_signed_entries=re_signed_entries,
            cuts=cuts,
            signed_elsewhere=signed_elsewhere,
        )

        contract_changes = (
            PlayerContract.objects.filter(
                team=team,
                is_active=True,
                year_signed=season_year,
            )
            .exclude(player_id__in=tracker_player_ids)
            .exclude(player__draft_year=season_year)
            .exclude(player__rookie_season=season_year)
            .select_related("player", "team")
            .prefetch_related("team__logos")
            .order_by("-year_signed", "-apy", "player__display_name")
        )
        contract_changes_data = TeamFreeAgencyContractChangeSerializer(
            contract_changes, many=True
        ).data

        return Response(
            {
                "season": season_year,
                "team": TeamMinimalSerializer(team).data,
                "count": len(data),
                "results": data,
                "incoming_count": len(incoming_data),
                "incoming_results": incoming_data,
                "cuts_count": len(cuts_data),
                "cuts": cuts_data,
                "signed_elsewhere_count": len(signed_elsewhere_data),
                "signed_elsewhere": signed_elsewhere_data,
                "contract_changes_count": len(contract_changes_data),
                "contract_changes": contract_changes_data,
                "draft_source_url": draft_outlook.get("source_url"),
                "draft_picks": draft_outlook.get("draft_picks", []),
                "team_needs": draft_outlook.get("team_needs", []),
                "draft_targets_source_url": draft_outlook.get(
                    "draft_targets_source_url"
                ),
                "draft_targets": draft_outlook.get("draft_targets", []),
            }
        )

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

    @action(detail=True, methods=["get"], url_path="season-stats")
    def season_stats(self, request, abbreviation=None):
        """
        GET /teams/{abbr}/season-stats/

        Returns per-season aggregate stats for this team, oldest to newest.
        Joins TeamStanding for W/L records when available.
        """
        team = self.get_object()

        # Aggregate TeamGameStats by season
        agg_qs = (
            TeamGameStats.objects.filter(team=team)
            .values("season_year")
            .annotate(
                games=Count("id"),
                points_for=Coalesce(Sum("points_scored"), 0),
                points_against=Coalesce(Sum("points_allowed"), 0),
                total_yards=Coalesce(Sum("total_yards"), 0),
                pass_yards=Coalesce(Sum("pass_yards"), 0),
                rush_yards=Coalesce(Sum("rush_yards"), 0),
                sacks_made=Coalesce(
                    Sum("sacks_made"), Value(0, output_field=FloatField())
                ),
                turnovers=Coalesce(Sum("turnovers"), 0),
                takeaways=Coalesce(Sum("takeaways"), 0),
                third_down_att=Coalesce(Sum("third_down_attempts"), 0),
                third_down_conv=Coalesce(Sum("third_down_conversions"), 0),
                redzone_att=Coalesce(Sum("redzone_attempts"), 0),
                redzone_scores=Coalesce(Sum("redzone_scores"), 0),
                off_epa_sum=Sum("offensive_epa"),
                def_epa_sum=Sum("defensive_epa"),
            )
            .order_by("season_year")
        )

        standings_map = {s.season_id: s for s in TeamStanding.objects.filter(team=team)}

        result = []
        for row in agg_qs:
            season = row["season_year"]
            standing = standings_map.get(season)
            g = row["games"] or 1
            td_att = row["third_down_att"] or 1
            rz_att = row["redzone_att"] or 1

            result.append(
                {
                    "season": season,
                    "games": row["games"],
                    "wins": standing.wins if standing else None,
                    "losses": standing.losses if standing else None,
                    "ties": standing.ties if standing else None,
                    "pct": round(standing.pct, 3) if standing else None,
                    "points_for": row["points_for"],
                    "points_against": row["points_against"],
                    "point_diff": row["points_for"] - row["points_against"],
                    "ppg": round(row["points_for"] / g, 1),
                    "papg": round(row["points_against"] / g, 1),
                    "total_yds_pg": round(row["total_yards"] / g, 1),
                    "pass_yds_pg": round(row["pass_yards"] / g, 1),
                    "rush_yds_pg": round(row["rush_yards"] / g, 1),
                    "sacks_pg": round(row["sacks_made"] / g, 2),
                    "turnovers": row["turnovers"],
                    "turnovers_pg": round(row["turnovers"] / g, 2),
                    "takeaways": row["takeaways"],
                    "takeaways_pg": round(row["takeaways"] / g, 2),
                    "third_down_pct": round(row["third_down_conv"] / td_att * 100, 1),
                    "redzone_pct": round(row["redzone_scores"] / rz_att * 100, 1),
                    "off_epa_pg": (
                        round(row["off_epa_sum"] / g, 2)
                        if row["off_epa_sum"] is not None
                        else None
                    ),
                    "def_epa_pg": (
                        round(row["def_epa_sum"] / g, 2)
                        if row["def_epa_sum"] is not None
                        else None
                    ),
                    "seed": standing.seed if standing else None,
                    "div_rank": standing.div_rank if standing else None,
                    "sos": (
                        round(standing.sos, 3)
                        if standing and standing.sos is not None
                        else None
                    ),
                }
            )

        return Response(result)

    @action(detail=True, methods=["get"], url_path="game-log")
    def game_log(self, request, abbreviation=None):
        """
        GET /teams/{abbr}/game-log/?season=2024

        Per-game results with box stats for this team.
        Ordered newest-first (most recent season/week at top).
        """
        team = self.get_object()
        season_year = request.query_params.get("season")

        stats_qs = (
            TeamGameStats.objects.filter(team=team)
            .select_related("game", "game__home_team", "game__away_team", "opponent")
            .prefetch_related("opponent__logos")
            .order_by("-season_year", "-week")
        )
        if season_year:
            stats_qs = stats_qs.filter(season_year=int(season_year))

        stats_rows = list(stats_qs)
        opponent_stats_by_game = {
            (opp_stats.game_id, opp_stats.team_id): opp_stats
            for opp_stats in TeamGameStats.objects.filter(
                game_id__in=[gs.game_id for gs in stats_rows]
            )
            .exclude(team=team)
            .only("game_id", "team_id", "pass_yards", "rush_yards")
        }

        result = []
        for gs in stats_rows:
            game = gs.game
            opp = gs.opponent
            opp_stats = opponent_stats_by_game.get((gs.game_id, opp.id))

            # Resolve scores from perspective of this team
            if gs.is_home:
                team_score = game.home_score
                opp_score = game.away_score
            else:
                team_score = game.away_score
                opp_score = game.home_score

            # Win/loss/tie only for completed games (status is 'final' or 'final_ot')
            if game.status in (
                "post",
                "final",
                "final_ot",
                "STATUS_FINAL",
                "completed",
            ):
                if team_score > opp_score:
                    result_str = "W"
                elif team_score < opp_score:
                    result_str = "L"
                else:
                    result_str = "T"
            else:
                result_str = None

            # Resolve opponent logo
            opp_logo = None
            if (
                hasattr(opp, "_prefetched_objects_cache")
                and "logos" in opp._prefetched_objects_cache
            ):
                logos = opp._prefetched_objects_cache["logos"]
            else:
                logos = list(opp.logos.all()[:4])
            logo_map = {logo.logo_type: logo.url for logo in logos}
            opp_logo = (
                logo_map.get("scoreboard")
                or logo_map.get("default")
                or logo_map.get("scoreboard-dark")
                or logo_map.get("dark")
                or (logos[0].url if logos else None)
            )

            result.append(
                {
                    "game_id": game.id,
                    "week": gs.week,
                    "season_year": gs.season_year,
                    "season_type": game.season_type,
                    "game_date": game.game_date,
                    "is_home": gs.is_home,
                    "is_division_game": game.is_division_game,
                    "opponent_abbr": opp.abbreviation,
                    "opponent_display": opp.display_name,
                    "opponent_color": opp.color_primary,
                    "opponent_logo": opp_logo,
                    "game_status": game.status,
                    "team_score": team_score,
                    "opp_score": opp_score,
                    "result": result_str,
                    # Box stats
                    "total_yards": gs.total_yards,
                    "pass_yards": gs.pass_yards,
                    "rush_yards": gs.rush_yards,
                    "pass_yards_allowed": (
                        opp_stats.pass_yards if opp_stats is not None else None
                    ),
                    "rush_yards_allowed": (
                        opp_stats.rush_yards if opp_stats is not None else None
                    ),
                    "sacks_made": gs.sacks_made,
                    "turnovers": gs.turnovers,
                    "takeaways": gs.takeaways,
                    "third_down_conv": gs.third_down_conversions,
                    "third_down_att": gs.third_down_attempts,
                    "redzone_scores": gs.redzone_scores,
                    "redzone_att": gs.redzone_attempts,
                    "off_epa": gs.offensive_epa,
                    "def_epa": gs.defensive_epa,
                    "pass_epa": gs.passing_epa,
                    "rush_epa": gs.rushing_epa,
                    "time_of_possession": gs.time_of_possession,
                }
            )

        return Response(result)

    @action(detail=False, methods=["get"], url_path="dvoa")
    @cached_view("teams", ttl=TTL_SHORT)
    def dvoa_rankings(self, request):
        """
        GET /teams/dvoa/?season=2025&season_type=REG

        Returns league-wide team DVOA snapshots for a season/season_type.
        If season is omitted, uses latest available for the season_type.
        """
        season_type = (request.query_params.get("season_type") or "REG").upper()
        if season_type not in {"REG", "POST"}:
            return Response(
                {"error": "Invalid season_type. Use 'REG' or 'POST'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        season_raw = request.query_params.get("season")
        base_qs = TeamDvoaRating.objects.filter(season_type=season_type)

        if season_raw:
            try:
                season = int(season_raw)
            except (TypeError, ValueError):
                return Response(
                    {"error": "Invalid season."}, status=status.HTTP_400_BAD_REQUEST
                )
        else:
            season = base_qs.aggregate(max_season=Max("season")).get("max_season")
            if season is None:
                raise NotFound("No DVOA data available.")

        rows = list(
            base_qs.filter(season=season)
            .select_related("team")
            .prefetch_related("team__logos")
            .order_by("total_dvoa_rank", "team__abbreviation")
        )
        if not rows:
            raise NotFound(
                f"No DVOA snapshots found for season {season} ({season_type})."
            )

        payload = TeamDvoaRatingSerializer(rows, many=True).data
        return Response(
            {
                "season": season,
                "season_type": season_type,
                "count": len(payload),
                "results": payload,
            }
        )

    @action(detail=True, methods=["get"], url_path="dvoa")
    @cached_view("teams", ttl=TTL_SHORT)
    def dvoa(self, request, abbreviation=None):
        """
        GET /teams/{abbr}/dvoa/?season_type=REG

        Returns DVOA history and latest snapshots for the requested team.
        By default includes both REG and POST buckets.
        """
        team = self.get_object()
        season_type_filter = request.query_params.get("season_type")
        if season_type_filter:
            season_type_filter = season_type_filter.upper()
            if season_type_filter not in {"REG", "POST"}:
                return Response(
                    {"error": "Invalid season_type. Use 'REG' or 'POST'."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        qs = (
            TeamDvoaRating.objects.filter(team=team)
            .select_related("team")
            .prefetch_related("team__logos")
            .order_by("season", "week")
        )
        if season_type_filter:
            qs = qs.filter(season_type=season_type_filter)

        rows = list(qs)
        if not rows:
            raise NotFound(f"No DVOA snapshots found for team '{team.abbreviation}'.")

        grouped = {"REG": [], "POST": []}
        for row in rows:
            grouped.setdefault(row.season_type, []).append(row)

        serializer = TeamDvoaRatingSerializer
        reg_history = grouped.get("REG", [])
        post_history = grouped.get("POST", [])
        reg_latest = reg_history[-1] if reg_history else None
        post_latest = post_history[-1] if post_history else None

        return Response(
            {
                "team": TeamMinimalSerializer(team).data,
                "latest": {
                    "REG": serializer(reg_latest).data if reg_latest else None,
                    "POST": serializer(post_latest).data if post_latest else None,
                },
                "history": {
                    "REG": serializer(reg_history, many=True).data,
                    "POST": serializer(post_history, many=True).data,
                },
            }
        )

    @action(detail=True, methods=["get"], url_path="rbsdm")
    @cached_view("teams", ttl=TTL_SHORT)
    def rbsdm(self, request, abbreviation=None):
        """
        GET /teams/{abbr}/rbsdm/?season=2025

        Returns RBSDM metrics grouped by dataset for a single team/season.
        """
        team = self.get_object()
        season_raw = request.query_params.get("season")
        requested_season = None

        def _empty_response(season_value):
            return Response(
                {
                    "season": season_value,
                    "team": TeamMinimalSerializer(team).data,
                    "count": 0,
                    "datasets": {},
                    "latest": {},
                }
            )

        qs = TeamRbsdmMetric.objects.filter(team=team)
        if season_raw:
            try:
                season = int(season_raw)
                requested_season = season
            except (TypeError, ValueError):
                return Response(
                    {"error": "Invalid season."}, status=status.HTTP_400_BAD_REQUEST
                )
        else:
            try:
                season = qs.aggregate(max_season=Max("season")).get("max_season")
            except (ProgrammingError, OperationalError) as exc:
                if _is_missing_relation_error(exc):
                    logger.warning(
                        "RBSDM team table unavailable; returning empty payload for %s: %s",
                        team.abbreviation,
                        exc,
                    )
                    return _empty_response(requested_season)
                raise

        if season is None:
            return _empty_response(None)

        try:
            rows = list(qs.filter(season=season).order_by("dataset", "week"))
        except (ProgrammingError, OperationalError) as exc:
            if _is_missing_relation_error(exc):
                logger.warning(
                    "RBSDM team table unavailable; returning empty payload for %s season %s: %s",
                    team.abbreviation,
                    season,
                    exc,
                )
                return _empty_response(season)
            raise

        payload = TeamRbsdmMetricSerializer(rows, many=True).data

        datasets = defaultdict(list)
        for row in payload:
            datasets[row["dataset"]].append(row)

        latest = {
            dataset: items[-1] if items else None for dataset, items in datasets.items()
        }

        return Response(
            {
                "season": season,
                "team": TeamMinimalSerializer(team).data,
                "count": len(payload),
                "datasets": dict(datasets),
                "latest": latest,
            }
        )

    @action(detail=False, methods=["get"], url_path="rankings")
    def rankings(self, request):
        """
        GET /teams/rankings/?season=2024&abbr=SEA

        Returns league/conference/division rank for each major stat category
        for the requested team. All 32 teams' season aggregates are computed
        to derive relative rankings.
        """
        season_raw = request.query_params.get("season")
        abbr_raw = request.query_params.get("abbr")

        if not season_raw or not abbr_raw:
            return Response(
                {"error": "Both 'season' and 'abbr' query params are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            season_year = int(season_raw)
        except (ValueError, TypeError):
            return Response(
                {"error": "Invalid season."}, status=status.HTTP_400_BAD_REQUEST
            )

        abbr = TEAM_ABBR_NORMALIZE.get(abbr_raw.upper(), abbr_raw.upper())

        # Aggregate all teams for this season
        agg_qs = list(
            TeamGameStats.objects.filter(season_year=season_year)
            .values("team__abbreviation", "team__conference", "team__division")
            .annotate(
                games=Count("id"),
                pts_for=Coalesce(Sum("points_scored"), 0),
                pts_against=Coalesce(Sum("points_allowed"), 0),
                ttl_yds=Coalesce(Sum("total_yards"), 0),
                pass_yds=Coalesce(Sum("pass_yards"), 0),
                rush_yds=Coalesce(Sum("rush_yards"), 0),
                sacks_sum=Coalesce(
                    Sum("sacks_made"), Value(0, output_field=FloatField())
                ),
                takeaways_sum=Coalesce(Sum("takeaways"), 0),
                turnovers_sum=Coalesce(Sum("turnovers"), 0),
                td_att=Coalesce(Sum("third_down_attempts"), 0),
                td_conv=Coalesce(Sum("third_down_conversions"), 0),
                rz_att=Coalesce(Sum("redzone_attempts"), 0),
                rz_scores=Coalesce(Sum("redzone_scores"), 0),
                off_epa_sum=Sum("offensive_epa"),
                def_epa_sum=Sum("defensive_epa"),
                top_sec_sum=Coalesce(Sum("time_of_possession_seconds"), 0),
            )
        )

        if not agg_qs:
            raise NotFound(f"No team stats found for season {season_year}.")

        dvoa_rows = (
            TeamDvoaRating.objects.filter(season=season_year, season_type="REG")
            .values(
                "team__abbreviation",
                "week",
                "total_dvoa",
                "offense_dvoa",
                "defense_dvoa",
                "special_teams_dvoa",
                "weighted_total_dvoa",
            )
            .order_by("team__abbreviation", "-week")
        )
        dvoa_map = {}
        for row in dvoa_rows:
            abbr_key = row["team__abbreviation"]
            if abbr_key and abbr_key not in dvoa_map:
                dvoa_map[abbr_key] = row

        # Compute per-game rates in Python
        teams = []
        for row in agg_qs:
            g = row["games"] or 1
            td_att = row["td_att"] or 1
            rz_att = row["rz_att"] or 1
            dvoa = dvoa_map.get(row["team__abbreviation"], {})
            teams.append(
                {
                    "abbr": row["team__abbreviation"],
                    "conference": row["team__conference"],
                    "division": row["team__division"],
                    "ppg": row["pts_for"] / g,
                    "papg": row["pts_against"] / g,
                    "total_yds_pg": row["ttl_yds"] / g,
                    "pass_yds_pg": row["pass_yds"] / g,
                    "rush_yds_pg": row["rush_yds"] / g,
                    "sacks_pg": row["sacks_sum"] / g,
                    "takeaways_pg": row["takeaways_sum"] / g,
                    "turnovers_pg": row["turnovers_sum"] / g,
                    "third_down_pct": row["td_conv"] / td_att * 100,
                    "redzone_pct": row["rz_scores"] / rz_att * 100,
                    "off_epa_pg": (
                        (row["off_epa_sum"] / g)
                        if row["off_epa_sum"] is not None
                        else None
                    ),
                    "def_epa_pg": (
                        (row["def_epa_sum"] / g)
                        if row["def_epa_sum"] is not None
                        else None
                    ),
                    "dvoa_total": dvoa.get("total_dvoa"),
                    "dvoa_offense": dvoa.get("offense_dvoa"),
                    "dvoa_defense": dvoa.get("defense_dvoa"),
                    "dvoa_special_teams": dvoa.get("special_teams_dvoa"),
                    "dvoa_weighted": dvoa.get("weighted_total_dvoa"),
                    "top_pg": row["top_sec_sum"] / g,
                    "turnover_margin_pg": (row["takeaways_sum"] - row["turnovers_sum"])
                    / g,
                }
            )

        target = next((t for t in teams if t["abbr"] == abbr), None)
        if not target:
            raise NotFound(f"No stats for team '{abbr}' in season {season_year}.")

        conf = target["conference"]
        div = target["division"]

        # (stat_key, higher_is_better, label)
        stat_configs = [
            ("ppg", True, "Points Per Game"),
            ("papg", False, "Points Allowed Per Game"),
            ("total_yds_pg", True, "Total Yards Per Game"),
            ("pass_yds_pg", True, "Pass Yards Per Game"),
            ("rush_yds_pg", True, "Rush Yards Per Game"),
            ("sacks_pg", True, "Sacks Per Game"),
            ("takeaways_pg", True, "Takeaways Per Game"),
            ("turnovers_pg", False, "Turnovers Per Game"),
            ("third_down_pct", True, "3rd Down Conv %"),
            ("redzone_pct", True, "Red Zone TD %"),
            ("off_epa_pg", True, "Offensive EPA/G"),
            ("def_epa_pg", False, "Defensive EPA/G"),
            ("dvoa_total", True, "Total DVOA"),
            ("dvoa_offense", True, "Offensive DVOA"),
            ("dvoa_defense", False, "Defensive DVOA"),
            ("dvoa_special_teams", True, "Special Teams DVOA"),
            ("dvoa_weighted", True, "Weighted DVOA"),
            ("top_pg", True, "Time of Poss/G"),
            ("turnover_margin_pg", True, "Turnover Margin/G"),
        ]

        result = {}
        for stat_key, higher_is_better, label in stat_configs:
            valid = [t for t in teams if t[stat_key] is not None]
            sorted_all = sorted(
                valid, key=lambda t: t[stat_key], reverse=higher_is_better
            )
            conf_teams = [t for t in sorted_all if t["conference"] == conf]
            div_teams = [t for t in sorted_all if t["division"] == div]

            def _rank(lst):
                idx = next((i for i, t in enumerate(lst) if t["abbr"] == abbr), None)
                return (idx + 1) if idx is not None else None

            result[stat_key] = {
                "label": label,
                "value": (
                    round(target[stat_key], 2) if target[stat_key] is not None else None
                ),
                "league_rank": _rank(sorted_all),
                "league_total": len(sorted_all),
                "conf_rank": _rank(conf_teams),
                "conf_total": len(conf_teams),
                "conf_name": conf,
                "div_rank": _rank(div_teams),
                "div_total": len(div_teams),
                "div_name": div,
                "higher_is_better": higher_is_better,
            }

        return Response(result)


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
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    ordering_fields = [
        "last_name",
        "first_name",
        "display_name",
        "current_team__abbreviation",
        "position",
        "birth_date",
        "roster_status",
        "draft_year",
        "draft_overall",
        "games_played",
        "seasons_count",
        "last_season_played",
        "first_season_played",
        "games_started",
        "offensive_snaps",
        "snap_pct",
        "career_completions",
        "career_pass_attempts",
        "career_completion_pct",
        "career_passing_yards",
        "career_pass_yards_per_game",
        "career_pass_yards_per_attempt",
        "career_passing_tds",
        "career_interceptions_thrown",
        "career_passer_rating",
        "career_sacks_taken",
        "career_carries",
        "career_rushing_yards",
        "career_rush_yards_per_game",
        "career_yards_per_carry",
        "career_rushing_tds",
        "career_receptions",
        "career_targets",
        "career_catch_pct",
        "career_receiving_yards",
        "career_rec_yards_per_game",
        "career_yards_per_reception",
        "career_yards_per_target",
        "career_receiving_tds",
        "career_scrimmage_yards",
        "career_total_touchdowns",
        "career_touchdowns_per_game",
        "career_long_gain",
        "career_first_downs",
        "career_fumbles",
        "career_fumbles_lost",
        "career_tackles_total",
        "career_sacks_made",
        "career_interceptions_caught",
        "career_passes_defended",
        "career_forced_fumbles",
        "career_fg_made",
        "career_fg_attempts",
        "career_punt_attempts",
        "max_contract_apy",
        "max_contract_value",
        "is_active",
    ]

    @staticmethod
    def _raw_table_exists(table_name):
        return _raw_table_exists_cached(table_name)

    @staticmethod
    def _parse_positive_int(value):
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    @staticmethod
    def _parse_bool_value(value):
        if value is None:
            return None
        normalized = str(value).strip().lower()
        if normalized in {"1", "true", "yes", "y"}:
            return True
        if normalized in {"0", "false", "no", "n"}:
            return False
        return None

    @staticmethod
    def _is_default_directory_request(request):
        """
        Default view is the first page with no query filters/sorts/scope overrides.

        We allow optional explicit page/page_size only when they match defaults.
        """
        for key in request.query_params.keys():
            value = str(request.query_params.get(key) or "").strip()
            if key == "page":
                if value and value != "1":
                    return False
                continue
            if key == "page_size":
                if value and value != "25":
                    return False
                continue
            return False
        return True

    def _resolve_current_season_year(self):
        season_max = Season.objects.aggregate(max_year=Max("year")).get("max_year")
        stats_max = PlayerGameStats.objects.aggregate(max_year=Max("season_year")).get(
            "max_year"
        )
        candidates = [year for year in (season_max, stats_max) if isinstance(year, int)]
        if candidates:
            return max(candidates)
        return date.today().year

    def _apply_default_current_scope(self, queryset, request):
        """
        Keep the default directory focused on currently relevant players.

        Scope can be overridden with ?scope=all.
        """
        scope_value = (
            str(request.query_params.get("scope") or "current").strip().lower()
        )
        if scope_value in {"all", "full", "historical"}:
            return queryset

        is_active_value = self._parse_bool_value(request.query_params.get("is_active"))
        if is_active_value is False:
            return queryset

        # Explicit season queries are usually historical drill-downs.
        if request.query_params.get("season"):
            return queryset

        current_season = self._resolve_current_season_year()
        recency_cutoff = max(1999, current_season - 1)
        recent_stats = PlayerGameStats.objects.filter(
            player_id=OuterRef("pk"), season_year__gte=recency_cutoff
        )
        return queryset.filter(
            Q(current_team__isnull=False)
            | Q(draft_year__gte=recency_cutoff)
            | Exists(recent_stats)
        )

    def _build_position_facet_rows(self, queryset):
        # Single query: fetch (position, position_group, depth_chart_position) for
        # every player in the filtered set, then do the facet counting in Python.
        # This replaces 26 individual COUNT queries (~744ms → ~10ms).
        player_positions = list(
            queryset.order_by().values_list(
                "position", "position_group", "depth_chart_position"
            )
        )

        pf = PlayerFilter
        non_tackle_ol = pf.OL_CENTER_CODES | pf.OL_GUARD_CODES

        def matches(token, pos, grp, depth):
            pos = (pos or "").upper()
            grp = (grp or "").upper()
            depth = (depth or "").upper()

            if token == "C":
                return (
                    pos in pf.OL_CENTER_CODES
                    or grp in pf.OL_CENTER_CODES
                    or depth in pf.OL_CENTER_CODES
                )
            if token == "G":
                return (
                    pos in pf.OL_GUARD_CODES
                    or grp in pf.OL_GUARD_CODES
                    or depth in pf.OL_GUARD_CODES
                )
            if token == "T":
                return (
                    pos in pf.OL_TACKLE_CODES
                    or grp in pf.OL_TACKLE_CODES
                    or depth in pf.OL_TACKLE_CODES
                    or pos == "OL"
                    or (grp == "OL" and pos not in non_tackle_ol)
                )

            expanded = pf.POSITION_ALIASES.get(token, {token})
            return pos in expanded or grp in expanded or depth in expanded

        rows = []
        for token in pf.POSITION_FACET_ORDER:
            count = sum(
                1
                for pos, grp, depth in player_positions
                if matches(token, pos, grp, depth)
            )
            if count > 0:
                rows.append({"key": token, "label": token, "count": count})
        return sorted(rows, key=lambda row: (-row["count"], row["label"]))

    def _stats_filter_kwargs(self):
        """
        Optional stats scope for player list aggregates.

        stats_season limits game_stats rollups to a season.
        stats_week further narrows inside that season.
        """
        stats_season = self._parse_positive_int(
            self.request.query_params.get("stats_season")
        )
        stats_week = self._parse_positive_int(
            self.request.query_params.get("stats_week")
        )
        if stats_season is None:
            stats_week = None

        if stats_season is None:
            return {}, None, None

        game_stats_scope = Q(game_stats__season_year=stats_season)
        if stats_week is not None:
            game_stats_scope &= Q(game_stats__week=stats_week)

        return {"filter": game_stats_scope}, stats_season, stats_week

    def _raw_usage_metrics_for_players(
        self, players, *, stats_season=None, stats_week=None
    ):
        """
        Compute starts/offensive snaps/snap% for only the current page of players.
        """
        if not players:
            return {}

        starts_by_gsis = {}
        snaps_by_source = {}
        pct_by_source = {}
        pct_count_by_source = {}

        if self._raw_table_exists("raw.raw_nflverse_depth_charts"):
            gsis_ids = list(
                {
                    str(player.gsis_id).strip()
                    for player in players
                    if getattr(player, "gsis_id", None)
                }
            )
            if gsis_ids:
                where_clauses = ["d.depth_rank = 1", "d.player_id = ANY(%s)"]
                params = [gsis_ids]
                if stats_season is not None:
                    where_clauses.append("d.season = %s")
                    params.append(stats_season)
                if stats_week is not None:
                    where_clauses.append("d.week = %s")
                    params.append(stats_week)
                with connections["nfl"].cursor() as cursor:
                    cursor.execute(
                        f"""
                        SELECT d.player_id, COUNT(DISTINCT (d.season, d.week, d.team))::bigint
                        FROM raw.raw_nflverse_depth_charts d
                        WHERE {' AND '.join(where_clauses)}
                        GROUP BY d.player_id
                        """,
                        params,
                    )
                    starts_by_gsis = {
                        str(player_id): int(count or 0)
                        for player_id, count in cursor.fetchall()
                    }

        if self._raw_table_exists("raw.raw_nflverse_snap_counts"):
            source_ids = list(
                {
                    identifier
                    for player in players
                    for identifier in (
                        str(getattr(player, "pfr_id", "")).strip(),
                        str(getattr(player, "gsis_id", "")).strip(),
                    )
                    if identifier
                }
            )
            if source_ids:
                where_clauses = ["s.player_id = ANY(%s)"]
                params = [source_ids]
                if stats_season is not None:
                    where_clauses.append("s.season = %s")
                    params.append(stats_season)
                if stats_week is not None:
                    where_clauses.append("s.week = %s")
                    params.append(stats_week)
                with connections["nfl"].cursor() as cursor:
                    cursor.execute(
                        f"""
                        SELECT
                            s.player_id,
                            SUM(COALESCE(s.offense_snaps, 0))::bigint AS offensive_snaps,
                            AVG(
                                NULLIF(
                                    substring(
                                        COALESCE(s.payload->>'offense_pct', '')
                                        FROM '([0-9]+(?:\\.[0-9]+)?)'
                                    ),
                                    ''
                                )::double precision
                            ) AS snap_pct,
                            COUNT(
                                NULLIF(
                                    substring(
                                        COALESCE(s.payload->>'offense_pct', '')
                                        FROM '([0-9]+(?:\\.[0-9]+)?)'
                                    ),
                                    ''
                                )
                            )::bigint AS snap_pct_count
                        FROM raw.raw_nflverse_snap_counts s
                        WHERE {' AND '.join(where_clauses)}
                        GROUP BY s.player_id
                        """,
                        params,
                    )
                    for (
                        player_id,
                        offensive_snaps,
                        snap_pct,
                        snap_pct_count,
                    ) in cursor.fetchall():
                        key = str(player_id)
                        snaps_by_source[key] = int(offensive_snaps or 0)
                        pct_by_source[key] = (
                            float(snap_pct) if snap_pct is not None else None
                        )
                        pct_count_by_source[key] = int(snap_pct_count or 0)

        metrics_by_player_id = {}
        for player in players:
            gsis_id = str(getattr(player, "gsis_id", "")).strip()
            pfr_id = str(getattr(player, "pfr_id", "")).strip()
            source_keys = [key for key in {gsis_id, pfr_id} if key]

            offensive_snaps = sum(
                snaps_by_source.get(source, 0) for source in source_keys
            )

            pct_total = 0.0
            pct_weight = 0
            for source in source_keys:
                pct_value = pct_by_source.get(source)
                pct_count = pct_count_by_source.get(source, 0)
                if pct_value is None or pct_count <= 0:
                    continue
                pct_total += pct_value * pct_count
                pct_weight += pct_count
            snap_pct = (pct_total / pct_weight) if pct_weight > 0 else None

            metrics_by_player_id[str(player.id)] = {
                "games_started": starts_by_gsis.get(gsis_id, 0),
                "offensive_snaps": offensive_snaps,
                "snap_pct": snap_pct,
            }

        return metrics_by_player_id

    def _merge_page_usage_metrics(
        self, serialized_rows, page_players, *, stats_season=None, stats_week=None
    ):
        if not serialized_rows or not page_players:
            return
        metrics_by_player_id = self._raw_usage_metrics_for_players(
            page_players, stats_season=stats_season, stats_week=stats_week
        )
        if not metrics_by_player_id:
            return
        for row in serialized_rows:
            player_id = str(row.get("id"))
            metrics = metrics_by_player_id.get(player_id)
            if not metrics:
                continue
            row["games_started"] = metrics["games_started"]
            row["offensive_snaps"] = metrics["offensive_snaps"]
            row["snap_pct"] = metrics["snap_pct"]

    def _get_player_for_detail_action(self, pk):
        player = (
            Player.objects.using("nfl")
            .select_related("current_team", "draft_team")
            .filter(pk=pk)
            .first()
        )
        if not player:
            raise NotFound("No Player matches the given query.")
        return player

    def get_queryset(self):
        base_queryset = Player.objects.select_related("current_team")
        if self.action == "retrieve":
            base_queryset = base_queryset.select_related("draft_team").prefetch_related(
                "current_team__logos",
                "draft_team__logos",
                "contracts__team",
                "combine_results",
                "college_history",
                "social_accounts",
                "awards",
            )
        games_started_expr = Value(0, output_field=IntegerField())
        offensive_snaps_expr = Value(0, output_field=IntegerField())
        snap_pct_expr = Value(None, output_field=FloatField())
        stats_filter_kwargs, _, _ = self._stats_filter_kwargs()
        requested_ordering = str(self.request.query_params.get("ordering") or "")
        requested_ordering_fields = {
            token.strip().lstrip("-")
            for token in requested_ordering.split(",")
            if token and token.strip()
        }
        include_contract_rollup = bool(
            {"max_contract_apy", "max_contract_value"} & requested_ordering_fields
        )

        contract_rollup = None
        if include_contract_rollup:
            contract_rollup = (
                PlayerContract.objects.filter(player_id=OuterRef("pk"))
                .order_by()
                .values("player_id")
                .annotate(max_total=Max("total_value"), max_apy=Max("apy"))
            )

        use_materialized = not stats_filter_kwargs and self.action != "retrieve"

        contract_annotations = (
            {
                "max_contract_value": Coalesce(
                    Subquery(contract_rollup.values("max_total")[:1]), Value(0)
                ),
                "max_contract_apy": Coalesce(
                    Subquery(contract_rollup.values("max_apy")[:1]), Value(0)
                ),
            }
            if include_contract_rollup and contract_rollup is not None
            else {}
        )

        placeholder_name_expr = Case(
            When(display_name__istartswith="Player ", then=Value(1)),
            default=Value(0),
            output_field=IntegerField(),
        )

        if use_materialized:
            # Fast path: read pre-aggregated career stats from the Player row itself.
            # No JOIN to gridstream_playergamestats — drops query from ~2s to ~35ms.
            first_annotate = dict(
                games_played=F("mat_games_played"),
                seasons_count=F("mat_seasons_count"),
                first_season_played=F("mat_first_season"),
                last_season_played=F("mat_last_season"),
                **contract_annotations,
                games_started=games_started_expr,
                offensive_snaps=offensive_snaps_expr,
                snap_pct=snap_pct_expr,
                career_completions=F("mat_completions"),
                career_pass_attempts=F("mat_pass_attempts"),
                career_passing_yards=F("mat_passing_yards"),
                career_passing_tds=F("mat_passing_tds"),
                career_interceptions_thrown=F("mat_interceptions_thrown"),
                career_sacks_taken=F("mat_sacks_taken"),
                career_carries=F("mat_carries"),
                career_rushing_yards=F("mat_rushing_yards"),
                career_rushing_tds=F("mat_rushing_tds"),
                career_rushing_long=F("mat_rushing_long"),
                career_receptions=F("mat_receptions"),
                career_targets=F("mat_targets"),
                career_receiving_yards=F("mat_receiving_yards"),
                career_receiving_tds=F("mat_receiving_tds"),
                career_receiving_long=F("mat_receiving_long"),
                career_pass_first_downs=F("mat_pass_first_downs"),
                career_rush_first_downs=F("mat_rush_first_downs"),
                career_rec_first_downs=F("mat_rec_first_downs"),
                career_fumbles_rushing=F("mat_fumbles_rushing"),
                career_fumbles_receiving=F("mat_fumbles_receiving"),
                career_fumbles_sacks=F("mat_fumbles_sacks"),
                career_fumbles_lost_rushing=F("mat_fumbles_lost_rushing"),
                career_fumbles_lost_receiving=F("mat_fumbles_lost_receiving"),
                career_fumbles_lost_sacks=F("mat_fumbles_lost_sacks"),
                career_tackles_total=F("mat_tackles_total"),
                career_sacks_made=F("mat_sacks_made"),
                career_interceptions_caught=F("mat_interceptions_caught"),
                career_passes_defended=F("mat_passes_defended"),
                career_forced_fumbles=F("mat_forced_fumbles"),
                career_fg_made=F("mat_fg_made"),
                career_fg_attempts=F("mat_fg_attempts"),
                career_punt_attempts=F("mat_punt_attempts"),
                is_placeholder_name=placeholder_name_expr,
            )
        else:
            # Slow path: compute career stats dynamically for the requested season scope.
            first_annotate = dict(
                games_played=Count("game_stats", distinct=True, **stats_filter_kwargs),
                seasons_count=Count(
                    "game_stats__season_year", distinct=True, **stats_filter_kwargs
                ),
                first_season_played=Min(
                    "game_stats__season_year", **stats_filter_kwargs
                ),
                last_season_played=Max(
                    "game_stats__season_year", **stats_filter_kwargs
                ),
                **contract_annotations,
                games_started=games_started_expr,
                offensive_snaps=offensive_snaps_expr,
                snap_pct=snap_pct_expr,
                career_completions=Coalesce(
                    Sum("game_stats__completions", **stats_filter_kwargs), Value(0)
                ),
                career_pass_attempts=Coalesce(
                    Sum("game_stats__pass_attempts", **stats_filter_kwargs), Value(0)
                ),
                career_passing_yards=Coalesce(
                    Sum("game_stats__passing_yards", **stats_filter_kwargs), Value(0)
                ),
                career_passing_tds=Coalesce(
                    Sum("game_stats__passing_tds", **stats_filter_kwargs), Value(0)
                ),
                career_interceptions_thrown=Coalesce(
                    Sum("game_stats__interceptions_thrown", **stats_filter_kwargs),
                    Value(0),
                ),
                career_sacks_taken=Coalesce(
                    Sum("game_stats__sacks_taken", **stats_filter_kwargs), Value(0)
                ),
                career_carries=Coalesce(
                    Sum("game_stats__carries", **stats_filter_kwargs), Value(0)
                ),
                career_rushing_yards=Coalesce(
                    Sum("game_stats__rushing_yards", **stats_filter_kwargs), Value(0)
                ),
                career_rushing_tds=Coalesce(
                    Sum("game_stats__rushing_tds", **stats_filter_kwargs), Value(0)
                ),
                career_rushing_long=Coalesce(
                    Max("game_stats__rushing_long", **stats_filter_kwargs), Value(0)
                ),
                career_receptions=Coalesce(
                    Sum("game_stats__receptions", **stats_filter_kwargs), Value(0)
                ),
                career_targets=Coalesce(
                    Sum("game_stats__targets", **stats_filter_kwargs), Value(0)
                ),
                career_receiving_yards=Coalesce(
                    Sum("game_stats__receiving_yards", **stats_filter_kwargs), Value(0)
                ),
                career_receiving_tds=Coalesce(
                    Sum("game_stats__receiving_tds", **stats_filter_kwargs), Value(0)
                ),
                career_receiving_long=Coalesce(
                    Max("game_stats__receiving_long", **stats_filter_kwargs), Value(0)
                ),
                career_pass_first_downs=Coalesce(
                    Sum("game_stats__passing_first_downs", **stats_filter_kwargs),
                    Value(0),
                ),
                career_rush_first_downs=Coalesce(
                    Sum("game_stats__rushing_first_downs", **stats_filter_kwargs),
                    Value(0),
                ),
                career_rec_first_downs=Coalesce(
                    Sum("game_stats__receiving_first_downs", **stats_filter_kwargs),
                    Value(0),
                ),
                career_fumbles_rushing=Coalesce(
                    Sum("game_stats__rushing_fumbles", **stats_filter_kwargs), Value(0)
                ),
                career_fumbles_receiving=Coalesce(
                    Sum("game_stats__receiving_fumbles", **stats_filter_kwargs),
                    Value(0),
                ),
                career_fumbles_sacks=Coalesce(
                    Sum("game_stats__sack_fumbles", **stats_filter_kwargs), Value(0)
                ),
                career_fumbles_lost_rushing=Coalesce(
                    Sum("game_stats__rushing_fumbles_lost", **stats_filter_kwargs),
                    Value(0),
                ),
                career_fumbles_lost_receiving=Coalesce(
                    Sum("game_stats__receiving_fumbles_lost", **stats_filter_kwargs),
                    Value(0),
                ),
                career_fumbles_lost_sacks=Coalesce(
                    Sum("game_stats__sack_fumbles_lost", **stats_filter_kwargs),
                    Value(0),
                ),
                career_tackles_total=Coalesce(
                    Sum("game_stats__tackles_total", **stats_filter_kwargs), Value(0)
                ),
                career_sacks_made=Coalesce(
                    Sum("game_stats__sacks_made", **stats_filter_kwargs), Value(0.0)
                ),
                career_interceptions_caught=Coalesce(
                    Sum("game_stats__interceptions_caught", **stats_filter_kwargs),
                    Value(0),
                ),
                career_passes_defended=Coalesce(
                    Sum("game_stats__passes_defended", **stats_filter_kwargs), Value(0)
                ),
                career_forced_fumbles=Coalesce(
                    Sum("game_stats__forced_fumbles", **stats_filter_kwargs), Value(0)
                ),
                career_fg_made=Coalesce(
                    Sum("game_stats__fg_made", **stats_filter_kwargs), Value(0)
                ),
                career_fg_attempts=Coalesce(
                    Sum("game_stats__fg_attempts", **stats_filter_kwargs), Value(0)
                ),
                career_punt_attempts=Coalesce(
                    Sum("game_stats__punt_attempts", **stats_filter_kwargs), Value(0)
                ),
                is_placeholder_name=placeholder_name_expr,
            )

        return (
            base_queryset.annotate(**first_annotate)
            .annotate(
                career_completion_pct=Case(
                    When(
                        career_pass_attempts__gt=0,
                        then=ExpressionWrapper(
                            F("career_completions") * 100.0 / F("career_pass_attempts"),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                career_pass_yards_per_game=Case(
                    When(
                        games_played__gt=0,
                        then=ExpressionWrapper(
                            F("career_passing_yards") * 1.0 / F("games_played"),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                career_pass_yards_per_attempt=Case(
                    When(
                        career_pass_attempts__gt=0,
                        then=ExpressionWrapper(
                            F("career_passing_yards") * 1.0 / F("career_pass_attempts"),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                # Compute NFL passer rating from aggregate passing components.
                # Raw per-game passer_rating is not consistently populated.
                career_passer_rating=Case(
                    When(
                        career_pass_attempts__gt=0,
                        then=ExpressionWrapper(
                            (
                                Least(
                                    Value(2.375),
                                    Greatest(
                                        Value(0.0),
                                        ExpressionWrapper(
                                            (
                                                (
                                                    F("career_completions")
                                                    * 1.0
                                                    / F("career_pass_attempts")
                                                )
                                                - Value(0.3)
                                            )
                                            * Value(5.0),
                                            output_field=FloatField(),
                                        ),
                                    ),
                                )
                                + Least(
                                    Value(2.375),
                                    Greatest(
                                        Value(0.0),
                                        ExpressionWrapper(
                                            (
                                                (
                                                    F("career_passing_yards")
                                                    * 1.0
                                                    / F("career_pass_attempts")
                                                )
                                                - Value(3.0)
                                            )
                                            * Value(0.25),
                                            output_field=FloatField(),
                                        ),
                                    ),
                                )
                                + Least(
                                    Value(2.375),
                                    Greatest(
                                        Value(0.0),
                                        ExpressionWrapper(
                                            (
                                                F("career_passing_tds")
                                                * 1.0
                                                / F("career_pass_attempts")
                                            )
                                            * Value(20.0),
                                            output_field=FloatField(),
                                        ),
                                    ),
                                )
                                + Least(
                                    Value(2.375),
                                    Greatest(
                                        Value(0.0),
                                        ExpressionWrapper(
                                            Value(2.375)
                                            - (
                                                (
                                                    F("career_interceptions_thrown")
                                                    * 1.0
                                                    / F("career_pass_attempts")
                                                )
                                                * Value(25.0)
                                            ),
                                            output_field=FloatField(),
                                        ),
                                    ),
                                )
                            )
                            * Value(100.0)
                            / Value(6.0),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                career_rush_yards_per_game=Case(
                    When(
                        games_played__gt=0,
                        then=ExpressionWrapper(
                            F("career_rushing_yards") * 1.0 / F("games_played"),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                career_yards_per_carry=Case(
                    When(
                        career_carries__gt=0,
                        then=ExpressionWrapper(
                            F("career_rushing_yards") * 1.0 / F("career_carries"),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                career_catch_pct=Case(
                    When(
                        career_targets__gt=0,
                        then=ExpressionWrapper(
                            F("career_receptions") * 100.0 / F("career_targets"),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                career_rec_yards_per_game=Case(
                    When(
                        games_played__gt=0,
                        then=ExpressionWrapper(
                            F("career_receiving_yards") * 1.0 / F("games_played"),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                career_yards_per_reception=Case(
                    When(
                        career_receptions__gt=0,
                        then=ExpressionWrapper(
                            F("career_receiving_yards") * 1.0 / F("career_receptions"),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                career_yards_per_target=Case(
                    When(
                        career_targets__gt=0,
                        then=ExpressionWrapper(
                            F("career_receiving_yards") * 1.0 / F("career_targets"),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                career_scrimmage_yards=F("career_rushing_yards")
                + F("career_receiving_yards"),
                career_total_touchdowns=F("career_passing_tds")
                + F("career_rushing_tds")
                + F("career_receiving_tds"),
                career_touchdowns_per_game=Case(
                    When(
                        games_played__gt=0,
                        then=ExpressionWrapper(
                            (
                                F("career_passing_tds")
                                + F("career_rushing_tds")
                                + F("career_receiving_tds")
                            )
                            * 1.0
                            / F("games_played"),
                            output_field=FloatField(),
                        ),
                    ),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                career_long_gain=Greatest(
                    F("career_rushing_long"), F("career_receiving_long")
                ),
                career_first_downs=F("career_pass_first_downs")
                + F("career_rush_first_downs")
                + F("career_rec_first_downs"),
                career_fumbles=F("career_fumbles_rushing")
                + F("career_fumbles_receiving")
                + F("career_fumbles_sacks"),
                career_fumbles_lost=F("career_fumbles_lost_rushing")
                + F("career_fumbles_lost_receiving")
                + F("career_fumbles_lost_sacks"),
            )
            .order_by(
                "is_placeholder_name",
                "-is_active",
                "-games_played",
                "draft_overall",
                "last_name",
                "first_name",
            )
        )

    def get_serializer_class(self):
        if self.action == "retrieve":
            return PlayerDetailSerializer
        return PlayerListSerializer

    def _build_list_facets(self, queryset, request):
        """
        Build facet counts across the *filtered queryset* (not paginated page).
        """
        team_rows = []
        for row in (
            queryset.values("current_team__abbreviation")
            .annotate(count=Count("id", distinct=True))
            .order_by("-count", "current_team__abbreviation")
        ):
            team_key = (row.get("current_team__abbreviation") or "FA").upper()
            team_rows.append(
                {
                    "key": team_key,
                    "label": team_key,
                    "count": row.get("count", 0),
                }
            )

        position_rows = self._build_position_facet_rows(queryset)

        draft_rows = []
        for row in (
            queryset.values("draft_year")
            .annotate(count=Count("id", distinct=True))
            .order_by()
        ):
            draft_year = row.get("draft_year")
            if draft_year is None:
                draft_rows.append(
                    {
                        "key": "UNDRAFTED",
                        "label": "Undrafted",
                        "count": row.get("count", 0),
                    }
                )
                continue
            draft_rows.append(
                {
                    "key": str(draft_year),
                    "label": str(draft_year),
                    "count": row.get("count", 0),
                }
            )

        draft_rows.sort(
            key=lambda item: (
                item["key"] == "UNDRAFTED",
                -int(item["key"]) if item["key"] != "UNDRAFTED" else 0,
            )
        )

        season_qs = PlayerGameStats.objects.filter(
            player_id__in=queryset.order_by().values("id")
        )

        season_rows = []
        for row in (
            season_qs.values("season_year")
            .annotate(count=Count("player_id", distinct=True))
            .order_by("-season_year")
        ):
            season = row.get("season_year")
            if season is None:
                continue
            season_rows.append(
                {
                    "key": str(season),
                    "label": str(season),
                    "count": row.get("count", 0),
                }
            )

        # Single query for roster status facets — avoids 7 separate COUNT queries.
        raw_roster = list(
            queryset.order_by().values_list(
                "roster_status", "current_team_id", "is_active"
            )
        )

        def _roster_counts(rows):
            counts = {
                label: 0
                for label in (
                    "Active",
                    "Inactive",
                    "Retired",
                    "Released",
                    "Injured Reserve",
                    "Practice Squad",
                    "Free Agent",
                )
            }
            for status, team_id, is_active in rows:
                if status == "ACT" and team_id is not None and is_active:
                    counts["Active"] += 1
                elif status == "INA":
                    counts["Inactive"] += 1
                elif status == "RET":
                    counts["Retired"] += 1
                elif status == "CUT":
                    counts["Released"] += 1
                elif status == "RES":
                    counts["Injured Reserve"] += 1
                elif status == "PRA":
                    counts["Practice Squad"] += 1
                if team_id is None and is_active:
                    counts["Free Agent"] += 1
            return counts

        roster_counts = _roster_counts(raw_roster)
        roster_rows = []
        for label, count in roster_counts.items():
            if count <= 0:
                continue
            roster_rows.append(
                {
                    "key": label,
                    "label": label,
                    "count": count,
                }
            )

        return {
            "team": team_rows,
            "position": position_rows,
            "draftYear": draft_rows,
            "season": season_rows,
            "rosterStatus": roster_rows,
        }

    def list(self, request, *args, **kwargs):
        default_ck = None
        if self._is_default_directory_request(request):
            default_ck = cache_key("players_directory", identifier="default_active_v2")
            cached_default = cache_get(default_ck)
            if cached_default is not None:
                return Response(cached_default)

        cache_params = {
            key: request.query_params.getlist(key)
            for key in sorted(request.query_params.keys())
        }
        ck = cache_key("players_directory", params=cache_params)
        cached = cache_get(ck)
        if cached is not None:
            return Response(cached)

        queryset = self.get_queryset()
        _, stats_season, stats_week = self._stats_filter_kwargs()
        has_roster_status_filter = bool(
            str(request.query_params.get("roster_status") or "").strip()
        )
        if (
            request.query_params.get("is_active") is None
            and not has_roster_status_filter
        ):
            queryset = queryset.filter(PlayerFilter.active_league_clause())
        queryset = self.filter_queryset(queryset)
        if stats_season is not None:
            stats_player_rows = PlayerGameStats.objects.filter(season_year=stats_season)
            if stats_week is not None:
                stats_player_rows = stats_player_rows.filter(week=stats_week)
            queryset = queryset.filter(pk__in=stats_player_rows.values("player_id"))
        queryset = self._apply_default_current_scope(queryset, request)
        facets = self._build_list_facets(queryset, request)

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            self._merge_page_usage_metrics(
                serializer.data,
                page,
                stats_season=stats_season,
                stats_week=stats_week,
            )
            response = self.get_paginated_response(serializer.data)
            response.data["facets"] = facets
            cache_set(ck, response.data, TTL_SHORT)
            if default_ck is not None:
                cache_set(default_ck, response.data, TTL_MEDIUM)
            return response

        serializer = self.get_serializer(queryset, many=True)
        payload = {
            "count": queryset.count(),
            "next": None,
            "previous": None,
            "results": serializer.data,
            "facets": facets,
        }
        cache_set(ck, payload, TTL_SHORT)
        if default_ck is not None:
            cache_set(default_ck, payload, TTL_MEDIUM)
        return Response(payload)

    @cached_view("players", ttl=TTL_MEDIUM)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=["get"], url_path="gamelog")
    def gamelog(self, request, pk=None):
        """
        GET /players/{id}/gamelog/?season=2024

        Per-game stats for this player, most recent first.
        """
        player = self._get_player_for_detail_action(pk)
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
        player = self._get_player_for_detail_action(pk)
        season = request.query_params.get("season")

        stats_qs = PlayerGameStats.objects.filter(player=player)
        if season:
            stats_qs = stats_qs.filter(season_year=int(season))

        # Build cache key
        ck = cache_key("splits", str(player.pk), {"season": season})
        cached = cache_get(ck)
        if cached:
            return Response(cached)

        # Shared aggregate field set for all splits
        def split_agg(qs):
            return qs.aggregate(
                games=Count("id"),
                # Offense
                pass_yds=Coalesce(Sum("passing_yards"), 0),
                pass_tds=Coalesce(Sum("passing_tds"), 0),
                pass_first_downs=Coalesce(Sum("passing_first_downs"), 0),
                rush_yds=Coalesce(Sum("rushing_yards"), 0),
                rush_tds=Coalesce(Sum("rushing_tds"), 0),
                rush_first_downs=Coalesce(Sum("rushing_first_downs"), 0),
                rec_yds=Coalesce(Sum("receiving_yards"), 0),
                rec_tds=Coalesce(Sum("receiving_tds"), 0),
                rec_first_downs=Coalesce(Sum("receiving_first_downs"), 0),
                fumbles=Coalesce(Sum("rushing_fumbles") + Sum("receiving_fumbles"), 0),
                fumbles_lost=Coalesce(
                    Sum("rushing_fumbles_lost") + Sum("receiving_fumbles_lost"), 0
                ),
                forced_fumbles=Coalesce(Sum("forced_fumbles"), 0),
                ppr=Coalesce(Sum("fantasy_points_ppr"), 0.0),
                # Defense
                def_tackles=Coalesce(Sum("tackles_total"), 0),
                def_sacks=Coalesce(Sum("sacks_made"), 0.0),
                def_qb_hits=Coalesce(Sum("qb_hits"), 0),
                def_pd=Coalesce(Sum("passes_defended"), 0),
                def_ints=Coalesce(Sum("interceptions_caught"), 0),
                def_int_tds=Coalesce(Sum("interception_tds"), 0),
                def_tds=Coalesce(Sum("defensive_tds"), 0),
            )

        # Annotate each row with whether the player was the home team,
        # used for win/loss splits without requiring a subquery.
        wins_base = stats_qs.annotate(
            _is_home=Case(
                When(game__home_team=F("team"), then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            )
        )

        result = {
            "home": split_agg(stats_qs.filter(game__home_team=F("team"))),
            "away": split_agg(stats_qs.exclude(game__home_team=F("team"))),
            "regular": split_agg(stats_qs.filter(season_type="REG")),
            "postseason": split_agg(stats_qs.exclude(season_type="REG")),
            "grass": split_agg(
                stats_qs.filter(game__venue__surface__icontains="grass")
            ),
            "turf": split_agg(
                stats_qs.exclude(game__venue__surface__icontains="grass").exclude(
                    game__venue__surface=""
                )
            ),
            "wins": split_agg(
                wins_base.filter(
                    Q(_is_home=1, game__home_score__gt=F("game__away_score"))
                    | Q(_is_home=0, game__away_score__gt=F("game__home_score"))
                )
            ),
            "losses": split_agg(
                wins_base.filter(
                    Q(_is_home=1, game__home_score__lt=F("game__away_score"))
                    | Q(_is_home=0, game__away_score__lt=F("game__home_score"))
                )
            ),
            "division": split_agg(stats_qs.filter(game__is_division_game=True)),
            "nondivision": split_agg(stats_qs.filter(game__is_division_game=False)),
        }

        cache_set(ck, result, TTL_LONG)
        return Response(result)

    @action(detail=True, methods=["get"], url_path="rbsdm")
    @cached_view("players", ttl=TTL_SHORT)
    def rbsdm(self, request, pk=None):
        """
        GET /players/{id}/rbsdm/?season=2025

        Returns RBSDM weekly QB metrics for the selected player/season.
        Non-QB players typically return an empty result set.
        """
        player = self._get_player_for_detail_action(pk)
        season_raw = request.query_params.get("season")

        def _empty_response(season_value):
            return Response(
                {
                    "season": season_value,
                    "player_id": str(player.id),
                    "player_name": player.display_name,
                    "count": 0,
                    "rows": [],
                    "latest": None,
                }
            )

        display_key = _canonical_name_key(player.display_name)
        short_key = _canonical_name_key(player.short_name)
        initial_last_key = _initial_last_name_key(player.display_name)
        keys = [k for k in {display_key, short_key, initial_last_key} if k]

        qs = PlayerRbsdmQbMetric.objects.filter(
            Q(player=player) | Q(player_key__in=keys)
        )

        if season_raw:
            try:
                season = int(season_raw)
            except (TypeError, ValueError):
                return Response(
                    {"error": "Invalid season."}, status=status.HTTP_400_BAD_REQUEST
                )
        else:
            try:
                season = qs.aggregate(max_season=Max("season")).get("max_season")
            except (ProgrammingError, OperationalError) as exc:
                if _is_missing_relation_error(exc):
                    logger.warning(
                        "RBSDM player table unavailable; returning empty payload for player %s: %s",
                        player.id,
                        exc,
                    )
                    return _empty_response(None)
                raise

        if season is None:
            return _empty_response(None)

        try:
            rows = list(qs.filter(season=season).order_by("week", "player_name"))
        except (ProgrammingError, OperationalError) as exc:
            if _is_missing_relation_error(exc):
                logger.warning(
                    "RBSDM player table unavailable; returning empty payload for player %s season %s: %s",
                    player.id,
                    season,
                    exc,
                )
                return _empty_response(season)
            raise

        if rows:
            linked_rows = [row for row in rows if row.player_id == player.id]
            if linked_rows:
                rows = linked_rows
            elif player.current_team_id:
                current_team_rows = [
                    row for row in rows if row.team_id == player.current_team_id
                ]
                if current_team_rows:
                    rows = current_team_rows

        payload = PlayerRbsdmQbMetricSerializer(rows, many=True).data
        latest = payload[-1] if payload else None

        return Response(
            {
                "season": season,
                "player_id": str(player.id),
                "player_name": player.display_name,
                "count": len(payload),
                "rows": payload,
                "latest": latest,
            }
        )

    @action(detail=False, methods=["get"], url_path="advanced")
    def advanced(self, request):
        """
        GET /players/advanced/?gsis_id={gsis_id}&season={year}&week={week}&game_id={id}

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
          "ngs_receiving": { ...metrics } | null,
          "game_stats": {
            "current": { ...player_game_stats_fields } | null,
            "season_average": { ...player_game_stats_fields } | null,
            "average_label": "2025 AVG (W1-W8)" | "2025 SEASON AVG TO DATE" | "2024 AVG" | null,
            "average_games": 8
          }
        }
        """
        gsis_id = request.query_params.get("gsis_id", "").strip()
        season = request.query_params.get("season")
        week = request.query_params.get("week")
        game_id = request.query_params.get("game_id")

        if not gsis_id:
            return Response(
                {"error": "gsis_id is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        stat_fields = [
            "completions",
            "pass_attempts",
            "passing_yards",
            "passing_tds",
            "interceptions_thrown",
            "sacks_taken",
            "carries",
            "rushing_yards",
            "rushing_tds",
            "targets",
            "receptions",
            "receiving_yards",
            "receiving_tds",
            "fg_made",
            "fg_attempts",
            "pat_made",
            "pat_attempts",
            "fantasy_points_ppr",
            "fantasy_points_half_ppr",
            "fantasy_points_standard",
        ]

        def _serialize_stats_row(row):
            if row is None:
                return None
            return {field: getattr(row, field, None) for field in stat_fields}

        def _serialize_avg_row(agg_dict):
            if not agg_dict:
                return None
            row = {}
            has_value = False
            for field in stat_fields:
                value = agg_dict.get(field)
                row[field] = float(value) if value is not None else None
                if value is not None:
                    has_value = True
            return row if has_value else None

        try:
            player = Player.objects.using("nfl").get(gsis_id=gsis_id)
        except Player.DoesNotExist:
            return Response(
                {
                    "ecr": None,
                    "ngs_passing": None,
                    "ngs_rushing": None,
                    "ngs_receiving": None,
                    "game_stats": {
                        "current": None,
                        "season_average": None,
                        "average_label": None,
                        "average_games": 0,
                    },
                }
            )

        season_int = int(season) if season else None
        week_int = int(week) if week else None
        game_id_int = None
        if game_id not in (None, ""):
            try:
                game_id_int = int(game_id)
            except (TypeError, ValueError):
                return Response(
                    {"error": "game_id must be an integer"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

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
        current_stats = None
        if game_id_int is not None:
            current_stats = (
                PlayerGameStats.objects.using("nfl")
                .select_related("game")
                .filter(player=player, game_id=game_id_int)
                .annotate(
                    season_type_rank=Case(
                        When(season_type="REG", then=Value(0)),
                        When(season_type="POST", then=Value(1)),
                        default=Value(2),
                        output_field=IntegerField(),
                    )
                )
                .order_by("season_type_rank", "-id")
                .first()
            )
        if current_stats is None and season_int and week_int:
            current_stats = (
                PlayerGameStats.objects.using("nfl")
                .select_related("game")
                .filter(player=player, season_year=season_int, week=week_int)
                .annotate(
                    season_type_rank=Case(
                        When(season_type="REG", then=Value(0)),
                        When(season_type="POST", then=Value(1)),
                        default=Value(2),
                        output_field=IntegerField(),
                    )
                )
                .order_by("season_type_rank", "-id")
                .first()
            )

        season_avg_stats = None
        season_avg_label = None
        season_avg_games = 0
        average_season = current_stats.season_year if current_stats else season_int
        average_week = current_stats.week if current_stats else week_int
        if average_season and average_week:
            current_season_type = current_stats.season_type if current_stats else None
            if current_stats is not None and current_season_type == "POST":
                # Postseason context should be true season-to-date:
                # include regular season + any earlier postseason games.
                season_avg_qs = (
                    PlayerGameStats.objects.using("nfl")
                    .filter(player=player, season_year=average_season)
                    .exclude(game_id=current_stats.game_id)
                    .exclude(season_type="PRE")
                )
                current_game_date = current_stats.game.game_date
                current_game_time = current_stats.game.game_time
                if current_game_time is not None:
                    season_avg_qs = season_avg_qs.filter(
                        Q(game__game_date__lt=current_game_date)
                        | Q(
                            game__game_date=current_game_date,
                            game__game_time__lt=current_game_time,
                        )
                    )
                else:
                    season_avg_qs = season_avg_qs.filter(
                        game__game_date__lt=current_game_date
                    )
                season_avg_label = f"{average_season} SEASON AVG TO DATE"
            elif average_week > 1:
                season_avg_qs = PlayerGameStats.objects.using("nfl").filter(
                    player=player, season_year=average_season, week__lt=average_week
                )
                season_avg_label = f"{average_season} AVG (W1-W{average_week - 1})"
            else:
                season_avg_qs = PlayerGameStats.objects.using("nfl").filter(
                    player=player, season_year=average_season - 1
                )
                season_avg_label = f"{average_season - 1} AVG"

            if (
                current_stats is not None
                and current_stats.season_type
                and current_stats.season_type != "POST"
            ):
                season_avg_qs = season_avg_qs.filter(
                    season_type=current_stats.season_type
                )

            season_avg_games = season_avg_qs.count()
            if season_avg_games > 0:
                season_avg_stats = _serialize_avg_row(
                    season_avg_qs.aggregate(
                        **{field: Avg(field) for field in stat_fields}
                    )
                )
                if season_avg_stats is None:
                    season_avg_label = None
            else:
                season_avg_label = None

        return Response(
            {
                "ecr": ecr_data,
                **ngs_result,
                "game_stats": {
                    "current": _serialize_stats_row(current_stats),
                    "season_average": season_avg_stats,
                    "average_label": season_avg_label,
                    "average_games": season_avg_games,
                },
            }
        )


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

    # -----------------------------------------------------------------
    # PERSONNEL — nested under game
    # -----------------------------------------------------------------
    @extend_schema(
        summary="Get game personnel snap usage",
        description=(
            "Returns active player usage by team for a game, sourced from "
            "nflverse snap counts when available and falling back to "
            "PlayerGameStats roster presence."
        ),
        tags=["games", "personnel"],
    )
    @action(detail=True, methods=["get"], url_path="personnel")
    def personnel(self, request, pk=None):
        """
        GET /games/{id}/personnel/

        Shape:
          {
            "source": "snap_counts" | "player_stats_fallback" | "empty",
            "season": 2025,
            "week": 11,
            "away": {...},
            "home": {...}
          }
        """
        game = self.get_object()
        ck = cache_key("personnel", str(game.pk))
        cached = cache_get(ck)
        if cached:
            return Response(cached)

        away_abbr = (game.away_team.abbreviation or "").upper()
        home_abbr = (game.home_team.abbreviation or "").upper()
        tracked_teams = {away_abbr, home_abbr}

        def _canonical_team(abbr):
            normalized = (abbr or "").upper().strip()
            return TEAM_ABBR_NORMALIZE.get(normalized, normalized)

        def _safe_int(value, default=0):
            try:
                return int(value)
            except (TypeError, ValueError):
                return default

        def _safe_pct(value):
            if value in (None, ""):
                return None
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                return None
            if abs(numeric) <= 1:
                numeric *= 100
            return max(0.0, min(100.0, numeric))

        def _name_key(value):
            cleaned = "".join(ch.lower() for ch in str(value or "") if ch.isalnum())
            return cleaned

        def _empty_entry(player_name="", player_id=None):
            return {
                "player_id": player_id,
                "player_name": player_name,
                "display_name": None,
                "headshot_url": None,
                "jersey_number": None,
                "position": None,
                "position_group": None,
                "roster_status": None,
                "depth_chart_position": None,
                "depth_rank": None,
                "depth_chart_status": None,
                "offense_snaps": 0,
                "defense_snaps": 0,
                "special_snaps": 0,
                "total_snaps": 0,
                "offense_snap_pct": None,
                "defense_snap_pct": None,
                "special_snap_pct": None,
                "total_snap_pct": None,
            }

        def _apply_player_metadata(entry, player):
            if not player:
                return
            entry["display_name"] = player.display_name or entry["display_name"]
            entry["headshot_url"] = player.headshot_url or entry["headshot_url"]
            entry["jersey_number"] = player.jersey_number or entry["jersey_number"]
            entry["position"] = player.position or entry["position"]
            entry["position_group"] = player.position_group or entry["position_group"]
            entry["roster_status"] = player.roster_status or entry["roster_status"]
            entry["depth_chart_position"] = (
                player.depth_chart_position or entry["depth_chart_position"]
            )
            entry["depth_rank"] = player.depth_chart_rank or entry["depth_rank"]
            entry["depth_chart_status"] = (
                player.depth_chart_status or entry["depth_chart_status"]
            )
            entry["player_name"] = player.display_name or entry["player_name"]
            if player.gsis_id and not entry["player_id"]:
                entry["player_id"] = player.gsis_id

        team_players = {away_abbr: {}, home_abbr: {}}
        team_name_index = {away_abbr: {}, home_abbr: {}}

        def _ensure_player(team_abbr, key, player_name="", player_id=None):
            roster = team_players[team_abbr]
            entry = roster.get(key)
            if not entry:
                entry = _empty_entry(player_name=player_name, player_id=player_id)
                roster[key] = entry
            if player_name and not entry["player_name"]:
                entry["player_name"] = player_name
            if player_id and not entry["player_id"]:
                entry["player_id"] = player_id
            if entry["player_name"]:
                team_name_index[team_abbr][_name_key(entry["player_name"])] = entry
            return entry

        def _find_player_entry(team_abbr, player_id=None, player_name=""):
            roster = team_players[team_abbr]
            if player_id:
                by_id = roster.get(player_id)
                if by_id:
                    return by_id
            if player_name:
                key = _name_key(player_name)
                return team_name_index[team_abbr].get(key)
            return None

        def _raw_table_exists(table):
            with connections["nfl"].cursor() as cursor:
                cursor.execute("SELECT to_regclass(%s)", [table])
                return cursor.fetchone()[0] is not None

        nflverse_game_id = (game.nflverse_game_id or "").strip()
        snap_rows = []
        if nflverse_game_id and _raw_table_exists("raw.raw_nflverse_snap_counts"):
            with connections["nfl"].cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        team,
                        player_id,
                        player_name,
                        COALESCE(offense_snaps, 0),
                        COALESCE(defense_snaps, 0),
                        COALESCE(special_snaps, 0),
                        COALESCE(payload->>'position', ''),
                        COALESCE(payload->>'offense_pct', ''),
                        COALESCE(payload->>'defense_pct', ''),
                        COALESCE(payload->>'st_pct', '')
                    FROM raw.raw_nflverse_snap_counts
                    WHERE game_id = %s
                    """,
                    [nflverse_game_id],
                )
                snap_rows = cursor.fetchall()

        raw_player_ids = {
            str(row[1]).strip() for row in snap_rows if str(row[1]).strip()
        }
        players_by_id = {}
        players_by_name = {}
        if raw_player_ids:
            players_qs = Player.objects.filter(
                Q(gsis_id__in=raw_player_ids) | Q(pfr_id__in=raw_player_ids)
            ).only(
                "gsis_id",
                "pfr_id",
                "display_name",
                "headshot_url",
                "jersey_number",
                "position",
                "position_group",
                "roster_status",
                "depth_chart_position",
                "depth_chart_rank",
                "depth_chart_status",
            )
            for player in players_qs:
                if player.gsis_id:
                    players_by_id[player.gsis_id] = player
                if player.pfr_id:
                    players_by_id[player.pfr_id] = player
                if player.display_name:
                    players_by_name[_name_key(player.display_name)] = player

        for (
            raw_team,
            raw_player_id,
            raw_player_name,
            offense_snaps,
            defense_snaps,
            special_snaps,
            raw_position,
            raw_offense_pct,
            raw_defense_pct,
            raw_special_pct,
        ) in snap_rows:
            team_abbr = _canonical_team(raw_team)
            if team_abbr not in tracked_teams:
                continue
            player_id = str(raw_player_id or "").strip() or None
            player_name = str(raw_player_name or "").strip()
            key = (
                player_id
                or _name_key(player_name)
                or f"row-{len(team_players[team_abbr])}"
            )
            entry = _ensure_player(
                team_abbr, key, player_name=player_name, player_id=player_id
            )
            entry["offense_snaps"] = _safe_int(offense_snaps, 0)
            entry["defense_snaps"] = _safe_int(defense_snaps, 0)
            entry["special_snaps"] = _safe_int(special_snaps, 0)
            entry["position"] = raw_position or entry["position"]
            entry["offense_snap_pct"] = _safe_pct(raw_offense_pct)
            entry["defense_snap_pct"] = _safe_pct(raw_defense_pct)
            entry["special_snap_pct"] = _safe_pct(raw_special_pct)
            matched_player = players_by_id.get(player_id or "") or players_by_name.get(
                _name_key(player_name)
            )
            _apply_player_metadata(entry, matched_player)

        snap_data_available = len(snap_rows) > 0

        depth_rows = []
        if _raw_table_exists("raw.raw_nflverse_depth_charts"):
            with connections["nfl"].cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        team,
                        player_id,
                        player_name,
                        position,
                        depth_rank,
                        COALESCE(payload->>'depth_position', payload->>'pos_abb', '')
                    FROM raw.raw_nflverse_depth_charts
                    WHERE season = %s
                      AND week = %s
                      AND team = ANY(%s)
                    """,
                    [game.season_id, game.week, [away_abbr, home_abbr]],
                )
                depth_rows = cursor.fetchall()
                if not depth_rows:
                    cursor.execute(
                        """
                        WITH latest AS (
                            SELECT MAX(payload->>'dt') AS dt
                            FROM raw.raw_nflverse_depth_charts
                            WHERE season = %s
                              AND week IS NULL
                              AND team = ANY(%s)
                        )
                        SELECT
                            d.team,
                            d.player_id,
                            d.player_name,
                            d.position,
                            d.depth_rank,
                            COALESCE(d.payload->>'depth_position', d.payload->>'pos_abb', '')
                        FROM raw.raw_nflverse_depth_charts d
                        CROSS JOIN latest
                        WHERE d.season = %s
                          AND d.week IS NULL
                          AND d.team = ANY(%s)
                          AND (latest.dt IS NULL OR COALESCE(d.payload->>'dt', '') = latest.dt)
                        """,
                        [
                            game.season_id,
                            [away_abbr, home_abbr],
                            game.season_id,
                            [away_abbr, home_abbr],
                        ],
                    )
                    depth_rows = cursor.fetchall()

        for (
            raw_team,
            raw_player_id,
            raw_player_name,
            raw_position,
            raw_depth_rank,
            depth_position,
        ) in depth_rows:
            team_abbr = _canonical_team(raw_team)
            if team_abbr not in tracked_teams:
                continue
            player_id = str(raw_player_id or "").strip() or None
            player_name = str(raw_player_name or "").strip()
            entry = _find_player_entry(
                team_abbr, player_id=player_id, player_name=player_name
            )
            if not entry:
                continue
            if depth_position:
                entry["depth_chart_position"] = (
                    entry["depth_chart_position"] or depth_position
                )
            if raw_position:
                entry["position"] = entry["position"] or raw_position
            depth_rank = _safe_int(raw_depth_rank, None)
            if depth_rank is not None:
                entry["depth_rank"] = depth_rank

        # Fallback coverage from canonical PlayerGameStats when snap counts are missing
        stats_qs = (
            PlayerGameStats.objects.filter(game=game)
            .select_related("player", "team")
            .only(
                "player__gsis_id",
                "player__pfr_id",
                "player__display_name",
                "player__headshot_url",
                "player__jersey_number",
                "player__position",
                "player__position_group",
                "player__roster_status",
                "player__depth_chart_position",
                "player__depth_chart_rank",
                "player__depth_chart_status",
                "team__abbreviation",
            )
        )
        for row in stats_qs:
            team_abbr = (row.team.abbreviation or "").upper() if row.team_id else ""
            if team_abbr not in tracked_teams:
                continue
            player = row.player
            player_id = player.gsis_id or player.pfr_id or None
            if snap_data_available:
                existing = _find_player_entry(
                    team_abbr, player_id=player_id, player_name=player.display_name
                )
                if existing:
                    _apply_player_metadata(existing, player)
                continue
            key = (
                player_id
                or _name_key(player.display_name)
                or f"stats-{row.pk}-{len(team_players[team_abbr])}"
            )
            entry = _ensure_player(
                team_abbr,
                key,
                player_name=player.display_name,
                player_id=player_id,
            )
            _apply_player_metadata(entry, player)

        def _team_payload(team_abbr):
            rows = list(team_players[team_abbr].values())
            offense_total = max((r["offense_snaps"] for r in rows), default=0)
            defense_total = max((r["defense_snaps"] for r in rows), default=0)
            special_total = max((r["special_snaps"] for r in rows), default=0)
            total_team_snaps = offense_total + defense_total + special_total

            def _pct(value, total):
                if total <= 0:
                    return None
                return round((value / total) * 100, 1)

            for row in rows:
                row["total_snaps"] = (
                    row["offense_snaps"] + row["defense_snaps"] + row["special_snaps"]
                )
                if row["offense_snap_pct"] is None:
                    row["offense_snap_pct"] = _pct(row["offense_snaps"], offense_total)
                if row["defense_snap_pct"] is None:
                    row["defense_snap_pct"] = _pct(row["defense_snaps"], defense_total)
                if row["special_snap_pct"] is None:
                    row["special_snap_pct"] = _pct(row["special_snaps"], special_total)
                row["total_snap_pct"] = _pct(row["total_snaps"], total_team_snaps)

            rows.sort(
                key=lambda row: (
                    -row["total_snaps"],
                    -row["offense_snaps"],
                    -row["defense_snaps"],
                    -row["special_snaps"],
                    row["player_name"] or "",
                )
            )

            return {
                "team_abbr": team_abbr,
                "total_offense_snaps": offense_total,
                "total_defense_snaps": defense_total,
                "total_special_snaps": special_total,
                "total_snaps": total_team_snaps,
                "players": rows,
            }

        away_payload = _team_payload(away_abbr)
        home_payload = _team_payload(home_abbr)
        has_snap_rows = any(
            row.get("offense_snaps", 0) > 0
            or row.get("defense_snaps", 0) > 0
            or row.get("special_snaps", 0) > 0
            for row in away_payload["players"] + home_payload["players"]
        )
        has_any_players = bool(away_payload["players"] or home_payload["players"])
        source = (
            "snap_counts"
            if has_snap_rows
            else "player_stats_fallback" if has_any_players else "empty"
        )

        result = {
            "source": source,
            "season": game.season_id,
            "week": game.week,
            "away": away_payload,
            "home": home_payload,
        }

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


# =============================================================================
# DRAFT
# =============================================================================

_TTL_DRAFT = 60 * 30  # 30 minutes — boards update infrequently


class DraftViewSet(viewsets.ViewSet):
    """
    Draft prospect big board endpoints.

    GET /draft/big-board/?season=2026
        Returns all ranking sources active for the season, plus a merged list of
        prospects with each source's rank and a computed average rank across
        all sources that have ranked them.  Prospects without a DraftProspect
        record (full NFLDraftBuzz scouting data) are still included — they just
        won't have the detailed fields.
    """

    @action(detail=False, methods=["get"], url_path="big-board")
    def big_board(self, request):
        """GET /draft/big-board/?season= — merged multi-source big board."""
        season = _coerce_int(request.query_params.get("season")) or date.today().year

        cache_key_value = f"gs:draft:big_board:{season}"
        cached = cache_get(cache_key_value)
        if cached is not None:
            return Response(cached)

        # ------------------------------------------------------------------
        # 1. Load all ranking rows for the season
        # ------------------------------------------------------------------
        rankings = list(
            DraftProspectRanking.objects.filter(season=season)
            .select_related("prospect")
            .order_by("source", "rank")
        )

        if not rankings:
            return Response(
                {
                    "season": season,
                    "sources": [],
                    "entries": [],
                }
            )

        # ------------------------------------------------------------------
        # 2. Build source metadata (one entry per distinct source)
        # ------------------------------------------------------------------
        seen_sources: set[str] = set()
        sources: list[dict] = []
        for r in rankings:
            if r.source in seen_sources:
                continue
            seen_sources.add(r.source)
            sources.append(
                {
                    "key": r.source,
                    "label": r.source_label,
                    "analyst": r.source_analyst or None,
                    "outlet": r.source_outlet or None,
                    "url": r.source_url or None,
                    "updated": (
                        r.source_updated.isoformat() if r.source_updated else None
                    ),
                }
            )

        # Sort sources: consensus first, then alphabetical by label
        def _source_sort_key(s):
            return (0 if "consensus" in s["key"] else 1, s["label"].lower())

        sources.sort(key=_source_sort_key)

        # ------------------------------------------------------------------
        # 3. Group rankings by player (name_slug) and compute avg rank
        # ------------------------------------------------------------------
        # name_slug → { ranks per source, prospect obj, name/pos/school }
        player_map: dict[str, dict] = {}

        for r in rankings:
            slug = r.name_slug
            if slug not in player_map:
                player_map[slug] = {
                    "name_slug": slug,
                    "name": r.name,
                    "position": r.position,
                    "school": r.school,
                    "rankings": {},
                    "prospect": r.prospect,
                }
            entry = player_map[slug]
            entry["rankings"][r.source] = r.rank
            # Prefer the entry with a linked prospect
            if r.prospect and not entry["prospect"]:
                entry["prospect"] = r.prospect

        # ------------------------------------------------------------------
        # 4. Compute average rank and NFLDraftBuzz rank; sort by avg
        # ------------------------------------------------------------------
        entries: list[dict] = []
        for entry in player_map.values():
            rank_values = [v for v in entry["rankings"].values() if v is not None]
            avg_rank = (
                round(sum(rank_values) / len(rank_values), 2) if rank_values else None
            )
            buzz_rank = None
            prospect: DraftProspect | None = entry["prospect"]

            prospect_data = None
            if prospect:
                buzz_rank = prospect.overall_rank
                prospect_data = _serialize_draft_prospect_quick(prospect)

            entries.append(
                {
                    "nameSlug": entry["name_slug"],
                    "name": entry["name"],
                    "position": entry["position"],
                    "school": entry["school"],
                    "rankings": entry["rankings"],
                    "avgRank": avg_rank,
                    "buzzRank": buzz_rank,
                    "prospect": prospect_data,
                }
            )

        # Sort: average rank ascending (unranked at the end)
        entries.sort(key=lambda e: (e["avgRank"] is None, e["avgRank"] or 9999))

        payload = {
            "season": season,
            "sources": sources,
            "entries": entries,
        }

        cache_set(cache_key_value, payload, ttl=_TTL_DRAFT)
        return Response(payload)

    @action(detail=False, methods=["get"], url_path="mock-drafts")
    def mock_drafts(self, request):
        """GET /draft/mock-drafts/?season= — all curated mock drafts with full pick lists."""
        season = _coerce_int(request.query_params.get("season")) or date.today().year

        cache_key_value = f"gs:draft:mock_drafts:{season}"
        cached = cache_get(cache_key_value)
        if cached is not None:
            return Response(cached)

        mocks_qs = list(
            DraftMockDraft.objects.filter(season=season).order_by("source_label")
        )

        if not mocks_qs:
            return Response({"season": season, "sources": [], "mocks": []})

        # Build prospect lookup keyed by nflmockdraftdb name_slug for pick enrichment.
        # DraftProspectRanking bridges nflmockdraftdb URL slugs → DraftProspect records;
        # the nfldraftbuzz source_slug format (Name-Position-School) does not match pick URLs.
        prospect_by_slug: dict[str, DraftProspect] = {}
        for ranking in (
            DraftProspectRanking.objects.filter(season=season)
            .select_related("prospect")
            .exclude(prospect=None)
        ):
            if ranking.prospect:
                prospect_by_slug[ranking.name_slug] = ranking.prospect

        def _serialize_pick(pick: dict) -> dict:
            player = pick.get("player") or {}
            team = pick.get("team") or {}
            college = player.get("college") or {}
            player_url = player.get("url") or ""
            player_slug = player_url.rstrip("/").split("/")[-1]
            team_url = team.get("url") or ""
            team_slug = team_url.rstrip("/").split("/")[-1]

            prospect = prospect_by_slug.get(player_slug)
            prospect_data = (
                _serialize_draft_prospect_quick(prospect) if prospect else None
            )

            return {
                "pick": pick.get("pick"),
                "round": pick.get("round") or 1,
                "playerName": player.get("name") or "",
                "playerSlug": player_slug,
                "playerPosition": player.get("position") or "",
                "playerCollege": college.get("name") or "",
                "playerCollegeLogo": college.get("logo") or None,
                "teamSlug": team_slug,
                "teamColor": team.get("color") or None,
                "teamLogo": team.get("logo") or None,
                "traded": pick.get("traded"),
                "blurb": pick.get("blurb"),
                "prospect": prospect_data,
            }

        sources = []
        mocks_out = []
        for mock in mocks_qs:
            picks_out = [_serialize_pick(p) for p in mock.picks]
            sources.append(
                {
                    "key": mock.source_key,
                    "label": mock.source_label,
                    "analyst": mock.source_analyst or None,
                    "outlet": mock.source_outlet or None,
                    "url": mock.source_url or None,
                    "updated": (
                        mock.source_updated.isoformat() if mock.source_updated else None
                    ),
                    "pickCount": len(picks_out),
                }
            )
            mocks_out.append(
                {
                    "key": mock.source_key,
                    "label": mock.source_label,
                    "analyst": mock.source_analyst or None,
                    "outlet": mock.source_outlet or None,
                    "updated": (
                        mock.source_updated.isoformat() if mock.source_updated else None
                    ),
                    "picks": picks_out,
                }
            )

        payload = {"season": season, "sources": sources, "mocks": mocks_out}
        cache_set(cache_key_value, payload, ttl=_TTL_DRAFT)
        return Response(payload)


def _serialize_draft_prospect_quick(prospect: "DraftProspect") -> dict:
    """
    Compact serialization of a DraftProspect for embedding in the big board.
    Matches the DraftProspectQuickView shape used by the front-end drawer.
    """
    return {
        "name": prospect.name,
        "position": prospect.position or None,
        "school": prospect.school or None,
        "imageUrl": prospect.image_url or None,
        "collegeLogoUrl": prospect.college_logo_url or None,
        "draftProjection": prospect.draft_projection or None,
        "buzzOverallRating": prospect.overall_rating,
        "buzzOverallRank": prospect.overall_rank,
        "buzzPositionRank": prospect.position_rank,
        "buzzPositionRankGroup": prospect.position_rank_group or None,
        "allScoutsOverallRank": prospect.all_scouts_overall_rank,
        "allScoutsPositionRank": prospect.all_scouts_position_rank,
        "height": prospect.height or None,
        "weight": prospect.weight,
        "fortyYard": prospect.forty_yard,
        "handSize": prospect.hand_size or None,
        "armLength": prospect.arm_length or None,
        "age": prospect.age,
        "birthDate": prospect.birth_date.isoformat() if prospect.birth_date else None,
        "classYear": prospect.class_year or None,
        "hometown": prospect.hometown or None,
        "role": prospect.role or None,
        "jerseyNumber": prospect.jersey_number or None,
        "sourceUrl": prospect.source_url or None,
        "sourceLastUpdated": (
            prospect.source_last_updated.isoformat()
            if prospect.source_last_updated
            else None
        ),
        "collegeGames": prospect.college_games,
        "collegeSnaps": prospect.college_snaps,
        "bio": prospect.bio or None,
        "summary": prospect.summary or None,
        "strengths": prospect.strengths or None,
        "weaknesses": prospect.weaknesses or None,
        "honors": prospect.honors or None,
        "productionStats": prospect.production_stats or None,
        "scoutingGrades": prospect.scouting_grades or None,
        "measurablePercentiles": prospect.measurable_percentiles or None,
        "recruitingRatings": prospect.recruiting_ratings or None,
        "comparisonPlayers": prospect.comparison_players or None,
        "fitTeams": None,  # not relevant on the standalone big board
        "draftSeason": prospect.season,
    }
