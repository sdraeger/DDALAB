#!/bin/bash
# Script to install pre-commit hooks

set -e  # Exit on error

# Check if pre-commit is installed
if ! command -v pre-commit &> /dev/null; then
    echo "Error: pre-commit is not installed. Installing it now..."
    pip install pre-commit
fi

# Install the pre-commit hooks
echo "Installing pre-commit hooks..."
pre-commit install

echo "Pre-commit hooks installed successfully!"
echo "The hooks will run automatically on git commit."
echo "You can also run them manually with: pre-commit run --all-files" 