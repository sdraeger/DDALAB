#!/bin/bash
# Local development script - alternative to concurrently

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting DDALAB Local Development${NC}"
echo ""

# Check if core services are running
echo "Checking for core services (PostgreSQL, Redis, MinIO)..."

# Function to check if service is running
check_service_port() {
    local port=$1
    local service_name=$2
    if ! nc -z localhost $port 2>/dev/null; then
        echo -e "${YELLOW}⚠️  $service_name (port $port) is not running${NC}"
        return 1
    else
        echo -e "${GREEN}✓ $service_name is running${NC}"
        return 0
    fi
}

SERVICES_OK=true
check_service_port 5432 "PostgreSQL" || SERVICES_OK=false
check_service_port 6379 "Redis" || SERVICES_OK=false  
check_service_port 9000 "MinIO" || SERVICES_OK=false

if [ "$SERVICES_OK" = "false" ]; then
    echo ""
    echo -e "${RED}❌ Required services are not running!${NC}"
    echo ""
    if [ "$1" = "--start-services" ] || [ "$1" = "-s" ]; then
        echo "Starting core services with Docker..."
        docker compose -f docker-compose.dev.yml up -d postgres redis minio
        echo "Waiting for services to be ready..."
        sleep 5
        
        # Check again
        SERVICES_OK=true
        check_service_port 5432 "PostgreSQL" || SERVICES_OK=false
        check_service_port 6379 "Redis" || SERVICES_OK=false  
        check_service_port 9000 "MinIO" || SERVICES_OK=false
        
        if [ "$SERVICES_OK" = "false" ]; then
            echo -e "${RED}❌ Services failed to start properly${NC}"
            exit 1
        fi
    else
        echo "Options:"
        echo "1. Start core services manually:"
        echo "   ./scripts/docker-profiles.sh core"
        echo ""
        echo "2. Start services automatically:"
        echo "   npm run dev:local -- --start-services"
        echo "   # OR"
        echo "   ./scripts/dev-local.sh --start-services"
        echo ""
        exit 1
    fi
fi

echo ""

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Stopping services...${NC}"
    if [ ! -z "$API_PID" ] && kill -0 $API_PID 2>/dev/null; then
        kill $API_PID
        echo "✓ API server stopped"
    fi
    if [ ! -z "$WEB20_PID" ] && kill -0 $WEB20_PID 2>/dev/null; then
        kill $WEB20_PID
        echo "✓ Web20 server stopped"
    fi
    exit 0
}

# Trap Ctrl+C
trap cleanup INT

# Check if required directories exist
if [ ! -d "packages/api" ]; then
    echo -e "${RED}Error: packages/api directory not found${NC}"
    exit 1
fi

if [ ! -d "packages/web20" ]; then
    echo -e "${RED}Error: packages/web20 directory not found${NC}"
    exit 1
fi

# Check if start.sh exists
if [ ! -f "packages/api/start.sh" ]; then
    echo -e "${RED}Error: packages/api/start.sh not found${NC}"
    exit 1
fi

# Make sure start.sh is executable
chmod +x packages/api/start.sh

# Check if Python virtual environment exists
./scripts/check-python-env.sh

echo "Starting API server..."
cd packages/api
./start.sh &
API_PID=$!
cd ../..

# Give API server a moment to start
sleep 2

echo "Starting Web20 dashboard..."
cd packages/web20
npm run dev &
WEB20_PID=$!
cd ../..

echo ""
echo -e "${GREEN}✅ Both services started!${NC}"
echo ""
echo "Services:"
echo "  📊 Web20 Dashboard: http://localhost:3000"
echo "  🔌 API Server: http://localhost:8001"
echo "  📚 API Docs: http://localhost:8001/docs"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop both services${NC}"
echo ""
echo "Logs will appear below:"
echo "----------------------------------------"

# Wait for both processes
wait