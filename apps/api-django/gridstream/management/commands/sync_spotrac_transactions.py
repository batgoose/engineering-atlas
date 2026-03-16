"""
Sync official team transaction pages from Spotrac into PlayerTransaction rows.

Usage:
    python manage.py sync_spotrac_transactions
    python manage.py sync_spotrac_transactions --season 2026
    python manage.py sync_spotrac_transactions --team WAS --team SEA
    python manage.py sync_spotrac_transactions --dry-run
"""

from __future__ import annotations

import html
import logging
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime


import requests
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from gridstream.models import Player, PlayerTransaction, Team

logger = logging.getLogger(__name__)

SPOTRAC_TRANSACTIONS_URL = "https://www.spotrac.com/nfl/transactions/_/team/{team_code}"
SPOTRAC_ALL_TRANSACTIONS_URL = "https://www.spotrac.com/nfl/transactions"
SPOTRAC_FREE_AGENTS_URL = "https://www.spotrac.com/nfl/free-agents"
SPOTRAC_TEAM_CODE_OVERRIDES = {
    "LA": "lar",
}
TEAM_ABBR_RE = re.compile(r"\(([A-Z]{2,3})\)")
LIST_ITEM_RE = re.compile(
    r"<li class=\"list-group-item[^\"]*\".*?</li>", re.IGNORECASE | re.DOTALL
)
PLAYER_LINK_RE = re.compile(
    r"<a href=\"(?P<url>https://www\.spotrac\.com/nfl/player/_/id/\d+/[^\"]+)\"[^>]*>"
    r"(?P<label>.*?)</a>",
    re.IGNORECASE | re.DOTALL,
)
TABLE_ROW_RE = re.compile(r"<tr\b[^>]*>.*?</tr>", re.IGNORECASE | re.DOTALL)
TABLE_CELL_RE = re.compile(r"<td\b[^>]*>(?P<body>.*?)</td>", re.IGNORECASE | re.DOTALL)
DETAIL_RE = re.compile(
    r"<small[^>]*><strong>(?P<date>[^<]+)</strong>\s*-\s*(?P<detail>.*?)</small>",
    re.IGNORECASE | re.DOTALL,
)
TEAM_ABBR_CELL_RE = re.compile(
    r"<span[^>]*class=\"[^\"]*d-none[^\"]*\"[^>]*>(?P<abbr>[A-Z]{2,3})</span>",
    re.IGNORECASE | re.DOTALL,
)
TAG_RE = re.compile(r"<[^>]+>", re.DOTALL)
MULTI_SPACE_RE = re.compile(r"\s+")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
NON_DIGIT_RE = re.compile(r"[^\d]")
SUFFIX_TOKENS = {"JR", "SR", "II", "III", "IV", "V", "VI"}


def _current_transaction_year() -> int:
    return date.today().year


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


def _strip_suffix_tokens(tokens: list[str]) -> list[str]:
    cleaned = list(tokens)
    while cleaned:
        tail = cleaned[-1].replace(".", "").upper()
        if tail in SUFFIX_TOKENS:
            cleaned.pop()
            continue
        break
    return cleaned


def _name_variants(value: str) -> set[str]:
    cleaned = _clean_text(value)
    if not cleaned:
        return set()

    variants = {cleaned}
    if "," in cleaned:
        last, first = [part.strip() for part in cleaned.split(",", 1)]
        if first and last:
            variants.add(f"{first} {last}")

    expanded: set[str] = set()
    for variant in variants:
        tokens = [tok for tok in variant.split(" ") if tok]
        if not tokens:
            continue
        expanded.add(variant)

        no_suffix_tokens = _strip_suffix_tokens(tokens)
        if no_suffix_tokens:
            expanded.add(" ".join(no_suffix_tokens))

        for base_tokens in {tuple(tokens), tuple(no_suffix_tokens)}:
            if not base_tokens:
                continue
            last_token = base_tokens[-1]
            if "-" not in last_token:
                continue
            first_segment = last_token.split("-", 1)[0].strip()
            if not first_segment:
                continue
            truncated = " ".join([*base_tokens[:-1], first_segment])
            if truncated:
                expanded.add(truncated)

    return {item for item in expanded if item}


def _name_keys(value: str) -> set[str]:
    keys = {
        _canonical_name_key(variant) for variant in _name_variants(value) if variant
    }
    return {key for key in keys if key}


def _player_name_keys(player: Player) -> set[str]:
    values = {
        player.display_name,
        player.short_name,
        f"{player.first_name or ''} {player.last_name or ''}".strip(),
        f"{player.last_name or ''}, {player.first_name or ''}".strip(", "),
    }
    keys: set[str] = set()
    for value in values:
        if not value:
            continue
        keys.update(_name_keys(value))
    return {key for key in keys if key}


def _build_players_by_key(players: list[Player]) -> dict[str, list[Player]]:
    by_key: dict[str, list[Player]] = {}
    for player in players:
        for key in _player_name_keys(player):
            by_key.setdefault(key, []).append(player)
    return by_key


def _position_matches(entry_position: str, player: Player) -> bool:
    entry = (entry_position or "").upper().strip()
    if not entry:
        return True
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


def _match_player(
    player_name: str, position: str, players_by_key: dict[str, list[Player]]
) -> Player | None:
    candidates: list[Player] = []
    seen: set[int] = set()
    for key in _name_keys(player_name):
        for player in players_by_key.get(key, []):
            if player.id in seen:
                continue
            seen.add(player.id)
            candidates.append(player)
    if not candidates:
        return None

    def _score(player: Player) -> tuple[int, int]:
        return (0 if _position_matches(position, player) else 1, player.id)

    return sorted(candidates, key=_score)[0]


@dataclass
class ParsedSpotracTransaction:
    player_name: str
    position: str
    occurred_on: date
    detail: str
    player_url: str
    source_url: str


@dataclass
class ParsedSpotracFreeAgentContract:
    player_name: str
    position: str
    from_team_abbr: str | None
    to_team_abbr: str | None
    player_url: str
    source_url: str
    years: int | None
    total_value: int | None
    apy: int | None
    guaranteed: int | None


def _extract_spotrac_transactions(
    source_url: str, page_html: str, season: int
) -> list[ParsedSpotracTransaction]:
    entries: list[ParsedSpotracTransaction] = []
    for item_html in LIST_ITEM_RE.findall(page_html or ""):
        detail_match = DETAIL_RE.search(item_html)
        if not detail_match:
            continue

        date_text = _clean_text(detail_match.group("date"))
        try:
            occurred_on = datetime.strptime(date_text, "%b %d, %Y").date()
        except ValueError:
            continue
        if occurred_on.year != season:
            continue

        player_url = ""
        player_name = ""
        position = ""
        for link_match in PLAYER_LINK_RE.finditer(item_html):
            label = _clean_text(link_match.group("label"))
            if "(" not in label or not label.endswith(")"):
                continue
            player_url = link_match.group("url")
            raw_name, raw_position = label.rsplit("(", 1)
            player_name = raw_name.strip()
            position = raw_position[:-1].strip().upper()
            break

        if not player_name:
            continue

        entries.append(
            ParsedSpotracTransaction(
                player_name=player_name,
                position=position,
                occurred_on=occurred_on,
                detail=_clean_text(detail_match.group("detail")),
                player_url=player_url,
                source_url=source_url,
            )
        )

    return entries


def _parse_integer_token(value: str | None) -> int | None:
    text = (value or "").strip()
    if not text:
        return None
    digits = NON_DIGIT_RE.sub("", text)
    if not digits:
        return None
    return int(digits)


def _parse_currency_token(value: str | None) -> int | None:
    text = (value or "").strip()
    if not text or text in {"-", "—", "--", "N/A"}:
        return None
    digits = NON_DIGIT_RE.sub("", text)
    if not digits:
        return None
    return int(digits)


def _extract_team_abbr_from_cell(cell_html: str) -> str | None:
    match = TEAM_ABBR_CELL_RE.search(cell_html or "")
    if not match:
        return None
    return _normalize_team_abbreviation(_clean_text(match.group("abbr")))


def _extract_spotrac_free_agent_contracts(
    source_url: str, page_html: str
) -> list[ParsedSpotracFreeAgentContract]:
    entries: list[ParsedSpotracFreeAgentContract] = []

    for row_html in TABLE_ROW_RE.findall(page_html or ""):
        if "/nfl/player/_/id/" not in row_html:
            continue

        cells = [match.group("body") for match in TABLE_CELL_RE.finditer(row_html)]
        if len(cells) < 10:
            continue

        player_match = PLAYER_LINK_RE.search(cells[3])
        if not player_match:
            continue

        player_name = _clean_text(player_match.group("label"))
        if not player_name:
            continue

        entry = ParsedSpotracFreeAgentContract(
            player_name=player_name,
            position=_clean_text(cells[4]).upper(),
            from_team_abbr=_extract_team_abbr_from_cell(cells[0]),
            to_team_abbr=_extract_team_abbr_from_cell(cells[2]),
            player_url=player_match.group("url"),
            source_url=source_url,
            years=_parse_integer_token(_clean_text(cells[5])),
            total_value=_parse_currency_token(_clean_text(cells[6])),
            apy=_parse_currency_token(_clean_text(cells[7])),
            guaranteed=_parse_currency_token(_clean_text(cells[8])),
        )

        if not entry.to_team_abbr:
            continue
        if all(
            value is None
            for value in (entry.years, entry.total_value, entry.apy, entry.guaranteed)
        ):
            continue

        entries.append(entry)

    return entries


def _classify_transaction(detail: str) -> str | None:
    normalized = (detail or "").lower()
    if "waived/injured by" in normalized or "waived-injured by" in normalized:
        return "waived_injured"
    if "waived by" in normalized:
        return "waived"
    if "released by" in normalized:
        return "released"
    if "claimed by" in normalized or "claimed off waivers by" in normalized:
        return "claimed"
    if "traded to" in normalized or "acquired via trade by" in normalized:
        return "traded"
    if "practice squad" in normalized and "signed" in normalized:
        return "signed_ps"
    if "retired" in normalized:
        return "retired"
    if (
        "re-signed" in normalized
        or "signed with" in normalized
        or "signed a " in normalized
        or "agreed to terms" in normalized
    ):
        return "signed"
    return None


def _normalize_team_abbreviation(value: str | None) -> str:
    token = (value or "").upper().strip()
    if token == "WSH":
        return "WAS"
    return token


def _resolve_transaction_teams(
    transaction_type: str,
    detail: str,
    fallback_team: Team | None,
    teams_by_abbr: dict[str, Team],
) -> tuple[Team | None, Team | None]:
    abbrs = [
        _normalize_team_abbreviation(match)
        for match in TEAM_ABBR_RE.findall(detail or "")
    ]
    unique_abbrs = [abbr for abbr in abbrs if abbr]
    from_team = None
    to_team = None

    if transaction_type in {"released", "waived", "waived_injured", "retired"}:
        from_team = (
            teams_by_abbr.get(unique_abbrs[-1]) if unique_abbrs else fallback_team
        )
    elif transaction_type in {"signed", "signed_ps", "claimed"}:
        to_team = teams_by_abbr.get(unique_abbrs[-1]) if unique_abbrs else fallback_team
    elif transaction_type == "traded":
        if unique_abbrs:
            to_team = teams_by_abbr.get(unique_abbrs[-1])
        if len(unique_abbrs) >= 2:
            from_team = teams_by_abbr.get(unique_abbrs[0])
        elif fallback_team is not None:
            from_team = fallback_team
            if to_team is None and unique_abbrs:
                to_team = teams_by_abbr.get(unique_abbrs[-1])

    return from_team, to_team


def _spotrac_team_code(team: Team) -> str:
    return SPOTRAC_TEAM_CODE_OVERRIDES.get(team.abbreviation, team.abbreviation.lower())


def _apply_player_state(player: Player, transaction_type: str, team: Team) -> None:
    changed_fields: list[str] = []

    if transaction_type in {"released", "waived", "waived_injured"}:
        if player.current_team_id == team.id:
            player.current_team = None
            changed_fields.append("current_team")
        if player.roster_status != "UFA":
            player.roster_status = "UFA"
            changed_fields.append("roster_status")
        if not player.is_active:
            player.is_active = True
            changed_fields.append("is_active")
    elif transaction_type == "retired":
        if player.current_team_id == team.id:
            player.current_team = None
            changed_fields.append("current_team")
        if player.roster_status != "RET":
            player.roster_status = "RET"
            changed_fields.append("roster_status")
        if player.is_active:
            player.is_active = False
            changed_fields.append("is_active")
    elif transaction_type in {"signed", "signed_ps", "claimed", "traded"}:
        if player.current_team_id != team.id:
            player.current_team = team
            changed_fields.append("current_team")
        if player.roster_status != "ACT":
            player.roster_status = "ACT"
            changed_fields.append("roster_status")
        if not player.is_active:
            player.is_active = True
            changed_fields.append("is_active")

    if not changed_fields:
        return

    player.last_roster_check = timezone.now()
    changed_fields.append("last_roster_check")
    player.save(using="nfl", update_fields=changed_fields)


class Command(BaseCommand):
    help = "Sync Spotrac NFL team transactions into PlayerTransaction rows"

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=_current_transaction_year(),
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
            "--global-only",
            action="store_true",
            help=(
                "Skip per-team pages; only fetch the global all-transactions page "
                "and the free-agent contracts page (~2 requests). Use for frequent polling."
            ),
        )

    def handle(self, *args, **options):
        season = options["season"]
        dry_run = options["dry_run"]
        global_only = options["global_only"]
        requested = [(abbr or "").upper().strip() for abbr in options["teams"] if abbr]
        requested_set = set(requested)

        teams_qs = (
            Team.objects.using("nfl").filter(is_active=True).order_by("abbreviation")
        )
        if requested:
            teams_qs = teams_qs.filter(abbreviation__in=requested)
        teams = list(teams_qs)
        if not teams:
            self.stdout.write(self.style.WARNING("No teams found to sync."))
            return
        all_teams_by_abbr = {
            team.abbreviation: team
            for team in Team.objects.using("nfl").filter(is_active=True)
        }

        players = list(Player.objects.using("nfl").select_related("current_team").all())
        players_by_key = _build_players_by_key(players)
        player_relevance_cache: dict[int, bool] = {}
        latest_state_date_by_player: dict[int, date] = {}

        session = requests.Session()
        session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; AtlasBot/1.0)"})

        created = 0
        updated = 0
        matched = 0
        unmatched = 0
        skipped = 0

        def _touches_requested_team(
            player: Player, from_team: Team | None, to_team: Team | None
        ) -> bool:
            if not requested_set:
                return True
            if from_team and from_team.abbreviation in requested_set:
                return True
            if to_team and to_team.abbreviation in requested_set:
                return True
            if (
                player.current_team_id
                and player.current_team
                and player.current_team.abbreviation in requested_set
            ):
                return True

            cached = player_relevance_cache.get(player.id)
            if cached is None:
                cached = (
                    PlayerTransaction.objects.using("nfl")
                    .filter(player=player, season=season)
                    .filter(
                        Q(from_team__abbreviation__in=requested_set)
                        | Q(to_team__abbreviation__in=requested_set)
                    )
                    .exists()
                )
                player_relevance_cache[player.id] = cached
            return cached

        def _process_entries(
            entries: list[ParsedSpotracTransaction],
            fallback_team: Team | None,
            label: str,
        ) -> None:
            nonlocal created, updated, matched, unmatched, skipped
            team_matched = 0
            team_unmatched = 0
            team_created = 0
            team_updated = 0
            team_skipped = 0

            for entry in entries:
                transaction_type = _classify_transaction(entry.detail)
                if not transaction_type:
                    team_skipped += 1
                    skipped += 1
                    continue

                player = _match_player(
                    entry.player_name, entry.position, players_by_key
                )
                if not player:
                    team_unmatched += 1
                    unmatched += 1
                    logger.warning(
                        "Spotrac transaction unmatched for %s: %s (%s)",
                        label,
                        entry.player_name,
                        entry.detail,
                    )
                    continue

                from_team, to_team = _resolve_transaction_teams(
                    transaction_type,
                    entry.detail,
                    fallback_team,
                    all_teams_by_abbr,
                )
                if not _touches_requested_team(player, from_team, to_team):
                    continue

                matched += 1
                team_matched += 1
                description = f"Spotrac: {entry.detail}"

                if dry_run:
                    self.stdout.write(
                        f"[{label}] {entry.occurred_on} {transaction_type}: {entry.player_name}"
                    )
                    continue

                existing = list(
                    PlayerTransaction.objects.using("nfl")
                    .filter(
                        player=player,
                        transaction_type=transaction_type,
                        date=entry.occurred_on,
                    )
                    .order_by("id")
                )
                if existing:
                    # Keep first, delete any accidental duplicates
                    if len(existing) > 1:
                        PlayerTransaction.objects.using("nfl").filter(
                            id__in=[t.id for t in existing[1:]]
                        ).delete()
                    transaction = existing[0]
                    was_created = False
                else:
                    transaction = PlayerTransaction.objects.using("nfl").create(
                        player=player,
                        transaction_type=transaction_type,
                        date=entry.occurred_on,
                        from_team=from_team,
                        to_team=to_team,
                        description=description,
                        season=season,
                    )
                    was_created = True
                if was_created:
                    created += 1
                    team_created += 1
                else:
                    needs_save = False
                    if transaction.from_team_id != getattr(from_team, "id", None):
                        transaction.from_team = from_team
                        needs_save = True
                    if transaction.to_team_id != getattr(to_team, "id", None):
                        transaction.to_team = to_team
                        needs_save = True
                    if transaction.description != description:
                        transaction.description = description
                        needs_save = True
                    if transaction.season != season:
                        transaction.season = season
                        needs_save = True
                    if needs_save:
                        transaction.save(
                            using="nfl",
                            update_fields=[
                                "from_team",
                                "to_team",
                                "description",
                                "season",
                            ],
                        )
                        updated += 1
                        team_updated += 1

                state_team = to_team or from_team or fallback_team
                last_state_date = latest_state_date_by_player.get(player.id)
                if state_team is not None and (
                    last_state_date is None or entry.occurred_on >= last_state_date
                ):
                    _apply_player_state(player, transaction_type, state_team)
                    latest_state_date_by_player[player.id] = entry.occurred_on

            self.stdout.write(
                f"[{label}] rows={len(entries)} matched={team_matched} "
                f"unmatched={team_unmatched} created={team_created} "
                f"updated={team_updated} skipped={team_skipped}"
            )

        def _enrich_signed_transactions_with_contracts(
            entries: list[ParsedSpotracFreeAgentContract],
        ) -> None:
            nonlocal updated, matched, unmatched, skipped

            enriched = 0
            contract_unmatched = 0
            contract_skipped = 0

            for entry in entries:
                player = _match_player(
                    entry.player_name, entry.position, players_by_key
                )
                if not player:
                    unmatched += 1
                    contract_unmatched += 1
                    logger.warning(
                        "Spotrac free-agent contract unmatched: %s (%s → %s)",
                        entry.player_name,
                        entry.from_team_abbr,
                        entry.to_team_abbr,
                    )
                    continue

                from_team = all_teams_by_abbr.get(entry.from_team_abbr or "")
                to_team = all_teams_by_abbr.get(entry.to_team_abbr or "")
                if not to_team or not _touches_requested_team(
                    player, from_team, to_team
                ):
                    continue

                transaction = (
                    PlayerTransaction.objects.using("nfl")
                    .filter(
                        player=player,
                        season=season,
                        transaction_type__in=[
                            "signed",
                            "signed_ps",
                            "claimed",
                            "traded",
                        ],
                        to_team=to_team,
                    )
                    .order_by("-date", "-created_at")
                    .first()
                )
                if not transaction:
                    contract_skipped += 1
                    skipped += 1
                    logger.info(
                        "Spotrac free-agent contract skipped; no signed transaction found for %s to %s",
                        entry.player_name,
                        to_team.abbreviation,
                    )
                    continue

                fields_to_update: list[str] = []
                if from_team is not None and transaction.from_team_id != from_team.id:
                    transaction.from_team = from_team
                    fields_to_update.append("from_team")
                if transaction.contract_years != entry.years:
                    transaction.contract_years = entry.years
                    fields_to_update.append("contract_years")
                if transaction.contract_total_value != entry.total_value:
                    transaction.contract_total_value = entry.total_value
                    fields_to_update.append("contract_total_value")
                if transaction.contract_apy != entry.apy:
                    transaction.contract_apy = entry.apy
                    fields_to_update.append("contract_apy")
                if transaction.contract_guaranteed != entry.guaranteed:
                    transaction.contract_guaranteed = entry.guaranteed
                    fields_to_update.append("contract_guaranteed")

                if not fields_to_update:
                    continue

                if dry_run:
                    self.stdout.write(
                        f"[FREE AGENTS] {entry.player_name} {entry.years or '?'} yrs "
                        f"{entry.total_value or 0} to {entry.to_team_abbr}"
                    )
                    continue

                transaction.save(using="nfl", update_fields=fields_to_update)
                updated += 1
                matched += 1
                enriched += 1

            self.stdout.write(
                f"[FREE AGENTS] rows={len(entries)} enriched={enriched} "
                f"unmatched={contract_unmatched} skipped={contract_skipped}"
            )

        def _fetch(url: str) -> requests.Response:
            # (connect_timeout, read_timeout): read timeout resets per chunk, so
            # 45 s covers drip-feed responses without a separate thread-pool hack.
            return session.get(url, timeout=(10, 45))

        if global_only:
            self.stdout.write("--global-only: skipping per-team pages")
        else:
            for team in teams:
                team_code = _spotrac_team_code(team)
                source_url = SPOTRAC_TRANSACTIONS_URL.format(team_code=team_code)
                try:
                    resp = _fetch(source_url)
                    resp.raise_for_status()
                except (requests.RequestException, requests.Timeout) as exc:
                    self.stderr.write(
                        self.style.ERROR(
                            f"[{team.abbreviation}] failed to fetch Spotrac: {exc}"
                        )
                    )
                    continue

                entries = _extract_spotrac_transactions(source_url, resp.text, season)
                _process_entries(entries, team, team.abbreviation)
                time.sleep(0.1)

        try:
            resp = _fetch(SPOTRAC_ALL_TRANSACTIONS_URL)
            resp.raise_for_status()
        except (requests.RequestException, requests.Timeout) as exc:
            self.stderr.write(
                self.style.ERROR(f"[GLOBAL] failed to fetch Spotrac: {exc}")
            )
        else:
            global_entries = _extract_spotrac_transactions(
                SPOTRAC_ALL_TRANSACTIONS_URL, resp.text, season
            )
            _process_entries(global_entries, None, "GLOBAL")

        try:
            resp = _fetch(SPOTRAC_FREE_AGENTS_URL)
            resp.raise_for_status()
        except (requests.RequestException, requests.Timeout) as exc:
            self.stderr.write(
                self.style.ERROR(f"[FREE AGENTS] failed to fetch Spotrac: {exc}")
            )
        else:
            free_agent_contracts = _extract_spotrac_free_agent_contracts(
                SPOTRAC_FREE_AGENTS_URL, resp.text
            )
            _enrich_signed_transactions_with_contracts(free_agent_contracts)

        summary = (
            f"sync_spotrac_transactions complete: teams={len(teams)}, matched={matched}, "
            f"unmatched={unmatched}, created={created}, updated={updated}, skipped={skipped}"
        )
        self.stdout.write(self.style.SUCCESS(summary))
