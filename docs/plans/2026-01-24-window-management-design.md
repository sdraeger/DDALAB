# Enhanced Multi-Window Management & Phase Space Visualization

**Date:** 2026-01-24
**Status:** Approved

## Overview

Overhaul of the window management system to support VS Code-like modularity, with immediate improvements to the Phase Space Plot UX. The architecture is designed for future extension to a full layout engine.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Window management approach | Enhanced Multi-Window (future: full layout engine) |
| Window registry UI | Status bar panel with popover |
| Phase Space visual approach | Full visual redesign |
| Type extensibility | Typed Registry Pattern |

## Architecture

### 1. Panel Registry

Central registry for declarative panel definitions:

```typescript
// src/utils/panelRegistry.ts
interface PanelDefinition {
  id: string;                           // e.g., "phase-space", "timeseries"
  title: string;                        // Window title
  icon: LucideIcon;                     // For UI display
  category: "visualization" | "analysis" | "data";

  // Window defaults
  defaultSize: { width: number; height: number };
  minSize?: { width: number; height: number };

  // Component references (lazy loaded)
  component: React.LazyExoticComponent<any>;
  popoutComponent: React.LazyExoticComponent<any>;

  // Data contract
  getInitialData: (context: PanelContext) => any;
  serializeState?: (data: any) => any;
  deserializeState?: (saved: any) => any;

  // Future layout engine hooks
  dockable?: boolean;
  allowMultiple?: boolean;
}
```

Adding a new panel requires:
1. Create the component
2. Call `registerPanel()` with the definition
3. Done - window manager, status bar, persistence all work automatically

### 2. Window Manager Updates

Refactored to consume panel registry:

```typescript
class WindowManager {
  async createPopoutWindow(
    panelId: string,        // Changed from WindowType union
    instanceId: string,
    data: any,
    savedPosition?: WindowPosition
  ): Promise<string>;

  getWindowsByPanel(): Map<string, PopoutWindowState[]>;
  getWindowSummary(): { panelId: string; count: number; icon: LucideIcon }[];
}
```

### 3. Status Bar Window Panel

```
┌─────────────────────────────────────────────────────────────┐
│ [File] [Edit] [View] ...                          [Windows ▾] │
└─────────────────────────────────────────────────────────────┘
                                                        │
                                    ┌───────────────────▼──────────────────┐
                                    │  Open Windows (4)                     │
                                    ├──────────────────────────────────────┤
                                    │  📈 Time Series                       │
                                    │     └─ timeseries-main-1706...  [×]  │
                                    │  📊 Phase Space                       │
                                    │     └─ phase-space-ch1-1706... [×]   │
                                    │  🔬 DDA Results                       │
                                    │     └─ dda-results-run1-170... [×]   │
                                    ├──────────────────────────────────────┤
                                    │  [Close All]        [Tile Windows]   │
                                    └──────────────────────────────────────┘
```

Features:
- Badge showing total window count
- Groups windows by panel type
- Click window name → focus
- Lock/close per window
- "Tile Windows" arranges in grid

Keyboard shortcuts:
- `Cmd/Ctrl + \`` → Cycle through windows
- `Cmd/Ctrl + W` → Close focused popout

### 4. Phase Space Plot Visual Redesign

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase Space: Fp1                    [⟳ Reset] [↗ Pop Out] [⤓ Export] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ┌─────────────────────┐                      │
│                    │                     │                      │
│                    │    3D SCATTER       │   ← 500px+ height    │
│                    │      PLOT           │                      │
│                    │                     │                      │
│                    └─────────────────────┘                      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Channel: [Fp1 ▾]   Delay τ: ══●══ 15 (5.9ms)   Points: ══●══ 8000 │
└─────────────────────────────────────────────────────────────────┘
```

Visual improvements:
- Min height 500px, dark gradient background
- Larger points (3-4px), Viridis/Plasma color palette
- Prominent grid lines, labeled axes
- Visible bounding box with depth shadow
- Controls in bottom toolbar
- Loading skeleton instead of spinner

## File Structure

### New Files

```
src/utils/panelRegistry.ts          # Panel definition interface + registry
src/panels/index.ts                 # Panel registrations
src/panels/phase-space/             # Phase space panel definition
src/components/windows/
  └── WindowPanelPopover.tsx        # Status bar popover
src/components/popout/PhaseSpacePopout.tsx
```

### Modified Files

```
src/utils/windowManager.ts          # Consume registry
src/hooks/usePopoutWindows.ts       # Update types
src/components/dda/PhaseSpacePlot.tsx  # Visual overhaul
src/components/StatusBar.tsx        # Add WindowPanelPopover
src/app/popout/[type]/page.tsx      # Dynamic popout routing
```

## Migration Approach

1. Create panel registry (non-breaking)
2. Register existing panels (timeseries, dda-results, eeg-visualization)
3. Update windowManager to use registry (backward compatible)
4. Add Phase Space panel + visual redesign
5. Add WindowPanelPopover to status bar
6. Clean up old WindowType union

## Future Layout Engine Hooks

The registry pattern enables future extension:
- `dockable` - can panel be docked to sides?
- `allowMultiple` - multiple instances allowed?
- Layout constraints and serialization
- Drag-and-drop panel rearrangement
