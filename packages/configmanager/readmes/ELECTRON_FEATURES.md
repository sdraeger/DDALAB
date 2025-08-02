# DDALAB ConfigManager Electron Features

This document describes the enhanced Electron features implemented in the DDALAB ConfigManager.

## Features Overview

### 1. Docker Installation Self-Check

The application automatically checks for Docker installation on startup and provides clear GUI instructions if Docker isn't installed.

#### Features:

- **Automatic Detection**: Checks for both `docker` and `docker compose` commands
- **Version Information**: Displays Docker and Docker Compose versions when available
- **Platform-Specific Instructions**: Provides installation instructions tailored to the user's operating system
- **GUI Integration**: Shows installation status and instructions in the main application window

#### Implementation:

- `DockerService.checkDockerInstallation()` - Checks Docker installation status
- `DockerService.getDockerInstallationInstructions()` - Returns platform-specific installation instructions
- `DockerInstallationCheck` React component - Displays status and instructions in the UI

### 2. System Tray Support

The application provides system tray functionality for easy access to start/stop Docker services.

#### Features:

- **Tray Icon**: Shows application status in the system tray
- **Context Menu**: Right-click menu with options to:
  - Show/Hide main window
  - Start/Stop Docker services
  - Check Docker installation
  - Quit application
- **Status Indicators**: Tray icon tooltip shows Docker service status
- **Easy Access**: Click tray icon to toggle main window visibility

#### Implementation:

- `SystemTrayService` - Manages system tray functionality
- Tray icon with context menu
- Integration with Docker service status
- Window management integration

### 3. Auto-Update Support

The application includes automatic update functionality with both automatic and manual update options.

#### Features:

- **Automatic Checks**: Checks for updates on startup (after 5 seconds)
- **Manual Checks**: Users can manually check for updates
- **Download Control**: Users choose when to download updates
- **Installation Prompts**: Clear prompts for update installation
- **Fallback Options**: Manual download option if automatic download fails
- **Progress Tracking**: Shows download progress with percentage
- **Error Handling**: Graceful handling of update errors

#### Implementation:

- `AutoUpdateService` - Manages update functionality
- `electron-updater` integration
- Update status tracking and UI updates
- Manual download fallback

## Technical Implementation

### Dependencies Added

```json
{
  "electron-updater": "^6.1.8",
  "electron-store": "^8.1.0"
}
```

### New Services

1. **DockerService** (Enhanced)

   - `checkDockerInstallation()` - Check Docker installation
   - `getDockerInstallationInstructions()` - Get platform-specific instructions

2. **SystemTrayService** (New)

   - `initialize()` - Initialize system tray
   - `updateTrayIcon()` - Update tray icon status
   - `destroy()` - Clean up tray resources

3. **AutoUpdateService** (New)
   - `initialize()` - Initialize auto-updater
   - `checkForUpdates()` - Check for available updates
   - `forceCheckForUpdates()` - Force update check

### IPC Handlers

1. **Docker Check IPC** (`docker-check-ipc.ts`)

   - `check-docker-installation` - Check Docker installation
   - `get-docker-installation-instructions` - Get installation instructions

2. **Update IPC** (`update-ipc.ts`)
   - `check-for-updates` - Check for updates
   - `get-update-info` - Get update information
   - `is-update-available` - Check if update is available

### React Components

1. **DockerInstallationCheck**

   - Displays Docker installation status
   - Shows installation instructions when needed
   - Provides refresh functionality

2. **AutoUpdateStatus**
   - Shows update status and progress
   - Allows manual update checks
   - Displays update information

## Configuration

### Electron Builder Configuration

The `package.json` includes enhanced electron-builder configuration:

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "ddalab",
      "repo": "configmanager"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    }
  }
}
```

### Auto-Update Configuration

- `autoDownload: false` - Don't auto-download updates
- `autoInstallOnAppQuit: true` - Install updates when app quits
- Manual download prompts for user control

## Usage

### Docker Installation Check

The application automatically checks Docker installation on startup. If Docker is not installed:

1. A notification appears in the main window
2. Installation instructions are displayed
3. Users can click "Download Docker Desktop" to open the download page
4. The check can be refreshed manually

### System Tray Usage

1. **Show/Hide Window**: Click the tray icon or use "Show/Hide Window" from context menu
2. **Docker Services**: Use "Start Docker Services" or "Stop Docker Services" from context menu
3. **Docker Check**: Use "Check Installation" to verify Docker installation
4. **Quit**: Use "Quit" to close the application

### Auto-Update Usage

1. **Automatic**: Updates are checked automatically on startup
2. **Manual**: Use "Check for Updates" button in the UI
3. **Download**: Choose to download when prompted
4. **Install**: Choose to install when download completes

## Development

### Building Icons

```bash
npm run build-icons
```

### Development Mode

```bash
npm run dev
```

### Packaging

```bash
# All platforms
npm run package

# Specific platforms
npm run package:mac
npm run package:win
npm run package:linux

# Publish to GitHub releases
npm run publish
```

## Platform Support

### macOS

- System tray support with native menu
- Docker Desktop installation instructions
- DMG packaging

### Windows

- System tray support with native menu
- Docker Desktop installation instructions
- NSIS installer with custom options

### Linux

- System tray support with native menu
- Platform-specific Docker installation instructions
- AppImage packaging

## Troubleshooting

### Docker Installation Issues

1. Check if Docker Desktop is running
2. Verify PATH environment variable includes Docker
3. Restart the application after Docker installation
4. Check Docker Desktop file sharing settings

### Auto-Update Issues

1. Check internet connectivity
2. Verify GitHub repository access
3. Check application permissions
4. Use manual download as fallback

### System Tray Issues

1. Check if system tray is supported on the platform
2. Verify tray icon permissions
3. Restart the application if tray doesn't appear
