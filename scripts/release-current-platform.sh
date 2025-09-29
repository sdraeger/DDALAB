#!/bin/bash

# Simple release script for current platform
# This builds and packages the Tauri app for the current OS

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}DDALAB Release Builder${NC}"
echo "========================"

# Change to Tauri directory
cd packages/ddalab-tauri

# Get current version
VERSION=$(node -p "require('./package.json').version")
echo -e "${BLUE}Building version:${NC} $VERSION"

# Clean previous builds
echo -e "${BLUE}Cleaning previous builds...${NC}"
rm -rf src-tauri/target/release/bundle

# Install dependencies
echo -e "${BLUE}Installing dependencies...${NC}"
npm install

# Build the application
echo -e "${BLUE}Building Tauri application...${NC}"
npm run tauri build

# Find and display built artifacts
echo -e "${GREEN}Build completed!${NC}"
echo -e "${BLUE}Built artifacts:${NC}"

BUNDLE_DIR="src-tauri/target/release/bundle"

# Check for macOS artifacts
if [ -f "$BUNDLE_DIR/dmg/"*.dmg ]; then
    echo "  - DMG: $(ls $BUNDLE_DIR/dmg/*.dmg)"
fi
if [ -d "$BUNDLE_DIR/macos/"*.app ]; then
    echo "  - App Bundle: $(ls -d $BUNDLE_DIR/macos/*.app)"
fi

# Check for Linux artifacts
if [ -f "$BUNDLE_DIR/appimage/"*.AppImage ]; then
    echo "  - AppImage: $(ls $BUNDLE_DIR/appimage/*.AppImage)"
fi
if [ -f "$BUNDLE_DIR/deb/"*.deb ]; then
    echo "  - DEB: $(ls $BUNDLE_DIR/deb/*.deb)"
fi

# Check for Windows artifacts
if [ -f "$BUNDLE_DIR/msi/"*.msi ]; then
    echo "  - MSI: $(ls $BUNDLE_DIR/msi/*.msi)"
fi
if [ -f "$BUNDLE_DIR/nsis/"*.exe ]; then
    echo "  - EXE: $(ls $BUNDLE_DIR/nsis/*.exe)"
fi

echo ""
echo -e "${GREEN}To create a GitHub release:${NC}"
echo "1. Go to https://github.com/YOUR_USERNAME/DDALAB/releases/new"
echo "2. Create a new tag: v$VERSION"
echo "3. Upload the artifacts from: packages/ddalab-tauri/src-tauri/target/release/bundle/"
echo ""
echo "Or use: gh release create v$VERSION <artifact_files>"