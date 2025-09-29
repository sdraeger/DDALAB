#!/bin/bash
# Minimal development setup - just core services + API + Web20

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Minimal DDALAB Development Environment${NC}"
echo "This starts only: PostgreSQL, Redis, MinIO, API, and Web20"
echo ""

# Create a temporary docker-compose file with just the needed services
cat > docker-compose.minimal.yml << 'EOF'
services:
  redis:
    extends:
      file: docker-compose.dev.yml
      service: redis

  minio:
    extends:
      file: docker-compose.dev.yml
      service: minio

  postgres:
    extends:
      file: docker-compose.dev.yml
      service: postgres

  api:
    extends:
      file: docker-compose.dev.yml
      service: api

  web20:
    extends:
      file: docker-compose.dev.yml
      service: web20

volumes:
  postgres-data:
  redis-data:
  minio-data:

networks:
  internal:
    driver: bridge
EOF

case "${1:-up}" in
    up|start)
        docker compose -f docker-compose.minimal.yml up -d
        echo ""
        echo -e "${GREEN}✅ Minimal development environment started!${NC}"
        echo ""
        echo "Services:"
        echo "  📊 Web20: http://localhost:3000"
        echo "  🔌 API: http://localhost:8001"
        echo "  📚 API Docs: http://localhost:8001/docs"
        echo "  📦 MinIO: http://localhost:9001"
        ;;
    
    down|stop)
        docker compose -f docker-compose.minimal.yml down
        rm -f docker-compose.minimal.yml
        echo -e "${GREEN}✅ Services stopped${NC}"
        ;;
    
    *)
        echo "Usage: $0 [up|down]"
        ;;
esac