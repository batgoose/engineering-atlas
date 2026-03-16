# NFL v3 Bootstrap Runbook

This runbook captures a repeatable process for spinning up a new versioned NFL
database (for example `nfl_v3`) without mutating current v1/v2 data.

## Why this shape

- Keep existing v1/v2 untouched.
- Reuse the proven `bootstrap_nfl_v2` staged pipeline for transforms + QA.
- Avoid hardcoding every new alias in settings by using env-based alias discovery.
- Keep orchestration scriptable from shell and Ansible.

## What was added

- Dynamic alias registration in Django settings:
  - `NFL_DATABASE_V3_URL` automatically maps to `DATABASES["nfl_v3"]`
  - same for `NFL_DATABASE_V4_URL`, etc.
- Script to create compose overlay for versioned DB infra:
  - `scripts/nfl/create_version_overlay.sh`
- Script to bootstrap a versioned DB end-to-end:
  - `scripts/nfl/bootstrap_versioned_db.sh`
- Optional Ansible wrapper:
  - `infrastructure/ansible/playbooks/bootstrap_nfl_version.yml`

## Shell path (recommended)

### 1) Create overlay for v3

```bash
scripts/nfl/create_version_overlay.sh --version 3
```

This writes `docker-compose.nfl-v3.yml` containing:

- `postgres-nfl-v3`
- `pgbouncer-nfl-v3`
- `postgres-nfl-v3-data` volume

### 2) Bootstrap v3

```bash
scripts/nfl/bootstrap_versioned_db.sh --version 3
```

What this does:

1. `docker compose up -d` for v3 postgres + pgbouncer + `api-django`
2. `migrate --database nfl_v3`
3. host-side `service-rust` raw ingest into `nfl_data_v3`
4. `bootstrap_nfl_v2 --database nfl_v3 --skip-migrate --skip-raw-ingest`

### 3) Optional year-limited ingest

```bash
scripts/nfl/bootstrap_versioned_db.sh --version 3 --start-year 2020 --end-year 2025
```

### 4) Optional strict QA + ESPN sync

```bash
scripts/nfl/bootstrap_versioned_db.sh --version 3 --include-espn-sync --strict-qa
```

## Ansible path (optional)

```bash
ansible-playbook \
  -i infrastructure/ansible/inventory/localhost.yml \
  infrastructure/ansible/playbooks/bootstrap_nfl_version.yml \
  -e nfl_version=3
```

Useful overrides:

```bash
ansible-playbook \
  -i infrastructure/ansible/inventory/localhost.yml \
  infrastructure/ansible/playbooks/bootstrap_nfl_version.yml \
  -e nfl_version=3 \
  -e nfl_start_year=2020 \
  -e nfl_end_year=2025 \
  -e nfl_include_espn_sync=true \
  -e nfl_strict_qa=true
```

## Verification checklist (v3)

Run against `postgres-nfl-v3`:

```sql
SELECT COUNT(*) FROM django_migrations WHERE app='gridstream';
SELECT COUNT(*) FROM raw.raw_nflverse_pbp;
SELECT COUNT(*) FROM gridstream_game;
SELECT COUNT(*) FROM gridstream_play;
SELECT COUNT(total_home_epa), COUNT(total_away_epa) FROM gridstream_play;
```

Expected:

- migrations applied
- raw pbp populated
- game/play modeled rows populated
- cumulative EPA fields populated for modeled plays

## Future v4/v5 process

Use the same flow and only change version:

```bash
scripts/nfl/create_version_overlay.sh --version 4
scripts/nfl/bootstrap_versioned_db.sh --version 4
```

No Django code changes should be needed as long as `NFL_DATABASE_V4_URL`
exists in the environment for the bootstrap process.
