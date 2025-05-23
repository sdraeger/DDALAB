#!/bin/bash

# Script to generate docker-compose volume overrides from DDALAB_ALLOWED_DIRS
# Usage: ./scripts/generate-volumes.sh

set -e

# Load environment variables
if [ -f .env ]; then
    source .env
fi

# Check if DDALAB_ALLOWED_DIRS is set
if [ -z "$DDALAB_ALLOWED_DIRS" ]; then
    echo "DDALAB_ALLOWED_DIRS not set in .env file"
    exit 1
fi

# Generate docker-compose.volumes.yml
cat > docker-compose.volumes.yml << EOF
# Auto-generated file - do not edit manually
# Generated from DDALAB_ALLOWED_DIRS: $DDALAB_ALLOWED_DIRS

services:
  api:
    volumes:
      - prometheus_metrics:/tmp/prometheus
EOF

# Parse DDALAB_ALLOWED_DIRS and generate volume mounts
IFS=',' read -ra DIRS <<< "$DDALAB_ALLOWED_DIRS"
for dir in "${DIRS[@]}"; do
    # Parse source:target:mode format
    IFS=':' read -ra PARTS <<< "$dir"
    if [ ${#PARTS[@]} -eq 3 ]; then
        source_path="${PARTS[0]}"
        target_path="${PARTS[1]}"
        mode="${PARTS[2]}"

        echo "      - type: bind" >> docker-compose.volumes.yml
        echo "        source: $source_path" >> docker-compose.volumes.yml
        echo "        target: $target_path" >> docker-compose.volumes.yml
        if [ "$mode" = "ro" ]; then
            echo "        read_only: true" >> docker-compose.volumes.yml
        fi
    else
        echo "Warning: Invalid directory format: $dir"
        echo "Expected format: source:target:mode (e.g., /host/path:/container/path:rw)"
    fi
done

echo "Generated docker-compose.volumes.yml with volume mounts:"
cat docker-compose.volumes.yml
