#!/bin/bash

# Script to run tests locally without CircleCI
# This mimics what CircleCI would do but runs on your local machine

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== DDALAB Local Test Runner ===${NC}"
echo ""
echo "Select what to test:"
echo "1. API (Python) tests"
echo "2. Web frontend tests"
echo "3. Web20 (Dashboard) tests"
echo "4. ConfigManager tests"
echo "5. All tests"
echo ""
read -p "Select option (1-5): " OPTION

# Function to run tests and capture results
run_tests() {
    local name=$1
    local command=$2
    echo -e "${YELLOW}Running $name tests...${NC}"
    if eval "$command"; then
        echo -e "${GREEN}✅ $name tests passed${NC}"
        return 0
    else
        echo -e "${RED}❌ $name tests failed${NC}"
        return 1
    fi
}

# Track overall success
FAILED=0

case $OPTION in
    1)
        run_tests "API" "cd packages/api && pytest" || FAILED=1
        ;;
    2)
        run_tests "Web frontend" "cd packages/web && npm test" || FAILED=1
        ;;
    3)
        run_tests "Web20 Dashboard" "cd packages/web20 && npm test" || FAILED=1
        ;;
    4)
        run_tests "ConfigManager" "cd packages/configmanager && npm test" || FAILED=1
        ;;
    5)
        echo -e "${BLUE}Running all tests...${NC}"
        run_tests "API" "cd packages/api && pytest" || FAILED=1
        run_tests "Web frontend" "cd packages/web && npm test -- --passWithNoTests" || FAILED=1
        run_tests "Web20 Dashboard" "cd packages/web20 && npm test -- --passWithNoTests" || FAILED=1
        run_tests "ConfigManager" "cd packages/configmanager && npm test" || FAILED=1
        ;;
    *)
        echo -e "${RED}Invalid option${NC}"
        exit 1
        ;;
esac

echo ""
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
else
    echo -e "${RED}💥 Some tests failed${NC}"
    exit 1
fi
