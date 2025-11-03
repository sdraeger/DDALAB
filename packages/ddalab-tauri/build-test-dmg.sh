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

# Generate .icns file from PNG icons
echo "🎨 Generating app icon..."
ICONSET_DIR="target/debug/icon.iconset"
rm -rf "${ICONSET_DIR}"
mkdir -p "${ICONSET_DIR}"

# Create iconset from PNG files (macOS needs specific sizes)
sips -z 16 16     icons/32x32.png --out "${ICONSET_DIR}/icon_16x16.png" > /dev/null 2>&1
sips -z 32 32     icons/32x32.png --out "${ICONSET_DIR}/icon_16x16@2x.png" > /dev/null 2>&1
sips -z 32 32     icons/32x32.png --out "${ICONSET_DIR}/icon_32x32.png" > /dev/null 2>&1
sips -z 64 64     icons/128x128.png --out "${ICONSET_DIR}/icon_32x32@2x.png" > /dev/null 2>&1
sips -z 128 128   icons/128x128.png --out "${ICONSET_DIR}/icon_128x128.png" > /dev/null 2>&1
sips -z 256 256   icons/128x128@2x.png --out "${ICONSET_DIR}/icon_128x128@2x.png" > /dev/null 2>&1
sips -z 256 256   icons/128x128@2x.png --out "${ICONSET_DIR}/icon_256x256.png" > /dev/null 2>&1
sips -z 512 512   icons/128x128@2x.png --out "${ICONSET_DIR}/icon_256x256@2x.png" > /dev/null 2>&1
sips -z 512 512   icons/128x128@2x.png --out "${ICONSET_DIR}/icon_512x512.png" > /dev/null 2>&1
# For 1024x1024, we'll just use the 512 upscaled as we don't have a larger source
sips -z 1024 1024 icons/128x128@2x.png --out "${ICONSET_DIR}/icon_512x512@2x.png" > /dev/null 2>&1

# Convert iconset to icns
iconutil -c icns "${ICONSET_DIR}" -o "${RESOURCES_DIR}/${APP_NAME}.icns"
rm -rf "${ICONSET_DIR}"

# Copy binary
cp "target/debug/ddalab-tauri" "${MACOS_DIR}/${APP_NAME}"

# Copy Next.js build
cp -r "../out" "${RESOURCES_DIR}/"

# Copy resources (DDA binary, etc)
mkdir -p "${RESOURCES_DIR}/bin"
cp "../../../bin/run_DDA_AsciiEdf" "${RESOURCES_DIR}/bin/"
cp "popout.html" "${RESOURCES_DIR}/"

# Make binaries executable
chmod +x "${MACOS_DIR}/${APP_NAME}"
chmod +x "${RESOURCES_DIR}/bin/run_DDA_AsciiEdf"

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
    <key>CFBundleIconFile</key>
    <string>${APP_NAME}.icns</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

# Code sign the app bundle (ad-hoc signing for development)
echo "🔐 Code signing app bundle..."
codesign --force --deep --sign - "${BUNDLE_DIR}"

if [ $? -eq 0 ]; then
    echo "✅ Code signing successful"
else
    echo "⚠️  Code signing failed, but app should still be usable"
fi

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
