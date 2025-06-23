#!/bin/bash

# Define the path to the .env file
ENV_FILE="../.env.dev"

# Clear potentially conflicting environment variables that might override .env.dev
# This is especially important if the main .env file was previously sourced
unset DDALAB_MINIO_HOST MINIO_HOST
unset DDALAB_DB_HOST DDALAB_DB_PORT DDALAB_DB_USER DDALAB_DB_PASSWORD
unset DDALAB_API_HOST DDALAB_API_PORT

echo "Clearing potentially conflicting environment variables for development..."

# Load environment variables from the specified .env file
if [ -f "$ENV_FILE" ]; then
  echo "Loading development environment from $ENV_FILE"
  source "$ENV_FILE"
else
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

# Verify that the correct MinIO host is loaded
echo "MinIO host configuration: DDALAB_MINIO_HOST=${DDALAB_MINIO_HOST}"

# Set the DDALAB_ENV_FILE environment variable for the Python application
export DDALAB_ENV_FILE="$ENV_FILE"

# Set PYTHONPATH to include packages/api
export PYTHONPATH=$PYTHONPATH:$(pwd)/api

# Function to clean up background processes
cleanup() {
  echo "Shutting down Uvicorn servers..."
  # Kill the uvicorn processes if they exist
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

# Trap SIGINT (Ctrl+C) and call cleanup
trap cleanup SIGINT

# Wait for PostgreSQL to be available
until nc -z localhost 5432; do
  echo 'Waiting for PostgreSQL...'
  sleep 1
done

# Check if PostgreSQL user exists, create if not
PGPASSWORD="$DDALAB_DB_PASSWORD" psql -h localhost -p 5432 -U "$DDALAB_DB_USER" -d postgres -t -c "SELECT 1 FROM pg_roles WHERE rolname = '$DDALAB_DB_USER'" | grep -q 1 || \
PGPASSWORD="$DDALAB_DB_PASSWORD" psql -h localhost -p 5432 -U "$DDALAB_DB_USER" -d postgres -c "CREATE ROLE \"$DDALAB_DB_USER\" WITH LOGIN PASSWORD '$DDALAB_DB_PASSWORD' CREATEDB;"

# Check if ddalab database exists, create it if not
PGPASSWORD="$DDALAB_DB_PASSWORD" psql -h localhost -p 5432 -U "$DDALAB_DB_USER" -d postgres -t -c "SELECT 1 FROM pg_database WHERE datname = 'ddalab'" | grep -q 1 || \
PGPASSWORD="$DDALAB_DB_PASSWORD" psql -h localhost -p 5432 -U "$DDALAB_DB_USER" -d postgres -c "CREATE DATABASE ddalab WITH OWNER = \"$DDALAB_DB_USER\" ENCODING = 'UTF8' LC_COLLATE = 'C' LC_CTYPE = 'C';"

echo "Applying SQL files..."

# Apply SQL files
python api/apply_sql_files.py \
  --username "$DDALAB_DB_USER" \
  --password "$DDALAB_DB_PASSWORD" \
  --email admin@example.com \
  --first_name Admin \
  --last_name User

if [ $? -ne 0 ]; then
  echo "Error: Failed to apply SQL files"
  exit 1
fi

# Create directory for Prometheus
mkdir -p /tmp/prometheus

# Start the main API server on port 8001 and store its PID
uvicorn api.main:app --host 0.0.0.0 --port 8001 --reload &
API_PID=$!
if [ $? -ne 0 ]; then
  echo "Error: Failed to start API server on port 8001"
  cleanup
fi

# Start the metrics server on port 8002 and store its PID
uvicorn api.main:app_metrics --host 0.0.0.0 --port 8002 --reload &
METRICS_PID=$!
if [ $? -ne 0 ]; then
  echo "Error: Failed to start metrics server on port 8002"
  cleanup
fi

# Wait for both processes to complete
wait $API_PID $METRICS_PID
