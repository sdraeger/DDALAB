#!/bin/bash

# Start the development environment with volumes
# Usage: ./scripts/dev.sh

set -e

echo "🚀 Starting services..."
docker-compose -f docker-compose.dev.yml up --build -d

echo ""
echo "✅ Services started successfully!"
