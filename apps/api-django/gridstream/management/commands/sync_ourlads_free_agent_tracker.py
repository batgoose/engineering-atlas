"""
Sync Ourlads team free-agent tracker pages into TeamFreeAgentTrackerEntry rows.

Usage:
    python manage.py sync_ourlads_free_agent_tracker
    python manage.py sync_ourlads_free_agent_tracker --season 2026
    python manage.py sync_ourlads_free_agent_tracker --team WAS --team SEA
    python manage.py sync_ourlads_free_agent_tracker --dry-run
"""

from __future__ import annotations

import html
import re
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import date

import requests
from django.core.management.base import BaseCommand

from gridstream.models import Player, Team, TeamFreeAgentTrackerEntry

OURLADS_TRACKER_URL = (
    "https://www.ourlads.com/nfl-free-agent-tracker/team/{team_slug}/{season}"
)

TEAM_CODE_TO_DB_ABBR = {
    "ARZ": "ARI",
    "LAR": "LA",
}

TAG_RE = re.compile(r"<[^>]+>", re.DOTALL)
ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.IGNORECASE | re.DOTALL)
TBODY_RE = re.compile(
    r"<tbody[^>]*id=['\"]ctl00_phContent_dcTBody['\"][^>]*>(.*?)</tbody>",
    re.IGNORECASE | re.DOTALL,
)
PLAYER_HREF_RE = re.compile(
    r"href=['\"]https://www\.ourlads\.com/nfldepthcharts/player/(\d+)['\"]",
    re.IGNORECASE,
)
TEAM_HREF_RE = re.compile(r"depthchart/([A-Z0-9]+)['\"]", re.IGNORECASE)
MULTI_SPACE_RE = re.compile(r"\s+")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
SUFFIX_TOKENS = {"JR", "SR", "II", "III", "IV", "V", "VI"}


def _current_free_agency_year() -> int:
    return date.today().year


def _team_code_to_db_abbr(team_code: str) -> str:
    code = (team_code or "").upper().strip()
    return TEAM_CODE_TO_DB_ABBR.get(code, code)


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


def _tracker_name_variants(value: str) -> set[str]:
    cleaned = _clean_text(value)
    if not cleaned:
        return set()

    variants = {cleaned}
    if "," in cleaned:
        last, first = [part.strip() for part in cleaned.split(",", 1)]
        if first and last:
            variants.add(f"{first} {last}")

    expanded = set()
    for variant in variants:
        expanded.add(variant)
        no_suffix = _strip_suffix(variant)
        if no_suffix:
            expanded.add(no_suffix)
    return {item for item in expanded if item}


def _tracker_name_keys(value: str) -> set[str]:
    return {
        key
        for variant in _tracker_name_variants(value)
        for key in {_canonical_name_key(variant)}
        if key
    }


def _player_name_keys(player: Player) -> set[str]:
    values = {
        player.display_name,
        player.short_name,
        f"{player.first_name or ''} {player.last_name or ''}".strip(),
        f"{player.last_name or ''}, {player.first_name or ''}".strip(", "),
    }
    keys = set()
    for value in values:
        if not value:
            continue
        keys.add(_canonical_name_key(value))
        no_suffix = _strip_suffix(value)
        if no_suffix:
            keys.add(_canonical_name_key(no_suffix))
    return {key for key in keys if key}


def _position_matches(entry_position: str, player: Player) -> bool:
    entry = (entry_position or "").upper().strip()
    if not entry:
        return False
    player_tokens = {
        (player.position or "").upper().strip(),
        (player.position_group or "").upper().strip(),
        (player.depth_chart_position or "").upper().strip(),
    }
    if entry in player_tokens:
        return True
    if entry in {"OT", "LT", "RT"} and player.position == "T":
        return True
    if entry in {"OG", "LG", "RG"} and player.position == "G":
        return True
    if entry in {"ED", "DE"} and player.position in {"DE", "OLB"}:
        return True
    if entry in {"DT", "NT"} and player.position in {"DT", "NT", "DL"}:
        return True
    if entry == "PK" and player.position == "K":
        return True
    if entry == "PT" and player.position == "P":
        return True
    return False


def _build_players_by_key(players: list[Player]) -> dict[str, list[Player]]:
    by_key: dict[str, list[Player]] = {}
    for player in players:
        for key in _player_name_keys(player):
            by_key.setdefault(key, []).append(player)
    return by_key


@dataclass
class ParsedTrackerEntry:
    player_name: str
    ourlads_player_id: str
    position: str
    fa_type: str
    signed_with_team_abbr: str | None
    source_url: str


def _extract_tracker_entries(
    source_url: str, page_html: str
) -> list[ParsedTrackerEntry]:
    tbody_match = TBODY_RE.search(page_html or "")
    if not tbody_match:
        return []

    entries: list[ParsedTrackerEntry] = []
    tbody_html = tbody_match.group(1)
    for row_html in ROW_RE.findall(tbody_html):
        cells = CELL_RE.findall(row_html)
        if len(cells) < 5:
            continue

        player_cell, _team_cell, position_cell, fa_type_cell, signed_with_cell = cells[
            :5
        ]
        player_name = _clean_text(player_cell)
        if not player_name:
            continue

        player_href = PLAYER_HREF_RE.search(player_cell or "")
        team_href = TEAM_HREF_RE.search(signed_with_cell or "")
        signed_with_abbr = (
            _team_code_to_db_abbr(team_href.group(1)) if team_href else None
        )

        entries.append(
            ParsedTrackerEntry(
                player_name=player_name,
                ourlads_player_id=player_href.group(1) if player_href else "",
                position=_clean_text(position_cell).upper(),
                fa_type=_clean_text(fa_type_cell).upper(),
                signed_with_team_abbr=signed_with_abbr,
                source_url=source_url,
            )
        )

    return entries


def _match_player(
    entry: ParsedTrackerEntry,
    players_by_key: dict[str, list[Player]],
    team: Team,
    signed_with_team: Team | None,
) -> Player | None:
    candidates: list[Player] = []
    seen: set[int] = set()
    for key in _tracker_name_keys(entry.player_name):
        for player in players_by_key.get(key, []):
            if player.id in seen:
                continue
            seen.add(player.id)
            candidates.append(player)

    if not candidates:
        return None

    def _score(player: Player) -> tuple[int, int, int]:
        team_bonus = 2
        if player.current_team_id == team.id:
            team_bonus = 0
        elif signed_with_team and player.current_team_id == signed_with_team.id:
            team_bonus = 1

        position_bonus = 0 if _position_matches(entry.position, player) else 1
        return (team_bonus, position_bonus, player.id)

    return sorted(candidates, key=_score)[0]


class Command(BaseCommand):
    help = "Sync Ourlads NFL team free-agent tracker pages"

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=_current_free_agency_year(),
            help="Calendar year to sync (default: current year).",
        )
        parser.add_argument(
            "--team",
            action="append",
            dest="teams",
            default=[],
            help="Team abbreviation(s) to sync, e.g. --team WAS --team SEA",
        )
        parser.add_argument(
            "--dry-run", action="store_true", help="Do not write DB changes."
        )
        parser.add_argument(
            "--delay-ms",
            type=int,
            default=150,
            help="Delay between requests in milliseconds (default: 150).",
        )

    def handle(self, *args, **options):
        season = int(options.get("season") or _current_free_agency_year())
        selected_teams = {
            (team or "").upper().strip()
            for team in (options.get("teams") or [])
            if team
        }
        dry_run = bool(options.get("dry_run"))
        delay_ms = max(0, int(options.get("delay_ms") or 0))

        session = requests.Session()
        session.headers.update(
            {
                "User-Agent": "engineering-atlas/sync_ourlads_free_agent_tracker (+local dev)",
                "Accept": "text/html,application/xhtml+xml",
            }
        )

        teams = list(
            Team.objects.using("nfl")
            .filter(is_active=True)
            .only("id", "abbreviation", "slug", "display_name")
            .order_by("abbreviation")
        )
        if selected_teams:
            teams = [team for team in teams if team.abbreviation in selected_teams]

        if not teams:
            self.stdout.write(self.style.WARNING("No teams selected after filtering."))
            return

        all_players = list(
            Player.objects.using("nfl").only(
                "id",
                "display_name",
                "short_name",
                "first_name",
                "last_name",
                "position",
                "position_group",
                "depth_chart_position",
                "current_team_id",
            )
        )
        players_by_key = _build_players_by_key(all_players)
        teams_by_abbr = {
            team.abbreviation: team
            for team in Team.objects.using("nfl").only(
                "id", "abbreviation", "display_name"
            )
        }

        totals = Counter()
        unresolved_examples: list[str] = []
        if dry_run:
            self.stdout.write(
                self.style.WARNING("DRY RUN: no DB updates will be written.")
            )

        for team in teams:
            source_url = OURLADS_TRACKER_URL.format(team_slug=team.slug, season=season)
            try:
                response = session.get(source_url, timeout=30)
                response.raise_for_status()
            except requests.RequestException as exc:
                self.stderr.write(
                    self.style.WARNING(f"Failed to fetch {source_url}: {exc}")
                )
                totals["teams_failed"] += 1
                continue

            parsed_entries = _extract_tracker_entries(source_url, response.text)
            if not parsed_entries:
                self.stdout.write(
                    self.style.WARNING(
                        f"[skip] {team.abbreviation}: no tracker rows parsed for {source_url}"
                    )
                )
                totals["teams_failed"] += 1
                continue

            pending: list[TeamFreeAgentTrackerEntry] = []
            matched = 0
            for entry in parsed_entries:
                signed_with_team = (
                    teams_by_abbr.get(entry.signed_with_team_abbr or "")
                    if entry.signed_with_team_abbr
                    else None
                )
                matched_player = _match_player(
                    entry, players_by_key, team, signed_with_team
                )
                if matched_player:
                    matched += 1
                elif len(unresolved_examples) < 10:
                    unresolved_examples.append(
                        f"{team.abbreviation}:{entry.player_name}:{entry.position}"
                    )

                tracker_status = "unsigned"
                if signed_with_team:
                    tracker_status = (
                        "re_signed"
                        if signed_with_team.id == team.id
                        else "signed_elsewhere"
                    )

                pending.append(
                    TeamFreeAgentTrackerEntry(
                        team=team,
                        season=season,
                        player=matched_player,
                        player_name=entry.player_name,
                        ourlads_player_id=entry.ourlads_player_id,
                        position=entry.position,
                        fa_type=entry.fa_type,
                        signed_with_team=signed_with_team,
                        tracker_status=tracker_status,
                        source_url=entry.source_url,
                    )
                )

            totals["teams"] += 1
            totals["rows"] += len(pending)
            totals["matched"] += matched
            totals["unmatched"] += len(pending) - matched

            if not dry_run:
                TeamFreeAgentTrackerEntry.objects.using("nfl").filter(
                    team=team, season=season
                ).delete()
                TeamFreeAgentTrackerEntry.objects.using("nfl").bulk_create(
                    pending, batch_size=500
                )

            self.stdout.write(
                f"[{team.abbreviation}] rows={len(pending):,} matched={matched:,} "
                f"unmatched={len(pending) - matched:,}"
            )

            if delay_ms:
                time.sleep(delay_ms / 1000.0)

        self.stdout.write(
            self.style.SUCCESS(
                "sync_ourlads_free_agent_tracker complete: "
                f"teams={totals['teams']:,}, failed={totals['teams_failed']:,}, "
                f"rows={totals['rows']:,}, matched={totals['matched']:,}, "
                f"unmatched={totals['unmatched']:,}"
            )
        )
        if unresolved_examples:
            self.stdout.write("Unmatched examples: " + ", ".join(unresolved_examples))
