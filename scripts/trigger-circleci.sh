#!/bin/bash

# Script to trigger CircleCI pipeline without pushing to repository
# This uses the CircleCI API v2 to trigger a pipeline

# You'll need to set your CircleCI API token
# Get it from: https://app.circleci.com/settings/user/tokens
if [ -z "$CIRCLECI_TOKEN" ]; then
    echo "Error: CIRCLECI_TOKEN environment variable is not set"
    echo "Please set it with: export CIRCLECI_TOKEN=your-token-here"
    echo "Get your token from: https://app.circleci.com/settings/user/tokens"
    exit 1
fi

# Get the VCS provider and organization/project from git remote
REMOTE_URL=$(git config --get remote.origin.url)
if [[ $REMOTE_URL == git@github.com:* ]]; then
    # SSH URL format
    PROJECT_SLUG=$(echo $REMOTE_URL | sed 's/git@github.com:/github\//' | sed 's/\.git$//')
elif [[ $REMOTE_URL == https://github.com/* ]]; then
    # HTTPS URL format
    PROJECT_SLUG=$(echo $REMOTE_URL | sed 's/https:\/\/github.com\//github\//' | sed 's/\.git$//')
else
    echo "Error: Could not determine project slug from git remote"
    echo "Remote URL: $REMOTE_URL"
    exit 1
fi

# Get current branch
BRANCH=$(git branch --show-current)

echo "Triggering CircleCI pipeline..."
echo "Project: $PROJECT_SLUG"
echo "Branch: $BRANCH"

# Trigger the pipeline
RESPONSE=$(curl -s -X POST \
  "https://circleci.com/api/v2/project/$PROJECT_SLUG/pipeline" \
  -H "Circle-Token: $CIRCLECI_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"branch\":\"$BRANCH\"}")

# Check if the request was successful
if echo "$RESPONSE" | grep -q "id"; then
    PIPELINE_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | sed 's/"id":"\([^"]*\)"/\1/')
    PIPELINE_NUMBER=$(echo "$RESPONSE" | grep -o '"number":[0-9]*' | sed 's/"number":\([0-9]*\)/\1/')
    echo "✅ Pipeline triggered successfully!"
    echo "Pipeline ID: $PIPELINE_ID"
    echo "Pipeline Number: $PIPELINE_NUMBER"
    echo ""
    echo "View pipeline at: https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER"
else
    echo "❌ Failed to trigger pipeline"
    echo "Response: $RESPONSE"
    exit 1
fi
