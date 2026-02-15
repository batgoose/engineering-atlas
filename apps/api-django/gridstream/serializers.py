"""
Gridstream DRF Serializers.

Organized by domain: Teams, Players, Games, Plays, Stats, Simulation.
Uses nested serializers where appropriate and keeps payloads lean
for the frontend scoreboard / game detail / team / player views.
"""

from rest_framework import serializers
from .models import (
    Team,
    TeamLogo,
    Venue,
    Player,
    PlayerContract,
    PlayerCombine,
    PlayerCollegeHistory,
    PlayerTransaction,
    SocialAccount,
    GameHashtag,
    NewsSource,
    Season,
    Game,
    GameLeader,
    GameLink,
    Drive,
    Play,
    ScoringPlay,
    PlayerGameStats,
    TeamGameStats,
    Playbook,
    PlaybookEntry,
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
        # Prefer the default logo — fall back to first available
        if (
            hasattr(obj, "_prefetched_objects_cache")
            and "logos" in obj._prefetched_objects_cache
        ):
            logos = obj._prefetched_objects_cache["logos"]
        else:
            logos = list(obj.logos.all()[:4])
        for logo in logos:
            if logo.logo_type == "default":
                return logo.url
        return logos[0].url if logos else None


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

    current_team_abbr = serializers.CharField(
        source="current_team.abbreviation", read_only=True, default=None
    )
    current_team_colors = serializers.SerializerMethodField()

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
            "current_team",
            "current_team_abbr",
            "current_team_colors",
            "headshot_url",
            "is_active",
        ]

    def get_current_team_colors(self, obj):
        if obj.current_team:
            return {
                "primary": obj.current_team.color_primary,
                "secondary": obj.current_team.color_secondary,
            }
        return None


class PlayerContractSerializer(serializers.ModelSerializer):
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

    class Meta:
        model = PlayerTransaction
        fields = [
            "id",
            "transaction_type",
            "date",
            "from_team",
            "from_team_abbr",
            "to_team",
            "to_team_abbr",
            "description",
            "season",
        ]


class PlayerDetailSerializer(serializers.ModelSerializer):
    """Full player profile — /players/{id}/ endpoint."""

    current_team_detail = TeamMinimalSerializer(source="current_team", read_only=True)
    draft_team_detail = TeamMinimalSerializer(source="draft_team", read_only=True)
    contracts = PlayerContractSerializer(many=True, read_only=True)
    combine_results = PlayerCombineSerializer(many=True, read_only=True)
    college_history = PlayerCollegeHistorySerializer(many=True, read_only=True)
    social_accounts = SocialAccountSerializer(many=True, read_only=True)
    recent_transactions = serializers.SerializerMethodField()

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
            "depth_chart_position",
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
            "contracts",
            "combine_results",
            "college_history",
            "social_accounts",
            "recent_transactions",
        ]

    def get_recent_transactions(self, obj):
        txns = obj.transactions.select_related("from_team", "to_team")[:10]
        return PlayerTransactionSerializer(txns, many=True).data


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
    venue_detail = VenueSerializer(source="venue", read_only=True)

    class Meta(GameListSerializer.Meta):
        fields = GameListSerializer.Meta.fields + [
            "pfr_game_id",
            "venue_detail",
            "weather_humidity",
            "weather_detail",
            "weather_condition_id",
            "spread_open",
            "total_open",
            "odds_provider",
            "home_qb_espn_id",
            "away_qb_espn_id",
            "links",
            "hashtags",
            "scoring_plays",
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
            # Kicking
            "field_goal_result",
            "kick_distance",
            # Analytics
            "epa",
            "wpa",
            "success",
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
# STANDINGS (computed — not a model)
# =============================================================================


class StandingsEntrySerializer(serializers.Serializer):
    """Computed standings row — built from Game results in the viewset."""

    team = TeamMinimalSerializer()
    conference = serializers.CharField()
    division = serializers.CharField()
    wins = serializers.IntegerField()
    losses = serializers.IntegerField()
    ties = serializers.IntegerField()
    win_pct = serializers.FloatField()
    division_wins = serializers.IntegerField()
    division_losses = serializers.IntegerField()
    conference_wins = serializers.IntegerField()
    conference_losses = serializers.IntegerField()
    points_for = serializers.IntegerField()
    points_against = serializers.IntegerField()
    point_diff = serializers.IntegerField()
    streak = serializers.CharField()
    last_5 = serializers.CharField()


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
