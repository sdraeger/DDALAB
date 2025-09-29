#!/bin/bash

# Safe CircleCI testing script that excludes sensitive files
# This prevents accidental secret exposure during testing

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

# Files to exclude from CI testing (sensitive files)
EXCLUDED_FILES=(
    ".env*"
    "*.key"
    "*.pem" 
    "*.p12"
    "*.pfx"
    "*password*"
    "*secret*"
    ".aws/"
    ".ssh/"
    "acme.json"
)

echo -e "${CYAN}Safe CircleCI Local State Tester${NC}"
echo "=================================="
echo "This safely tests your local changes by excluding sensitive files."
echo ""
echo -e "${YELLOW}Current branch: $CURRENT_BRANCH${NC}"
echo -e "${YELLOW}Temporary branch: $TEMP_BRANCH${NC}"
echo ""

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}You have uncommitted changes:${NC}"
    git status -s
    echo ""
    
    # Check for potentially sensitive files
    SENSITIVE_FOUND=false
    echo -e "${YELLOW}Checking for sensitive files...${NC}"
    
    git status --porcelain | cut -c4- | while read -r file; do
        for pattern in "${EXCLUDED_FILES[@]}"; do
            if [[ "$file" == $pattern ]] || [[ "$file" == *"$pattern"* ]]; then
                echo -e "${RED}⚠️  Found sensitive file: $file${NC}"
                SENSITIVE_FOUND=true
            fi
        done
    done
    
    if [ "$SENSITIVE_FOUND" = true ]; then
        echo ""
        echo -e "${RED}Sensitive files detected in your changes.${NC}"
        echo "These will be excluded from the CI test for security."
    fi
    
    echo ""
    read -p "Include non-sensitive changes in the test? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        INCLUDE_CHANGES=true
    else
        INCLUDE_CHANGES=false
    fi
else
    INCLUDE_CHANGES=false
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

# If including changes, add them selectively
if [ "$INCLUDE_CHANGES" = true ]; then
    echo -e "${BLUE}Adding safe changes...${NC}"
    
    # Get list of modified files
    git status --porcelain | cut -c4- | while read -r file; do
        SKIP_FILE=false
        
        # Check if file should be excluded
        for pattern in "${EXCLUDED_FILES[@]}"; do
            if [[ "$file" == $pattern ]] || [[ "$file" == *"$pattern"* ]]; then
                echo -e "${YELLOW}Skipping sensitive file: $file${NC}"
                SKIP_FILE=true
                break
            fi
        done
        
        # Add file if not sensitive
        if [ "$SKIP_FILE" = false ]; then
            echo -e "${GREEN}Adding: $file${NC}"
            git add "$file"
        fi
    done
    
    # Commit the safe changes
    if git diff --cached --quiet; then
        echo -e "${YELLOW}No safe changes to commit${NC}"
    else
        git commit -m "CI Test: Safe local changes for testing" --no-verify
    fi
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
echo -e "${GREEN}Safe test branch '$TEMP_BRANCH' is ready${NC}"
echo -e "${YELLOW}Note: Sensitive files were excluded from this test${NC}"
echo "The cleanup will happen when you exit this script."
read -p "Press Enter when you're done reviewing the pipeline results..."