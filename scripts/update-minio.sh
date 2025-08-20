#!/bin/bash

# DDALAB MinIO Update Script
# This script updates MinIO to the latest version

set -e

echo "🔄 Updating MinIO to latest version..."

# Get the latest MinIO version
LATEST_VERSION=$(curl -s https://registry.hub.docker.com/v2/repositories/minio/minio/tags/ | jq -r '.results[] | select(.name | contains("RELEASE")) | .name' | head -1)

if [ -z "$LATEST_VERSION" ]; then
    echo "❌ Failed to get latest MinIO version"
    exit 1
fi

echo "📦 Latest MinIO version: $LATEST_VERSION"

# Update docker-compose files
echo "📝 Updating docker-compose files..."

# Update docker-compose.yml
sed -i.bak "s|minio/minio:RELEASE\.[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9]\{2\}-[0-9]\{2\}-[0-9]\{2\}Z|minio/minio:$LATEST_VERSION|g" docker-compose.yml

# Update docker-compose.dev.yml
sed -i.bak "s|minio/minio:RELEASE\.[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9]\{2\}-[0-9]\{2\}-[0-9]\{2\}Z|minio/minio:$LATEST_VERSION|g" docker-compose.dev.yml

echo "✅ Updated MinIO version to $LATEST_VERSION"

# Pull the new image
echo "📥 Pulling new MinIO image..."
docker pull minio/minio:$LATEST_VERSION

echo "🔄 Restarting MinIO service..."
docker-compose stop minio
docker-compose up -d minio

echo "✅ MinIO update completed!"
echo "📊 Check MinIO logs: docker-compose logs minio" 