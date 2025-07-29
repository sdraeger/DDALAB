#!/bin/bash

# Clear potentially conflicting environment variables that might override .env
unset DDALAB_MINIO_HOST MINIO_HOST
unset DDALAB_DB_HOST DDALAB_DB_PORT DDALAB_DB_USER DDALAB_DB_PASSWORD
unset DDALAB_API_HOST DDALAB_API_PORT

echo "Clearing potentially conflicting environment variables for development..."

# Set PYTHONPATH to include packages/api
export PYTHONPATH=$PYTHONPATH:$(pwd)/packages/api

# Export all variables from .env.dev to the environment
set -a
source .env.dev
set +a

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

until nc -z localhost 5432; do
  echo 'Waiting for PostgreSQL...'
  sleep 1
done

# Export DB vars for psql commands (already exported above)

PGPASSWORD="$DDALAB_DB_PASSWORD" psql -h "$DDALAB_DB_HOST" -p "$DDALAB_DB_PORT" -U "$DDALAB_DB_USER" -d postgres -t -c "SELECT 1 FROM pg_roles WHERE rolname = '$DDALAB_DB_USER'" | grep -q 1 || \
PGPASSWORD="$DDALAB_DB_PASSWORD" psql -h "$DDALAB_DB_HOST" -p "$DDALAB_DB_PORT" -U "$DDALAB_DB_USER" -d postgres -c "CREATE ROLE \"$DDALAB_DB_USER\" WITH LOGIN PASSWORD '$DDALAB_DB_PASSWORD' CREATEDB;"

PGPASSWORD="$DDALAB_DB_PASSWORD" psql -h "$DDALAB_DB_HOST" -p "$DDALAB_DB_PORT" -U "$DDALAB_DB_USER" -d postgres -t -c "SELECT 1 FROM pg_database WHERE datname = 'ddalab'" | grep -q 1 || \
PGPASSWORD="$DDALAB_DB_PASSWORD" psql -h "$DDALAB_DB_HOST" -p "$DDALAB_DB_PORT" -U "$DDALAB_DB_USER" -d postgres -c "CREATE DATABASE ddalab WITH OWNER = \"$DDALAB_DB_USER\" ENCODING = 'UTF8' LC_COLLATE = 'C' LC_CTYPE = 'C';"

echo "Applying SQL files..."

python packages/api/apply_sql_files.py \
  --dbname "$DDALAB_DB_NAME" \
  --user "$DDALAB_DB_USER" \
  --password "$DDALAB_DB_PASSWORD" \
  --host "$DDALAB_DB_HOST" \
  --port "$DDALAB_DB_PORT" \
  --email admin@example.com \
  --first_name Admin \
  --last_name User

if [ $? -ne 0 ]; then
  echo "Error: Failed to apply SQL files"
  exit 1
fi

mkdir -p /tmp/prometheus

echo "DDALAB_DB_USER: $DDALAB_DB_USER"

uvicorn packages.api.main:app --host 0.0.0.0 --port 8001 --reload &
API_PID=$!
if [ $? -ne 0 ]; then
  echo "Error: Failed to start API server on port 8001"
  cleanup
fi

uvicorn packages.api.main:app_metrics --host 0.0.0.0 --port 8002 --reload &
METRICS_PID=$!
if [ $? -ne 0 ]; then
  echo "Error: Failed to start metrics server on port 8002"
  cleanup
fi

wait $API_PID $METRICS_PID
