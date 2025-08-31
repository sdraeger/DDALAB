# Update Mechanism

The DDALAB ConfigManager includes a comprehensive update mechanism that checks for updates from the S3 bucket and prompts users for installation.

## Overview

The update mechanism automatically checks for updates from the S3 bucket (`ddalab-configmanager-updates`) and provides user-friendly prompts showing version information.

## Features

### ✅ **Automatic Update Detection**

- Checks for updates on startup (after 5 seconds)
- Monitors S3 bucket for new versions
- Environment-specific update channels (dev/beta/production)

### ✅ **User-Friendly Prompts**

- Shows current version vs new version
- Displays release date and notes
- Clear installation options

### ✅ **Manual Update Checks**

- UI component for manual update checks
- Real-time status updates
- Download progress tracking

### ✅ **Environment-Aware**

- Automatically detects app environment
- Configures correct S3 path and channel
- Supports dev/beta/production environments

## How It Works

### 1. **Environment Detection**

The app automatically detects its environment based on:

- App name (contains "Dev", "Beta", etc.)
- Version string (contains "dev", "beta", etc.)

### 2. **S3 Configuration**

Updates are fetched from:

- **Bucket**: `ddalab-configmanager-updates`
- **Region**: `us-east-1`
- **Channels**:
  - Development: `dev/development`
  - Beta: `beta/beta`
  - Production: `production/latest`

### 3. **Update Flow**

1. **Check**: App checks S3 for newer versions
2. **Prompt**: If update found, shows version comparison
3. **Download**: User can download update
4. **Install**: App restarts to install update

## User Experience

### **Update Available Dialog**

```
┌─────────────────────────────────────┐
│           Update Available          │
├─────────────────────────────────────┤
│ Current Version: 1.0.1-dev.1       │
│ New Version: 1.0.1-dev.2           │
│                                     │
│ Release Date: 2024-01-15           │
│                                     │
│ Release Notes:                      │
│ - Fixed icon generation issues      │
│ - Improved update mechanism         │
│                                     │
│ [Download Now] [Later] [Skip]      │
└─────────────────────────────────────┘
```

### **Update Ready Dialog**

```
┌─────────────────────────────────────┐
│      Update Ready to Install       │
├─────────────────────────────────────┤
│ Current Version: 1.0.1-dev.1       │
│ New Version: 1.0.1-dev.2           │
│                                     │
│ The application will restart to     │
│ install the update. Any unsaved     │
│ work will be lost.                  │
│                                     │
│ [Install Now] [Install Later]       │
└─────────────────────────────────────┘
```

## Technical Implementation

### **Core Components**

1. **AutoUpdateService** (`src/services/auto-update-service.ts`)

   - Manages electron-updater
   - Handles S3 configuration
   - Provides user prompts

2. **EnvironmentConfigService** (`src/services/environment-config-service.ts`)

   - Detects app environment
   - Configures update channels

3. **UpdateStatus Component** (`src/components/UpdateStatus.tsx`)
   - React UI for manual updates
   - Real-time status display

### **IPC Handlers** (`src/ipc/update-ipc.ts`)

- `check-for-updates`: Manual update check
- `get-update-info`: Get update information
- `get-current-version`: Get current app version
- `get-environment`: Get detected environment
- `download-update`: Trigger update download

### **Preload API** (`preload.ts`)

Exposes update methods to renderer process:

```typescript
window.electronAPI.checkForUpdates();
window.electronAPI.getCurrentVersion();
window.electronAPI.getEnvironment();
window.electronAPI.downloadUpdate();
```

## Configuration

### **Environment Variables**

The update mechanism uses the same S3 configuration as the publishing system:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `BUCKET_NAME=ddalab-configmanager-updates`
- `REGION=us-east-1`

### **Electron-Builder Configuration**

Each environment has its own configuration:

- `electron-builder.dev.json` - Development updates
- `electron-builder.beta.json` - Beta updates
- `electron-builder.production.json` - Production updates

## Usage

### **Automatic Updates**

Updates are checked automatically on startup. Users will see prompts when updates are available.

### **Manual Updates**

Users can manually check for updates using the UpdateStatus component in the UI.

### **Developer Testing**

To test the update mechanism:

1. **Publish a new version:**

   ```bash
   npm run publish:dev:mac
   ```

2. **Run the app:**

   ```bash
   npm start
   ```

3. **Check for updates:**
   - The app will automatically check after 5 seconds
   - Or use the manual check button in the UI

## Troubleshooting

### **Common Issues**

1. **Update not detected**

   - Check S3 bucket permissions
   - Verify environment configuration
   - Check network connectivity

2. **Download fails**

   - Check S3 bucket access
   - Verify file permissions
   - Check available disk space

3. **Installation fails**
   - Ensure app has write permissions
   - Check antivirus software
   - Verify code signing (if applicable)

### **Logs**

Update-related logs are available in:

- Main process logs (console)
- User data directory logs
- S3 access logs (if configured)

## Security

### **S3 Security**

- Uses AWS credentials for authentication
- Supports IAM roles and policies
- Encrypted in transit and at rest

### **Update Verification**

- Electron-updater verifies update signatures
- Checks file integrity
- Validates version compatibility

## Future Enhancements

### **Planned Features**

- [ ] Delta updates for smaller downloads
- [ ] Background update downloads
- [ ] Update rollback capability
- [ ] Custom update channels
- [ ] Update notifications

### **Configuration Options**

- [ ] Update check frequency
- [ ] Auto-download settings
- [ ] Update notification preferences
- [ ] Skip version options
