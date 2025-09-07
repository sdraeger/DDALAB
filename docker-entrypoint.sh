#!/bin/bash
set -e

# DDALAB Docker Entrypoint Script
# Handles configuration precedence: env vars > mounted config > baked-in default

CONFIG_DIR="/etc/ddalab"
DEFAULT_CONFIG="$CONFIG_DIR/config.yml"
MOUNTED_CONFIG="/config/config.yml"
RUNTIME_CONFIG="/tmp/ddalab-config.yml"

echo "=== DDALAB Container Starting ==="

# Function to generate config from environment variables
generate_config_from_env() {
    echo "Generating configuration from environment variables..."
    
    cat > "$RUNTIME_CONFIG" << EOF
# DDALAB Runtime Configuration (Generated from Environment Variables)
environment: ${DDA_ENVIRONMENT:-production}
debug: ${DDA_DEBUG:-false}
service_name: ${DDA_SERVICE_NAME:-ddalab}
institution_name: ${DDA_INSTITUTION_NAME:-DDALAB}

api:
  host: ${DDA_API_HOST:-0.0.0.0}
  port: ${DDA_API_PORT:-${DDA_PORT:-8001}}
  reload: ${DDA_RELOAD:-false}

database:
  host: ${DDA_DB_HOST:-postgres}
  port: ${DDA_DB_PORT:-5432}
  name: ${DDA_DB_NAME:-ddalab}
  user: ${DDA_DB_USER:-admin}
  password: ${DDA_DB_PASSWORD:-ddalab_password}

auth:
  mode: ${DDA_AUTH_MODE:-local}
  jwt_secret_key: ${DDA_JWT_SECRET_KEY:-MUST_CHANGE_IN_PRODUCTION_32_CHARS_MIN}
  jwt_algorithm: ${DDA_JWT_ALGORITHM:-HS256}
  token_expiration_minutes: ${DDA_TOKEN_EXPIRATION_MINUTES:-10080}
  refresh_token_expire_days: ${DDA_REFRESH_TOKEN_EXPIRE_DAYS:-7}

storage:
  minio_host: ${DDA_MINIO_HOST:-minio:9000}
  minio_access_key: ${DDA_MINIO_ACCESS_KEY:-minioadmin}
  minio_secret_key: ${DDA_MINIO_SECRET_KEY:-minioadmin}
  minio_bucket_name: ${DDA_MINIO_BUCKET_NAME:-dda-results}
  data_dir: ${DDA_DATA_DIR:-/app/data}
  allowed_dirs: ${DDA_ALLOWED_DIRS:-/app/data}
  anonymize_edf: ${DDA_ANONYMIZE_EDF:-true}

cache:
  redis_host: ${DDA_REDIS_HOST:-redis}
  redis_port: ${DDA_REDIS_PORT:-6379}
  redis_db: ${DDA_REDIS_DB:-0}
  redis_password: ${DDA_REDIS_PASSWORD:-}
  redis_use_ssl: ${DDA_REDIS_USE_SSL:-false}
  plot_cache_ttl: ${DDA_PLOT_CACHE_TTL:-3600}

dda:
  binary_path: ${DDA_BINARY_PATH:-/app/bin/run_DDA_ASCII}
  max_concurrent_tasks: ${DDA_MAX_CONCURRENT_TASKS:-10}
  task_timeout: ${DDA_TASK_TIMEOUT:-600}

monitoring:
  otlp_host: ${DDA_OTLP_HOST:-jaeger}
  otlp_port: ${DDA_OTLP_PORT:-4318}

web:
  public_api_url: ${DDA_PUBLIC_API_URL:-http://localhost:8001}
  public_app_url: ${DDA_PUBLIC_APP_URL:-http://localhost:3000}
  nextauth_url: ${DDA_NEXTAUTH_URL:-http://localhost:3000}
  port: ${DDA_WEB_PORT:-3000}
EOF
    echo "Runtime configuration generated at $RUNTIME_CONFIG"
}

# Function to check if any DDA environment variables are set
has_env_config() {
    # Check for common environment variables that would indicate user wants env-based config
    [ -n "$DDA_MODE" ] || [ -n "$DDA_PORT" ] || [ -n "$DDA_DB_HOST" ] || [ -n "$DDA_API_HOST" ] || \
    [ -n "$DDA_ENVIRONMENT" ] || [ -n "$DDA_DEBUG" ] || [ -n "$DDA_MINIO_HOST" ] || \
    [ -n "$DDA_DATA_DIR" ] || [ -n "$DDA_BINARY_PATH" ]
}

# Determine which config to use based on precedence
RESOLVED_CONFIG=""

if has_env_config; then
    echo "Environment variables detected - generating config from environment"
    generate_config_from_env
    RESOLVED_CONFIG="$RUNTIME_CONFIG"
    echo "Using environment-generated config: $RESOLVED_CONFIG"
elif [ -f "$MOUNTED_CONFIG" ]; then
    echo "Mounted config found: $MOUNTED_CONFIG"
    RESOLVED_CONFIG="$MOUNTED_CONFIG"
    echo "Using mounted config: $RESOLVED_CONFIG"
elif [ -f "$DEFAULT_CONFIG" ]; then
    echo "Using baked-in default config: $DEFAULT_CONFIG"
    RESOLVED_CONFIG="$DEFAULT_CONFIG"
else
    echo "ERROR: No configuration found! This should not happen."
    echo "Expected default config at: $DEFAULT_CONFIG"
    exit 1
fi

echo "Final resolved config: $RESOLVED_CONFIG"

# Convert YAML config to environment variables for backward compatibility
# This ensures the existing .env-based system continues to work
echo "Converting config to environment variables..."

# Extract values from YAML and export them
# Note: This is a simplified approach - in production you might use yq or similar
export DDALAB_CONFIG_FILE="$RESOLVED_CONFIG"

# For backward compatibility, also set the old environment variable format
# The application can read from either the YAML config or these env vars
if [ -f "$RESOLVED_CONFIG" ]; then
    echo "Configuration file validated: $RESOLVED_CONFIG"
    
    # Export the config file path so the Python application can load it
    export DDALAB_CONFIG_FILE="$RESOLVED_CONFIG"
    
    # Also set some critical env vars for immediate use
    export DDALAB_DATA_DIR="${DDA_DATA_DIR:-/app/data}"
    export DDALAB_ALLOWED_DIRS="${DDA_ALLOWED_DIRS:-/app/data}"
    export DDALAB_DDA_BINARY_PATH="${DDA_BINARY_PATH:-/app/bin/run_DDA_ASCII}"
fi

echo "=== Configuration Resolution Complete ==="
echo "Config file: $RESOLVED_CONFIG"
echo "Data directory: ${DDALAB_DATA_DIR}"
echo "DDA binary: ${DDALAB_DDA_BINARY_PATH}"
echo "=== Starting Application ==="

# Execute the original start script or main application
# Check if we have arguments passed to the container
if [ $# -gt 0 ]; then
    echo "Executing: $@"
    exec "$@"
else
    echo "Starting default application..."
    # Start the API server in the background
    cd /app/api
    /app/api/start.sh &
    API_PID=$!

    # Start the Next.js web20 server in the background
    cd /app/web20
    # Respect runtime env for API URL if provided
    export NEXT_PUBLIC_API_URL=${DDA_PUBLIC_API_URL:-${NEXT_PUBLIC_API_URL:-http://localhost:8001}}
    # Use standalone server for production
    if [ -f ".next/standalone/server.js" ]; then
        echo "Starting Next.js in standalone mode..."
        # Set port and hostname for standalone server
        export PORT=${DDA_WEB_PORT:-3000}
        export HOSTNAME=0.0.0.0
        node .next/standalone/server.js &
    else
        echo "Standalone build not found, falling back to npm start..."
        npm run start -- --port ${DDA_WEB_PORT:-3000} &
    fi
    WEB_PID=$!

    # Wait for both processes to finish
    wait $API_PID
    wait $WEB_PID
fi