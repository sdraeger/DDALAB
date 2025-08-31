#!/bin/bash

# Enhanced CircleCI trigger script with log streaming
# This triggers a pipeline and streams the logs in real-time

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check for CircleCI token
if [ -z "$CIRCLECI_TOKEN" ]; then
    echo -e "${RED}Error: CIRCLECI_TOKEN environment variable is not set${NC}"
    echo "Please set it with: export CIRCLECI_TOKEN=your-token-here"
    echo "Get your token from: https://app.circleci.com/settings/user/tokens"
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

echo -e "${BLUE}Triggering CircleCI pipeline...${NC}"
echo "Project: $PROJECT_SLUG"
echo "Branch: $BRANCH"

# Trigger the pipeline
RESPONSE=$(curl -s -X POST \
  "https://circleci.com/api/v2/project/$PROJECT_SLUG/pipeline" \
  -H "Circle-Token: $CIRCLECI_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"branch\":\"$BRANCH\"}")

# Extract pipeline information
if echo "$RESPONSE" | grep -q "id"; then
    PIPELINE_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | sed 's/"id":"\([^"]*\)"/\1/')
    PIPELINE_NUMBER=$(echo "$RESPONSE" | grep -o '"number":[0-9]*' | sed 's/"number":\([0-9]*\)/\1/')
    echo -e "${GREEN}✅ Pipeline triggered successfully!${NC}"
    echo "Pipeline ID: $PIPELINE_ID"
    echo "Pipeline Number: $PIPELINE_NUMBER"
    echo "View at: https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER"
    echo ""
else
    echo -e "${RED}❌ Failed to trigger pipeline${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi

# Function to get workflow status
get_workflows() {
    curl -s -X GET \
      "https://circleci.com/api/v2/pipeline/$PIPELINE_ID/workflow" \
      -H "Circle-Token: $CIRCLECI_TOKEN"
}

# Function to get jobs for a workflow
get_jobs() {
    local workflow_id=$1
    curl -s -X GET \
      "https://circleci.com/api/v2/workflow/$workflow_id/job" \
      -H "Circle-Token: $CIRCLECI_TOKEN"
}

# Function to stream job logs
stream_job_logs() {
    local job_number=$1
    local job_name=$2
    echo -e "${CYAN}=== Streaming logs for: $job_name ===${NC}"

    # Get the job steps
    STEPS=$(curl -s -X GET \
      "https://circleci.com/api/v2/project/$PROJECT_SLUG/$job_number/steps" \
      -H "Circle-Token: $CIRCLECI_TOKEN")

    # Parse and display each step's output
    echo "$STEPS" | grep -o '"name":"[^"]*"' | sed 's/"name":"\([^"]*\)"/\1/' | while read -r step_name; do
        if [[ ! -z "$step_name" ]]; then
            echo -e "${YELLOW}Step: $step_name${NC}"

            # Get step details including action_index
            STEP_DETAILS=$(echo "$STEPS" | grep -B2 -A2 "\"name\":\"$step_name\"")
            ACTION_INDEX=$(echo "$STEP_DETAILS" | grep -o '"action_index":[0-9]*' | head -1 | sed 's/"action_index":\([0-9]*\)/\1/')

            if [[ ! -z "$ACTION_INDEX" ]]; then
                # Get the output for this step
                OUTPUT=$(curl -s -X GET \
                  "https://circleci.com/api/v2/project/$PROJECT_SLUG/$job_number/steps/$ACTION_INDEX/logs" \
                  -H "Circle-Token: $CIRCLECI_TOKEN")

                # Display the output
                echo "$OUTPUT" | jq -r '.[] | select(.message) | .message' 2>/dev/null || echo "$OUTPUT"
                echo ""
            fi
        fi
    done
}

# Wait for workflows to start
echo -e "${YELLOW}Waiting for workflows to start...${NC}"
sleep 5

# Monitor the pipeline
FINISHED=false
SEEN_JOBS=()

while [ "$FINISHED" = false ]; do
    # Get all workflows for this pipeline
    WORKFLOWS=$(get_workflows)

    # Check if all workflows are finished
    if echo "$WORKFLOWS" | grep -q '"status":"running"\|"status":"on_hold"\|"status":"not_run"'; then
        FINISHED=false
    else
        FINISHED=true
    fi

    # Process each workflow
    echo "$WORKFLOWS" | grep -o '"id":"[^"]*"' | sed 's/"id":"\([^"]*\)"/\1/' | while read -r workflow_id; do
        if [[ ! -z "$workflow_id" ]]; then
            # Get workflow details
            WORKFLOW_NAME=$(echo "$WORKFLOWS" | grep -A5 "\"id\":\"$workflow_id\"" | grep -o '"name":"[^"]*"' | head -1 | sed 's/"name":"\([^"]*\)"/\1/')
            WORKFLOW_STATUS=$(echo "$WORKFLOWS" | grep -A5 "\"id\":\"$workflow_id\"" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"\([^"]*\)"/\1/')

            # Get jobs for this workflow
            JOBS=$(get_jobs "$workflow_id")

            # Process each job
            echo "$JOBS" | grep -o '"job_number":[0-9]*' | sed 's/"job_number":\([0-9]*\)/\1/' | while read -r job_number; do
                if [[ ! -z "$job_number" ]] && [[ ! " ${SEEN_JOBS[@]} " =~ " ${job_number} " ]]; then
                    # Mark job as seen
                    SEEN_JOBS+=($job_number)

                    # Get job details
                    JOB_NAME=$(echo "$JOBS" | grep -B5 -A5 "\"job_number\":$job_number" | grep -o '"name":"[^"]*"' | head -1 | sed 's/"name":"\([^"]*\)"/\1/')
                    JOB_STATUS=$(echo "$JOBS" | grep -B5 -A5 "\"job_number\":$job_number" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"\([^"]*\)"/\1/')

                    echo -e "${BLUE}Workflow: $WORKFLOW_NAME | Job: $JOB_NAME | Status: $JOB_STATUS${NC}"

                    # Stream logs for running or recently finished jobs
                    if [[ "$JOB_STATUS" == "running" ]] || [[ "$JOB_STATUS" == "success" ]] || [[ "$JOB_STATUS" == "failed" ]]; then
                        stream_job_logs "$job_number" "$JOB_NAME"
                    fi
                fi
            done
        fi
    done

    if [ "$FINISHED" = false ]; then
        sleep 10
    fi
done

# Final status
echo ""
echo -e "${BLUE}=== Pipeline Completed ===${NC}"

# Get final workflow statuses
WORKFLOWS=$(get_workflows)
ALL_SUCCESS=true

echo "$WORKFLOWS" | grep -o '"name":"[^"]*"\|"status":"[^"]*"' | sed 'N;s/\n/ /' | while read -r line; do
    WORKFLOW_NAME=$(echo "$line" | sed 's/"name":"\([^"]*\)".*/\1/')
    WORKFLOW_STATUS=$(echo "$line" | sed 's/.*"status":"\([^"]*\)"/\1/')

    if [[ "$WORKFLOW_STATUS" == "success" ]]; then
        echo -e "${GREEN}✅ $WORKFLOW_NAME: $WORKFLOW_STATUS${NC}"
    elif [[ "$WORKFLOW_STATUS" == "failed" ]]; then
        echo -e "${RED}❌ $WORKFLOW_NAME: $WORKFLOW_STATUS${NC}"
        ALL_SUCCESS=false
    else
        echo -e "${YELLOW}⚠️  $WORKFLOW_NAME: $WORKFLOW_STATUS${NC}"
    fi
done

echo ""
echo "Full details: https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER"
