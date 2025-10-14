# Background API Server Setup

This guide explains how to run the embedded Rust API server in the background for faster startup and hot-reloading during development.

## Problem

Currently, the API server:
- Starts every time the Tauri app launches (~9 seconds delay)
- Stops when the app closes
- Requires full restart when making backend changes

## Solution: Background API Process

### Architecture

```
┌─────────────────────────────────────────────┐
│                                             │
│  Tauri Desktop App (Next.js + Rust)        │
│                                             │
│  1. Check if API is running (localhost:8765)│
│  2. If YES → Connect                        │
│  3. If NO  → Start API server               │
│                                             │
└──────────────────┬──────────────────────────┘
                   │
                   │ HTTP Requests
                   ▼
         ┌─────────────────────┐
         │                     │
         │  Embedded Rust API  │
         │  (Axum Server)      │
         │  Port: 8765         │
         │                     │
         │  - Stays running    │
         │  - Hot-reloads code │
         │                     │
         └─────────────────────┘
```

### Development Mode Setup

#### 1. Run API Server Independently

Create a new script to run just the API server:

**packages/ddalab-tauri/scripts/run-api-server.sh**
```bash
#!/bin/bash
cd "$(dirname "$0")/../src-tauri"

# Build and run the embedded API as a standalone server
cargo watch -x 'run --bin embedded_api_server' -w src/
```

**packages/ddalab-tauri/src-tauri/src/bin/embedded_api_server.rs** (new file)
```rust
//! Standalone embedded API server for development
//! This allows running the API independently from the Tauri app

use std::path::PathBuf;
use std::env;

#[tokio::main]
async fn main() {
    // Initialize logging
    env_logger::init();

    // Get data directory from environment or use default
    let data_dir = env::var("DDALAB_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home).join("Desktop/DDALAB/data")
        });

    let port = env::var("DDALAB_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8765);

    println!("🚀 Starting embedded API server");
    println!("📁 Data directory: {:?}", data_dir);
    println!("🌐 Port: {}", port);
    println!("🔄 Hot-reload enabled via cargo-watch");
    println!();

    // Start the server (blocking)
    if let Err(e) = ddalab_tauri::embedded_api::start_embedded_api_server(
        data_dir,
        port,
        None  // No DDA binary path in dev mode
    ).await {
        eprintln!("❌ Server error: {}", e);
        std::process::exit(1);
    }
}
```

#### 2. Update Tauri to Check Before Starting

Modify `src/app/page.tsx` to check if API is already running:

```typescript
// Check if API is already running before starting
const checkApiRunning = async () => {
  try {
    const response = await fetch('http://localhost:8765/api/health', {
      method: 'GET',
      signal: AbortSignal.timeout(1000), // 1 second timeout
    });
    return response.ok;
  } catch {
    return false;
  }
};

// In your startup logic:
const apiAlreadyRunning = await checkApiRunning();

if (apiAlreadyRunning) {
  console.log('✅ API server already running, skipping startup');
  setIsServerReady(true);
} else {
  console.log('🚀 Starting embedded API server...');
  await invoke('start_embedded_api_server', { port: 8765 });
  // Wait for server...
}
```

#### 3. Add Hot-Reload Support

Install `cargo-watch` for auto-recompilation:

```bash
cargo install cargo-watch
```

#### 4. Development Workflow

**Terminal 1: Run API Server**
```bash
cd packages/ddalab-tauri
npm run api:dev
```

**Terminal 2: Run Tauri App**
```bash
cd packages/ddalab-tauri
npm run tauri:dev
```

Add to `package.json`:
```json
{
  "scripts": {
    "api:dev": "./scripts/run-api-server.sh",
    "tauri:dev": "PORT=3003 tauri dev",
    "dev:all": "concurrently \"npm run api:dev\" \"npm run tauri:dev\""
  }
}
```

### Benefits

#### Development
- ✅ **Instant startup**: Tauri app connects immediately (<1s)
- ✅ **Hot-reload**: API code changes reload automatically
- ✅ **Independent testing**: Test API without Tauri app
- ✅ **Better debugging**: Separate console logs
- ✅ **Faster iteration**: No full app restart needed

#### Production
- ✅ **Same behavior**: Bundled app still starts API automatically
- ✅ **No changes needed**: Works exactly as before
- ✅ **Fallback**: If API crashes, app can restart it

### Production Considerations

In production (bundled app), you might want:

**Option A: Keep Current Behavior**
- API starts with app, stops with app
- Simple, no background process management
- 9-second startup delay

**Option B: System Service (macOS/Linux)**
- Install API as system service (launchd/systemd)
- Always running in background
- Instant app startup

**Option C: Graceful Background Mode**
- API keeps running when app closes
- API shuts down after X minutes of inactivity
- Best of both worlds

### Implementation Details

#### Modified Files

1. **src-tauri/src/bin/embedded_api_server.rs** (new)
   - Standalone server binary

2. **src-tauri/Cargo.toml**
   ```toml
   [[bin]]
   name = "embedded_api_server"
   path = "src/bin/embedded_api_server.rs"
   ```

3. **src/app/page.tsx**
   - Add `checkApiRunning()` before startup
   - Skip API start if already running

4. **src/services/tauriService.ts**
   - Add `checkApiHealth()` utility

5. **scripts/run-api-server.sh**
   - Development server runner

6. **package.json**
   - Add `api:dev` script

### Environment Variables

Set these for development:

```bash
export DDALAB_DATA_DIR="/Users/simon/Desktop/DDALAB/data"
export DDALAB_API_PORT=8765
export RUST_LOG=debug
```

Or create `.env` in `packages/ddalab-tauri`:
```env
DDALAB_DATA_DIR=/Users/simon/Desktop/DDALAB/data
DDALAB_API_PORT=8765
RUST_LOG=debug
```

### Troubleshooting

**Port already in use:**
```bash
# Find process using port 8765
lsof -i :8765

# Kill it
kill -9 <PID>
```

**API won't start:**
- Check logs in temp directory: `~/Library/Logs/` (macOS)
- Verify data directory exists
- Check permissions

**Hot-reload not working:**
- Ensure `cargo-watch` is installed
- Check file watcher limits (macOS: `kern.maxfiles`)
- Try manual restart

### Next Steps

1. Create the standalone binary
2. Add health check to frontend
3. Test hot-reload workflow
4. Document production deployment options
5. Consider adding API version checking (frontend/backend compatibility)

### Alternative: Docker-Based API

For even better isolation:

```dockerfile
# Dockerfile.api
FROM rust:1.75
WORKDIR /app
COPY . .
RUN cargo build --release --bin embedded_api_server
CMD ["./target/release/embedded_api_server"]
```

```bash
docker-compose up -d api
npm run tauri:dev
```

This provides:
- Complete isolation
- Easier dependencies management
- Consistent environment
- Simple restart/rebuild
