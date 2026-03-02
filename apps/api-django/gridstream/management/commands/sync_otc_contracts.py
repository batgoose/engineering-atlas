"""
Management command: sync_otc_contracts

Scrapes per-player contract pages from overthecap.com to populate:
  1. PlayerContract aggregate fields (year_signed, years, total_value, apy,
     guaranteed, is_active, team, otc_url, contract_type)
  2. PlayerContract.year_details — per-year cap hit breakdown

Data sources per player page:
  - Table class "contract salary-cap-history player-new" → year_details for
    all contracts (base salary, prorated bonus, cap number, etc.)
  - Table class "sortable" with "Year Signed" column → aggregate contract list
    (year_signed, years, total, apy, guarantees, status, team)

Run enrich_players first to populate Player.otc_id from nflverse CSVs, then
run this command to add full per-year breakdowns. Safe to re-run (uses
update_or_create). Processes ~9 000 players at ~1.5 s/request ≈ 4 hours for
a full run; use --active-only for just the ~2 000 active roster players.

Usage:
    python manage.py sync_otc_contracts
    python manage.py sync_otc_contracts --player-id <db_pk>
    python manage.py sync_otc_contracts --otc-id <otc_id>
    python manage.py sync_otc_contracts --active-only
    python manage.py sync_otc_contracts --dry-run
    python manage.py sync_otc_contracts --delay 1.5
    python manage.py sync_otc_contracts --limit 50
"""

import logging
import re
import time
from html.parser import HTMLParser

import requests
from django.core.management.base import BaseCommand

from gridstream.models import Player, PlayerContract, Team

logger = logging.getLogger(__name__)

OTC_BASE = "https://overthecap.com"
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

# ── Cap history table column name → year_detail field key ─────────────────────
#   Handles both "salary-cap-history" and "current-contract" column names
_CAP_COLS: dict[str, str | None] = {
    "year": "year",
    "team": "team",
    "base salary": "base_salary",
    "prorated bonus": "signing_bonus",
    "prorated signing bonus": "signing_bonus",
    "roster bonus": "roster_bonus",
    "regular roster bonus": "roster_bonus",
    "per game roster bonus": "per_game_roster_bonus",
    "workout bonus": "workout_bonus",
    "other bonus": "other_bonus",
    "guaranteed salary": "guaranteed_salary",
    "cap number": "cap_hit",
    "cap %": "cap_pct",
    "cap%": "cap_pct",
    "cash paid": "cash_paid",
    # spacers / dead money (skip)
    "": None,
    "dead money & cap savings": None,
}

# ── Contract overview table column name → parsed field key ───────────────────
_CONTRACT_COLS: dict[str, str | None] = {
    "team": "team",
    "contract type": "contract_type",
    "status": "status",
    "year signed": "year_signed",
    "yrs": "years",
    "total": "total_value",
    "apy": "apy",
    "guarantees": "guaranteed",
    # ignore the rest
    "amount earned": None,
    "% earned": None,
    "effective apy": None,
}

# Statuses OTC uses for active contracts
_ACTIVE_STATUSES = {"active", "restructured", "extension", "renegotiated"}

# Dead money / cap savings scenario class names on OTC
_DEAD_MONEY_SCENARIOS = ("cut", "june_1_cut", "trade", "june_1_trade", "restructure", "extension")


def _parse_scenario_cell(cell_html: str) -> dict[str, int]:
    """
    Parse a dead money or cap savings <td> containing hidden per-scenario <div>s.

    OTC HTML structure (each div is hidden by default, JS toggles visibility):
        <div class="cut" style="display:none;">$35,000,000</div>
        <div class="june_1_cut" style="display:none;">$22,500,000</div>
        ...
    Negative cap savings are wrapped in <span class="over-the-cap">($10,400,000)</span>.

    Returns {scenario: int} — negative values where applicable.
    """
    values: dict[str, int] = {}
    for scenario in _DEAD_MONEY_SCENARIOS:
        m = re.search(
            rf'<div[^>]*\bclass="{re.escape(scenario)}"[^>]*>(.*?)</div>',
            cell_html,
            re.DOTALL | re.IGNORECASE,
        )
        if not m:
            continue
        inner = m.group(1)
        is_negative = "over-the-cap" in inner
        digits = re.sub(r"[^0-9]", "", inner)
        if digits:
            values[scenario] = -int(digits) if is_negative else int(digits)
        else:
            values[scenario] = 0
    return values


def _parse_dead_money_from_html(html: str) -> dict[int, dict]:
    """
    Extract dead money and cap savings per year from the current-contract table.

    The current-contract table (class="contract current-contract player-new") has
    <td class="player-transactions player-dead-money"> and
    <td class="player-transactions player-cap-savings"> cells containing hidden divs
    for each of the 6 transaction scenarios. All data is in the static HTML;
    JavaScript only toggles which div is visible.

    Returns {year: {"dead_money": {scenario: int}, "cap_savings": {scenario: int}}}.
    """
    # OTC sometimes has "current-contract" AND "salary-cap-history" on same page.
    # We only want the current-contract table for dead money cells.
    table_m = re.search(
        r'<table[^>]*\bclass="[^"]*current-contract[^"]*"[^>]*>(.*?)</table>',
        html,
        re.DOTALL | re.IGNORECASE,
    )
    if not table_m:
        return {}

    result: dict[int, dict] = {}
    table_html = table_m.group(1)

    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, re.DOTALL):
        # Find the year — first <td> whose text starts with a 4-digit year.
        # Cells may contain trailing spans (e.g. guarantee-date notes), so we
        # match the year at the START of cell content rather than requiring it
        # to be the only content.
        year_m = re.search(r"<td[^>]*>\s*((?:19|20)\d{2})\b", row_html)
        if not year_m:
            continue
        year = int(year_m.group(1))

        dead_m = re.search(
            r'<td[^>]*class="[^"]*player-dead-money[^"]*"[^>]*>(.*?)</td>',
            row_html,
            re.DOTALL,
        )
        save_m = re.search(
            r'<td[^>]*class="[^"]*player-cap-savings[^"]*"[^>]*>(.*?)</td>',
            row_html,
            re.DOTALL,
        )

        dead = _parse_scenario_cell(dead_m.group(1)) if dead_m else {}
        savings = _parse_scenario_cell(save_m.group(1)) if save_m else {}

        if dead or savings:
            result[year] = {"dead_money": dead, "cap_savings": savings}

    return result


# =============================================================================
# HTML PARSER — extracts all tables with CSS class annotation
# =============================================================================


class _TableParser(HTMLParser):
    """
    Extracts all <table> elements from HTML and annotates each with its CSS class.

    Features:
    - Only uses the FIRST <tr> in <thead> for column headers (handles rowspan)
    - Treats opening <tbody> as implicit </thead> (handles OTC's malformed HTML)
    - Captures team abbreviation from <a class="team-link TEN"> inside cells
    - Accumulates text across nested inline tags (<span>, <a>, <br> etc.)
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables: list[dict] = []
        self._in_table = False
        self._table_class = ""
        self._in_thead = False
        self._in_tbody = False
        self._header_row_idx = 0   # increments per <tr> inside <thead>
        self._in_cell = False
        self._cell_buf = ""
        self._cell_team_abbr = ""  # extracted from team-link CSS class
        self._headers: list[str] = []
        self._current_row: list[str] = []
        self._body_rows: list[list[str]] = []

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if tag == "table":
            self._in_table = True
            self._table_class = attr.get("class", "")
            self._headers = []
            self._body_rows = []
            self._header_row_idx = 0
            self._in_thead = False
            self._in_tbody = False
        elif tag == "thead":
            # Reset on nested/duplicate <thead> (OTC has malformed HTML)
            if not self._in_tbody:
                self._in_thead = True
        elif tag == "tbody":
            self._in_thead = False   # implicit </thead>
            self._in_tbody = True
        elif tag == "tr" and self._in_table:
            if self._in_thead and not self._in_tbody:
                self._header_row_idx += 1
            self._current_row = []
        elif tag in ("th", "td"):
            self._in_cell = True
            self._cell_buf = ""
            self._cell_team_abbr = ""
        elif tag == "a" and self._in_cell:
            cls = attr.get("class", "")
            m = re.search(r"\bteam-link\s+([A-Z0-9]+)\b", cls)
            if m:
                self._cell_team_abbr = m.group(1)
        elif tag == "br" and self._in_cell:
            self._cell_buf += " "

    def handle_endtag(self, tag):
        if tag == "table":
            if self._headers:
                self.tables.append(
                    {
                        "class": self._table_class,
                        "headers": self._headers,
                        "rows": self._body_rows,
                    }
                )
            self._in_table = False
            self._in_thead = False
            self._in_tbody = False
        elif tag == "thead":
            self._in_thead = False
        elif tag == "tbody":
            self._in_tbody = False
        elif tag == "th":
            # Only collect headers from the first thead row (skip rowspan sub-rows)
            if self._in_thead and self._header_row_idx == 1:
                self._headers.append(self._cell_buf.strip())
            self._in_cell = False
        elif tag == "td":
            val = self._cell_team_abbr if self._cell_team_abbr else self._cell_buf.strip()
            self._current_row.append(val)
            self._in_cell = False
        elif tag == "tr" and self._in_table:
            if self._current_row and self._in_tbody:
                self._body_rows.append(self._current_row)
            self._current_row = []

    def handle_data(self, data):
        if self._in_cell:
            self._cell_buf += data


def _extract_tables(html: str) -> list[dict]:
    parser = _TableParser()
    parser.feed(html)
    return parser.tables


# =============================================================================
# TABLE IDENTIFICATION
# =============================================================================


def _find_cap_history_table(tables: list[dict]) -> dict | None:
    """
    Primary per-year data: <table class="contract salary-cap-history player-new">
    Falls back to current-contract table if no history table present.
    """
    for t in tables:
        if "salary-cap-history" in t.get("class", ""):
            return t
    for t in tables:
        if "current-contract" in t.get("class", ""):
            return t
    return None


def _find_contract_overview_table(tables: list[dict]) -> dict | None:
    """
    Aggregate contract list: the 'sortable' table that has a 'Year Signed' column.
    OTC pages have multiple sortable tables; pick the one with contract summary data.
    """
    for t in tables:
        cls = t.get("class", "")
        if "sortable" not in cls or "salary-cap-history" in cls:
            continue
        headers_lower = [h.lower().strip() for h in t["headers"]]
        # Must have year_signed and a contract size indicator
        has_year = any("year" in h and "sign" in h for h in headers_lower) or "year signed" in headers_lower
        has_total = "total" in headers_lower or "apy" in headers_lower
        if has_year and has_total:
            return t
    return None


# =============================================================================
# ROW PARSING HELPERS
# =============================================================================


def _parse_dollars(val: str) -> int:
    """'$1,500,000' → 1500000 ; '-' or '' → 0"""
    if not val or val.strip() in ("-", "–", "—", "N/A", ""):
        return 0
    cleaned = re.sub(r"[^0-9]", "", val)
    return int(cleaned) if cleaned else 0


def _safe_int(val) -> int | None:
    if val is None:
        return None
    try:
        return int(str(val).strip().replace(",", ""))
    except (ValueError, TypeError):
        return None


def _parse_cap_history_rows(table: dict) -> list[dict]:
    """
    Convert salary-cap-history table rows into year_detail dicts.
    Skips aggregate rows (totals) and rows without a valid year.
    """
    headers = [h.lower().strip() for h in table["headers"]]
    col_map = [_CAP_COLS.get(h) for h in headers]  # field name or None per column

    details: list[dict] = []
    for row in table["rows"]:
        detail: dict = {}
        for i, field in enumerate(col_map):
            if field is None or i >= len(row):
                continue
            val = row[i].strip()
            if field == "year":
                yr = _safe_int(val)
                if yr is None or yr < 1990 or yr > 2040:
                    break   # not a real year row; skip entire row
                detail["year"] = yr
            elif field == "team":
                detail["team"] = val
            elif field == "cap_pct":
                try:
                    detail["cap_pct"] = float(val.replace("%", "").strip())
                except ValueError:
                    pass
            else:
                detail[field] = _parse_dollars(val)

        if "year" in detail:
            details.append(detail)

    return details


def _parse_contract_overview_rows(table: dict) -> list[dict]:
    """
    Parse the contract history overview table into aggregate contract records.
    Returns list of dicts: {team, year_signed, years, total_value, apy,
                             guaranteed, status, contract_type}
    """
    headers = [h.lower().strip() for h in table["headers"]]
    col_map = [_CONTRACT_COLS.get(h) for h in headers]

    contracts: list[dict] = []
    for row in table["rows"]:
        c: dict = {}
        for i, field in enumerate(col_map):
            if field is None or i >= len(row):
                continue
            val = row[i].strip()
            if field in ("year_signed", "years"):
                c[field] = _safe_int(val)
            elif field in ("total_value", "apy", "guaranteed"):
                c[field] = _parse_dollars(val)
            else:
                c[field] = val
        if c.get("year_signed") and c.get("total_value"):
            contracts.append(c)

    return contracts


# =============================================================================
# CONTRACT MATCHING — assign year_details rows to the right contract
# =============================================================================


def _assign_year_details(
    overview_contracts: list[dict],
    cap_history_rows: list[dict],
) -> list[dict]:
    """
    Match each cap_history row to an overview contract by year range.

    Strategy: for each cap_history year, assign it to the contract whose
    year_signed is the largest value that is still ≤ the cap row's year.
    This handles restructures / extensions correctly.
    """
    if not overview_contracts:
        # No overview: treat all rows as a single contract
        if cap_history_rows:
            min_year = min(r["year"] for r in cap_history_rows)
            return [
                {
                    "year_signed": min_year,
                    "years": len({r["year"] for r in cap_history_rows}),
                    "total_value": 0,
                    "apy": 0,
                    "guaranteed": None,
                    "team": cap_history_rows[0].get("team", ""),
                    "status": "",
                    "contract_type": "",
                    "year_details": cap_history_rows,
                }
            ]
        return []

    # Sort contracts descending by year_signed
    sorted_ov = sorted(overview_contracts, key=lambda c: c.get("year_signed", 0), reverse=True)

    # Build result: enrich each overview contract with its year_details
    result = []
    for ov in sorted_ov:
        ov = dict(ov)
        ov.setdefault("year_details", [])
        result.append(ov)

    # Assign each cap row to the newest contract that started before or during it
    for row in cap_history_rows:
        row_year = row["year"]
        assigned = False
        for c in result:
            if (c.get("year_signed") or 0) <= row_year:
                c["year_details"].append(row)
                assigned = True
                break
        if not assigned and result:
            result[-1]["year_details"].append(row)

    return result


# =============================================================================
# URL HELPERS
# =============================================================================


def _name_to_slug(display_name: str) -> str:
    """'Jayden Daniels' → 'jayden-daniels', 'D.J. Moore' → 'dj-moore'"""
    name = display_name.lower().strip()
    name = re.sub(r"\s+(?:jr\.?|sr\.?|ii|iii|iv|v)$", "", name)
    name = re.sub(r"\.(?!\s)", "", name)           # collapse dots (D.J. → dj)
    name = re.sub(r"[^a-z0-9]+", "-", name)
    return name.strip("-")


def _player_otc_url(player: Player) -> str | None:
    existing = (
        PlayerContract.objects.using("nfl")
        .filter(player=player)
        .exclude(otc_url="")
        .values_list("otc_url", flat=True)
        .first()
    )
    if existing:
        return existing

    if player.otc_id:
        slug = _name_to_slug(player.display_name)
        return f"{OTC_BASE}/player/{slug}/{player.otc_id}/"

    return None


# =============================================================================
# MAIN COMMAND
# =============================================================================


class Command(BaseCommand):
    help = "Scrape per-year contract details from overthecap.com"

    def add_arguments(self, parser):
        parser.add_argument(
            "--player-id",
            type=int,
            metavar="PK",
            help="Only sync a single player by database PK",
        )
        parser.add_argument(
            "--otc-id",
            metavar="OTC_ID",
            help="Only sync a single player by their OTC ID",
        )
        parser.add_argument(
            "--active-only",
            action="store_true",
            help="Only process players currently on a roster (~2 000 players)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and print what would be saved; do not write to DB",
        )
        parser.add_argument(
            "--delay",
            type=float,
            default=1.5,
            metavar="SECS",
            help="Seconds between OTC requests (default: 1.5)",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            metavar="N",
            help="Stop after N players processed (0 = no limit)",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        delay = options["delay"]
        limit = options["limit"]

        if dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN — nothing will be saved\n"))

        teams = {t.abbreviation: t for t in Team.objects.using("nfl").all()}

        qs = (
            Player.objects.using("nfl")
            .exclude(otc_id="")
            .filter(otc_id__isnull=False)
        )
        if options["player_id"]:
            qs = qs.filter(pk=options["player_id"])
        elif options["otc_id"]:
            qs = qs.filter(otc_id=options["otc_id"])
        elif options["active_only"]:
            qs = qs.filter(is_active=True)

        qs = qs.order_by("last_name", "first_name")

        # Fetch PKs into memory up-front so the loop's update_or_create calls
        # don't conflict with a psycopg3 server-side cursor (iterator() always
        # opens one, and it gets invalidated when the inner writes commit).
        player_pks = list(qs.values_list("id", flat=True))
        total = len(player_pks)

        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"\n── OTC Contract Sync ── {total:,} players\n"
            )
        )

        session = requests.Session()
        session.headers.update(REQUEST_HEADERS)

        processed = 0
        contracts_created = 0
        contracts_updated = 0
        errors = 0

        for i, pk in enumerate(player_pks):
            player = Player.objects.using("nfl").get(pk=pk)
            if limit and processed >= limit:
                self.stdout.write(f"  Reached --limit {limit}, stopping.")
                break

            url = _player_otc_url(player)
            if not url:
                continue

            self.stdout.write(f"  [{i+1}/{total}] {player.display_name}  {url}")

            try:
                resp = session.get(url, timeout=30)
                if resp.status_code == 404:
                    self.stdout.write("    → 404, skipping")
                    errors += 1
                    time.sleep(delay)
                    continue
                if resp.status_code == 429:
                    wait = float(resp.headers.get("Retry-After", 60))
                    self.stdout.write(
                        self.style.WARNING(f"    → 429 rate limited, sleeping {wait:.0f}s")
                    )
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
            except requests.RequestException as exc:
                self.stdout.write(self.style.ERROR(f"    → Request error: {exc}"))
                errors += 1
                time.sleep(delay)
                continue

            try:
                tables = _extract_tables(resp.text)
                cap_table = _find_cap_history_table(tables)
                overview_table = _find_contract_overview_table(tables)

                if not cap_table:
                    self.stdout.write("    → no contract tables found")
                    time.sleep(delay)
                    continue

                cap_rows = _parse_cap_history_rows(cap_table)

                # Enrich cap rows with dead money / cap savings from current-contract table
                dead_money_by_year = _parse_dead_money_from_html(resp.text)
                for row in cap_rows:
                    dm = dead_money_by_year.get(row["year"])
                    if dm:
                        row["dead_money"] = dm["dead_money"]
                        row["cap_savings"] = dm["cap_savings"]

                overview_rows = _parse_contract_overview_rows(overview_table) if overview_table else []
                contracts = _assign_year_details(overview_rows, cap_rows)

                self.stdout.write(
                    f"    → {len(contracts)} contract(s), "
                    f"{len(cap_rows)} cap rows"
                )
            except Exception as exc:
                logger.exception("Parse error for %s: %s", player, exc)
                self.stdout.write(self.style.ERROR(f"    → Parse error: {exc}"))
                errors += 1
                time.sleep(delay)
                continue

            if not dry_run:
                cr, cu = self._save_contracts(player, contracts, teams, url)
                contracts_created += cr
                contracts_updated += cu
            else:
                self._print_dry_run(contracts)

            processed += 1
            time.sleep(delay)

        self.stdout.write(
            self.style.SUCCESS(
                f"\n── Done ──\n"
                f"  Players processed  : {processed:,}\n"
                f"  Contracts created  : {contracts_created:,}\n"
                f"  Contracts updated  : {contracts_updated:,}\n"
                f"  Errors / skipped   : {errors:,}\n"
            )
        )

    # =========================================================================
    # DB WRITE
    # =========================================================================

    def _save_contracts(
        self,
        player: Player,
        contracts: list[dict],
        teams: dict,
        otc_url: str,
    ) -> tuple[int, int]:
        created = 0
        updated = 0

        for c in contracts:
            year_signed = c.get("year_signed")
            if not year_signed:
                continue

            team_abbr = (c.get("team") or "").strip()
            team = teams.get(team_abbr)

            status = (c.get("status") or "").lower()
            is_active = status in _ACTIVE_STATUSES or status == ""

            year_details = c.get("year_details", [])

            # Derive total_value from year_details if not available from overview
            total_value = c.get("total_value") or 0
            if not total_value and year_details:
                total_value = sum(
                    d.get("base_salary", 0) + d.get("signing_bonus", 0)
                    + d.get("roster_bonus", 0) + d.get("other_bonus", 0)
                    + d.get("workout_bonus", 0)
                    for d in year_details
                )

            years = c.get("years") or len({d["year"] for d in year_details})
            apy = c.get("apy") or (total_value // years if years else 0)
            guaranteed = c.get("guaranteed")

            defaults: dict = {
                "is_active": is_active,
                "years": years or 1,
                "total_value": total_value,
                "apy": apy,
                "guaranteed": guaranteed or None,
                "year_details": year_details,
                "otc_url": otc_url,
            }
            if team:
                defaults["team"] = team

            try:
                _, was_created = PlayerContract.objects.using("nfl").update_or_create(
                    player=player,
                    year_signed=year_signed,
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                    self.stdout.write(
                        f"    + created: {team_abbr} {year_signed} "
                        f"{years}yr ${total_value:,} ({len(year_details)} rows)"
                    )
                else:
                    updated += 1
                    self.stdout.write(
                        f"    ↻ updated: {team_abbr} {year_signed} "
                        f"({len(year_details)} rows)"
                    )
            except Exception as exc:
                logger.error("DB error for %s contract %s: %s", player, year_signed, exc)
                self.stdout.write(self.style.ERROR(f"    → DB error ({year_signed}): {exc}"))

        # Enforce: a player can only have one active contract at a time.
        # OTC sometimes omits the status field for historical contracts, which
        # causes the empty-string fallback to mark them all as is_active=True.
        # After saving everything, keep only the most-recently-signed active
        # contract active and deactivate the rest.
        active_years = list(
            PlayerContract.objects.using("nfl")
            .filter(player=player, is_active=True)
            .order_by("-year_signed")
            .values_list("year_signed", flat=True)
        )
        if len(active_years) > 1:
            deactivated = (
                PlayerContract.objects.using("nfl")
                .filter(player=player, is_active=True)
                .exclude(year_signed=active_years[0])
                .update(is_active=False)
            )
            self.stdout.write(
                self.style.WARNING(
                    f"    ⚠ deactivated {deactivated} stale active contract(s) "
                    f"(kept {active_years[0]}, cleared {active_years[1:]})"
                )
            )

        return created, updated

    def _print_dry_run(self, contracts: list[dict]) -> None:
        for c in contracts:
            year_signed = c.get("year_signed", "?")
            team = c.get("team", "?")
            years = c.get("years", "?")
            total = c.get("total_value", 0)
            details = c.get("year_details", [])
            self.stdout.write(
                f"    [DRY RUN] {team} {year_signed} {years}yr "
                f"${total:,} — {len(details)} year rows"
            )
            for d in details:
                cap = d.get("cap_hit", 0)
                base = d.get("base_salary", 0)
                bonus = d.get("signing_bonus", 0)
                self.stdout.write(
                    f"      {d['year']} {d.get('team','?'):3s}  "
                    f"cap=${cap:>12,}  base=${base:>12,}  bonus=${bonus:>10,}"
                )
