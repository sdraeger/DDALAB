#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Clear volatile app-router chunk outputs to avoid stale/truncated chunk reuse
# across repeated Tauri restarts in desktop dev.
rm -rf .next/cache/webpack .next/server/app .next/static/chunks/app

BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA=true \
NODE_OPTIONS=--max-old-space-size=2048 \
PORT="${PORT:-3003}" \
exec next dev --webpack --hostname 127.0.0.1
