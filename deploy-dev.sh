#!/bin/bash
# DDALAB Development Stack Deployment
# Deploys infrastructure services only - run API and Web20 locally

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🛠️  DDALAB Development Stack Deployment${NC}"
echo
echo "This deploys infrastructure services (PostgreSQL, Redis, MinIO, Traefik, Monitoring)"
echo "You can then run API and Web20 locally for fast development iteration."
echo

# Check if .env.dev exists
if [ ! -f .env.dev ]; then
    echo -e "${RED}❌ .env.dev not found!${NC}"
    echo "The development environment file .env.dev is required."
    echo "This file should already exist for development setup."
    echo -e "${YELLOW}If you need to create it, it should contain development-specific configuration.${NC}"
    exit 1
fi

# Load environment variables
if [ -f .env.dev ]; then
    echo "✅ Loading development configuration from .env.dev"
    export $(cat .env.dev | grep -v '^#' | xargs)
else
    echo -e "${YELLOW}Using default development configuration${NC}"
fi

# Check if running as swarm manager
if ! docker info | grep -q "Swarm: active"; then
    echo -e "${YELLOW}Docker Swarm is not initialized. Initializing now...${NC}"
    docker swarm init
    echo
fi

# Create external network if it doesn't exist
echo "Creating traefik_public network..."
docker network create --driver overlay --attachable traefik_public 2>/dev/null || true

# Create Prometheus configuration for development
echo "Creating development Prometheus configuration..."
cat > /tmp/prometheus-dev.yml <<EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'ddalab-local-api'
    static_configs:
      - targets: ['host.docker.internal:8001', 'host.docker.internal:8002']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'traefik'
    static_configs:
      - targets: ['traefik:8080']

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres:5432']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']

  - job_name: 'minio'
    static_configs:
      - targets: ['minio:9000']
EOF

# Create or update Prometheus config
if docker config ls | grep -q "prometheus_dev_config"; then
    docker config rm prometheus_dev_config 2>/dev/null || true
fi
docker config create prometheus_dev_config /tmp/prometheus-dev.yml
rm /tmp/prometheus-dev.yml
echo -e "${GREEN}✓${NC} Created development Prometheus configuration"

# Deploy the development stack
echo
echo "Deploying development infrastructure stack..."
docker stack deploy -c docker-stack.dev.yml ddalab-dev --with-registry-auth

echo
echo -e "${GREEN}✅ Development infrastructure deployed!${NC}"
echo
echo -e "${BLUE}Infrastructure Services:${NC}"
echo "  PostgreSQL:     localhost:5432"
echo "  Redis:          localhost:6379"
echo "  MinIO API:      localhost:9000"
echo "  MinIO Console:  localhost:9001"
echo "  Prometheus:     localhost:9090"
echo "  Grafana:        localhost:3001"
echo "  Traefik Dashboard: localhost:8080"
echo
echo -e "${BLUE}Next Steps - Run Local Services:${NC}"
echo
echo "1. 🐍 Start the API server:"
echo "   cd packages/api"
echo "   export \$(cat ../../.env.dev | grep -v '^#' | xargs)"
echo "   python -m main"
echo "   # API will be available at http://localhost:8001"
echo
echo "2. ⚛️  Start the Web20 frontend:"
echo "   cd packages/web20"
echo "   export \$(cat ../../.env.dev | grep -v '^#' | xargs)"
echo "   npm run dev"
echo "   # Web app will be available at http://localhost:3000"
echo
echo -e "${BLUE}Development URLs:${NC}"
echo "  App:            http://localhost:3000"
echo "  API:            http://localhost:8001"
echo "  API Docs:       http://localhost:8001/docs"
echo "  MinIO Console:  http://localhost:9001 (admin/admin)"
echo "  Grafana:        http://localhost:3001 (admin/admin)"
echo "  Prometheus:     http://localhost:9090"
echo
echo -e "${BLUE}Monitoring Stack Status:${NC}"
echo "  docker stack ps ddalab-dev"
echo "  docker service ls"
echo
echo -e "${BLUE}View Logs:${NC}"
echo "  docker service logs -f ddalab-dev_postgres"
echo "  docker service logs -f ddalab-dev_redis"
echo "  docker service logs -f ddalab-dev_minio"
echo
echo -e "${BLUE}Stop Development Stack:${NC}"
echo "  docker stack rm ddalab-dev"
echo
echo -e "${YELLOW}💡 Pro Tip: Use .env.dev to configure all connection settings!${NC}"