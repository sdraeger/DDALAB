#!/bin/bash
# DDALAB Monitoring Script
# Monitors service health and resource usage

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Function to check service health
check_health() {
    echo -e "${GREEN}=== DDALAB Service Health ===${NC}"
    echo ""
    
    # Get container status
    while IFS= read -r line; do
        if echo "$line" | grep -q "Up.*healthy"; then
            echo -e "${GREEN}✓${NC} $line"
        elif echo "$line" | grep -q "Up"; then
            echo -e "${YELLOW}⚡${NC} $line"
        else
            echo -e "${RED}✗${NC} $line"
        fi
    done < <(docker-compose -f "$COMPOSE_FILE" ps)
}

# Function to show resource usage
show_resources() {
    echo ""
    echo -e "${GREEN}=== Resource Usage ===${NC}"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" \
        $(docker-compose -f "$COMPOSE_FILE" ps -q)
}

# Function to check disk usage
check_disk() {
    echo ""
    echo -e "${GREEN}=== Disk Usage ===${NC}"
    
    # Check volume sizes
    for volume in postgres-data redis-data minio-data ddalab-data; do
        size=$(docker run --rm -v ${volume}:/data alpine du -sh /data 2>/dev/null | cut -f1 || echo "N/A")
        echo "  $volume: $size"
    done
}

# Function to show recent logs
show_logs() {
    echo ""
    echo -e "${GREEN}=== Recent Errors (last hour) ===${NC}"
    
    # Check each service for errors
    for service in ddalab postgres redis minio; do
        echo -e "\n${YELLOW}$service:${NC}"
        docker-compose -f "$COMPOSE_FILE" logs --since=1h "$service" 2>&1 | grep -i "error\|warning\|critical" | tail -5 || echo "  No recent errors"
    done
}

# Function to test endpoints
test_endpoints() {
    echo ""
    echo -e "${GREEN}=== Endpoint Tests ===${NC}"
    
    # Test web interface
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200\|301\|302"; then
        echo -e "  ${GREEN}✓${NC} Web interface: OK"
    else
        echo -e "  ${RED}✗${NC} Web interface: Failed"
    fi
    
    # Test API
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/health | grep -q "200"; then
        echo -e "  ${GREEN}✓${NC} API endpoint: OK"
    else
        echo -e "  ${RED}✗${NC} API endpoint: Failed"
    fi
    
    # Test MinIO
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:9001 | grep -q "200\|301\|302"; then
        echo -e "  ${GREEN}✓${NC} MinIO console: OK"
    else
        echo -e "  ${RED}✗${NC} MinIO console: Failed"
    fi
}

# Function for continuous monitoring
continuous_monitor() {
    while true; do
        clear
        echo -e "${GREEN}=== DDALAB Monitor ===${NC} $(date)"
        echo ""
        check_health
        show_resources
        check_disk
        test_endpoints
        
        echo ""
        echo "Press Ctrl+C to exit. Refreshing in 30 seconds..."
        sleep 30
    done
}

# Main logic
case "${1:-}" in
    health)
        check_health
        ;;
    resources)
        show_resources
        ;;
    disk)
        check_disk
        ;;
    logs)
        show_logs
        ;;
    endpoints)
        test_endpoints
        ;;
    continuous)
        continuous_monitor
        ;;
    *)
        # Default: show all
        check_health
        show_resources
        check_disk
        test_endpoints
        echo ""
        echo "Usage: $0 {health|resources|disk|logs|endpoints|continuous}"
        echo ""
        echo "Options:"
        echo "  health     - Check service health status"
        echo "  resources  - Show CPU/Memory usage"
        echo "  disk       - Show disk usage"
        echo "  logs       - Show recent errors"
        echo "  endpoints  - Test service endpoints"
        echo "  continuous - Continuous monitoring mode"
        ;;
esac