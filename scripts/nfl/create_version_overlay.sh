#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Create a docker-compose override file for a new NFL DB version.

Usage:
  scripts/nfl/create_version_overlay.sh --version 3 [options]

Options:
  --version N         Required integer version (e.g. 3 for nfl_v3)
  --output PATH       Output file (default: docker-compose.nfl-vN.yml)
  --postgres-port P   Host port for postgres service (default: 5432 + N)
  --pgbouncer-port P  Host port for pgbouncer service (default: 6432 + N)
  --db-name NAME      Postgres database name (default: nfl_data_vN)
  --db-user USER      Postgres user (default: admin)
  --db-password PASS  Postgres password (default: password)
  --force             Overwrite output file if it exists
  --help              Show this help

Example:
  scripts/nfl/create_version_overlay.sh --version 3 --force
EOF
}

VERSION=""
OUTPUT=""
POSTGRES_PORT=""
PGBOUNCER_PORT=""
DB_NAME=""
DB_USER="admin"
DB_PASSWORD="password"
FORCE="false"

while (($# > 0)); do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT="${2:-}"
      shift 2
      ;;
    --postgres-port)
      POSTGRES_PORT="${2:-}"
      shift 2
      ;;
    --pgbouncer-port)
      PGBOUNCER_PORT="${2:-}"
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
    --force)
      FORCE="true"
      shift
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

if [[ -z "$OUTPUT" ]]; then
  OUTPUT="docker-compose.nfl-v${VERSION}.yml"
fi
if [[ -z "$POSTGRES_PORT" ]]; then
  POSTGRES_PORT="$((5432 + VERSION))"
fi
if [[ -z "$PGBOUNCER_PORT" ]]; then
  PGBOUNCER_PORT="$((6432 + VERSION))"
fi
if [[ -z "$DB_NAME" ]]; then
  DB_NAME="nfl_data_v${VERSION}"
fi

if [[ -f "$OUTPUT" && "$FORCE" != "true" ]]; then
  echo "Refusing to overwrite existing file: $OUTPUT" >&2
  echo "Re-run with --force to overwrite." >&2
  exit 1
fi

cat > "$OUTPUT" <<EOF
services:
  postgres-nfl-v${VERSION}:
    image: postgres:15-alpine
    container_name: atlas-nfl-v${VERSION}-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    ports:
      - '${POSTGRES_PORT}:5432'
    volumes:
      - postgres-nfl-v${VERSION}-data:/var/lib/postgresql/data
      - ./packages/db/init:/docker-entrypoint-initdb.d
    networks:
      - atlas-network
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${DB_USER} -d ${DB_NAME}']
      interval: 5s
      timeout: 5s
      retries: 5

  pgbouncer-nfl-v${VERSION}:
    image: edoburu/pgbouncer
    container_name: atlas-nfl-v${VERSION}-pgbouncer
    restart: unless-stopped
    environment:
      DB_USER: ${DB_USER}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_HOST: postgres-nfl-v${VERSION}
      DB_NAME: ${DB_NAME}
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 100
      DEFAULT_POOL_SIZE: 20
      AUTH_TYPE: scram-sha-256
    ports:
      - '${PGBOUNCER_PORT}:5432'
    networks:
      - atlas-network
    depends_on:
      postgres-nfl-v${VERSION}:
        condition: service_healthy

volumes:
  postgres-nfl-v${VERSION}-data:
    name: atlas-nfl-v${VERSION}-postgres-data
EOF

echo "Wrote ${OUTPUT}"
echo "Next: run scripts/nfl/bootstrap_versioned_db.sh --version ${VERSION}"
