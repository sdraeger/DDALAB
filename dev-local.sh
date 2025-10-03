#!/bin/bash
# DDALAB Local Development Script
# Uses infrastructure from Docker Swarm dev stack

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}🚀 DDALAB Local Development Environment${NC}"
echo

# Check if development stack is running
if ! docker stack ls | grep -q "ddalab-dev"; then
    echo -e "${YELLOW}Development infrastructure stack not found.${NC}"
    echo "Please run the development stack first:"
    echo "  ./deploy-dev.sh"
    echo
    read -p "Would you like to deploy the development stack now? [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ./deploy-dev.sh
    else
        echo "Exiting. Please deploy the development stack first."
        exit 1
    fi
fi

# Load development environment
if [ -f .env.dev ]; then
    echo "Loading development configuration..."
    set -a
    source .env.dev
    set +a

    # Map DDALAB_ prefixed variables to standard names
    export DB_HOST=${DDALAB_DB_HOST:-localhost}
    export DB_PORT=${DDALAB_DB_PORT:-5432}
    export DB_NAME=${DDALAB_DB_NAME:-ddalab_db}
    export DB_USER=${DDALAB_DB_USER:-ddalab}
    export DB_PASSWORD=${DDALAB_DB_PASSWORD:-ddalab_dev_password}
    export MINIO_HOST=${DDALAB_MINIO_HOST:-localhost:9000}
    export MINIO_ACCESS_KEY=${DDALAB_MINIO_ACCESS_KEY:-ddalab}
    export MINIO_SECRET_KEY=${DDALAB_MINIO_SECRET_KEY:-ddalab_dev_key}
else
    echo -e "${RED}❌ .env.dev not found!${NC}"
    echo "Please run ./deploy-dev.sh first to create the development environment."
    exit 1
fi

# Wait for services to be ready
echo "Waiting for infrastructure services to be ready..."

# Wait for PostgreSQL
echo -n "Waiting for PostgreSQL... "
until nc -z localhost 5432 2>/dev/null; do
    printf "."
    sleep 1
done
echo -e " ${GREEN}✓${NC}"

# Wait for Redis
echo -n "Waiting for Redis... "
until nc -z localhost 6379 2>/dev/null; do
    printf "."
    sleep 1
done
echo -e " ${GREEN}✓${NC}"

# Wait for MinIO
echo -n "Waiting for MinIO... "
until nc -z localhost 9000 2>/dev/null; do
    printf "."
    sleep 1
done
echo -e " ${GREEN}✓${NC}"

# Check Python virtual environment
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}Virtual environment not found. Creating...${NC}"
    python -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate

# Install API dependencies if needed
if [ ! -f ".venv/.api-deps-installed" ]; then
    echo "Installing API dependencies..."
    pip install -r packages/api/requirements.txt
    touch .venv/.api-deps-installed
fi

# Apply SQL files and setup database
echo "Setting up database..."

# Set PYTHONPATH to include packages/api
export PYTHONPATH="$PYTHONPATH:$(pwd)/packages/api"

cd packages/api
python apply_sql_files.py \
  --dbname "$DB_NAME" \
  --user "$DB_USER" \
  --password "$DB_PASSWORD" \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --email admin@example.com \
  --first_name Admin \
  --last_name User
cd ../..

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to setup database${NC}"
    exit 1
fi

echo
echo -e "${GREEN}✅ Development environment ready!${NC}"
echo
echo -e "${BLUE}Infrastructure Services:${NC}"
echo "  PostgreSQL:     localhost:5432 ✓"
echo "  Redis:          localhost:6379 ✓"
echo "  MinIO:          localhost:9000 ✓"
echo "  MinIO Console:  http://localhost:9001"
echo "  Grafana:        http://localhost:3001"
echo "  Prometheus:     http://localhost:9090"
echo
echo -e "${BLUE}Ready to start local services:${NC}"
echo
echo -e "${YELLOW}Terminal 1 - API Server:${NC}"
echo "  cd packages/api"
echo "  python -m main"
echo "  # → http://localhost:8001"
echo
echo -e "${YELLOW}Terminal 2 - Tauri Desktop App:${NC}"
echo "  cd packages/ddalab-tauri"
echo "  npm run tauri:dev"
echo "  # → Desktop application"
echo
echo -e "${BLUE}Development URLs:${NC}"
echo "  🖥️  Desktop App:    packages/ddalab-tauri (Tauri)"
echo "  🔧 API:            http://localhost:8001"
echo "  📚 API Docs:       http://localhost:8001/docs"
echo "  🗄️  MinIO Console:  http://localhost:9001"
echo "  📊 Grafana:        http://localhost:3001 (admin/admin)"
echo "  📈 Prometheus:     http://localhost:9090"
echo
echo "Happy coding! 🎉"
