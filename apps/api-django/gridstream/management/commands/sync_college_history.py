"""
Sync player college history from Wikidata.

Source:
  - Wikidata Pro Football Reference player ID (P3561)
  - Wikidata educated at (P69), with optional start/end qualifiers

This command stores college stints in PlayerCollegeHistory and supports
multiple schools (transfer history). It excludes high schools.

Usage:
    python manage.py sync_college_history
    python manage.py sync_college_history --all
    python manage.py sync_college_history --limit 500
    python manage.py sync_college_history --dry-run
"""

import logging
import re
from collections import defaultdict

import requests
from django.db import transaction

from gridstream.models import Player, PlayerCollegeHistory

from ._base import ImportBaseCommand

logger = logging.getLogger(__name__)

_SPARQL_URL = "https://query.wikidata.org/sparql"
_USER_AGENT = "engineering-atlas-gridstream/1.0 (+https://github.com/jbooth/engineering-atlas)"


def _norm(value: str) -> str:
    value = (value or "").strip().lower()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _extract_year(value: str | None) -> int | None:
    if not value:
        return None
    match = re.match(r"(\d{4})", value.strip())
    if not match:
        return None
    return int(match.group(1))


def _chunked(values: list[str], size: int):
    for i in range(0, len(values), size):
        yield values[i : i + size]


class Command(ImportBaseCommand):
    help = "Sync player college history from Wikidata by Pro Football Reference ID."

    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.add_argument(
            "--all",
            action="store_true",
            help="Sync all players with pfr_id (default: only active players).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Limit number of players to process (debug).",
        )
        parser.add_argument(
            "--chunk-size",
            type=int,
            default=25,
            help="Wikidata PFR-ID query chunk size (smaller is slower but more reliable).",
        )
        parser.set_defaults(batch_size=500)

    def handle(self, *args, **options):
        self.batch_size = options["batch_size"]
        self.dry_run = options["dry_run"]
        include_all = options["all"]
        limit = options["limit"]
        chunk_size = max(10, options["chunk_size"])

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        qs = Player.objects.using("nfl").exclude(pfr_id="")
        if not include_all:
            qs = qs.filter(is_active=True)
        if limit:
            qs = qs[:limit]

        players = list(qs.only("id", "pfr_id", "college", "display_name"))
        if not players:
            self.stdout.write("No players with pfr_id found for sync.")
            return

        # pfr_id in our DB is just "MahoPa00"; Wikidata stores "M/MahoPa00".
        players_by_pfr: dict[str, list[Player]] = defaultdict(list)
        for player in players:
            players_by_pfr[player.pfr_id].append(player)

        self.stdout.write(f"Syncing college history for {len(players)} players...")

        rows_by_pfr: dict[str, list[dict]] = defaultdict(list)
        pfr_ids = sorted(players_by_pfr.keys())

        total_chunks = max(1, (len(pfr_ids) + chunk_size - 1) // chunk_size)
        for chunk_index, chunk in enumerate(_chunked(pfr_ids, chunk_size), start=1):
            rows = self._query_wikidata_chunk(chunk)
            for row in rows:
                pfr = row.get("pfr_id", "")
                if not pfr:
                    continue
                rows_by_pfr[pfr].append(row)
            if chunk_index == 1 or chunk_index == total_chunks or chunk_index % 25 == 0:
                self.stdout.write(f"  queried Wikidata chunks: {chunk_index}/{total_chunks}")

        players_updated = 0
        entries_created = 0
        players_without_data = 0

        for pfr_id, group in players_by_pfr.items():
            source_rows = rows_by_pfr.get(pfr_id, [])
            if not source_rows:
                players_without_data += len(group)
                continue

            for player in group:
                entries = self._build_entries_for_player(player, source_rows)
                if not entries:
                    players_without_data += 1
                    continue

                players_updated += 1
                entries_created += len(entries)

                if self.dry_run:
                    continue

                with transaction.atomic(using="nfl"):
                    PlayerCollegeHistory.objects.using("nfl").filter(player=player).delete()
                    PlayerCollegeHistory.objects.using("nfl").bulk_create(entries)

        self.stdout.write(
            self.style.SUCCESS(
                f"Done! {players_updated} players updated, {entries_created} college stints written."
            )
        )
        if players_without_data:
            self.stdout.write(
                self.style.WARNING(
                    f"  {players_without_data} players had no college-history rows from source."
                )
            )

    def _query_wikidata_chunk(self, pfr_ids: list[str]) -> list[dict]:
        values = " ".join(f'"{pfr}"' for pfr in pfr_ids)
        query = f"""
SELECT ?pfr_id ?collegeLabel ?start ?end WHERE {{
  VALUES ?pfr_id {{ {values} }}
  ?player wdt:P3561 ?pfr_ref .
  BIND(REPLACE(STR(?pfr_ref), "^.*/", "") AS ?pfr_id)
  ?player p:P69 ?eduStatement .
  ?eduStatement ps:P69 ?college .
  FILTER NOT EXISTS {{ ?college wdt:P31/wdt:P279* wd:Q159334 . }}
  OPTIONAL {{ ?eduStatement pq:P580 ?start . }}
  OPTIONAL {{ ?eduStatement pq:P582 ?end . }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
ORDER BY ?pfr_id ?start ?end
        """.strip()

        try:
            resp = requests.get(
                _SPARQL_URL,
                params={"query": query, "format": "json"},
                timeout=60,
                headers={"User-Agent": _USER_AGENT},
            )
            resp.raise_for_status()
        except Exception as exc:
            logger.warning("Wikidata query failed for chunk (%d ids): %s", len(pfr_ids), exc)
            return []

        rows = []
        for row in resp.json().get("results", {}).get("bindings", []):
            pfr = row.get("pfr_id", {}).get("value", "").strip()
            college = row.get("collegeLabel", {}).get("value", "").strip()
            if not pfr or not college:
                continue
            rows.append(
                {
                    "pfr_id": pfr,
                    "college": college,
                    "start_year": _extract_year(row.get("start", {}).get("value")),
                    "end_year": _extract_year(row.get("end", {}).get("value")),
                }
            )
        return rows

    def _build_entries_for_player(self, player: Player, rows: list[dict]) -> list[PlayerCollegeHistory]:
        # Deduplicate by normalized college name while preserving first/earliest years.
        dedup: dict[str, dict] = {}
        for row in rows:
            college_name = row["college"].strip()
            normalized = _norm(college_name)
            if not normalized:
                continue
            if "high school" in normalized:
                continue

            existing = dedup.get(normalized)
            if existing is None:
                dedup[normalized] = {
                    "college": college_name[:80],
                    "conference": "",
                    "start_year": row.get("start_year"),
                    "end_year": row.get("end_year"),
                }
                continue

            existing_start = existing.get("start_year")
            existing_end = existing.get("end_year")
            new_start = row.get("start_year")
            new_end = row.get("end_year")
            if existing_start is None and new_start is not None:
                existing["start_year"] = new_start
            elif (
                existing_start is not None
                and new_start is not None
                and new_start < existing_start
            ):
                existing["start_year"] = new_start
            if existing_end is None and new_end is not None:
                existing["end_year"] = new_end
            elif (
                existing_end is not None
                and new_end is not None
                and new_end > existing_end
            ):
                existing["end_year"] = new_end

        if not dedup:
            return []

        stints = list(dedup.values())
        stints.sort(
            key=lambda r: (
                r["start_year"] is None,
                r["start_year"] or 9999,
                r["end_year"] is None,
                r["end_year"] or 9999,
                r["college"],
            )
        )

        primary_norm = _norm(player.college)
        primary_index = -1
        if primary_norm:
            for idx, stint in enumerate(stints):
                if _norm(stint["college"]) == primary_norm:
                    primary_index = idx
                    break
        if primary_index < 0:
            primary_index = len(stints) - 1

        entries: list[PlayerCollegeHistory] = []
        for idx, stint in enumerate(stints):
            entries.append(
                PlayerCollegeHistory(
                    player=player,
                    college=stint["college"],
                    conference=stint["conference"],
                    start_year=stint["start_year"],
                    end_year=stint["end_year"],
                    is_redshirt=False,
                    redshirt_year=None,
                    is_primary=(idx == primary_index),
                    sequence=idx + 1,
                )
            )
        return entries
