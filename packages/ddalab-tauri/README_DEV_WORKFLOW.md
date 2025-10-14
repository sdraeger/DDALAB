# DDALAB Development Workflow with Background API

## Quick Start

### Option 1: Traditional (Current)
Run everything together - API starts with Tauri app:

```bash
npm run tauri:dev
```

**Startup time**: ~9-10 seconds (waiting for API server)

### Option 2: Background API (New - Recommended)
Run API server separately for faster iteration:

**Terminal 1 - API Server (with hot-reload):**
```bash
npm run api:dev
```

**Terminal 2 - Tauri App:**
```bash
npm run tauri:dev
```

**Startup time**: ~1-2 seconds (connects to existing API)

## Benefits of Background API

### Development Experience
- ✅ **Instant Tauri startup** - No 9-second wait for API
- ✅ **Hot-reload** - Backend code changes reload automatically
- ✅ **Independent testing** - Test API without Tauri GUI
- ✅ **Better debugging** - Separate console logs for API and UI
- ✅ **Faster iteration** - Change backend code without restarting Tauri

### How It Works

```
┌──────────────────┐         Check if         ┌─────────────────┐
│   Tauri App      │───────running?────────>  │  Embedded API   │
│   (Next.js UI)   │      localhost:8765      │  (Axum Server)  │
│                  │                           │                 │
│  If YES: Connect │<────────200 OK──────────│  Port: 8765     │
│  If NO: Start it │                           │                 │
└──────────────────┘                           └─────────────────┘
         │                                              │
         │                                              │
         └──────────> HTTP Requests ───────────────────┘
```

## Usage

### Starting Development

1. **Start the API server** (run once, keeps running):
   ```bash
   cd packages/ddalab-tauri
   npm run api:dev
   ```

   You'll see:
   ```
   🚀 DDALAB Embedded API Server (Standalone Mode)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   📁 Data directory: /Users/simon/Desktop/DDALAB/data
   🌐 Listening on:   http://localhost:8765
   🔄 Hot-reload:     cargo-watch enabled
   ```

2. **Start Tauri** (in another terminal):
   ```bash
   npm run tauri:dev
   ```

   The app will:
   - Check if API is running on localhost:8765
   - If YES: Connect immediately (~1 second)
   - If NO: Start API automatically (fallback to old behavior)

### Making Backend Changes

With `api:dev` running, edit any Rust file in `src-tauri/src/`:

```bash
# Edit embedded_api.rs
vim src-tauri/src/embedded_api.rs

# cargo-watch detects changes and rebuilds automatically
# Server restarts with new code
# Tauri app reconnects automatically
```

No need to restart Tauri!

### Testing API Independently

While API is running, test endpoints directly:

```bash
# Health check
curl http://localhost:8765/api/health

# List files
curl http://localhost:8765/api/files/list

# Get file info
curl "http://localhost:8765/api/edf/info?file_path=/path/to/file.edf"
```

### Stopping

```bash
# Stop API server
Ctrl+C in Terminal 1

# Stop Tauri
Ctrl+C in Terminal 2
```

## Configuration

### Environment Variables

Create `.env` in `packages/ddalab-tauri/`:

```env
DDALAB_DATA_DIR=/Users/simon/Desktop/DDALAB/data
DDALAB_API_PORT=8765
RUST_LOG=debug
```

Or set temporarily:

```bash
export DDALAB_DATA_DIR="/custom/path"
export DDALAB_API_PORT=8765
export RUST_LOG=debug
npm run api:dev
```

### Changing Port

```bash
DDALAB_API_PORT=9000 npm run api:dev
```

Don't forget to update Tauri to connect to the new port!

## Troubleshooting

### Port Already in Use

```bash
# Find what's using port 8765
lsof -i :8765

# Kill it
kill -9 <PID>

# Or use a different port
DDALAB_API_PORT=8766 npm run api:dev
```

### cargo-watch Not Found

```bash
cargo install cargo-watch
```

### API Won't Start

Check logs:
```bash
# macOS
tail -f ~/Library/Logs/ddalab.log

# Linux
tail -f /tmp/ddalab.log
```

### Hot-Reload Not Working

1. Check `cargo-watch` is installed:
   ```bash
   cargo watch --version
   ```

2. Try manual restart:
   ```bash
   # In src-tauri directory
   cargo run --bin embedded_api_server
   ```

3. Check file watcher limits (macOS):
   ```bash
   sudo sysctl -w kern.maxfiles=65536
   sudo sysctl -w kern.maxfilesperproc=65536
   ```

## Production Builds

The background API workflow is **only for development**. Production builds work exactly as before:

```bash
npm run build
npm run tauri:build
```

The bundled app includes the API and starts it automatically - no changes needed!

## Advanced: System Service (Optional)

For even faster startup, run API as a system service:

### macOS (launchd)

Create `~/Library/LaunchAgents/com.ddalab.api.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ddalab.api</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/ddalab-tauri/target/release/embedded_api_server</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.ddalab.api.plist
```

Now API starts automatically on login!

## Comparison

| Feature | Traditional | Background API |
|---------|-------------|----------------|
| Tauri startup | 9-10 seconds | 1-2 seconds |
| Backend changes | Restart Tauri | Auto hot-reload |
| API testing | Via Tauri only | curl/Postman |
| Log separation | Mixed | Separate consoles |
| Development speed | Slower | Faster |
| Production | ✅ Same | ✅ Same |

## Next Steps

Once comfortable with the background API workflow:

1. Add API version checking (ensure frontend/backend compatibility)
2. Set up as system service for instant startup
3. Consider Docker-based API for even better isolation
4. Add API documentation (OpenAPI/Swagger)

## See Also

- [BACKGROUND_API_SETUP.md](./BACKGROUND_API_SETUP.md) - Detailed technical setup
- [TODO.md](../../TODO.md) - Project roadmap
- [PERFORMANCE_OPTIMIZATION.md](./PERFORMANCE_OPTIMIZATION.md) - Performance tuning
