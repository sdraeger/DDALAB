# DDALAB Tauri Desktop Application

A desktop application for DDALAB (Delay Differential Analysis Laboratory) built with Next.js and Tauri.

## Features

- **Cross-platform desktop app** for Windows, macOS, and Linux
- **Native file system access** for EDF and ASCII file management
- **Offline capabilities** with local preferences storage
- **System notifications** for analysis completion
- **System tray integration** for background operation
- **Native menus** and window management
- **Secure API communication** with the Python backend

## Architecture

- **Frontend**: Next.js 15 with React 18 and TypeScript
- **Desktop Framework**: Tauri (Rust-based)
- **UI Components**: Radix UI with Tailwind CSS
- **API Integration**: RESTful communication with Python FastAPI backend
- **State Management**: React hooks with persistent preferences

## Development

### Prerequisites

- Node.js 18+ and npm
- Rust (latest stable)
- DDALAB Python API server running

### Install Dependencies

```bash
npm install
```

### Development Mode

**Option 1: All-in-one (Recommended)**

```bash
# Start API server and desktop app together
npm run desktop:with-api
```

**Option 2: Manual control**

```bash
# Start API server first
npm run api:start

# Then start desktop app (in another terminal)
npm run desktop:dev

# View API logs
npm run api:logs

# Stop API server
npm run api:stop
```

**Option 3: Desktop app only (API must be running elsewhere)**

```bash
npm run dev          # Next.js only (web browser)
npm run tauri:dev    # Tauri desktop app
```

**Option 4: From project root (API only)**

```bash
# Start just the API server and dependencies
./scripts/start-api-only.sh up

# Stop API server
./scripts/start-api-only.sh down
```

### Building for Production

```bash
# Build web app and desktop installer
npm run desktop:build

# Or build separately:
npm run build        # Next.js static export
npm run tauri:build  # Desktop app bundle
```

## Project Structure

```
src/
├── app/                 # Next.js app router
├── components/          # React components
│   ├── ui/             # Reusable UI components
│   ├── DashboardLayout.tsx
│   └── WelcomeScreen.tsx
├── services/           # API and Tauri services
│   ├── apiService.ts   # Python API client
│   └── tauriService.ts # Native desktop APIs
└── types/              # TypeScript definitions

src-tauri/
├── src/
│   └── main.rs         # Rust application entry
├── icons/              # App icons (various formats)
├── Cargo.toml          # Rust dependencies
└── tauri.conf.json     # Tauri configuration
```

## Configuration

### API Connection

The app automatically attempts to connect to the Python API server at `http://localhost:8000`. This can be configured in the welcome screen or through the desktop app preferences.

### File Access

The app has permission to access:

- Documents folder
- Downloads folder
- Desktop folder
- Application data folder

### Desktop Features

- **System Tray**: Minimize to tray, show/hide window
- **Native Dialogs**: File picker, notifications, alerts
- **Window Management**: Minimize, maximize, close
- **Auto-updater**: Ready for future OTA updates

## Building Icons

To generate proper app icons from a source image:

```bash
npm run tauri:icon path/to/icon.png
```

This creates all required icon formats in `src-tauri/icons/`.

## Distribution

### Development Builds

Development builds include debugging symbols and are larger:

```bash
npm run desktop:build
```

### Production Builds

For production releases, use the release flag:

```bash
npm run tauri:build -- --release
```

This creates optimized installers in `src-tauri/target/release/bundle/`.

## Integration with Main DDALAB

This Tauri app connects to the main DDALAB Python API server. Ensure the server is running:

```bash
# From the main DDALAB directory
npm run dev  # Starts all services including API
```

The desktop app provides the same functionality as the web interface but with:

- Native file system access
- Offline preference storage
- System-level integration
- Better performance for large files

## Troubleshooting

### Connection Issues

1. Verify Python API server is running on the correct port
2. Check firewall settings allow local connections
3. Try different API URL in app settings

### Build Issues

1. Ensure Rust is installed: `rustc --version`
2. Update Tauri CLI: `npm install @tauri-apps/cli@latest`
3. Clear build cache: `rm -rf src-tauri/target`

### File Access Issues

1. Check app permissions in system settings
2. Verify file paths are within allowed scopes
3. Run app as administrator if needed (Windows)
