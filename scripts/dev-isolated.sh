#!/bin/bash
# Isolated Development Environment Script
# Provides a completely isolated DDALAB environment with no external dependencies

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

echo -e "${BLUE}🔒 DDALAB Isolated Development Environment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
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
display_status() {
    echo -e "\n${GREEN}✅ Isolated environment is running!${NC}\n"
    echo -e "${YELLOW}Service URLs:${NC}"
    echo -e "  🌐 DDALAB Application (Web20): ${BLUE}http://localhost:3002${NC}"
    echo -e "  🩺 Clinical Dashboard (Web30): ${BLUE}http://localhost:3002/web30${NC}"
    echo -e "  📚 API Docs: ${BLUE}http://localhost:3002/docs${NC}"
    echo -e "  📦 MinIO Console: ${BLUE}http://localhost:9003${NC}"
    echo ""
    echo -e "${YELLOW}Direct Access (for debugging):${NC}"
    echo -e "  🌐 Web20 Direct: ${BLUE}http://localhost:3000${NC}"
    echo -e "  🩺 Web30 Direct: ${BLUE}http://localhost:3001${NC}"
    echo ""
    echo -e "${YELLOW}Architecture:${NC}"
    echo -e "  Traefik routes to single container running both web servers:"
    echo -e "  - Frontend routes: / → port 3000 (Web20)"
    echo -e "  - Clinical routes: /web30/* → port 3001 (Web30, prefix stripped)"
    echo -e "  - API routes: /api-backend/* → /api/*"
    echo -e "  - Traefik Dashboard: http://localhost:8081"
    echo ""
    echo -e "${YELLOW}Database Connection (external):${NC}"
    echo -e "  Host: localhost"
    echo -e "  Port: 5433"
    echo -e "  User: ddalab_dev"
    echo -e "  Password: isolated_dev_pass"
    echo -e "  Database: ddalab_isolated"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo -e "  View logs: ${BLUE}docker compose -f docker-compose.isolated-dev.yml logs -f [service]${NC}"
    echo -e "  Stop: ${BLUE}$0 down${NC}"
    echo -e "  Restart: ${BLUE}$0 restart${NC}"
    echo ""
}

# Function to wait for services
wait_for_services() {
    echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"
    
    # Wait for PostgreSQL
    echo -n "  PostgreSQL..."
    while ! docker compose -f "$PROJECT_ROOT/docker-compose.isolated-dev.yml" exec -T postgres-dev pg_isready -U ddalab_dev >/dev/null 2>&1; do
        sleep 1
        echo -n "."
    done
    echo -e " ${GREEN}✓${NC}"
    
    # Wait for nginx/frontend
    echo -n "  DDALAB Application..."
    while ! curl -s http://localhost:3002 >/dev/null 2>&1; do
        sleep 1
        echo -n "."
    done
    echo -e " ${GREEN}✓${NC}"
    
    # Wait for API through nginx
    echo -n "  API Server..."
    while ! curl -s http://localhost:3002/api-backend/health >/dev/null 2>&1; do
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
        
        for port in 3000 3001 3002 5433 6380 8081 9002 9003; do
            if check_port $port; then
                echo -e "  ${RED}✗ Port $port is already in use${NC}"
                conflicts=$((conflicts + 1))
            fi
        done
        
        if [ $conflicts -gt 0 ]; then
            echo -e "\n${RED}Error: Port conflicts detected!${NC}"
            echo "Please stop conflicting services or use 'docker compose down' to stop other DDALAB instances."
            exit 1
        fi
        
        # Build images if needed
        echo -e "\n${YELLOW}Building development images...${NC}"
        docker compose -f "$PROJECT_ROOT/docker-compose.isolated-dev.yml" build
        
        # Start services
        echo -e "\n${YELLOW}Starting isolated services...${NC}"
        docker compose -f "$PROJECT_ROOT/docker-compose.isolated-dev.yml" up -d
        
        # Wait for services to be ready
        wait_for_services
        
        # Display status
        display_status
        ;;
    
    down|stop)
        echo -e "${YELLOW}Stopping isolated environment...${NC}"
        docker compose -f "$PROJECT_ROOT/docker-compose.isolated-dev.yml" down
        echo -e "${GREEN}✅ Isolated environment stopped${NC}"
        ;;
    
    restart)
        echo -e "${YELLOW}Restarting isolated environment...${NC}"
        docker compose -f "$PROJECT_ROOT/docker-compose.isolated-dev.yml" restart
        wait_for_services
        display_status
        ;;
    
    logs)
        shift
        docker compose -f "$PROJECT_ROOT/docker-compose.isolated-dev.yml" logs -f "$@"
        ;;
    
    status)
        docker compose -f "$PROJECT_ROOT/docker-compose.isolated-dev.yml" ps
        ;;
    
    clean)
        echo -e "${RED}⚠️  This will remove all isolated environment data!${NC}"
        read -p "Are you sure? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker compose -f "$PROJECT_ROOT/docker-compose.isolated-dev.yml" down -v
            echo -e "${GREEN}✅ Isolated environment cleaned${NC}"
        fi
        ;;
    
    shell)
        service="${2:-api-dev}"
        docker compose -f "$PROJECT_ROOT/docker-compose.isolated-dev.yml" exec "$service" /bin/sh
        ;;
    
    *)
        echo "Usage: $0 {up|down|restart|logs|status|clean|shell} [service]"
        echo ""
        echo "Commands:"
        echo "  up/start  - Start the isolated development environment"
        echo "  down/stop - Stop the isolated development environment"
        echo "  restart   - Restart all services"
        echo "  logs      - View logs (optionally specify service)"
        echo "  status    - Show service status"
        echo "  clean     - Remove all data and volumes"
        echo "  shell     - Open shell in a service container"
        ;;
esac