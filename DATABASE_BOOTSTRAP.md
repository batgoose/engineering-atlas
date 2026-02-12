# Database Bootstrap & Recovery

How to rebuild both databases from scratch. Covers the Atlas core database (`postgres-atlas`) and the NFL data database (`postgres-nfl`).

## Prerequisites

All services running via Docker Compose:

```bash
docker compose up -d postgres-atlas postgres-nfl pgbouncer-atlas pgbouncer-nfl redis minio
```

Wait for health checks to pass before proceeding.

---

## Phase 0: Schema Creation

Run Django migrations against both databases. The Atlas database holds core app models (auth, sessions, competencies, artifacts). The NFL database holds all Redzone models.

```bash
# Atlas (default) database
docker compose exec api-django python manage.py migrate

# NFL database
docker compose exec api-django python manage.py migrate --database=nfl
```

---

## Phase 1: Atlas Core Data

The core app uses `seed_data` to populate competencies and artifacts from JSON fixture files that live in the repo.

```bash
docker compose exec api-django python manage.py seed_data
```

**Data source:** `packages/db/seeds/competencies.json`, `packages/db/seeds/artifacts.json` (committed to repo)

---

## Phase 2: Rust Parser — Raw nflverse Play-by-Play

The Rust service downloads nflverse parquet files from GitHub and bulk-loads them into the raw `plays` table in `postgres-nfl`. This table is independent of Django's managed models — it's the source-of-truth archive that the Django import commands read from.

```bash
docker compose run --rm service-rust
```

This is a one-shot container (`restart: no` in compose). It will download ~1.2GB of parquet data, parse it, and INSERT into the `plays` table. Takes 5-10 minutes depending on network speed. The raw `plays` table ends up with ~1.28M rows spanning 1999-2025, with 372 columns.

**Data source:** nflverse GitHub releases (downloaded at runtime, not committed)

---

## Phase 3: NFL Reference Data (Seed Commands)

These commands populate the reference/master-data tables that everything else depends on. They pull from ESPN's public API — no auth needed but requires internet access. Run them in this exact order because later commands reference earlier tables via foreign keys.

```bash
# 3a. Teams — 32 active + historical franchises (STL, SD, OAK)
#     Source: ESPN teams API
docker compose exec api-django python manage.py seed_teams

# 3b. Venues — NFL stadiums
#     Source: ESPN venues API
docker compose exec api-django python manage.py seed_venues

# 3c. Players — base records from ESPN rosters endpoint
#     Source: ESPN team roster API (iterates all 32 teams)
docker compose exec api-django python manage.py seed_players

# 3d. Enrich players — cross-reference IDs, draft data, combine results
#     Downloads 3 CSVs from nflverse GitHub (~24K players)
#     Populates: gsis_id, pfr_id, pff_id, otc_id, draft info, college history
#     This is the slow one (~2-3 min)
docker compose exec api-django python manage.py enrich_players

# 3e. Social accounts + news sources for teams and players
#     Source: ESPN athlete overview endpoints
docker compose exec api-django python manage.py seed_social_accounts

# 3f. Roster sync — sets current_team, roster_status, depth chart
#     Source: ESPN active roster endpoints
docker compose exec api-django python manage.py sync_rosters
```

---

## Phase 4: Historical Game Data (Import Commands)

These read from the raw nflverse `plays` table (Phase 2) and populate the Django-managed models. Each command supports `--season YYYY` to import a single season and `--dry-run` to preview without writing.

Run in this order — games first, then drives, then plays, then stats:

```bash
# 4a. Games — schedule, scores, metadata (~7,300 games)
#     Source: raw `plays` table (groups by game_id)
docker compose exec api-django python manage.py import_games

# 4b. Drives — drive summaries (~168K drives)
#     Source: raw `plays` table (groups by game_id + drive)
#     Depends on: Games (FK)
docker compose exec api-django python manage.py import_drives

# 4c. Plays — full play-by-play (~1.28M plays)
#     Source: raw `plays` table
#     Depends on: Games, Drives (FKs)
docker compose exec api-django python manage.py import_plays

# 4d. Player game stats — box score rows (~140K rows)
#     Source: raw `plays` table (aggregates per player per game)
#     Depends on: Games, Players, Teams
docker compose exec api-django python manage.py import_player_game_stats

# 4e. Team game stats — team box score lines (~14.5K rows)
#     Source: raw `plays` table (aggregates per team per game)
#     Depends on: Games, Teams
docker compose exec api-django python manage.py import_team_game_stats
```

All import commands are idempotent — safe to re-run. They use `update_or_create` so re-running updates existing records rather than duplicating.

**Time estimate for full import:** ~15-20 minutes total.

---

## Phase 5: ESPN Live Data (Optional)

This syncs current/recent games from ESPN's live scoreboard API. Not needed for historical data, but required to have current-season game data with odds, weather, broadcast info, and leaders that the nflverse data doesn't include.

```bash
# Current week's games
docker compose exec api-django python manage.py sync_espn_games

# Specific week with full play-by-play, drives, scoring plays
docker compose exec api-django python manage.py sync_espn_games --season 2025 --week 22 --season-type 3 --full
```

**Data source:** ESPN scoreboard + summary APIs (live, requires internet)

---

## Phase 6: Go WebSocket Service

Gridstream doesn't store persistent data — it polls ESPN and broadcasts via WebSocket. Just start it:

```bash
docker compose up -d service-go
```

Verify it's running:

```bash
curl http://go-service.localhost/status
# {"service":"gridstream","status":"ok","clients":0,"redisConnected":true,"simulationActive":false}
```

---

## Quick Reference: Full Rebuild

Copy-paste this whole block to rebuild from zero:

```bash
# Start infrastructure
docker compose up -d postgres-atlas postgres-nfl pgbouncer-atlas pgbouncer-nfl redis minio
sleep 10  # wait for health checks

# Schema
docker compose exec api-django python manage.py migrate
docker compose exec api-django python manage.py migrate --database=nfl

# Atlas core
docker compose exec api-django python manage.py seed_data

# Raw nflverse data (slow — downloads parquet from GitHub)
docker compose run --rm service-rust

# NFL reference data
docker compose exec api-django python manage.py seed_teams
docker compose exec api-django python manage.py seed_venues
docker compose exec api-django python manage.py seed_players
docker compose exec api-django python manage.py enrich_players
docker compose exec api-django python manage.py seed_social_accounts
docker compose exec api-django python manage.py sync_rosters

# Historical imports from raw plays table
docker compose exec api-django python manage.py import_games
docker compose exec api-django python manage.py import_drives
docker compose exec api-django python manage.py import_plays
docker compose exec api-django python manage.py import_player_game_stats
docker compose exec api-django python manage.py import_team_game_stats

# ESPN live data (optional, current season)
docker compose exec api-django python manage.py sync_espn_games --full

# Start remaining services
docker compose up -d
```

---

## Dependency Graph

```
postgres-atlas ──► migrate ──► seed_data
                                  │
                                  ▼
                            [Atlas DB ready]


postgres-nfl ──► migrate --database=nfl
                      │
                      ├──► service-rust (raw plays table)
                      │         │
                      │         ▼
                      │    import_games ──► import_drives ──► import_plays
                      │         │                                  │
                      │         └──► import_player_game_stats ◄────┘
                      │         └──► import_team_game_stats   ◄────┘
                      │
                      └──► seed_teams ──► seed_venues
                                │
                                ├──► seed_players ──► enrich_players
                                │         │
                                │         └──► seed_social_accounts
                                │         └──► sync_rosters
                                │
                                └──► sync_espn_games (needs teams)

service-go ──► (no persistent data, just start it)
```

Note: The import commands (Phase 4) depend on both the Rust parser output AND the seed commands. Teams and Players must exist before imports can create foreign key references.

---

## Partial Recovery

If only one database is lost:

**Atlas only:** `migrate` + `seed_data` — takes seconds.

**NFL only:** Full Phase 2-5 above. The Rust parser is the bottleneck (~5-10 min download + parse). If you still have the raw `plays` table and only lost Django-managed tables, skip Phase 2 and re-run migrations + Phase 3-4.

**Single season refresh:**

```bash
docker compose exec api-django python manage.py import_games --season 2024
docker compose exec api-django python manage.py import_drives --season 2024
docker compose exec api-django python manage.py import_plays --season 2024
docker compose exec api-django python manage.py import_player_game_stats --season 2024
docker compose exec api-django python manage.py import_team_game_stats --season 2024
```
