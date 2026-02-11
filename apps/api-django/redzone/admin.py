from django.contrib import admin
from .models import (
    Team, TeamLogo, Venue, Player, PlayerContract, PlayerCombine,
    PlayerCollegeHistory, PlayerTransaction, SocialAccount, GameHashtag,
    NewsSource, Season, Game, GameLeader, GameLink, Drive, Play,
    ScoringPlay, PlayerGameStats, TeamGameStats, Playbook, PlaybookEntry,
)


# =============================================================================
# MULTI-DB ADMIN MIXIN
# =============================================================================

class NflDbAdmin(admin.ModelAdmin):
    """Base admin that reads/writes to the nfl database."""
    using = "nfl"

    def save_model(self, request, obj, form, change):
        obj.save(using=self.using)

    def delete_model(self, request, obj):
        obj.delete(using=self.using)

    def get_queryset(self, request):
        return super().get_queryset(request).using(self.using)

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        kwargs["using"] = self.using
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        kwargs["using"] = self.using
        return super().formfield_for_manytomany(db_field, request, **kwargs)


# =============================================================================
# TEAM
# =============================================================================

class TeamLogoInline(admin.TabularInline):
    model = TeamLogo
    extra = 0


@admin.register(Team)
class TeamAdmin(NflDbAdmin):
    list_display = ("abbreviation", "display_name", "conference", "division", "is_active")
    list_filter = ("conference", "division", "is_active")
    search_fields = ("abbreviation", "display_name", "location")
    inlines = [TeamLogoInline]


@admin.register(Venue)
class VenueAdmin(NflDbAdmin):
    list_display = ("name", "city", "state", "roof_type", "surface")
    list_filter = ("roof_type",)
    search_fields = ("name", "city")


# =============================================================================
# PLAYER
# =============================================================================

@admin.register(Player)
class PlayerAdmin(NflDbAdmin):
    list_display = ("display_name", "position", "current_team", "jersey_number", "roster_status", "is_active")
    list_filter = ("position", "position_group", "roster_status", "is_active")
    search_fields = ("display_name", "first_name", "last_name", "gsis_id", "espn_id")
    raw_id_fields = ("current_team", "draft_team")


class PlayerContractInline(admin.TabularInline):
    model = PlayerContract
    extra = 0
    raw_id_fields = ("team",)


@admin.register(PlayerContract)
class PlayerContractAdmin(NflDbAdmin):
    list_display = ("player", "team", "year_signed", "years", "total_value", "apy", "is_active")
    list_filter = ("is_active", "year_signed")
    raw_id_fields = ("player", "team")
    search_fields = ("player__display_name",)


@admin.register(PlayerCombine)
class PlayerCombineAdmin(NflDbAdmin):
    list_display = ("player", "season", "position", "forty_yard", "bench_press", "vertical_jump", "broad_jump")
    list_filter = ("season", "position")
    raw_id_fields = ("player", "draft_team")
    search_fields = ("player__display_name",)


@admin.register(PlayerCollegeHistory)
class PlayerCollegeHistoryAdmin(NflDbAdmin):
    list_display = ("player", "college", "conference", "start_year", "end_year", "is_redshirt", "is_primary")
    list_filter = ("is_primary", "is_redshirt")
    raw_id_fields = ("player",)
    search_fields = ("player__display_name", "college")


@admin.register(PlayerTransaction)
class PlayerTransactionAdmin(NflDbAdmin):
    list_display = ("player", "transaction_type", "date", "from_team", "to_team")
    list_filter = ("transaction_type", "season")
    raw_id_fields = ("player", "from_team", "to_team", "related_transaction")
    search_fields = ("player__display_name",)
    date_hierarchy = "date"


# =============================================================================
# SOCIAL & NEWS
# =============================================================================

@admin.register(SocialAccount)
class SocialAccountAdmin(NflDbAdmin):
    list_display = ("handle", "platform", "account_type", "team", "player", "is_verified")
    list_filter = ("platform", "account_type", "is_verified")
    raw_id_fields = ("team", "player")
    search_fields = ("handle", "display_name")


@admin.register(GameHashtag)
class GameHashtagAdmin(NflDbAdmin):
    list_display = ("tag", "game", "platform", "is_primary")
    list_filter = ("platform", "is_primary")
    raw_id_fields = ("game",)
    search_fields = ("tag",)


@admin.register(NewsSource)
class NewsSourceAdmin(NflDbAdmin):
    list_display = ("name", "source_type", "entity_type", "team", "is_active", "priority")
    list_filter = ("source_type", "entity_type", "is_active")
    raw_id_fields = ("team",)


# =============================================================================
# GAME
# =============================================================================

class GameLeaderInline(admin.TabularInline):
    model = GameLeader
    extra = 0
    raw_id_fields = ("team", "player")


class GameLinkInline(admin.TabularInline):
    model = GameLink
    extra = 0

class GameHashtagInline(admin.TabularInline):
    model = GameHashtag
    extra = 0


@admin.register(Season)
class SeasonAdmin(NflDbAdmin):
    list_display = ("year", "is_active", "current_week")


@admin.register(Game)
class GameAdmin(NflDbAdmin):
    list_display = (
        "nflverse_game_id", "away_team", "home_team", "status",
        "away_score", "home_score", "week", "season", "game_date",
    )
    list_filter = ("status", "season_type", "season", "week")
    search_fields = ("nflverse_game_id", "espn_event_id", "game_note")
    raw_id_fields = ("home_team", "away_team", "venue", "possession_team")
    inlines = [GameLeaderInline, GameLinkInline, GameHashtagInline]


# =============================================================================
# PLAY-BY-PLAY
# =============================================================================

@admin.register(Drive)
class DriveAdmin(NflDbAdmin):
    list_display = ("game", "drive_number", "team", "result", "total_yards", "play_count")
    list_filter = ("result",)
    raw_id_fields = ("game", "team")


@admin.register(Play)
class PlayAdmin(NflDbAdmin):
    list_display = ("game", "sequence", "quarter", "play_type", "yards_gained", "description_short")
    list_filter = ("play_type", "quarter", "touchdown", "interception")
    raw_id_fields = ("game", "drive", "possession_team", "defensive_team")
    search_fields = ("description",)

    def description_short(self, obj):
        return (obj.description or "")[:80]
    description_short.short_description = "Description"


@admin.register(ScoringPlay)
class ScoringPlayAdmin(NflDbAdmin):
    list_display = ("game", "quarter", "clock", "score_type", "team", "home_score_after", "away_score_after")
    raw_id_fields = ("game", "play", "team")


# =============================================================================
# STATS
# =============================================================================

@admin.register(PlayerGameStats)
class PlayerGameStatsAdmin(NflDbAdmin):
    list_display = (
        "player", "game", "team", "passing_yards", "rushing_yards",
        "receiving_yards", "fantasy_points_ppr",
    )
    list_filter = ("season_year", "week")
    raw_id_fields = ("player", "game", "team", "opponent")
    search_fields = ("player__display_name",)


@admin.register(TeamGameStats)
class TeamGameStatsAdmin(NflDbAdmin):
    list_display = ("team", "game", "points_scored", "total_yards", "turnovers")
    list_filter = ("season_year",)
    raw_id_fields = ("team", "game", "opponent")


# =============================================================================
# SIMULATION
# =============================================================================

class PlaybookEntryInline(admin.TabularInline):
    model = PlaybookEntry
    extra = 0
    raw_id_fields = ("play",)


@admin.register(Playbook)
class PlaybookAdmin(NflDbAdmin):
    list_display = ("name", "source_game", "is_full_game", "play_count")
    inlines = [PlaybookEntryInline]
