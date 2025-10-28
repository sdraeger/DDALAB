#!/bin/bash

###################################################################################
# build-nsg-binaries.sh - Build all binaries needed for NSG deployment
###################################################################################
#
# This script builds all the necessary components for NSG job submission:
#   1. dda-rs Linux binary (cross-compiled for NSG Expanse)
#   2. Tauri app (with embedded NSG resources)
#
# Usage:
#   ./build-nsg-binaries.sh              # Build all binaries
#   ./build-nsg-binaries.sh --check      # Check compilation only
#   ./build-nsg-binaries.sh --skip-tauri # Only build dda-rs Linux binary
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
SKIP_TAURI=false

for arg in "$@"; do
    case $arg in
        --check)
            CHECK_ONLY=true
            shift
            ;;
        --skip-tauri)
            SKIP_TAURI=true
            shift
            ;;
        --help)
            echo "Usage: $0 [--check] [--skip-tauri] [--help]"
            echo ""
            echo "Options:"
            echo "  --check       Only check compilation, don't build binaries"
            echo "  --skip-tauri  Only build dda-rs, skip Tauri app"
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
echo -e "${YELLOW}[1/2] Building dda-rs for Linux (NSG Expanse)...${NC}"
echo ""

cd "$REPO_ROOT/packages/dda-rs"

if [ "$CHECK_ONLY" = true ]; then
    ./build-linux.sh --check
else
    ./build-linux.sh --release
fi

echo ""

# Step 2: Build Tauri app (which embeds the Linux binary)
if [ "$SKIP_TAURI" = false ]; then
    echo -e "${YELLOW}[2/2] Building Tauri app (with embedded NSG resources)...${NC}"
    echo ""

    cd "$REPO_ROOT/packages/ddalab-tauri/src-tauri"

    if [ "$CHECK_ONLY" = true ]; then
        cargo check
    else
        echo -e "${YELLOW}Note: Full Tauri build can take several minutes...${NC}"
        cargo build --release
    fi

    echo ""
    echo -e "${GREEN}✅ All builds completed successfully!${NC}"
else
    echo -e "${YELLOW}[2/2] Skipping Tauri build (--skip-tauri specified)${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ NSG binaries ready for deployment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Summary:${NC}"
echo -e "  dda-rs Linux binary: packages/dda-rs/target/x86_64-unknown-linux-gnu/release/dda-rs"
if [ "$SKIP_TAURI" = false ]; then
    echo -e "  Tauri app: packages/ddalab-tauri/src-tauri/target/release/ddalab-tauri"
fi
echo ""
echo -e "${YELLOW}Usage:${NC}"
echo -e "  1. Launch the Tauri app"
echo -e "  2. Configure NSG credentials in Settings"
echo -e "  3. Set parallel_cores > 1 in DDA Analysis parameters"
echo -e "  4. Click 'Submit to NSG' - the Linux binary will be automatically bundled"
echo ""
