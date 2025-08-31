#!/bin/bash

# Script to test local changes on CircleCI without affecting main branches
# This creates a temporary branch, pushes it, triggers CircleCI, then cleans up

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Check for CircleCI token
if [ -z "$CIRCLECI_TOKEN" ]; then
    echo -e "${RED}Error: CIRCLECI_TOKEN not set${NC}"
    echo "Get token from: https://app.circleci.com/settings/user/tokens"
    exit 1
fi

# Configuration
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
TEMP_BRANCH="ci-test-$TIMESTAMP"
CURRENT_BRANCH=$(git branch --show-current)

# Get repository info
REMOTE_URL=$(git remote get-url origin)
if [[ $REMOTE_URL == git@github.com:* ]]; then
    PROJECT_SLUG=$(echo $REMOTE_URL | sed 's/git@github.com:/github\//' | sed 's/\.git$//')
elif [[ $REMOTE_URL == https://github.com/* ]]; then
    PROJECT_SLUG=$(echo $REMOTE_URL | sed 's/https:\/\/github.com\//github\//' | sed 's/\.git$//')
fi

echo -e "${CYAN}CircleCI Local State Tester${NC}"
echo "============================"
echo "This will test your local changes on CircleCI by:"
echo "1. Creating a temporary branch with your current changes"
echo "2. Pushing it to GitHub"
echo "3. Triggering CircleCI pipeline"
echo "4. Optionally cleaning up the temporary branch"
echo ""
echo -e "${YELLOW}Current branch: $CURRENT_BRANCH${NC}"
echo -e "${YELLOW}Temporary branch: $TEMP_BRANCH${NC}"
echo ""

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}You have uncommitted changes:${NC}"
    git status -s
    echo ""
    read -p "Include these changes in the test? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        INCLUDE_UNCOMMITTED=true
    else
        INCLUDE_UNCOMMITTED=false
    fi
else
    INCLUDE_UNCOMMITTED=false
fi

# Function to cleanup
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"

    # Return to original branch
    git checkout $CURRENT_BRANCH 2>/dev/null

    # Delete local temp branch
    git branch -D $TEMP_BRANCH 2>/dev/null

    # Optionally delete remote branch
    read -p "Delete remote temporary branch? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push origin --delete $TEMP_BRANCH 2>/dev/null
        echo -e "${GREEN}Remote branch deleted${NC}"
    else
        echo -e "${YELLOW}Remote branch kept: $TEMP_BRANCH${NC}"
        echo "To delete later: git push origin --delete $TEMP_BRANCH"
    fi
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Create temporary branch
echo -e "\n${BLUE}Creating temporary branch...${NC}"
git checkout -b $TEMP_BRANCH

# If including uncommitted changes, commit them
if [ "$INCLUDE_UNCOMMITTED" = true ]; then
    echo -e "${BLUE}Committing local changes...${NC}"
    git add -A
    git commit -m "CI Test: Local changes for testing [skip ci]" --no-verify || true

    # Remove [skip ci] from commit message to ensure CI runs
    git commit --amend -m "CI Test: Local changes for testing" --no-verify
fi

# Push the temporary branch
echo -e "\n${BLUE}Pushing temporary branch to GitHub...${NC}"
git push -u origin $TEMP_BRANCH

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to push branch${NC}"
    exit 1
fi

# Wait a moment for GitHub to process
sleep 2

# Trigger CircleCI pipeline
echo -e "\n${BLUE}Triggering CircleCI pipeline...${NC}"
RESPONSE=$(curl -s -X POST \
  "https://circleci.com/api/v2/project/$PROJECT_SLUG/pipeline" \
  -H "Circle-Token: $CIRCLECI_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"branch\":\"$TEMP_BRANCH\"}")

PIPELINE_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*"' | sed 's/"id":"\([^"]*\)"/\1/')
PIPELINE_NUMBER=$(echo $RESPONSE | grep -o '"number":[0-9]*' | sed 's/"number":\([0-9]*\)/\1/')

if [ -z "$PIPELINE_ID" ]; then
    echo -e "${RED}Failed to trigger pipeline${NC}"
    echo "$RESPONSE"
    exit 1
fi

echo -e "${GREEN}✅ Pipeline triggered successfully!${NC}"
echo "Pipeline Number: $PIPELINE_NUMBER"
echo ""
echo -e "${CYAN}View pipeline at:${NC}"
echo "https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER"
echo ""

# Ask if user wants to follow logs
read -p "Follow pipeline logs? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Check if the follow script exists
    FOLLOW_SCRIPT="$(dirname $0)/circleci-follow.sh"
    if [ -f "$FOLLOW_SCRIPT" ]; then
        # Run the follow script for this specific pipeline
        export PIPELINE_ID
        export PIPELINE_NUMBER
        export PROJECT_SLUG
        bash "$FOLLOW_SCRIPT" --existing-pipeline
    else
        echo -e "${YELLOW}Log following script not found. Monitor manually at:${NC}"
        echo "https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER"
    fi
fi

echo ""
echo -e "${GREEN}Test branch '$TEMP_BRANCH' is ready${NC}"
echo "The cleanup will happen when you exit this script."
read -p "Press Enter when you're done reviewing the pipeline results..."
