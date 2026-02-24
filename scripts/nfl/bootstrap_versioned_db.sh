#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Bootstrap a versioned NFL database (v3, v4, ...) using existing v2 pipeline.

This script orchestrates:
1) Compose services up (postgres + pgbouncer + api-django)
2) Django migrate for target alias
3) Host-side raw ingest via service-rust
4) Core transforms + QA via bootstrap_nfl_v2

Usage:
  scripts/nfl/bootstrap_versioned_db.sh --version 3 [options]

Required:
  --version N             Version number (e.g. 3 -> alias nfl_v3)

Options:
  --database-alias ALIAS  Django DB alias (default: nfl_vN)
  --overlay-file PATH     Compose overlay file (default: docker-compose.nfl-vN.yml)
  --postgres-service SVC  Postgres compose service (default: postgres-nfl-vN)
  --pgbouncer-service SVC Pgbouncer compose service (default: pgbouncer-nfl-vN)
  --db-name NAME          Postgres DB name (default: nfl_data_vN)
  --db-user USER          DB user (default: admin)
  --db-password PASS      DB password (default: password)
  --db-port PORT          DB port inside network (default: 5432)
  --api-service NAME      API service name (default: api-django)
  --compose-file PATH     Base compose file (default: docker-compose.yml)
  --skip-service-up       Skip docker compose up step
  --skip-host-raw-ingest  Skip host-side raw ingest (bootstrap handles raw stage)
  --start-year YYYY       Optional NFL_PBP_START_YEAR for raw ingest
  --end-year YYYY         Optional NFL_PBP_END_YEAR for raw ingest
  --include-espn-sync     Pass --include-espn-sync to bootstrap command
  --strict-qa             Pass --strict-qa to bootstrap command
  --qa-json-out PATH      Pass --qa-json-out to bootstrap command
  --raw-ingest-cmd CMD    Explicit raw ingest command for bootstrap command
  --help                  Show this help

Example:
  scripts/nfl/bootstrap_versioned_db.sh --version 3 --strict-qa
EOF
}

VERSION=""
DATABASE_ALIAS=""
OVERLAY_FILE=""
POSTGRES_SERVICE=""
PGBOUNCER_SERVICE=""
DB_NAME=""
DB_USER="admin"
DB_PASSWORD="password"
DB_PORT="5432"
API_SERVICE="api-django"
BASE_COMPOSE_FILE="docker-compose.yml"
SKIP_SERVICE_UP="false"
SKIP_HOST_RAW_INGEST="false"
START_YEAR=""
END_YEAR=""
INCLUDE_ESPN_SYNC="false"
STRICT_QA="false"
QA_JSON_OUT=""
RAW_INGEST_CMD=""

while (($# > 0)); do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --database-alias)
      DATABASE_ALIAS="${2:-}"
      shift 2
      ;;
    --overlay-file)
      OVERLAY_FILE="${2:-}"
      shift 2
      ;;
    --postgres-service)
      POSTGRES_SERVICE="${2:-}"
      shift 2
      ;;
    --pgbouncer-service)
      PGBOUNCER_SERVICE="${2:-}"
      shift 2
      ;;
    --db-name)
      DB_NAME="${2:-}"
      shift 2
      ;;
    --db-user)
      DB_USER="${2:-}"
      shift 2
      ;;
    --db-password)
      DB_PASSWORD="${2:-}"
      shift 2
      ;;
    --db-port)
      DB_PORT="${2:-}"
      shift 2
      ;;
    --api-service)
      API_SERVICE="${2:-}"
      shift 2
      ;;
    --compose-file)
      BASE_COMPOSE_FILE="${2:-}"
      shift 2
      ;;
    --skip-service-up)
      SKIP_SERVICE_UP="true"
      shift
      ;;
    --skip-host-raw-ingest)
      SKIP_HOST_RAW_INGEST="true"
      shift
      ;;
    --start-year)
      START_YEAR="${2:-}"
      shift 2
      ;;
    --end-year)
      END_YEAR="${2:-}"
      shift 2
      ;;
    --include-espn-sync)
      INCLUDE_ESPN_SYNC="true"
      shift
      ;;
    --strict-qa)
      STRICT_QA="true"
      shift
      ;;
    --qa-json-out)
      QA_JSON_OUT="${2:-}"
      shift 2
      ;;
    --raw-ingest-cmd)
      RAW_INGEST_CMD="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$VERSION" || ! "$VERSION" =~ ^[0-9]+$ || "$VERSION" -lt 2 ]]; then
  echo "Error: --version must be an integer >= 2." >&2
  exit 1
fi

if [[ -z "$DATABASE_ALIAS" ]]; then
  DATABASE_ALIAS="nfl_v${VERSION}"
fi
if [[ -z "$OVERLAY_FILE" ]]; then
  OVERLAY_FILE="docker-compose.nfl-v${VERSION}.yml"
fi
if [[ -z "$POSTGRES_SERVICE" ]]; then
  POSTGRES_SERVICE="postgres-nfl-v${VERSION}"
fi
if [[ -z "$PGBOUNCER_SERVICE" ]]; then
  PGBOUNCER_SERVICE="pgbouncer-nfl-v${VERSION}"
fi
if [[ -z "$DB_NAME" ]]; then
  DB_NAME="nfl_data_v${VERSION}"
fi
if [[ -z "$QA_JSON_OUT" ]]; then
  QA_JSON_OUT="/app/reports/${DATABASE_ALIAS}_health.json"
fi

if [[ ! -f "$BASE_COMPOSE_FILE" ]]; then
  echo "Missing compose file: $BASE_COMPOSE_FILE" >&2
  exit 1
fi
if [[ ! -f "$OVERLAY_FILE" ]]; then
  echo "Missing overlay file: $OVERLAY_FILE" >&2
  echo "Create it first: scripts/nfl/create_version_overlay.sh --version ${VERSION}" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

compose_cmd=(docker compose -f "$BASE_COMPOSE_FILE" -f "$OVERLAY_FILE")
services="$("${compose_cmd[@]}" config --services)"
for service in "$POSTGRES_SERVICE" "$PGBOUNCER_SERVICE" "$API_SERVICE" "service-rust"; do
  if ! grep -qx "$service" <<<"$services"; then
    echo "Compose service not found: $service" >&2
    echo "Check $BASE_COMPOSE_FILE and $OVERLAY_FILE." >&2
    exit 1
  fi
done

db_url="postgresql://${DB_USER}:${DB_PASSWORD}@${PGBOUNCER_SERVICE}:${DB_PORT}/${DB_NAME}"
db_env_key="NFL_DATABASE_V${VERSION}_URL"
exec_env=(-e "NFL_DATABASE_URL=${db_url}" -e "${db_env_key}=${db_url}")

if [[ "$SKIP_SERVICE_UP" != "true" ]]; then
  echo "Starting services: $POSTGRES_SERVICE $PGBOUNCER_SERVICE $API_SERVICE"
  "${compose_cmd[@]}" up -d "$POSTGRES_SERVICE" "$PGBOUNCER_SERVICE" "$API_SERVICE"
fi

echo "Running migrations for ${DATABASE_ALIAS}"
"${compose_cmd[@]}" exec -T "${exec_env[@]}" "$API_SERVICE" \
  python manage.py migrate --database "$DATABASE_ALIAS"

if [[ "$SKIP_HOST_RAW_INGEST" != "true" ]]; then
  echo "Running host-side raw ingest via service-rust into ${db_url}"
  raw_env=(-e "DATABASE_URL=${db_url}")
  if [[ -n "$START_YEAR" ]]; then
    raw_env+=(-e "NFL_PBP_START_YEAR=${START_YEAR}")
  fi
  if [[ -n "$END_YEAR" ]]; then
    raw_env+=(-e "NFL_PBP_END_YEAR=${END_YEAR}")
  fi
  "${compose_cmd[@]}" run --rm "${raw_env[@]}" service-rust
fi

bootstrap_args=(
  python manage.py bootstrap_nfl_v2
  --database "$DATABASE_ALIAS"
  --skip-migrate
  --qa-json-out "$QA_JSON_OUT"
)

run_bootstrap_raw_stage="false"
if [[ "$SKIP_HOST_RAW_INGEST" == "true" || -n "$RAW_INGEST_CMD" ]]; then
  run_bootstrap_raw_stage="true"
fi
if [[ "$run_bootstrap_raw_stage" != "true" ]]; then
  bootstrap_args+=(--skip-raw-ingest)
fi

if [[ "$INCLUDE_ESPN_SYNC" == "true" ]]; then
  bootstrap_args+=(--include-espn-sync)
fi
if [[ "$STRICT_QA" == "true" ]]; then
  bootstrap_args+=(--strict-qa)
fi
if [[ -n "$RAW_INGEST_CMD" ]]; then
  bootstrap_args+=(--raw-ingest-cmd "$RAW_INGEST_CMD")
fi

echo "Running bootstrap command for ${DATABASE_ALIAS}"
"${compose_cmd[@]}" exec -T "${exec_env[@]}" "$API_SERVICE" "${bootstrap_args[@]}"

echo
echo "Bootstrap complete for ${DATABASE_ALIAS}"
echo "Database URL: ${db_url}"
