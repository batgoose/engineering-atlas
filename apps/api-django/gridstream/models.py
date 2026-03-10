"""
Gridstream Platform Models

All models route to the 'nfl' database via GridstreamRouter.
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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
        ("DEV", "Developmental"),
        ("RES", "Reserve/Injured"),
        ("RSR", "Reserve"),
        ("RSN", "Reserve/Future"),
        ("INA", "Inactive"),
        ("NWT", "Not With Team"),
        ("PUP", "PUP"),
        ("SUS", "Suspended"),
        ("NFI", "Non-Football Injury"),
        ("EXE", "Exempt"),
        ("TRD", "Traded"),
        ("TRC", "Trade Complete"),
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
    depth_chart_rank = models.PositiveSmallIntegerField(null=True, blank=True)
    depth_chart_status = models.CharField(max_length=50, blank=True)

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

    # ── Materialized career stats ─────────────────────────
    # Populated by `manage.py materialize_player_career_stats`.
    # Used by the players directory to avoid a 2s GROUP BY over PlayerGameStats.
    mat_games_played = models.IntegerField(default=0)
    mat_seasons_count = models.IntegerField(default=0)
    mat_first_season = models.IntegerField(null=True, blank=True)
    mat_last_season = models.IntegerField(null=True, blank=True)
    mat_completions = models.IntegerField(default=0)
    mat_pass_attempts = models.IntegerField(default=0)
    mat_passing_yards = models.IntegerField(default=0)
    mat_passing_tds = models.IntegerField(default=0)
    mat_interceptions_thrown = models.IntegerField(default=0)
    mat_sacks_taken = models.IntegerField(default=0)
    mat_carries = models.IntegerField(default=0)
    mat_rushing_yards = models.IntegerField(default=0)
    mat_rushing_tds = models.IntegerField(default=0)
    mat_rushing_long = models.IntegerField(default=0)
    mat_receptions = models.IntegerField(default=0)
    mat_targets = models.IntegerField(default=0)
    mat_receiving_yards = models.IntegerField(default=0)
    mat_receiving_tds = models.IntegerField(default=0)
    mat_receiving_long = models.IntegerField(default=0)
    mat_pass_first_downs = models.IntegerField(default=0)
    mat_rush_first_downs = models.IntegerField(default=0)
    mat_rec_first_downs = models.IntegerField(default=0)
    mat_fumbles_rushing = models.IntegerField(default=0)
    mat_fumbles_receiving = models.IntegerField(default=0)
    mat_fumbles_sacks = models.IntegerField(default=0)
    mat_fumbles_lost_rushing = models.IntegerField(default=0)
    mat_fumbles_lost_receiving = models.IntegerField(default=0)
    mat_fumbles_lost_sacks = models.IntegerField(default=0)
    mat_tackles_total = models.IntegerField(default=0)
    mat_sacks_made = models.FloatField(default=0.0)
    mat_interceptions_caught = models.IntegerField(default=0)
    mat_passes_defended = models.IntegerField(default=0)
    mat_forced_fumbles = models.IntegerField(default=0)
    mat_fg_made = models.IntegerField(default=0)
    mat_fg_attempts = models.IntegerField(default=0)
    mat_punt_attempts = models.IntegerField(default=0)

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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
    contract_years = models.IntegerField(null=True, blank=True)
    contract_total_value = models.BigIntegerField(null=True, blank=True)
    contract_apy = models.BigIntegerField(null=True, blank=True)
    contract_guaranteed = models.BigIntegerField(null=True, blank=True)

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
        app_label = "gridstream"

    def __str__(self):
        from_str = self.from_team.abbreviation if self.from_team else "?"
        to_str = self.to_team.abbreviation if self.to_team else "?"
        return (
            f"{self.player.display_name} {self.transaction_type} "
            f"{from_str}→{to_str} ({self.date})"
        )


class TeamFreeAgentTrackerEntry(models.Model):
    """
    Team-scoped free-agent tracker rows sourced from Ourlads.

    Each record represents one player listed on a team's offseason tracker page
    for a given calendar year. `team` is the original team page being viewed;
    `signed_with_team` is the team the player ultimately signed with, when known.
    """

    TRACKER_STATUS_CHOICES = [
        ("unsigned", "Unsigned"),
        ("re_signed", "Re-signed With Team"),
        ("signed_elsewhere", "Signed Elsewhere"),
    ]

    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="free_agent_tracker_entries"
    )
    season = models.IntegerField(
        help_text="Calendar year of the free-agent tracker page (e.g. 2026)"
    )
    player = models.ForeignKey(
        Player,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="free_agent_tracker_entries",
    )
    player_name = models.CharField(max_length=100)
    ourlads_player_id = models.CharField(max_length=20, blank=True)
    position = models.CharField(max_length=10, blank=True)
    fa_type = models.CharField(
        max_length=10, blank=True, help_text="UFA, RFA, ERFA, CC, etc."
    )
    signed_with_team = models.ForeignKey(
        Team,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="signed_free_agent_tracker_entries",
    )
    tracker_status = models.CharField(
        max_length=20, choices=TRACKER_STATUS_CHOICES, default="unsigned"
    )
    source_url = models.URLField(max_length=500, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["team__abbreviation", "season", "player_name"]
        indexes = [
            models.Index(fields=["team", "season"]),
            models.Index(fields=["signed_with_team", "season"]),
            models.Index(fields=["player", "season"]),
            models.Index(fields=["season", "fa_type"]),
        ]
        app_label = "gridstream"

    def __str__(self):
        signed_with = (
            self.signed_with_team.abbreviation if self.signed_with_team else "—"
        )
        return (
            f"{self.season} {self.team.abbreviation} {self.player_name} "
            f"{self.fa_type or '?'} → {signed_with}"
        )


# =============================================================================
# DRAFT PROSPECTS
# =============================================================================


class DraftProspect(models.Model):
    """
    Draft prospect scouting snapshots scraped from third-party draft boards.

    Stored separately from `Player` because most prospects are not yet in the
    NFL player master data. The record is keyed by source slug + draft season so
    we can refresh scouting context without needing a player join.
    """

    SOURCE_CHOICES = [
        ("nfldraftbuzz", "NFLDraftBuzz"),
    ]

    season = models.IntegerField(help_text="Draft year / class year, e.g. 2026")
    source = models.CharField(
        max_length=30, choices=SOURCE_CHOICES, default="nfldraftbuzz"
    )
    source_slug = models.SlugField(max_length=160)
    source_url = models.URLField(max_length=500)

    name = models.CharField(max_length=120)
    position = models.CharField(max_length=20, blank=True)
    school = models.CharField(max_length=120, blank=True)
    class_year = models.CharField(max_length=40, blank=True)
    hometown = models.CharField(max_length=120, blank=True)
    role = models.CharField(max_length=120, blank=True)
    jersey_number = models.CharField(max_length=10, blank=True)

    image_url = models.URLField(max_length=500, blank=True)
    college_logo_url = models.URLField(max_length=500, blank=True)

    overall_rating = models.FloatField(null=True, blank=True)
    overall_rank = models.IntegerField(null=True, blank=True)
    position_rank = models.IntegerField(null=True, blank=True)
    position_rank_group = models.CharField(max_length=20, blank=True)
    draft_projection = models.CharField(max_length=80, blank=True)
    all_scouts_overall_rank = models.FloatField(null=True, blank=True)
    all_scouts_position_rank = models.FloatField(null=True, blank=True)

    height = models.CharField(max_length=16, blank=True)
    weight = models.IntegerField(null=True, blank=True)
    forty_yard = models.FloatField(null=True, blank=True)
    hand_size = models.CharField(max_length=20, blank=True)
    arm_length = models.CharField(max_length=20, blank=True)
    age = models.FloatField(null=True, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    college_games = models.IntegerField(null=True, blank=True)
    college_snaps = models.IntegerField(null=True, blank=True)

    bio = models.TextField(blank=True)
    summary = models.TextField(blank=True)
    strengths = ArrayField(models.TextField(), default=list, blank=True)
    weaknesses = ArrayField(models.TextField(), default=list, blank=True)
    honors = ArrayField(models.TextField(), default=list, blank=True)

    production_stats = models.JSONField(
        default=list,
        blank=True,
        help_text="Top on-page production stats, e.g. tackles / sacks / INT",
    )
    scouting_grades = models.JSONField(
        default=list,
        blank=True,
        help_text="NFLDraftBuzz grading/rating rows, e.g. tackling / coverage / ESPN",
    )
    measurable_percentiles = models.JSONField(
        default=list,
        blank=True,
        help_text="Percentile values for height/weight/forty/hand/arm on the page",
    )
    recruiting_ratings = models.JSONField(
        default=list,
        blank=True,
        help_text="Third-party recruiting/grade badges like ESPN / 247 / Rivals",
    )
    comparison_players = models.JSONField(
        default=list,
        blank=True,
        help_text="Comparable players and similarity percentages",
    )

    source_last_updated = models.DateField(null=True, blank=True)
    scraped_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["season", "overall_rank", "name"]
        unique_together = ["season", "source", "source_slug"]
        indexes = [
            models.Index(fields=["season", "source"]),
            models.Index(fields=["season", "overall_rank"]),
            models.Index(fields=["season", "position"]),
            models.Index(fields=["season", "school"]),
        ]
        app_label = "gridstream"

    def __str__(self):
        return (
            f"{self.season} {self.name} ({self.position or '?'}, {self.school or '?'})"
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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
        app_label = "gridstream"

    def __str__(self):
        return str(self.year)


class TeamStanding(models.Model):
    """Persisted season standings sourced from nfldata standings.csv."""

    season = models.ForeignKey(
        Season, on_delete=models.CASCADE, related_name="team_standings"
    )
    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="team_standings"
    )

    conference = models.CharField(max_length=5, blank=True)
    division = models.CharField(max_length=20, blank=True)

    wins = models.IntegerField(default=0)
    losses = models.IntegerField(default=0)
    ties = models.IntegerField(default=0)
    pct = models.FloatField(default=0.0)

    div_rank = models.IntegerField(null=True, blank=True)
    seed = models.IntegerField(null=True, blank=True)

    points_for = models.IntegerField(null=True, blank=True)
    points_against = models.IntegerField(null=True, blank=True)
    point_diff = models.IntegerField(default=0)

    sov = models.FloatField(null=True, blank=True)
    sos = models.FloatField(null=True, blank=True)

    streak = models.CharField(max_length=12, blank=True)
    last_5 = models.CharField(max_length=12, blank=True)
    playoff_clincher = models.CharField(max_length=30, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "gridstream"
        ordering = ["season_id", "conference", "division", "div_rank", "-pct"]
        unique_together = ["season", "team"]
        indexes = [
            models.Index(fields=["season", "conference", "division"]),
            models.Index(fields=["season", "seed"]),
        ]

    def __str__(self):
        return (
            f"{self.season_id} {self.team.abbreviation} "
            f"{self.wins}-{self.losses}-{self.ties}"
        )


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
    div_game = models.BooleanField(default=False)
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
    spread_line = models.FloatField(null=True, blank=True)
    total_line = models.FloatField(null=True, blank=True)
    spread = models.FloatField(null=True, blank=True)  # negative = home favored
    total = models.FloatField(null=True, blank=True)  # over/under
    home_moneyline = models.IntegerField(null=True, blank=True)
    away_moneyline = models.IntegerField(null=True, blank=True)
    home_spread_odds = models.IntegerField(null=True, blank=True)
    away_spread_odds = models.IntegerField(null=True, blank=True)
    over_odds = models.IntegerField(null=True, blank=True)
    under_odds = models.IntegerField(null=True, blank=True)
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
    home_rest = models.IntegerField(null=True, blank=True)
    away_rest = models.IntegerField(null=True, blank=True)
    referee = models.CharField(max_length=80, blank=True)
    attendance = models.IntegerField(null=True, blank=True)
    home_coach = models.CharField(max_length=60, blank=True)
    away_coach = models.CharField(max_length=60, blank=True)
    home_qb_name = models.CharField(max_length=60, blank=True)
    away_qb_name = models.CharField(max_length=60, blank=True)
    home_qb_espn_id = models.CharField(max_length=20, blank=True)
    away_qb_espn_id = models.CharField(max_length=20, blank=True)
    overtime = models.BooleanField(default=False)

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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
        app_label = "gridstream"

    def __str__(self):
        return f"{self.game} - {self.link_type}: {self.label}"


class GameOfficial(models.Model):
    """Per-game officiating crew entries from ESPN gameInfo.officials."""

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="officials")
    sequence = models.IntegerField(default=0)
    name = models.CharField(max_length=80)
    position = models.CharField(max_length=50, blank=True)

    class Meta:
        ordering = ["game", "sequence", "name"]
        unique_together = ["game", "name", "position"]
        indexes = [
            models.Index(fields=["game", "position"]),
        ]
        app_label = "gridstream"

    def __str__(self):
        role = self.position or "Official"
        return f"{self.game.espn_event_id} {role}: {self.name}"


class PlayerInjury(models.Model):
    """Game-day injury report rows from ESPN summary.injuries."""

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="injuries")
    team = models.ForeignKey(Team, on_delete=models.SET_NULL, null=True, blank=True)
    player = models.ForeignKey(
        Player, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    sequence = models.IntegerField(default=0)

    player_name = models.CharField(max_length=80, blank=True)
    player_espn_id = models.CharField(max_length=20, blank=True, db_index=True)
    status = models.CharField(max_length=40, blank=True)
    description = models.CharField(max_length=200, blank=True)
    game_day_availability = models.CharField(max_length=40, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["game", "team", "sequence", "player_name"]
        indexes = [
            models.Index(fields=["game", "team"]),
            models.Index(fields=["game", "player_espn_id"]),
        ]
        app_label = "gridstream"

    def __str__(self):
        team_abbr = self.team.abbreviation if self.team else "UNK"
        name = self.player_name or self.player_espn_id or "Unknown"
        status = self.status or self.game_day_availability or "unknown"
        return f"{self.game.espn_event_id} {team_abbr} {name} ({status})"


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
        app_label = "gridstream"

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
    timeout = models.BooleanField(default=False)
    timeout_team = models.CharField(max_length=5, blank=True)
    home_timeouts_remaining = models.IntegerField(null=True, blank=True)
    away_timeouts_remaining = models.IntegerField(null=True, blank=True)

    # ── Play family flags ───────────────────────────────
    pass_attempt = models.BooleanField(default=False)
    rush_attempt = models.BooleanField(default=False)
    kickoff_attempt = models.BooleanField(default=False)
    punt_attempt = models.BooleanField(default=False)
    extra_point_attempt = models.BooleanField(default=False)
    two_point_attempt = models.BooleanField(default=False)
    special_teams_play = models.BooleanField(default=False)
    st_play_type = models.CharField(max_length=30, blank=True)
    touchback = models.BooleanField(default=False)
    out_of_bounds = models.BooleanField(default=False)
    punt_inside_twenty = models.BooleanField(default=False)
    punt_fair_catch = models.BooleanField(default=False)
    kickoff_fair_catch = models.BooleanField(default=False)
    kickoff_in_endzone = models.BooleanField(default=False)
    return_yards = models.IntegerField(null=True, blank=True)
    return_team = models.CharField(max_length=5, blank=True)

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
    punt_returner_player_name = models.CharField(max_length=60, blank=True)
    punt_returner_player_id = models.CharField(max_length=20, blank=True)
    kickoff_returner_player_name = models.CharField(max_length=60, blank=True)
    kickoff_returner_player_id = models.CharField(max_length=20, blank=True)
    blocked_player_name = models.CharField(max_length=60, blank=True)
    blocked_player_id = models.CharField(max_length=20, blank=True)
    interception_player_name = models.CharField(max_length=60, blank=True)
    interception_player_id = models.CharField(max_length=20, blank=True)
    fumble_recovery_1_player_name = models.CharField(max_length=60, blank=True)
    fumble_recovery_1_team = models.CharField(max_length=5, blank=True)
    fumble_recovery_1_yards = models.IntegerField(null=True, blank=True)
    sack_player_name = models.CharField(max_length=60, blank=True)
    sack_player_id = models.CharField(max_length=20, blank=True)
    tackle_for_loss_1_player_name = models.CharField(max_length=60, blank=True)
    pass_defense_1_player_name = models.CharField(max_length=60, blank=True)
    penalty_player_name = models.CharField(max_length=60, blank=True)
    penalty_player_id = models.CharField(max_length=20, blank=True)
    penalty_team = models.CharField(max_length=5, blank=True)

    # ── Kicking ──────────────────────────────────────────
    field_goal_result = models.CharField(max_length=10, blank=True)
    kick_distance = models.FloatField(null=True, blank=True)

    # ── Analytics (nflverse — nullable) ──────────────────
    epa = models.FloatField(null=True, blank=True)
    total_home_epa = models.FloatField(null=True, blank=True)
    total_away_epa = models.FloatField(null=True, blank=True)
    wpa = models.FloatField(null=True, blank=True)
    success = models.FloatField(null=True, blank=True)
    home_wp = models.FloatField(null=True, blank=True)
    away_wp = models.FloatField(null=True, blank=True)
    vegas_wp = models.FloatField(null=True, blank=True)
    vegas_home_wp = models.FloatField(null=True, blank=True)
    ep = models.FloatField(null=True, blank=True)
    cp = models.FloatField(null=True, blank=True)
    cpoe = models.FloatField(null=True, blank=True)
    td_prob = models.FloatField(null=True, blank=True)
    fg_prob = models.FloatField(null=True, blank=True)
    no_score_prob = models.FloatField(null=True, blank=True)
    score_differential = models.IntegerField(null=True, blank=True)
    drive_start_transition = models.CharField(max_length=40, blank=True)
    drive_end_transition = models.CharField(max_length=40, blank=True)
    drive_yards_penalized = models.IntegerField(null=True, blank=True)
    series_result = models.CharField(max_length=30, blank=True)

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
        app_label = "gridstream"

    def __str__(self):
        return f"Play {self.sequence} Q{self.quarter}: {self.short_description or self.play_type}"


class WinProbabilityPlay(models.Model):
    """Per-play win probability timeline point."""

    game = models.ForeignKey(
        Game, on_delete=models.CASCADE, related_name="win_probability"
    )
    play = models.ForeignKey(
        Play,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="win_probability_points",
    )
    espn_play_id = models.CharField(max_length=20, blank=True, db_index=True)
    sequence = models.IntegerField()
    seconds_left = models.IntegerField(null=True, blank=True)
    home_win_pct = models.FloatField(null=True, blank=True)
    away_win_pct = models.FloatField(null=True, blank=True)
    tie_pct = models.FloatField(null=True, blank=True)
    source = models.CharField(max_length=30, default="espn_summary")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["game", "sequence"]
        unique_together = ["game", "sequence"]
        indexes = [
            models.Index(fields=["game", "play"]),
            models.Index(fields=["game", "espn_play_id"]),
        ]
        app_label = "gridstream"

    def __str__(self):
        return f"{self.game.espn_event_id} seq {self.sequence}: {self.home_win_pct}"


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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
        app_label = "gridstream"

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
        app_label = "gridstream"

    def __str__(self):
        return f"{self.playbook.name} #{self.sequence}"


# =============================================================================
# ADVANCED ANALYTICS
# =============================================================================


class TeamDvoaRating(models.Model):
    """
    Team DVOA ratings sourced from FTN's DVOA endpoints.

    One row per (team, season, season_type, week).
    The full source payload is retained in `metrics_raw` for forward-compatible
    access to every field returned by FTN.

    Populated by: sync_dvoa_ratings management command.
    """

    SEASON_TYPE_CHOICES = [
        ("REG", "Regular Season"),
        ("POST", "Postseason"),
    ]

    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="dvoa_ratings"
    )
    season = models.IntegerField()
    season_type = models.CharField(
        max_length=4, choices=SEASON_TYPE_CHOICES, default="REG"
    )
    week = models.IntegerField(
        default=0, help_text="Source week number tied to this DVOA snapshot"
    )

    record_snapshot = models.CharField(
        max_length=20, blank=True, help_text="Source win-loss string (e.g. 14-3)"
    )

    total_dvoa = models.FloatField(null=True, blank=True)
    offense_dvoa = models.FloatField(null=True, blank=True)
    defense_dvoa = models.FloatField(null=True, blank=True)
    special_teams_dvoa = models.FloatField(null=True, blank=True)
    weighted_total_dvoa = models.FloatField(null=True, blank=True)

    total_dvoa_rank = models.SmallIntegerField(null=True, blank=True)
    offense_dvoa_rank = models.SmallIntegerField(null=True, blank=True)
    defense_dvoa_rank = models.SmallIntegerField(null=True, blank=True)
    special_teams_dvoa_rank = models.SmallIntegerField(null=True, blank=True)
    weighted_total_dvoa_rank = models.SmallIntegerField(null=True, blank=True)
    last_week_rank = models.SmallIntegerField(null=True, blank=True)
    last_week_weighted_rank = models.SmallIntegerField(null=True, blank=True)

    non_adjusted_total_voi = models.FloatField(null=True, blank=True)
    offense_voa_unadjusted = models.FloatField(null=True, blank=True)
    defense_voa_unadjusted = models.FloatField(null=True, blank=True)
    special_teams_voa_unadjusted = models.FloatField(null=True, blank=True)
    estimated_wins = models.FloatField(null=True, blank=True)
    past_schedule_dvoa = models.FloatField(null=True, blank=True)
    future_schedule_dvoa = models.FloatField(null=True, blank=True)
    variance = models.FloatField(null=True, blank=True)
    weighted_offense_dvoa = models.FloatField(null=True, blank=True)
    weighted_defense_dvoa = models.FloatField(null=True, blank=True)
    weighted_special_teams_dvoa = models.FloatField(null=True, blank=True)

    metrics_raw = models.JSONField(
        default=dict, help_text="Full source payload row from FTN DVOA API"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ["team", "season", "season_type", "week"]
        indexes = [
            models.Index(
                fields=["season", "season_type", "total_dvoa_rank"],
                name="gridstream_tdvoa_ssr_idx",
            ),
            models.Index(
                fields=["team", "season", "season_type"],
                name="gridstream_tdvoa_tss_idx",
            ),
        ]
        ordering = ["-season", "season_type", "total_dvoa_rank"]
        app_label = "gridstream"

    def __str__(self):
        return (
            f"{self.season} {self.season_type} Wk{self.week} "
            f"{self.team.abbreviation} DVOA {self.total_dvoa}"
        )


class TeamRbsdmMetric(models.Model):
    """
    Team-level RBSDM metrics ingested from exported CSV datasets.

    Supported datasets:
      - stats_offense_weekly
      - stats_defense_weekly
      - luck_offense_weekly
      - luck_defense_weekly
      - passfreq_neutral_yearly (stored with week=0)
    """

    DATASET_CHOICES = [
        ("stats_offense_weekly", "RBSDM Stats Offense (Weekly)"),
        ("stats_defense_weekly", "RBSDM Stats Defense (Weekly)"),
        ("luck_offense_weekly", "RBSDM Luck Offense (Weekly)"),
        ("luck_defense_weekly", "RBSDM Luck Defense (Weekly)"),
        ("passfreq_neutral_yearly", "RBSDM Neutral Pass Frequency (Season)"),
    ]

    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="rbsdm_metrics"
    )
    season = models.IntegerField()
    week = models.IntegerField(
        default=0, help_text="Week number, or 0 for season-level datasets"
    )
    dataset = models.CharField(max_length=40, choices=DATASET_CHOICES)
    table_context = models.CharField(max_length=255, blank=True)
    metrics = models.JSONField(default=dict, help_text="RBSDM row metrics payload")
    captured_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ["team", "season", "week", "dataset"]
        indexes = [
            models.Index(fields=["season", "dataset", "week"]),
            models.Index(fields=["team", "season", "dataset"]),
        ]
        ordering = ["-season", "dataset", "week", "team__abbreviation"]
        app_label = "gridstream"

    def __str__(self):
        return f"{self.team.abbreviation} {self.dataset} {self.season} Wk{self.week}"


class PlayerRbsdmQbMetric(models.Model):
    """
    QB-level RBSDM weekly metrics from stats_qb_weekly CSV exports.

    A player link is optional because RBSDM names are short-form strings
    (e.g. "M.Stafford") and may not always map 1:1.
    """

    player = models.ForeignKey(
        Player,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="rbsdm_qb_metrics",
    )
    team = models.ForeignKey(
        Team, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    season = models.IntegerField()
    week = models.IntegerField()
    player_name = models.CharField(max_length=80)
    player_key = models.CharField(max_length=80, db_index=True)

    adj_epa_play = models.FloatField(null=True, blank=True)
    epa_play = models.FloatField(null=True, blank=True)
    epa_cpoe_composite = models.FloatField(null=True, blank=True)
    cpoe = models.FloatField(null=True, blank=True)
    success_rate = models.FloatField(null=True, blank=True)
    air_yards = models.FloatField(null=True, blank=True)
    expected_cmppct = models.FloatField(null=True, blank=True)
    cmppct = models.FloatField(null=True, blank=True)
    plays = models.IntegerField(null=True, blank=True)

    table_context = models.CharField(max_length=255, blank=True)
    metrics = models.JSONField(default=dict, help_text="RBSDM QB row metrics payload")
    captured_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ["team", "season", "week", "player_key"]
        indexes = [
            models.Index(fields=["season", "week"]),
            models.Index(fields=["player", "season"]),
            models.Index(fields=["player_key", "season"]),
        ]
        ordering = ["-season", "-week", "player_name"]
        app_label = "gridstream"

    def __str__(self):
        return f"{self.player_name} RBSDM {self.season} Wk{self.week}"


class PlayerFFRanking(models.Model):
    """
    FantasyPros Expert Consensus Rankings (ECR) by week.

    Sourced from DynastyProcess via nflreadr load_ff_rankings(type='week').
    Populated by: sync_ff_rankings management command.
    Available from ~2016 for weekly rankings.

    Use `position_rank` for the "WR #8" display; `rank` is the overall ECR.
    """

    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name="ff_rankings"
    )
    season = models.IntegerField()
    week = models.IntegerField()
    position = models.CharField(max_length=5, help_text="Position at time of ranking")

    # Core ranking metrics
    rank = models.FloatField(help_text="Expert Consensus Rank (lower = better)")
    rank_sd = models.FloatField(
        null=True,
        blank=True,
        help_text="Standard deviation — disagreement between experts",
    )
    rank_best = models.IntegerField(
        null=True, blank=True, help_text="Most optimistic rank"
    )
    rank_worst = models.IntegerField(
        null=True, blank=True, help_text="Most pessimistic rank"
    )

    # Position rank (e.g., 8 → "WR8")
    position_rank = models.IntegerField(
        null=True, blank=True, help_text="Rank within position group (WR8 = 8)"
    )

    class Meta:
        unique_together = ["player", "season", "week"]
        indexes = [
            models.Index(fields=["season", "week", "position"]),
            models.Index(fields=["player", "season"]),
        ]
        ordering = ["-season", "-week", "rank"]
        app_label = "gridstream"

    def __str__(self):
        pos_rank = (
            f" ({self.position}{self.position_rank})" if self.position_rank else ""
        )
        return (
            f"{self.player.display_name} ECR#{self.rank:.0f}{pos_rank} "
            f"Wk{self.week} {self.season}"
        )


class PlayerAward(models.Model):
    """
    Major annual NFL awards sourced from the ESPN core API.

    Covers: Super Bowl MVP, NFL MVP, Offensive/Defensive POTY,
    Offensive/Defensive ROTY, Comeback Player, Walter Payton MOTY.
    Coach of the Year is excluded (no athlete reference).

    Populated by: sync_espn_awards management command.
    Source: sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/awards
    """

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="awards")
    season = models.IntegerField(db_index=True)
    espn_award_id = models.CharField(max_length=20)
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=200, blank=True)

    class Meta:
        unique_together = ["player", "season", "espn_award_id"]
        ordering = ["-season", "name"]
        indexes = [
            models.Index(fields=["player", "season"]),
        ]
        app_label = "gridstream"

    def __str__(self):
        return f"{self.player.display_name} — {self.name} ({self.season})"


class PlayerNextGenStats(models.Model):
    """
    NFL Next Gen Stats (NGS) — tracking-based advanced metrics from 2016+.

    Separate rows per stat_type: 'passing' | 'rushing' | 'receiving'.
    Week 0 = season aggregate; weeks 1–22 = individual game weeks.
    Metrics stored in JSONField for forward compatibility across NGS releases.

    Populated by: sync_nextgen_stats management command.
    Source: nflverse-data releases (ngs_{type}.csv.gz).

    Key metrics by type:
      passing:   avg_time_to_throw, completion_percentage_above_expectation (CPOE),
                 avg_intended_air_yards, aggressiveness, passer_rating
      rushing:   efficiency (yards over expected per att), avg_time_to_los,
                 rush_yards_over_expected_per_att, expected_rush_yards
      receiving: avg_separation, avg_cushion, avg_intended_air_yards,
                 percent_share_of_intended_air_yards, avg_yac_above_expectation
    """

    STAT_TYPE_CHOICES = [
        ("passing", "Passing"),
        ("rushing", "Rushing"),
        ("receiving", "Receiving"),
    ]

    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name="nextgen_stats"
    )
    season = models.IntegerField()
    week = models.IntegerField(default=0, help_text="0 = season total; 1+ = game week")
    season_type = models.CharField(max_length=4, default="REG")
    stat_type = models.CharField(max_length=10, choices=STAT_TYPE_CHOICES)

    metrics = models.JSONField(
        default=dict,
        help_text="Stat-type-specific NGS metrics (see class docstring)",
    )

    class Meta:
        unique_together = ["player", "season", "week", "stat_type"]
        indexes = [
            models.Index(fields=["player", "season", "stat_type"]),
            models.Index(fields=["season", "week", "stat_type"]),
        ]
        ordering = ["-season", "-week"]
        app_label = "gridstream"

    def __str__(self):
        week_label = "season" if self.week == 0 else f"Wk{self.week}"
        return (
            f"{self.player.display_name} NGS-{self.stat_type} "
            f"{week_label} {self.season}"
        )


class PlayerMaddenRating(models.Model):
    """
    Madden NFL player ratings sourced from maddenratings.weebly.com.

    One row per (player, madden_year). madden_year corresponds to the game
    title number (e.g., 24 for Madden NFL 24, which covers the 2023 NFL season).

    Madden year → approximate NFL season:
      24 → 2023 NFL season  (released Aug 2023)
      25 → 2024 NFL season  (released Aug 2024, if/when available)

    Populated by: sync_madden_ratings management command.
    Source: https://maddenratings.weebly.com/
    """

    player = models.ForeignKey(
        Player, on_delete=models.CASCADE, related_name="madden_ratings"
    )
    madden_year = models.SmallIntegerField(
        help_text="Madden game title number (e.g., 24 for Madden NFL 24)"
    )
    position_snapshot = models.CharField(
        max_length=5, help_text="Position as listed in Madden roster file"
    )
    team_snapshot = models.CharField(
        max_length=40, blank=True, help_text="Team name as listed in Madden roster file"
    )

    # Core rating
    overall = models.SmallIntegerField(help_text="Overall rating (OVR)")
    general_rating = models.SmallIntegerField(
        null=True,
        blank=True,
        help_text="General category score",
    )
    passing_rating = models.SmallIntegerField(
        null=True,
        blank=True,
        help_text="Passing category score",
    )
    receiving_rating = models.SmallIntegerField(
        null=True,
        blank=True,
        help_text="Receiving category score",
    )
    ball_carrier_rating = models.SmallIntegerField(
        null=True,
        blank=True,
        help_text="Ball-carrying category score",
    )
    defense_rating = models.SmallIntegerField(
        null=True,
        blank=True,
        help_text="Defense category score",
    )
    blocking_rating = models.SmallIntegerField(
        null=True,
        blank=True,
        help_text="Blocking category score",
    )
    kicking_rating = models.SmallIntegerField(
        null=True,
        blank=True,
        help_text="Kicking category score",
    )

    # Key attributes — kept to the most universally useful subset
    speed = models.SmallIntegerField(null=True, blank=True)
    strength = models.SmallIntegerField(null=True, blank=True)
    awareness = models.SmallIntegerField(null=True, blank=True)
    agility = models.SmallIntegerField(null=True, blank=True)
    acceleration = models.SmallIntegerField(null=True, blank=True)

    # Position-group specifics
    tackle = models.SmallIntegerField(null=True, blank=True, help_text="Tackle (DEF)")
    power_moves = models.SmallIntegerField(
        null=True, blank=True, help_text="Power Moves (DL)"
    )
    finesse_moves = models.SmallIntegerField(
        null=True, blank=True, help_text="Finesse Moves (DL)"
    )
    throw_power = models.SmallIntegerField(
        null=True, blank=True, help_text="Throw Power (QB)"
    )
    catching = models.SmallIntegerField(
        null=True, blank=True, help_text="Catching (WR/TE/RB)"
    )
    route_running = models.SmallIntegerField(
        null=True, blank=True, help_text="Short Route Running (WR/TE)"
    )
    run_block = models.SmallIntegerField(
        null=True, blank=True, help_text="Run Block (OL)"
    )
    pass_block = models.SmallIntegerField(
        null=True, blank=True, help_text="Pass Block (OL)"
    )
    hit_power = models.SmallIntegerField(
        null=True, blank=True, help_text="Hit Power (DB/LB)"
    )
    man_coverage = models.SmallIntegerField(
        null=True, blank=True, help_text="Man Coverage (DB)"
    )
    zone_coverage = models.SmallIntegerField(
        null=True, blank=True, help_text="Zone Coverage (DB)"
    )

    class Meta:
        unique_together = ["player", "madden_year"]
        indexes = [
            models.Index(fields=["madden_year", "overall"]),
            models.Index(fields=["player"]),
        ]
        ordering = ["-madden_year"]
        app_label = "gridstream"

    def __str__(self):
        return f"{self.player.display_name} Madden{self.madden_year} OVR {self.overall}"
