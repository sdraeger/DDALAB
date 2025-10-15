#!/bin/bash
# Start only the API server and its dependencies for DDALAB Tauri development
# This provides a minimal backend for the Tauri desktop app

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}🔧 DDALAB API Server Only (for Tauri Desktop)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to display status
display_api_status() {
    echo -e "\n${GREEN}✅ API Server and dependencies are running!${NC}\n"
    echo -e "${YELLOW}API Server:${NC}"
    echo -e "  🌐 API Base URL: ${BLUE}http://localhost:8000${NC}"
    echo -e "  📚 API Docs: ${BLUE}http://localhost:8000/docs${NC}"
    echo -e "  🔗 GraphQL: ${BLUE}http://localhost:8000/graphql${NC}"
    echo -e "  ❤️  Health Check: ${BLUE}http://localhost:8000/health${NC}"
    echo ""
    echo -e "${YELLOW}Supporting Services:${NC}"
    echo -e "  🐘 PostgreSQL: ${BLUE}localhost:5433${NC} (ddalab_dev/isolated_dev_pass)"
    echo -e "  🔴 Redis: ${BLUE}localhost:6380${NC}"
    echo -e "  📦 MinIO: ${BLUE}http://localhost:9003${NC} (isolated_minio/isolated_minio_pass)"
    echo ""
    echo -e "${YELLOW}For Tauri Desktop App:${NC}"
    echo -e "  Set API URL to: ${BLUE}http://localhost:8000${NC}"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo -e "  View API logs: ${BLUE}docker compose -f docker-compose.api-only.yml logs -f api-dev${NC}"
    echo -e "  Stop: ${BLUE}$0 down${NC}"
    echo -e "  Restart: ${BLUE}$0 restart${NC}"
    echo ""
}

# Function to wait for services
wait_for_api_services() {
    echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"

    # Wait for PostgreSQL
    echo -n "  PostgreSQL..."
    while ! docker compose -f "$PROJECT_ROOT/docker-compose.api-only.yml" exec -T postgres-dev pg_isready -U ddalab_dev >/dev/null 2>&1; do
        sleep 1
        echo -n "."
    done
    echo -e " ${GREEN}✓${NC}"

    # Wait for Redis
    echo -n "  Redis..."
    while ! docker compose -f "$PROJECT_ROOT/docker-compose.api-only.yml" exec -T redis-dev redis-cli ping >/dev/null 2>&1; do
        sleep 1
        echo -n "."
    done
    echo -e " ${GREEN}✓${NC}"

    # Wait for MinIO
    echo -n "  MinIO..."
    while ! curl -s http://localhost:9002/minio/health/live >/dev/null 2>&1; do
        sleep 1
        echo -n "."
    done
    echo -e " ${GREEN}✓${NC}"

    # Wait for API
    echo -n "  API Server..."
    while ! curl -s http://localhost:8000/health >/dev/null 2>&1; do
        sleep 1
        echo -n "."
    done
    echo -e " ${GREEN}✓${NC}"
}

# Main command handling
case "${1:-up}" in
    up|start)
        # Check for conflicting ports
        echo -e "${YELLOW}Checking for port conflicts...${NC}"
        conflicts=0

        for port in 5433 6380 8000 9002 9003; do
            if check_port $port; then
                echo -e "  ${RED}✗ Port $port is already in use${NC}"
                conflicts=$((conflicts + 1))
            fi
        done

        if [ $conflicts -gt 0 ]; then
            echo -e "\n${RED}Error: Port conflicts detected!${NC}"
            echo "Please stop conflicting services."
            echo "To stop the full isolated environment: ./scripts/dev-isolated.sh down"
            exit 1
        fi

        # Create docker-compose file for API-only
        echo -e "\n${YELLOW}Creating API-only configuration...${NC}"
        cat > "$PROJECT_ROOT/docker-compose.api-only.yml" << 'EOF'
# API-only development environment for DDALAB Tauri app
# Contains only the API server and its required dependencies

services:
  # PostgreSQL Database
  postgres-dev:
    image: postgres:16-alpine
    container_name: ddalab-postgres-api-only
    environment:
      POSTGRES_USER: ddalab_dev
      POSTGRES_PASSWORD: isolated_dev_pass
      POSTGRES_DB: ddalab_isolated
    ports:
      - "5433:5432"
    volumes:
      - postgres-api-only:/var/lib/postgresql/data
    networks:
      - ddalab-api-only
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "ddalab_dev", "-d", "ddalab_isolated"]
      interval: 5s
      timeout: 3s
      retries: 10

  # Redis Cache
  redis-dev:
    image: redis:7-alpine
    container_name: ddalab-redis-api-only
    ports:
      - "6380:6379"
    volumes:
      - redis-api-only:/data
    networks:
      - ddalab-api-only

  # MinIO Object Storage
  minio-dev:
    image: minio/minio:latest
    container_name: ddalab-minio-api-only
    environment:
      MINIO_ROOT_USER: isolated_minio
      MINIO_ROOT_PASSWORD: isolated_minio_pass
    ports:
      - "9002:9000"
      - "9003:9001"
    command: server /data --console-address ":9001"
    volumes:
      - minio-api-only:/data
    networks:
      - ddalab-api-only
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

  # API Server only - exposed on localhost:8000
  api-dev:
    build:
      context: .
      dockerfile: Dockerfile.isolated-dev
      target: api-dev
    container_name: ddalab-api-only
    environment:
      # Core settings
      ENVIRONMENT: development
      DEBUG: "true"
      RELOAD: "true"

      # Database
      DB_HOST: postgres-dev
      DB_PORT: 5432
      DB_USER: ddalab_dev
      DB_PASSWORD: isolated_dev_pass
      DB_NAME: ddalab_isolated

      # MinIO
      MINIO_HOST: minio-dev:9000
      MINIO_ACCESS_KEY: isolated_minio
      MINIO_SECRET_KEY: isolated_minio_pass

      # Redis
      REDIS_HOST: redis-dev
      REDIS_PORT: 6379

      # Auth
      AUTH_MODE: local
      JWT_SECRET_KEY: isolated_dev_jwt_secret_key_32chars

      # Data paths
      DATA_DIR: /app/data
      ALLOWED_DIRS: /app/data
      DDA_BINARY_PATH: /app/bin/run_DDA_AsciiEdf

      # API settings - bind to all interfaces and expose on 8000
      API_HOST: 0.0.0.0
      API_PORT: 8001

      # CORS settings for Tauri desktop app
      CORS_ORIGINS: "tauri://localhost,http://localhost:3003,http://localhost:3000"

      # Python path
      PYTHONPATH: /app/packages/api
    ports:
      - "8000:8001"  # Expose API directly on 8000 for Tauri
    volumes:
      - ./packages/api:/app/packages/api:cached
      - ./data:/app/data
      - ./bin:/app/bin:ro
    depends_on:
      postgres-dev:
        condition: service_healthy
      redis-dev:
        condition: service_started
      minio-dev:
        condition: service_healthy
    networks:
      - ddalab-api-only
    command: ["sh", "-c", "cd /app && python -m packages.api.apply_sql_files --dbname ddalab_isolated --user ddalab_dev --password isolated_dev_pass --host postgres-dev --port 5432 --email admin@isolated.dev --first_name Admin --last_name User && uvicorn packages.api.main:app --host 0.0.0.0 --port 8001 --reload"]

networks:
  ddalab-api-only:
    name: ddalab-api-only-network
    driver: bridge

volumes:
  postgres-api-only:
  redis-api-only:
  minio-api-only:
EOF

        # Build images if needed
        echo -e "\n${YELLOW}Building API development image...${NC}"
        docker compose -f "$PROJECT_ROOT/docker-compose.api-only.yml" build

        # Start services
        echo -e "\n${YELLOW}Starting API server and dependencies...${NC}"
        docker compose -f "$PROJECT_ROOT/docker-compose.api-only.yml" up -d

        # Wait for services to be ready
        wait_for_api_services

        # Display status
        display_api_status
        ;;

    down|stop)
        echo -e "${YELLOW}Stopping API server and dependencies...${NC}"
        if [ -f "$PROJECT_ROOT/docker-compose.api-only.yml" ]; then
            docker compose -f "$PROJECT_ROOT/docker-compose.api-only.yml" down
            echo -e "${GREEN}✅ API server stopped${NC}"
        else
            echo -e "${RED}No API-only environment found${NC}"
        fi
        ;;

    restart)
        echo -e "${YELLOW}Restarting API server...${NC}"
        if [ -f "$PROJECT_ROOT/docker-compose.api-only.yml" ]; then
            docker compose -f "$PROJECT_ROOT/docker-compose.api-only.yml" restart
            wait_for_api_services
            display_api_status
        else
            echo -e "${RED}No API-only environment found. Run 'start' first.${NC}"
        fi
        ;;

    logs)
        shift
        if [ -f "$PROJECT_ROOT/docker-compose.api-only.yml" ]; then
            docker compose -f "$PROJECT_ROOT/docker-compose.api-only.yml" logs -f "${1:-api-dev}"
        else
            echo -e "${RED}No API-only environment found${NC}"
        fi
        ;;

    status)
        if [ -f "$PROJECT_ROOT/docker-compose.api-only.yml" ]; then
            docker compose -f "$PROJECT_ROOT/docker-compose.api-only.yml" ps
        else
            echo -e "${RED}No API-only environment found${NC}"
        fi
        ;;

    clean)
        echo -e "${RED}⚠️  This will remove all API-only environment data!${NC}"
        read -p "Are you sure? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            if [ -f "$PROJECT_ROOT/docker-compose.api-only.yml" ]; then
                docker compose -f "$PROJECT_ROOT/docker-compose.api-only.yml" down -v
                rm -f "$PROJECT_ROOT/docker-compose.api-only.yml"
                echo -e "${GREEN}✅ API-only environment cleaned${NC}"
            else
                echo -e "${YELLOW}No API-only environment found${NC}"
            fi
        fi
        ;;

    shell)
        service="${2:-api-dev}"
        if [ -f "$PROJECT_ROOT/docker-compose.api-only.yml" ]; then
            docker compose -f "$PROJECT_ROOT/docker-compose.api-only.yml" exec "$service" /bin/sh
        else
            echo -e "${RED}No API-only environment found${NC}"
        fi
        ;;

    *)
        echo "Usage: $0 {up|down|restart|logs|status|clean|shell} [service]"
        echo ""
        echo "🔧 DDALAB API Server Only - Perfect for Tauri Desktop Development"
        echo ""
        echo "Commands:"
        echo "  up/start  - Start API server and dependencies"
        echo "  down/stop - Stop API server and dependencies"
        echo "  restart   - Restart API server"
        echo "  logs      - View logs (optionally specify service)"
        echo "  status    - Show service status"
        echo "  clean     - Remove all data and volumes"
        echo "  shell     - Open shell in a service container"
        echo ""
        echo "After starting, use http://localhost:8000 as your API URL in the Tauri app."
        ;;
esac
