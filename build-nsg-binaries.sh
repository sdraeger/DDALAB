#!/bin/bash

###################################################################################
# build-nsg-binaries.sh - Build binaries needed for NSG deployment
###################################################################################
#
# This script builds the Linux-facing analysis binary used for NSG job submission.
#
# Usage:
#   ./build-nsg-binaries.sh              # Build dda-rs Linux binary
#   ./build-nsg-binaries.sh --check      # Check compilation only
#
###################################################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
CHECK_ONLY=false

for arg in "$@"; do
    case $arg in
        --check)
            CHECK_ONLY=true
            shift
            ;;
        --help)
            echo "Usage: $0 [--check] [--help]"
            echo ""
            echo "Options:"
            echo "  --check       Only check compilation, don't build binaries"
            echo "  --help        Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  DDALAB NSG Build Pipeline${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get repo root
REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Step 1: Build dda-rs Linux binary
echo -e "${YELLOW}[1/1] Building dda-rs for Linux (NSG Expanse)...${NC}"
echo ""

cd "$REPO_ROOT/packages/dda-rs"

if [ "$CHECK_ONLY" = true ]; then
    ./build-linux.sh --check
else
    ./build-linux.sh --release
fi

echo ""

echo ""
echo -e "${GREEN}✅ Build completed successfully!${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ NSG binaries ready for deployment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Summary:${NC}"
echo -e "  dda-rs Linux binary: packages/dda-rs/target/x86_64-unknown-linux-gnu/release/dda-rs"
echo -e "  Archived desktop shells are now stored in packages/archive/"
echo ""
echo -e "${YELLOW}Usage:${NC}"
echo -e "  1. Launch the active Qt GUI from packages/ddalab"
echo -e "  2. Configure NSG credentials in Settings"
echo -e "  3. Set parallel_cores > 1 in DDA Analysis parameters"
echo -e "  4. Click 'Submit to NSG' - the Linux binary will be automatically bundled"
echo ""
