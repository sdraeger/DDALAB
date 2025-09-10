#!/bin/bash
# Simple development environment launcher

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting DDALAB Development Environment${NC}"
echo ""

# Function to check if service is healthy
check_service() {
    local service=$1
    local url=$2
    local max_attempts=30
    local attempt=0

    echo -n "Waiting for $service to be ready..."
    while [ $attempt -lt $max_attempts ]; do
        if curl -s -f "$url" > /dev/null 2>&1; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    echo -e " ${YELLOW}⚠️  (may still be starting)${NC}"
    return 1
}

# Function to check PostgreSQL
check_postgres() {
    local max_attempts=30
    local attempt=0
    
    echo -n "Waiting for PostgreSQL to be ready..."
    while [ $attempt -lt $max_attempts ]; do
        if docker exec ddalab-postgres-1 pg_isready -U ${DB_USER:-ddalab} > /dev/null 2>&1; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    echo -e " ${YELLOW}⚠️  (may still be starting)${NC}"
    return 1
}

# Function to check Redis
check_redis() {
    local max_attempts=30
    local attempt=0
    
    echo -n "Waiting for Redis to be ready..."
    while [ $attempt -lt $max_attempts ]; do
        if docker exec ddalab-redis-1 redis-cli ping > /dev/null 2>&1; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    echo -e " ${YELLOW}⚠️  (may still be starting)${NC}"
    return 1
}

# Parse command line arguments
COMMAND=${1:-up}
shift || true

case "$COMMAND" in
    up|start)
        echo "Starting services..."
        docker compose --env-file .env.dev -f docker-compose.dev.yml up -d
        
        echo ""
        echo "Checking service health..."
        check_postgres || true
        check_redis || true
        check_service "MinIO" "http://localhost:9000/minio/health/live" || true
        check_service "Traefik" "http://localhost:8080/ping" || true
        # check_service "API" "http://localhost:8001/api/health" || true
        # check_service "Web20" "http://localhost:3000" || true
        
        echo ""
        echo -e "${GREEN}✅ Development environment is ready!${NC}"
        echo ""
        echo "Services available at:"
        echo "  📊 Web20 Dashboard: http://localhost:3000"
        echo "  🔌 API Server: http://localhost:8001"
        echo "  📚 API Docs: http://localhost:8001/docs"
        echo "  📦 MinIO Console: http://localhost:9001"
        echo "  🚦 Traefik Dashboard: http://localhost:8080"
        echo "  📈 Prometheus: http://localhost:9090"
        echo "  📊 Grafana: http://localhost:3000"
        echo "  🔍 Jaeger Tracing: http://localhost:16686"
        echo ""
        echo "View logs: docker compose -f docker-compose.dev.yml logs -f [service]"
        ;;
    
    down|stop)
        echo "Stopping services..."
        docker compose -f docker-compose.dev.yml down
        echo -e "${GREEN}✅ Services stopped${NC}"
        ;;
    
    restart)
        echo "Restarting services..."
        docker compose -f docker-compose.dev.yml restart "$@"
        echo -e "${GREEN}✅ Services restarted${NC}"
        ;;
    
    logs)
        docker compose -f docker-compose.dev.yml logs -f "$@"
        ;;
    
    ps|status)
        docker compose -f docker-compose.dev.yml ps
        ;;
    
    exec)
        docker compose -f docker-compose.dev.yml exec "$@"
        ;;
    
    api)
        echo "Accessing API container..."
        docker compose -f docker-compose.dev.yml exec api bash
        ;;
    
    web20)
        echo "Accessing web20 container..."
        docker compose -f docker-compose.dev.yml exec web20 sh
        ;;
    
    db)
        echo "Accessing PostgreSQL..."
        docker compose -f docker-compose.dev.yml exec postgres psql -U ${DB_USER:-ddalab} ${DB_NAME:-ddalab}
        ;;
    
    clean)
        echo "Stopping and removing all containers and volumes..."
        read -p "This will delete all data. Are you sure? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker compose -f docker-compose.dev.yml down -v
            echo -e "${GREEN}✅ Clean complete${NC}"
        fi
        ;;
    
    *)
        echo "Usage: $0 [command] [options]"
        echo ""
        echo "Commands:"
        echo "  up|start    Start all development services (default)"
        echo "  down|stop   Stop all services"
        echo "  restart     Restart services"
        echo "  logs        View logs (optionally specify service)"
        echo "  ps|status   Show service status"
        echo "  exec        Execute command in service"
        echo "  api         Access API container shell"
        echo "  web20       Access web20 container shell"
        echo "  db          Access PostgreSQL console"
        echo "  clean       Stop and remove all containers/volumes"
        echo ""
        echo "Examples:"
        echo "  $0              # Start all services"
        echo "  $0 logs api     # View API logs"
        echo "  $0 restart api  # Restart just the API"
        echo "  $0 exec api pip install requests  # Install package in API"
        exit 1
        ;;
esac