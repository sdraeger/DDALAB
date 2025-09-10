#!/bin/bash
# Database restore script for DDALAB

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$SCRIPT_DIR/.."

# Change to project directory
cd "$PROJECT_DIR"

# Check if backup file was provided
if [ -z "$1" ]; then
    echo "Usage: $0 <backup-file>"
    echo ""
    echo "Available backups:"
    ls -la backups/ddalab_backup_*.sql.gz 2>/dev/null || echo "  No backups found"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Load environment
if [ -f .env ]; then
    set -a
    source .env
    set +a
else
    echo "Warning: .env file not found, using defaults"
    DB_USER="ddalab"
    DB_NAME="ddalab"
fi

# Determine docker compose command
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

echo "=== DDALAB Database Restore ==="
echo "Backup file: $BACKUP_FILE"
echo "Target database: $DB_NAME"
echo ""
echo "WARNING: This will replace all data in the database!"
read -p "Are you sure you want to continue? (yes/no): " confirmation

if [ "$confirmation" != "yes" ]; then
    echo "Restore cancelled"
    exit 0
fi

echo ""
echo "Stopping DDALAB services..."
$COMPOSE_CMD stop ddalab

echo "Restoring database..."
if gunzip -c "$BACKUP_FILE" | $COMPOSE_CMD exec -T postgres psql -U "$DB_USER" -d "$DB_NAME"; then
    echo "✓ Database restored successfully"
    
    echo "Restarting DDALAB services..."
    $COMPOSE_CMD start ddalab
    
    echo ""
    echo "✓ Restore complete!"
    echo "DDALAB has been restored from backup and restarted."
else
    echo "✗ Restore failed"
    echo "Please check the error messages above"
    exit 1
fi