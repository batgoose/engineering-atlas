"""
Redzone Platform Models

All models route to the 'nfl' database via RedzoneRouter.
Coexists with the raw nflverse `plays` table written by the Rust parser.

Model hierarchy:
  Team, TeamLogo, Venue, Player (master data)
  Season, Game, GameLeader, GameLink (game metadata)
  Drive, Play, ScoringPlay (play-by-play)
  PlayerGameStats, TeamGameStats (box scores)
  Playbook, PlaybookEntry (simulation/testing)
"""

from django.db import models
from django.contrib.postgres.fields import ArrayField

# =============================================================================
# TEAM & VENUE
# =============================================================================


class Team(models.Model):
    """NFL team master data. 32 active teams + historical (e.g., STL, SD, OAK)."""

    espn_id = models.CharField(max_length=10, unique=True, db_index=True)
    abbreviation = models.CharField(max_length=5, unique=True, db_index=True)
    slug = models.SlugField(max_length=50, unique=True)

    # Names
    location = models.CharField(max_length=50)  # "Seattle"
    name = models.CharField(max_length=50)  # "Seahawks"
    display_name = models.CharField(max_length=80)  # "Seattle Seahawks"
    short_display_name = models.CharField(max_length=50)  # "Seahawks"
    nickname = models.CharField(max_length=50, blank=True)  # "Seahawks"

    # Colors (hex without #)
    color_primary = models.CharField(max_length=6)  # "002244"
    color_secondary = models.CharField(max_length=6, blank=True)  # "69BE28"

    # Organization
    conference = models.CharField(max_length=5)  # "AFC" / "NFC"
    division = models.CharField(max_length=15)  # "NFC West"

    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["conference", "division", "display_name"]
        app_label = "redzone"

    def __str__(self):
        return self.abbreviation


class TeamLogo(models.Model):
    """Multiple logo variants per team for different display contexts."""

    LOGO_TYPE_CHOICES = [
        ("default", "Default"),
        ("dark", "Dark Background"),
        ("scoreboard", "Scoreboard"),
        ("scoreboard-dark", "Scoreboard Dark"),
    ]

    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="logos")
    logo_type = models.CharField(max_length=30, choices=LOGO_TYPE_CHOICES)
    url = models.URLField(max_length=500)
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)

    class Meta:
        unique_together = ["team", "logo_type"]
        app_label = "redzone"

    def __str__(self):
        return f"{self.team.abbreviation} ({self.logo_type})"


class Venue(models.Model):
    """NFL stadiums/venues."""

    espn_id = models.CharField(max_length=10, blank=True, db_index=True)
    name = models.CharField(max_length=100)
    city = models.CharField(max_length=60)
    state = models.CharField(max_length=30, blank=True)
    country = models.CharField(max_length=30, default="US")
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    ROOF_CHOICES = [
        ("outdoors", "Outdoors"),
        ("dome", "Dome"),
        ("retractable", "Retractable"),
    ]
    roof_type = models.CharField(
        max_length=15, choices=ROOF_CHOICES, default="outdoors"
    )
    surface = models.CharField(max_length=30, blank=True)  # "grass", "fieldturf"
    is_indoor = models.BooleanField(default=False)

    # nflverse cross-reference
    pfr_stadium_id = models.CharField(max_length=20, blank=True)

    class Meta:
        app_label = "redzone"

    def __str__(self):
        return self.name


# =============================================================================
# PLAYER
# =============================================================================


class Player(models.Model):
    """
    NFL player master data.

    Cross-references IDs across ESPN, nflverse (GSIS), PFR, PFF, OTC,
    Yahoo, Rotowire, and SportRadar for joining against contracts,
    combine, draft, and fantasy platform data.
    """

    # ── Identifiers ──────────────────────────────────────
    # Store all platform IDs for cross-referencing
    gsis_id = models.CharField(
        max_length=20,
        unique=True,
        db_index=True,
        help_text="nflverse primary ID, e.g. '00-0033873'",
    )
    espn_id = models.CharField(max_length=20, blank=True, db_index=True)
    pfr_id = models.CharField(max_length=20, blank=True, db_index=True)
    pff_id = models.CharField(max_length=20, blank=True)
    otc_id = models.CharField(
        max_length=20, blank=True, help_text="OverTheCap ID, for contract joins"
    )
    yahoo_id = models.CharField(max_length=20, blank=True)
    rotowire_id = models.CharField(max_length=20, blank=True)
    sportradar_id = models.CharField(max_length=50, blank=True)
    esb_id = models.CharField(
        max_length=20, blank=True, help_text="Elias Sports Bureau ID"
    )
    smart_id = models.CharField(max_length=50, blank=True)

    # ── Bio ──────────────────────────────────────────────
    first_name = models.CharField(max_length=50)
    last_name = models.CharField(max_length=50)
    display_name = models.CharField(max_length=80)  # "Patrick Mahomes"
    short_name = models.CharField(max_length=30, blank=True)  # "P. Mahomes"
    suffix = models.CharField(max_length=10, blank=True)  # "Jr.", "III"
    jersey_number = models.CharField(max_length=3, blank=True)

    POSITION_CHOICES = [
        ("QB", "Quarterback"),
        ("RB", "Running Back"),
        ("FB", "Fullback"),
        ("WR", "Wide Receiver"),
        ("TE", "Tight End"),
        ("OL", "Offensive Line"),
        ("C", "Center"),
        ("G", "Guard"),
        ("T", "Tackle"),
        ("K", "Kicker"),
        ("P", "Punter"),
        ("LS", "Long Snapper"),
        ("DL", "Defensive Line"),
        ("DE", "Defensive End"),
        ("DT", "Defensive Tackle"),
        ("NT", "Nose Tackle"),
        ("LB", "Linebacker"),
        ("OLB", "Outside Linebacker"),
        ("ILB", "Inside Linebacker"),
        ("MLB", "Middle Linebacker"),
        ("CB", "Cornerback"),
        ("S", "Safety"),
        ("FS", "Free Safety"),
        ("SS", "Strong Safety"),
        ("DB", "Defensive Back"),
    ]
    position = models.CharField(max_length=5, choices=POSITION_CHOICES)

    POSITION_GROUP_CHOICES = [
        ("QB", "Quarterback"),
        ("RB", "Running Back"),
        ("WR", "Wide Receiver"),
        ("TE", "Tight End"),
        ("OL", "Offensive Line"),
        ("DL", "Defensive Line"),
        ("LB", "Linebacker"),
        ("DB", "Defensive Back"),
        ("SPEC", "Special Teams"),
    ]
    position_group = models.CharField(
        max_length=5, choices=POSITION_GROUP_CHOICES, blank=True
    )

    # ── Team & Status ────────────────────────────────────
    current_team = models.ForeignKey(
        Team, on_delete=models.SET_NULL, null=True, blank=True, related_name="players"
    )
    STATUS_CHOICES = [
        ("ACT", "Active"),
        ("RES", "Reserve/Injured"),
        ("INA", "Inactive"),
        ("PUP", "PUP"),
        ("SUS", "Suspended"),
        ("NFI", "Non-Football Injury"),
        ("EXE", "Exempt"),
        ("UFA", "Unrestricted Free Agent"),
        ("RFA", "Restricted Free Agent"),
        ("RET", "Retired"),
        ("CUT", "Released"),
        ("PRA", "Practice Squad"),
    ]
    roster_status = models.CharField(
        max_length=5,
        choices=STATUS_CHOICES,
        blank=True,
        help_text="Current roster status from nflverse",
    )
    depth_chart_position = models.CharField(max_length=10, blank=True)

    # ── Media ────────────────────────────────────────────
    headshot_url = models.URLField(max_length=500, blank=True)

    # ── Physical ─────────────────────────────────────────
    height = models.CharField(max_length=10, blank=True)  # "6-4"
    height_inches = models.IntegerField(
        null=True,
        blank=True,
        help_text="Height in inches for sorting/filtering (76 = 6'4\")",
    )
    weight = models.IntegerField(null=True, blank=True)  # pounds
    birth_date = models.DateField(null=True, blank=True)

    # ── College (primary — last school) ──────────────────
    college = models.CharField(
        max_length=60,
        blank=True,
        help_text="Last/primary college. Full history in PlayerCollegeHistory.",
    )
    college_conference = models.CharField(max_length=30, blank=True)

    # ── Draft ────────────────────────────────────────────
    draft_year = models.IntegerField(null=True, blank=True)
    draft_round = models.IntegerField(null=True, blank=True)
    draft_pick = models.IntegerField(
        null=True, blank=True, help_text="Pick within the round"
    )
    draft_overall = models.IntegerField(
        null=True, blank=True, help_text="Overall pick number (1-262)"
    )
    draft_team = models.ForeignKey(
        Team,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="drafted_players",
        help_text="Team that originally drafted this player",
    )
    is_undrafted = models.BooleanField(default=False)

    # ── Experience ───────────────────────────────────────
    rookie_season = models.IntegerField(null=True, blank=True)
    entry_year = models.IntegerField(
        null=True,
        blank=True,
        help_text="Year entered the league (may differ from draft year for UDFAs)",
    )
    years_experience = models.IntegerField(null=True, blank=True)

    is_active = models.BooleanField(default=True)

    # ── Timestamps ───────────────────────────────────────
    last_roster_check = models.DateTimeField(
        null=True, blank=True, help_text="Last time roster status / team was verified"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["last_name", "first_name"]
        indexes = [
            models.Index(fields=["current_team", "position"]),
            models.Index(fields=["draft_year"]),
        ]
        app_label = "redzone"

    def __str__(self):
        team = self.current_team.abbreviation if self.current_team else "FA"
        return f"{self.display_name} ({self.position}, {team})"


class PlayerContract(models.Model):
    """
    Player contract data from OverTheCap.

    One row per contract (a player may have multiple contracts over career).
    Joined via otc_id or gsis_id.
    """

    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name="contracts"
    )
    team = models.ForeignKey(
        Team,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        help_text="Team the contract is with",
    )

    # Contract terms
    is_active = models.BooleanField(default=True)
    year_signed = models.IntegerField()
    years = models.IntegerField(help_text="Total contract length in years")
    total_value = models.BigIntegerField(help_text="Total contract value in dollars")
    apy = models.BigIntegerField(help_text="Average per year in dollars")
    guaranteed = models.BigIntegerField(
        null=True, blank=True, help_text="Total guaranteed money in dollars"
    )
    apy_cap_pct = models.FloatField(
        null=True, blank=True, help_text="APY as percentage of salary cap at signing"
    )

    # Inflation-adjusted values (from OTC)
    inflated_value = models.BigIntegerField(null=True, blank=True)
    inflated_apy = models.BigIntegerField(null=True, blank=True)
    inflated_guaranteed = models.BigIntegerField(null=True, blank=True)

    # Per-year cap details (stored as JSON for flexibility)
    # Each entry: {"year": 2025, "cap_hit": 28500000, "base_salary": 15000000, ...}
    year_details = models.JSONField(
        default=list,
        blank=True,
        help_text="Per-year breakdown: cap hit, base salary, bonuses, dead cap",
    )

    # Links
    otc_url = models.URLField(max_length=500, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-year_signed"]
        indexes = [
            models.Index(fields=["player", "is_active"]),
        ]
        app_label = "redzone"

    def __str__(self):
        team = self.team.abbreviation if self.team else "?"
        return (
            f"{self.player.display_name} - {team} "
            f"{self.years}yr/${self.total_value:,} ({self.year_signed})"
        )


class PlayerCombine(models.Model):
    """
    NFL Combine measurements and drill results.

    One row per player per combine appearance (most players attend once).
    Data from nflverse load_combine() / PFR, available since 2000.
    """

    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name="combine_results"
    )
    season = models.IntegerField(help_text="Combine year (typically draft year)")
    position = models.CharField(max_length=5, help_text="Position at combine")

    # Measurements
    height_inches = models.FloatField(null=True, blank=True)
    weight = models.IntegerField(null=True, blank=True)  # pounds
    arm_length = models.FloatField(
        null=True, blank=True, help_text="Arm length in inches"
    )
    hand_size = models.FloatField(
        null=True, blank=True, help_text="Hand size in inches"
    )
    wingspan = models.FloatField(null=True, blank=True, help_text="Wingspan in inches")

    # Drills
    forty_yard = models.FloatField(
        null=True, blank=True, help_text="40-yard dash in seconds"
    )
    twenty_yard_split = models.FloatField(
        null=True, blank=True, help_text="20-yard split in seconds"
    )
    ten_yard_split = models.FloatField(
        null=True, blank=True, help_text="10-yard split in seconds"
    )
    bench_press = models.IntegerField(
        null=True, blank=True, help_text="225lb bench press reps"
    )
    vertical_jump = models.FloatField(
        null=True, blank=True, help_text="Vertical jump in inches"
    )
    broad_jump = models.IntegerField(
        null=True, blank=True, help_text="Broad jump in inches"
    )
    three_cone = models.FloatField(
        null=True, blank=True, help_text="3-cone drill in seconds"
    )
    shuttle = models.FloatField(
        null=True, blank=True, help_text="20-yard shuttle in seconds"
    )

    # Draft context
    draft_round = models.IntegerField(null=True, blank=True)
    draft_overall = models.IntegerField(null=True, blank=True)
    draft_team = models.ForeignKey(
        Team, on_delete=models.SET_NULL, null=True, blank=True
    )

    # Links
    pfr_url = models.URLField(max_length=500, blank=True)

    class Meta:
        unique_together = ["player", "season"]
        ordering = ["-season"]
        app_label = "redzone"

    def __str__(self):
        return f"{self.player.display_name} - {self.season} Combine"


class PlayerCollegeHistory(models.Model):
    """
    College career history — supports transfers and redshirts.

    One row per college stint. A player who transferred from
    Oklahoma to USC gets two rows. Handles the transfer portal era.
    """

    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name="college_history"
    )
    college = models.CharField(max_length=80)
    conference = models.CharField(max_length=30, blank=True)

    start_year = models.IntegerField(
        null=True, blank=True, help_text="First year at this school"
    )
    end_year = models.IntegerField(
        null=True, blank=True, help_text="Last year at this school"
    )
    is_redshirt = models.BooleanField(
        default=False, help_text="Whether the player redshirted at this school"
    )
    redshirt_year = models.IntegerField(
        null=True, blank=True, help_text="Which year was the redshirt year, if known"
    )
    is_primary = models.BooleanField(
        default=False,
        help_text="True for the school they were drafted from / last attended",
    )
    sequence = models.IntegerField(
        default=1, help_text="Order of schools: 1=first, 2=transfer, etc."
    )

    class Meta:
        ordering = ["player", "sequence"]
        unique_together = ["player", "college", "sequence"]
        app_label = "redzone"

    def __str__(self):
        rs = " (RS)" if self.is_redshirt else ""
        years = ""
        if self.start_year and self.end_year:
            years = f" {self.start_year}-{self.end_year}"
        elif self.start_year:
            years = f" {self.start_year}+"
        return f"{self.player.display_name} - {self.college}{years}{rs}"


class PlayerTransaction(models.Model):
    """
    Roster transactions — tracks every team change.

    Populated by the daily roster sync command. Enables
    'team history' views and detects team changes.
    """

    TRANSACTION_CHOICES = [
        ("drafted", "Drafted"),
        ("signed", "Signed"),
        ("signed_ps", "Signed to Practice Squad"),
        ("traded", "Traded"),
        ("released", "Released"),
        ("waived", "Waived"),
        ("waived_injured", "Waived/Injured"),
        ("ir", "Placed on IR"),
        ("ir_return", "Returned from IR"),
        ("pup", "Placed on PUP"),
        ("suspended", "Suspended"),
        ("reinstated", "Reinstated"),
        ("retired", "Retired"),
        ("unretired", "Unretired"),
        ("claimed", "Claimed off Waivers"),
        ("promoted", "Promoted from Practice Squad"),
    ]

    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name="transactions"
    )
    transaction_type = models.CharField(max_length=20, choices=TRANSACTION_CHOICES)
    date = models.DateField()
    from_team = models.ForeignKey(
        Team,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="outgoing_transactions",
    )
    to_team = models.ForeignKey(
        Team,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="incoming_transactions",
    )
    description = models.TextField(blank=True)

    # For trades — link related transactions
    related_transaction = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        help_text="Links both sides of a trade",
    )

    season = models.IntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        indexes = [
            models.Index(fields=["player", "-date"]),
            models.Index(fields=["date"]),
            models.Index(fields=["to_team", "date"]),
        ]
        app_label = "redzone"

    def __str__(self):
        from_str = self.from_team.abbreviation if self.from_team else "?"
        to_str = self.to_team.abbreviation if self.to_team else "?"
        return (
            f"{self.player.display_name} {self.transaction_type} "
            f"{from_str}→{to_str} ({self.date})"
        )


# =============================================================================
# SOCIAL MEDIA & NEWS
# =============================================================================


class SocialAccount(models.Model):
    """
    Social media accounts for teams and players.

    Polymorphic via nullable FKs — exactly one of team/player should be set.
    Teams typically have multiple official accounts (main, PR, Spanish, etc).
    Player accounts sourced from ESPN athlete overview endpoint.
    """

    PLATFORM_CHOICES = [
        ("twitter", "Twitter / X"),
        ("instagram", "Instagram"),
        ("facebook", "Facebook"),
        ("tiktok", "TikTok"),
        ("youtube", "YouTube"),
        ("threads", "Threads"),
        ("bluesky", "Bluesky"),
        ("snapchat", "Snapchat"),
        ("linkedin", "LinkedIn"),
        ("twitch", "Twitch"),
    ]
    ACCOUNT_TYPE_CHOICES = [
        ("official", "Official"),
        ("pr", "Press / Communications"),
        ("spanish", "Spanish Language"),
        ("cheerleaders", "Cheerleaders / Dance Team"),
        ("mascot", "Mascot"),
        ("personal", "Personal"),
        ("fan", "Fan Account"),
    ]

    # Polymorphic link — exactly one should be set
    team = models.ForeignKey(
        "Team",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="social_accounts",
    )
    player = models.ForeignKey(
        "Player",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="social_accounts",
    )

    platform = models.CharField(max_length=15, choices=PLATFORM_CHOICES)
    account_type = models.CharField(
        max_length=15, choices=ACCOUNT_TYPE_CHOICES, default="official"
    )
    handle = models.CharField(
        max_length=100, help_text="Username/handle without @ (e.g. 'Seahawks')"
    )
    url = models.URLField(max_length=500)
    display_name = models.CharField(max_length=100, blank=True)
    is_verified = models.BooleanField(default=False)

    class Meta:
        ordering = ["platform", "account_type"]
        indexes = [
            models.Index(fields=["team", "platform"]),
            models.Index(fields=["player", "platform"]),
        ]
        app_label = "redzone"

    def __str__(self):
        owner = self.team or self.player or "?"
        return f"{owner} - {self.platform} @{self.handle}"


class GameHashtag(models.Model):
    """
    Hashtags associated with a game for social media feed aggregation.

    Auto-generated from team matchup (e.g. #SEAvsNE) plus any
    special event tags (#SuperBowl, #MNF, #SNF).
    """

    game = models.ForeignKey("Game", on_delete=models.CASCADE, related_name="hashtags")
    PLATFORM_CHOICES = [
        ("all", "All Platforms"),
        ("twitter", "Twitter / X"),
        ("instagram", "Instagram"),
        ("bluesky", "Bluesky"),
        ("threads", "Threads"),
    ]
    platform = models.CharField(max_length=15, choices=PLATFORM_CHOICES, default="all")
    tag = models.CharField(
        max_length=100, help_text="Hashtag without # (e.g. 'SEAvsNE', 'SuperBowl')"
    )
    is_primary = models.BooleanField(
        default=False, help_text="The main game hashtag (e.g. #SEAvsNE)"
    )

    class Meta:
        unique_together = ["game", "platform", "tag"]
        app_label = "redzone"

    def __str__(self):
        return f"#{self.tag} ({self.game})"


class NewsSource(models.Model):
    """
    Configured news sources for the news feed widget.

    Defines where to pull news from for different entity types.
    The API proxy reads this config to know which endpoints to hit.
    Not a cache of articles — articles are fetched live and cached
    in Redis with short TTLs.
    """

    SOURCE_TYPE_CHOICES = [
        ("espn_team", "ESPN Team News API"),
        ("espn_player", "ESPN Player News API"),
        ("espn_league", "ESPN League News API"),
        ("rss", "RSS Feed"),
        ("reddit", "Reddit Subreddit"),
        ("twitter_list", "Twitter/X List"),
    ]
    ENTITY_TYPE_CHOICES = [
        ("league", "League-wide"),
        ("team", "Team-specific"),
        ("player", "Player-specific"),
    ]

    name = models.CharField(max_length=100)
    source_type = models.CharField(max_length=20, choices=SOURCE_TYPE_CHOICES)
    entity_type = models.CharField(max_length=10, choices=ENTITY_TYPE_CHOICES)

    # For team-specific sources
    team = models.ForeignKey(
        "Team",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="news_sources",
    )

    # Endpoint config
    url_template = models.CharField(
        max_length=500,
        help_text=(
            "URL with placeholders: {team_id}, {player_id}, {espn_id}. "
            "e.g. 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team={espn_id}'"
        ),
    )
    cache_ttl_seconds = models.IntegerField(
        default=300, help_text="How long to cache results in Redis (seconds)"
    )
    is_active = models.BooleanField(default=True)
    priority = models.IntegerField(
        default=10, help_text="Lower = higher priority. Controls display order."
    )

    class Meta:
        ordering = ["priority", "name"]
        app_label = "redzone"

    def __str__(self):
        scope = self.team.abbreviation if self.team else self.entity_type
        return f"{self.name} ({scope})"


# =============================================================================
# SEASON & GAME
# =============================================================================


class Season(models.Model):
    """NFL season metadata."""

    year = models.IntegerField(unique=True, primary_key=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    current_week = models.IntegerField(default=1)
    is_active = models.BooleanField(default=False)

    class Meta:
        ordering = ["-year"]
        app_label = "redzone"

    def __str__(self):
        return str(self.year)


class Game(models.Model):
    """
    Comprehensive NFL game model.

    Stores everything needed for rich frontend display:
    odds, weather, broadcast, team records, coaches, starting QBs.
    Supports both historical (nflverse) and live (ESPN) data.
    """

    # ── Identifiers ──────────────────────────────────────
    espn_event_id = models.CharField(
        max_length=20,
        unique=True,
        db_index=True,
        help_text="ESPN event ID, e.g. '401772988'",
    )
    nflverse_game_id = models.CharField(
        max_length=30,
        blank=True,
        db_index=True,
        help_text="nflverse game ID, e.g. '2025_22_SEA_NE'",
    )
    pfr_game_id = models.CharField(max_length=20, blank=True)

    # ── Schedule ─────────────────────────────────────────
    season = models.ForeignKey(Season, on_delete=models.CASCADE, related_name="games")
    week = models.IntegerField(db_index=True)
    game_date = models.DateField()
    game_time = models.TimeField(null=True, blank=True)

    SEASON_TYPE_CHOICES = [
        ("REG", "Regular Season"),
        ("POST", "Postseason"),
        ("PRE", "Preseason"),
    ]
    season_type = models.CharField(
        max_length=4, choices=SEASON_TYPE_CHOICES, default="REG"
    )

    home_team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="home_games"
    )
    away_team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="away_games"
    )
    venue = models.ForeignKey(
        Venue, on_delete=models.SET_NULL, null=True, blank=True, related_name="games"
    )
    is_division_game = models.BooleanField(default=False)
    game_note = models.CharField(max_length=100, blank=True)  # "AFC Championship"

    # ── Live State ───────────────────────────────────────
    STATUS_CHOICES = [
        ("scheduled", "Scheduled"),
        ("in_progress", "In Progress"),
        ("halftime", "Halftime"),
        ("end_period", "End of Period"),
        ("delayed", "Delayed"),
        ("final", "Final"),
        ("final_ot", "Final (OT)"),
        ("postponed", "Postponed"),
        ("cancelled", "Cancelled"),
    ]
    status = models.CharField(
        max_length=15, choices=STATUS_CHOICES, default="scheduled"
    )
    quarter = models.IntegerField(null=True, blank=True)
    clock = models.CharField(max_length=10, blank=True)  # "4:32"

    home_score = models.IntegerField(default=0)
    away_score = models.IntegerField(default=0)
    home_score_q1 = models.IntegerField(default=0)
    home_score_q2 = models.IntegerField(default=0)
    home_score_q3 = models.IntegerField(default=0)
    home_score_q4 = models.IntegerField(default=0)
    home_score_ot = models.IntegerField(default=0)
    away_score_q1 = models.IntegerField(default=0)
    away_score_q2 = models.IntegerField(default=0)
    away_score_q3 = models.IntegerField(default=0)
    away_score_q4 = models.IntegerField(default=0)
    away_score_ot = models.IntegerField(default=0)

    possession_team = models.ForeignKey(
        Team, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # ── Odds ─────────────────────────────────────────────
    spread = models.FloatField(null=True, blank=True)  # negative = home favored
    total = models.FloatField(null=True, blank=True)  # over/under
    home_moneyline = models.IntegerField(null=True, blank=True)
    away_moneyline = models.IntegerField(null=True, blank=True)
    spread_open = models.FloatField(null=True, blank=True)
    total_open = models.FloatField(null=True, blank=True)
    odds_provider = models.CharField(max_length=50, blank=True)

    # ── Weather ──────────────────────────────────────────
    weather_temp = models.IntegerField(null=True, blank=True)
    weather_condition = models.CharField(max_length=50, blank=True)
    weather_condition_id = models.IntegerField(null=True, blank=True)
    weather_wind = models.CharField(max_length=50, blank=True)  # "12 mph NW"
    weather_humidity = models.IntegerField(null=True, blank=True)
    weather_detail = models.CharField(max_length=200, blank=True)  # full description

    # ── Broadcast ────────────────────────────────────────
    broadcast_network = models.CharField(max_length=20, blank=True)  # "FOX", "CBS"
    broadcast_names = ArrayField(
        models.CharField(max_length=50), blank=True, default=list
    )
    broadcast_market = models.CharField(max_length=20, blank=True)  # "national"

    # ── Team Context ─────────────────────────────────────
    home_record = models.CharField(max_length=15, blank=True)  # "12-5"
    away_record = models.CharField(max_length=15, blank=True)
    home_coach = models.CharField(max_length=60, blank=True)
    away_coach = models.CharField(max_length=60, blank=True)
    home_qb_name = models.CharField(max_length=60, blank=True)
    away_qb_name = models.CharField(max_length=60, blank=True)
    home_qb_espn_id = models.CharField(max_length=20, blank=True)
    away_qb_espn_id = models.CharField(max_length=20, blank=True)

    # ── Simulation ───────────────────────────────────────
    is_simulation = models.BooleanField(default=False)
    simulation_source_game = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True
    )

    # ── Timestamps ───────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-game_date", "game_time"]
        indexes = [
            models.Index(fields=["season", "week"]),
            models.Index(fields=["status"]),
            models.Index(fields=["game_date"]),
        ]
        app_label = "redzone"

    def __str__(self):
        return f"{self.away_team.abbreviation}@{self.home_team.abbreviation} Wk{self.week} ({self.season_id})"


class GameLeader(models.Model):
    """Per-game stat leaders (passing/rushing/receiving) for quick display."""

    CATEGORY_CHOICES = [
        ("passing", "Passing"),
        ("rushing", "Rushing"),
        ("receiving", "Receiving"),
    ]

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="leaders")
    team = models.ForeignKey(Team, on_delete=models.CASCADE)
    category = models.CharField(max_length=15, choices=CATEGORY_CHOICES)

    player = models.ForeignKey(Player, on_delete=models.SET_NULL, null=True, blank=True)
    athlete_espn_id = models.CharField(max_length=20, blank=True)
    athlete_name = models.CharField(max_length=80)
    athlete_headshot_url = models.URLField(max_length=500, blank=True)
    athlete_jersey = models.CharField(max_length=3, blank=True)
    athlete_position = models.CharField(max_length=5, blank=True)

    display_value = models.CharField(max_length=50)  # "280 YDS, 2 TD"
    stat_value = models.FloatField(default=0)  # sortable numeric value

    class Meta:
        unique_together = ["game", "team", "category"]
        app_label = "redzone"

    def __str__(self):
        return f"{self.athlete_name} ({self.category}) - {self.display_value}"


class GameLink(models.Model):
    """External links associated with a game (streams, threads, social tags)."""

    LINK_TYPE_CHOICES = [
        ("official_stream", "Official Stream"),
        ("reddit_thread", "Reddit Game Thread"),
        ("social_hashtag", "Social Media Hashtag"),
        ("nflbite", "NFLBite Stream"),
        ("highlight", "Highlight Reel"),
        ("recap", "Recap Article"),
    ]

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="links")
    link_type = models.CharField(max_length=20, choices=LINK_TYPE_CHOICES)
    url = models.URLField(max_length=500, blank=True)
    label = models.CharField(max_length=100, blank=True)  # "#SEAvsNE", "FOX Stream"

    class Meta:
        app_label = "redzone"

    def __str__(self):
        return f"{self.game} - {self.link_type}: {self.label}"


# =============================================================================
# PLAY-BY-PLAY
# =============================================================================


class Drive(models.Model):
    """Drive summary within a game."""

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="drives")
    team = models.ForeignKey(Team, on_delete=models.CASCADE)
    drive_number = models.IntegerField()
    description = models.CharField(max_length=200, blank=True)

    # Start/end
    start_quarter = models.IntegerField(null=True, blank=True)
    start_clock = models.CharField(max_length=10, blank=True)
    start_yardline = models.IntegerField(null=True, blank=True)
    end_quarter = models.IntegerField(null=True, blank=True)
    end_clock = models.CharField(max_length=10, blank=True)
    end_yardline = models.IntegerField(null=True, blank=True)

    # Totals
    total_yards = models.IntegerField(default=0)
    play_count = models.IntegerField(default=0)
    first_downs = models.IntegerField(default=0)
    time_elapsed = models.CharField(max_length=10, blank=True)  # "3:42"

    RESULT_CHOICES = [
        ("touchdown", "Touchdown"),
        ("field_goal", "Field Goal"),
        ("punt", "Punt"),
        ("turnover", "Turnover"),
        ("turnover_on_downs", "Turnover on Downs"),
        ("safety", "Safety"),
        ("end_of_half", "End of Half"),
        ("end_of_game", "End of Game"),
        ("missed_fg", "Missed FG"),
    ]
    result = models.CharField(max_length=20, choices=RESULT_CHOICES, blank=True)
    is_score = models.BooleanField(default=False)
    inside_20 = models.BooleanField(default=False)

    # Analytics (nflverse — nullable)
    drive_epa = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = ["game", "drive_number"]
        ordering = ["game", "drive_number"]
        app_label = "redzone"

    def __str__(self):
        return f"Drive {self.drive_number} ({self.team.abbreviation}) - {self.result}"


class Play(models.Model):
    """
    Atomic play-by-play record.

    Designed to hold data from BOTH nflverse (historical) and ESPN (live).
    nflverse-only fields (EPA, WPA, air_yards, etc.) are nullable.
    """

    # ── Identifiers ──────────────────────────────────────
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="plays")
    drive = models.ForeignKey(
        Drive, on_delete=models.SET_NULL, null=True, blank=True, related_name="plays"
    )

    # ESPN play ID + nflverse play ID (both float in nflverse)
    espn_play_id = models.CharField(max_length=20, blank=True)
    nflverse_play_id = models.FloatField(null=True, blank=True)
    sequence = models.IntegerField(help_text="Ordering within the game (0-indexed)")

    # ── Situation (pre-snap) ─────────────────────────────
    quarter = models.IntegerField(null=True, blank=True)
    clock = models.CharField(max_length=10, blank=True)  # "4:32"
    game_seconds_remaining = models.FloatField(null=True, blank=True)
    half_seconds_remaining = models.FloatField(null=True, blank=True)
    quarter_seconds_remaining = models.FloatField(null=True, blank=True)

    down = models.IntegerField(null=True, blank=True)
    distance = models.IntegerField(null=True, blank=True)
    yard_line = models.IntegerField(null=True, blank=True)  # yardline_100
    side_of_field = models.CharField(max_length=5, blank=True)
    down_distance_text = models.CharField(max_length=30, blank=True)  # "3rd & 7"

    possession_team = models.ForeignKey(
        Team,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="offensive_plays",
    )
    defensive_team = models.ForeignKey(
        Team,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="defensive_plays",
    )

    # ── Result ───────────────────────────────────────────
    PLAY_TYPE_CHOICES = [
        ("pass", "Pass"),
        ("run", "Run"),
        ("punt", "Punt"),
        ("kickoff", "Kickoff"),
        ("field_goal", "Field Goal"),
        ("extra_point", "Extra Point"),
        ("two_point_attempt", "Two Point Attempt"),
        ("qb_kneel", "QB Kneel"),
        ("qb_spike", "QB Spike"),
        ("no_play", "No Play (Penalty)"),
        ("end_of_half", "End of Half"),
    ]
    play_type = models.CharField(max_length=20, choices=PLAY_TYPE_CHOICES, blank=True)
    description = models.TextField(blank=True)
    short_description = models.CharField(max_length=200, blank=True)
    yards_gained = models.FloatField(null=True, blank=True)

    is_scoring_play = models.BooleanField(default=False)
    home_score_after = models.IntegerField(default=0)
    away_score_after = models.IntegerField(default=0)

    # End state
    end_down = models.IntegerField(null=True, blank=True)
    end_distance = models.IntegerField(null=True, blank=True)
    end_yard_line = models.IntegerField(null=True, blank=True)

    # ── Flags ────────────────────────────────────────────
    touchdown = models.BooleanField(default=False)
    interception = models.BooleanField(default=False)
    fumble = models.BooleanField(default=False)
    fumble_lost = models.BooleanField(default=False)
    sack = models.BooleanField(default=False)
    penalty = models.BooleanField(default=False)
    penalty_type = models.CharField(max_length=80, blank=True)
    penalty_yards = models.IntegerField(null=True, blank=True)
    complete_pass = models.BooleanField(default=False)
    first_down = models.BooleanField(default=False)

    # ── Formation (nflverse — nullable) ──────────────────
    shotgun = models.BooleanField(null=True, blank=True)
    no_huddle = models.BooleanField(null=True, blank=True)
    qb_dropback = models.BooleanField(null=True, blank=True)
    qb_scramble = models.BooleanField(null=True, blank=True)

    # ── Pass detail (nflverse) ───────────────────────────
    air_yards = models.FloatField(null=True, blank=True)
    yards_after_catch = models.FloatField(null=True, blank=True)
    PASS_LOCATION_CHOICES = [
        ("left", "Left"),
        ("middle", "Middle"),
        ("right", "Right"),
    ]
    pass_location = models.CharField(
        max_length=6, choices=PASS_LOCATION_CHOICES, blank=True
    )

    # ── Rush detail (nflverse) ───────────────────────────
    RUN_LOCATION_CHOICES = [
        ("left", "Left"),
        ("middle", "Middle"),
        ("right", "Right"),
    ]
    run_location = models.CharField(
        max_length=6, choices=RUN_LOCATION_CHOICES, blank=True
    )
    RUN_GAP_CHOICES = [
        ("guard", "Guard"),
        ("tackle", "Tackle"),
        ("end", "End"),
    ]
    run_gap = models.CharField(max_length=6, choices=RUN_GAP_CHOICES, blank=True)

    # ── Player IDs (nflverse) ────────────────────────────
    passer_player_name = models.CharField(max_length=60, blank=True)
    passer_player_id = models.CharField(max_length=20, blank=True)
    rusher_player_name = models.CharField(max_length=60, blank=True)
    rusher_player_id = models.CharField(max_length=20, blank=True)
    receiver_player_name = models.CharField(max_length=60, blank=True)
    receiver_player_id = models.CharField(max_length=20, blank=True)

    # ── Kicking ──────────────────────────────────────────
    field_goal_result = models.CharField(max_length=10, blank=True)
    kick_distance = models.FloatField(null=True, blank=True)

    # ── Analytics (nflverse — nullable) ──────────────────
    epa = models.FloatField(null=True, blank=True)
    wpa = models.FloatField(null=True, blank=True)
    success = models.FloatField(null=True, blank=True)

    # ── Timestamps ───────────────────────────────────────
    wall_clock = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["game", "sequence"]
        indexes = [
            models.Index(fields=["game", "sequence"]),
            models.Index(fields=["game", "quarter"]),
            models.Index(fields=["possession_team"]),
        ]
        unique_together = ["game", "sequence"]
        app_label = "redzone"

    def __str__(self):
        return f"Play {self.sequence} Q{self.quarter}: {self.short_description or self.play_type}"


class ScoringPlay(models.Model):
    """Denormalized scoring summary for fast rendering."""

    SCORE_TYPE_CHOICES = [
        ("TD", "Touchdown"),
        ("FG", "Field Goal"),
        ("PAT", "Extra Point"),
        ("2PT", "Two-Point Conversion"),
        ("SFTY", "Safety"),
        ("D-TD", "Defensive Touchdown"),
    ]

    game = models.ForeignKey(
        Game, on_delete=models.CASCADE, related_name="scoring_plays"
    )
    play = models.OneToOneField(Play, on_delete=models.CASCADE, null=True, blank=True)
    team = models.ForeignKey(Team, on_delete=models.CASCADE)

    quarter = models.IntegerField()
    clock = models.CharField(max_length=10, blank=True)
    score_type = models.CharField(max_length=5, choices=SCORE_TYPE_CHOICES)
    description = models.TextField(blank=True)
    home_score_after = models.IntegerField(default=0)
    away_score_after = models.IntegerField(default=0)

    sequence = models.IntegerField(default=0)

    class Meta:
        ordering = ["game", "sequence"]
        app_label = "redzone"

    def __str__(self):
        return (
            f"Q{self.quarter} {self.clock} {self.score_type} {self.team.abbreviation}"
        )


# =============================================================================
# PLAYER & TEAM GAME STATS (BOX SCORES)
# =============================================================================


class PlayerGameStats(models.Model):
    """
    Per-player, per-game statistics — the box score row.

    Covers passing, rushing, receiving, defense, special teams, kicking.
    Fantasy points (standard, PPR, half-PPR) are pre-computed on save.
    """

    # ── Keys ─────────────────────────────────────────────
    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name="game_stats"
    )
    game = models.ForeignKey(
        Game, on_delete=models.CASCADE, related_name="player_stats"
    )
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="+")
    opponent = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="+")
    season_year = models.IntegerField()
    week = models.IntegerField()
    season_type = models.CharField(max_length=4, default="REG")

    # ── Passing ──────────────────────────────────────────
    completions = models.IntegerField(default=0)
    pass_attempts = models.IntegerField(default=0)
    passing_yards = models.IntegerField(default=0)
    passing_tds = models.IntegerField(default=0)
    interceptions_thrown = models.IntegerField(default=0)
    sacks_taken = models.IntegerField(default=0)
    sack_yards_lost = models.IntegerField(default=0)
    sack_fumbles = models.IntegerField(default=0)
    sack_fumbles_lost = models.IntegerField(default=0)
    passing_air_yards = models.IntegerField(default=0)
    passing_yards_after_catch = models.IntegerField(default=0)
    passing_first_downs = models.IntegerField(default=0)
    passing_2pt_conversions = models.IntegerField(default=0)
    passing_epa = models.FloatField(null=True, blank=True)
    passer_rating = models.FloatField(null=True, blank=True)
    qbr = models.FloatField(null=True, blank=True)

    # ── Rushing ──────────────────────────────────────────
    carries = models.IntegerField(default=0)
    rushing_yards = models.IntegerField(default=0)
    rushing_tds = models.IntegerField(default=0)
    rushing_fumbles = models.IntegerField(default=0)
    rushing_fumbles_lost = models.IntegerField(default=0)
    rushing_first_downs = models.IntegerField(default=0)
    rushing_2pt_conversions = models.IntegerField(default=0)
    rushing_epa = models.FloatField(null=True, blank=True)
    rushing_long = models.IntegerField(default=0)

    # ── Receiving ────────────────────────────────────────
    receptions = models.IntegerField(default=0)
    targets = models.IntegerField(default=0)
    receiving_yards = models.IntegerField(default=0)
    receiving_tds = models.IntegerField(default=0)
    receiving_fumbles = models.IntegerField(default=0)
    receiving_fumbles_lost = models.IntegerField(default=0)
    receiving_air_yards = models.IntegerField(default=0)
    receiving_yards_after_catch = models.IntegerField(default=0)
    receiving_first_downs = models.IntegerField(default=0)
    receiving_2pt_conversions = models.IntegerField(default=0)
    receiving_epa = models.FloatField(null=True, blank=True)
    receiving_long = models.IntegerField(default=0)
    target_share = models.FloatField(null=True, blank=True)
    air_yards_share = models.FloatField(null=True, blank=True)
    wopr = models.FloatField(null=True, blank=True)

    # ── Defense ──────────────────────────────────────────
    tackles_total = models.IntegerField(default=0)
    tackles_solo = models.IntegerField(default=0)
    tackles_assists = models.IntegerField(default=0)
    tackles_for_loss = models.FloatField(default=0)  # can be 0.5
    sacks_made = models.FloatField(default=0)  # can be 0.5
    qb_hits = models.IntegerField(default=0)
    passes_defended = models.IntegerField(default=0)
    interceptions_caught = models.IntegerField(default=0)
    interception_yards = models.IntegerField(default=0)
    interception_tds = models.IntegerField(default=0)
    forced_fumbles = models.IntegerField(default=0)
    fumble_recoveries = models.IntegerField(default=0)
    defensive_tds = models.IntegerField(default=0)
    safeties = models.IntegerField(default=0)
    blocked_kicks = models.IntegerField(default=0)

    # ── Special Teams ────────────────────────────────────
    kick_return_attempts = models.IntegerField(default=0)
    kick_return_yards = models.IntegerField(default=0)
    kick_return_tds = models.IntegerField(default=0)
    punt_return_attempts = models.IntegerField(default=0)
    punt_return_yards = models.IntegerField(default=0)
    punt_return_tds = models.IntegerField(default=0)
    special_teams_tds = models.IntegerField(default=0)

    # ── Kicking ──────────────────────────────────────────
    fg_attempts = models.IntegerField(default=0)
    fg_made = models.IntegerField(default=0)
    fg_long = models.IntegerField(default=0)
    fg_made_0_19 = models.IntegerField(default=0)
    fg_made_20_29 = models.IntegerField(default=0)
    fg_made_30_39 = models.IntegerField(default=0)
    fg_made_40_49 = models.IntegerField(default=0)
    fg_made_50_59 = models.IntegerField(default=0)
    fg_made_60_plus = models.IntegerField(default=0)
    pat_attempts = models.IntegerField(default=0)
    pat_made = models.IntegerField(default=0)
    pat_missed = models.IntegerField(default=0)

    # ── Punting ──────────────────────────────────────────
    punt_attempts = models.IntegerField(default=0)
    punt_yards = models.IntegerField(default=0)
    punt_long = models.IntegerField(default=0)
    punt_inside_20 = models.IntegerField(default=0)
    punt_touchbacks = models.IntegerField(default=0)

    # ── Fantasy Points (pre-computed) ────────────────────
    fantasy_points_standard = models.FloatField(null=True, blank=True)
    fantasy_points_ppr = models.FloatField(null=True, blank=True)
    fantasy_points_half_ppr = models.FloatField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ["player", "game"]
        ordering = ["-season_year", "-week"]
        indexes = [
            models.Index(fields=["game", "team"]),
            models.Index(fields=["player", "season_year", "week"]),
            models.Index(fields=["season_year", "week", "fantasy_points_ppr"]),
        ]
        app_label = "redzone"

    def __str__(self):
        return (
            f"{self.player.short_name or self.player.display_name} "
            f"Wk{self.week}: {self.passing_yards}pass/{self.rushing_yards}rush/"
            f"{self.receiving_yards}rec"
        )

    def calculate_fantasy_points(self, scoring="standard"):
        """Calculate fantasy points for standard, PPR, or half_PPR scoring."""
        pts = 0.0
        # Passing
        pts += self.passing_yards * 0.04
        pts += self.passing_tds * 4
        pts += self.interceptions_thrown * -2
        pts += self.sack_fumbles_lost * -2
        # Rushing
        pts += self.rushing_yards * 0.1
        pts += self.rushing_tds * 6
        pts += self.rushing_fumbles_lost * -2
        # Receiving
        pts += self.receiving_yards * 0.1
        pts += self.receiving_tds * 6
        pts += self.receiving_fumbles_lost * -2
        if scoring == "ppr":
            pts += self.receptions * 1.0
        elif scoring == "half_ppr":
            pts += self.receptions * 0.5
        # 2-pt conversions
        pts += (
            self.passing_2pt_conversions
            + self.rushing_2pt_conversions
            + self.receiving_2pt_conversions
        ) * 2
        # Return TDs
        pts += (self.kick_return_tds + self.punt_return_tds) * 6
        # Kicking
        pts += (self.fg_made_0_19 + self.fg_made_20_29 + self.fg_made_30_39) * 3
        pts += self.fg_made_40_49 * 4
        pts += self.fg_made_50_59 * 5
        pts += self.fg_made_60_plus * 6
        pts += self.pat_made * 1
        pts += self.pat_missed * -1
        return round(pts, 2)

    def save(self, *args, **kwargs):
        """Auto-compute fantasy points on save."""
        self.fantasy_points_standard = self.calculate_fantasy_points("standard")
        self.fantasy_points_ppr = self.calculate_fantasy_points("ppr")
        self.fantasy_points_half_ppr = self.calculate_fantasy_points("half_ppr")
        super().save(*args, **kwargs)


class TeamGameStats(models.Model):
    """Aggregate team stats per game — the team box score line."""

    # ── Keys ─────────────────────────────────────────────
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="game_stats")
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="team_stats")
    opponent = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="+")
    season_year = models.IntegerField()
    week = models.IntegerField()
    is_home = models.BooleanField()

    # ── Offense ──────────────────────────────────────────
    total_yards = models.IntegerField(default=0)
    total_plays = models.IntegerField(default=0)
    first_downs = models.IntegerField(default=0)
    first_downs_passing = models.IntegerField(default=0)
    first_downs_rushing = models.IntegerField(default=0)
    first_downs_penalty = models.IntegerField(default=0)
    third_down_attempts = models.IntegerField(default=0)
    third_down_conversions = models.IntegerField(default=0)
    fourth_down_attempts = models.IntegerField(default=0)
    fourth_down_conversions = models.IntegerField(default=0)
    redzone_attempts = models.IntegerField(default=0)
    redzone_scores = models.IntegerField(default=0)

    # ── Passing ──────────────────────────────────────────
    pass_completions = models.IntegerField(default=0)
    pass_attempts = models.IntegerField(default=0)
    pass_yards = models.IntegerField(default=0)
    pass_tds = models.IntegerField(default=0)
    pass_ints = models.IntegerField(default=0)
    sacks_allowed = models.IntegerField(default=0)
    sack_yards_allowed = models.IntegerField(default=0)
    passer_rating = models.FloatField(null=True, blank=True)

    # ── Rushing ──────────────────────────────────────────
    rush_attempts = models.IntegerField(default=0)
    rush_yards = models.IntegerField(default=0)
    rush_tds = models.IntegerField(default=0)

    # ── Turnovers ────────────────────────────────────────
    turnovers = models.IntegerField(default=0)
    fumbles_lost = models.IntegerField(default=0)
    interceptions_lost = models.IntegerField(default=0)

    # ── Defense ──────────────────────────────────────────
    sacks_made = models.FloatField(default=0)
    takeaways = models.IntegerField(default=0)
    interceptions_caught = models.IntegerField(default=0)
    fumbles_recovered = models.IntegerField(default=0)
    defensive_tds = models.IntegerField(default=0)

    # ── Special Teams ────────────────────────────────────
    punt_return_yards = models.IntegerField(default=0)
    kick_return_yards = models.IntegerField(default=0)
    return_tds = models.IntegerField(default=0)

    # ── Penalties ────────────────────────────────────────
    penalties = models.IntegerField(default=0)
    penalty_yards = models.IntegerField(default=0)

    # ── Time of Possession ───────────────────────────────
    time_of_possession = models.CharField(max_length=10, blank=True)
    time_of_possession_seconds = models.IntegerField(default=0)

    # ── Score ────────────────────────────────────────────
    points_scored = models.IntegerField(default=0)
    points_allowed = models.IntegerField(default=0)

    # ── Analytics (nflverse) ─────────────────────────────
    offensive_epa = models.FloatField(null=True, blank=True)
    defensive_epa = models.FloatField(null=True, blank=True)
    passing_epa = models.FloatField(null=True, blank=True)
    rushing_epa = models.FloatField(null=True, blank=True)

    # ── Fantasy DST ──────────────────────────────────────
    fantasy_dst_points = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = ["team", "game"]
        ordering = ["-season_year", "-week"]
        indexes = [
            models.Index(fields=["team", "season_year"]),
        ]
        app_label = "redzone"

    def __str__(self):
        return f"{self.team.abbreviation} Wk{self.week}: {self.points_scored}pts"


# =============================================================================
# SIMULATION / TESTING
# =============================================================================


class Playbook(models.Model):
    """Curated sequence of plays for testing/demo purposes."""

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    source_game = models.ForeignKey(
        Game,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        help_text="If this playbook is a full game replay, the source game.",
    )
    is_full_game = models.BooleanField(
        default=False,
        help_text="True if this contains every play from the source game.",
    )
    play_count = models.IntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        app_label = "redzone"

    def __str__(self):
        return self.name


class PlaybookEntry(models.Model):
    """An ordered play within a playbook."""

    playbook = models.ForeignKey(
        Playbook, on_delete=models.CASCADE, related_name="entries"
    )
    play = models.ForeignKey(Play, on_delete=models.CASCADE)
    sequence = models.IntegerField()
    delay_seconds = models.FloatField(
        default=5.0, help_text="Seconds to wait before broadcasting this play."
    )

    class Meta:
        unique_together = ["playbook", "sequence"]
        ordering = ["playbook", "sequence"]
        app_label = "redzone"

    def __str__(self):
        return f"{self.playbook.name} #{self.sequence}"
