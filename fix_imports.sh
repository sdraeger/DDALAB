#!/bin/bash
# Script to fix import sorting using ruff

set -e  # Exit on error

# Check if ruff is installed
if ! command -v ruff &> /dev/null; then
    echo "Error: ruff is not installed. Installing it now..."
    pip install ruff
fi

echo "Running ruff import sorting..."
ruff check --select I --fix .

echo "Import sorting completed!" 