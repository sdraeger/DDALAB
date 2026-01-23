# Copy Logs Button Design

## Overview

Add a "Copy logs" button to the bottom status bar that allows users to copy or save both React frontend and Rust backend logs.

## Architecture

### Components

1. **`lib/logger.ts`** - Add in-memory log storage
   - Circular buffer of 500 entries
   - Each entry: `{ timestamp, level, namespace, message, context? }`
   - Export `getLogHistory()` function

2. **`src-tauri/src/commands/logs.rs`** (new) - Tauri command to read backend logs
   - `get_backend_logs()` - reads from the temp log file
   - Returns log contents as string

3. **`HealthStatusBar.tsx`** - Add "Logs" button with popover
   - Two options: "Copy to clipboard" / "Save to file"
   - Uses existing Popover pattern from the component

### Data Flow

```
User clicks "Copy logs" →
  Frontend: getLogHistory() returns frontend logs
  Backend: invoke("get_backend_logs") returns backend logs
  Combine both → Copy to clipboard OR save via Tauri dialog
```

## Implementation Details

### Logger Modifications (`lib/logger.ts`)

```typescript
interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  namespace: string;
  message: string;
  context?: unknown;
}

const logHistory: LogEntry[] = [];
const MAX_LOG_ENTRIES = 500;

export function getLogHistory(): LogEntry[] {
  return [...logHistory];
}

export function clearLogHistory(): void {
  logHistory.length = 0;
}
```

### Rust Command (`commands/logs.rs`)

- Reads from `std::env::temp_dir().join("ddalab.log")`
- Returns file contents as string
- Returns empty string if file doesn't exist

### Combined Output Format

```
=== DDALAB Logs ===
Exported: 2026-01-16T12:34:56Z

--- Frontend Logs (React) ---
[2026-01-16T12:30:00Z] [INFO] [DDA] Analysis started {"id": "abc"}
[2026-01-16T12:30:01Z] [DEBUG] [API] Request sent
...

--- Backend Logs (Rust) ---
[2026-01-16 12:30:00] DEBUG Task registered: abc123
[2026-01-16 12:30:01] INFO Analysis complete
...
```

## UI Component

### Status Bar Button

- Icon: `ScrollText` from Lucide
- Position: Right side of status bar near error count
- Popover with two options:
  - "Copy to clipboard" - uses `navigator.clipboard.writeText()`
  - "Save to file..." - uses Tauri save dialog

### Clipboard Copy

- Uses `navigator.clipboard.writeText()`
- Shows toast notification on success/failure

### Save to File

- Uses Tauri's `save` dialog from `@tauri-apps/plugin-dialog`
- Default filename: `ddalab-logs-{timestamp}.txt`
- Uses `writeTextFile` from `@tauri-apps/plugin-fs`

### Loading State

- Button shows spinner while fetching backend logs
- Popover stays open until operation completes
