#!/bin/bash
# Database backup script for DDALAB

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$SCRIPT_DIR/.."
BACKUP_DIR="$PROJECT_DIR/backups"

# Change to project directory
cd "$PROJECT_DIR"

# Load environment
if [ -f .env ]; then
    # Export variables from .env file
    set -a
    source .env
    set +a
else
    echo "Warning: .env file not found, using defaults"
    DB_USER="ddalab"
    DB_NAME="ddalab"
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Generate timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/ddalab_backup_${TIMESTAMP}.sql.gz"

echo "Creating database backup..."
echo "Database: $DB_NAME"
echo "User: $DB_USER"

# Determine docker compose command
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# Create backup
if $COMPOSE_CMD exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" 2>/dev/null | gzip > "$BACKUP_FILE"; then
    # Get file size
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✓ Backup created successfully"
    echo "  File: $BACKUP_FILE"
    echo "  Size: $SIZE"
    
    # Cleanup old backups (keep last 7 days)
    echo "Cleaning up old backups (keeping last 7 days)..."
    find "$BACKUP_DIR" -name "ddalab_backup_*.sql.gz" -mtime +7 -delete 2>/dev/null || true
    
    # Count remaining backups
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/ddalab_backup_*.sql.gz 2>/dev/null | wc -l)
    echo "Total backups retained: $BACKUP_COUNT"
else
    echo "✗ Backup failed"
    echo "Make sure DDALAB is running: ./ddalab.sh status"
    rm -f "$BACKUP_FILE" 2>/dev/null
    exit 1
fi