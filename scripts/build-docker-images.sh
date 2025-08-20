#!/bin/bash

# DDALAB Docker Image Builder and Pusher
# This script builds and pushes Docker images from the root directory with correct context

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# --- Configuration ---
DOCKER_HUB_USERNAME="sdraeger1"

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

print_status "Building and pushing DDALAB Docker images..."
print_status "Project root: $PROJECT_ROOT"
print_status "Docker Hub Username: $DOCKER_HUB_USERNAME"

# Check if we're in the right directory
if [ ! -f "$PROJECT_ROOT/docker-compose.yml" ]; then
    print_error "docker-compose.yml not found at $PROJECT_ROOT"
    print_error "Please run this script from the DDALAB project root directory"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

# Check if Docker Hub credentials are set (basic check)
if [ -z "$DOCKER_HUB_USERNAME" ]; then
    print_error "DOCKER_HUB_USERNAME is not set in the script."
    print_error "Please edit the script and set your Docker Hub username."
    exit 1
fi

# Function to build and push an image
build_and_push_image() {
    local service_name=$1
    local dockerfile_path=$2
    local image_name_tag=$3 # e.g., "username/image-name:tag"
    local build_context=$4
    
    print_status "Building $service_name image..."
    
    if [ -z "$build_context" ]; then
        build_context="."
    fi
    
    # Build the monolithic DDALAB image
    docker build \
        --file Dockerfile \
        --tag sdraeger1/ddalab:latest . \
        --platform linux/amd64

    echo "Docker images built successfully."
} 
