#!/bin/bash

# Script to set up symbolic links for environment files
# This script creates or updates symbolic links from project .env.local files
# to the centralized environment configuration

# Base directory (repository root)
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_DIR="$BASE_DIR/config/environments"

# Check if environment directory exists
if [ ! -d "$ENV_DIR" ]; then
    echo "Error: Environment directory not found at $ENV_DIR"
    echo "Creating directory structure..."
    mkdir -p "$ENV_DIR"
fi

# Create consolidated .env.local file from the appropriate env files
create_env_file() {
    local target_dir=$1
    local project_type=$2
    local output_file="$target_dir/.env.local"
    
    echo "Creating $output_file..."
    
    # Check if target directory exists
    if [ ! -d "$target_dir" ]; then
        echo "Warning: Target directory $target_dir does not exist"
        return 1
    }
    
    # Start with base env if it exists
    if [ -f "$ENV_DIR/base.env" ]; then
        cat "$ENV_DIR/base.env" > "$output_file"
        echo "" >> "$output_file"
    else
        echo "Warning: base.env not found at $ENV_DIR/base.env"
        touch "$output_file"
    fi
    
    # Add project-specific env if exists
    if [ -f "$ENV_DIR/$project_type.env" ]; then
        echo "# Project-specific environment variables" >> "$output_file"
        cat "$ENV_DIR/$project_type.env" >> "$output_file"
        echo "" >> "$output_file"
    else
        echo "Warning: $project_type.env not found at $ENV_DIR/$project_type.env"
    fi
    
    # Add local overrides if exists
    if [ -f "$ENV_DIR/local.env" ]; then
        echo "# Local development overrides" >> "$output_file"
        cat "$ENV_DIR/local.env" >> "$output_file"
    else
        echo "Warning: local.env not found at $ENV_DIR/local.env"
    fi
    
    echo "Created $output_file"
    
    # Set appropriate permissions
    chmod 600 "$output_file"
}

# Print current working directory and base directory for debugging
echo "Current directory: $(pwd)"
echo "Base directory: $BASE_DIR"
echo "Environment directory: $ENV_DIR"

echo "Setting up environment files..."

# Create environment files for each project
create_env_file "$BASE_DIR" "root"
create_env_file "$BASE_DIR/ddalab-web" "ddalab-web"
create_env_file "$BASE_DIR/ddalab-web/scripts/db-setup" "db-setup"
create_env_file "$BASE_DIR/server/scripts" "server-scripts"

echo "Environment setup complete."

# Print status of created files
echo -e "\nStatus of created files:"
for dir in "$BASE_DIR" "$BASE_DIR/ddalab-web" "$BASE_DIR/ddalab-web/scripts/db-setup" "$BASE_DIR/server/scripts"; do
    if [ -f "$dir/.env.local" ]; then
        echo "✓ Created: $dir/.env.local"
    else
        echo "✗ Failed to create: $dir/.env.local"
    fi
done 