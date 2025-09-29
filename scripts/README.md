# DDALAB Scripts

Essential scripts for DDALAB development and deployment.

## Release & Build

### `build-and-release.sh`
Triggers GitHub Actions workflow to build and release the Tauri desktop application.

```bash
# Create stable release
./scripts/build-and-release.sh false

# Create pre-release
./scripts/build-and-release.sh true
```

**Features:**
- Cross-platform builds (macOS, Linux, Windows)
- Automatic GitHub release creation
- Multi-architecture support (Intel + Apple Silicon)
- Generated artifacts: `.dmg`, `.AppImage`, `.deb`, `.msi`

## Development

### `start-api-only.sh`
Starts the DDALAB API server and dependencies for Tauri desktop development.

```bash
# Start API server
./scripts/start-api-only.sh

# Stop API server
./scripts/start-api-only.sh down

# View logs
./scripts/start-api-only.sh logs
```

**Services:**
- API Server: `http://localhost:8000`
- PostgreSQL: `localhost:5433`
- Redis: `localhost:6380`
- MinIO: `http://localhost:9003`

**Perfect for Tauri development** - provides backend API without full web interface.

## Usage

All scripts should be run from the repository root:

```bash
cd /path/to/DDALAB
./scripts/build-and-release.sh false
./scripts/start-api-only.sh
```
