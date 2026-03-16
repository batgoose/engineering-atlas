# NFL Database Audit & Gap Analysis

Date: 2026-02-23
Repository: engineering-atlas
Database: `nfl_data` (`postgres-nfl`)

---

## 0) Ordered TODO: v2 Database Rebuild

**Architecture decision:** Rather than continuing to layer enrichment scripts on top of the current v1 database,
build a clean v2 database (`postgres-nfl-v2`) from scratch using a single deterministic bootstrap pipeline.
The v1 database stays live and untouched until v2 reaches parity and passes QA.
All new work targets v2 only.

### Phase 1 — Infrastructure

- [x] **1.1** Create `postgres-nfl-v2` database instance; add connection config to `.env` alongside v1 creds
- [x] **1.2** Build `bootstrap_nfl_v2` management command: deterministic staged runner (migrate → raw ingest → core transforms → QA report)
- [x] **1.3** Define `raw_` schema with source-faithful tables (no lossy projections):
  - `raw_nflverse_pbp` — full 372-field PBP
  - `raw_nflverse_player_stats` — official per-game player stats
  - `raw_nflverse_team_stats`
  - `raw_nflverse_injuries`
  - `raw_nflverse_depth_charts`
  - `raw_nflverse_snap_counts`
  - `raw_nflverse_pbp_participation`
  - `raw_nflverse_draft_picks`
  - `raw_nflverse_trades`
  - `raw_nflverse_standings`
  - `raw_espn_summary` — JSON snapshots keyed by `espn_event_id`
  - `raw_espn_probabilities` — per-play win probability timeline
- [x] **1.4** Store source metadata per raw batch (source URL, checksum, `loaded_at`)

### Phase 2 — Raw Ingest

- [x] **2.1** Upgrade Rust ingest (or replace with DuckDB/Polars stage) to ingest full 372-field nflfastR PBP parquet into `raw_nflverse_pbp`; remove reduced column projection from `models.rs`/`lib.rs`
- [x] **2.2** Replace `import_player_game_stats.py` with direct ingest from nflfastR `player_stats` dataset into `raw_nflverse_player_stats`
- [x] **2.3** Replace `import_team_game_stats.py` with direct ingest from nflfastR team stats dataset
- [x] **2.4** Add `import_nflverse_standings` command (nfldata `standings.csv`)
- [x] **2.5** Add `import_nflverse_draft_picks` command (nfldata `draft_picks.csv`)
- [x] **2.6** Add `import_nflverse_draft_values` command (nfldata `draft_values.csv`)
- [x] **2.7** Add `import_nflverse_trades` command (nfldata `trades.csv`)
- [x] **2.8** Expand `sync_espn_games.py` to also ingest: boxscore (team + player stats), injuries, win probability timeline, pickcenter/odds, officials + attendance from `gameInfo`
- [x] **2.9** Add `import_espn_probabilities` command (per-play win probability keyed to plays)
- [x] **2.10** Upgrade `import_games.py` to use authoritative nflverse `games.csv` + ESPN IDs join; populate `is_division_game`, coaches, referees, `away_rest`/`home_rest`, odds fields

### Phase 3 — Django Model / Migration Updates

- [x] **3.1** Add new fields to `gridstream_play`: `timeout`, `timeout_team`, `home_timeouts_remaining`, `away_timeouts_remaining`, `pass_attempt`, `rush_attempt`, `kickoff_attempt`, `punt_attempt`, `extra_point_attempt`, `two_point_attempt`, `special_teams_play`, `st_play_type`, `touchback`, `out_of_bounds`, `punt_inside_twenty`, `punt_fair_catch`, `kickoff_fair_catch`, `kickoff_in_endzone`, `return_yards`, `return_team`, `punt_returner_player_name`, `punt_returner_player_id`, `kickoff_returner_player_name`, `kickoff_returner_player_id`, `interception_player_name`, `interception_player_id`, `fumble_recovery_1_player_name`, `fumble_recovery_1_team`, `fumble_recovery_1_yards`, `sack_player_name`, `sack_player_id`, `tackle_for_loss_1_player_name`, `pass_defense_1_player_name`, `penalty_player_name`, `penalty_player_id`, `penalty_team`, `home_wp`, `away_wp`, `vegas_wp`, `vegas_home_wp`, `ep`, `cp`, `cpoe`, `td_prob`, `fg_prob`, `no_score_prob`, `score_differential`, `drive_start_transition`, `drive_end_transition`, `drive_yards_penalized`, `series_result`
- [x] **3.2** Add new fields to `gridstream_game`: `away_rest`, `home_rest`, `referee`, `attendance`, `overtime` flag, `div_game` (mapped from nflverse), `spread_line`/`total_line`/`away_spread_odds`/`home_spread_odds`/`over_odds`/`under_odds` (from pickcenter)
- [x] **3.3** Add `gridstream_teamstanding` table (persisted standings: wins, losses, ties, pct, div_rank, seed, point_diff, sov, sos, streak, last_5, playoff clincher)
- [x] **3.4** Add `gridstream_gameofficial` table (official name, position, game FK)
- [x] **3.5** Add `gridstream_playerinjury` table (game FK, player FK, status, description, game-day availability)
- [x] **3.6** Add `gridstream_winprobabilityplay` table (game FK, play FK, home_win_pct, tie_pct, seconds_left) — or add columns directly to `gridstream_play` (3.1 above)
- [x] **3.7** Ensure `gridstream_venue.is_indoor` is populated reliably for all venues
- [x] **3.8** Run migrations against v2 only; generate migration files cleanly from scratch

### Phase 4 — Serializer / API Updates

- [x] **4.1** Expose new play fields in `PlayDetailSerializer`: timeout fields, all returner/player name fields, `home_wp`/`away_wp`, `ep`, `score_differential`, `series_result`, `drive_start_transition`
- [x] **4.2** Add `GameOfficialSerializer` and include in `GameDetailSerializer`
- [x] **4.3** Add `PlayerInjurySerializer` and include in `GameDetailSerializer` (game-day injury report)
- [x] **4.4** Add `TeamStandingSerializer` and `StandingsViewSet` endpoint that reads from persisted table instead of computing
- [x] **4.5** Add odds fields to `GameDetailSerializer`

### Phase 5 — Backend Logic Replacement

- [x] **5.1** Remove `_derive_team_stats_from_plays()` fallback in `GameViewSet.boxscore`; require canonical `TeamGameStats` rows (keep a narrow fallback only as resilience mode behind a flag)
- [x] **5.2** Remove `_derive_leaders_from_player_stats()` fallback; require canonical `GameLeader` rows
- [x] **5.3** Remove computed standings derivation from `StandingsViewSet`; replace with `TeamStanding` table query
- [x] **5.4** Validate `teamstats_points_scored_pct` and `playerstats_fg_made_pct` are 100% in v2 before removing fallbacks

### Phase 6 — SDK Heuristic Replacement

- [x] **6.1** Replace `hasTurnoverLanguage()` description regex with `play.interception` + `play.fumble_lost` flags
- [x] **6.2** Replace `resolveAnimType()` play-category inference with explicit `pass_attempt`, `rush_attempt`, `kickoff_attempt`, `punt_attempt`, `extra_point_attempt`, `two_point_attempt`, `special_teams_play`, `st_play_type` flags
- [x] **6.3** Replace `parseKickDetails()` 80-line regex with: `punt_returner_player_name`, `kickoff_returner_player_name`, `return_yards`, `return_team`, `touchback`, `out_of_bounds`, `punt_inside_twenty`, `punt_fair_catch`, `kickoff_in_endzone`
- [x] **6.4** Replace `parseTurnoverDetails()` regex + projection heuristic with: `interception_player_name/id`, `fumble_recovery_1_player_name/team/yards`, `return_yards`, `return_team`
- [x] **6.5** Replace `parsePenaltyDetails()` regex with: `penalty_player_name`, `penalty_player_id`, `penalty_team`
- [x] **6.6** Replace `parseTimeoutUsage()` regex + decrement counter with: `timeout`, `timeout_team`, `home_timeouts_remaining`, `away_timeouts_remaining` per play
- [x] **6.7** Replace `estimateAwayWinPct()` score/clock heuristic with `home_wp`/`away_wp` per play (ESPN `winprobability` or nflfastR `home_wp`)
- [x] **6.8** Remove `isLikelyIndoor()` keyword heuristic; use `venue.is_indoor` from DB exclusively
- [x] **6.9** Replace timeout decrement counter in replay timeline with `home_timeouts_remaining`/`away_timeouts_remaining` per play
- [x] **6.10** Replace rolling EPA accumulation in replay with `total_home_epa`/`total_away_epa` per play from nflfastR
- [x] **6.11** Capture reusable v3+ bootstrap process (scripts + runbook + optional Ansible wrapper)

### Phase 7 — New UI Features (unlocked by v2 data)

- [x] **7.1** Games list: Add spread/total/moneyline display on game cards
- [x] **7.2** Games list: Add rest advantage badge (short week indicator) from `away_rest`/`home_rest`
- [x] **7.3** Games list: Add injury status flags for key players (game-day availability)
- [x] **7.4** Games list: Add division game indicator badge
- [x] **7.5** Games list: Show current standings seed alongside team record
- [x] **7.6** Game view: Replace WinProbSparkline heuristic with actual model output per play; add confidence band
- [x] **7.7** Game view: Show accurate timeout bubbles in score bug at every replay frame
- [x] **7.8** Game view: Add EPA flow chart (rolling `total_home_epa` / `total_away_epa`, segmented by pass vs. rush)
- [x] **7.9** Game view: Add drive start transition to drive tracker cards ("Following INT", "After Punt", etc.)
- [x] **7.10** Game view: Add defender/tackler attribution to MissionLog entries (`sack_player_name`, `tackle_for_loss_1_player_name`, `interception_player_name`)
- [x] **7.11** Game view: Show `penalty_player_name` in MissionLog instead of just penalty type
- [x] **7.12** Game view: Add attendance + officials panel to environment display
- [x] **7.13** Game view: Add play probability context overlay for notable plays (`td_prob`, `fg_prob` pre-snap)
- [x] **7.14** Game view: Add `cp`/`cpoe` annotation on pass plays (completion % over expectation)
- [x] **7.15** Game view: Surface Next Gen Stats metrics in player leaders panel

### Phase 8 — Cutover

- [ ] **8.1** Run full QA report comparing v1 vs v2 stat totals for a sample of games (passes, rushing yards, scoring plays)
- [ ] **8.2** Update all Django `DATABASES` config to point `default` at v2
- [ ] **8.3** Decommission v1 database after soak period

---

## Status Snapshot (2026-02-24)

### v2 Population Status

- `gridstream_game` REG/POST coverage: **7,279 / 7,279** games with ESPN IDs
- `raw.raw_espn_summary` distinct event coverage: **7,279 / 7,279** (0 missing)
- `gridstream_playerinjury` game coverage: **7,279 / 7,279**
- `gridstream_gameofficial` game coverage: **6,683 / 7,279** (source-limited on older/missing ESPN official payloads)
- `gridstream_winprobabilityplay` game coverage: **2,758 / 7,279** (source-limited; mostly modern seasons)

### Canonicalization Pass Results

- `gridstream_play` rebuilt from raw nflverse PBP: **1,277,525** modeled vs **1,279,628** raw (`2,103` unmapped/skipped)
- `gridstream_playergamestats` rebuilt from raw player stats: **474,320** modeled vs **476,156** raw (`1,836` skipped)
- `gridstream_teamgamestats` rebuilt from raw team stats: **14,490** modeled vs **14,531** raw (`41` skipped)

### Data Fix Applied

- Corrected historical ESPN ID mapping for `1999_18_BUF_TEN`:
  - bad source value: `200109010`
  - corrected value: `200108010`
  - importer override added so future rebuilds do not regress.

### Phase 5 Gate Metrics (v2)

- `teamstats_points_scored_pct`: **100.00%**
- `playerstats_fg_made_pct`: **100.00%**

---

## Scope

This document answers four questions:

1. What data is currently stored in the NFL database.
2. What data is available from the referenced repos/APIs that is not currently ingested.
3. What refactors/updates should be made in import scripts.
4. Which downstream functions can be replaced/upgraded after data improvements.

## Sources reviewed

- `https://github.com/nflverse/nflfastR/releases`
- `https://github.com/nflverse/nfldata/blob/master/DATASETS.md`
- `https://github.com/pseudo-r/Public-ESPN-API?tab=readme-ov-file#endpoints`
- Local code paths in this repo (Django, Rust loader, Go poller, SDK transforms).

---

## 1) Current data stored in `nfl_data`

### 1.1 Current table counts

- `plays`: `1279628` rows
- `gridstream_play`: `1151654` rows
- `gridstream_drive`: `159345` rows
- `gridstream_playergamestats`: `139468` rows
- `gridstream_gameleader`: `60870` rows
- `gridstream_scoringplay`: `59550` rows
- `gridstream_playerffranking`: `35058` rows
- `gridstream_playernextgenstats`: `26145` rows
- `gridstream_player`: `24517` rows
- `gridstream_playercontract`: `17839` rows
- `gridstream_teamgamestats`: `14546` rows
- `gridstream_game`: `7279` rows
- `gridstream_playercombine`: `6867` rows
- `gridstream_playertransaction`: `2974` rows
- `gridstream_venue`: `168` rows
- `gridstream_teamlogo`: `128` rows
- `gridstream_socialaccount`: `64` rows
- `gridstream_team`: `32` rows
- `django_migrations`: `28` rows
- `gridstream_season`: `27` rows
- `gridstream_newssource`: `4` rows
- `gridstream_gamehashtag`: `0` rows
- `gridstream_gamelink`: `0` rows
- `gridstream_playbook`: `0` rows
- `gridstream_playbookentry`: `0` rows
- `gridstream_playercollegehistory`: `0` rows

### 1.2 Coverage ranges (time/seasons)

- `combine_seasons`: min=`2000`, max=`2025`, distinct=`26`
- `nextgen_seasons`: min=`2016`, max=`2025`, distinct=`10`
- `contract_year_signed`: min=`1993`, max=`2022`, distinct=`29`
- `gridstream_games_dates`: min=`1999-09-12`, max=`2026-02-08`, distinct=`27`
- `ffranking_seasons`: min=`2019`, max=`2025`, distinct=`7`
- `plays_dates`: min=`1999-09-12`, max=`2026-02-08`, distinct=`27`

### 1.3 Key completeness metrics (actual data quality)

Legacy note: these percentages are from the original v1 snapshot and are
kept for historical comparison. Current v2 gate metrics are listed above in
"Status Snapshot (2026-02-24)".

- `play_description_pct`: `84.6%`
- `play_espn_id_pct`: `88.7%`
- `game_broadcast_pct`: `81.7%`
- `game_weather_any_pct`: `92.0%`
- `game_odds_any_pct`: `0.0%`
- `teamstats_points_scored_pct`: `0.0%`
- `teamstats_first_downs_pct`: `0.0%`
- `playerstats_fg_made_pct`: `0.0%`
- `playerstats_punt_attempts_pct`: `0.0%`

Notes:

- `game_odds_any_pct = 0.0%` means odds fields exist in schema but are currently unpopulated in this snapshot.
- Team and player stat subdomains for first downs / kicking / punting are materially incomplete (0% populated on key columns).
- The 0% columns are a key signal: the v1 enrichment approach was never going to fill these reliably. This is a primary motivation for the v2 full rebuild.

### 1.4 Full current schema inventory (table -> columns)

#### `django_migrations` (28 rows)

`id, app, name, applied`

#### `gridstream_drive` (159345 rows)

`id, drive_number, description, start_quarter, start_clock, start_yardline, end_quarter, end_clock, end_yardline, total_yards, play_count, first_downs, time_elapsed, result, is_score, inside_20, drive_epa, game_id, team_id`

#### `gridstream_game` (7279 rows)

`id, espn_event_id, nflverse_game_id, pfr_game_id, week, game_date, game_time, season_type, is_division_game, game_note, status, quarter, clock, home_score, away_score, home_score_q1, home_score_q2, home_score_q3, home_score_q4, home_score_ot, away_score_q1, away_score_q2, away_score_q3, away_score_q4, away_score_ot, spread, total, home_moneyline, away_moneyline, spread_open, total_open, odds_provider, weather_temp, weather_condition, weather_condition_id, weather_wind, weather_humidity, weather_detail, broadcast_network, broadcast_names, broadcast_market, home_record, away_record, home_coach, away_coach, home_qb_name, away_qb_name, home_qb_espn_id, away_qb_espn_id, is_simulation, created_at, updated_at, simulation_source_game_id, season_id, away_team_id, home_team_id, possession_team_id, venue_id`

#### `gridstream_gamehashtag` (0 rows)

`id, platform, tag, is_primary, game_id`

#### `gridstream_gameleader` (60870 rows)

`id, category, athlete_espn_id, athlete_name, athlete_headshot_url, athlete_jersey, athlete_position, display_value, stat_value, game_id, player_id, team_id`

#### `gridstream_gamelink` (0 rows)

`id, link_type, url, label, game_id`

#### `gridstream_newssource` (4 rows)

`id, name, source_type, entity_type, url_template, cache_ttl_seconds, is_active, priority, team_id`

#### `gridstream_play` (1151654 rows)

`id, espn_play_id, nflverse_play_id, sequence, quarter, clock, game_seconds_remaining, half_seconds_remaining, quarter_seconds_remaining, down, distance, yard_line, side_of_field, down_distance_text, play_type, description, short_description, yards_gained, is_scoring_play, home_score_after, away_score_after, end_down, end_distance, end_yard_line, touchdown, interception, fumble, fumble_lost, sack, penalty, penalty_type, penalty_yards, complete_pass, first_down, shotgun, no_huddle, qb_dropback, qb_scramble, air_yards, yards_after_catch, pass_location, run_location, run_gap, passer_player_name, passer_player_id, rusher_player_name, rusher_player_id, receiver_player_name, receiver_player_id, field_goal_result, kick_distance, epa, wpa, success, wall_clock, created_at, drive_id, game_id, defensive_team_id, possession_team_id`

#### `gridstream_playbook` (0 rows)

`id, name, description, is_full_game, play_count, created_at, updated_at, source_game_id`

#### `gridstream_playbookentry` (0 rows)

`id, sequence, delay_seconds, play_id, playbook_id`

#### `gridstream_player` (24517 rows)

`id, gsis_id, espn_id, pfr_id, first_name, last_name, display_name, short_name, jersey_number, position, position_group, headshot_url, height, weight, birth_date, college, draft_year, draft_round, draft_pick, is_active, created_at, updated_at, current_team_id, college_conference, depth_chart_position, draft_overall, draft_team_id, entry_year, esb_id, height_inches, is_undrafted, last_roster_check, otc_id, pff_id, rookie_season, roster_status, rotowire_id, smart_id, sportradar_id, suffix, yahoo_id, years_experience`

#### `gridstream_playercollegehistory` (0 rows)

`id, college, conference, start_year, end_year, is_redshirt, redshirt_year, is_primary, sequence, player_id`

#### `gridstream_playercombine` (6867 rows)

`id, season, position, height_inches, weight, arm_length, hand_size, wingspan, forty_yard, twenty_yard_split, ten_yard_split, bench_press, vertical_jump, broad_jump, three_cone, shuttle, draft_round, draft_overall, pfr_url, draft_team_id, player_id`

#### `gridstream_playercontract` (17839 rows)

`id, is_active, year_signed, years, total_value, apy, guaranteed, apy_cap_pct, inflated_value, inflated_apy, inflated_guaranteed, year_details, otc_url, created_at, updated_at, player_id, team_id`

#### `gridstream_playerffranking` (35058 rows)

`id, season, week, position, rank, rank_sd, rank_best, rank_worst, position_rank, player_id`

#### `gridstream_playergamestats` (139468 rows)

`id, season_year, week, season_type, completions, pass_attempts, passing_yards, passing_tds, interceptions_thrown, sacks_taken, sack_yards_lost, sack_fumbles, sack_fumbles_lost, passing_air_yards, passing_yards_after_catch, passing_first_downs, passing_2pt_conversions, passing_epa, passer_rating, qbr, carries, rushing_yards, rushing_tds, rushing_fumbles, rushing_fumbles_lost, rushing_first_downs, rushing_2pt_conversions, rushing_epa, rushing_long, receptions, targets, receiving_yards, receiving_tds, receiving_fumbles, receiving_fumbles_lost, receiving_air_yards, receiving_yards_after_catch, receiving_first_downs, receiving_2pt_conversions, receiving_epa, receiving_long, target_share, air_yards_share, wopr, tackles_total, tackles_solo, tackles_assists, tackles_for_loss, sacks_made, qb_hits, passes_defended, interceptions_caught, interception_yards, interception_tds, forced_fumbles, fumble_recoveries, defensive_tds, safeties, blocked_kicks, kick_return_attempts, kick_return_yards, kick_return_tds, punt_return_attempts, punt_return_yards, punt_return_tds, special_teams_tds, fg_attempts, fg_made, fg_long, fg_made_0_19, fg_made_20_29, fg_made_30_39, fg_made_40_49, fg_made_50_59, fg_made_60_plus, pat_attempts, pat_made, pat_missed, punt_attempts, punt_yards, punt_long, punt_inside_20, punt_touchbacks, fantasy_points_standard, fantasy_points_ppr, fantasy_points_half_ppr, created_at, updated_at, game_id, player_id, opponent_id, team_id`

#### `gridstream_playernextgenstats` (26145 rows)

`id, season, week, season_type, stat_type, metrics, player_id`

#### `gridstream_playertransaction` (2974 rows)

`id, transaction_type, date, description, season, created_at, from_team_id, player_id, related_transaction_id, to_team_id`

#### `gridstream_scoringplay` (59550 rows)

`id, quarter, clock, score_type, description, home_score_after, away_score_after, sequence, game_id, play_id, team_id`

#### `gridstream_season` (27 rows)

`year, start_date, end_date, current_week, is_active`

#### `gridstream_socialaccount` (64 rows)

`id, platform, account_type, handle, url, display_name, is_verified, player_id, team_id`

#### `gridstream_team` (32 rows)

`id, espn_id, abbreviation, slug, location, name, display_name, short_display_name, nickname, color_primary, color_secondary, conference, division, is_active`

#### `gridstream_teamgamestats` (14546 rows)

`id, season_year, week, is_home, total_yards, total_plays, first_downs, first_downs_passing, first_downs_rushing, first_downs_penalty, third_down_attempts, third_down_conversions, fourth_down_attempts, fourth_down_conversions, redzone_attempts, redzone_scores, pass_completions, pass_attempts, pass_yards, pass_tds, pass_ints, sacks_allowed, sack_yards_allowed, passer_rating, rush_attempts, rush_yards, rush_tds, turnovers, fumbles_lost, interceptions_lost, sacks_made, takeaways, interceptions_caught, fumbles_recovered, defensive_tds, punt_return_yards, kick_return_yards, return_tds, penalties, penalty_yards, time_of_possession, time_of_possession_seconds, points_scored, points_allowed, offensive_epa, defensive_epa, passing_epa, rushing_epa, fantasy_dst_points, game_id, opponent_id, team_id`

#### `gridstream_teamlogo` (128 rows)

`id, logo_type, url, width, height, team_id`

#### `gridstream_venue` (168 rows)

`id, espn_id, name, city, state, country, latitude, longitude, roof_type, surface, is_indoor, pfr_stadium_id`

#### `plays` (1279628 rows)

`game_id, play_id, old_game_id, drive, home_team, away_team, posteam, posteam_type, defteam, game_date, season_type, week, stadium, weather, surface, roof, qtr, quarter_seconds_remaining, half_seconds_remaining, game_seconds_remaining, down, ydstogo, yardline_100, side_of_field, shotgun, no_huddle, play_type, yards_gained, air_yards, yards_after_catch, epa, wpa, success, passer_player_id, passer_player_name, rusher_player_id, rusher_player_name, receiver_player_id, receiver_player_name, touchdown, interception, fumble, sack, complete_pass, pass_touchdown, rush_touchdown, field_goal_result, kick_distance, punt_blocked, penalty, penalty_type, penalty_yards`

---

## 2) Data available but not currently ingested

## 2A) nflfastR PBP field coverage gap

### Summary

- `nflfastR` PBP fields available: **372**
- Current raw `plays` fields ingested: **52**
- Missing vs nflfastR full field set: **320**

Current raw schema source:

- `packages/db/init/01_schema.sql`
- `apps/service-rust/nflreadrust/src/models.rs`
- `apps/service-rust/nflreadrust/src/lib.rs`

Current importer explicitly acknowledges missing columns:

- `apps/api-django/gridstream/management/commands/import_plays.py`
- `apps/api-django/gridstream/management/commands/import_player_game_stats.py`
- `apps/api-django/gridstream/management/commands/import_team_game_stats.py`

### Highest-value missing fields (prioritized subset)

The following fields from the 320 missing are highest priority for v2 because they directly eliminate
frontend heuristics or unlock new UI features. See the full table below for the complete list.

| Field                                                                                                                                               | Why it matters                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `home_timeouts_remaining`, `away_timeouts_remaining`                                                                                                | Eliminates timeout text-parsing counter; enables accurate TO bubbles in score bug   |
| `timeout`, `timeout_team`                                                                                                                           | Eliminates `parseTimeoutUsage()` regex                                              |
| `home_wp`, `away_wp`, `vegas_wp`, `vegas_home_wp`                                                                                                   | Replaces `estimateAwayWinPct()` heuristic entirely; makes WinProbSparkline accurate |
| `punt_returner_player_name/id`, `kickoff_returner_player_name/id`                                                                                   | Eliminates 80-line `parseKickDetails()` regex; enables reliable kick animation      |
| `return_yards`, `return_team`                                                                                                                       | Part of eliminating kick/turnover text parsing                                      |
| `touchback`, `out_of_bounds`, `punt_inside_twenty`, `punt_fair_catch`, `kickoff_in_endzone`                                                         | Kick animation flags; currently all parsed from description text                    |
| `interception_player_name/id`, `fumble_recovery_1_player_name/team/yards`                                                                           | Eliminates `parseTurnoverDetails()` regex + projection heuristic                    |
| `penalty_player_name`, `penalty_player_id`, `penalty_team`                                                                                          | Eliminates `parsePenaltyDetails()` regex                                            |
| `pass_attempt`, `rush_attempt`, `kickoff_attempt`, `punt_attempt`, `extra_point_attempt`, `two_point_attempt`, `special_teams_play`, `st_play_type` | Eliminates play-type inference in `resolveAnimType()`                               |
| `score_differential`                                                                                                                                | Eliminates manual running score diff accumulation                                   |
| `total_home_epa`, `total_away_epa`, `total_home_rush_epa`, `total_home_pass_epa`                                                                    | Eliminates per-play EPA accumulation in replay timeline                             |
| `drive_start_transition`, `drive_end_transition`                                                                                                    | Enriches drive tracker ("Following INT", "After Punt")                              |
| `series_result`                                                                                                                                     | Adds drive series context to mission log                                            |
| `sack_player_name/id`, `tackle_for_loss_1_player_name`, `pass_defense_1_player_name`                                                                | Enables defender attribution in MissionLog                                          |
| `cp`, `cpoe`                                                                                                                                        | New: completion % over expectation annotation on pass plays                         |
| `td_prob`, `fg_prob`, `no_score_prob`                                                                                                               | New: pre-snap score probability context overlay                                     |

### Exhaustive missing nflfastR fields (name + description)

| Missing Field                          | Description                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game_half`                            | String indicating which half the play is in, either Half1, Half2, or Overtime.                                                                                                                                                                                                                                                                        |
| `quarter_end`                          | Binary indicator for whether or not the row of the data is marking the end of a quarter.                                                                                                                                                                                                                                                              |
| `sp`                                   | Binary indicator for whether or not a score occurred on the play.                                                                                                                                                                                                                                                                                     |
| `goal_to_go`                           | Binary indicator for whether or not the posteam is in a goal down situation.                                                                                                                                                                                                                                                                          |
| `time`                                 | Time at start of play provided in string format as minutes:seconds remaining in the quarter.                                                                                                                                                                                                                                                          |
| `yrdln`                                | String indicating the current field position for a given play.                                                                                                                                                                                                                                                                                        |
| `ydsnet`                               | Numeric value for total yards gained on the given drive.                                                                                                                                                                                                                                                                                              |
| `desc`                                 | Detailed string description for the given play.                                                                                                                                                                                                                                                                                                       |
| `qb_dropback`                          | Binary indicator for whether or not the QB dropped back on the play (pass attempt, sack, or scrambled).                                                                                                                                                                                                                                               |
| `qb_kneel`                             | Binary indicator for whether or not the QB took a knee.                                                                                                                                                                                                                                                                                               |
| `qb_spike`                             | Binary indicator for whether or not the QB spiked the ball.                                                                                                                                                                                                                                                                                           |
| `qb_scramble`                          | Binary indicator for whether or not the QB scrambled.                                                                                                                                                                                                                                                                                                 |
| `pass_length`                          | String indicator for pass length: short or deep.                                                                                                                                                                                                                                                                                                      |
| `pass_location`                        | String indicator for pass location: left, middle, or right.                                                                                                                                                                                                                                                                                           |
| `run_location`                         | String indicator for location of run: left, middle, or right.                                                                                                                                                                                                                                                                                         |
| `run_gap`                              | String indicator for line gap of run: end, guard, or tackle                                                                                                                                                                                                                                                                                           |
| `extra_point_result`                   | String indicator for the result of the extra point attempt: good, failed, blocked, safety (touchback in defensive endzone is 1 point apparently), or aborted.                                                                                                                                                                                         |
| `two_point_conv_result`                | String indicator for result of two point conversion attempt: success, failure, safety (touchback in defensive endzone is 1 point apparently), or return.                                                                                                                                                                                              |
| `home_timeouts_remaining`              | Numeric timeouts remaining in the half for the home team.                                                                                                                                                                                                                                                                                             |
| `away_timeouts_remaining`              | Numeric timeouts remaining in the half for the away team.                                                                                                                                                                                                                                                                                             |
| `timeout`                              | Binary indicator for whether or not a timeout was called by either team.                                                                                                                                                                                                                                                                              |
| `timeout_team`                         | String abbreviation for which team called the timeout.                                                                                                                                                                                                                                                                                                |
| `td_team`                              | String abbreviation for which team scored the touchdown.                                                                                                                                                                                                                                                                                              |
| `td_player_name`                       | String name of the player who scored a touchdown.                                                                                                                                                                                                                                                                                                     |
| `td_player_id`                         | Unique identifier of the player who scored a touchdown.                                                                                                                                                                                                                                                                                               |
| `posteam_timeouts_remaining`           | Number of timeouts remaining for the possession team.                                                                                                                                                                                                                                                                                                 |
| `defteam_timeouts_remaining`           | Number of timeouts remaining for the team on defense.                                                                                                                                                                                                                                                                                                 |
| `total_home_score`                     | Score for the home team at the end of the play.                                                                                                                                                                                                                                                                                                       |
| `total_away_score`                     | Score for the away team at the end of the play.                                                                                                                                                                                                                                                                                                       |
| `posteam_score`                        | Score the posteam at the start of the play.                                                                                                                                                                                                                                                                                                           |
| `defteam_score`                        | Score the defteam at the start of the play.                                                                                                                                                                                                                                                                                                           |
| `score_differential`                   | Score differential between the posteam and defteam at the start of the play.                                                                                                                                                                                                                                                                          |
| `posteam_score_post`                   | Score for the posteam at the end of the play.                                                                                                                                                                                                                                                                                                         |
| `defteam_score_post`                   | Score for the defteam at the end of the play.                                                                                                                                                                                                                                                                                                         |
| `score_differential_post`              | Score differential between the posteam and defteam at the end of the play.                                                                                                                                                                                                                                                                            |
| `no_score_prob`                        | Predicted probability of no score occurring for the rest of the half based on the expected points model.                                                                                                                                                                                                                                              |
| `opp_fg_prob`                          | Predicted probability of the defteam scoring a FG next.                                                                                                                                                                                                                                                                                               |
| `opp_safety_prob`                      | Predicted probability of the defteam scoring a safety next.                                                                                                                                                                                                                                                                                           |
| `opp_td_prob`                          | Predicted probability of the defteam scoring a TD next.                                                                                                                                                                                                                                                                                               |
| `fg_prob`                              | Predicted probability of the posteam scoring a FG next.                                                                                                                                                                                                                                                                                               |
| `safety_prob`                          | Predicted probability of the posteam scoring a safety next.                                                                                                                                                                                                                                                                                           |
| `td_prob`                              | Predicted probability of the posteam scoring a TD next.                                                                                                                                                                                                                                                                                               |
| `extra_point_prob`                     | Predicted probability of the posteam scoring an extra point.                                                                                                                                                                                                                                                                                          |
| `two_point_conversion_prob`            | Predicted probability of the posteam scoring the two point conversion.                                                                                                                                                                                                                                                                                |
| `ep`                                   | Using the scoring event probabilities, the estimated expected points with respect to the possession team for the given play.                                                                                                                                                                                                                          |
| `total_home_epa`                       | Cumulative total EPA for the home team in the game so far.                                                                                                                                                                                                                                                                                            |
| `total_away_epa`                       | Cumulative total EPA for the away team in the game so far.                                                                                                                                                                                                                                                                                            |
| `total_home_rush_epa`                  | Cumulative total rushing EPA for the home team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_away_rush_epa`                  | Cumulative total rushing EPA for the away team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_home_pass_epa`                  | Cumulative total passing EPA for the home team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_away_pass_epa`                  | Cumulative total passing EPA for the away team in the game so far.                                                                                                                                                                                                                                                                                    |
| `air_epa`                              | EPA from the air yards alone. For completions this represents the actual value provided through the air. For incompletions this represents the hypothetical value that could've been added through the air if the pass was completed.                                                                                                                 |
| `yac_epa`                              | EPA from the yards after catch alone. For completions this represents the actual value provided after the catch. For incompletions this represents the difference between the hypothetical air_epa and the play's raw observed EPA (how much the incomplete pass cost the posteam).                                                                   |
| `comp_air_epa`                         | EPA from the air yards alone only for completions.                                                                                                                                                                                                                                                                                                    |
| `comp_yac_epa`                         | EPA from the yards after catch alone only for completions.                                                                                                                                                                                                                                                                                            |
| `total_home_comp_air_epa`              | Cumulative total completions air EPA for the home team in the game so far.                                                                                                                                                                                                                                                                            |
| `total_away_comp_air_epa`              | Cumulative total completions air EPA for the away team in the game so far.                                                                                                                                                                                                                                                                            |
| `total_home_comp_yac_epa`              | Cumulative total completions yac EPA for the home team in the game so far.                                                                                                                                                                                                                                                                            |
| `total_away_comp_yac_epa`              | Cumulative total completions yac EPA for the away team in the game so far.                                                                                                                                                                                                                                                                            |
| `total_home_raw_air_epa`               | Cumulative total raw air EPA for the home team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_away_raw_air_epa`               | Cumulative total raw air EPA for the away team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_home_raw_yac_epa`               | Cumulative total raw yac EPA for the home team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_away_raw_yac_epa`               | Cumulative total raw yac EPA for the away team in the game so far.                                                                                                                                                                                                                                                                                    |
| `wp`                                   | Estimated win probabiity for the posteam given the current situation at the start of the given play.                                                                                                                                                                                                                                                  |
| `def_wp`                               | Estimated win probability for the defteam.                                                                                                                                                                                                                                                                                                            |
| `home_wp`                              | Estimated win probability for the home team.                                                                                                                                                                                                                                                                                                          |
| `away_wp`                              | Estimated win probability for the away team.                                                                                                                                                                                                                                                                                                          |
| `vegas_wpa`                            | Win probability added (WPA) for the posteam: spread_adjusted model.                                                                                                                                                                                                                                                                                   |
| `vegas_home_wpa`                       | Win probability added (WPA) for the home team: spread_adjusted model.                                                                                                                                                                                                                                                                                 |
| `home_wp_post`                         | Estimated win probability for the home team at the end of the play.                                                                                                                                                                                                                                                                                   |
| `away_wp_post`                         | Estimated win probability for the away team at the end of the play.                                                                                                                                                                                                                                                                                   |
| `vegas_wp`                             | Estimated win probabiity for the posteam given the current situation at the start of the given play, incorporating pre-game Vegas line.                                                                                                                                                                                                               |
| `vegas_home_wp`                        | Estimated win probability for the home team incorporating pre-game Vegas line.                                                                                                                                                                                                                                                                        |
| `total_home_rush_wpa`                  | Cumulative total rushing WPA for the home team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_away_rush_wpa`                  | Cumulative total rushing WPA for the away team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_home_pass_wpa`                  | Cumulative total passing WPA for the home team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_away_pass_wpa`                  | Cumulative total passing WPA for the away team in the game so far.                                                                                                                                                                                                                                                                                    |
| `air_wpa`                              | WPA through the air (same logic as air_epa).                                                                                                                                                                                                                                                                                                          |
| `yac_wpa`                              | WPA from yards after the catch (same logic as yac_epa).                                                                                                                                                                                                                                                                                               |
| `comp_air_wpa`                         | The air_wpa for completions only.                                                                                                                                                                                                                                                                                                                     |
| `comp_yac_wpa`                         | The yac_wpa for completions only.                                                                                                                                                                                                                                                                                                                     |
| `total_home_comp_air_wpa`              | Cumulative total completions air WPA for the home team in the game so far.                                                                                                                                                                                                                                                                            |
| `total_away_comp_air_wpa`              | Cumulative total completions air WPA for the away team in the game so far.                                                                                                                                                                                                                                                                            |
| `total_home_comp_yac_wpa`              | Cumulative total completions yac WPA for the home team in the game so far.                                                                                                                                                                                                                                                                            |
| `total_away_comp_yac_wpa`              | Cumulative total completions yac WPA for the away team in the game so far.                                                                                                                                                                                                                                                                            |
| `total_home_raw_air_wpa`               | Cumulative total raw air WPA for the home team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_away_raw_air_wpa`               | Cumulative total raw air WPA for the away team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_home_raw_yac_wpa`               | Cumulative total raw yac WPA for the home team in the game so far.                                                                                                                                                                                                                                                                                    |
| `total_away_raw_yac_wpa`               | Cumulative total raw yac WPA for the away team in the game so far.                                                                                                                                                                                                                                                                                    |
| `first_down_rush`                      | Binary indicator for if a running play converted the first down.                                                                                                                                                                                                                                                                                      |
| `first_down_pass`                      | Binary indicator for if a passing play converted the first down.                                                                                                                                                                                                                                                                                      |
| `first_down_penalty`                   | Binary indicator for if a penalty converted the first down.                                                                                                                                                                                                                                                                                           |
| `third_down_converted`                 | Binary indicator for if the first down was converted on third down.                                                                                                                                                                                                                                                                                   |
| `third_down_failed`                    | Binary indicator for if the posteam failed to convert first down on third down.                                                                                                                                                                                                                                                                       |
| `fourth_down_converted`                | Binary indicator for if the first down was converted on fourth down.                                                                                                                                                                                                                                                                                  |
| `fourth_down_failed`                   | Binary indicator for if the posteam failed to convert first down on fourth down.                                                                                                                                                                                                                                                                      |
| `incomplete_pass`                      | Binary indicator for if the pass was incomplete.                                                                                                                                                                                                                                                                                                      |
| `touchback`                            | Binary indicator for if a touchback occurred on the play.                                                                                                                                                                                                                                                                                             |
| `punt_inside_twenty`                   | Binary indicator for if the punt ended inside the twenty yard line.                                                                                                                                                                                                                                                                                   |
| `punt_in_endzone`                      | Binary indicator for if the punt was in the endzone.                                                                                                                                                                                                                                                                                                  |
| `punt_out_of_bounds`                   | Binary indicator for if the punt went out of bounds.                                                                                                                                                                                                                                                                                                  |
| `punt_downed`                          | Binary indicator for if the punt was downed.                                                                                                                                                                                                                                                                                                          |
| `punt_fair_catch`                      | Binary indicator for if the punt was caught with a fair catch.                                                                                                                                                                                                                                                                                        |
| `kickoff_inside_twenty`                | Binary indicator for if the kickoff ended inside the twenty yard line.                                                                                                                                                                                                                                                                                |
| `kickoff_in_endzone`                   | Binary indicator for if the kickoff was in the endzone.                                                                                                                                                                                                                                                                                               |
| `kickoff_out_of_bounds`                | Binary indicator for if the kickoff went out of bounds.                                                                                                                                                                                                                                                                                               |
| `kickoff_downed`                       | Binary indicator for if the kickoff was downed.                                                                                                                                                                                                                                                                                                       |
| `kickoff_fair_catch`                   | Binary indicator for if the kickoff was caught with a fair catch.                                                                                                                                                                                                                                                                                     |
| `fumble_forced`                        | Binary indicator for if the fumble was forced.                                                                                                                                                                                                                                                                                                        |
| `fumble_not_forced`                    | Binary indicator for if the fumble was not forced.                                                                                                                                                                                                                                                                                                    |
| `fumble_out_of_bounds`                 | Binary indicator for if the fumble went out of bounds.                                                                                                                                                                                                                                                                                                |
| `solo_tackle`                          | Binary indicator if the play had a solo tackle (could be multiple due to fumbles).                                                                                                                                                                                                                                                                    |
| `safety`                               | Binary indicator for whether or not a safety occurred.                                                                                                                                                                                                                                                                                                |
| `tackled_for_loss`                     | Binary indicator for whether or not a tackle for loss on a run play occurred.                                                                                                                                                                                                                                                                         |
| `fumble_lost`                          | Binary indicator for if the fumble was lost.                                                                                                                                                                                                                                                                                                          |
| `own_kickoff_recovery`                 | Binary indicator for if the kicking team recovered the kickoff.                                                                                                                                                                                                                                                                                       |
| `own_kickoff_recovery_td`              | Binary indicator for if the kicking team recovered the kickoff and scored a TD.                                                                                                                                                                                                                                                                       |
| `qb_hit`                               | Binary indicator if the QB was hit on the play.                                                                                                                                                                                                                                                                                                       |
| `rush_attempt`                         | Binary indicator for if the play was a run.                                                                                                                                                                                                                                                                                                           |
| `pass_attempt`                         | Binary indicator for if the play was a pass attempt (includes sacks).                                                                                                                                                                                                                                                                                 |
| `return_touchdown`                     | Binary indicator for if the play resulted in a return TD.                                                                                                                                                                                                                                                                                             |
| `extra_point_attempt`                  | Binary indicator for extra point attempt.                                                                                                                                                                                                                                                                                                             |
| `two_point_attempt`                    | Binary indicator for two point conversion attempt.                                                                                                                                                                                                                                                                                                    |
| `field_goal_attempt`                   | Binary indicator for field goal attempt.                                                                                                                                                                                                                                                                                                              |
| `kickoff_attempt`                      | Binary indicator for kickoff.                                                                                                                                                                                                                                                                                                                         |
| `punt_attempt`                         | Binary indicator for punts.                                                                                                                                                                                                                                                                                                                           |
| `assist_tackle`                        | Binary indicator for if an assist tackle occurred.                                                                                                                                                                                                                                                                                                    |
| `lateral_reception`                    | Binary indicator for if a lateral occurred on the reception.                                                                                                                                                                                                                                                                                          |
| `lateral_rush`                         | Binary indicator for if a lateral occurred on a run.                                                                                                                                                                                                                                                                                                  |
| `lateral_return`                       | Binary indicator for if a lateral occurred on a return.                                                                                                                                                                                                                                                                                               |
| `lateral_recovery`                     | Binary indicator for if a lateral occurred on a fumble recovery.                                                                                                                                                                                                                                                                                      |
| `passing_yards`                        | Numeric yards by the passer_player_name, including yards gained in pass plays with laterals. This should equal official passing statistics.                                                                                                                                                                                                           |
| `receiving_yards`                      | Numeric yards by the receiver_player_name, excluding yards gained in pass plays with laterals. This should equal official receiving statistics but could miss yards gained in pass plays with laterals. Please see the description of `lateral_receiver_player_name` for further information.                                                         |
| `rushing_yards`                        | Numeric yards by the rusher_player_name, excluding yards gained in rush plays with laterals. This should equal official rushing statistics but could miss yards gained in rush plays with laterals. Please see the description of `lateral_rusher_player_name` for further information.                                                               |
| `lateral_receiver_player_id`           | Unique identifier for the player that received the last(!) lateral on a pass play.                                                                                                                                                                                                                                                                    |
| `lateral_receiver_player_name`         | String name for the player that received the last(!) lateral on a pass play. If there were multiple laterals in the same play, this will only be the last player who received a lateral. Please see <https://github.com/mrcaseb/nfl-data/tree/master/data/lateral_yards> for a list of plays where multiple players recorded lateral receiving yards. |
| `lateral_receiving_yards`              | Numeric yards by the `lateral_receiver_player_name` in pass plays with laterals. Please see the description of `lateral_receiver_player_name` for further information.                                                                                                                                                                                |
| `lateral_rusher_player_id`             | Unique identifier for the player that received the last(!) lateral on a run play.                                                                                                                                                                                                                                                                     |
| `lateral_rusher_player_name`           | String name for the player that received the last(!) lateral on a run play. If there were multiple laterals in the same play, this will only be the last player who received a lateral. Please see <https://github.com/mrcaseb/nfl-data/tree/master/data/lateral_yards> for a list of plays where multiple players recorded lateral rushing yards.    |
| `lateral_rushing_yards`                | Numeric yards by the `lateral_rusher_player_name` in run plays with laterals. Please see the description of `lateral_rusher_player_name` for further information.                                                                                                                                                                                     |
| `lateral_sack_player_id`               | Unique identifier for the player that received the lateral on a sack.                                                                                                                                                                                                                                                                                 |
| `lateral_sack_player_name`             | String name for the player that received the lateral on a sack.                                                                                                                                                                                                                                                                                       |
| `interception_player_id`               | Unique identifier for the player that intercepted the pass.                                                                                                                                                                                                                                                                                           |
| `interception_player_name`             | String name for the player that intercepted the pass.                                                                                                                                                                                                                                                                                                 |
| `lateral_interception_player_id`       | Unique indentifier for the player that received the lateral on an interception.                                                                                                                                                                                                                                                                       |
| `lateral_interception_player_name`     | String name for the player that received the lateral on an interception.                                                                                                                                                                                                                                                                              |
| `punt_returner_player_id`              | Unique identifier for the punt returner.                                                                                                                                                                                                                                                                                                              |
| `punt_returner_player_name`            | String name for the punt returner.                                                                                                                                                                                                                                                                                                                    |
| `lateral_punt_returner_player_id`      | Unique identifier for the player that received the lateral on a punt return.                                                                                                                                                                                                                                                                          |
| `lateral_punt_returner_player_name`    | String name for the player that received the lateral on a punt return.                                                                                                                                                                                                                                                                                |
| `kickoff_returner_player_name`         | String name for the kickoff returner.                                                                                                                                                                                                                                                                                                                 |
| `kickoff_returner_player_id`           | Unique identifier for the kickoff returner.                                                                                                                                                                                                                                                                                                           |
| `lateral_kickoff_returner_player_id`   | Unique identifier for the player that received the lateral on a kickoff return.                                                                                                                                                                                                                                                                       |
| `lateral_kickoff_returner_player_name` | String name for the player that received the lateral on a kickoff return.                                                                                                                                                                                                                                                                             |
| `punter_player_id`                     | Unique identifier for the punter.                                                                                                                                                                                                                                                                                                                     |
| `punter_player_name`                   | String name for the punter.                                                                                                                                                                                                                                                                                                                           |
| `kicker_player_name`                   | String name for the kicker on FG or kickoff.                                                                                                                                                                                                                                                                                                          |
| `kicker_player_id`                     | Unique identifier for the kicker on FG or kickoff.                                                                                                                                                                                                                                                                                                    |
| `own_kickoff_recovery_player_id`       | Unique identifier for the player that recovered their own kickoff.                                                                                                                                                                                                                                                                                    |
| `own_kickoff_recovery_player_name`     | String name for the player that recovered their own kickoff.                                                                                                                                                                                                                                                                                          |
| `blocked_player_id`                    | Unique identifier for the player that blocked the punt or FG.                                                                                                                                                                                                                                                                                         |
| `blocked_player_name`                  | String name for the player that blocked the punt or FG.                                                                                                                                                                                                                                                                                               |
| `tackle_for_loss_1_player_id`          | Unique identifier for one of the potential players with the tackle for loss.                                                                                                                                                                                                                                                                          |
| `tackle_for_loss_1_player_name`        | String name for one of the potential players with the tackle for loss.                                                                                                                                                                                                                                                                                |
| `tackle_for_loss_2_player_id`          | Unique identifier for one of the potential players with the tackle for loss.                                                                                                                                                                                                                                                                          |
| `tackle_for_loss_2_player_name`        | String name for one of the potential players with the tackle for loss.                                                                                                                                                                                                                                                                                |
| `qb_hit_1_player_id`                   | Unique identifier for one of the potential players that hit the QB. No sack as the QB was not the ball carrier. For sacks please see `sack_player` or `half_sack_*_player`.                                                                                                                                                                           |
| `qb_hit_1_player_name`                 | String name for one of the potential players that hit the QB. No sack as the QB was not the ball carrier. For sacks please see `sack_player` or `half_sack_*_player`.                                                                                                                                                                                 |
| `qb_hit_2_player_id`                   | Unique identifier for one of the potential players that hit the QB. No sack as the QB was not the ball carrier. For sacks please see `sack_player` or `half_sack_*_player`.                                                                                                                                                                           |
| `qb_hit_2_player_name`                 | String name for one of the potential players that hit the QB. No sack as the QB was not the ball carrier. For sacks please see `sack_player` or `half_sack_*_player`.                                                                                                                                                                                 |
| `forced_fumble_player_1_team`          | Team of one of the players with a forced fumble.                                                                                                                                                                                                                                                                                                      |
| `forced_fumble_player_1_player_id`     | Unique identifier of one of the players with a forced fumble.                                                                                                                                                                                                                                                                                         |
| `forced_fumble_player_1_player_name`   | String name of one of the players with a forced fumble.                                                                                                                                                                                                                                                                                               |
| `forced_fumble_player_2_team`          | Team of one of the players with a forced fumble.                                                                                                                                                                                                                                                                                                      |
| `forced_fumble_player_2_player_id`     | Unique identifier of one of the players with a forced fumble.                                                                                                                                                                                                                                                                                         |
| `forced_fumble_player_2_player_name`   | String name of one of the players with a forced fumble.                                                                                                                                                                                                                                                                                               |
| `solo_tackle_1_team`                   | Team of one of the players with a solo tackle.                                                                                                                                                                                                                                                                                                        |
| `solo_tackle_2_team`                   | Team of one of the players with a solo tackle.                                                                                                                                                                                                                                                                                                        |
| `solo_tackle_1_player_id`              | Unique identifier of one of the players with a solo tackle.                                                                                                                                                                                                                                                                                           |
| `solo_tackle_2_player_id`              | Unique identifier of one of the players with a solo tackle.                                                                                                                                                                                                                                                                                           |
| `solo_tackle_1_player_name`            | String name of one of the players with a solo tackle.                                                                                                                                                                                                                                                                                                 |
| `solo_tackle_2_player_name`            | String name of one of the players with a solo tackle.                                                                                                                                                                                                                                                                                                 |
| `assist_tackle_1_player_id`            | Unique identifier of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                         |
| `assist_tackle_1_player_name`          | String name of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                               |
| `assist_tackle_1_team`                 | Team of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                                      |
| `assist_tackle_2_player_id`            | Unique identifier of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                         |
| `assist_tackle_2_player_name`          | String name of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                               |
| `assist_tackle_2_team`                 | Team of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                                      |
| `assist_tackle_3_player_id`            | Unique identifier of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                         |
| `assist_tackle_3_player_name`          | String name of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                               |
| `assist_tackle_3_team`                 | Team of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                                      |
| `assist_tackle_4_player_id`            | Unique identifier of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                         |
| `assist_tackle_4_player_name`          | String name of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                               |
| `assist_tackle_4_team`                 | Team of one of the players with a tackle assist.                                                                                                                                                                                                                                                                                                      |
| `tackle_with_assist`                   | Binary indicator for if there has been a tackle with assist.                                                                                                                                                                                                                                                                                          |
| `tackle_with_assist_1_player_id`       | Unique identifier of one of the players with a tackle with assist.                                                                                                                                                                                                                                                                                    |
| `tackle_with_assist_1_player_name`     | String name of one of the players with a tackle with assist.                                                                                                                                                                                                                                                                                          |
| `tackle_with_assist_1_team`            | Team of one of the players with a tackle with assist.                                                                                                                                                                                                                                                                                                 |
| `tackle_with_assist_2_player_id`       | Unique identifier of one of the players with a tackle with assist.                                                                                                                                                                                                                                                                                    |
| `tackle_with_assist_2_player_name`     | String name of one of the players with a tackle with assist.                                                                                                                                                                                                                                                                                          |
| `tackle_with_assist_2_team`            | Team of one of the players with a tackle with assist.                                                                                                                                                                                                                                                                                                 |
| `pass_defense_1_player_id`             | Unique identifier of one of the players with a pass defense.                                                                                                                                                                                                                                                                                          |
| `pass_defense_1_player_name`           | String name of one of the players with a pass defense.                                                                                                                                                                                                                                                                                                |
| `pass_defense_2_player_id`             | Unique identifier of one of the players with a pass defense.                                                                                                                                                                                                                                                                                          |
| `pass_defense_2_player_name`           | String name of one of the players with a pass defense.                                                                                                                                                                                                                                                                                                |
| `fumbled_1_team`                       | Team of one of the first player with a fumble.                                                                                                                                                                                                                                                                                                        |
| `fumbled_1_player_id`                  | Unique identifier of the first player who fumbled on the play.                                                                                                                                                                                                                                                                                        |
| `fumbled_1_player_name`                | String name of one of the first player who fumbled on the play.                                                                                                                                                                                                                                                                                       |
| `fumbled_2_player_id`                  | Unique identifier of the second player who fumbled on the play.                                                                                                                                                                                                                                                                                       |
| `fumbled_2_player_name`                | String name of one of the second player who fumbled on the play.                                                                                                                                                                                                                                                                                      |
| `fumbled_2_team`                       | Team of one of the second player with a fumble.                                                                                                                                                                                                                                                                                                       |
| `fumble_recovery_1_team`               | Team of one of the players with a fumble recovery.                                                                                                                                                                                                                                                                                                    |
| `fumble_recovery_1_yards`              | Yards gained by one of the players with a fumble recovery.                                                                                                                                                                                                                                                                                            |
| `fumble_recovery_1_player_id`          | Unique identifier of one of the players with a fumble recovery.                                                                                                                                                                                                                                                                                       |
| `fumble_recovery_1_player_name`        | String name of one of the players with a fumble recovery.                                                                                                                                                                                                                                                                                             |
| `fumble_recovery_2_team`               | Team of one of the players with a fumble recovery.                                                                                                                                                                                                                                                                                                    |
| `fumble_recovery_2_yards`              | Yards gained by one of the players with a fumble recovery.                                                                                                                                                                                                                                                                                            |
| `fumble_recovery_2_player_id`          | Unique identifier of one of the players with a fumble recovery.                                                                                                                                                                                                                                                                                       |
| `fumble_recovery_2_player_name`        | String name of one of the players with a fumble recovery.                                                                                                                                                                                                                                                                                             |
| `sack_player_id`                       | Unique identifier of the player who recorded a solo sack.                                                                                                                                                                                                                                                                                             |
| `sack_player_name`                     | String name of the player who recorded a solo sack.                                                                                                                                                                                                                                                                                                   |
| `half_sack_1_player_id`                | Unique identifier of the first player who recorded half a sack.                                                                                                                                                                                                                                                                                       |
| `half_sack_1_player_name`              | String name of the first player who recorded half a sack.                                                                                                                                                                                                                                                                                             |
| `half_sack_2_player_id`                | Unique identifier of the second player who recorded half a sack.                                                                                                                                                                                                                                                                                      |
| `half_sack_2_player_name`              | String name of the second player who recorded half a sack.                                                                                                                                                                                                                                                                                            |
| `return_team`                          | String abbreviation of the return team.                                                                                                                                                                                                                                                                                                               |
| `return_yards`                         | Yards gained by the return team.                                                                                                                                                                                                                                                                                                                      |
| `penalty_team`                         | String abbreviation of the team with the penalty.                                                                                                                                                                                                                                                                                                     |
| `penalty_player_id`                    | Unique identifier for the player with the penalty.                                                                                                                                                                                                                                                                                                    |
| `penalty_player_name`                  | String name for the player with the penalty.                                                                                                                                                                                                                                                                                                          |
| `replay_or_challenge`                  | Binary indicator for whether or not a replay or challenge.                                                                                                                                                                                                                                                                                            |
| `replay_or_challenge_result`           | String indicating the result of the replay or challenge.                                                                                                                                                                                                                                                                                              |
| `defensive_two_point_attempt`          | Binary indicator whether or not the defense was able to have an attempt on a two point conversion, this results following a turnover.                                                                                                                                                                                                                 |
| `defensive_two_point_conv`             | Binary indicator whether or not the defense successfully scored on the two point conversion.                                                                                                                                                                                                                                                          |
| `defensive_extra_point_attempt`        | Binary indicator whether or not the defense was able to have an attempt on an extra point attempt, this results following a blocked attempt that the defense recovers the ball.                                                                                                                                                                       |
| `defensive_extra_point_conv`           | Binary indicator whether or not the defense successfully scored on an extra point attempt.                                                                                                                                                                                                                                                            |
| `safety_player_name`                   | String name for the player who scored a safety.                                                                                                                                                                                                                                                                                                       |
| `safety_player_id`                     | Unique identifier for the player who scored a safety.                                                                                                                                                                                                                                                                                                 |
| `season`                               | 4 digit number indicating to which season the game belongs to.                                                                                                                                                                                                                                                                                        |
| `cp`                                   | Numeric value indicating the probability for a complete pass based on comparable game situations.                                                                                                                                                                                                                                                     |
| `cpoe`                                 | For a single pass play this is 1 - cp when the pass was completed or 0 - cp when the pass was incomplete. Analyzed for a whole game or season an indicator for the passer how much over or under expectation his completion percentage was.                                                                                                           |
| `series`                               | Starts at 1, each new first down increments, numbers shared across both teams NA: kickoffs, extra point/two point conversion attempts, non-plays, no posteam                                                                                                                                                                                          |
| `series_success`                       | 1: scored touchdown, gained enough yards for first down.                                                                                                                                                                                                                                                                                              |
| `series_result`                        | Possible values: First down, Touchdown, Opp touchdown, Field goal, Missed field goal, Safety, Turnover, Punt, Turnover on downs, QB kneel, End of half                                                                                                                                                                                                |
| `order_sequence`                       | Column provided by NFL to fix out-of-order plays. Available 2011 and beyond with source "nfl".                                                                                                                                                                                                                                                        |
| `start_time`                           | Kickoff time in eastern time zone.                                                                                                                                                                                                                                                                                                                    |
| `time_of_day`                          | Time of day of play in UTC "HH:MM:SS" format. Available 2011 and beyond with source "nfl".                                                                                                                                                                                                                                                            |
| `nfl_api_id`                           | UUID of the game in the new NFL API.                                                                                                                                                                                                                                                                                                                  |
| `play_clock`                           | Time on the playclock when the ball was snapped.                                                                                                                                                                                                                                                                                                      |
| `play_deleted`                         | Binary indicator for deleted plays.                                                                                                                                                                                                                                                                                                                   |
| `play_type_nfl`                        | Play type as listed in the NFL source. Slightly different to the regular play_type variable.                                                                                                                                                                                                                                                          |
| `special_teams_play`                   | Binary indicator for whether play is special teams play from NFL source. Available 2011 and beyond with source "nfl".                                                                                                                                                                                                                                 |
| `st_play_type`                         | Type of special teams play from NFL source. Available 2011 and beyond with source "nfl".                                                                                                                                                                                                                                                              |
| `end_clock_time`                       | Game time at the end of a given play.                                                                                                                                                                                                                                                                                                                 |
| `end_yard_line`                        | String indicating the yardline at the end of the given play consisting of team half and yard line number.                                                                                                                                                                                                                                             |
| `fixed_drive`                          | Manually created drive number in a game.                                                                                                                                                                                                                                                                                                              |
| `fixed_drive_result`                   | Manually created drive result.                                                                                                                                                                                                                                                                                                                        |
| `drive_real_start_time`                | Local day time when the drive started (currently not used by the NFL and therefore mostly 'NA').                                                                                                                                                                                                                                                      |
| `drive_play_count`                     | Numeric value of how many regular plays happened in a given drive.                                                                                                                                                                                                                                                                                    |
| `drive_time_of_possession`             | Time of possession in a given drive.                                                                                                                                                                                                                                                                                                                  |
| `drive_first_downs`                    | Number of first downs in a given drive.                                                                                                                                                                                                                                                                                                               |
| `drive_inside20`                       | Binary indicator if the offense was able to get inside the opponents 20 yard line.                                                                                                                                                                                                                                                                    |
| `drive_ended_with_score`               | Binary indicator the drive ended with a score.                                                                                                                                                                                                                                                                                                        |
| `drive_quarter_start`                  | Numeric value indicating in which quarter the given drive has started.                                                                                                                                                                                                                                                                                |
| `drive_quarter_end`                    | Numeric value indicating in which quarter the given drive has ended.                                                                                                                                                                                                                                                                                  |
| `drive_yards_penalized`                | Numeric value of how many yards the offense gained or lost through penalties in the given drive.                                                                                                                                                                                                                                                      |
| `drive_start_transition`               | String indicating how the offense got the ball.                                                                                                                                                                                                                                                                                                       |
| `drive_end_transition`                 | String indicating how the offense lost the ball.                                                                                                                                                                                                                                                                                                      |
| `drive_game_clock_start`               | Game time at the beginning of a given drive.                                                                                                                                                                                                                                                                                                          |
| `drive_game_clock_end`                 | Game time at the end of a given drive.                                                                                                                                                                                                                                                                                                                |
| `drive_start_yard_line`                | String indicating where a given drive started consisting of team half and yard line number.                                                                                                                                                                                                                                                           |
| `drive_end_yard_line`                  | String indicating where a given drive ended consisting of team half and yard line number.                                                                                                                                                                                                                                                             |
| `drive_play_id_started`                | Play_id of the first play in the given drive.                                                                                                                                                                                                                                                                                                         |
| `drive_play_id_ended`                  | Play_id of the last play in the given drive.                                                                                                                                                                                                                                                                                                          |
| `away_score`                           | Total points scored by the away team.                                                                                                                                                                                                                                                                                                                 |
| `home_score`                           | Total points scored by the home team.                                                                                                                                                                                                                                                                                                                 |
| `location`                             | Either 'Home' o 'Neutral' indicating if the home team played at home or at a neutral site.                                                                                                                                                                                                                                                            |
| `result`                               | Equals home_score - away_score and means the game outcome from the perspective of the home team.                                                                                                                                                                                                                                                      |
| `total`                                | Equals home_score + away_score and means the total points scored in the given game.                                                                                                                                                                                                                                                                   |
| `spread_line`                          | The closing spread line for the game. A positive number means the home team was favored by that many points, a negative number means the away team was favored by that many points. (Source: Pro-Football-Reference)                                                                                                                                  |
| `total_line`                           | The closing total line for the game. (Source: Pro-Football-Reference)                                                                                                                                                                                                                                                                                 |
| `div_game`                             | Binary indicator for if the given game was a division game.                                                                                                                                                                                                                                                                                           |
| `temp`                                 | The temperature at the stadium only for 'roof' = 'outdoors' or 'open'.(Source: Pro-Football-Reference)                                                                                                                                                                                                                                                |
| `wind`                                 | The speed of the wind in miles/hour only for 'roof' = 'outdoors' or 'open'. (Source: Pro-Football-Reference)                                                                                                                                                                                                                                          |
| `home_coach`                           | First and last name of the home team coach. (Source: Pro-Football-Reference)                                                                                                                                                                                                                                                                          |
| `away_coach`                           | First and last name of the away team coach. (Source: Pro-Football-Reference)                                                                                                                                                                                                                                                                          |
| `stadium_id`                           | ID of the stadium the game was played in. (Source: Pro-Football-Reference)                                                                                                                                                                                                                                                                            |
| `game_stadium`                         | Name of the stadium the game was played in. (Source: Pro-Football-Reference)                                                                                                                                                                                                                                                                          |
| `passer`                               | Name of the dropback player (scrambles included) including plays with penalties.                                                                                                                                                                                                                                                                      |
| `passer_jersey_number`                 | Jersey number of the passer.                                                                                                                                                                                                                                                                                                                          |
| `rusher`                               | Name of the rusher (no scrambles) including plays with penalties.                                                                                                                                                                                                                                                                                     |
| `rusher_jersey_number`                 | Jersey number of the rusher.                                                                                                                                                                                                                                                                                                                          |
| `receiver`                             | Name of the receiver including plays with penalties.                                                                                                                                                                                                                                                                                                  |
| `receiver_jersey_number`               | Jersey number of the receiver.                                                                                                                                                                                                                                                                                                                        |
| `pass`                                 | Binary indicator if the play was a pass play (sacks and scrambles included).                                                                                                                                                                                                                                                                          |
| `rush`                                 | Binary indicator if the play was a rushing play.                                                                                                                                                                                                                                                                                                      |
| `first_down`                           | Binary indicator if the play ended in a first down.                                                                                                                                                                                                                                                                                                   |
| `aborted_play`                         | Binary indicator if the play description indicates "Aborted".                                                                                                                                                                                                                                                                                         |
| `special`                              | Binary indicator if the play was a special teams play.                                                                                                                                                                                                                                                                                                |
| `play`                                 | Binary indicator: 1 if the play was a 'normal' play (including penalties), 0 otherwise.                                                                                                                                                                                                                                                               |
| `passer_id`                            | ID of the player in the 'passer' column.                                                                                                                                                                                                                                                                                                              |
| `rusher_id`                            | ID of the player in the 'rusher' column.                                                                                                                                                                                                                                                                                                              |
| `receiver_id`                          | ID of the player in the 'receiver' column.                                                                                                                                                                                                                                                                                                            |
| `name`                                 | Name of the 'passer' if it is not 'NA', or name of the 'rusher' otherwise.                                                                                                                                                                                                                                                                            |
| `jersey_number`                        | Jersey number of the player listed in the 'name' column.                                                                                                                                                                                                                                                                                              |
| `id`                                   | ID of the player in the 'name' column.                                                                                                                                                                                                                                                                                                                |
| `fantasy_player_name`                  | Name of the rusher on rush plays or receiver on pass plays (from official stats).                                                                                                                                                                                                                                                                     |
| `fantasy_player_id`                    | ID of the rusher on rush plays or receiver on pass plays (from official stats).                                                                                                                                                                                                                                                                       |
| `fantasy`                              | Name of the rusher on rush plays or receiver on pass plays.                                                                                                                                                                                                                                                                                           |
| `fantasy_id`                           | ID of the rusher on rush plays or receiver on pass plays.                                                                                                                                                                                                                                                                                             |
| `out_of_bounds`                        | 1 if play description contains ran ob, pushed ob, or sacked ob; 0 otherwise.                                                                                                                                                                                                                                                                          |
| `home_opening_kickoff`                 | = 1 if the home team received the opening kickoff, 0 otherwise.                                                                                                                                                                                                                                                                                       |
| `qb_epa`                               | Gives QB credit for EPA for up to the point where a receiver lost a fumble after a completed catch and makes EPA work more like passing yards on plays with fumbles.                                                                                                                                                                                  |
| `xyac_epa`                             | Expected value of EPA gained after the catch, starting from where the catch was made. Zero yards after the catch would be listed as zero EPA.                                                                                                                                                                                                         |
| `xyac_mean_yardage`                    | Average expected yards after the catch based on where the ball was caught.                                                                                                                                                                                                                                                                            |
| `xyac_median_yardage`                  | Median expected yards after the catch based on where the ball was caught.                                                                                                                                                                                                                                                                             |
| `xyac_success`                         | Probability play earns positive EPA (relative to where play started) based on where ball was caught.                                                                                                                                                                                                                                                  |
| `xyac_fd`                              | Probability play earns a first down based on where the ball was caught.                                                                                                                                                                                                                                                                               |
| `xpass`                                | Probability of dropback scaled from 0 to 1.                                                                                                                                                                                                                                                                                                           |
| `pass_oe`                              | Dropback percent over expected on a given play scaled from 0 to 100.                                                                                                                                                                                                                                                                                  |

## 2B) `nfldata` dataset-field gaps

### Dataset files discovered in `leesharpe/nfldata/data`

- `airports.csv`
- `closing_lines.csv`
- `draft_picks.csv`
- `draft_values.csv`
- `games.csv`
- `initial_lines.csv`
- `logos.csv`
- `officials.csv`
- `pff_pfr_map_v1.csv`
- `positions.csv`
- `predictions.csv`
- `rosters.csv`
- `sc_lines.csv`
- `standings.csv`
- `teamcolors.csv`
- `teams.csv`
- `trades.csv`
- `win_totals.csv`

### Missing fields by dataset (exact-name comparison to current DB columns)

Caveat:

- This section is **exact-name** matching against current schema column names.
- Some concepts may exist under different names or be computed, but anything listed below is not directly represented by a same-named persisted column.

#### `airports.csv`

- Total columns: `5`
- Missing (exact-name): `3`

- `team`
- `airport`
- `time_zone`

#### `closing_lines.csv`

- Total columns: `7`
- Missing (exact-name): `6`

- `alt_game_id`
- `type`
- `side`
- `line`
- `odds`
- `outcome`

#### `draft_picks.csv`

- Total columns: `10`
- Missing (exact-name): `5`

- `team`
- `round`
- `pick`
- `pfr_name`
- `side`

#### `draft_values.csv`

- Total columns: `6`
- Missing (exact-name): `6`

- `pick`
- `stuart`
- `johnson`
- `hill`
- `otc`
- `pff`

#### `games.csv`

- Total columns: `46`
- Missing (exact-name): `26`

- `game_type`
- `gameday`
- `weekday`
- `gametime`
- `overtime`
- `gsis`
- `nfl_detail_id`
- `pfr`
- `pff`
- `espn`
- `ftn`
- `away_rest`
- `home_rest`
- `spread_line`
- `away_spread_odds`
- `home_spread_odds`
- `total_line`
- `under_odds`
- `over_odds`
- `div_game`
- `temp`
- `wind`
- `away_qb_id`
- `home_qb_id`
- `referee`
- `stadium_id`

#### `initial_lines.csv`

- Total columns: `6`
- Missing (exact-name): `5`

- `sportsbook`
- `type`
- `about`
- `side`
- `line`

#### `logos.csv`

- Total columns: `2`
- Missing (exact-name): `2`

- `team`
- `team_logo`

#### `officials.csv`

- Total columns: `4`
- Missing (exact-name): `2`

- `off_pos`
- `official_id`

#### `pff_pfr_map_v1.csv`

- Total columns: `4`
- Missing (exact-name): `2`

- `pff_name`
- `pff_url_name`

#### `positions.csv`

- Total columns: `4`
- Missing (exact-name): `1`

- `side`

#### `predictions.csv`

- Total columns: `3`
- Missing (exact-name): `2`

- `screen_name`
- `prediction`

#### `rosters.csv`

- Total columns: `12`
- Missing (exact-name): `7`

- `team`
- `playerid`
- `full_name`
- `side`
- `games`
- `starts`
- `av`

#### `sc_lines.csv`

- Total columns: `7`
- Missing (exact-name): `2`

- `side`
- `line`

#### `standings.csv`

- Total columns: `16`
- Missing (exact-name): `14`

- `conf`
- `team`
- `wins`
- `losses`
- `ties`
- `pct`
- `div_rank`
- `scored`
- `allowed`
- `net`
- `sov`
- `sos`
- `seed`
- `playoff`

#### `teamcolors.csv`

- Total columns: `5`
- Missing (exact-name): `5`

- `team`
- `color`
- `color2`
- `color3`
- `color4`

#### `teams.csv`

- Total columns: `18`
- Missing (exact-name): `15`

- `team`
- `nfl`
- `nfl_team_id`
- `espn`
- `pfr`
- `pff`
- `pfflabel`
- `fo`
- `full`
- `short_location`
- `hyphenated`
- `sbr`
- `sbr_wins`
- `sbr_name`
- `draft_kings`

#### `trades.csv`

- Total columns: `11`
- Missing (exact-name): `9`

- `trade_id`
- `trade_date`
- `gave`
- `received`
- `pick_season`
- `pick_round`
- `pick_number`
- `conditional`
- `pfr_name`

#### `win_totals.csv`

- Total columns: `5`
- Missing (exact-name): `4`

- `team`
- `line`
- `over_odds`
- `under_odds`

### Exhaustive dataset.field list currently not represented (exact-name)

- `airports.csv.team`
- `airports.csv.airport`
- `airports.csv.time_zone`
- `closing_lines.csv.alt_game_id`
- `closing_lines.csv.type`
- `closing_lines.csv.side`
- `closing_lines.csv.line`
- `closing_lines.csv.odds`
- `closing_lines.csv.outcome`
- `draft_picks.csv.team`
- `draft_picks.csv.round`
- `draft_picks.csv.pick`
- `draft_picks.csv.pfr_name`
- `draft_picks.csv.side`
- `draft_values.csv.pick`
- `draft_values.csv.stuart`
- `draft_values.csv.johnson`
- `draft_values.csv.hill`
- `draft_values.csv.otc`
- `draft_values.csv.pff`
- `games.csv.game_type`
- `games.csv.gameday`
- `games.csv.weekday`
- `games.csv.gametime`
- `games.csv.overtime`
- `games.csv.gsis`
- `games.csv.nfl_detail_id`
- `games.csv.pfr`
- `games.csv.pff`
- `games.csv.espn`
- `games.csv.ftn`
- `games.csv.away_rest`
- `games.csv.home_rest`
- `games.csv.spread_line`
- `games.csv.away_spread_odds`
- `games.csv.home_spread_odds`
- `games.csv.total_line`
- `games.csv.under_odds`
- `games.csv.over_odds`
- `games.csv.div_game`
- `games.csv.temp`
- `games.csv.wind`
- `games.csv.away_qb_id`
- `games.csv.home_qb_id`
- `games.csv.referee`
- `games.csv.stadium_id`
- `initial_lines.csv.sportsbook`
- `initial_lines.csv.type`
- `initial_lines.csv.about`
- `initial_lines.csv.side`
- `initial_lines.csv.line`
- `logos.csv.team`
- `logos.csv.team_logo`
- `officials.csv.off_pos`
- `officials.csv.official_id`
- `pff_pfr_map_v1.csv.pff_name`
- `pff_pfr_map_v1.csv.pff_url_name`
- `positions.csv.side`
- `predictions.csv.screen_name`
- `predictions.csv.prediction`
- `rosters.csv.team`
- `rosters.csv.playerid`
- `rosters.csv.full_name`
- `rosters.csv.side`
- `rosters.csv.games`
- `rosters.csv.starts`
- `rosters.csv.av`
- `sc_lines.csv.side`
- `sc_lines.csv.line`
- `standings.csv.conf`
- `standings.csv.team`
- `standings.csv.wins`
- `standings.csv.losses`
- `standings.csv.ties`
- `standings.csv.pct`
- `standings.csv.div_rank`
- `standings.csv.scored`
- `standings.csv.allowed`
- `standings.csv.net`
- `standings.csv.sov`
- `standings.csv.sos`
- `standings.csv.seed`
- `standings.csv.playoff`
- `teamcolors.csv.team`
- `teamcolors.csv.color`
- `teamcolors.csv.color2`
- `teamcolors.csv.color3`
- `teamcolors.csv.color4`
- `teams.csv.team`
- `teams.csv.nfl`
- `teams.csv.nfl_team_id`
- `teams.csv.espn`
- `teams.csv.pfr`
- `teams.csv.pff`
- `teams.csv.pfflabel`
- `teams.csv.fo`
- `teams.csv.full`
- `teams.csv.short_location`
- `teams.csv.hyphenated`
- `teams.csv.sbr`
- `teams.csv.sbr_wins`
- `teams.csv.sbr_name`
- `teams.csv.draft_kings`
- `trades.csv.trade_id`
- `trades.csv.trade_date`
- `trades.csv.gave`
- `trades.csv.received`
- `trades.csv.pick_season`
- `trades.csv.pick_round`
- `trades.csv.pick_number`
- `trades.csv.conditional`
- `trades.csv.pfr_name`
- `win_totals.csv.team`
- `win_totals.csv.line`
- `win_totals.csv.over_odds`
- `win_totals.csv.under_odds`

## 2C) ESPN endpoint data gaps (`Public-ESPN-API` + live payload inspection)

### NFL endpoints in the referenced doc that are not fully exploited today

Current implementation uses mostly scoreboard + summary + core plays:

- `apps/api-django/gridstream/management/commands/sync_espn_games.py`
- `apps/service-go/gridstream/internal/config/config.go`

Additional endpoint families available:

- Team detail / roster / schedule
- Standings (core path)
- Leaders v3 endpoint
- Core: athletes, seasons, teams, draft, events, venues, franchises, positions
- Athlete profile/gamelog/splits/stats
- Core probabilities / betting records / futures
- CDN scoreboard/boxscore/playbyplay/standings/schedule

### ESPN summary top-level keys currently unused by sync

(From sample game summary payload; keys present but not consumed in `sync_espn_games.py`)

- `againstTheSpread`
- `boxscore`
- `format`
- `gameInfo`
- `header`
- `injuries`
- `meta`
- `news`
- `pickcenter`
- `standings`
- `videos`
- `wallclockAvailable`
- `winprobability`

### ESPN summary fields not persisted (sample-derived inventories)

#### `winprobability[]` missing fields

- `homeWinPercentage`
- `playId`
- `tiePercentage`

#### `pickcenter[]` missing fields

- `awayTeamOdds`
- `details`
- `footer`
- `header`
- `homeTeamOdds`
- `link`
- `links`
- `moneyline`
- `overOdds`
- `overUnder`
- `pointSpread`
- `provider`
- `underOdds`

#### `injuries[].injuries[]` missing fields

- `athlete`
- `details`
- `type`

#### `boxscore.teams[].statistics[].name` fields not mapped directly

- `completionAttempts`
- `defensiveTouchdowns`
- `firstDowns`
- `firstDownsPassing`
- `firstDownsPenalty`
- `firstDownsRushing`
- `fourthDownEff`
- `fumblesLost`
- `interceptions`
- `netPassingYards`
- `possessionTime`
- `redZoneAttempts`
- `rushingAttempts`
- `rushingYards`
- `sacksYardsLost`
- `thirdDownEff`
- `totalDrives`
- `totalOffensivePlays`
- `totalPenaltiesYards`
- `totalYards`
- `yardsPerPass`
- `yardsPerPlay`
- `yardsPerRushAttempt`

#### `boxscore.players[].statistics[].descriptions[]` sample fields (currently not directly ingested)

- `defensive.Passes`
- `defensive.Quarterback`
- `defensive.Sacks`
- `defensive.Solo`
- `defensive.Tackles`
- `defensive.Tackles`
- `defensive.Touchdowns`
- `fumbles.Fumbles`
- `fumbles.Fumbles`
- `fumbles.Fumbles`
- `interceptions.Interceptions`
- `interceptions.Touchdowns`
- `interceptions.Yards`
- `kickReturns.Kick`
- `kickReturns.Longest`
- `kickReturns.Touchdowns`
- `kickReturns.Yards`
- `kickReturns.Yards`
- `kicking.Extra`
- `kicking.Field`
- `kicking.Field`
- `kicking.Kicking`
- `kicking.Longest`
- `passing.Adjusted`
- `passing.Completions/Attempts`
- `passing.Interceptions`
- `passing.Passer`
- `passing.Sacks`
- `passing.Touchdowns`
- `passing.Yards`
- `passing.Yards`
- `puntReturns.Longest`
- `puntReturns.Punt`
- `puntReturns.Touchdowns`
- `puntReturns.Yards`
- `puntReturns.Yards`
- `punting.Average`
- `punting.Longest`
- `punting.Punts`
- `punting.Punts`
- `punting.Touchbacks`
- `punting.Yards`
- `receiving.Longest`
- `receiving.Receiving`
- `receiving.Receptions`
- `receiving.Touchdowns`
- `receiving.Yards`
- `receiving.Yards`
- `rushing.Longest`
- `rushing.Rushing`
- `rushing.Touchdowns`
- `rushing.Yards`
- `rushing.Yards`

### ESPN core probabilities fields not currently persisted

- `$ref`
- `awayTeam`
- `awayWinPercentage`
- `competition`
- `homeTeam`
- `homeWinPercentage`
- `lastModified`
- `play`
- `secondsLeft`
- `sequenceNumber`
- `source`
- `spreadCoverProbHome`
- `spreadPushProb`
- `tiePercentage`
- `totalOverProb`
- `totalPushProb`

### ESPN core standings stat fields not currently persisted as a standings table

- `OTLosses`
- `OTWins`
- `avgPointsAgainst`
- `avgPointsFor`
- `clincher`
- `differential`
- `divisionLosses`
- `divisionRecord`
- `divisionTies`
- `divisionWinPercent`
- `divisionWins`
- `gamesBehind`
- `gamesPlayed`
- `leagueWinPercent`
- `losses`
- `playoffSeed`
- `pointDifferential`
- `points`
- `pointsAgainst`
- `pointsFor`
- `streak`
- `ties`
- `winPercent`
- `wins`

---

## 3) Recommended import/refactor updates

## 3.0 Architecture decision: v2 full rebuild

Rather than continuing to patch and enrich the v1 database in place, build a clean v2 database from scratch.
Motivations:

- The v1 0%-populated columns (odds, team stat subdomains, kicking stats) show the enrichment approach was
  never going to converge — schema existed but pipelines never wrote to it.
- The v1 raw `plays` table at 52 fields will always create a ceiling on what downstream code can do.
- A bootstrap command that runs once and produces a fully populated database is more maintainable and
  auditable than a pile of independent enrichment scripts.
- Rebuilding later is inevitable as the data model grows; doing it now avoids paying migration debt twice.

**Transition plan:**

- Create `postgres-nfl-v2` alongside the current `postgres-nfl`.
- All new import commands target v2 only.
- v1 remains live and untouched as fallback during development.
- Cut over when v2 passes QA parity checks (see Phase 8 in section 0).

## 3.1 Loader architecture changes (high priority)

1. Replace the single reduced `plays` archive with layered raw datasets.

- Keep a `raw_` schema with source-faithful tables (full field sets, no lossy transforms).
- Suggested minimum raw tables:
  - `raw_nflverse_pbp` (full PBP, all fields)
  - `raw_nflverse_player_stats`
  - `raw_nflverse_team_stats` (or `stats_team` equivalent)
  - `raw_nflverse_injuries`
  - `raw_nflverse_depth_charts`
  - `raw_nflverse_snap_counts`
  - `raw_nflverse_pbp_participation`
  - `raw_nflverse_draft_picks`
  - `raw_nflverse_trades`
  - `raw_nflverse_standings`
  - `raw_espn_summary` (JSON snapshots by event_id)
  - `raw_espn_probabilities`

2. Replace ad-hoc "multi command bootstrap" with one deterministic bootstrap command.

- Introduce e.g. `python manage.py bootstrap_nfl_v2 --season-start 1999 --season-end <N>`.
- Include idempotent stages: migrate -> raw ingest -> core transforms -> materialized views -> data QA.
- Store source metadata (source URL, tag, checksum, loaded_at) per raw batch.

3. Upgrade Rust ingest from reduced CSV projection to full schema ingest.

- Current reduction source:
  - `apps/service-rust/nflreadrust/src/models.rs`
  - `apps/service-rust/nflreadrust/src/lib.rs`
- Refactor options:
  - A) Keep Rust and ingest full CSV/Parquet with generated struct/table mapping.
  - B) Move raw ingest to `COPY`/DuckDB/Polars stage, then Rust/Django for transforms.

## 3.2 Script-level refactors

### `import_games.py`

- Current behavior derives games from raw PBP group-by and uses placeholders for missing IDs/metadata.
- Upgrade to authoritative schedule/games source (nflverse games dataset + ESPN IDs join).
- Populate fields now missing/partial: `is_division_game`, coaches, referees, proper game_type metadata,
  `away_rest`/`home_rest`, closing odds from pickcenter.

### `import_drives.py`

- Current behavior infers drive result heuristically from last-play flags.
- Upgrade to explicit drive result/first-down fields from full PBP (`fixed_drive_result`, etc.) when available.
- Populate `drive_start_transition`/`drive_end_transition` from full PBP.

### `import_plays.py`

- Current behavior imports only reduced 52-column projection.
- Upgrade to full field mapping for all available PBP flags/probabilities/player IDs.
- Remove null-heavy placeholders for known fields (`desc`, `first_down_*`, `fumble_lost`, `pass_location`, `run_location`, `run_gap`, etc.).
- Add all returner/tackler/blocker player name+ID fields.
- Add all timeout, win probability, score differential, expected points fields.

### `import_player_game_stats.py`

- Current behavior derives from PBP because no player_stats raw table.
- Replace with direct ingest from `player_stats` dataset.
- Keep optional reconciliation against PBP-derived totals for QA only.

### `import_team_game_stats.py`

- Current behavior derives with known approximations.
- Replace with direct team stats dataset ingest.

### `sync_rosters.py`

- Expand ingestion beyond team/status/jersey to include roster richness where available (position depth, injury flags, transaction context).

### `sync_espn_games.py`

- Extend summary ingestion beyond drives/scoring/leaders:
  - injuries
  - boxscore team+player stat payloads
  - win probability timeline (keyed to play sequence for join to `gridstream_play`)
  - pickcenter/odds distributions
  - officials + attendance from `gameInfo`

## 3.3 New import commands to add

- `import_nflverse_draft_picks`
- `import_nflverse_draft_values`
- `import_nflverse_trades`
- `import_nflverse_standings`
- `import_espn_injuries`
- `import_espn_probabilities`
- `import_espn_boxscore`
- `import_espn_officials`

---

## 4) Downstream functions that can be replaced/upgraded

## 4.1 Backend (Django)

1. Replace boxscore fallback derivation in `GameViewSet.boxscore`.

- File: `apps/api-django/gridstream/views.py`
- Functions/blocks:
  - `_derive_team_stats_from_plays` (play-derived fallback)
  - `_derive_leaders_from_player_stats` (leader fallback)
  - `team_stats_source`/`leaders_source` branching
- Upgrade path:
  - Use canonical ingested team/player/leader rows.
  - Keep fallback path only as temporary resilience mode.
  - Prerequisite: `teamstats_points_scored_pct` and `playerstats_fg_made_pct` must be 100% in v2 before removing.

2. Replace computed standings view with persisted standings table.

- File: `apps/api-django/gridstream/views.py` (`StandingsViewSet`)
- Current: computes from game results each request/cache cycle.
- Upgrade: serve from imported standings dataset + tie-break metadata.

## 4.2 SDK / frontend transforms

### Complete heuristic-to-canonical replacement map

| Heuristic / derived function                                       | Location               | Replacement field(s)                                                                                                                                                                          |
| ------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasTurnoverLanguage()` — description text regex                   | `play-transforms.ts`   | `play.interception`, `play.fumble_lost`                                                                                                                                                       |
| `resolveAnimType()` — play category inference                      | `play-transforms.ts`   | `pass_attempt`, `rush_attempt`, `kickoff_attempt`, `punt_attempt`, `extra_point_attempt`, `two_point_attempt`, `special_teams_play`, `st_play_type`                                           |
| `parseKickDetails()` — 80-line kick regex gauntlet                 | `play-transforms.ts`   | `punt_returner_player_name/id`, `kickoff_returner_player_name/id`, `return_yards`, `return_team`, `touchback`, `out_of_bounds`, `punt_inside_twenty`, `punt_fair_catch`, `kickoff_in_endzone` |
| `parseTurnoverDetails()` — description regex + spot projection     | `play-transforms.ts`   | `interception_player_name/id`, `fumble_recovery_1_player_name/team/yards`, `return_yards`, `return_team`                                                                                      |
| `parsePenaltyDetails()` — description regex                        | `play-transforms.ts`   | `penalty_player_name`, `penalty_player_id`, `penalty_team`                                                                                                                                    |
| `parseTimeoutUsage()` — text regex for team + ordinal              | `play-transforms.ts`   | `timeout`, `timeout_team`                                                                                                                                                                     |
| Timeout decrement counter (tracks remaining TOs by counting usage) | `page.tsx` replay loop | `home_timeouts_remaining`, `away_timeouts_remaining` per play                                                                                                                                 |
| `parseFieldGoalDistance()` fallback regex                          | `play-transforms.ts`   | `kick_distance` (ensure 100% populated in v2)                                                                                                                                                 |
| `estimateAwayWinPct()` — score/quarter/clock heuristic             | `page.tsx`             | `home_wp`/`away_wp` per play (ESPN `winprobability` or nflfastR)                                                                                                                              |
| `isLikelyIndoor()` — venue name keyword list                       | `constants.ts`         | `venue.is_indoor` from DB                                                                                                                                                                     |
| Rolling EPA accumulation in replay timeline                        | `page.tsx`             | `total_home_epa`, `total_away_epa`, `total_home_rush_epa`, `total_home_pass_epa` per play                                                                                                     |
| Score differential manual accumulation                             | `page.tsx`             | `score_differential` per play                                                                                                                                                                 |
| Drive possession time calculation from clock arithmetic            | `page.tsx`             | `drive_time_of_possession` from nflfastR (or `time_elapsed` on `gridstream_drive`)                                                                                                            |
| `mapLeadersFromRunningTotals()` — stat accumulation fallback       | `transforms.ts`        | Canonical `GameLeader` rows for current-state; running totals only for historical replay scrubbing                                                                                            |
| `defenseFantasyPoints()` points-allowed band derivation            | `transforms.ts`        | Pre-computed from final `points_allowed` in `TeamGameStats`                                                                                                                                   |

## 4.3 Go live service

1. Extend transformer payload usage for richer live context.

- Files:
  - `apps/service-go/gridstream/internal/espn/transformer.go`
  - `apps/service-go/gridstream/internal/config/config.go`
- Upgrade with explicit feeds for:
  - probabilities timeline
  - injuries/availability
  - boxscore stats deltas

## 4.4 Games list page — new capabilities unlocked

Current state: game cards with teams, scores, status, records, QB names, weather, broadcast.

| Feature                               | Data required                                                       | Source                                              |
| ------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| Spread / total / moneyline on cards   | `spread_line`, `total_line`, `away_spread_odds`, `home_spread_odds` | nflverse `games.csv` or ESPN `pickcenter`           |
| Rest advantage badge ("Short week")   | `away_rest`, `home_rest` (days since last game)                     | nflverse `games.csv`                                |
| Division game indicator               | `div_game` / `is_division_game`                                     | nflverse `games.csv` (currently 0% populated in v1) |
| Injury flags on game cards            | Game-day player status (out/questionable)                           | ESPN `injuries` endpoint                            |
| Standings seed alongside team record  | Persisted standings table                                           | nflverse `standings.csv` or ESPN standings          |
| Vegas win total context (late season) | Pre-season O/U line per team                                        | nflverse `win_totals.csv`                           |
| Head referee                          | Official name + position                                            | ESPN `gameInfo` or nfldata `officials.csv`          |

## 4.5 Game view page — new capabilities unlocked

Current state: field visualization, play animation, score bug, drive tracker, mission log, team stats panel, fantasy panel, leaders panel, weather layer, win probability sparkline.

### Immediate upgrades (high leverage, low implementation cost)

| Feature                                        | Data required                                                                                                                                          | Replaces                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Accurate win probability sparkline             | `home_wp`/`away_wp` per play                                                                                                                           | `estimateAwayWinPct()` heuristic                |
| Timeout bubbles accurate at every replay frame | `home_timeouts_remaining`/`away_timeouts_remaining` per play                                                                                           | Text-parsing decrement counter                  |
| Defender/tackler name in MissionLog            | `sack_player_name`, `tackle_for_loss_1_player_name`, `interception_player_name`, `pass_defense_1_player_name`                                          | "sack" / "interception" (no player attribution) |
| Penalty player name in MissionLog              | `penalty_player_name`, `penalty_team`                                                                                                                  | Penalty type only                               |
| Drive start transition in drive tracker        | `drive_start_transition` (punt / kickoff / INT / fumble recovery / etc.)                                                                               | Drive number only                               |
| Kick animation without regex                   | `punt_returner_player_name/id`, `kickoff_returner_player_name/id`, `return_yards`, `return_team`, `touchback`, `kickoff_in_endzone`, `punt_fair_catch` | `parseKickDetails()` 80-line regex              |
| Turnover animation without regex               | `interception_player_name/id`, `fumble_recovery_1_player_name/team/yards`                                                                              | `parseTurnoverDetails()` regex + projection     |

### New panels / overlays

| Feature                                  | Data required                                                                                           | Source                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| EPA flow chart                           | `total_home_epa`, `total_away_epa` per play (segmented by `total_home_pass_epa`, `total_home_rush_epa`) | nflfastR full PBP                     |
| Pre-snap score probability context       | `td_prob`, `fg_prob`, `no_score_prob` per play                                                          | nflfastR                              |
| Completion % over expectation annotation | `cp`, `cpoe` per pass play                                                                              | nflfastR                              |
| Injury/availability panel                | Game-day player status for both rosters                                                                 | ESPN `injuries` endpoint              |
| Attendance + officials display           | Attendance count, official names/positions                                                              | ESPN `gameInfo`                       |
| Next Gen Stats player card               | `metrics` from `gridstream_playernextgenstats` (26K rows already stored)                                | Already in DB — just needs UI surface |

---

## 5) Practical execution order

The TODO list in section 0 is the authoritative task list. The high-level phase ordering is:

1. Create v2 database and `raw_` schema; build bootstrap command.
2. Upgrade PBP ingest to full 372-field coverage (`raw_nflverse_pbp`).
3. Add canonical `player_stats` / team stats ingests (replaces PBP-derived fallbacks).
4. Add ESPN injuries / probabilities / boxscore / officials ingest.
5. Add nfldata: standings, draft picks, trades, win totals.
6. Run Django migrations against v2; update serializers to expose new fields.
7. Switch downstream fallback functions to canonical data (validate 100% population first).
8. Replace SDK heuristics with canonical fields.
9. Add new UI features (odds, EPA chart, injury panel, etc.).
10. QA parity check v1 vs v2; cut over.

---

## 6) PFF note (for future integration)

- Current DB already stores `pff_id` on players (`gridstream_player.pff_id`).
- That gives a join key foundation, but full PFF metrics remain a licensed/proprietary source.
- Recommended approach:
  - Preserve `pff_id` normalization now.
  - Add `raw_pff_*` tables only after approved data access/licensing.

---

## 7) Raw extraction artifacts used to build this document

Generated during analysis (local `/tmp`):

- `/tmp/local_nfl_table_counts.tsv`
- `/tmp/local_nfl_table_inventory.tsv`
- `/tmp/current_completeness_metrics.tsv`
- `/tmp/current_coverage_ranges.tsv`
- `/tmp/nflfastR_missing_fields_with_desc.tsv`
- `/tmp/nfldata_missing_exact_match.tsv`
- `/tmp/nfldata_missing_dataset_fields.txt`
- `/tmp/espn_summary_top_keys_unused_by_sync.txt`
- `/tmp/espn_summary_winprob_missing_exact.txt`
- `/tmp/espn_pickcenter_missing_exact.txt`
- `/tmp/espn_injury_item_missing_exact.txt`
- `/tmp/espn_boxscore_team_stat_missing_exact.txt`
- `/tmp/espn_boxscore_player_stat_fields.txt`
- `/tmp/espn_core_prob_missing_fields_exact.txt`
- `/tmp/espn_core_standings_stat_names.txt`
