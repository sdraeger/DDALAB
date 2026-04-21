#!/bin/bash

# Build helper for the active DDALAB Python package + Qt GUI workflows.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CLI_WORKFLOW_FILE="build-python-package.yml"
GUI_WORKFLOW_FILE="build-qt.yml"

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_gh_cli() {
    if ! command -v gh &> /dev/null; then
        print_error "GitHub CLI (gh) is not installed."
        exit 1
    fi
}

check_gh_auth() {
    if ! gh auth status &> /dev/null; then
        print_error "Not authenticated with GitHub. Please run: gh auth login"
        exit 1
    fi
}

get_version() {
    python3 - <<'PY'
import tomllib
from pathlib import Path

payload = tomllib.loads(Path("packages/ddalab-cli/pyproject.toml").read_text(encoding="utf-8"))
print(payload["project"]["version"])
PY
}

trigger_workflow() {
    local workflow=$1
    print_status "Triggering ${workflow}..."
    gh workflow run "$workflow"
}

usage() {
    echo "Usage: $0"
    echo ""
    echo "Triggers the active DDALAB build workflows:"
    echo "  • ${CLI_WORKFLOW_FILE} (Python wheels)"
    echo "  • ${GUI_WORKFLOW_FILE} (Qt desktop bundles)"
    echo ""
    echo "The version is read from packages/ddalab-cli/pyproject.toml"
}

if [ "${1:-}" == "--help" ] || [ "${1:-}" == "-h" ]; then
    usage
    exit 0
fi

print_status "Starting DDALAB build trigger process..."
check_gh_cli
check_gh_auth

VERSION=$(get_version)
print_status "Current DDALAB version: ${VERSION}"

trigger_workflow "$CLI_WORKFLOW_FILE"
trigger_workflow "$GUI_WORKFLOW_FILE"

echo ""
print_success "Build workflows triggered successfully."
print_status "Monitor progress at:"
echo "  https://github.com/$(gh repo view --json owner,name --jq '.owner.login + \"/\" + .name')/actions"
