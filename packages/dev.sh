#!/bin/bash

echo "=== DDALAB Development Server ==="
echo "Using consolidated environment system"

# Set PYTHONPATH to include packages/api
export PYTHONPATH=$PYTHONPATH:$(pwd)/packages/api

# Load development environment configuration
# Priority: .env.local > .env.example (for new setups)
ENV_FILE=".env.local"
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating .env.local from template..."
    cp .env.example .env.local
    
    # Apply development-specific overrides
    cat >> .env.local << EOF

#=============================================================================
# DEVELOPMENT OVERRIDES (auto-generated)
#=============================================================================
DDALAB_ENVIRONMENT=development
DDALAB_DEBUG=true
DDALAB_RELOAD=true
DDALAB_AUTH_MODE=local
DDALAB_DB_HOST=localhost
DDALAB_MINIO_HOST=localhost:9000
DDALAB_MINIO_ACCESS_KEY=admin
DDALAB_MINIO_SECRET_KEY=dev_password123
DDALAB_REDIS_HOST=localhost
DDALAB_DATA_DIR=data
DDALAB_ALLOWED_DIRS=/Users/$(whoami)/Desktop
DDALAB_DDA_BINARY_PATH=/Users/$(whoami)/Desktop/DDALAB/bin/run_DDA_ASCII
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=dev_password123
DDALAB_JWT_SECRET_KEY=dev-jwt-secret-key
NEXTAUTH_SECRET=dev-nextauth-secret-key
DDALAB_DB_USER=admin
DDALAB_DB_PASSWORD=dev_password123
EOF
    
    echo "✓ Created .env.local with development defaults"
    echo "  Customize paths and secrets as needed"
fi

echo "Loading environment from $ENV_FILE..."
set -a
source "$ENV_FILE"
set +a

# Validate required environment variables
REQUIRED_VARS=(
    "DDALAB_DB_USER"
    "DDALAB_DB_PASSWORD"
    "DDALAB_JWT_SECRET_KEY"
    "DDALAB_MINIO_HOST"
    "DDALAB_MINIO_ACCESS_KEY"
    "DDALAB_MINIO_SECRET_KEY"
    "DDALAB_DDA_BINARY_PATH"
    "DDALAB_ALLOWED_DIRS"
)

echo "Validating environment configuration..."
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ ERROR: Required environment variable $var is not set"
        echo "   Please check your $ENV_FILE file"
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

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

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
