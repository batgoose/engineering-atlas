"""
Sync team depth chart slots from Ourlads into Player depth-chart fields.

Updates Player records (using the `nfl` database alias):
  - depth_chart_position (slot label, e.g. QB, LWR, LOLB)
  - depth_chart_rank (1-5 within the position row)
  - depth_chart_status (free-agent / acquisition status when provided)

Usage:
    python manage.py sync_ourlads_depth_charts
    python manage.py sync_ourlads_depth_charts --team BUF --team ARI
    python manage.py sync_ourlads_depth_charts --dry-run
"""

from __future__ import annotations

import html
import re
import time
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass

import requests
from django.core.management.base import BaseCommand

from gridstream.models import Player, Team

OURLADS_INDEX_URL = "https://www.ourlads.com/nfldepthcharts/"
OURLADS_TEAM_URL = "https://www.ourlads.com/nfldepthcharts/depthchart/{team_code}"

TEAM_CODE_TO_DB_ABBR = {
    "ARZ": "ARI",
    "LAR": "LA",
}
DB_ABBR_TO_TEAM_CODE = {
    "ARI": "ARZ",
    "LA": "LAR",
}

TBODY_IDS = (
    "ctl00_phContent_dcTBody",
    "ctl00_phContent_dcTBody2",
    "ctl00_phContent_dcTBody3",
    "ctl00_phContent_dcTBody4",
)

TEAM_LINK_RE = re.compile(r"href=['\"]depthchart/([A-Z0-9]+)['\"]", re.IGNORECASE)
TBODY_RE = re.compile(
    r"<tbody[^>]*id=['\"](ctl00_phContent_dcTBody\d*)['\"][^>]*>(.*?)</tbody>",
    re.IGNORECASE | re.DOTALL,
)
ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.IGNORECASE | re.DOTALL)
ANCHOR_RE = re.compile(r"<a\b([^>]*)>(.*?)</a>", re.IGNORECASE | re.DOTALL)
HREF_RE = re.compile(r"href=['\"]([^'\"]+)['\"]", re.IGNORECASE)
CLASS_RE = re.compile(r"class=['\"]([^'\"]*)['\"]", re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]+>", re.DOTALL)
MULTI_SPACE_RE = re.compile(r"\s+")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")

PLAYER_STATUS_BY_CLASS = {
    "lc_green": "UFA",
    "lc_black": "RFA",
    "lc_grey": "ERFA",
    "lc_gold": "ACQUIRED_FA_OR_TRADE",
}

STATUS_CODE_MAP = {
    "T": "TRADE",
    "U": "UFA",
    "CC": "CAP_CASUALTY",
    "R": "RFA",
    "ER": "ERFA",
}

POSITION_TOKEN_MAP = {
    "LWR": "WR",
    "RWR": "WR",
    "SWR": "WR",
    "WR": "WR",
    "TE": "TE",
    "QB": "QB",
    "RB": "RB",
    "FB": "FB",
    "LT": "T",
    "RT": "T",
    "LG": "G",
    "RG": "G",
    "C": "C",
    "T": "T",
    "G": "G",
    "OL": "OL",
    "DE": "DE",
    "DT": "DT",
    "NT": "NT",
    "LOLB": "OLB",
    "ROLB": "OLB",
    "OLB": "OLB",
    "MLB": "MLB",
    "ILB": "ILB",
    "WLB": "LB",
    "SLB": "LB",
    "LB": "LB",
    "LCB": "CB",
    "RCB": "CB",
    "CB": "CB",
    "NB": "CB",
    "FS": "FS",
    "SS": "SS",
    "S": "S",
    "PK": "K",
    "KO": "K",
    "PT": "P",
    "P": "P",
    "LS": "LS",
    "H": "P",
    "KR": "WR",
    "PR": "WR",
    "FUT": "",
}

POSITION_METADATA_TOKENS = {
    "QB",
    "RB",
    "FB",
    "WR",
    "TE",
    "LT",
    "OT",
    "LG",
    "OG",
    "C",
    "RG",
    "RT",
    "OL",
    "DE",
    "DT",
    "NT",
    "LOLB",
    "ROLB",
    "OLB",
    "ILB",
    "MLB",
    "WLB",
    "LB",
    "LCB",
    "RCB",
    "CB",
    "NB",
    "FS",
    "SS",
    "S",
    "PK",
    "KO",
    "PT",
    "P",
    "LS",
    "H",
    "KR",
    "PR",
    "FUT",
}

SUFFIX_TOKENS = {"JR", "SR", "II", "III", "IV", "V", "VI"}


@dataclass
class ParsedDepthEntry:
    team_code: str
    depth_position: str
    depth_rank: int
    jersey_number: str
    player_name: str
    player_key: str
    status: str


def _clean_text(value: str) -> str:
    text = html.unescape(TAG_RE.sub(" ", value or ""))
    text = text.replace("\xa0", " ")
    return MULTI_SPACE_RE.sub(" ", text).strip()


def _canonical_name_key(value: str) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return ""
    normalized = unicodedata.normalize("NFKD", raw)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    return NON_ALNUM_RE.sub("", ascii_text)


def _strip_suffix(name: str) -> str:
    tokens = [tok for tok in (name or "").strip().split(" ") if tok]
    while tokens:
        tail = tokens[-1].replace(".", "").upper()
        if tail in SUFFIX_TOKENS:
            tokens.pop()
            continue
        break
    return " ".join(tokens)


def _canonical_name_keys(value: str) -> set[str]:
    base = (value or "").strip()
    if not base:
        return set()
    keys = {_canonical_name_key(base)}
    no_suffix = _strip_suffix(base)
    if no_suffix and no_suffix != base:
        keys.add(_canonical_name_key(no_suffix))
    return {k for k in keys if k}


def _name_tokens(value: str) -> list[str]:
    cleaned = _canonical_name_key((value or "").replace(".", " "))
    if not cleaned:
        return []
    # Re-tokenize using a softer pass to preserve word boundaries.
    raw = (value or "").strip().lower()
    normalized = unicodedata.normalize("NFKD", raw)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    tokens = [t for t in NON_ALNUM_RE.sub(" ", ascii_text).split(" ") if t]
    while tokens:
        tail = tokens[-1].upper()
        if tail in SUFFIX_TOKENS:
            tokens.pop()
            continue
        break
    return tokens


def _entry_last_name_key(player_name: str) -> str:
    tokens = _name_tokens(player_name)
    if not tokens:
        return ""
    return _canonical_name_key(tokens[-1])


def _player_last_name_key(player: Player) -> str:
    last = (player.last_name or "").strip()
    if last:
        last_tokens = _name_tokens(last)
        if last_tokens:
            return _canonical_name_key(last_tokens[-1])

    full_tokens = _name_tokens(
        f"{player.first_name or ''} {player.last_name or ''}".strip()
        or player.display_name
        or ""
    )
    if not full_tokens:
        return ""
    return _canonical_name_key(full_tokens[-1])


def _player_first_name_tokens(player: Player) -> list[str]:
    first = (player.first_name or "").strip()
    if first:
        tokens = _name_tokens(first)
        if tokens:
            return tokens
    full_tokens = _name_tokens(
        f"{player.first_name or ''} {player.last_name or ''}".strip()
        or player.display_name
        or ""
    )
    if not full_tokens:
        return []
    return [full_tokens[0]]


def _is_metadata_token(token: str) -> bool:
    t = (token or "").strip().upper()
    if not t:
        return False
    if t in POSITION_METADATA_TOKENS:
        return True
    if re.fullmatch(r"\d{2}/\d+", t):
        return True
    if re.fullmatch(r"[A-Z]{1,4}\d{2}", t):
        return True
    if re.fullmatch(r"\d+", t):
        return True
    if "/" in t:
        left, right = t.split("/", 1)
        if left and right and (left.isalpha() or left.isdigit()):
            return True
    return False


def _parse_player_name_and_meta(raw_text: str) -> tuple[str, str]:
    text = _clean_text(raw_text)
    if not text:
        return "", ""

    if "," in text:
        last_part, right = text.split(",", 1)
        last_part = last_part.strip()
        tokens = [tok.strip() for tok in right.strip().split(" ") if tok.strip()]

        name_tokens: list[str] = []
        meta_tokens: list[str] = []
        for idx, token in enumerate(tokens):
            if _is_metadata_token(token) and name_tokens:
                meta_tokens = tokens[idx:]
                break
            name_tokens.append(token)

        if not name_tokens and tokens:
            name_tokens = [tokens[0]]
            meta_tokens = tokens[1:]

        first_part = " ".join(name_tokens).strip()
        full_name = f"{first_part} {last_part}".strip()
        return full_name, " ".join(meta_tokens).strip()

    tokens = [tok.strip() for tok in text.split(" ") if tok.strip()]
    if not tokens:
        return "", ""

    keep: list[str] = []
    meta: list[str] = []
    for idx, token in enumerate(tokens):
        upper = token.upper()
        # Ourlads FUT entries sometimes inject position labels inside the name,
        # e.g. "Andrew OG Stueber" => keep "Andrew Stueber".
        if (
            idx > 0
            and idx < (len(tokens) - 1)
            and upper in POSITION_METADATA_TOKENS
            and upper not in {"PR", "KR", "PK", "KO", "PT"}
        ):
            continue
        if _is_metadata_token(token) and idx > 0:
            meta = tokens[idx:]
            break
        keep.append(token)

    if not keep:
        keep = [tokens[0]]
        meta = tokens[1:]

    return " ".join(keep).strip(), " ".join(meta).strip()


def _normalize_depth_position(raw_position: str) -> str:
    pos = _clean_text(raw_position).upper()
    return pos[:10]


def _canonical_player_position(depth_position: str) -> str:
    return POSITION_TOKEN_MAP.get((depth_position or "").upper(), "")


def _status_from_classes_and_meta(
    classes: list[str],
    status_hint: str,
    depth_position: str,
) -> str:
    normalized_classes = [c.strip().lower() for c in classes if c.strip()]
    base = ""
    for class_name in normalized_classes:
        mapped = PLAYER_STATUS_BY_CLASS.get(class_name)
        if mapped:
            base = mapped
            break

    hint_token = ""
    if status_hint:
        for token in status_hint.split(" "):
            t = token.strip().upper()
            if "/" in t and any(ch.isalpha() for ch in t):
                hint_token = t
                break

    if not base and hint_token:
        code = hint_token.split("/", 1)[0]
        base = STATUS_CODE_MAP.get(code, code)

    if not base and depth_position == "FUT":
        base = "FUTURES"

    if base and hint_token and hint_token not in base:
        return f"{base} ({hint_token})"[:50]
    return base[:50]


def _team_code_to_db_abbr(team_code: str) -> str:
    normalized = (team_code or "").upper().strip()
    return TEAM_CODE_TO_DB_ABBR.get(normalized, normalized)


def _db_abbr_to_team_code(db_abbr: str) -> str:
    normalized = (db_abbr or "").upper().strip()
    return DB_ABBR_TO_TEAM_CODE.get(normalized, normalized)


def _extract_depth_entries(team_code: str, page_html: str) -> list[ParsedDepthEntry]:
    entries: list[ParsedDepthEntry] = []

    for body_id, body_html in TBODY_RE.findall(page_html):
        if body_id not in TBODY_IDS:
            continue

        rows = ROW_RE.findall(body_html)
        for row_html in rows:
            cells = CELL_RE.findall(row_html)
            if len(cells) < 3:
                continue

            depth_position = _normalize_depth_position(cells[0])
            if not depth_position:
                continue

            for depth_idx in range(5):
                jersey_cell_idx = 1 + (depth_idx * 2)
                player_cell_idx = 2 + (depth_idx * 2)
                if player_cell_idx >= len(cells):
                    continue

                jersey_number = (
                    _clean_text(cells[jersey_cell_idx])
                    if jersey_cell_idx < len(cells)
                    else ""
                )
                player_cell = cells[player_cell_idx]

                anchor = ANCHOR_RE.search(player_cell)
                if not anchor:
                    continue

                attrs = anchor.group(1) or ""
                inner_html = anchor.group(2) or ""

                href_match = HREF_RE.search(attrs)
                href = href_match.group(1).strip() if href_match else ""
                if "/player/0/" in href:
                    continue

                class_match = CLASS_RE.search(attrs)
                classes = class_match.group(1).split() if class_match else []

                player_name, status_hint = _parse_player_name_and_meta(inner_html)
                if not player_name:
                    continue

                status = _status_from_classes_and_meta(
                    classes, status_hint, depth_position
                )

                entries.append(
                    ParsedDepthEntry(
                        team_code=team_code,
                        depth_position=depth_position,
                        depth_rank=depth_idx + 1,
                        jersey_number=jersey_number,
                        player_name=player_name,
                        player_key=_canonical_name_key(player_name),
                        status=status,
                    )
                )

    return entries


def _position_priority(depth_position: str) -> int:
    pos = (depth_position or "").upper()
    if pos == "FUT":
        return 2
    if pos in {"PT", "PK", "KO", "PR", "KR", "H", "LS"}:
        return 1
    return 0


def _build_players_by_key(players: list[Player]) -> dict[str, list[Player]]:
    players_by_key: dict[str, list[Player]] = defaultdict(list)
    for player in players:
        keys = {
            *(_canonical_name_keys(player.display_name)),
            *(_canonical_name_keys(player.short_name)),
            *(_canonical_name_keys(f"{player.first_name} {player.last_name}")),
            *(
                _canonical_name_keys(
                    f"{(player.first_name or '')[:1]} {player.last_name}"
                )
            ),
        }
        for key in keys:
            if key:
                players_by_key[key].append(player)
    return players_by_key


def _build_players_by_last_name(players: list[Player]) -> dict[str, list[Player]]:
    players_by_last: dict[str, list[Player]] = defaultdict(list)
    for player in players:
        key = _player_last_name_key(player)
        if key:
            players_by_last[key].append(player)
    return players_by_last


class Command(BaseCommand):
    help = "Sync Ourlads NFL depth charts into Player depth-chart fields."

    def add_arguments(self, parser):
        parser.add_argument(
            "--team",
            action="append",
            dest="teams",
            default=None,
            help="Limit to team abbreviation (DB code, e.g. ARI or BUF). Repeatable.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and match without writing DB updates.",
        )
        parser.add_argument(
            "--no-clear-missing",
            action="store_true",
            help="Do not clear stale depth fields for team players missing from latest scrape.",
        )
        parser.add_argument(
            "--delay-ms",
            type=int,
            default=150,
            help="Delay between team page requests (default: 150).",
        )

    def handle(self, *args, **options):
        dry_run = bool(options.get("dry_run"))
        clear_missing = not bool(options.get("no_clear_missing"))
        delay_ms = max(0, int(options.get("delay_ms") or 0))
        selected_teams = options.get("teams") or []

        session = requests.Session()
        session.headers.update(
            {
                "User-Agent": "engineering-atlas/sync_ourlads_depth_charts (+local dev)",
                "Accept": "text/html,application/xhtml+xml",
            }
        )

        team_codes = self._load_team_codes(session)
        if not team_codes:
            self.stdout.write(
                self.style.ERROR("No team links found on Ourlads index page.")
            )
            return

        if selected_teams:
            requested_codes = set()
            for item in selected_teams:
                db_abbr = (item or "").upper().strip()
                if not db_abbr:
                    continue
                requested_codes.add(_db_abbr_to_team_code(db_abbr))
            team_codes = [code for code in team_codes if code in requested_codes]

        if not team_codes:
            self.stdout.write(self.style.WARNING("No teams selected after filtering."))
            return

        totals = Counter()
        unresolved_examples: list[str] = []
        all_players = list(
            Player.objects.using("nfl").only(
                "id",
                "display_name",
                "short_name",
                "first_name",
                "last_name",
                "position",
                "jersey_number",
                "current_team_id",
                "depth_chart_position",
                "depth_chart_rank",
                "depth_chart_status",
            )
        )
        all_players_by_key = _build_players_by_key(all_players)
        all_players_by_last = _build_players_by_last_name(all_players)

        if dry_run:
            self.stdout.write(
                self.style.WARNING("DRY RUN: no DB updates will be written.")
            )

        for team_code in team_codes:
            page_html = self._fetch_team_page(session, team_code)
            if not page_html:
                self.stdout.write(
                    self.style.WARNING(f"[skip] {team_code}: failed to fetch")
                )
                totals["teams_failed"] += 1
                continue

            parsed_entries = _extract_depth_entries(team_code, page_html)
            if not parsed_entries:
                self.stdout.write(
                    self.style.WARNING(f"[skip] {team_code}: no depth entries parsed")
                )
                totals["teams_failed"] += 1
                continue

            db_abbr = _team_code_to_db_abbr(team_code)
            team = Team.objects.using("nfl").filter(abbreviation=db_abbr).first()
            if not team:
                self.stdout.write(
                    self.style.WARNING(
                        f"[skip] {team_code}: team {db_abbr} not found in DB"
                    )
                )
                totals["teams_failed"] += 1
                continue

            team_result, team_examples = self._sync_team_entries(
                team=team,
                entries=parsed_entries,
                dry_run=dry_run,
                clear_missing=clear_missing,
                all_players_by_key=all_players_by_key,
                all_players_by_last=all_players_by_last,
            )
            totals.update(team_result)
            unresolved_examples.extend(team_examples)

            self.stdout.write(
                f"[{db_abbr}] slots={team_result['slots']:,} matched={team_result['matched']:,} "
                f"updated={team_result['updated']:,} cleared={team_result['cleared']:,} "
                f"reassigned={team_result['reassigned']:,} unmatched={team_result['unmatched']:,}"
            )

            if delay_ms:
                time.sleep(delay_ms / 1000.0)

        self.stdout.write(
            self.style.SUCCESS(
                "sync_ourlads_depth_charts complete: "
                f"teams={totals['teams']:,}, failed={totals['teams_failed']:,}, "
                f"slots={totals['slots']:,}, matched={totals['matched']:,}, "
                f"updated={totals['updated']:,}, cleared={totals['cleared']:,}, "
                f"reassigned={totals['reassigned']:,}, "
                f"unmatched={totals['unmatched']:,}"
            )
        )

        if unresolved_examples:
            unique = []
            seen = set()
            for item in unresolved_examples:
                if item in seen:
                    continue
                unique.append(item)
                seen.add(item)
                if len(unique) >= 12:
                    break
            self.stdout.write("Unmatched examples: " + ", ".join(unique))

    def _load_team_codes(self, session: requests.Session) -> list[str]:
        try:
            resp = session.get(OURLADS_INDEX_URL, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as exc:
            self.stderr.write(self.style.ERROR(f"Failed to fetch Ourlads index: {exc}"))
            return []

        found = TEAM_LINK_RE.findall(resp.text)
        codes = sorted({code.upper() for code in found if code})
        return codes

    def _fetch_team_page(self, session: requests.Session, team_code: str) -> str:
        url = OURLADS_TEAM_URL.format(team_code=team_code)
        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as exc:
            self.stderr.write(self.style.WARNING(f"Failed to fetch {url}: {exc}"))
            return ""

    def _sync_team_entries(
        self,
        *,
        team: Team,
        entries: list[ParsedDepthEntry],
        dry_run: bool,
        clear_missing: bool,
        all_players_by_key: dict[str, list[Player]],
        all_players_by_last: dict[str, list[Player]],
    ) -> tuple[Counter, list[str]]:
        team_players = list(
            Player.objects.using("nfl")
            .filter(current_team=team)
            .only(
                "id",
                "display_name",
                "short_name",
                "first_name",
                "last_name",
                "position",
                "jersey_number",
                "current_team_id",
                "depth_chart_position",
                "depth_chart_rank",
                "depth_chart_status",
            )
        )

        players_by_key = _build_players_by_key(team_players)
        players_by_last = _build_players_by_last_name(team_players)

        chosen_by_player_id: dict[
            int, tuple[tuple[int, int], ParsedDepthEntry, Player]
        ] = {}
        unmatched_examples: list[str] = []
        counters = Counter()
        counters["teams"] = 1
        counters["slots"] = len(entries)

        for entry in entries:
            player, matched_globally = self._match_player(
                entry=entry,
                team_players_by_key=players_by_key,
                team_players_by_last=players_by_last,
                all_players_by_key=all_players_by_key,
                all_players_by_last=all_players_by_last,
            )
            if not player:
                counters["unmatched"] += 1
                if len(unmatched_examples) < 8:
                    unmatched_examples.append(
                        f"{team.abbreviation}:{entry.depth_position}:{entry.player_name}"
                    )
                continue

            counters["matched"] += 1
            if matched_globally:
                counters["reassigned"] += 1
            score = (_position_priority(entry.depth_position), entry.depth_rank)
            current = chosen_by_player_id.get(player.id)
            if current is None or score < current[0]:
                chosen_by_player_id[player.id] = (score, entry, player)

        updates: list[Player] = []
        matched_ids = set(chosen_by_player_id.keys())

        for _score, entry, player in chosen_by_player_id.values():
            changed = False

            next_position = entry.depth_position[:10]
            next_rank = entry.depth_rank
            next_status = (entry.status or "")[:50]

            if player.depth_chart_position != next_position:
                player.depth_chart_position = next_position
                changed = True
            if player.depth_chart_rank != next_rank:
                player.depth_chart_rank = next_rank
                changed = True
            if (player.depth_chart_status or "") != next_status:
                player.depth_chart_status = next_status
                changed = True
            if player.current_team_id != team.id:
                player.current_team_id = team.id
                changed = True

            if changed:
                updates.append(player)

        clear_updates: list[Player] = []
        if clear_missing:
            for player in team_players:
                if player.id in matched_ids:
                    continue
                has_depth = (
                    bool(player.depth_chart_position)
                    or player.depth_chart_rank is not None
                    or bool(player.depth_chart_status)
                )
                if not has_depth:
                    continue
                player.depth_chart_position = ""
                player.depth_chart_rank = None
                player.depth_chart_status = ""
                clear_updates.append(player)

        counters["updated"] = len(updates)
        counters["cleared"] = len(clear_updates)

        if not dry_run:
            if updates:
                Player.objects.using("nfl").bulk_update(
                    updates,
                    [
                        "current_team",
                        "depth_chart_position",
                        "depth_chart_rank",
                        "depth_chart_status",
                    ],
                    batch_size=500,
                )
            if clear_updates:
                Player.objects.using("nfl").bulk_update(
                    clear_updates,
                    ["depth_chart_position", "depth_chart_rank", "depth_chart_status"],
                    batch_size=500,
                )

        return counters, unmatched_examples

    def _match_player(
        self,
        *,
        entry: ParsedDepthEntry,
        team_players_by_key: dict[str, list[Player]],
        team_players_by_last: dict[str, list[Player]],
        all_players_by_key: dict[str, list[Player]],
        all_players_by_last: dict[str, list[Player]],
    ) -> tuple[Player | None, bool]:
        candidates = team_players_by_key.get(entry.player_key, [])
        if not candidates:
            for alt_key in _canonical_name_keys(entry.player_name):
                if alt_key == entry.player_key:
                    continue
                alt_candidates = team_players_by_key.get(alt_key, [])
                if alt_candidates:
                    candidates = alt_candidates
                    break
        matched = self._select_candidate(entry, candidates)
        if matched:
            return matched, False
        # Team-local fuzzy fallback by last name.
        team_last_key = _entry_last_name_key(entry.player_name)
        if team_last_key:
            team_last_candidates = team_players_by_last.get(team_last_key, [])
            matched = self._select_candidate_by_last_name(entry, team_last_candidates)
            if matched:
                return matched, False

        # Fallback: look across all players and only accept unambiguous matches.
        # This catches newly signed veterans who land directly in a live depth
        # slot before other roster sources update their current team.
        global_candidates = all_players_by_key.get(entry.player_key, [])
        if not global_candidates:
            for alt_key in _canonical_name_keys(entry.player_name):
                if alt_key == entry.player_key:
                    continue
                alt_candidates = all_players_by_key.get(alt_key, [])
                if alt_candidates:
                    global_candidates = alt_candidates
                    break
        matched = self._select_candidate(entry, global_candidates)
        if matched:
            return matched, True
        if team_last_key:
            global_last_candidates = all_players_by_last.get(team_last_key, [])
            matched = self._select_candidate_by_last_name(entry, global_last_candidates)
            if matched:
                return matched, True

        return None, False

    def _select_candidate(
        self,
        entry: ParsedDepthEntry,
        candidates: list[Player],
    ) -> Player | None:
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]

        current = candidates
        if entry.jersey_number:
            by_jersey = [
                p for p in current if (p.jersey_number or "") == entry.jersey_number
            ]
            if len(by_jersey) == 1:
                return by_jersey[0]
            if by_jersey:
                current = by_jersey

        expected_position = _canonical_player_position(entry.depth_position)
        if expected_position:
            by_pos = [
                p for p in current if (p.position or "").upper() == expected_position
            ]
            if len(by_pos) == 1:
                return by_pos[0]
            if by_pos:
                current = by_pos

        # Remaining ambiguity: do not guess.
        return None

    def _select_candidate_by_last_name(
        self,
        entry: ParsedDepthEntry,
        candidates: list[Player],
    ) -> Player | None:
        if not candidates:
            return None
        current = candidates

        if entry.jersey_number:
            by_jersey = [
                p for p in current if (p.jersey_number or "") == entry.jersey_number
            ]
            if len(by_jersey) == 1:
                return by_jersey[0]
            if by_jersey:
                current = by_jersey

        expected_position = _canonical_player_position(entry.depth_position)
        if expected_position:
            by_pos = [
                p for p in current if (p.position or "").upper() == expected_position
            ]
            if len(by_pos) == 1:
                return by_pos[0]
            if by_pos:
                current = by_pos

        entry_tokens = _name_tokens(entry.player_name)
        if entry_tokens:
            entry_first = _canonical_name_key(entry_tokens[0])
            if entry_first:
                by_first = []
                for player in current:
                    first_tokens = _player_first_name_tokens(player)
                    if not first_tokens:
                        continue
                    first_key = _canonical_name_key(first_tokens[0])
                    if not first_key:
                        continue
                    if first_key.startswith(entry_first) or entry_first.startswith(
                        first_key
                    ):
                        by_first.append(player)
                if len(by_first) == 1:
                    return by_first[0]

        return None
