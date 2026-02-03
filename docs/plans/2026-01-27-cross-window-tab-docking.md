# Cross-Window Tab Docking (Drop-to-Merge)

**Date:** 2026-01-27
**Status:** Design Complete

## Overview

Implement Chrome/VSCode-like tab docking where users can drag a tab from one window and drop it onto another window's tab bar to merge tabs between windows.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Source Window                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ FileTabBar (dnd-kit)                                      │  │
│  │  - onDragStart: broadcast "tab-drag-started" event        │  │
│  │  - onDragMove: query window bounds, detect target window  │  │
│  │  - onDragEnd: if over other window → emit "tab-drop"      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                    Tauri IPC Events
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Target Window                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ TabDropZone                                               │  │
│  │  - Listens for "tab-drag-started" → shows drop indicator  │  │
│  │  - Listens for "tab-drop" → receives tab data             │  │
│  │  - Adds tab to local tab bar                              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Rust Backend Command

**File:** `src-tauri/src/commands/window_commands.rs`

```rust
#[derive(Serialize)]
pub struct WindowBounds {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub is_focused: bool,
}

#[tauri::command]
pub async fn get_all_window_bounds(app: AppHandle) -> Result<Vec<WindowBounds>, String> {
    let mut bounds = Vec::new();

    for (label, window) in app.webview_windows() {
        if let (Ok(position), Ok(size)) = (
            window.outer_position(),
            window.outer_size()
        ) {
            bounds.push(WindowBounds {
                label: label.clone(),
                x: position.x as f64,
                y: position.y as f64,
                width: size.width as f64,
                height: size.height as f64,
                is_focused: window.is_focused().unwrap_or(false),
            });
        }
    }

    Ok(bounds)
}
```

### 2. Cross-Window Drag Hook

**File:** `src/hooks/useCrossWindowDrag.ts`

Manages drag state and broadcasts events across windows:

- `startDrag(tabData)` - Called on drag start, fetches window bounds, broadcasts event
- `updateDragPosition(screenX, screenY)` - Called during drag, detects target window
- `endDrag(cancelled)` - Called on drag end, triggers transfer if target found

### 3. Tab Drop Zone Component

**File:** `src/components/TabDropZone.tsx`

Visual feedback component that:
- Listens for `tab-drag-started` events from other windows
- Shows blue overlay when cursor is over this window
- Displays "Drop to add [filename] to this window" message

### 4. Event Types

| Event | Payload | Description |
|-------|---------|-------------|
| `tab-drag-started` | `{ sourceWindowLabel, tabData }` | Broadcast when drag begins |
| `tab-drag-moved` | `{ cursorX, cursorY, targetWindowLabel }` | Position updates during drag |
| `tab-drag-ended` | `{ targetWindowLabel, cancelled }` | Drag completed |
| `tab-transfer` | `{ targetWindowLabel, tabData }` | Request to receive tab |

## Behavior

### Tab Transfer Flow

1. User starts dragging tab in Window A
2. Window A broadcasts `tab-drag-started` with tab data
3. All windows listen and prepare drop zones
4. During drag, cursor position is tracked against window bounds
5. Target window (if any) shows drop indicator
6. On drop over Window B:
   - Emit `tab-transfer` to Window B
   - Window B opens the file
   - Window A closes the tab
7. If Window A's last tab was transferred, close Window A

### Edge Cases

- **Tab already open in target**: Activate existing tab, don't duplicate
- **Last tab transferred**: Auto-close source window
- **Drag cancelled**: No transfer, tab stays in source
- **No target window**: Create new window (existing drag-to-popout behavior)

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/commands/window_commands.rs` | Add `get_all_window_bounds` |
| `src-tauri/src/commands/mod.rs` | Export new command |
| `src-tauri/src/lib.rs` | Register command |
| `src/hooks/useCrossWindowDrag.ts` | New hook |
| `src/components/TabDropZone.tsx` | New component |
| `src/components/FileTabBar/FileTabBar.tsx` | Integrate cross-window drag |
| `src/components/DashboardLayout.tsx` | Wrap with TabDropZone |
| `src/components/popout/PopoutLayout.tsx` | Add transfer listener |

## Implementation Order

1. Add Rust `get_all_window_bounds` command
2. Create `useCrossWindowDrag` hook
3. Create `TabDropZone` component
4. Modify `FileTabBar` to use cross-window drag
5. Add tab transfer listeners to layouts
6. Handle last-tab auto-close
7. Test across main window and popouts

## Design Decisions

- **Cursor position detection over OS drag-drop**: Gives full control over visual feedback
- **Window bounds fetched once at drag start**: Avoids continuous IPC during drag
- **Position updates throttled to ~30fps**: Reduces IPC overhead
- **Auto-close on last tab**: Matches Chrome behavior
