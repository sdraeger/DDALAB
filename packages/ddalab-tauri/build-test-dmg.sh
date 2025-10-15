#!/bin/bash

# Build a debug app bundle for testing (with DevTools enabled)

set -e

echo "🔧 Building DDALAB test build with DevTools enabled..."
echo ""

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Build Next.js app
echo "📦 Building Next.js frontend..."
npm run build

# Build Tauri app in debug mode (has DevTools enabled)
# We skip the DMG creation since it's failing, just create the .app bundle
echo "🦀 Building Tauri app in debug mode..."
cd src-tauri
~/.cargo/bin/cargo build

# Check if build succeeded
if [ ! -f "target/debug/ddalab-tauri" ]; then
    echo "❌ Build failed - binary not found"
    exit 1
fi

# Create .app bundle manually
echo "📦 Creating .app bundle..."
APP_NAME="DDALAB"
BUNDLE_DIR="target/debug/bundle/macos/${APP_NAME}.app"
CONTENTS_DIR="${BUNDLE_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"

# Clean and create directories
rm -rf "${BUNDLE_DIR}"
mkdir -p "${MACOS_DIR}"
mkdir -p "${RESOURCES_DIR}"

# Copy binary
cp "target/debug/ddalab-tauri" "${MACOS_DIR}/${APP_NAME}"

# Copy Next.js build
cp -r "../out" "${RESOURCES_DIR}/"

# Copy resources (DDA binary, etc)
cp "../../../bin/run_DDA_AsciiEdf" "${RESOURCES_DIR}/"
cp "popout.html" "${RESOURCES_DIR}/"

# Create Info.plist
cat > "${CONTENTS_DIR}/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>com.ddalab.desktop</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleVersion</key>
    <string>0.1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
</dict>
</plist>
EOF

cd ..

echo "✅ Debug build complete!"
echo ""
echo "📍 App location: src-tauri/${BUNDLE_DIR}"
echo ""
echo "🔍 DevTools enabled - use Cmd+Option+I or right-click → Inspect"
echo ""
echo "To run the app:"
echo "  open src-tauri/${BUNDLE_DIR}"
echo ""
echo "To create a DMG manually:"
echo "  cd src-tauri/target/debug/bundle/macos"
echo "  hdiutil create -volname ${APP_NAME}-Test -srcfolder ${APP_NAME}.app -ov -format UDZO ${APP_NAME}-Test.dmg"
