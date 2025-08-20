#!/bin/sh
# Start the Python API server via Uvicorn

HOST=${API_HOST:-0.0.0.0}
PORT=${API_PORT:-8001}

# Set default environment variables before Python imports them
export DB_USER=${DB_USER:-ddalab}
export DB_PASSWORD=${DB_PASSWORD:-ddalab123}
export DB_NAME=${DB_NAME:-ddalab}
export DB_HOST=${DB_HOST:-postgres}
export DB_PORT=${DB_PORT:-5432}
export JWT_SECRET_KEY=${JWT_SECRET_KEY:-dev-secret-key-change-in-production}
export MINIO_HOST=${MINIO_HOST:-minio:9000}
export MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY:-ddalab}
export MINIO_SECRET_KEY=${MINIO_SECRET_KEY:-ddalab123}
export ALLOWED_DIRS=${ALLOWED_DIRS:-/app/data,/tmp}
export DDALAB_AUTH_MODE=${DDALAB_AUTH_MODE:-local}

# Print warnings about using defaults
echo "INFO: Using database host: $DB_HOST"
echo "INFO: Using MinIO host: $MINIO_HOST"
echo "INFO: Using allowed directories: $ALLOWED_DIRS"
echo "INFO: Using auth mode: $DDALAB_AUTH_MODE"

# Initialize database if needed (will create tables if they don't exist)
echo "Initializing database..."
python init_db.py || echo "Database initialization skipped or already done"

# Use python -m to run uvicorn to ensure it's found
exec python -m uvicorn main:app --host "$HOST" --port "$PORT"
