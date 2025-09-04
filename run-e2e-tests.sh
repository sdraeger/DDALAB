#!/bin/bash

# Script to run ConfigManager e2e tests in Docker-in-Docker environment

set -e

echo "========================================"
echo "ConfigManager E2E Test Runner"
echo "========================================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[STATUS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

# Create output directory
mkdir -p e2e-output

# Clean up any previous test results
rm -rf e2e-output/*

print_status "Building Docker image for e2e tests..."

# Build the Docker image
docker-compose -f docker-compose.e2e.yml build

print_status "Running ConfigManager e2e tests..."

# Run the tests (using Ubuntu-based image by default)
export E2E_DOCKERFILE=Dockerfile.e2e-ubuntu
if docker-compose -f docker-compose.e2e.yml run --rm e2e-tests; then
    print_status "E2E tests completed successfully!"
    TEST_RESULT=0
else
    print_error "E2E tests failed!"
    TEST_RESULT=1
fi

# Clean up
print_status "Cleaning up Docker containers..."
docker-compose -f docker-compose.e2e.yml down

# Check if we have test results
if [ -d "e2e-output/test-results" ]; then
    print_status "Test results available in: e2e-output/test-results/"
fi

if [ -d "e2e-output/playwright-report" ]; then
    print_status "Playwright report available in: e2e-output/playwright-report/"
    print_status "To view the report, run: npx playwright show-report e2e-output/playwright-report"
fi

# Exit with the test result code
exit $TEST_RESULT
