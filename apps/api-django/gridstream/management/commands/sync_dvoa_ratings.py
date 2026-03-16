"""
Sync team DVOA metrics from FTN endpoints.

Sources:
  - Regular season: https://ls.ftnfantasy.com/api/ftn/dvoa/rankings
  - Postseason:     https://ls.ftnfantasy.com/api/ftn/dvoa/playoff/rankings

Usage:
    python manage.py sync_dvoa_ratings
    python manage.py sync_dvoa_ratings --season 2025
    python manage.py sync_dvoa_ratings --dry-run
"""

import logging
import math

import requests
from django.db import transaction

from gridstream.models import Team, TeamDvoaRating

from ._base import ImportBaseCommand

logger = logging.getLogger(__name__)

_REGULAR_URL = "https://ls.ftnfantasy.com/api/ftn/dvoa/rankings"
_PLAYOFF_URL = "https://ls.ftnfantasy.com/api/ftn/dvoa/playoff/rankings"
_ENDPOINTS = [
    ("REG", _REGULAR_URL),
    ("POST", _PLAYOFF_URL),
]
_USER_AGENT = (
    "engineering-atlas-gridstream/1.0 (+https://github.com/jbooth/engineering-atlas)"
)

# Current team abbreviations used in our Team table.
_TEAM_ABBR_MAP = {
    "LAR": "LA",
    "STL": "LA",
    "SD": "LAC",
    "OAK": "LV",
}

_UPSERT_FIELDS = [
    "record_snapshot",
    "total_dvoa",
    "offense_dvoa",
    "defense_dvoa",
    "special_teams_dvoa",
    "weighted_total_dvoa",
    "total_dvoa_rank",
    "offense_dvoa_rank",
    "defense_dvoa_rank",
    "special_teams_dvoa_rank",
    "weighted_total_dvoa_rank",
    "last_week_rank",
    "last_week_weighted_rank",
    "non_adjusted_total_voi",
    "offense_voa_unadjusted",
    "defense_voa_unadjusted",
    "special_teams_voa_unadjusted",
    "estimated_wins",
    "past_schedule_dvoa",
    "future_schedule_dvoa",
    "variance",
    "weighted_offense_dvoa",
    "weighted_defense_dvoa",
    "weighted_special_teams_dvoa",
    "metrics_raw",
]


class Command(ImportBaseCommand):
    help = "Sync team DVOA metrics from FTN endpoints."

    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.set_defaults(batch_size=500)

    def handle(self, *args, **options):
        self.batch_size = max(1, options["batch_size"])
        self.dry_run = options["dry_run"]
        requested_seasons = set(options.get("season") or [])
        self._missing_team_warnings: set[str] = set()

        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN"))

        team_cache = self._build_team_cache()
        if not team_cache:
            self.stderr.write(
                self.style.ERROR("No teams found in DB; cannot sync DVOA.")
            )
            return

        rows_to_upsert: list[TeamDvoaRating] = []
        available_seasons: set[int] = set()

        for season_type, url in _ENDPOINTS:
            with self.timed_operation(f"Downloading DVOA payload ({season_type})"):
                payload = self._download_payload(url)

            seasons_in_payload = self._extract_payload_seasons(payload)
            available_seasons.update(seasons_in_payload)
            if seasons_in_payload:
                self.stdout.write(
                    f"  {season_type}: seasons {seasons_in_payload[0]}-{seasons_in_payload[-1]} "
                    f"({len(seasons_in_payload)} total)"
                )
            else:
                self.stdout.write(
                    self.style.WARNING(f"  {season_type}: no seasons found")
                )

            rows = self._parse_payload_rows(
                payload=payload,
                season_type=season_type,
                requested_seasons=requested_seasons,
                team_cache=team_cache,
            )
            rows_to_upsert.extend(rows)

        if not available_seasons:
            self.stderr.write(
                self.style.ERROR("FTN DVOA payload did not include any season keys.")
            )
            return

        if requested_seasons:
            missing = sorted(requested_seasons - available_seasons)
            if missing:
                self.stdout.write(
                    self.style.WARNING(
                        "Requested seasons not available from FTN endpoint: "
                        + ", ".join(str(y) for y in missing)
                    )
                )

        if not rows_to_upsert:
            self.stdout.write(self.style.WARNING("No DVOA rows to upsert."))
            return

        target_seasons = sorted({row.season for row in rows_to_upsert})
        existing_keys = self._existing_keys_for_seasons(target_seasons)

        created = 0
        updated = 0
        seen_keys: set[tuple[int, int, str, int]] = set()
        for row in rows_to_upsert:
            key = (row.team_id, row.season, row.season_type, row.week)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            if key in existing_keys:
                updated += 1
            else:
                created += 1

        self.stdout.write(
            f"Prepared {len(seen_keys)} DVOA snapshots across seasons "
            f"{target_seasons[0]}-{target_seasons[-1]}"
        )

        if self.dry_run:
            self.stdout.write(f"  Would create: {created}, update: {updated}")
            return

        with transaction.atomic(using="nfl"):
            TeamDvoaRating.objects.using("nfl").bulk_create(
                rows_to_upsert,
                batch_size=self.batch_size,
                update_conflicts=True,
                update_fields=_UPSERT_FIELDS,
                unique_fields=["team", "season", "season_type", "week"],
            )

        self.stdout.write(
            self.style.SUCCESS(f"\nDone! {created} created, {updated} updated.")
        )

    def _download_payload(self, url: str) -> dict:
        resp = requests.get(
            url,
            timeout=60,
            headers={
                "User-Agent": _USER_AGENT,
                "Accept": "application/json",
            },
        )
        resp.raise_for_status()
        payload = resp.json()
        if not isinstance(payload, dict):
            raise ValueError(
                f"Unexpected DVOA payload type from {url}: {type(payload)!r}"
            )
        return payload

    def _extract_payload_seasons(self, payload: dict) -> list[int]:
        seasons = []
        for year_key in payload.keys():
            season = self.safe_int(year_key)
            if season is not None:
                seasons.append(season)
        return sorted(set(seasons))

    def _build_team_cache(self) -> dict[str, Team]:
        return {
            team.abbreviation.upper(): team
            for team in Team.objects.using("nfl").all()
            if team.abbreviation
        }

    def _existing_keys_for_seasons(
        self, seasons: list[int]
    ) -> set[tuple[int, int, str, int]]:
        if not seasons:
            return set()
        return set(
            TeamDvoaRating.objects.using("nfl")
            .filter(season__in=seasons)
            .values_list("team_id", "season", "season_type", "week")
        )

    def _parse_payload_rows(
        self,
        payload: dict,
        season_type: str,
        requested_seasons: set[int],
        team_cache: dict[str, Team],
    ) -> list[TeamDvoaRating]:
        out: list[TeamDvoaRating] = []

        for year_key, teams_blob in payload.items():
            season = self.safe_int(year_key)
            if season is None:
                continue
            if requested_seasons and season not in requested_seasons:
                continue
            if not isinstance(teams_blob, dict):
                continue

            for team_key, row in teams_blob.items():
                if not isinstance(row, dict):
                    continue

                src_team = self.safe_str(row.get("team") or team_key).upper()
                canonical_team = _TEAM_ABBR_MAP.get(src_team, src_team)
                team = team_cache.get(canonical_team)
                if not team:
                    if src_team not in self._missing_team_warnings:
                        self._missing_team_warnings.add(src_team)
                        self.stdout.write(
                            self.style.WARNING(
                                f"  [skip] Team not found for DVOA row: {src_team}"
                            )
                        )
                    continue

                total_rank = self._safe_rank(
                    row.get("total_dvoa_rank") or row.get("rank1")
                )
                offense_rank = self._safe_rank(
                    row.get("offense_rank") or row.get("rank2")
                )
                defense_rank = self._safe_rank(
                    row.get("defense_rank") or row.get("rank3")
                )
                st_rank = self._safe_rank(
                    row.get("special_teams_rank") or row.get("rank4")
                )
                weighted_rank = self._safe_rank(row.get("rank5"))

                out.append(
                    TeamDvoaRating(
                        team=team,
                        season=season,
                        season_type=season_type,
                        week=self.safe_int(row.get("week"), 0) or 0,
                        record_snapshot=self.safe_str(row.get("w_l"), ""),
                        total_dvoa=self._safe_number(row.get("total_dvoa")),
                        offense_dvoa=self._safe_number(row.get("offense_dvoa")),
                        defense_dvoa=self._safe_number(row.get("defense_dvoa")),
                        special_teams_dvoa=self._safe_number(
                            row.get("special_teams_dvoa")
                        ),
                        weighted_total_dvoa=self._safe_number(row.get("wei_dvoa")),
                        total_dvoa_rank=total_rank,
                        offense_dvoa_rank=offense_rank,
                        defense_dvoa_rank=defense_rank,
                        special_teams_dvoa_rank=st_rank,
                        weighted_total_dvoa_rank=weighted_rank,
                        last_week_rank=self._safe_rank(row.get("last_week")),
                        last_week_weighted_rank=self._safe_rank(
                            row.get("last_week_wei")
                        ),
                        non_adjusted_total_voi=self._safe_number(
                            row.get("non_adj_tot_voi")
                        ),
                        offense_voa_unadjusted=self._safe_number(
                            row.get("offense_voa_unadj")
                        ),
                        defense_voa_unadjusted=self._safe_number(
                            row.get("defense_voa_unadj")
                        ),
                        special_teams_voa_unadjusted=self._safe_number(
                            row.get("special_voa_unadj")
                        ),
                        estimated_wins=self._safe_number(row.get("estim_wins")),
                        past_schedule_dvoa=self._safe_number(row.get("past_schedule")),
                        future_schedule_dvoa=self._safe_number(
                            row.get("future_schedule")
                        ),
                        variance=self._safe_number(row.get("var")),
                        weighted_offense_dvoa=self._safe_number(row.get("wei_offense")),
                        weighted_defense_dvoa=self._safe_number(row.get("wei_defense")),
                        weighted_special_teams_dvoa=self._safe_number(
                            row.get("wei_st")
                        ),
                        metrics_raw=self._normalize_payload(row),
                    )
                )

        return out

    def _safe_number(self, value):
        if value is None:
            return None
        if isinstance(value, (int, float)):
            if isinstance(value, float) and math.isnan(value):
                return None
            return float(value)

        text = str(value).strip()
        if not text or text in {"-", "--", "n/a", "N/A"}:
            return None

        text = text.replace("%", "").replace(",", "")
        try:
            return float(text)
        except ValueError:
            return None

    def _safe_rank(self, value):
        if value is None:
            return None
        text = str(value).strip()
        if not text or text in {"-", "--", "n/a", "N/A"}:
            return None
        return self.safe_int(text)

    def _normalize_payload(self, row: dict) -> dict:
        normalized = {}
        for key, value in row.items():
            if isinstance(value, str):
                stripped = value.strip()
                normalized[key] = stripped if stripped else None
            else:
                normalized[key] = value
        return normalized
