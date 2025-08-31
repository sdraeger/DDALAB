#!/bin/bash

# Script to trigger specific CircleCI workflows without pushing
# This creates a temporary commit and triggers via API, then removes the commit

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Check for CircleCI token
if [ -z "$CIRCLECI_TOKEN" ]; then
    echo -e "${RED}Error: CIRCLECI_TOKEN environment variable is not set${NC}"
    echo "Please set it with: export CIRCLECI_TOKEN=your-token-here"
    echo "Get your token from: https://app.circleci.com/settings/user/tokens"
    exit 1
fi

# Show available options
echo "CircleCI Pipeline Trigger Options:"
echo "1. Run all tests (Windows, Linux, macOS)"
echo "2. Run Windows tests only"
echo "3. Run Linux tests only"
echo "4. Run macOS tests only"
echo "5. Run full build pipeline (tests + builds)"
echo ""
read -p "Select option (1-5): " OPTION

# Validate input
if [[ ! "$OPTION" =~ ^[1-5]$ ]]; then
    echo -e "${RED}Invalid option. Please select 1-5.${NC}"
    exit 1
fi

# Get project information
REMOTE_URL=$(git config --get remote.origin.url)
if [[ $REMOTE_URL == git@github.com:* ]]; then
    PROJECT_SLUG=$(echo $REMOTE_URL | sed 's/git@github.com:/github\//' | sed 's/\.git$//')
elif [[ $REMOTE_URL == https://github.com/* ]]; then
    PROJECT_SLUG=$(echo $REMOTE_URL | sed 's/https:\/\/github.com\//github\//' | sed 's/\.git$//')
else
    echo -e "${RED}Error: Could not determine project slug from git remote${NC}"
    exit 1
fi

BRANCH=$(git branch --show-current)

# Create parameters based on selection
case $OPTION in
    1)
        PARAMS='{"run_all_tests": true}'
        DESC="all tests"
        ;;
    2)
        PARAMS='{"run_windows_test": true}'
        DESC="Windows tests"
        ;;
    3)
        PARAMS='{"run_linux_test": true}'
        DESC="Linux tests"
        ;;
    4)
        PARAMS='{"run_macos_test": true}'
        DESC="macOS tests"
        ;;
    5)
        PARAMS='{"run_all": true}'
        DESC="full build pipeline"
        ;;
esac

echo -e "${YELLOW}Triggering $DESC on branch: $BRANCH${NC}"

# Method 1: Try to use pipeline parameters (if your config supports them)
echo "Attempting to trigger with parameters..."
RESPONSE=$(curl -s -X POST \
  "https://circleci.com/api/v2/project/$PROJECT_SLUG/pipeline" \
  -H "Circle-Token: $CIRCLECI_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"branch\":\"$BRANCH\", \"parameters\": $PARAMS}")

if echo "$RESPONSE" | grep -q "id"; then
    PIPELINE_NUMBER=$(echo "$RESPONSE" | grep -o '"number":[0-9]*' | sed 's/"number":\([0-9]*\)/\1/')
    echo -e "${GREEN}✅ Pipeline triggered successfully!${NC}"
    echo "Pipeline Number: $PIPELINE_NUMBER"
    echo "View at: https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER"
else
    echo -e "${YELLOW}Note: Pipeline parameters might not be configured.${NC}"
    echo -e "${YELLOW}Triggering standard pipeline...${NC}"

    # Method 2: Trigger standard pipeline
    RESPONSE=$(curl -s -X POST \
      "https://circleci.com/api/v2/project/$PROJECT_SLUG/pipeline" \
      -H "Circle-Token: $CIRCLECI_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"branch\":\"$BRANCH\"}")

    if echo "$RESPONSE" | grep -q "id"; then
        PIPELINE_NUMBER=$(echo "$RESPONSE" | grep -o '"number":[0-9]*' | sed 's/"number":\([0-9]*\)/\1/')
        echo -e "${GREEN}✅ Pipeline triggered successfully!${NC}"
        echo "Pipeline Number: $PIPELINE_NUMBER"
        echo "View at: https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER"
        echo -e "${YELLOW}Note: This will run all workflows defined for the branch.${NC}"
    else
        echo -e "${RED}❌ Failed to trigger pipeline${NC}"
        echo "Response: $RESPONSE"
        exit 1
    fi
fi
