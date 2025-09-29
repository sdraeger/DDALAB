# DDALAB Release Guide

This guide explains how to build and release DDALAB for multiple platforms.

## Prerequisites

### Local Builds
- Node.js 20+ and npm
- Rust (latest stable)
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, build tools
  - **Windows**: Visual Studio Build Tools

### GitHub Releases
- GitHub CLI (`gh`) installed and authenticated
- Push access to the DDALAB repository

## Quick Start

### Build for Current Platform

```bash
cd packages/ddalab-tauri
npm run release
```

This builds the app for your current OS. Find artifacts in:
`packages/ddalab-tauri/src-tauri/target/release/bundle/`

### Build and Create GitHub Release

```bash
# From repository root
./scripts/build-and-release.sh
```

This will:
1. Build the app for your current platform
2. Create a draft GitHub release
3. Upload the build artifacts

## Release Methods

### Method 1: Manual Local Build

1. **Update Version**
   ```bash
   cd packages/ddalab-tauri
   # Edit package.json version
   # Edit src-tauri/Cargo.toml version
   ```

2. **Build Application**
   ```bash
   npm run release
   ```

3. **Create GitHub Release Manually**
   - Go to https://github.com/DDALAB/DDALAB/releases/new
   - Create tag: `v0.1.0` (match your version)
   - Upload artifacts from `src-tauri/target/release/bundle/`

### Method 2: Automated Script

1. **Update Version** (same as above)

2. **Run Release Script**
   ```bash
   ./scripts/build-and-release.sh
   ```

3. **Review and Publish**
   - Script creates a draft release
   - Review at GitHub releases page
   - Click "Publish release"

### Method 3: GitHub Actions (Recommended)

1. **Update Version** and commit

2. **Create and Push Tag**
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. **Automatic Build**
   - GitHub Actions builds for all platforms
   - Creates draft release with all artifacts
   - Review and publish on GitHub

### Method 4: Manual Workflow Trigger

1. Go to Actions tab on GitHub
2. Select "Release" workflow
3. Click "Run workflow"
4. Enter version number
5. Builds start automatically

## Platform-Specific Builds

### macOS Universal Binary
```bash
cd packages/ddalab-tauri
npm run release:mac
```
Creates universal binary for Intel and Apple Silicon.

### Cross-Platform Building

Cross-compilation is complex. Options:

1. **Use GitHub Actions** (recommended)
   - Builds on native runners for each OS
   - Most reliable method

2. **Use Multiple Machines**
   - Build on each target platform
   - Upload artifacts manually

3. **Docker (Linux only)**
   ```bash
   # TODO: Add Docker build script
   ```

## Build Artifacts

### macOS
- `.dmg` - Disk image installer
- `.app.tar.gz` - Compressed app bundle

### Linux
- `.AppImage` - Universal package
- `.deb` - Debian/Ubuntu package

### Windows
- `.msi` - Windows Installer
- `.exe` - NSIS installer

## Version Management

Always update version in these files:
1. `packages/ddalab-tauri/package.json`
2. `packages/ddalab-tauri/src-tauri/Cargo.toml`
3. `packages/ddalab-tauri/src-tauri/tauri.conf.json`

## Troubleshooting

### Build Fails on macOS
```bash
# Install Xcode Command Line Tools
xcode-select --install
```

### Build Fails on Linux
```bash
# Install dependencies
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

### GitHub CLI Not Authenticated
```bash
gh auth login
```

### Version Already Exists
Update version numbers before building.

## Release Checklist

- [ ] Update version in all files
- [ ] Run tests
- [ ] Build locally to verify
- [ ] Create release notes
- [ ] Tag the release
- [ ] Build for all platforms
- [ ] Upload artifacts
- [ ] Publish release
- [ ] Announce release

## Notes

- Always test builds locally first
- Use GitHub Actions for production releases
- Keep release notes updated
- Tag releases consistently (v0.1.0 format)
- Test installers before publishing