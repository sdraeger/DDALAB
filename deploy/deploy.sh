#!/bin/bash
# DDALAB Production Deployment Script
# This script handles deployment and updates without host config dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
ENV_FILE="${PROJECT_ROOT}/.env"
IMAGE_TAG="${DDALAB_IMAGE:-ddalab:latest}"

echo -e "${GREEN}=== DDALAB Deployment Script ===${NC}"

# Function to check prerequisites
check_prerequisites() {
    echo "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}Error: Docker Compose is not installed${NC}"
        exit 1
    fi
    
    # Check if .env exists
    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${YELLOW}Warning: .env file not found${NC}"
        echo "Creating from example..."
        if [ -f "${PROJECT_ROOT}/.env.production.example" ]; then
            cp "${PROJECT_ROOT}/.env.production.example" "$ENV_FILE"
            echo -e "${YELLOW}Please edit .env and update the values${NC}"
            exit 1
        else
            echo -e "${RED}Error: No .env.production.example found${NC}"
            exit 1
        fi
    fi
    
    echo -e "${GREEN}Prerequisites OK${NC}"
}

# Function to validate environment
validate_environment() {
    echo "Validating environment variables..."
    
    # Source the env file
    set -a
    source "$ENV_FILE"
    set +a
    
    # Check critical variables
    if [[ "$POSTGRES_PASSWORD" == "CHANGE_ME_STRONG_PASSWORD" ]] || [[ -z "$POSTGRES_PASSWORD" ]]; then
        echo -e "${RED}Error: POSTGRES_PASSWORD must be changed from default${NC}"
        exit 1
    fi
    
    if [[ "$MINIO_ROOT_PASSWORD" == "CHANGE_ME_STRONG_PASSWORD" ]] || [[ -z "$MINIO_ROOT_PASSWORD" ]]; then
        echo -e "${RED}Error: MINIO_ROOT_PASSWORD must be changed from default${NC}"
        exit 1
    fi
    
    if [[ "$DDALAB_JWT_SECRET" == "CHANGE_ME_RANDOM_STRING_AT_LEAST_32_CHARS_LONG" ]] || [[ -z "$DDALAB_JWT_SECRET" ]]; then
        echo -e "${RED}Error: DDALAB_JWT_SECRET must be changed from default${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Environment validation OK${NC}"
}

# Function to deploy services
deploy() {
    echo "Deploying DDALAB services..."
    
    # Pull latest images
    echo "Pulling latest images..."
    docker-compose -f "$COMPOSE_FILE" pull
    
    # Start services
    echo "Starting services..."
    docker-compose -f "$COMPOSE_FILE" up -d
    
    # Wait for services to be healthy
    echo "Waiting for services to be healthy..."
    sleep 10
    
    # Check service health
    if docker-compose -f "$COMPOSE_FILE" ps | grep -E "(Exit|unhealthy)"; then
        echo -e "${RED}Error: Some services are not healthy${NC}"
        docker-compose -f "$COMPOSE_FILE" ps
        exit 1
    fi
    
    echo -e "${GREEN}Deployment complete!${NC}"
}

# Function to update deployment
update() {
    echo "Updating DDALAB deployment..."
    
    # Pull new images
    echo "Pulling latest images..."
    docker-compose -f "$COMPOSE_FILE" pull
    
    # Recreate containers with new images
    echo "Recreating containers..."
    docker-compose -f "$COMPOSE_FILE" up -d --force-recreate
    
    echo -e "${GREEN}Update complete!${NC}"
}

# Function to show status
status() {
    echo "DDALAB Service Status:"
    docker-compose -f "$COMPOSE_FILE" ps
    echo ""
    echo "Container logs (last 20 lines):"
    docker-compose -f "$COMPOSE_FILE" logs --tail=20
}

# Function to stop services
stop() {
    echo "Stopping DDALAB services..."
    docker-compose -f "$COMPOSE_FILE" down
    echo -e "${GREEN}Services stopped${NC}"
}

# Function to clean up
cleanup() {
    echo -e "${YELLOW}Warning: This will remove all containers and volumes!${NC}"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker-compose -f "$COMPOSE_FILE" down -v
        echo -e "${GREEN}Cleanup complete${NC}"
    else
        echo "Cleanup cancelled"
    fi
}

# Function to backup data
backup() {
    BACKUP_DIR="${PROJECT_ROOT}/backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    echo "Creating backup in $BACKUP_DIR..."
    
    # Backup postgres
    echo "Backing up PostgreSQL..."
    docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_dumpall -U "${POSTGRES_USER:-ddalab}" > "$BACKUP_DIR/postgres_backup.sql"
    
    # Backup volumes
    echo "Backing up volumes..."
    for volume in postgres-data redis-data minio-data ddalab-data; do
        echo "  Backing up $volume..."
        docker run --rm -v ${volume}:/data -v "$BACKUP_DIR":/backup alpine tar -czf /backup/${volume}.tar.gz -C /data .
    done
    
    echo -e "${GREEN}Backup complete: $BACKUP_DIR${NC}"
}

# Main script logic
case "${1:-}" in
    deploy)
        check_prerequisites
        validate_environment
        deploy
        ;;
    update)
        check_prerequisites
        update
        ;;
    status)
        status
        ;;
    stop)
        stop
        ;;
    cleanup)
        cleanup
        ;;
    backup)
        backup
        ;;
    *)
        echo "Usage: $0 {deploy|update|status|stop|cleanup|backup}"
        echo ""
        echo "Commands:"
        echo "  deploy  - Deploy DDALAB for the first time"
        echo "  update  - Update to latest images"
        echo "  status  - Show service status"
        echo "  stop    - Stop all services"
        echo "  cleanup - Remove all containers and volumes (destructive!)"
        echo "  backup  - Backup databases and volumes"
        exit 1
        ;;
esac