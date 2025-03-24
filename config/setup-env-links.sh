#!/bin/bash

# Script to set up symbolic links for environment files
# This script creates or updates symbolic links from project .env.local files
# to the centralized environment configuration

# Base directory (repository root)
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$BASE_DIR/config/environments"

echo "BASE_DIR: $BASE_DIR"
echo "ENV_DIR: $ENV_DIR"

# Create consolidated .env.local file from the appropriate env files
create_env_file() {
  local target_dir=$1
  local project_type=$2
  local output_file="$target_dir/.env.local"
  
  echo "Creating $output_file..."
  
  # Start with base env
  cat "$ENV_DIR/base.env" > "$output_file"
  echo "" >> "$output_file"
  
  # Add project-specific env if exists
  if [ -f "$ENV_DIR/$project_type.env" ]; then
    echo "# Project-specific environment variables" >> "$output_file"
    cat "$ENV_DIR/$project_type.env" >> "$output_file"
    echo "" >> "$output_file"
  fi
  
  # Add local overrides if exists
  if [ -f "$ENV_DIR/local.env" ]; then
    echo "# Local development overrides" >> "$output_file"
    cat "$ENV_DIR/local.env" >> "$output_file"
  fi
  
  echo "Created $output_file"
}

# Set up environment for each project
echo "Setting up environment files..."

# Main .env.local in root
create_env_file "$BASE_DIR" "root"

# ddalab-web
create_env_file "$BASE_DIR/ddalab-web" "ddalab-web"

# ddalab-web/scripts/db-setup
create_env_file "$BASE_DIR/ddalab-web/scripts/db-setup" "db-setup"

# server/scripts
create_env_file "$BASE_DIR/server/scripts" "server-scripts"

echo "Environment setup complete."
