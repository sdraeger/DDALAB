#!/bin/sh
# Start the Python API server via Uvicorn

# Load environment configuration
if [ -f "../../.env.dev" ]; then
    echo "Loading development environment from .env.dev..."
    set -a  # Export all variables
    . ../../.env.dev
    set +a  # Stop exporting
elif [ -f "../../.env" ]; then
    echo "Loading production environment from .env..."
    set -a  # Export all variables
    . ../../.env
    set +a  # Stop exporting
elif [ -n "$DDALAB_CONFIG_FILE" ]; then
    echo "Using environment variables from Docker entrypoint..."
    # Environment variables are already set by docker-entrypoint.sh
else
    echo "❌ No environment file found!"
    echo "For development: create .env.dev"
    echo "For production: cp .env.example .env"
    exit 1
fi

# Check for and activate virtual environment
if [ -d ".venv" ]; then
    echo "Activating Python virtual environment..."
    . .venv/bin/activate
elif [ -d "../.venv" ]; then
    echo "Activating Python virtual environment from parent directory..."
    . ../.venv/bin/activate
else
    echo "WARNING: No Python virtual environment found!"
    echo "Create one with: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
fi

HOST=${API_HOST:-0.0.0.0}
PORT=${API_PORT:-8001}

# Check if DDALAB_CONFIG_FILE is set (by docker-entrypoint.sh)
if [ -n "$DDALAB_CONFIG_FILE" ] && [ -f "$DDALAB_CONFIG_FILE" ]; then
    echo "INFO: Using config file: $DDALAB_CONFIG_FILE"
fi

# Set default environment variables before Python imports them
# Use DDALAB_ prefixed vars first, fallback to legacy names for compatibility
export DB_USER=${DDALAB_DB_USER:-${DB_USER:-admin}}
export DB_PASSWORD=${DDALAB_DB_PASSWORD:-${DB_PASSWORD:-ddalab_password}}
export DB_NAME=${DDALAB_DB_NAME:-${DB_NAME:-ddalab}}
export DB_HOST=${DDALAB_DB_HOST:-${DB_HOST:-localhost}}
export DB_PORT=${DDALAB_DB_PORT:-${DB_PORT:-5432}}
export JWT_SECRET_KEY=${DDALAB_JWT_SECRET_KEY:-${JWT_SECRET_KEY:-dev-secret-key-change-in-production}}
export MINIO_HOST=${DDALAB_MINIO_HOST:-${MINIO_HOST:-localhost:9000}}
export MINIO_ACCESS_KEY=${DDALAB_MINIO_ACCESS_KEY:-${MINIO_ACCESS_KEY:-minioadmin}}
export MINIO_SECRET_KEY=${DDALAB_MINIO_SECRET_KEY:-${MINIO_SECRET_KEY:-minioadmin}}
export DATA_DIR=${DDALAB_DATA_DIR:-${DATA_DIR:-./data}}
export ALLOWED_DIRS=${DDALAB_ALLOWED_DIRS:-${ALLOWED_DIRS:-./data}}
# Ensure DDALAB_ALLOWED_DIRS is also set for the environment service
export DDALAB_ALLOWED_DIRS=${DDALAB_ALLOWED_DIRS:-./data}
export DDA_BINARY_PATH=${DDALAB_DDA_BINARY_PATH:-${DDA_BINARY_PATH:-./bin/run_DDA_ASCII}}
export DDALAB_AUTH_MODE=${DDALAB_AUTH_MODE:-local}

# Print warnings about using defaults
echo "INFO: Using database host: $DB_HOST"
echo "INFO: Using MinIO host: $MINIO_HOST"
echo "INFO: Using data directory: $DATA_DIR"
echo "INFO: Using allowed directories: $ALLOWED_DIRS"
echo "INFO: Using DDA binary: $DDA_BINARY_PATH"
echo "INFO: Using auth mode: $DDALAB_AUTH_MODE"
echo "DEBUG: DDALAB_ALLOWED_DIRS=$DDALAB_ALLOWED_DIRS"
echo "DEBUG: ALLOWED_DIRS=$ALLOWED_DIRS"

# Initialize database if needed (will create tables if they don't exist)
echo "Initializing database..."
python init_db.py || echo "Database initialization skipped or already done"

# Use python -m to run uvicorn to ensure it's found
exec python -m uvicorn main:app --host "$HOST" --port "$PORT"
