#!/bin/bash

# Convenience script to generate volumes and start services
# Usage: ./scripts/start-with-volumes.sh

set -e

echo "🔧 Generating volume configuration from DDALAB_ALLOWED_DIRS..."
./scripts/generate-volumes.sh

echo ""
echo "🚀 Starting services with generated volume configuration..."
docker-compose -f docker-compose.yml -f docker-compose.volumes.yml up --build -d

echo ""
echo "✅ Services started successfully!"
echo "📁 Volume mounts generated from DDALAB_ALLOWED_DIRS in .env file"
