#!/bin/bash
# DDALAB Auto-Update Script
# Automatically pulls and updates DDALAB to the latest version
# Can be run via cron for automatic updates

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
LOG_FILE="${PROJECT_ROOT}/logs/auto-update.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to check if update is needed
check_update() {
    log "Checking for updates..."
    
    # Get current image ID
    CURRENT_ID=$(docker inspect --format='{{.Id}}' ${DDALAB_IMAGE:-ddalab:latest} 2>/dev/null || echo "none")
    
    # Pull latest image
    docker-compose -f "$COMPOSE_FILE" pull ddalab 2>&1 | tee -a "$LOG_FILE"
    
    # Get new image ID
    NEW_ID=$(docker inspect --format='{{.Id}}' ${DDALAB_IMAGE:-ddalab:latest} 2>/dev/null || echo "none")
    
    if [ "$CURRENT_ID" != "$NEW_ID" ]; then
        log "Update available! Current: ${CURRENT_ID:0:12}, New: ${NEW_ID:0:12}"
        return 0
    else
        log "No update needed. Current version: ${CURRENT_ID:0:12}"
        return 1
    fi
}

# Function to perform update
perform_update() {
    log "Starting update process..."
    
    # Create backup before update
    if command -v "${SCRIPT_DIR}/deploy.sh" &> /dev/null; then
        log "Creating backup..."
        "${SCRIPT_DIR}/deploy.sh" backup 2>&1 | tee -a "$LOG_FILE"
    fi
    
    # Perform the update
    log "Updating containers..."
    docker-compose -f "$COMPOSE_FILE" up -d --force-recreate ddalab 2>&1 | tee -a "$LOG_FILE"
    
    # Wait for service to be healthy
    log "Waiting for service to be healthy..."
    sleep 30
    
    # Check health
    if docker-compose -f "$COMPOSE_FILE" ps | grep -E "ddalab.*Up.*healthy"; then
        log "Update completed successfully!"
        return 0
    else
        log "ERROR: Service is not healthy after update"
        # Attempt rollback could be implemented here
        return 1
    fi
}

# Function to send notification (customize as needed)
send_notification() {
    local status=$1
    local message=$2
    
    # Example: Send to Slack webhook
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"DDALAB Update: $status - $message\"}" \
            "$SLACK_WEBHOOK_URL" 2>/dev/null || true
    fi
    
    # Example: Send email (requires mail/sendmail configured)
    if [ -n "$ADMIN_EMAIL" ]; then
        echo "$message" | mail -s "DDALAB Update: $status" "$ADMIN_EMAIL" 2>/dev/null || true
    fi
}

# Main update logic
main() {
    log "=== DDALAB Auto-Update Started ==="
    
    # Load environment if exists
    if [ -f "${PROJECT_ROOT}/.env" ]; then
        set -a
        source "${PROJECT_ROOT}/.env"
        set +a
    fi
    
    # Check if services are running
    if ! docker-compose -f "$COMPOSE_FILE" ps | grep -q "Up"; then
        log "WARNING: Services are not running. Skipping update."
        exit 0
    fi
    
    # Check for updates
    if check_update; then
        # Perform update
        if perform_update; then
            log "Update completed successfully"
            send_notification "SUCCESS" "DDALAB has been updated successfully"
        else
            log "Update failed!"
            send_notification "FAILED" "DDALAB update failed. Check logs: $LOG_FILE"
            exit 1
        fi
    else
        log "No update needed"
    fi
    
    log "=== DDALAB Auto-Update Completed ==="
}

# Run main function
main

# Example cron entry (add to crontab -e):
# Run daily at 2 AM:
# 0 2 * * * /path/to/ddalab/deploy/auto-update.sh > /dev/null 2>&1
# 
# Run weekly on Sunday at 3 AM:
# 0 3 * * 0 /path/to/ddalab/deploy/auto-update.sh > /dev/null 2>&1