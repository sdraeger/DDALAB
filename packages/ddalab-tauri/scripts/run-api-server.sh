#!/bin/bash

# DDALAB Embedded API Server - Development Mode
# This script runs the API server independently with hot-reload support

cd "$(dirname "$0")/../src-tauri"

# Set environment variables if not already set
export DDALAB_DATA_DIR="${DDALAB_DATA_DIR:-$HOME/Desktop/DDALAB/data}"
export DDALAB_API_PORT="${DDALAB_API_PORT:-8765}"
export RUST_LOG="${RUST_LOG:-info}"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  DDALAB Embedded API Server - Development Mode            ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  Data Directory: $DDALAB_DATA_DIR"
echo "║  Port:           $DDALAB_API_PORT"
echo "║  Log Level:      $RUST_LOG"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check if cargo-watch is installed
if ! command -v cargo-watch &> /dev/null; then
    echo "⚠️  cargo-watch not found, installing..."
    cargo install cargo-watch
fi

# Run the server with hot-reload
echo "🔥 Starting server with hot-reload..."
echo ""

cargo watch \
  --why \
  --clear \
  --watch src/ \
  --ignore '*.rs.bk' \
  --ignore '*~' \
  --exec 'run --bin embedded_api_server'
