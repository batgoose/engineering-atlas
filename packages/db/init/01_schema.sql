CREATE TABLE IF NOT EXISTS plays (
    -- Identifiers
    game_id TEXT NOT NULL,
    play_id DOUBLE PRECISION NOT NULL,
    old_game_id TEXT,
    drive DOUBLE PRECISION,
    
    -- Teams
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    posteam TEXT,
    posteam_type TEXT,
    defteam TEXT,
    
    -- Game Context
    game_date DATE,
    season_type TEXT,
    week INTEGER,
    stadium TEXT,
    weather TEXT,
    surface TEXT,
    roof TEXT,
    
    -- Situation
    qtr INTEGER,
    quarter_seconds_remaining REAL,
    half_seconds_remaining REAL,
    game_seconds_remaining REAL,
    down INTEGER,
    ydstogo INTEGER,
    yardline_100 INTEGER,
    side_of_field TEXT,
    shotgun INTEGER DEFAULT 0,
    no_huddle INTEGER DEFAULT 0,
    
    -- Play Results
    play_type TEXT,
    yards_gained REAL,
    air_yards REAL,
    yards_after_catch REAL,
    epa REAL,
    wpa REAL,
    success REAL,
    
    -- Player Stats
    passer_player_id TEXT,
    passer_player_name TEXT,
    rusher_player_id TEXT,
    rusher_player_name TEXT,
    receiver_player_id TEXT,
    receiver_player_name TEXT,
    
    -- Flags/Outcomes
    touchdown REAL DEFAULT 0,
    interception REAL DEFAULT 0,
    fumble REAL DEFAULT 0,
    sack REAL DEFAULT 0,
    complete_pass REAL DEFAULT 0,
    pass_touchdown REAL DEFAULT 0,
    rush_touchdown REAL DEFAULT 0,
    
    -- Special Teams
    field_goal_result TEXT,
    kick_distance REAL,
    punt_blocked REAL,
    
    -- Penalties
    penalty REAL,
    penalty_type TEXT,
    penalty_yards REAL,

    -- Composite Primary Key to ensure uniqueness
    PRIMARY KEY (game_id, play_id)
);

-- Indexes for high-performance querying
CREATE INDEX IF NOT EXISTS idx_plays_posteam ON plays(posteam);
CREATE INDEX IF NOT EXISTS idx_plays_passer ON plays(passer_player_id);
CREATE INDEX IF NOT EXISTS idx_plays_rusher ON plays(rusher_player_id);
CREATE INDEX IF NOT EXISTS idx_plays_season_week ON plays(season_type, week);