#!/bin/bash

echo "=== DDALAB Development Server ==="
echo "Using consolidated environment system"

# Set PYTHONPATH to include packages/api
export PYTHONPATH=$PYTHONPATH:$(pwd)/packages/api

# Select environment file (prefer dev-specific files for local runs)
ENV_FILE=".env.dev"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ERROR: Development environment file .env.dev not found."
  echo "   This script requires .env.dev for local development."
  echo "   Please create .env.dev or use one of the deployment scripts instead."
  exit 1
fi

echo "Loading environment from $ENV_FILE..."
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
export DB_PORT=${DDALAB_DB_PORT:-5432}
export API_PORT=${DDALAB_API_PORT:-8001}
export DB_NAME=${DDALAB_DB_NAME:-ddalab_db}
export MINIO_HOST=localhost:9000
export MINIO_ACCESS_KEY=ddalab
export MINIO_SECRET_KEY=ddalab_dev_key
export REDIS_HOST=localhost
export DATA_DIR=${DATA_DIR:-/Users/$(whoami)/Desktop}
export ALLOWED_DIRS=${ALLOWED_DIRS:-/Users/$(whoami)/Desktop}
export DDA_BINARY_PATH=${DDA_BINARY_PATH:-/Users/$(whoami)/Desktop/DDALAB/bin/run_DDA_ASCII}
export NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:8001}
export NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
export NEXTAUTH_URL=${NEXTAUTH_URL:-http://localhost:3000}
export MINIO_ROOT_USER=${MINIO_ROOT_USER:-ddalab}
export MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD:-ddalab_dev_key}
export JWT_SECRET_KEY=${JWT_SECRET_KEY:-dev-jwt-secret-key}
export NEXTAUTH_SECRET=${NEXTAUTH_SECRET:-dev-nextauth-secret-key}
export DB_USER=${DB_USER:-ddalab}
export DB_PASSWORD=${DB_PASSWORD:-ddalab_dev_password}

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

# Check if we can connect directly as the target user
if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c '\q' 2>/dev/null; then
    echo "✓ Database user and database already exist"
else
    echo "Database user or database doesn't exist, trying to create..."
    
    # Try to connect as postgres superuser to create user/database
    # Default postgres superuser credentials for local development
    POSTGRES_USER=${POSTGRES_USER:-postgres}
    POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
    
    # Check if we can connect as postgres superuser
    if ! PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d postgres -c '\q' 2>/dev/null; then
        echo "⚠️  Cannot connect as postgres superuser."
        echo "   Please ensure PostgreSQL is running and accessible."
        echo "   You may need to set POSTGRES_USER and POSTGRES_PASSWORD environment variables."
        exit 1
    fi
    
    # Create user if it doesn't exist
    echo "Creating database user '$DB_USER'..."
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d postgres <<EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_user WHERE usename = '$DB_USER') THEN
        CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
    ELSE
        ALTER USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
    END IF;
END
\$\$;
EOF
    
    # Create database if it doesn't exist
    echo "Creating database '$DB_NAME'..."
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d postgres <<EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME') THEN
        CREATE DATABASE $DB_NAME OWNER $DB_USER;
    END IF;
END
\$\$;
EOF
    
    # Grant all privileges on the database to the user
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d "$DB_NAME" <<EOF
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
GRANT ALL ON SCHEMA public TO $DB_USER;
EOF
    
    # Verify the connection works now
    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c '\q' 2>/dev/null; then
        echo "✓ Successfully created database user and database"
    else
        echo "❌ Failed to create database user or database"
        exit 1
    fi
fi

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
export PROMETHEUS_MULTIPROC_DIR=/tmp/prometheus

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
