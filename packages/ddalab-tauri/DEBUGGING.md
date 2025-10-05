# Debugging DDALAB Tauri App

## Viewing Console Logs

### Windows

**Option 1: Run from Command Line (PowerShell)**
```powershell
# Navigate to where DDALAB.exe is installed
cd "C:\Program Files\DDALAB"

# Run with console output
.\DDALAB.exe
```

**Option 2: Run from Command Prompt (CMD)**
```cmd
cd "C:\Program Files\DDALAB"
DDALAB.exe
```

The console logs will appear in the terminal window. Leave it open while using the app.

**Option 3: Use Developer Tools (Recommended)**
1. Open DDALAB
2. **Right-click anywhere in the window** and select "Inspect Element"
   - OR press `F12`
   - OR press `Ctrl+Shift+I`
3. Go to the "Console" tab
4. You'll see all console.log() output there

This is the easiest method and works even if the app is already installed.

### macOS

**Option 1: Run from Terminal**
```bash
# If installed in Applications
/Applications/DDALAB.app/Contents/MacOS/DDALAB

# Or if running from build output
./src-tauri/target/release/bundle/macos/DDALAB.app/Contents/MacOS/DDALAB
```

**Option 2: View Console App**
1. Open Console.app (Applications > Utilities > Console)
2. Select your Mac in the left sidebar
3. Search for "DDALAB"
4. Launch DDALAB and watch logs appear

**Option 3: Use Developer Tools (Recommended)**
1. Open DDALAB
2. **Right-click anywhere in the window** and select "Inspect Element"
   - OR press `Cmd+Option+I`
3. Go to the "Console" tab

This is the easiest method and works even if the app is already installed.

### Linux

**Run from Terminal**
```bash
# If installed system-wide
ddalab

# Or from AppImage
./DDALAB.AppImage

# Or from build output
./src-tauri/target/release/ddalab
```

## Key Diagnostic Logs

When debugging startup issues, look for these log messages:

```
=== HOME COMPONENT RENDER ===
isTauri: true/false
isApiConnected: null/true/false
...
```

And:

```
>>> SHOWING: WelcomeScreen (web mode, not connected)
>>> SHOWING: Tauri loading screen
>>> SHOWING: Dashboard
```

## Common Issues

### Seeing "Getting Started" 3-step card
- **Log to check**: `isTauri: false` when it should be `true`
- **Cause**: Tauri detection failing
- **Check**: Look for `window.__TAURI__` in the logs

### Stuck on loading screen
- **Log to check**: `isApiConnected: null` that never changes
- **Cause**: Embedded API not starting or connection check failing
- **Check**: Look for "Starting embedded API server..." messages

### API connection errors
- **Log to check**: "Failed to start embedded API:" messages
- **Cause**: Port 8765 already in use or Rust backend crash
- **Fix**: Check if another app is using port 8765

## Rust Backend Logs

The Rust backend automatically logs to a file for debugging purposes.

### Log File Location

**Windows:**
```
C:\Users\<YourUsername>\AppData\Local\Temp\ddalab.log
```
You can open this quickly by:
1. Press `Win+R`
2. Type `%TEMP%\ddalab.log`
3. Press Enter

**macOS:**
```
/tmp/ddalab.log
```

**Linux:**
```
/tmp/ddalab.log
```

### Viewing Logs

**Windows (Notepad):**
```powershell
notepad %TEMP%\ddalab.log
```

**Windows (PowerShell - tail mode):**
```powershell
Get-Content $env:TEMP\ddalab.log -Wait -Tail 50
```

**macOS/Linux:**
```bash
tail -f /tmp/ddalab.log
```

### What to Look For

When DDA analysis fails, look for:
```
❌ ========== DDA BINARY FAILURE ==========
Status: <exit code>
Binary path: <path to run_DDA_ASCII>
Binary exists: true/false
stdout: <output from binary>
stderr: <errors from binary>
==========================================
```

This will show exactly why the `run_DDA_ASCII` binary is failing.
