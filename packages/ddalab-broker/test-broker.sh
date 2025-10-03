#!/bin/bash
# Quick test script for DDALAB Sync Broker

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

BROKER_URL="http://localhost:8080"

echo -e "${BLUE}🧪 Testing DDALAB Sync Broker${NC}"
echo ""

# Test 1: Health Check
echo -e "${BLUE}1. Health check...${NC}"
HEALTH=$(curl -s ${BROKER_URL}/health)
if [ "$HEALTH" = "OK" ]; then
  echo -e "   ${GREEN}✅ Health check passed${NC}"
else
  echo -e "   ${RED}❌ Health check failed: $HEALTH${NC}"
  exit 1
fi

# Test 2: Database connectivity (via attempting to fetch non-existent share)
echo -e "${BLUE}2. Database connectivity...${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" ${BROKER_URL}/api/shares/nonexistent)
if [ "$HTTP_CODE" = "404" ]; then
  echo -e "   ${GREEN}✅ Database responding (404 for missing share is correct)${NC}"
else
  echo -e "   ${RED}❌ Unexpected HTTP code: $HTTP_CODE${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}✅ Basic tests passed!${NC}"
echo ""
echo -e "${BLUE}For WebSocket testing:${NC}"
echo "  1. Install websocat: brew install websocat"
echo "  2. Connect: websocat ws://localhost:8080/ws"
echo "  3. See TESTING.md for example messages"
echo ""
echo -e "${BLUE}To inspect database:${NC}"
echo "  docker exec -it ddalab-broker-postgres psql -U ddalab -d ddalab_broker"
