"""
Gridstream DRF Serializers.

Organized by domain: Teams, Players, Games, Plays, Stats, Simulation.
Uses nested serializers where appropriate and keeps payloads lean
for the frontend scoreboard / game detail / team / player views.
"""

from rest_framework import serializers
from datetime import date

TEAM_ABBR_TO_COLOR_LOGO_CODE = {
    "WAS": "wsh",
    "LA": "lar",
}


def _current_nfl_season() -> int:
    """NFL season year = calendar year the season started. Sept-Dec → current year; Jan-Aug → previous year."""
    today = date.today()
    return today.year if today.month >= 9 else today.year - 1


def _current_madden_year() -> int:
    """Madden game year currently in market (e.g. Mar 2026 -> 26; Sep 2026 -> 27)."""
    today = date.today()
    game_year = today.year - 2000
    if today.month >= 8:
        game_year += 1
    return game_year


def _is_roster_sync_transaction(transaction: "PlayerTransaction") -> bool:
    return (transaction.description or "").strip().lower().startswith("roster sync:")


def _contract_end_year(contract: "PlayerContract") -> int | None:
    year_details = getattr(contract, "year_details", None) or []
    years = [
        entry.get("year")
        for entry in year_details
        if isinstance(entry, dict) and isinstance(entry.get("year"), int)
    ]
    if years:
        return max(years)

    year_signed = getattr(contract, "year_signed", None)
    total_years = getattr(contract, "years", None)
    if isinstance(year_signed, int) and isinstance(total_years, int):
        return year_signed + max(total_years, 1) - 1
    if isinstance(year_signed, int):
        return year_signed
    return None


def _is_contract_effectively_active(contract: "PlayerContract") -> bool:
    if not contract.is_active:
        return False
    end_year = _contract_end_year(contract)
    if end_year is None:
        return bool(contract.is_active)
    return end_year >= date.today().year


def _infer_free_agent_status(player: "Player") -> tuple[str, str]:
    years_experience = getattr(player, "years_experience", None)
    if isinstance(years_experience, int):
        if years_experience >= 4:
            return ("UFA", "Unrestricted Free Agent")
        if years_experience >= 3:
            return ("RFA", "Restricted Free Agent")
        if years_experience >= 0:
            return ("ERFA", "Exclusive Rights Free Agent")

    roster_status = (getattr(player, "roster_status", "") or "").upper()
    if roster_status == "RFA":
        return ("RFA", "Restricted Free Agent")
    if roster_status == "ERFA":
        return ("ERFA", "Exclusive Rights Free Agent")
    return ("UFA", "Unrestricted Free Agent")


def _player_contracts(player: "Player") -> list["PlayerContract"]:
    if (
        hasattr(player, "_prefetched_objects_cache")
        and "contracts" in player._prefetched_objects_cache
    ):
        return list(player._prefetched_objects_cache["contracts"])
    return list(player.contracts.select_related("team").all())


def _player_transactions(player: "Player") -> list["PlayerTransaction"]:
    if (
        hasattr(player, "_prefetched_objects_cache")
        and "transactions" in player._prefetched_objects_cache
    ):
        return list(player._prefetched_objects_cache["transactions"])
    return list(player.transactions.select_related("from_team", "to_team").all())


def _player_tracker_entries(player: "Player") -> list["TeamFreeAgentTrackerEntry"]:
    if (
        hasattr(player, "_prefetched_objects_cache")
        and "free_agent_tracker_entries" in player._prefetched_objects_cache
    ):
        return list(player._prefetched_objects_cache["free_agent_tracker_entries"])
    return list(
        player.free_agent_tracker_entries.select_related(
            "team", "signed_with_team"
        ).all()
    )


def _has_current_team_commitment_signal(player: "Player") -> bool:
    team = getattr(player, "current_team", None)
    team_id = getattr(player, "current_team_id", None)
    if not team_id or not getattr(player, "is_active", False):
        return False

    current_year = date.today().year
    tracker_entries = _player_tracker_entries(player)
    if any(
        entry.season == current_year
        and getattr(entry, "signed_with_team_id", None) == team_id
        for entry in tracker_entries
    ):
        return True

    for transaction in _player_transactions(player):
        if _is_roster_sync_transaction(transaction):
            continue
        if getattr(transaction, "to_team_id", None) != team_id:
            continue
        if not transaction.date or transaction.date.year != current_year:
            continue
        if (transaction.transaction_type or "").lower() in {
            "signed",
            "signed_ps",
            "claimed",
            "traded",
        }:
            return True

    return False


def _player_effective_status_context(player: "Player") -> dict:
    cached = getattr(player, "_gridstream_effective_status_context", None)
    if cached is not None:
        return cached

    contracts = _player_contracts(player)
    active_contract = next(
        (
            contract
            for contract in contracts
            if _is_contract_effectively_active(contract)
        ),
        None,
    )

    roster_status = (getattr(player, "roster_status", "") or "").upper()
    if active_contract is not None:
        team = active_contract.team or getattr(player, "current_team", None)
        context = {
            "current_team": team,
            "current_team_abbr": getattr(team, "abbreviation", None),
            "roster_status": roster_status or "ACT",
            "roster_status_display": (
                player.get_roster_status_display()
                if getattr(player, "roster_status", None)
                else "Active"
            ),
            "is_active": True,
        }
        setattr(player, "_gridstream_effective_status_context", context)
        return context

    if roster_status in {"RET", "RETIRED"}:
        context = {
            "current_team": None,
            "current_team_abbr": None,
            "roster_status": "RET",
            "roster_status_display": "Retired",
            "is_active": False,
        }
        setattr(player, "_gridstream_effective_status_context", context)
        return context

    if _has_current_team_commitment_signal(player):
        team = getattr(player, "current_team", None)
        context = {
            "current_team": team,
            "current_team_abbr": getattr(team, "abbreviation", None),
            "roster_status": "ACT",
            "roster_status_display": "Active",
            "is_active": True,
        }
        setattr(player, "_gridstream_effective_status_context", context)
        return context

    if roster_status in {"CUT", "RELEASED", "WAIVED"}:
        context = {
            "current_team": None,
            "current_team_abbr": None,
            "roster_status": "CUT",
            "roster_status_display": "Released",
            "is_active": False,
        }
        setattr(player, "_gridstream_effective_status_context", context)
        return context

    # Only include contracts whose end year is reliable: either they have per-year
    # details (so the last year is known precisely), or they are the active flag.
    # Inactive contracts without year_details use year_signed+years-1, which can
    # overshoot when a contract was renegotiated or terminated early (e.g. a 5-year
    # deal signed in 2022 that was superseded in 2023 would otherwise appear to end
    # in 2026 and block the free-agent branch).
    latest_contract_end = max(
        (
            _contract_end_year(contract) or -1
            for contract in contracts
            if contract.is_active or (getattr(contract, "year_details", None) or [])
        ),
        default=-1,
    )
    if latest_contract_end >= 0 and latest_contract_end < date.today().year:
        free_agent_status, free_agent_display = _infer_free_agent_status(player)
        context = {
            "current_team": None,
            "current_team_abbr": None,
            "roster_status": free_agent_status,
            "roster_status_display": free_agent_display,
            "is_active": False,
        }
        setattr(player, "_gridstream_effective_status_context", context)
        return context

    team = getattr(player, "current_team", None)
    context = {
        "current_team": team,
        "current_team_abbr": getattr(team, "abbreviation", None),
        "roster_status": roster_status
        or ("ACT" if getattr(player, "is_active", False) else ""),
        "roster_status_display": (
            player.get_roster_status_display()
            if getattr(player, "roster_status", None)
            else ("Active" if getattr(player, "is_active", False) else None)
        ),
        "is_active": bool(getattr(player, "is_active", False)),
    }
    setattr(player, "_gridstream_effective_status_context", context)
    return context


from .models import (
    Team,
    TeamLogo,
    Venue,
    Player,
    PlayerContract,
    PlayerCombine,
    PlayerCollegeHistory,
    PlayerTransaction,
    TeamFreeAgentTrackerEntry,
    SocialAccount,
    GameHashtag,
    NewsSource,
    Season,
    Game,
    GameLeader,
    GameLink,
    GameOfficial,
    PlayerInjury,
    Drive,
    Play,
    ScoringPlay,
    TeamStanding,
    PlayerGameStats,
    TeamGameStats,
    Playbook,
    PlaybookEntry,
    PlayerFFRanking,
    PlayerNextGenStats,
    PlayerAward,
    PlayerMaddenRating,
    TeamDvoaRating,
    TeamRbsdmMetric,
    PlayerRbsdmQbMetric,
    PlayerRAS,
    NewsArticle,
)

# =============================================================================
# TEAM & VENUE
# =============================================================================


class TeamLogoSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeamLogo
        fields = ["logo_type", "url", "width", "height"]


class TeamListSerializer(serializers.ModelSerializer):
    """Compact team representation for lists and foreign-key references."""

    logos = TeamLogoSerializer(many=True, read_only=True)

    class Meta:
        model = Team
        fields = [
            "id",
            "espn_id",
            "abbreviation",
            "slug",
            "location",
            "name",
            "display_name",
            "short_display_name",
            "color_primary",
            "color_secondary",
            "conference",
            "division",
            "is_active",
            "logos",
        ]


class TeamMinimalSerializer(serializers.ModelSerializer):
    """Bare-minimum team reference for nested use (plays, stats, etc.)."""

    logo_url = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = [
            "id",
            "abbreviation",
            "display_name",
            "short_display_name",
            "color_primary",
            "color_secondary",
            "logo_url",
        ]

    def get_logo_url(self, obj):
        # Prefer stable full-color marks. Do not fall back to scoreboard-dark/dark
        # variants; those monochrome logos are frequently inaccurate for Gridstream UI.
        if (
            hasattr(obj, "_prefetched_objects_cache")
            and "logos" in obj._prefetched_objects_cache
        ):
            logos = obj._prefetched_objects_cache["logos"]
        else:
            logos = list(obj.logos.all()[:4])
        logo_map = {logo.logo_type: logo.url for logo in logos}
        abbr = str(getattr(obj, "abbreviation", "") or "").upper().strip()
        espn_logo_key = TEAM_ABBR_TO_COLOR_LOGO_CODE.get(abbr, abbr.lower())
        if 2 <= len(abbr) <= 3 and espn_logo_key:
            return f"https://a.espncdn.com/i/teamlogos/nfl/500/{espn_logo_key}.png"

        default_logo = logo_map.get("default")
        if default_logo:
            return default_logo

        return next(
            (
                logo.url
                for logo in logos
                if logo.logo_type not in {"dark", "scoreboard", "scoreboard-dark"}
            ),
            None,
        )


class VenueSerializer(serializers.ModelSerializer):
    class Meta:
        model = Venue
        fields = [
            "id",
            "espn_id",
            "name",
            "city",
            "state",
            "country",
            "latitude",
            "longitude",
            "roof_type",
            "surface",
            "is_indoor",
        ]


class TeamDetailSerializer(serializers.ModelSerializer):
    """Full team detail — used on /teams/{abbr}/ page."""

    logos = TeamLogoSerializer(many=True, read_only=True)
    social_accounts = serializers.SerializerMethodField()
    player_count = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = [
            "id",
            "espn_id",
            "abbreviation",
            "slug",
            "location",
            "name",
            "display_name",
            "short_display_name",
            "nickname",
            "color_primary",
            "color_secondary",
            "conference",
            "division",
            "is_active",
            "logos",
            "social_accounts",
            "player_count",
        ]

    def get_social_accounts(self, obj):
        accounts = obj.social_accounts.filter(account_type="official")
        return SocialAccountSerializer(accounts, many=True).data

    def get_player_count(self, obj):
        return obj.players.filter(is_active=True).count()


# =============================================================================
# PLAYER
# =============================================================================


class SocialAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = SocialAccount
        fields = [
            "id",
            "platform",
            "account_type",
            "handle",
            "url",
            "display_name",
            "is_verified",
        ]


class PlayerListSerializer(serializers.ModelSerializer):
    """For roster lists, search results, and game leader references."""

    current_team = serializers.SerializerMethodField()
    current_team_abbr = serializers.SerializerMethodField()
    current_team_colors = serializers.SerializerMethodField()
    roster_status = serializers.SerializerMethodField()
    roster_status_display = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    age = serializers.SerializerMethodField()
    games_played = serializers.IntegerField(read_only=True, default=0)
    games_started = serializers.IntegerField(
        read_only=True, default=None, allow_null=True
    )
    offensive_snaps = serializers.IntegerField(
        read_only=True, default=None, allow_null=True
    )
    snap_pct = serializers.FloatField(read_only=True, default=None, allow_null=True)
    first_season_played = serializers.IntegerField(read_only=True, default=None)
    last_season_played = serializers.IntegerField(read_only=True, default=None)
    seasons_count = serializers.IntegerField(read_only=True, default=0)
    career_completions = serializers.IntegerField(read_only=True, default=0)
    career_pass_attempts = serializers.IntegerField(read_only=True, default=0)
    career_completion_pct = serializers.FloatField(read_only=True, default=0)
    career_passing_yards = serializers.IntegerField(read_only=True, default=0)
    career_pass_yards_per_game = serializers.FloatField(read_only=True, default=0)
    career_pass_yards_per_attempt = serializers.FloatField(read_only=True, default=0)
    career_passing_tds = serializers.IntegerField(read_only=True, default=0)
    career_interceptions_thrown = serializers.IntegerField(read_only=True, default=0)
    career_passer_rating = serializers.FloatField(read_only=True, default=0)
    career_sacks_taken = serializers.IntegerField(read_only=True, default=0)
    career_carries = serializers.IntegerField(read_only=True, default=0)
    career_rushing_yards = serializers.IntegerField(read_only=True, default=0)
    career_rush_yards_per_game = serializers.FloatField(read_only=True, default=0)
    career_yards_per_carry = serializers.FloatField(read_only=True, default=0)
    career_rushing_tds = serializers.IntegerField(read_only=True, default=0)
    career_receptions = serializers.IntegerField(read_only=True, default=0)
    career_targets = serializers.IntegerField(read_only=True, default=0)
    career_catch_pct = serializers.FloatField(read_only=True, default=0)
    career_receiving_yards = serializers.IntegerField(read_only=True, default=0)
    career_rec_yards_per_game = serializers.FloatField(read_only=True, default=0)
    career_yards_per_reception = serializers.FloatField(read_only=True, default=0)
    career_yards_per_target = serializers.FloatField(read_only=True, default=0)
    career_receiving_tds = serializers.IntegerField(read_only=True, default=0)
    career_scrimmage_yards = serializers.IntegerField(read_only=True, default=0)
    career_total_touchdowns = serializers.IntegerField(read_only=True, default=0)
    career_touchdowns_per_game = serializers.FloatField(read_only=True, default=0)
    career_long_gain = serializers.IntegerField(read_only=True, default=0)
    career_first_downs = serializers.IntegerField(read_only=True, default=0)
    career_fumbles = serializers.IntegerField(read_only=True, default=0)
    career_fumbles_lost = serializers.IntegerField(read_only=True, default=0)
    career_tackles_total = serializers.IntegerField(read_only=True, default=0)
    career_sacks_made = serializers.FloatField(read_only=True, default=0)
    career_interceptions_caught = serializers.IntegerField(read_only=True, default=0)
    career_passes_defended = serializers.IntegerField(read_only=True, default=0)
    career_forced_fumbles = serializers.IntegerField(read_only=True, default=0)
    career_fg_made = serializers.IntegerField(read_only=True, default=0)
    career_fg_attempts = serializers.IntegerField(read_only=True, default=0)
    career_punt_attempts = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Player
        fields = [
            "id",
            "gsis_id",
            "espn_id",
            "display_name",
            "short_name",
            "first_name",
            "last_name",
            "position",
            "position_group",
            "jersey_number",
            "height",
            "weight",
            "roster_status",
            "depth_chart_position",
            "depth_chart_rank",
            "depth_chart_status",
            "roster_status_display",
            "age",
            "current_team",
            "current_team_abbr",
            "current_team_colors",
            "draft_year",
            "draft_round",
            "draft_pick",
            "rookie_season",
            "entry_year",
            "years_experience",
            "games_played",
            "games_started",
            "offensive_snaps",
            "snap_pct",
            "first_season_played",
            "last_season_played",
            "seasons_count",
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
            "headshot_url",
            "is_active",
        ]

    def get_current_team_colors(self, obj):
        team = _player_effective_status_context(obj)["current_team"]
        if team:
            return {
                "primary": team.color_primary,
                "secondary": team.color_secondary,
            }
        return None

    def get_current_team(self, obj):
        team = _player_effective_status_context(obj)["current_team"]
        return getattr(team, "id", None)

    def get_current_team_abbr(self, obj):
        return _player_effective_status_context(obj)["current_team_abbr"]

    def get_roster_status(self, obj):
        return _player_effective_status_context(obj)["roster_status"]

    def get_roster_status_display(self, obj):
        return _player_effective_status_context(obj)["roster_status_display"]

    def get_is_active(self, obj):
        return _player_effective_status_context(obj)["is_active"]

    def get_age(self, obj):
        if not obj.birth_date:
            return None
        today = date.today()
        years = today.year - obj.birth_date.year
        birthday_passed = (today.month, today.day) >= (
            obj.birth_date.month,
            obj.birth_date.day,
        )
        return years if birthday_passed else years - 1


class PlayerContractSerializer(serializers.ModelSerializer):
    is_active = serializers.SerializerMethodField()
    team_abbr = serializers.CharField(
        source="team.abbreviation", read_only=True, default=None
    )

    class Meta:
        model = PlayerContract
        fields = [
            "id",
            "team",
            "team_abbr",
            "is_active",
            "year_signed",
            "years",
            "total_value",
            "apy",
            "guaranteed",
            "apy_cap_pct",
            "inflated_value",
            "inflated_apy",
            "inflated_guaranteed",
            "year_details",
            "otc_url",
        ]

    def get_is_active(self, obj):
        return _is_contract_effectively_active(obj)


class PlayerCombineSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlayerCombine
        fields = [
            "id",
            "season",
            "position",
            "height_inches",
            "weight",
            "arm_length",
            "hand_size",
            "wingspan",
            "forty_yard",
            "twenty_yard_split",
            "ten_yard_split",
            "bench_press",
            "vertical_jump",
            "broad_jump",
            "three_cone",
            "shuttle",
            "draft_round",
            "draft_overall",
            "pfr_url",
        ]


class PlayerRASSerializer(serializers.ModelSerializer):
    ras_image_url = serializers.SerializerMethodField()

    class Meta:
        model = PlayerRAS
        fields = [
            "ras_player_id",
            "ras_score",
            "ras_summary",
            "has_ras",
            "position",
            "draft_year",
            "draft_round",
            "draft_pick",
            "is_undrafted",
            "is_prospect",
            "ras_image_url",
        ]

    def get_ras_image_url(self, obj):
        if not obj.ras_image_key:
            return None
        from django.conf import settings

        protocol = "https" if getattr(settings, "MINIO_USE_SSL", False) else "http"
        endpoint = getattr(
            settings,
            "MINIO_PUBLIC_ENDPOINT",
            getattr(settings, "MINIO_ENDPOINT", "localhost:9000"),
        )
        return f"{protocol}://{endpoint}/player-ras/{obj.ras_image_key}"


class PlayerCollegeHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = PlayerCollegeHistory
        fields = [
            "id",
            "college",
            "conference",
            "start_year",
            "end_year",
            "is_redshirt",
            "redshirt_year",
            "is_primary",
            "sequence",
        ]


class PlayerTransactionSerializer(serializers.ModelSerializer):
    from_team_abbr = serializers.CharField(
        source="from_team.abbreviation", read_only=True, default=None
    )
    to_team_abbr = serializers.CharField(
        source="to_team.abbreviation", read_only=True, default=None
    )
    player_name = serializers.CharField(
        source="player.display_name", read_only=True, default=None
    )
    player_position = serializers.CharField(
        source="player.position", read_only=True, default=None
    )
    player_id = serializers.IntegerField(source="player.id", read_only=True, default=None)
    # Authoritative current team — more reliable than to_team for recent signings
    current_team_abbr = serializers.CharField(
        source="player.current_team.abbreviation", read_only=True, default=None
    )
    contract_apy = serializers.SerializerMethodField()
    contract_years = serializers.SerializerMethodField()

    def get_contract_apy(self, obj):
        if obj.contract_apy:
            return obj.contract_apy
        if obj.player_id:
            # PlayerContract (OTC) — authoritative when available
            c = (
                obj.player.contracts.using("nfl")
                .filter(is_active=True, apy__isnull=False)
                .order_by("-year_signed")
                .first()
            )
            if c:
                return c.apy
            # Fall back to the most recent PlayerTransaction that carried contract data
            t = (
                obj.player.transactions.using("nfl")
                .filter(contract_apy__isnull=False)
                .order_by("-date")
                .first()
            )
            if t:
                return t.contract_apy
        return None

    def get_contract_years(self, obj):
        if obj.contract_years:
            return obj.contract_years
        if obj.player_id:
            c = (
                obj.player.contracts.using("nfl")
                .filter(is_active=True, years__isnull=False)
                .order_by("-year_signed")
                .first()
            )
            if c:
                return c.years
            t = (
                obj.player.transactions.using("nfl")
                .filter(contract_years__isnull=False)
                .order_by("-date")
                .first()
            )
            if t:
                return t.contract_years
        return None

    class Meta:
        model = PlayerTransaction
        fields = [
            "id",
            "player_id",
            "player_name",
            "player_position",
            "transaction_type",
            "date",
            "from_team",
            "from_team_abbr",
            "to_team",
            "to_team_abbr",
            "current_team_abbr",
            "description",
            "contract_years",
            "contract_total_value",
            "contract_apy",
            "contract_guaranteed",
            "season",
        ]


class TeamFreeAgentTrackerEntrySerializer(serializers.ModelSerializer):
    team_detail = TeamMinimalSerializer(source="team", read_only=True)
    signed_with_team_detail = TeamMinimalSerializer(
        source="signed_with_team", read_only=True
    )
    tracker_status_display = serializers.SerializerMethodField()
    contract_detail = serializers.SerializerMethodField()
    player_id = serializers.IntegerField(
        source="player.id", read_only=True, default=None
    )
    player_gsis_id = serializers.CharField(
        source="player.gsis_id", read_only=True, default=None
    )

    class Meta:
        model = TeamFreeAgentTrackerEntry
        fields = [
            "id",
            "season",
            "player_id",
            "player_gsis_id",
            "player_name",
            "ourlads_player_id",
            "position",
            "fa_type",
            "tracker_status",
            "tracker_status_display",
            "team_detail",
            "signed_with_team_detail",
            "contract_detail",
            "source_url",
            "updated_at",
        ]

    def get_tracker_status_display(self, obj):
        return obj.get_tracker_status_display()

    def _resolve_signed_contract(self, obj):
        player = getattr(obj, "player", None)
        if not player or not obj.signed_with_team_id:
            return None

        if (
            hasattr(player, "_prefetched_objects_cache")
            and "contracts" in player._prefetched_objects_cache
        ):
            contracts = list(player._prefetched_objects_cache["contracts"])
        else:
            contracts = list(player.contracts.select_related("team").all())

        matching = [
            contract
            for contract in contracts
            if contract.team_id == obj.signed_with_team_id
        ]
        if not matching:
            return None

        matching.sort(
            key=lambda contract: (
                1 if contract.is_active else 0,
                contract.year_signed or 0,
                contract.created_at,
            ),
            reverse=True,
        )
        return matching[0]

    def _resolve_spotrac_transaction_contract(self, obj):
        player = getattr(obj, "player", None)
        if not player or not obj.signed_with_team_id:
            return None

        if (
            hasattr(player, "_prefetched_objects_cache")
            and "transactions" in player._prefetched_objects_cache
        ):
            transactions = list(player._prefetched_objects_cache["transactions"])
        else:
            transactions = list(
                player.transactions.select_related("from_team", "to_team").all()
            )

        matching = [
            transaction
            for transaction in transactions
            if transaction.to_team_id == obj.signed_with_team_id
            and transaction.transaction_type
            in {"signed", "signed_ps", "claimed", "traded"}
            and any(
                value is not None
                for value in (
                    transaction.contract_years,
                    transaction.contract_total_value,
                    transaction.contract_apy,
                    transaction.contract_guaranteed,
                )
            )
        ]
        if not matching:
            return None

        matching.sort(
            key=lambda transaction: (
                transaction.date or date.min,
                transaction.season or 0,
                transaction.created_at,
            ),
            reverse=True,
        )
        return matching[0]

    def get_contract_detail(self, obj):
        contract = self._resolve_signed_contract(obj)
        if contract:
            return {
                "year_signed": contract.year_signed,
                "years": contract.years,
                "total_value": contract.total_value,
                "apy": contract.apy,
                "guaranteed": contract.guaranteed,
                "is_active": contract.is_active,
                "otc_url": contract.otc_url or None,
            }

        transaction = self._resolve_spotrac_transaction_contract(obj)
        if not transaction:
            return None

        return {
            "year_signed": (
                transaction.date.year if transaction.date else transaction.season
            ),
            "years": transaction.contract_years,
            "total_value": transaction.contract_total_value,
            "apy": transaction.contract_apy,
            "guaranteed": (
                transaction.contract_guaranteed
                if transaction.contract_guaranteed not in {None, 0}
                else None
            ),
            "is_active": True,
            "otc_url": None,
        }


class TeamFreeAgencyTransactionSerializer(serializers.ModelSerializer):
    player_id = serializers.IntegerField(
        source="player.id", read_only=True, default=None
    )
    player_name = serializers.CharField(
        source="player.display_name", read_only=True, default=""
    )
    player_position = serializers.CharField(
        source="player.position", read_only=True, default=""
    )
    from_team_detail = TeamMinimalSerializer(source="from_team", read_only=True)
    to_team_detail = TeamMinimalSerializer(source="to_team", read_only=True)

    class Meta:
        model = PlayerTransaction
        fields = [
            "id",
            "player_id",
            "player_name",
            "player_position",
            "transaction_type",
            "date",
            "description",
            "season",
            "from_team_detail",
            "to_team_detail",
        ]


class TeamFreeAgencyContractChangeSerializer(serializers.ModelSerializer):
    player_id = serializers.IntegerField(
        source="player.id", read_only=True, default=None
    )
    player_name = serializers.CharField(
        source="player.display_name", read_only=True, default=""
    )
    player_position = serializers.CharField(
        source="player.position", read_only=True, default=""
    )
    team_detail = TeamMinimalSerializer(source="team", read_only=True)

    class Meta:
        model = PlayerContract
        fields = [
            "id",
            "player_id",
            "player_name",
            "player_position",
            "team_detail",
            "year_signed",
            "years",
            "total_value",
            "apy",
            "guaranteed",
            "is_active",
            "otc_url",
        ]


class PlayerAwardSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlayerAward
        fields = ["season", "espn_award_id", "name", "description"]


class PlayerDetailSerializer(serializers.ModelSerializer):
    """Full player profile — /players/{id}/ endpoint."""

    current_team = serializers.SerializerMethodField()
    current_team_detail = serializers.SerializerMethodField()
    draft_team_detail = TeamMinimalSerializer(source="draft_team", read_only=True)
    roster_status = serializers.SerializerMethodField()
    roster_status_display = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    contracts = PlayerContractSerializer(many=True, read_only=True)
    combine_results = PlayerCombineSerializer(many=True, read_only=True)
    ras = PlayerRASSerializer(read_only=True)
    college_history = PlayerCollegeHistorySerializer(many=True, read_only=True)
    social_accounts = SocialAccountSerializer(many=True, read_only=True)
    recent_transactions = serializers.SerializerMethodField()
    awards = PlayerAwardSerializer(many=True, read_only=True)
    games_played = serializers.SerializerMethodField()
    games_started = serializers.IntegerField(
        read_only=True, default=None, allow_null=True
    )
    offensive_snaps = serializers.IntegerField(
        read_only=True, default=None, allow_null=True
    )
    snap_pct = serializers.FloatField(read_only=True, default=None, allow_null=True)
    first_season_played = serializers.SerializerMethodField()
    last_season_played = serializers.SerializerMethodField()
    seasons_count = serializers.IntegerField(read_only=True, default=0)
    career_completions = serializers.IntegerField(read_only=True, default=0)
    career_pass_attempts = serializers.IntegerField(read_only=True, default=0)
    career_completion_pct = serializers.FloatField(read_only=True, default=0)
    career_passing_yards = serializers.IntegerField(read_only=True, default=0)
    career_pass_yards_per_game = serializers.FloatField(read_only=True, default=0)
    career_pass_yards_per_attempt = serializers.FloatField(read_only=True, default=0)
    career_passing_tds = serializers.IntegerField(read_only=True, default=0)
    career_interceptions_thrown = serializers.IntegerField(read_only=True, default=0)
    career_passer_rating = serializers.FloatField(read_only=True, default=0)
    career_sacks_taken = serializers.IntegerField(read_only=True, default=0)
    career_carries = serializers.IntegerField(read_only=True, default=0)
    career_rushing_yards = serializers.IntegerField(read_only=True, default=0)
    career_rush_yards_per_game = serializers.FloatField(read_only=True, default=0)
    career_yards_per_carry = serializers.FloatField(read_only=True, default=0)
    career_rushing_tds = serializers.IntegerField(read_only=True, default=0)
    career_receptions = serializers.IntegerField(read_only=True, default=0)
    career_targets = serializers.IntegerField(read_only=True, default=0)
    career_catch_pct = serializers.FloatField(read_only=True, default=0)
    career_receiving_yards = serializers.IntegerField(read_only=True, default=0)
    career_rec_yards_per_game = serializers.FloatField(read_only=True, default=0)
    career_yards_per_reception = serializers.FloatField(read_only=True, default=0)
    career_yards_per_target = serializers.FloatField(read_only=True, default=0)
    career_receiving_tds = serializers.IntegerField(read_only=True, default=0)
    career_scrimmage_yards = serializers.IntegerField(read_only=True, default=0)
    career_total_touchdowns = serializers.IntegerField(read_only=True, default=0)
    career_touchdowns_per_game = serializers.FloatField(read_only=True, default=0)
    career_long_gain = serializers.IntegerField(read_only=True, default=0)
    career_first_downs = serializers.IntegerField(read_only=True, default=0)
    career_fumbles = serializers.IntegerField(read_only=True, default=0)
    career_fumbles_lost = serializers.IntegerField(read_only=True, default=0)
    career_tackles_total = serializers.IntegerField(read_only=True, default=0)
    career_sacks_made = serializers.FloatField(read_only=True, default=0)
    career_interceptions_caught = serializers.IntegerField(read_only=True, default=0)
    career_passes_defended = serializers.IntegerField(read_only=True, default=0)
    career_forced_fumbles = serializers.IntegerField(read_only=True, default=0)
    career_fg_made = serializers.IntegerField(read_only=True, default=0)
    career_fg_attempts = serializers.IntegerField(read_only=True, default=0)
    career_punt_attempts = serializers.IntegerField(read_only=True, default=0)
    madden_rating = serializers.SerializerMethodField()
    latest_ff_ranking = serializers.SerializerMethodField()

    class Meta:
        model = Player
        fields = [
            "id",
            "gsis_id",
            "espn_id",
            "pfr_id",
            "display_name",
            "short_name",
            "first_name",
            "last_name",
            "suffix",
            "jersey_number",
            "position",
            "position_group",
            "current_team",
            "current_team_detail",
            "roster_status",
            "roster_status_display",
            "depth_chart_position",
            "depth_chart_rank",
            "depth_chart_status",
            "headshot_url",
            "height",
            "height_inches",
            "weight",
            "birth_date",
            "college",
            "college_conference",
            "draft_year",
            "draft_round",
            "draft_pick",
            "draft_overall",
            "draft_team",
            "draft_team_detail",
            "is_undrafted",
            "rookie_season",
            "entry_year",
            "years_experience",
            "is_active",
            "games_played",
            "games_started",
            "offensive_snaps",
            "snap_pct",
            "first_season_played",
            "last_season_played",
            "seasons_count",
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
            "contracts",
            "combine_results",
            "ras",
            "college_history",
            "social_accounts",
            "recent_transactions",
            "awards",
            "madden_rating",
            "latest_ff_ranking",
        ]

    def get_games_played(self, obj):
        return obj.game_stats.count()

    def get_current_team(self, obj):
        team = _player_effective_status_context(obj)["current_team"]
        return getattr(team, "id", None)

    def get_current_team_detail(self, obj):
        team = _player_effective_status_context(obj)["current_team"]
        if not team:
            return None
        return TeamMinimalSerializer(team).data

    def get_roster_status(self, obj):
        return _player_effective_status_context(obj)["roster_status"]

    def get_roster_status_display(self, obj):
        return _player_effective_status_context(obj)["roster_status_display"]

    def get_is_active(self, obj):
        return _player_effective_status_context(obj)["is_active"]

    def get_first_season_played(self, obj):
        from django.db.models import Min

        result = obj.game_stats.aggregate(Min("season_year"))
        return result["season_year__min"]

    def get_last_season_played(self, obj):
        from django.db.models import Max

        result = obj.game_stats.aggregate(Max("season_year"))
        return result["season_year__max"]

    def get_recent_transactions(self, obj):
        txns = list(obj.transactions.select_related("from_team", "to_team")[:20])
        txns.sort(
            key=lambda txn: (
                0 if _is_roster_sync_transaction(txn) else 1,
                txn.date or date.min,
                txn.created_at,
            ),
            reverse=True,
        )
        return PlayerTransactionSerializer(txns[:10], many=True).data

    def get_madden_rating(self, obj):
        # Only return data from the current Madden game or one version behind
        min_year = _current_madden_year() - 1
        rating = (
            obj.madden_ratings.filter(madden_year__gte=min_year)
            .order_by("-madden_year")
            .first()
        )
        if not rating:
            return None
        return PlayerMaddenRatingSerializer(rating).data

    def get_latest_ff_ranking(self, obj):
        # Only show ECR from the latest season present in the rankings table.
        from django.db.models import Max

        latest_season = (
            PlayerFFRanking.objects.using("nfl")
            .aggregate(max_season=Max("season"))
            .get("max_season")
        )
        if latest_season is None:
            return None
        ranking = obj.ff_rankings.filter(season=latest_season).order_by("-week").first()
        if not ranking:
            return None
        return PlayerFFRankingSerializer(ranking).data


# =============================================================================
# SEASON & GAME
# =============================================================================


class SeasonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Season
        fields = ["year", "start_date", "end_date", "current_week", "is_active"]


class GameLeaderSerializer(serializers.ModelSerializer):
    team_abbr = serializers.CharField(source="team.abbreviation", read_only=True)

    class Meta:
        model = GameLeader
        fields = [
            "team",
            "team_abbr",
            "category",
            "athlete_espn_id",
            "athlete_name",
            "athlete_headshot_url",
            "athlete_jersey",
            "athlete_position",
            "display_value",
            "stat_value",
            "player",
        ]


class GameLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = GameLink
        fields = ["link_type", "url", "label"]


class GameHashtagSerializer(serializers.ModelSerializer):
    class Meta:
        model = GameHashtag
        fields = ["tag", "platform", "is_primary"]


class GameOfficialSerializer(serializers.ModelSerializer):
    class Meta:
        model = GameOfficial
        fields = ["id", "sequence", "name", "position"]


class PlayerInjurySerializer(serializers.ModelSerializer):
    team_abbr = serializers.CharField(
        source="team.abbreviation", read_only=True, default=None
    )
    player_display_name = serializers.CharField(
        source="player.display_name", read_only=True, default=None
    )

    class Meta:
        model = PlayerInjury
        fields = [
            "id",
            "sequence",
            "team",
            "team_abbr",
            "player",
            "player_display_name",
            "player_name",
            "player_espn_id",
            "status",
            "description",
            "game_day_availability",
            "updated_at",
        ]


class GameListSerializer(serializers.ModelSerializer):
    """
    Scoreboard-optimized game serializer.

    Includes everything the frontend needs to render a scoreboard card:
    teams with logos/colors, score, status, leaders, odds, broadcast.
    """

    home_team_detail = TeamMinimalSerializer(source="home_team", read_only=True)
    away_team_detail = TeamMinimalSerializer(source="away_team", read_only=True)
    leaders = GameLeaderSerializer(many=True, read_only=True)
    venue_name = serializers.CharField(
        source="venue.name", read_only=True, default=None
    )

    class Meta:
        model = Game
        fields = [
            "id",
            "espn_event_id",
            "nflverse_game_id",
            # Schedule
            "season_id",
            "week",
            "game_date",
            "game_time",
            "season_type",
            # Teams
            "home_team",
            "away_team",
            "home_team_detail",
            "away_team_detail",
            "venue_name",
            "is_division_game",
            "game_note",
            # Live state
            "status",
            "quarter",
            "clock",
            "home_score",
            "away_score",
            "home_score_q1",
            "home_score_q2",
            "home_score_q3",
            "home_score_q4",
            "home_score_ot",
            "away_score_q1",
            "away_score_q2",
            "away_score_q3",
            "away_score_q4",
            "away_score_ot",
            "possession_team",
            # Odds
            "spread",
            "total",
            "home_moneyline",
            "away_moneyline",
            # Broadcast
            "broadcast_network",
            "broadcast_names",
            "broadcast_market",
            # Context
            "home_record",
            "away_record",
            "home_rest",
            "away_rest",
            "home_coach",
            "away_coach",
            "home_qb_name",
            "away_qb_name",
            # Weather (outdoor games)
            "weather_temp",
            "weather_condition",
            "weather_wind",
            # Leaders
            "leaders",
        ]


class GameDetailSerializer(GameListSerializer):
    """Extended game view — includes links, hashtags, scoring plays, full weather."""

    links = GameLinkSerializer(many=True, read_only=True)
    hashtags = GameHashtagSerializer(many=True, read_only=True)
    scoring_plays = serializers.SerializerMethodField()
    officials = GameOfficialSerializer(many=True, read_only=True)
    injuries = PlayerInjurySerializer(many=True, read_only=True)
    venue_detail = VenueSerializer(source="venue", read_only=True)

    class Meta(GameListSerializer.Meta):
        fields = GameListSerializer.Meta.fields + [
            "pfr_game_id",
            "venue_detail",
            "attendance",
            "referee",
            "weather_humidity",
            "weather_detail",
            "weather_condition_id",
            "spread_line",
            "total_line",
            "spread_open",
            "total_open",
            "home_spread_odds",
            "away_spread_odds",
            "over_odds",
            "under_odds",
            "odds_provider",
            "home_qb_espn_id",
            "away_qb_espn_id",
            "links",
            "hashtags",
            "scoring_plays",
            "officials",
            "injuries",
            "is_simulation",
            "updated_at",
        ]

    def get_scoring_plays(self, obj):
        plays = obj.scoring_plays.select_related("team").order_by("sequence")
        return ScoringPlaySerializer(plays, many=True).data


# =============================================================================
# PLAY-BY-PLAY
# =============================================================================


class DriveSerializer(serializers.ModelSerializer):
    team_abbr = serializers.CharField(source="team.abbreviation", read_only=True)

    class Meta:
        model = Drive
        fields = [
            "id",
            "drive_number",
            "team",
            "team_abbr",
            "description",
            "start_quarter",
            "start_clock",
            "start_yardline",
            "end_quarter",
            "end_clock",
            "end_yardline",
            "total_yards",
            "play_count",
            "first_downs",
            "time_elapsed",
            "result",
            "is_score",
            "inside_20",
            "drive_epa",
        ]


class PlaySerializer(serializers.ModelSerializer):
    """Standard play representation for play-by-play feeds."""

    possession_team_abbr = serializers.CharField(
        source="possession_team.abbreviation", read_only=True, default=None
    )

    class Meta:
        model = Play
        fields = [
            "id",
            "drive_id",
            "sequence",
            "espn_play_id",
            # Situation
            "quarter",
            "clock",
            "game_seconds_remaining",
            "down",
            "distance",
            "yard_line",
            "down_distance_text",
            "possession_team",
            "possession_team_abbr",
            # Result
            "play_type",
            "description",
            "short_description",
            "yards_gained",
            "is_scoring_play",
            "home_score_after",
            "away_score_after",
            # Flags
            "touchdown",
            "interception",
            "fumble",
            "fumble_lost",
            "sack",
            "penalty",
            "penalty_type",
            "penalty_yards",
            "complete_pass",
            "first_down",
            # Players
            "passer_player_name",
            "rusher_player_name",
            "receiver_player_name",
        ]


class PlayDetailSerializer(PlaySerializer):
    """Extended play data with analytics — for game detail / advanced views."""

    class Meta(PlaySerializer.Meta):
        fields = PlaySerializer.Meta.fields + [
            "nflverse_play_id",
            "half_seconds_remaining",
            "quarter_seconds_remaining",
            "side_of_field",
            "defensive_team",
            "end_down",
            "end_distance",
            "end_yard_line",
            # Formation
            "shotgun",
            "no_huddle",
            "qb_dropback",
            "qb_scramble",
            # Pass detail
            "air_yards",
            "yards_after_catch",
            "pass_location",
            # Rush detail
            "run_location",
            "run_gap",
            # Player IDs
            "passer_player_id",
            "rusher_player_id",
            "receiver_player_id",
            "punt_returner_player_name",
            "punt_returner_player_id",
            "kickoff_returner_player_name",
            "kickoff_returner_player_id",
            "blocked_player_name",
            "blocked_player_id",
            "interception_player_name",
            "interception_player_id",
            "fumble_recovery_1_player_name",
            "fumble_recovery_1_team",
            "fumble_recovery_1_yards",
            "sack_player_name",
            "sack_player_id",
            "tackle_for_loss_1_player_name",
            "pass_defense_1_player_name",
            "penalty_player_name",
            "penalty_player_id",
            "penalty_team",
            # Timeout and game state
            "timeout",
            "timeout_team",
            "home_timeouts_remaining",
            "away_timeouts_remaining",
            # Play family / return detail
            "pass_attempt",
            "rush_attempt",
            "kickoff_attempt",
            "punt_attempt",
            "extra_point_attempt",
            "two_point_attempt",
            "special_teams_play",
            "st_play_type",
            "touchback",
            "out_of_bounds",
            "punt_inside_twenty",
            "punt_fair_catch",
            "kickoff_fair_catch",
            "kickoff_in_endzone",
            "return_yards",
            "return_team",
            # Kicking
            "field_goal_result",
            "kick_distance",
            # Analytics
            "epa",
            "total_home_epa",
            "total_away_epa",
            "wpa",
            "success",
            "home_wp",
            "away_wp",
            "vegas_wp",
            "vegas_home_wp",
            "ep",
            "cp",
            "cpoe",
            "td_prob",
            "fg_prob",
            "no_score_prob",
            "score_differential",
            "drive_start_transition",
            "drive_end_transition",
            "drive_yards_penalized",
            "series_result",
            "wall_clock",
        ]


class ScoringPlaySerializer(serializers.ModelSerializer):
    team_abbr = serializers.CharField(source="team.abbreviation", read_only=True)

    class Meta:
        model = ScoringPlay
        fields = [
            "id",
            "team",
            "team_abbr",
            "quarter",
            "clock",
            "score_type",
            "description",
            "home_score_after",
            "away_score_after",
            "sequence",
        ]


# =============================================================================
# STATS
# =============================================================================


class PlayerGameStatsSerializer(serializers.ModelSerializer):
    """Gamelog row — used for both box scores and player gamelog."""

    player_name = serializers.CharField(source="player.display_name", read_only=True)
    player_headshot = serializers.CharField(
        source="player.headshot_url", read_only=True
    )
    player_position = serializers.CharField(source="player.position", read_only=True)
    player_gsis_id = serializers.CharField(source="player.gsis_id", read_only=True)
    team_abbr = serializers.CharField(source="team.abbreviation", read_only=True)
    opponent_abbr = serializers.CharField(
        source="opponent.abbreviation", read_only=True
    )

    class Meta:
        model = PlayerGameStats
        fields = [
            "id",
            "player",
            "player_name",
            "player_headshot",
            "player_position",
            "player_gsis_id",
            "game",
            "team",
            "team_abbr",
            "opponent",
            "opponent_abbr",
            "season_year",
            "week",
            "season_type",
            # Passing
            "completions",
            "pass_attempts",
            "passing_yards",
            "passing_tds",
            "interceptions_thrown",
            "sacks_taken",
            "passer_rating",
            "qbr",
            "passing_epa",
            # Rushing
            "carries",
            "rushing_yards",
            "rushing_tds",
            "rushing_long",
            "rushing_epa",
            # Receiving
            "receptions",
            "targets",
            "receiving_yards",
            "receiving_tds",
            "receiving_long",
            "target_share",
            "air_yards_share",
            "wopr",
            "receiving_epa",
            # Defense
            "tackles_total",
            "tackles_solo",
            "tackles_for_loss",
            "sacks_made",
            "qb_hits",
            "passes_defended",
            "interceptions_caught",
            "interception_tds",
            "forced_fumbles",
            "fumble_recoveries",
            "defensive_tds",
            # Kicking
            "fg_attempts",
            "fg_made",
            "fg_long",
            "pat_made",
            "pat_attempts",
            # Fantasy
            "fantasy_points_standard",
            "fantasy_points_ppr",
            "fantasy_points_half_ppr",
        ]


class PlayerGameStatsCompactSerializer(serializers.ModelSerializer):
    """Minimal stats for fantasy leaderboard lists."""

    player_name = serializers.CharField(source="player.display_name", read_only=True)
    player_position = serializers.CharField(source="player.position", read_only=True)
    player_headshot = serializers.CharField(
        source="player.headshot_url", read_only=True
    )
    team_abbr = serializers.CharField(source="team.abbreviation", read_only=True)

    class Meta:
        model = PlayerGameStats
        fields = [
            "player",
            "player_name",
            "player_position",
            "player_headshot",
            "team_abbr",
            "season_year",
            "week",
            "passing_yards",
            "passing_tds",
            "rushing_yards",
            "rushing_tds",
            "receptions",
            "receiving_yards",
            "receiving_tds",
            "fantasy_points_ppr",
            "fantasy_points_half_ppr",
            "fantasy_points_standard",
        ]


class TeamGameStatsSerializer(serializers.ModelSerializer):
    team_abbr = serializers.CharField(source="team.abbreviation", read_only=True)
    opponent_abbr = serializers.CharField(
        source="opponent.abbreviation", read_only=True
    )

    class Meta:
        model = TeamGameStats
        fields = [
            "id",
            "team",
            "team_abbr",
            "game",
            "opponent",
            "opponent_abbr",
            "season_year",
            "week",
            "is_home",
            # Offense
            "total_yards",
            "total_plays",
            "first_downs",
            "first_downs_passing",
            "first_downs_rushing",
            "first_downs_penalty",
            "third_down_attempts",
            "third_down_conversions",
            "fourth_down_attempts",
            "fourth_down_conversions",
            "redzone_attempts",
            "redzone_scores",
            # Passing
            "pass_completions",
            "pass_attempts",
            "pass_yards",
            "pass_tds",
            "pass_ints",
            "sacks_allowed",
            "passer_rating",
            # Rushing
            "rush_attempts",
            "rush_yards",
            "rush_tds",
            # Turnovers
            "turnovers",
            "fumbles_lost",
            "interceptions_lost",
            # Defense
            "sacks_made",
            "takeaways",
            "interceptions_caught",
            "fumbles_recovered",
            "defensive_tds",
            # Special teams
            "punt_return_yards",
            "kick_return_yards",
            "return_tds",
            # Misc
            "penalties",
            "penalty_yards",
            "time_of_possession",
            "time_of_possession_seconds",
            "points_scored",
            "points_allowed",
            # Analytics
            "offensive_epa",
            "defensive_epa",
            "passing_epa",
            "rushing_epa",
            "fantasy_dst_points",
        ]


# =============================================================================
# ADVANCED ANALYTICS
# =============================================================================


class PlayerFFRankingSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlayerFFRanking
        fields = [
            "season",
            "week",
            "position",
            "rank",
            "rank_sd",
            "rank_best",
            "rank_worst",
            "position_rank",
        ]


class PlayerMaddenRatingSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlayerMaddenRating
        fields = [
            "madden_year",
            "position_snapshot",
            "team_snapshot",
            "overall",
            "general_rating",
            "passing_rating",
            "receiving_rating",
            "ball_carrier_rating",
            "defense_rating",
            "blocking_rating",
            "kicking_rating",
            "speed",
            "strength",
            "awareness",
            "agility",
            "acceleration",
            "tackle",
            "power_moves",
            "finesse_moves",
            "throw_power",
            "catching",
            "route_running",
            "run_block",
            "pass_block",
            "hit_power",
            "man_coverage",
            "zone_coverage",
        ]


class PlayerNextGenStatsSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlayerNextGenStats
        fields = [
            "season",
            "week",
            "season_type",
            "stat_type",
            "metrics",
        ]


# =============================================================================
# STANDINGS
# =============================================================================


class TeamStandingSerializer(serializers.ModelSerializer):
    team = TeamMinimalSerializer(read_only=True)
    season = serializers.IntegerField(source="season_id", read_only=True)
    win_pct = serializers.FloatField(source="pct", read_only=True)

    class Meta:
        model = TeamStanding
        fields = [
            "season",
            "team",
            "conference",
            "division",
            "wins",
            "losses",
            "ties",
            "pct",
            "win_pct",
            "div_rank",
            "seed",
            "points_for",
            "points_against",
            "point_diff",
            "sov",
            "sos",
            "streak",
            "last_5",
            "playoff_clincher",
            "updated_at",
        ]


class TeamDvoaRatingSerializer(serializers.ModelSerializer):
    team = TeamMinimalSerializer(read_only=True)

    class Meta:
        model = TeamDvoaRating
        fields = [
            "season",
            "season_type",
            "week",
            "team",
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
            "updated_at",
        ]


class TeamRbsdmMetricSerializer(serializers.ModelSerializer):
    team = TeamMinimalSerializer(read_only=True)

    class Meta:
        model = TeamRbsdmMetric
        fields = [
            "season",
            "week",
            "dataset",
            "team",
            "table_context",
            "metrics",
            "captured_at",
            "updated_at",
        ]


class PlayerRbsdmQbMetricSerializer(serializers.ModelSerializer):
    team = TeamMinimalSerializer(read_only=True)

    class Meta:
        model = PlayerRbsdmQbMetric
        fields = [
            "season",
            "week",
            "player",
            "player_name",
            "team",
            "adj_epa_play",
            "epa_play",
            "epa_cpoe_composite",
            "cpoe",
            "success_rate",
            "air_yards",
            "expected_cmppct",
            "cmppct",
            "plays",
            "table_context",
            "metrics",
            "captured_at",
            "updated_at",
        ]


# =============================================================================
# SIMULATION
# =============================================================================


class PlaybookSerializer(serializers.ModelSerializer):
    class Meta:
        model = Playbook
        fields = [
            "id",
            "name",
            "description",
            "source_game",
            "is_full_game",
            "play_count",
            "created_at",
        ]


class PlaybookEntrySerializer(serializers.ModelSerializer):
    play_detail = PlaySerializer(source="play", read_only=True)

    class Meta:
        model = PlaybookEntry
        fields = ["id", "sequence", "delay_seconds", "play", "play_detail"]


# =============================================================================
# NEWS
# =============================================================================


class NewsArticleSerializer(serializers.ModelSerializer):
    team_abbrs = serializers.SerializerMethodField()
    player_ids = serializers.SerializerMethodField()
    player_names = serializers.SerializerMethodField()

    def get_team_abbrs(self, obj):
        return list(obj.teams.values_list("abbreviation", flat=True))

    def get_player_ids(self, obj):
        return list(obj.players.values_list("id", flat=True))

    def get_player_names(self, obj):
        return list(obj.players.values_list("display_name", flat=True))

    class Meta:
        model = NewsArticle
        fields = [
            "id",
            "source",
            "headline",
            "summary",
            "author",
            "body",
            "url",
            "image_url",
            "published_at",
            "fetched_at",
            "team_abbrs",
            "player_ids",
            "player_names",
        ]
