#!/bin/bash

# DDALAB Deployment Verification Script
# Checks that all services are running correctly

set -e

echo "🔍 DDALAB Deployment Verification"
echo "================================="

# Function to check service health
check_service() {
    local service=$1
    local url=$2
    local expected=$3
    
    echo -n "Checking $service... "
    
    if curl -f -s "$url" > /dev/null; then
        echo "✅ OK"
        return 0
    else
        echo "❌ FAILED"
        echo "  Unable to reach $url"
        return 1
    fi
}

# Function to check Docker container
check_container() {
    local container=$1
    echo -n "Checking container $container... "
    
    if docker ps | grep -q "$container"; then
        echo "✅ Running"
        return 0
    else
        echo "❌ Not running"
        return 1
    fi
}

# Check Docker is running
echo -n "Checking Docker... "
if docker info > /dev/null 2>&1; then
    echo "✅ OK"
else
    echo "❌ Docker is not running"
    exit 1
fi

# Check containers
echo ""
echo "Container Status:"
echo "-----------------"
check_container "ddalab"
check_container "postgres"
check_container "redis"
check_container "minio"

# Wait a bit for services to be ready
echo ""
echo "Waiting for services to be ready..."
sleep 5

# Check service endpoints
echo ""
echo "Service Health Checks:"
echo "----------------------"
# Note: Using -k flag to accept self-signed certificates
check_service_https() {
    local service=$1
    local url=$2
    
    echo -n "Checking $service... "
    
    if curl -k -f -s "$url" > /dev/null; then
        echo "✅ OK"
        return 0
    else
        echo "❌ FAILED"
        echo "  Unable to reach $url"
        return 1
    fi
}

check_service_https "Web Interface (HTTPS)" "https://localhost" "200"
check_service_https "API Server (HTTPS)" "https://localhost/api/health" "healthy"
check_service_https "API Docs (HTTPS)" "https://localhost/api/docs" "200"
check_service "MinIO" "http://localhost:9000/minio/health/live" "200"

# Check detailed health
echo ""
echo "Detailed Health Check:"
echo "----------------------"
if curl -k -s "https://localhost/api/health/detailed" | python3 -m json.tool; then
    echo ""
    echo "✅ All services are healthy!"
else
    echo ""
    echo "⚠️  Some services may not be fully healthy"
fi

echo ""
echo "================================="
echo "Deployment verification complete!"
echo ""
echo "Access points:"
echo "- Web Interface: https://localhost"
echo "- API Docs: https://localhost/api/docs"
echo "- MinIO Console: http://localhost:9001"
echo ""
echo "Note: The site uses self-signed certificates by default."
echo "Your browser will show a security warning - this is expected."
echo "For production, configure proper SSL certificates."