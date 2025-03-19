#!/bin/bash
# Script to run signup integration tests

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Running signup integration tests${NC}"

# First run regular integration tests with mocks
echo -e "${YELLOW}Running mock tests...${NC}"
set +e  # Don't exit on errors
python -m pytest tests/integration/test_signup_directus_integration.py -v
MOCK_RESULT=$?
set -e  # Exit on errors again

# Check if mock tests passed
if [ $MOCK_RESULT -eq 0 ]; then
    echo -e "${GREEN}Mock tests passed!${NC}"
    
    echo -e "${YELLOW}Checking if Docker is available...${NC}"
    # First check if docker-py is installed
    python -c "import docker" 2>/dev/null
    if [ $? -ne 0 ]; then
        echo -e "${YELLOW}Docker Python library not found, installing...${NC}"
        pip install docker
    fi
    
    # Then check if Docker is running
    docker info &>/dev/null
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Docker is available${NC}"
        
        echo -e "${YELLOW}Running real integration tests with Directus...${NC}"
        set +e  # Don't exit on errors
        python -m pytest tests/integration/test_signup_directus_real_integration.py -v
        REAL_RESULT=$?
        set -e  # Exit on errors again
        
        if [ $REAL_RESULT -eq 0 ]; then
            echo -e "${GREEN}All tests passed!${NC}"
            exit 0
        else
            echo -e "${RED}Real integration tests failed${NC}"
            echo -e "${YELLOW}This may be because Docker is not properly configured or the test requirements aren't fully met.${NC}"
            echo -e "${YELLOW}You can still consider the code functional if the mock tests pass.${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}Docker is not running or not available, skipping real integration tests${NC}"
        echo -e "${GREEN}All available tests passed!${NC}"
        exit 0
    fi
else
    echo -e "${RED}Mock tests failed${NC}"
    exit 1
fi 