#!/bin/bash
# Simple DDALAB Docker Swarm Deployment

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🚀 DDALAB Simple Docker Swarm Deployment${NC}"
echo

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "Please copy .env.example to .env and customize it:"
    echo "  cp .env.example .env"
    echo "  # Edit .env with your domain names and passwords"
    exit 1
fi

echo "✅ Found .env configuration file"

# Check if running as swarm manager
if ! docker info | grep -q "Swarm: active"; then
    echo -e "${YELLOW}Docker Swarm is not initialized. Initializing now...${NC}"
    docker swarm init
    echo
fi

# Create external network if it doesn't exist
echo "Creating traefik_public network..."
docker network create --driver overlay --attachable traefik_public 2>/dev/null || true

# Deploy the stack
echo
echo "Deploying DDALAB stack..."
docker stack deploy -c docker-stack.yml ddalab --with-registry-auth

echo
echo -e "${GREEN}✅ Deployment initiated!${NC}"
echo
echo "Monitor deployment status:"
echo "  docker stack ps ddalab"
echo "  docker service ls"
echo
echo "View logs:"
echo "  docker service logs -f ddalab_ddalab"
echo
echo "Your DDALAB instance will be available at:"
echo "  Application: https://$(grep APP_HOST .env | cut -d'=' -f2)"
echo "  API: https://$(grep API_HOST .env | cut -d'=' -f2)"
echo "  MinIO Console: https://$(grep MINIO_HOST .env | cut -d'=' -f2)"
echo
echo -e "${YELLOW}Note: SSL certificates may take a few minutes to provision.${NC}"
echo "Initial deployment takes 2-5 minutes for all services to be ready."

# Show next steps
echo
echo "Next steps:"
echo "1. Update your DNS records to point to this server"
echo "2. Wait for SSL certificates to provision"
echo "3. Access your DDALAB instance"
echo
echo "To remove the deployment:"
echo "  docker stack rm ddalab"
