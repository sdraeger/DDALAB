#!/bin/bash

echo "=== DDALAB Development Server ==="
echo "Using consolidated environment system"

# Set PYTHONPATH to include packages/api
export PYTHONPATH=$PYTHONPATH:$(pwd)/packages/api

# Select environment file (prefer dev-specific files for local runs)
POSSIBLE_ENV_FILES=(".env.dev" ".env.local" ".env")
ENV_FILE=""
for candidate in "${POSSIBLE_ENV_FILES[@]}"; do
  if [ -f "$candidate" ]; then
    ENV_FILE="$candidate"
    break
  fi
done

if [ -z "$ENV_FILE" ]; then
  echo "❌ ERROR: No environment file found (.env.dev, .env.local, or .env)."
  echo "   Please create .env.dev for local development or .env for Docker deployments."
  exit 1
fi

echo "Loading environment from $ENV_FILE..."
if [ "$ENV_FILE" = ".env" ]; then
  echo "ℹ️  Using .env (intended for Docker deployments)."
  echo "   For local development, consider creating .env.dev with host paths (e.g., DATA_DIR=/Users/... )"
fi

set -a
source "$ENV_FILE"
set +a

# Override with development-specific values (force development settings)
# These override .env values for local development
export ENVIRONMENT=development
export DEBUG=true
export RELOAD=true
export AUTH_MODE=local
export DB_HOST=localhost
export MINIO_HOST=localhost:9000
export MINIO_ACCESS_KEY=admin
export MINIO_SECRET_KEY=dev_password123
export REDIS_HOST=localhost
export DATA_DIR=${DATA_DIR:-data}
export ALLOWED_DIRS=${ALLOWED_DIRS:-/Users/$(whoami)/Desktop}
export DDA_BINARY_PATH=${DDA_BINARY_PATH:-/Users/$(whoami)/Desktop/DDALAB/bin/run_DDA_ASCII}
export NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:8001}
export NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
export NEXTAUTH_URL=${NEXTAUTH_URL:-http://localhost:3000}
export MINIO_ROOT_USER=${MINIO_ROOT_USER:-admin}
export MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD:-dev_password123}
export JWT_SECRET_KEY=${JWT_SECRET_KEY:-dev-jwt-secret-key}
export NEXTAUTH_SECRET=${NEXTAUTH_SECRET:-dev-nextauth-secret-key}
export DB_USER=${DB_USER:-admin}
export DB_PASSWORD=${DB_PASSWORD:-dev_password123}

# Validate required environment variables
REQUIRED_VARS=(
    "DB_USER"
    "DB_PASSWORD"
    "JWT_SECRET_KEY"
    "MINIO_HOST"
    "MINIO_ACCESS_KEY"
    "MINIO_SECRET_KEY"
    "DDA_BINARY_PATH"
    "ALLOWED_DIRS"
)

echo "Validating environment configuration..."
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ ERROR: Required environment variable $var is not set"
        echo "   Please ensure $var is set in your .env file or as an environment variable"
        exit 1
    fi
done
echo "✓ Environment configuration validated"

# Function to clean up background processes
cleanup() {
  echo "Shutting down Uvicorn servers..."
  if [ -n "$API_PID" ]; then
    kill -SIGTERM "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null
  fi
  if [ -n "$METRICS_PID" ]; then
    kill -SIGTERM "$METRICS_PID" 2>/dev/null
    wait "$METRICS_PID" 2>/dev/null
  fi
  echo "Uvicorn servers stopped."
  exit 0
}

trap cleanup SIGINT

until nc -z "$DB_HOST" "$DB_PORT"; do
  echo 'Waiting for PostgreSQL...'
  sleep 1
done

# Create user and database if they don't exist
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -t -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -q 1 || \
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASSWORD' CREATEDB;"

PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -t -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME WITH OWNER = \"$DB_USER\" ENCODING = 'UTF8' LC_COLLATE = 'C' LC_CTYPE = 'C';"

echo "Applying SQL files..."

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

python -m packages.api.apply_sql_files \
  --dbname "$DB_NAME" \
  --user "$DB_USER" \
  --password "$DB_PASSWORD" \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --email admin@example.com \
  --first_name Admin \
  --last_name User

if [ $? -ne 0 ]; then
  echo "Error: Failed to apply SQL files"
  exit 1
fi

mkdir -p /tmp/prometheus

echo "DB_USER: $DB_USER"
echo "DB_HOST: $DB_HOST"
echo "MINIO_HOST: $MINIO_HOST"
echo "REDIS_HOST: $REDIS_HOST"

uvicorn packages.api.main:app --host 0.0.0.0 --port "$API_PORT" --reload &
API_PID=$!
if [ $? -ne 0 ]; then
  echo "Error: Failed to start API server on port $API_PORT"
  cleanup
fi

uvicorn packages.api.main:app_metrics --host 0.0.0.0 --port 8002 --reload &
METRICS_PID=$!
if [ $? -ne 0 ]; then
  echo "Error: Failed to start metrics server on port 8002"
  cleanup
fi

wait $API_PID $METRICS_PID
