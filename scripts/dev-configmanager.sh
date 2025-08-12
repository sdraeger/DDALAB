#!/bin/bash

# DDALAB ConfigManager Development Launcher
# This script launches the configmanager in development mode with hot reloading

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIGMANAGER_DIR="$PROJECT_ROOT/packages/configmanager"

print_status "Starting DDALAB ConfigManager in development mode..."
print_status "Project root: $PROJECT_ROOT"
print_status "ConfigManager directory: $CONFIGMANAGER_DIR"

# Check if we're in the right directory
if [ ! -f "$CONFIGMANAGER_DIR/package.json" ]; then
    print_error "ConfigManager package.json not found at $CONFIGMANAGER_DIR"
    print_error "Please run this script from the DDALAB project root directory"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "$CONFIGMANAGER_DIR/node_modules" ]; then
    print_warning "Dependencies not installed. Installing now..."
    cd "$CONFIGMANAGER_DIR"
    npm install
    cd "$PROJECT_ROOT"
fi

# Navigate to configmanager directory
cd "$CONFIGMANAGER_DIR"

print_status "Starting development mode with hot reloading..."
print_status "Press Ctrl+C to stop the development server"

# Start the development server
npm run dev 