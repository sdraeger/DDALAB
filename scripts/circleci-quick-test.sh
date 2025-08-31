#!/bin/bash

# Quick script to test current repository state on CircleCI
# For organizations: Set ORG_NAME environment variable

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

# Get repository info
REMOTE_URL=$(git remote get-url origin)
REPO_NAME=$(basename -s .git "$REMOTE_URL")

# Determine organization/username
if [ ! -z "$ORG_NAME" ]; then
    PROJECT_SLUG="github/$ORG_NAME/$REPO_NAME"
    echo -e "${CYAN}Using organization: $ORG_NAME${NC}"
elif [[ $REMOTE_URL == *"Computational-Neurobiology-Laboratory"* ]]; then
    PROJECT_SLUG="github/Computational-Neurobiology-Laboratory/$REPO_NAME"
    echo -e "${CYAN}Using organization: Computational-Neurobiology-Laboratory${NC}"
else
    # Extract from URL
    if [[ $REMOTE_URL == git@github.com:* ]]; then
        PROJECT_SLUG=$(echo $REMOTE_URL | sed 's/git@github.com:/github\//' | sed 's/\.git$//')
    elif [[ $REMOTE_URL == https://github.com/* ]]; then
        PROJECT_SLUG=$(echo $REMOTE_URL | sed 's/https:\/\/github.com\//github\//' | sed 's/\.git$//')
    fi
fi

BRANCH=$(git branch --show-current)

echo "Project: $PROJECT_SLUG"
echo "Branch: $BRANCH"
echo ""

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}⚠️  You have uncommitted changes!${NC}"
    echo "Options:"
    echo "1. Test current committed state (ignores uncommitted changes)"
    echo "2. Create temporary branch with uncommitted changes"
    echo "3. Cancel"
    echo ""
    read -p "Choose option (1-3): " -n 1 -r
    echo

    case $REPLY in
        1)
            echo -e "${BLUE}Testing current committed state...${NC}"
            ;;
        2)
            echo -e "${BLUE}Creating temporary branch with changes...${NC}"
            TEMP_BRANCH="ci-test-$(date +%Y%m%d-%H%M%S)"
            git checkout -b "$TEMP_BRANCH"
            git add -A
            git commit -m "CI Test: temporary changes" --no-verify
            git push -u origin "$TEMP_BRANCH"
            BRANCH="$TEMP_BRANCH"
            CLEANUP_BRANCH=true
            ;;
        3)
            echo "Cancelled"
            exit 0
            ;;
        *)
            echo "Invalid option"
            exit 1
            ;;
    esac
    echo ""
fi

# Trigger pipeline
echo -e "${BLUE}🚀 Triggering CircleCI pipeline...${NC}"
RESPONSE=$(curl -s -X POST \
  "https://circleci.com/api/v2/project/$PROJECT_SLUG/pipeline" \
  -H "Circle-Token: $CIRCLECI_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"branch\":\"$BRANCH\"}")

PIPELINE_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*"' | sed 's/"id":"\([^"]*\)"/\1/')
PIPELINE_NUMBER=$(echo $RESPONSE | grep -o '"number":[0-9]*' | sed 's/"number":\([0-9]*\)/\1/')

if [ -z "$PIPELINE_ID" ]; then
    echo -e "${RED}❌ Failed to trigger pipeline${NC}"
    echo "$RESPONSE"
    exit 1
fi

echo -e "${GREEN}✅ Pipeline #$PIPELINE_NUMBER triggered successfully!${NC}"
echo ""
echo -e "${CYAN}🔗 View at: https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER${NC}"
echo ""

# Options for monitoring
echo "What would you like to do?"
echo "1. Open in browser"
echo "2. Follow logs in terminal"
echo "3. Just show URL and exit"
echo ""
read -p "Choose option (1-3): " -n 1 -r
echo

case $REPLY in
    1)
        open "https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER"
        ;;
    2)
        if [ -f "$(dirname $0)/circleci-follow.sh" ]; then
            export PIPELINE_ID
            export PIPELINE_NUMBER
            export PROJECT_SLUG
            bash "$(dirname $0)/circleci-follow.sh" --existing-pipeline
        else
            echo -e "${YELLOW}Log follower not found${NC}"
        fi
        ;;
    3)
        # Just exit
        ;;
esac

# Cleanup if we created a temp branch
if [ "$CLEANUP_BRANCH" = true ]; then
    echo ""
    echo -e "${YELLOW}Cleaning up temporary branch...${NC}"
    ORIGINAL_BRANCH=$(git log --oneline -n 1 HEAD~1 --format="%D" | sed 's/.*origin\/\([^,]*\).*/\1/' | head -1)
    if [ -z "$ORIGINAL_BRANCH" ]; then
        ORIGINAL_BRANCH="main"
    fi

    git checkout "$ORIGINAL_BRANCH" 2>/dev/null || git checkout main
    git branch -D "$TEMP_BRANCH"

    read -p "Delete remote temporary branch? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push origin --delete "$TEMP_BRANCH"
        echo -e "${GREEN}Remote branch deleted${NC}"
    fi
fi
