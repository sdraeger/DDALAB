# macOS Setup Instructions

## If you get "App is damaged" error

If you still encounter the "App is damaged and can't be opened" error on macOS, follow these steps:

### Option 1: Using System Preferences (Recommended for local development)

1. Go to **System Preferences** → **Security & Privacy** → **General**
2. Look for a message about the blocked app near the bottom
3. Click **"Open Anyway"** next to the app name

### Option 2: Using Terminal (Alternative method)

1. Open Terminal
2. Navigate to the Applications folder or wherever you installed the app
3. Run: `sudo xattr -r -d com.apple.quarantine "DDALAB ConfigManager (Dev).app"`
4. Enter your password when prompted
5. Try opening the app again

### Option 3: Temporary bypass for current session

```bash
sudo spctl --master-disable
# Run your app
sudo spctl --master-enable
```

## Why this happens

macOS has security features (Gatekeeper) that prevent unsigned applications from running. For development builds, we:

- Set `identity: false` to skip code signing
- Set `hardenedRuntime: false` for development convenience
- Set `gatekeeperAssess: false` to bypass some checks
- Use development entitlements that allow more permissive execution

For production builds, you would need proper Apple Developer certificates and notarization.

## S3 Download Quarantine Fix

If you download the app from S3 and get "damaged app" errors, this is due to macOS quarantine attributes:

### Fix for Downloaded DMG files:

```bash
# Remove quarantine from downloaded DMG before mounting
xattr -r -d com.apple.quarantine ~/Downloads/DDALAB-ConfigManager-Dev-*.dmg

# Or remove quarantine from specific DMG
xattr -r -d com.apple.quarantine "path/to/your/downloaded.dmg"
```

### Fix for Installed Apps:

```bash
# Remove quarantine from installed app
sudo xattr -r -d com.apple.quarantine "/Applications/DDALAB ConfigManager (Dev).app"
```

This happens because S3 downloads are marked with `com.apple.provenance` attributes that trigger macOS security warnings.

## Icon Information

The app now uses the default Electron icon as requested. To use a custom icon in the future:

1. Add `"icon": "build/icon.icns"` to the mac section in the electron-builder config
2. Ensure you have a proper .icns file in the build directory

## S3 Upload Fixes

If you experienced "damaged" DMG files after downloading from S3, this has been fixed by:

### Changes Made:

- **ACL**: Set to `null` to disable ACL usage (bucket has ACLs disabled)
- **Storage Class**: Set to `"STANDARD"` for optimal binary file handling
- **Cache Headers**: Added `Cache-Control` headers for better download performance

### Verification:

Use the provided verification script to check DMG integrity:

```bash
# Check local DMG files
./verify-s3-dmg.sh auto

# Compare local vs S3 versions after upload
./verify-s3-dmg.sh compare release-dev/app.dmg dev/app.dmg

# Check specific S3 DMG
./verify-s3-dmg.sh s3 dev/DDALAB-ConfigManager-Dev-1.0.1-dev.1-arm64.dmg
```

### Root Cause:

The S3 bucket has ACLs disabled, but electron-builder was trying to set ACL permissions by default. Setting `"acl": null` explicitly disables ACL usage and allows uploads to succeed without corruption.
