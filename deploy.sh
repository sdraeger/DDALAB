#!/bin/bash

# DDALAB Deployment Script
# Validates configuration and deploys services based on environment

set -e

ENVIRONMENT="${1:-development}"
MODE="${2:-local}"

echo "🚀 Deploying DDALAB ($ENVIRONMENT - $MODE)"
echo "================================================"

echo "🔍 Validating configuration..."
npm run config:validate

if [ $? -ne 0 ]; then
    echo "❌ Configuration validation failed"
    exit 1
fi

echo "✅ Deployment configuration is valid"

# For local development mode
if [ "$MODE" = "local" ]; then
    echo "🏠 Starting local development services..."
    
    # Start core services only (no web/api containers)
    docker-compose -f docker-compose.dev.yml up redis postgres minio traefik -d
    
    echo "✅ Core services started"
    echo ""
    echo "📋 Next steps:"
    echo "   • Run API: cd packages/api && ./start.sh"
    echo "   • Run Web: cd packages/web20 && npm run dev"
    echo "   • Or run both: npm run dev:local:concurrent"
    echo ""
    echo "🌐 Services:"
    echo "   • API will be: http://localhost:8001"
    echo "   • Web will be: http://localhost:3000"
    echo "   • MinIO: http://localhost:9001"
    echo "   • PostgreSQL: localhost:5432"
    echo "   • Redis: localhost:6379"
    
elif [ "$MODE" = "docker" ]; then
    echo "🐳 Starting Docker Compose services..."
    docker-compose up --build -d
    
    echo "✅ All services started"
    echo ""
    echo "🌐 Access points:"
    echo "   • Web Interface: https://localhost"
    echo "   • API: https://localhost/api"
    echo "   • Traefik Dashboard: http://localhost:8080"
    
else
    echo "❌ Unknown deployment mode: $MODE"
    echo "Available modes: local, docker"
    exit 1
fi

echo ""
echo "🎉 DDALAB deployment completed!"
