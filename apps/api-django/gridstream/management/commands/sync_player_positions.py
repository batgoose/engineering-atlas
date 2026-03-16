"""
Backfill Player.position/position_group/depth_chart_position from raw nflverse datasets.

Priority:
1) raw.raw_nflverse_depth_charts (gsis_id join, most recent row)
2) raw.raw_nflverse_snap_counts (pfr_id join, most recent row)

This command is idempotent and safe to run repeatedly.
"""

from __future__ import annotations

from collections import Counter
import re

from django.core.management.base import BaseCommand
from django.db import connections

from gridstream.models import Player

NON_ALNUM_RE = re.compile(r"[^A-Z0-9/]+")

# Map source labels into canonical Player.position values.
POSITION_TOKEN_MAP = {
    "QB": "QB",
    "RB": "RB",
    "HB": "RB",
    "TB": "RB",
    "FB": "FB",
    "WR": "WR",
    "TE": "TE",
    "OL": "OL",
    "C": "C",
    "OC": "C",
    "G": "G",
    "OG": "G",
    "LG": "G",
    "RG": "G",
    "T": "T",
    "OT": "T",
    "LT": "T",
    "RT": "T",
    "K": "K",
    "PK": "K",
    "P": "P",
    "PT": "P",
    "LS": "LS",
    "SN": "LS",
    "DL": "DL",
    "DE": "DE",
    "EDGE": "DE",
    "ED": "DE",
    "DT": "DT",
    "NT": "NT",
    "LB": "LB",
    "OLB": "OLB",
    "ILB": "ILB",
    "MLB": "MLB",
    "CB": "CB",
    "S": "S",
    "SAF": "S",
    "FS": "FS",
    "SS": "SS",
    "DB": "DB",
}

POSITION_GROUP_BY_POSITION = {
    "QB": "QB",
    "RB": "RB",
    "FB": "RB",
    "WR": "WR",
    "TE": "TE",
    "OL": "OL",
    "C": "OL",
    "G": "OL",
    "T": "OL",
    "K": "SPEC",
    "P": "SPEC",
    "LS": "SPEC",
    "DL": "DL",
    "DE": "DL",
    "DT": "DL",
    "NT": "DL",
    "LB": "LB",
    "OLB": "LB",
    "ILB": "LB",
    "MLB": "LB",
    "CB": "DB",
    "S": "DB",
    "FS": "DB",
    "SS": "DB",
    "DB": "DB",
}


def _normalize_token(value: str | None) -> str:
    if not value:
        return ""
    token = NON_ALNUM_RE.sub("", str(value).upper().strip())
    if not token:
        return ""
    if "/" in token:
        for part in token.split("/"):
            if part:
                return part
    return token


def _canonical_position(value: str | None) -> str | None:
    token = _normalize_token(value)
    if not token:
        return None
    return POSITION_TOKEN_MAP.get(token)


def _depth_position_detail(value: str | None) -> str:
    token = _normalize_token(value)
    if not token:
        return ""
    # Keep detailed OL labels like LT/RT/LG/RG in depth_chart_position.
    if token in {"LT", "RT", "LG", "RG", "C", "T", "G", "OL"}:
        return token
    mapped = POSITION_TOKEN_MAP.get(token)
    return (mapped or token)[:10]


class Command(BaseCommand):
    help = (
        "Backfill player positions from raw depth charts/snap counts to fix OL split "
        "(C/G/T/OL) and improve position group accuracy."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--season",
            type=int,
            default=None,
            help="Use only this season from raw depth/snap datasets.",
        )
        parser.add_argument(
            "--min-season",
            type=int,
            default=None,
            help="Ignore raw rows before this season.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview updates without writing to the database.",
        )

    def handle(self, *args, **options):
        season = options["season"]
        min_season = options["min_season"]
        dry_run = bool(options["dry_run"])

        depth_rows = self._load_depth_rows(season=season, min_season=min_season)
        snap_rows = self._load_snap_rows(season=season, min_season=min_season)

        if not depth_rows and not snap_rows:
            self.stdout.write(
                self.style.WARNING(
                    "No raw depth/snap rows available. Run raw imports before syncing positions."
                )
            )
            return

        players = (
            Player.objects.using("nfl")
            .only(
                "id",
                "gsis_id",
                "pfr_id",
                "position",
                "position_group",
                "depth_chart_position",
            )
            .iterator(chunk_size=2000)
        )

        updates = []
        source_counter = Counter()
        position_counter = Counter()
        scanned = 0

        for player in players:
            scanned += 1
            gsis_id = (player.gsis_id or "").strip()
            pfr_id = (player.pfr_id or "").strip()

            source = None
            depth_token = ""
            position_token = ""

            if gsis_id and gsis_id in depth_rows:
                source = "depth"
                depth_token = depth_rows[gsis_id]["depth_token"]
                position_token = depth_rows[gsis_id]["position_token"]
            elif pfr_id and pfr_id in snap_rows:
                source = "snap"
                depth_token = snap_rows[pfr_id]
                position_token = snap_rows[pfr_id]

            if not source:
                continue

            canonical = _canonical_position(depth_token) or _canonical_position(
                position_token
            )
            if not canonical:
                continue

            next_group = POSITION_GROUP_BY_POSITION.get(
                canonical, player.position_group or ""
            )
            next_depth = _depth_position_detail(depth_token or position_token)

            changed = False
            if player.position != canonical:
                player.position = canonical
                changed = True
            if next_group and player.position_group != next_group:
                player.position_group = next_group
                changed = True
            if next_depth and player.depth_chart_position != next_depth:
                player.depth_chart_position = next_depth
                changed = True

            if not changed:
                continue

            updates.append(player)
            source_counter[source] += 1
            position_counter[canonical] += 1

        if dry_run:
            self.stdout.write(
                self.style.WARNING("DRY RUN: no DB updates will be applied.")
            )
        elif updates:
            Player.objects.using("nfl").bulk_update(
                updates,
                ["position", "position_group", "depth_chart_position"],
                batch_size=1000,
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"sync_player_positions complete: scanned={scanned:,}, updated={len(updates):,}, "
                f"depth-updates={source_counter.get('depth', 0):,}, "
                f"snap-updates={source_counter.get('snap', 0):,}"
            )
        )

        if position_counter:
            breakdown = ", ".join(
                f"{position}:{count:,}"
                for position, count in sorted(
                    position_counter.items(), key=lambda item: (-item[1], item[0])
                )
            )
            self.stdout.write(f"Position breakdown: {breakdown}")

    def _raw_table_exists(self, full_name: str) -> bool:
        with connections["nfl"].cursor() as cursor:
            cursor.execute("SELECT to_regclass(%s)", [full_name])
            return cursor.fetchone()[0] is not None

    def _load_depth_rows(
        self, *, season: int | None, min_season: int | None
    ) -> dict[str, dict[str, str]]:
        if not self._raw_table_exists("raw.raw_nflverse_depth_charts"):
            return {}

        where = ["d.player_id IS NOT NULL", "d.player_id <> ''"]
        params: list[object] = []
        if season is not None:
            where.append("d.season = %s")
            params.append(season)
        elif min_season is not None:
            where.append("d.season >= %s")
            params.append(min_season)

        sql = f"""
            SELECT player_id, depth_token, position_token
            FROM (
                SELECT
                    d.player_id,
                    UPPER(COALESCE(NULLIF(d.payload->>'depth_position', ''), NULLIF(d.payload->>'pos_abb', ''), NULLIF(d.position, ''), '')) AS depth_token,
                    UPPER(COALESCE(NULLIF(d.payload->>'pos_abb', ''), NULLIF(d.position, ''), '')) AS position_token,
                    ROW_NUMBER() OVER (
                        PARTITION BY d.player_id
                        ORDER BY d.season DESC NULLS LAST,
                                 COALESCE(d.week, 0) DESC,
                                 COALESCE(d.depth_rank, 999) ASC,
                                 d.id DESC
                    ) AS row_num
                FROM raw.raw_nflverse_depth_charts d
                WHERE {' AND '.join(where)}
            ) ranked
            WHERE row_num = 1
        """

        rows: dict[str, dict[str, str]] = {}
        with connections["nfl"].cursor() as cursor:
            cursor.execute(sql, params)
            for player_id, depth_token, position_token in cursor.fetchall():
                key = (player_id or "").strip()
                if not key:
                    continue
                rows[key] = {
                    "depth_token": (depth_token or "").strip(),
                    "position_token": (position_token or "").strip(),
                }
        return rows

    def _load_snap_rows(
        self, *, season: int | None, min_season: int | None
    ) -> dict[str, str]:
        if not self._raw_table_exists("raw.raw_nflverse_snap_counts"):
            return {}

        where = ["s.player_id IS NOT NULL", "s.player_id <> ''"]
        params: list[object] = []
        if season is not None:
            where.append("s.season = %s")
            params.append(season)
        elif min_season is not None:
            where.append("s.season >= %s")
            params.append(min_season)

        sql = f"""
            SELECT player_id, position_token
            FROM (
                SELECT
                    s.player_id,
                    UPPER(COALESCE(NULLIF(s.payload->>'position', ''), '')) AS position_token,
                    ROW_NUMBER() OVER (
                        PARTITION BY s.player_id
                        ORDER BY s.season DESC NULLS LAST,
                                 COALESCE(s.week, 0) DESC,
                                 (
                                     COALESCE(s.offense_snaps, 0)
                                     + COALESCE(s.defense_snaps, 0)
                                     + COALESCE(s.special_snaps, 0)
                                 ) DESC,
                                 s.id DESC
                    ) AS row_num
                FROM raw.raw_nflverse_snap_counts s
                WHERE {' AND '.join(where)}
            ) ranked
            WHERE row_num = 1
        """

        rows: dict[str, str] = {}
        with connections["nfl"].cursor() as cursor:
            cursor.execute(sql, params)
            for player_id, position_token in cursor.fetchall():
                key = (player_id or "").strip()
                if not key:
                    continue
                rows[key] = (position_token or "").strip()
        return rows
