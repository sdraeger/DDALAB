---
sidebar_position: 1
---

# Installation

This guide covers installing DDALAB on your system.

## System Requirements

### Minimum Requirements

- **Operating System**: macOS 12+, Windows 10+, or Linux (Ubuntu 20.04+)
- **RAM**: 8 GB
- **Storage**: 500 MB free space
- **Display**: 1280x800 resolution

### Recommended

- **RAM**: 16 GB or more for large datasets
- **Storage**: SSD for better performance
- **Display**: 1920x1080 or higher

## Installation Methods

### macOS

1. Download the latest `.dmg` file from the [GitHub Releases](https://github.com/sdraeger/DDALAB/releases)
2. Open the DMG file
3. Drag DDALAB to your Applications folder
4. Launch DDALAB from Applications

:::note Apple Silicon
DDALAB provides universal binaries that run natively on both Intel and Apple Silicon Macs.
:::

### Windows

1. Download the latest `.msi` installer from [GitHub Releases](https://github.com/sdraeger/DDALAB/releases)
2. Run the installer
3. Follow the installation wizard
4. Launch DDALAB from the Start Menu

### Linux

#### AppImage (Recommended)

```bash
# Download the AppImage
wget https://github.com/sdraeger/DDALAB/releases/latest/download/ddalab.AppImage

# Make it executable
chmod +x ddalab.AppImage

# Run
./ddalab.AppImage
```

#### Debian/Ubuntu

```bash
# Download the .deb package
wget https://github.com/sdraeger/DDALAB/releases/latest/download/ddalab.deb

# Install
sudo dpkg -i ddalab.deb
```

## Building from Source

For development or custom builds:

### Prerequisites

- Node.js 20+
- Rust 1.75+
- npm 10+

### Build Steps

```bash
# Clone the repository
git clone https://github.com/sdraeger/DDALAB.git
cd DDALAB

# Install dependencies
npm install

# Navigate to Tauri package
cd packages/ddalab-tauri

# Development mode
npm run tauri:dev

# Production build
npm run desktop:build
```

## Verifying Installation

After installation, launch DDALAB and verify:

1. The main window opens without errors
2. You can access File > Open to browse for files
3. The Settings panel is accessible

## Troubleshooting

### macOS: "App is damaged and can't be opened"

This occurs due to Gatekeeper. Run:

```bash
xattr -d com.apple.quarantine /Applications/DDALAB.app
```

### Windows: SmartScreen Warning

Click "More info" then "Run anyway" on first launch.

### Linux: Missing Libraries

Install required dependencies:

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0
```

## Next Steps

- [Quick Start Guide](./quick-start) - Load your first file
- [First Analysis](./first-analysis) - Run your first DDA analysis
