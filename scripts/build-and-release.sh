#!/bin/bash

# Build and Release Script for DDALAB Tauri Application
# This script triggers a GitHub Actions workflow to build and release the Tauri app

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="DDALAB"
WORKFLOW_FILE="release.yml"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if gh CLI is installed
check_gh_cli() {
    if ! command -v gh &> /dev/null; then
        print_error "GitHub CLI (gh) is not installed. Please install it first:"
        echo "  macOS: brew install gh"
        echo "  Linux: See https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
        echo "  Windows: winget install --id GitHub.cli"
        exit 1
    fi
}

# Check if we're authenticated with GitHub
check_gh_auth() {
    if ! gh auth status &> /dev/null; then
        print_error "Not authenticated with GitHub. Please run: gh auth login"
        exit 1
    fi
}

# Get the current version from package.json
get_version() {
    VERSION=$(node -p "require('./packages/ddalab-tauri/package.json').version")
    if [ -z "$VERSION" ]; then
        print_error "Could not read version from package.json"
        exit 1
    fi
    echo "$VERSION"
}

# Check if version tag already exists
check_version_exists() {
    local version=$1
    if gh release view "v$version" &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# Trigger GitHub Actions workflow
trigger_release_workflow() {
    local version=$1
    local prerelease=$2

    print_status "Triggering GitHub Actions release workflow..."

    # Trigger the workflow dispatch
    gh workflow run "$WORKFLOW_FILE" \
        --field version="$version" \
        --field prerelease="$prerelease"

    print_success "Release workflow triggered successfully!"
    print_status "Version: $version"
    print_status "Pre-release: $prerelease"

    # Wait a moment for the workflow to start
    sleep 3

    # Show workflow runs
    print_status "Recent workflow runs:"
    gh run list --workflow="$WORKFLOW_FILE" --limit=3

    echo ""
    print_status "You can monitor the build progress at:"
    echo "  https://github.com/$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')/actions"
    echo ""
    print_status "Once the workflow completes, the draft release will be published automatically."
}

# Main function
main() {
    print_status "Starting DDALAB release process..."

    # Check prerequisites
    check_gh_cli
    check_gh_auth

    # Get version
    VERSION=$(get_version)
    print_status "Release version: $VERSION"

    # Parse arguments
    PRERELEASE=${1:-"false"}

    if [ "$PRERELEASE" != "true" ] && [ "$PRERELEASE" != "false" ]; then
        print_error "Invalid prerelease argument. Use 'true' or 'false'"
        usage
        exit 1
    fi

    # Check if version already exists
    if check_version_exists "$VERSION"; then
        print_warning "Release v$VERSION already exists!"
        echo "Existing release:"
        gh release view "v$VERSION" --json url,name,publishedAt --template '{{.name}} - {{.publishedAt}} - {{.url}}'
        echo ""
        read -p "Do you want to continue and re-trigger the workflow anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Aborted by user"
            exit 0
        fi
    fi

    # Trigger the GitHub Actions workflow
    trigger_release_workflow "$VERSION" "$PRERELEASE"

    print_success "Release process initiated!"
    print_status "The GitHub Actions workflow will:"
    echo "  1. Build Tauri app for all platforms (macOS, Linux, Windows)"
    echo "  2. Create a draft release with all artifacts"
    echo "  3. Automatically publish the release when builds complete"
}

# Show usage
usage() {
    echo "Usage: $0 [true|false]"
    echo "  true   - Create a pre-release"
    echo "  false  - Create a stable release (default)"
    echo ""
    echo "This script triggers a GitHub Actions workflow that:"
    echo "  • Builds the Tauri app for all platforms"
    echo "  • Creates a GitHub release with all artifacts"
    echo "  • Handles cross-platform compilation automatically"
    echo ""
    echo "The version is read from packages/ddalab-tauri/package.json"
    echo ""
    echo "Prerequisites:"
    echo "  • GitHub CLI (gh) must be installed and authenticated"
    echo "  • Must be run from the repository root directory"
}

# Check arguments
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    usage
    exit 0
fi

# Run main function
main "$@"
