#!/bin/bash
set -e

# Install Playwright chromium on first run (cached in named volume).
# This runs at container start instead of build time to avoid OOM during docker build.
PLAYWRIGHT_CACHE="/root/.cache/ms-playwright"
if [ ! -d "$PLAYWRIGHT_CACHE" ] || [ -z "$(ls -A "$PLAYWRIGHT_CACHE" 2>/dev/null)" ]; then
    echo "[entrypoint] Installing Playwright chromium (one-time setup, ~150MB)..."
    cd /app/gridstream/scripts && npx playwright install chromium --with-deps
    echo "[entrypoint] Playwright ready."
fi

exec "$@"
