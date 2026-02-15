"""
Management command: enrich_players

Bulk enriches Player records from nflverse data releases:
  1. nflverse players dataset — bio, IDs, draft, headshots (24K+ players)
  2. NFL Combine data — measurements and drill results (since 2000)
  3. OverTheCap contracts — contract terms and values

Downloads CSVs directly from nflverse GitHub releases. No API keys needed.
Safe to run repeatedly (uses update_or_create).

Usage:
    python manage.py enrich_players
    python manage.py enrich_players --skip-combine --skip-contracts
    python manage.py enrich_players --players-only
"""

import csv
import gzip
import io
import logging
from datetime import datetime

import requests
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from gridstream.models import (
    Player,
    PlayerCombine,
    PlayerContract,
    Team,
)

logger = logging.getLogger(__name__)

# ─── nflverse data URLs ─────────────────────────────────────────────────────
PLAYERS_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/" "players/players.csv"
)
COMBINE_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/" "combine/combine.csv"
)
CONTRACTS_URLS = [
    "https://github.com/nflverse/nflverse-data/releases/download/contracts/otc_contracts.csv.gz",
    "https://github.com/nflverse/nflverse-data/releases/download/contracts/contracts.csv.gz",
    "https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.csv.gz",
    "https://github.com/nflverse/nflverse-data/releases/download/contracts/otc_contracts.csv",
    "https://github.com/nflverse/nflverse-data/releases/download/contracts/contracts.csv",
]


def _fetch_csv(url, label):
    """Download a CSV (or .csv.gz) and return a list of dicts."""
    print(f"  Downloading {label}...")
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()

    if url.endswith(".gz"):
        raw = gzip.decompress(resp.content)
        text = raw.decode("utf-8-sig")
    else:
        text = resp.content.decode("utf-8-sig")  # handle BOM

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    print(f"  Got {len(rows):,} rows")
    return rows


def _safe_int(val):
    if val is None or val == "" or val == "NA":
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def _safe_float(val):
    if val is None or val == "" or val == "NA":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _safe_str(val, max_len=None):
    if val is None or val == "NA":
        return ""
    val = str(val).strip()
    if max_len:
        val = val[:max_len]
    return val


def _parse_date(val):
    if not val or val == "NA":
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(val.strip(), fmt).date()
        except ValueError:
            continue
    return None


class Command(BaseCommand):
    help = "Enrich players from nflverse players, combine, and contracts data"

    def add_arguments(self, parser):
        parser.add_argument(
            "--players-only",
            action="store_true",
            help="Only run the players enrichment, skip combine and contracts",
        )
        parser.add_argument(
            "--skip-combine",
            action="store_true",
            help="Skip combine data import",
        )
        parser.add_argument(
            "--skip-contracts",
            action="store_true",
            help="Skip contracts data import",
        )

    def handle(self, *args, **options):
        players_only = options["players_only"]
        skip_combine = options["skip_combine"] or players_only
        skip_contracts = options["skip_contracts"] or players_only

        # Build team lookup
        teams = {t.abbreviation: t for t in Team.objects.using("nfl").all()}

        # Phase 1: Players enrichment
        self._enrich_players(teams)

        # Phase 2: Combine
        if not skip_combine:
            self._import_combine(teams)

        # Phase 3: Contracts
        if not skip_contracts:
            self._import_contracts(teams)

        self.stdout.write(self.style.SUCCESS("\nAll enrichment complete!"))

    # =========================================================================
    # PHASE 1: PLAYERS (bio, IDs, draft, headshots)
    # =========================================================================
    def _enrich_players(self, teams):
        self.stdout.write(self.style.MIGRATE_HEADING("\n── Players Enrichment ──"))
        rows = _fetch_csv(PLAYERS_URL, "nflverse players")

        updated = 0
        created = 0
        skipped = 0

        for row in rows:
            gsis_id = _safe_str(row.get("gsis_id"))
            if not gsis_id:
                skipped += 1
                continue

            # Resolve team
            team_abbr = _safe_str(row.get("team_abbr"))
            current_team = teams.get(team_abbr)

            # Resolve draft team
            draft_team_abbr = _safe_str(row.get("draft_club"))
            draft_team = teams.get(draft_team_abbr)

            # Parse height — nflverse stores as integer inches
            height_inches = _safe_int(row.get("height"))
            height_str = ""
            if height_inches:
                feet = height_inches // 12
                inches = height_inches % 12
                height_str = f"{feet}-{inches}"

            # Build position
            position = _safe_str(row.get("position"), 5) or "DB"
            # Validate it's in our choices
            valid_positions = {c[0] for c in Player.POSITION_CHOICES}
            if position not in valid_positions:
                position = "DB"  # fallback

            position_group = _safe_str(row.get("position_group"), 5)
            valid_groups = {c[0] for c in Player.POSITION_GROUP_CHOICES}
            if position_group not in valid_groups:
                position_group = ""

            # Determine roster status
            status = _safe_str(row.get("status"), 5)
            valid_statuses = {c[0] for c in Player.STATUS_CHOICES}
            if status not in valid_statuses:
                status = ""

            # Draft info
            draft_year = _safe_int(row.get("draft_year"))
            draft_round = _safe_int(row.get("draft_round"))
            draft_pick = _safe_int(row.get("draft_pick"))
            # nflverse draft_pick is actually overall pick
            draft_overall = draft_pick
            is_undrafted = (draft_year is None) and bool(
                _safe_int(row.get("rookie_season"))
            )

            defaults = {
                "first_name": _safe_str(row.get("first_name"), 50),
                "last_name": _safe_str(row.get("last_name"), 50),
                "display_name": _safe_str(row.get("display_name"), 80),
                "short_name": _safe_str(row.get("short_name"), 30),
                "suffix": _safe_str(row.get("suffix"), 10),
                "position": position,
                "position_group": position_group,
                "current_team": current_team,
                "roster_status": status,
                "headshot_url": _safe_str(row.get("headshot"), 500),
                "height": height_str,
                "height_inches": height_inches,
                "weight": _safe_int(row.get("weight")),
                "birth_date": _parse_date(row.get("birth_date")),
                "college": _safe_str(row.get("college_name"), 60),
                "college_conference": _safe_str(row.get("college_conference"), 30),
                "draft_year": draft_year,
                "draft_round": draft_round,
                "draft_pick": draft_pick,
                "draft_overall": draft_overall,
                "draft_team": draft_team,
                "is_undrafted": is_undrafted,
                "rookie_season": _safe_int(row.get("rookie_season")),
                "entry_year": _safe_int(row.get("entry_year")),
                "years_experience": _safe_int(row.get("years_of_experience")),
                "jersey_number": _safe_str(row.get("jersey_number"), 3),
                "is_active": status in ("ACT", "PRA", "RES", "PUP", ""),
                # Cross-platform IDs
                "espn_id": _safe_str(row.get("espn_id"), 20),
                "pfr_id": _safe_str(row.get("pfr_id"), 20),
                "pff_id": _safe_str(row.get("pff_id"), 20),
                "otc_id": _safe_str(row.get("otc_id"), 20),
                "esb_id": _safe_str(row.get("esb_id"), 20),
                "smart_id": _safe_str(row.get("smart_id"), 50),
            }

            _, was_created = Player.objects.using("nfl").update_or_create(
                gsis_id=gsis_id,
                defaults=defaults,
            )

            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"  Players: {created} created, {updated} updated, "
                f"{skipped} skipped (no gsis_id)"
            )
        )

    # =========================================================================
    # PHASE 2: COMBINE
    # =========================================================================
    def _import_combine(self, teams):
        self.stdout.write(self.style.MIGRATE_HEADING("\n── Combine Data ──"))
        rows = _fetch_csv(COMBINE_URL, "combine data")

        # Build player lookup by pfr_id (combine data uses pfr_id)
        # Also try by name+draft_year as fallback
        players_by_pfr = {}
        players_by_name_year = {}
        for p in Player.objects.using("nfl").only(
            "id", "pfr_id", "display_name", "draft_year"
        ):
            if p.pfr_id:
                players_by_pfr[p.pfr_id] = p
            if p.draft_year:
                key = (p.display_name.lower(), p.draft_year)
                players_by_name_year[key] = p

        created = 0
        skipped = 0

        for row in rows:
            season = _safe_int(row.get("season"))
            if not season:
                skipped += 1
                continue

            # Match player — try pfr_id first, then name+year
            pfr_id = _safe_str(row.get("pfr_id"))
            player = players_by_pfr.get(pfr_id)

            if not player:
                name = _safe_str(row.get("player_name"))
                if name:
                    player = players_by_name_year.get((name.lower(), season))

            if not player:
                skipped += 1
                continue

            # Resolve draft team
            draft_team_abbr = _safe_str(row.get("team"))
            draft_team = teams.get(draft_team_abbr)

            pos = _safe_str(row.get("pos"), 5) or "DB"

            _, was_created = PlayerCombine.objects.using("nfl").update_or_create(
                player=player,
                season=season,
                defaults={
                    "position": pos,
                    "height_inches": _safe_float(row.get("ht")),
                    "weight": _safe_int(row.get("wt")),
                    "arm_length": _safe_float(row.get("arm")),
                    "hand_size": _safe_float(row.get("hand")),
                    "forty_yard": _safe_float(row.get("forty")),
                    "twenty_yard_split": _safe_float(row.get("twenty")),
                    "ten_yard_split": _safe_float(row.get("ten")),
                    "bench_press": _safe_int(row.get("bench")),
                    "vertical_jump": _safe_float(row.get("vertical")),
                    "broad_jump": _safe_int(row.get("broad_jump")),
                    "three_cone": _safe_float(row.get("cone")),
                    "shuttle": _safe_float(row.get("shuttle")),
                    "draft_round": _safe_int(row.get("draft_round")),
                    "draft_overall": _safe_int(row.get("draft_ovr")),
                    "draft_team": draft_team,
                    "pfr_url": _safe_str(row.get("pfr_url"), 500),
                },
            )

            if was_created:
                created += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"  Combine: {created} created, {skipped} skipped (no match)"
            )
        )

    # =========================================================================
    # PHASE 3: CONTRACTS
    # =========================================================================
    def _import_contracts(self, teams):
        self.stdout.write(self.style.MIGRATE_HEADING("\n── Contracts Data ──"))

        # Try each possible URL until one works
        rows = None
        for url in CONTRACTS_URLS:
            try:
                rows = _fetch_csv(url, f"contracts ({url.split('/')[-1]})")
                break
            except requests.exceptions.HTTPError:
                self.stdout.write(f"  {url.split('/')[-1]} not found, trying next...")
                continue

        if not rows:
            self.stdout.write(
                self.style.WARNING(
                    "  Could not find contracts data at any known URL. "
                    "Skipping contracts import. You can run with --skip-contracts "
                    "or check nflverse releases for the correct filename."
                )
            )
            return

        # Build player lookup by otc_id and gsis_id
        players_by_otc = {}
        players_by_gsis = {}
        for p in Player.objects.using("nfl").only("id", "otc_id", "gsis_id"):
            if p.otc_id:
                players_by_otc[p.otc_id] = p
            players_by_gsis[p.gsis_id] = p

        created = 0
        updated = 0
        skipped = 0

        for row in rows:
            year_signed = _safe_int(row.get("year_signed"))
            if not year_signed:
                skipped += 1
                continue

            # Match player
            otc_id = _safe_str(row.get("otc_id"))
            gsis_id = _safe_str(row.get("gsis_id"))

            player = None
            if otc_id:
                player = players_by_otc.get(otc_id)
            if not player and gsis_id:
                player = players_by_gsis.get(gsis_id)

            if not player:
                skipped += 1
                continue

            # Resolve team
            team_abbr = _safe_str(row.get("team"))
            # OTC uses "team/team" format for mid-contract trades
            if "/" in team_abbr:
                team_abbr = team_abbr.split("/")[0].strip()
            team = teams.get(team_abbr)

            years = _safe_int(row.get("years"))
            total_value = _safe_int(row.get("value"))
            apy = _safe_int(row.get("apy"))
            guaranteed = _safe_int(row.get("guaranteed"))

            if not years or not total_value:
                skipped += 1
                continue

            # Determine if contract is active
            is_active_str = _safe_str(row.get("is_active")).lower()
            is_active = is_active_str in ("true", "1", "yes")

            _, was_created = PlayerContract.objects.using("nfl").update_or_create(
                player=player,
                year_signed=year_signed,
                team=team,
                defaults={
                    "is_active": is_active,
                    "years": years,
                    "total_value": total_value,
                    "apy": apy or 0,
                    "guaranteed": guaranteed,
                    "apy_cap_pct": _safe_float(row.get("apy_cap_pct")),
                    "inflated_value": _safe_int(row.get("inflated_value")),
                    "inflated_apy": _safe_int(row.get("inflated_apy")),
                    "inflated_guaranteed": _safe_int(row.get("inflated_guaranteed")),
                    "otc_url": _safe_str(row.get("player_page"), 500),
                },
            )

            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"  Contracts: {created} created, {updated} updated, "
                f"{skipped} skipped"
            )
        )
