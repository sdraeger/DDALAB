#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "Running Docker build test for DDALAB image..."

# Test building the DDALAB image
if docker build -t ddalab:test -f Dockerfile . > /dev/null 2>&1; then
    echo "DDALAB Docker image build test successful."
else
    echo "DDALAB Docker image build test failed!"
    exit 1
fi

echo "All Docker image build tests passed."

# Clean up test images
cleanup_test_images() {
    echo "Cleaning up test images..."
    docker rmi ddalab:test || true
}

trap cleanup_test_images EXIT

# Full build (optional, only if needed for further steps)
# echo "Building final Docker images..."
# docker build -t ddalab:latest -f Dockerfile .