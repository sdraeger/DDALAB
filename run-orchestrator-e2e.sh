#!/bin/bash

# Script to run ConfigManager orchestrator E2E tests locally

set -e

echo "=============================================="
echo "Orchestrator E2E Test Runner (Local)"
echo "=============================================="

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

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18 or later."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version 18 or later is required. Current version: $(node -v)"
    exit 1
fi

# Change to ConfigManager directory
cd packages/configmanager

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    print_status "Installing dependencies..."
    npm install
fi

# Build ConfigManager if needed
if [ ! -d "dist" ] || [ ! -f "dist/main.js" ]; then
    print_status "Building ConfigManager..."
    npm run build
fi

# Install Playwright browsers if needed
print_status "Ensuring Playwright browsers are installed..."
npx playwright install --with-deps

# Create test results directory
mkdir -p test-results

# Set environment variables for local testing
export ELECTRON_IS_TESTING=true
export NODE_ENV=test
export DDALAB_E2E_PLATFORM=$(uname | tr '[:upper:]' '[:lower:]')

# Run the orchestrator E2E tests
print_status "Running Orchestrator E2E tests..."
if npm run test:e2e -- --config=playwright-orchestrator.config.ts; then
    print_status "Orchestrator E2E tests completed successfully!"
    TEST_RESULT=0
else
    print_error "Orchestrator E2E tests failed!"
    TEST_RESULT=1
fi

# Show test results location
if [ -d "test-results" ]; then
    print_status "Test results available in: packages/configmanager/test-results/"
fi

if [ -d "playwright-report" ]; then
    print_status "Playwright report available in: packages/configmanager/playwright-report/"
    print_status "To view the report, run: npx playwright show-report"
fi

# Exit with the test result code
exit $TEST_RESULT