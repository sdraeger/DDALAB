#!/bin/bash

###################################################################################
# build-linux.sh - Cross-compile dda-rs for Linux x86_64 (NSG Expanse)
###################################################################################
#
# This script cross-compiles dda-rs from macOS to Linux x86_64 for deployment
# on the NSG Expanse supercomputer.
#
# Prerequisites:
#   - Rust toolchain installed (rustup)
#   - Linux target added: rustup target add x86_64-unknown-linux-gnu
#
# Usage:
#   ./build-linux.sh              # Build release binary
#   ./build-linux.sh --debug      # Build debug binary
#   ./build-linux.sh --check      # Only check, don't build
#
###################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
BUILD_MODE="release"
CHECK_ONLY=false

for arg in "$@"; do
    case $arg in
        --debug)
            BUILD_MODE="debug"
            shift
            ;;
        --check)
            CHECK_ONLY=true
            shift
            ;;
        --help)
            echo "Usage: $0 [--debug] [--check] [--help]"
            echo ""
            echo "Options:"
            echo "  --debug    Build debug binary (faster compilation, larger binary)"
            echo "  --check    Only check compilation, don't build binary"
            echo "  --help     Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  dda-rs Linux Cross-Compilation Build Script${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${YELLOW}📋 Configuration:${NC}"
echo -e "   Package: dda-rs"
echo -e "   Target: x86_64-unknown-linux-gnu (NSG Expanse)"
echo -e "   Mode: $BUILD_MODE"
echo -e "   Check only: $CHECK_ONLY"
echo ""

# Check if rustup is installed
if ! command -v rustup &> /dev/null; then
    echo -e "${RED}❌ Error: rustup is not installed${NC}"
    echo -e "   Install from: https://rustup.rs/"
    exit 1
fi

echo -e "${YELLOW}🔍 Checking Rust toolchain...${NC}"

# Check if Linux target is installed
if ! rustup target list | grep "x86_64-unknown-linux-gnu (installed)" &> /dev/null; then
    echo -e "${YELLOW}⚠️  Linux target not installed. Installing...${NC}"
    rustup target add x86_64-unknown-linux-gnu
    echo -e "${GREEN}✅ Linux target installed${NC}"
else
    echo -e "${GREEN}✅ Linux target already installed${NC}"
fi

# Check for linker (optional but recommended)
if command -v x86_64-linux-gnu-gcc &> /dev/null; then
    echo -e "${GREEN}✅ Linux cross-compiler found${NC}"
else
    echo -e "${YELLOW}⚠️  Linux cross-compiler not found (using default)${NC}"
    echo -e "   Install with: brew install filosottile/musl-cross/musl-cross${NC}"
    echo -e "   (Optional - Rust can still cross-compile without it)${NC}"
fi

echo ""

# Build or check
if [ "$CHECK_ONLY" = true ]; then
    echo -e "${YELLOW}🔧 Running cargo check for Linux target...${NC}"
    cargo check --target x86_64-unknown-linux-gnu

    echo -e "${GREEN}✅ Check passed!${NC}"
else
    if [ "$BUILD_MODE" = "release" ]; then
        echo -e "${YELLOW}🔨 Building release binary for Linux...${NC}"
        cargo build --release --target x86_64-unknown-linux-gnu

        BINARY_PATH="target/x86_64-unknown-linux-gnu/release/dda-rs"
    else
        echo -e "${YELLOW}🔨 Building debug binary for Linux...${NC}"
        cargo build --target x86_64-unknown-linux-gnu

        BINARY_PATH="target/x86_64-unknown-linux-gnu/debug/dda-rs"
    fi

    echo ""

    if [ -f "$BINARY_PATH" ]; then
        BINARY_SIZE=$(du -h "$BINARY_PATH" | cut -f1)
        echo -e "${GREEN}✅ Build successful!${NC}"
        echo -e "${GREEN}   Binary: $BINARY_PATH${NC}"
        echo -e "${GREEN}   Size: $BINARY_SIZE${NC}"

        # Show file type
        echo ""
        echo -e "${YELLOW}📦 Binary information:${NC}"
        file "$BINARY_PATH"

        # Show dependencies (useful for debugging)
        echo ""
        echo -e "${YELLOW}🔗 Checking dynamic dependencies:${NC}"
        if command -v objdump &> /dev/null; then
            objdump -p "$BINARY_PATH" | grep NEEDED || echo "   (static binary - no dynamic dependencies)"
        else
            echo "   (objdump not available - install binutils to check dependencies)"
        fi

        echo ""
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}  ✓ Ready for NSG deployment${NC}"
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo -e "${YELLOW}Next steps:${NC}"
        echo -e "  1. The binary will be automatically embedded when building the Tauri app"
        echo -e "  2. Submit NSG job with parallel_cores > 1 to use this binary"
        echo -e "  3. Monitor NSG job output for execution confirmation"
        echo ""
    else
        echo -e "${RED}❌ Build failed - binary not found${NC}"
        exit 1
    fi
fi
