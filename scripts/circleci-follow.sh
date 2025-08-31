#!/bin/bash

# Simplified CircleCI log follower
# Triggers pipeline and follows logs in a cleaner format

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# Check token
if [ -z "$CIRCLECI_TOKEN" ]; then
    echo -e "${RED}Error: CIRCLECI_TOKEN not set${NC}"
    echo "Get token from: https://app.circleci.com/settings/user/tokens"
    exit 1
fi

# Check for jq
if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}Installing jq for JSON parsing...${NC}"
    brew install jq
fi

# API base URL
API_BASE="https://circleci.com/api/v2"

# Helper function for API calls
api_call() {
    curl -s -H "Circle-Token: $CIRCLECI_TOKEN" "$@"
}

# Check if we're following an existing pipeline
if [ "$1" = "--existing-pipeline" ] && [ ! -z "$PIPELINE_ID" ] && [ ! -z "$PROJECT_SLUG" ]; then
    echo -e "${CYAN}📊 Following existing pipeline #$PIPELINE_NUMBER${NC}"
else
    # Get project info
    REMOTE_URL=$(git config --get remote.origin.url)
    PROJECT_SLUG=$(echo $REMOTE_URL | sed -E 's|.*github.com[:/](.*)\.git|github/\1|')
    BRANCH=$(git branch --show-current)

    # Trigger pipeline
    echo -e "${CYAN}🚀 Triggering pipeline on branch: $BRANCH${NC}"
    RESPONSE=$(api_call -X POST "$API_BASE/project/$PROJECT_SLUG/pipeline" \
      -H "Content-Type: application/json" \
      -d "{\"branch\":\"$BRANCH\"}")

    PIPELINE_ID=$(echo $RESPONSE | jq -r '.id')
    PIPELINE_NUMBER=$(echo $RESPONSE | jq -r '.number')

    if [ "$PIPELINE_ID" = "null" ]; then
        echo -e "${RED}Failed to trigger pipeline${NC}"
        echo $RESPONSE | jq .
        exit 1
    fi

    echo -e "${GREEN}✅ Pipeline #$PIPELINE_NUMBER triggered${NC}"
fi

echo "📎 https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER"
echo ""

# Function to format duration
format_duration() {
    local seconds=$1
    if [ $seconds -lt 60 ]; then
        echo "${seconds}s"
    else
        echo "$((seconds / 60))m $((seconds % 60))s"
    fi
}

# Track seen jobs and their status
declare -A JOB_STATUS
declare -A JOB_SHOWN

# Main monitoring loop
echo -e "${CYAN}📊 Monitoring pipeline...${NC}"
echo ""

while true; do
    # Get workflows
    WORKFLOWS=$(api_call "$API_BASE/pipeline/$PIPELINE_ID/workflow")

    # Check each workflow
    echo "$WORKFLOWS" | jq -c '.items[]' | while read -r workflow; do
        WORKFLOW_ID=$(echo $workflow | jq -r '.id')
        WORKFLOW_NAME=$(echo $workflow | jq -r '.name')
        WORKFLOW_STATUS=$(echo $workflow | jq -r '.status')

        # Get jobs for workflow
        JOBS=$(api_call "$API_BASE/workflow/$WORKFLOW_ID/job")

        echo "$JOBS" | jq -c '.items[]' | while read -r job; do
            JOB_NUMBER=$(echo $job | jq -r '.job_number')
            JOB_NAME=$(echo $job | jq -r '.name')
            JOB_STATUS_NOW=$(echo $job | jq -r '.status')
            JOB_STARTED=$(echo $job | jq -r '.started_at // empty')
            JOB_STOPPED=$(echo $job | jq -r '.stopped_at // empty')

            # Check if job status changed
            if [ "${JOB_STATUS[$JOB_NUMBER]}" != "$JOB_STATUS_NOW" ]; then
                JOB_STATUS[$JOB_NUMBER]=$JOB_STATUS_NOW

                # Show job header
                case $JOB_STATUS_NOW in
                    "running")
                        echo -e "${BLUE}▶️  $JOB_NAME started${NC}"
                        ;;
                    "success")
                        if [ ! -z "$JOB_STARTED" ] && [ ! -z "$JOB_STOPPED" ]; then
                            DURATION=$(($(date -j -f "%Y-%m-%dT%H:%M:%S" "${JOB_STOPPED%.*}" +%s 2>/dev/null || date -d "${JOB_STOPPED%.*}" +%s) - $(date -j -f "%Y-%m-%dT%H:%M:%S" "${JOB_STARTED%.*}" +%s 2>/dev/null || date -d "${JOB_STARTED%.*}" +%s)))
                            echo -e "${GREEN}✅ $JOB_NAME completed ($(format_duration $DURATION))${NC}"
                        else
                            echo -e "${GREEN}✅ $JOB_NAME completed${NC}"
                        fi
                        ;;
                    "failed")
                        echo -e "${RED}❌ $JOB_NAME failed${NC}"
                        # Show last few lines of failed job
                        echo -e "${RED}Last output:${NC}"
                        api_call "$API_BASE/project/$PROJECT_SLUG/$JOB_NUMBER/steps" | \
                            jq -r '.items[-1].actions[0].allocation_id as $id | .items[-1].actions[0].index as $idx |
                            "\($id)/\($idx)"' | \
                            xargs -I {} api_call "$API_BASE/project/$PROJECT_SLUG/$JOB_NUMBER/steps/{}/logs" | \
                            tail -20
                        echo ""
                        ;;
                    "on_hold")
                        echo -e "${YELLOW}⏸️  $JOB_NAME on hold (awaiting approval)${NC}"
                        ;;
                esac

                # For running jobs, show real-time output
                if [ "$JOB_STATUS_NOW" = "running" ] && [ "${JOB_SHOWN[$JOB_NUMBER]}" != "yes" ]; then
                    JOB_SHOWN[$JOB_NUMBER]="yes"

                    # Stream the output
                    LAST_STEP=""
                    while [ "${JOB_STATUS[$JOB_NUMBER]}" = "running" ]; do
                        # Get current step
                        STEPS=$(api_call "$API_BASE/project/$PROJECT_SLUG/$JOB_NUMBER/steps")
                        CURRENT_STEP=$(echo $STEPS | jq -r '.items[] | select(.actions[0].status == "running") | .name' | head -1)

                        if [ ! -z "$CURRENT_STEP" ] && [ "$CURRENT_STEP" != "$LAST_STEP" ]; then
                            echo -e "${MAGENTA}  → $CURRENT_STEP${NC}"
                            LAST_STEP=$CURRENT_STEP
                        fi

                        sleep 2

                        # Check if job is still running
                        JOB_CHECK=$(api_call "$API_BASE/project/$PROJECT_SLUG/job/$JOB_NUMBER")
                        JOB_STATUS[$JOB_NUMBER]=$(echo $JOB_CHECK | jq -r '.status')
                    done
                fi
            fi
        done
    done

    # Check if pipeline is complete
    PIPELINE_STATUS=$(echo $WORKFLOWS | jq -r '.items[0].status' 2>/dev/null)
    if [[ "$PIPELINE_STATUS" != "running" ]] && [[ "$PIPELINE_STATUS" != "on_hold" ]] && [[ "$PIPELINE_STATUS" != "not_run" ]]; then
        break
    fi

    sleep 5
done

# Final summary
echo ""
echo -e "${CYAN}📋 Pipeline Summary${NC}"
echo "=================="

WORKFLOWS=$(api_call "$API_BASE/pipeline/$PIPELINE_ID/workflow")
TOTAL_SUCCESS=0
TOTAL_FAILED=0

echo "$WORKFLOWS" | jq -r '.items[] | "\(.name): \(.status)"' | while read -r line; do
    STATUS=$(echo $line | cut -d: -f2 | xargs)
    if [[ "$STATUS" == "success" ]]; then
        echo -e "${GREEN}$line${NC}"
        ((TOTAL_SUCCESS++))
    elif [[ "$STATUS" == "failed" ]]; then
        echo -e "${RED}$line${NC}"
        ((TOTAL_FAILED++))
    else
        echo -e "${YELLOW}$line${NC}"
    fi
done

echo ""
echo "🔗 Full details: https://app.circleci.com/pipelines/$PROJECT_SLUG/$PIPELINE_NUMBER"
