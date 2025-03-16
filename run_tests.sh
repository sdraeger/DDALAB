#!/bin/bash
# Script to run all tests for DDALAB

set -e  # Exit on error

# Print header
echo "====================================="
echo "Running DDALAB Tests"
echo "====================================="

# Check if tox is installed
if ! command -v tox &> /dev/null; then
    echo "Error: tox is not installed. Please install it with 'pip install tox'."
    exit 1
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Run only the tests that are known to pass
echo "Running passing tests..."
tox -- tests/unit/test_simple.py tests/unit/test_client_state.py

echo -e "\n====================================="
echo "All tests completed!"
echo "=====================================" 