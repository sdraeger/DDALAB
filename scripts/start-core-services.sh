#!/bin/bash
# Manage core services (PostgreSQL, Redis, MinIO) for local development

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

case "${1:-start}" in
    start|up)
        echo -e "${GREEN}🐳 Starting core services (PostgreSQL, Redis, MinIO)${NC}"
        docker compose -f docker-compose.dev.yml up -d postgres redis minio
        echo ""
        echo "Waiting for services to be ready..."
        sleep 5
        echo -e "${GREEN}✅ Core services started${NC}"
        echo ""
        echo "Services:"
        echo "  📊 PostgreSQL: localhost:5432"
        echo "  🔄 Redis: localhost:6379" 
        echo "  📦 MinIO: localhost:9000 (console: localhost:9001)"
        ;;
    
    stop|down)
        echo -e "${YELLOW}Stopping core services...${NC}"
        docker compose -f docker-compose.dev.yml stop postgres redis minio
        echo -e "${GREEN}✅ Core services stopped${NC}"
        ;;
    
    status|ps)
        docker compose -f docker-compose.dev.yml ps postgres redis minio
        ;;
    
    logs)
        docker compose -f docker-compose.dev.yml logs -f postgres redis minio
        ;;
    
    *)
        echo "Usage: $0 [start|stop|status|logs]"
        echo ""
        echo "Commands:"
        echo "  start   Start PostgreSQL, Redis, and MinIO"
        echo "  stop    Stop all core services"
        echo "  status  Show service status"
        echo "  logs    Show service logs"
        ;;
esac