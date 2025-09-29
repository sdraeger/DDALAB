#!/bin/bash

# Test Docker build locally before pushing
# This helps catch issues before the CI/CD pipeline

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Testing DDALAB API Docker Build${NC}"
echo "================================="

# Build the Docker image
echo -e "${BLUE}Building Docker image...${NC}"
docker build -t ddalab-api:test .

# Check if build succeeded
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Docker build successful${NC}"
else
    echo -e "${RED}✗ Docker build failed${NC}"
    exit 1
fi

# Test running the container
echo -e "${BLUE}Testing container startup...${NC}"
docker run -d \
    --name ddalab-api-test \
    -p 8001:8000 \
    -e DATABASE_URL="postgresql://test:test@localhost:5432/test" \
    -e SECRET_KEY="test-secret-key" \
    -e MINIO_ENDPOINT="localhost:9000" \
    -e MINIO_ACCESS_KEY="minioadmin" \
    -e MINIO_SECRET_KEY="minioadmin" \
    ddalab-api:test

# Wait for container to start
echo -e "${BLUE}Waiting for container to be ready...${NC}"
sleep 5

# Check container status
if [ "$(docker ps -q -f name=ddalab-api-test)" ]; then
    echo -e "${GREEN}✓ Container is running${NC}"
    
    # Test health endpoint
    echo -e "${BLUE}Testing health endpoint...${NC}"
    if curl -f http://localhost:8001/health 2>/dev/null | grep -q "healthy"; then
        echo -e "${GREEN}✓ Health check passed${NC}"
    else
        echo -e "${RED}✗ Health check failed${NC}"
    fi
    
    # Show container logs
    echo -e "${BLUE}Container logs:${NC}"
    docker logs ddalab-api-test | tail -20
else
    echo -e "${RED}✗ Container failed to start${NC}"
    docker logs ddalab-api-test
fi

# Cleanup
echo -e "${BLUE}Cleaning up...${NC}"
docker stop ddalab-api-test 2>/dev/null || true
docker rm ddalab-api-test 2>/dev/null || true

echo -e "${GREEN}Docker build test complete!${NC}"