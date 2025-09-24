#!/bin/bash

# Start DDALAB API server and Tauri Desktop App together

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 DDALAB Desktop App with API Server${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"
    pkill -f "next dev" 2>/dev/null || true
    pkill -f "tauri dev" 2>/dev/null || true
    echo -e "${GREEN}✅ Cleanup complete${NC}"
    exit 0
}

# Set trap to cleanup on script exit
trap cleanup INT TERM EXIT

# Start API server
echo -e "${YELLOW}🔧 Starting DDALAB API Server...${NC}"
if ! ../../scripts/start-api-only.sh up; then
    echo -e "${RED}❌ Failed to start API server${NC}"
    exit 1
fi

echo -e "${GREEN}✅ API Server is running at http://localhost:8000${NC}"
echo ""

# Wait a moment for API to fully initialize
echo -e "${YELLOW}⏳ Waiting for API to be fully ready...${NC}"
sleep 3

# Test API connection
if curl -s http://localhost:8000/health > /dev/null; then
    echo -e "${GREEN}✅ API server is responding${NC}"
else
    echo -e "${RED}❌ API server is not responding. Check the logs.${NC}"
    echo "View logs with: ../../scripts/start-api-only.sh logs"
    exit 1
fi

echo ""

# Start Next.js dev server in background on port 3003
echo -e "${YELLOW}📱 Starting Next.js development server on port 3003...${NC}"
PORT=3003 npm run dev &
NEXTJS_PID=$!

# Wait for Next.js to be ready
echo -e "${YELLOW}⏳ Waiting for Next.js server to start...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:3003 > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Next.js server is ready at http://localhost:3003${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Next.js server failed to start after 30 seconds${NC}"
        exit 1
    fi
    sleep 1
done

echo ""

# Display connection info
echo -e "${GREEN}🎉 All services are ready!${NC}"
echo ""
echo -e "${YELLOW}Service Status:${NC}"
echo -e "  🌐 API Server: ${BLUE}http://localhost:8000${NC} ${GREEN}✓${NC}"
echo -e "  📱 Next.js: ${BLUE}http://localhost:3003${NC} ${GREEN}✓${NC}"
echo ""
echo -e "${YELLOW}Starting Tauri Desktop Application...${NC}"
echo ""

# Start Tauri desktop app
npm run tauri:dev

# If we get here, user closed the desktop app
echo -e "\n${GREEN}👋 DDALAB Desktop Application closed${NC}"

# Stop API server
echo -e "${YELLOW}🛑 Stopping API server...${NC}"
../../scripts/start-api-only.sh down

echo -e "${GREEN}✅ All services stopped${NC}"