# Widget State Synchronization

This document describes the widget state synchronization system that enables widgets to maintain their state when popped out to separate windows.

## Overview

The `useWidgetState` hook provides a comprehensive solution for maintaining widget state across different instances (main dashboard vs. popped-out windows). It ensures that:

- Widget state is preserved when popping out
- State changes are synchronized in real-time between main and popped-out widgets
- State is automatically persisted to localStorage for reliability
- State is cleaned up when widgets are removed

## Features

### 1. State Persistence

- Widget state is automatically saved to localStorage
- State survives browser refreshes and tab closures
- Each widget has its own isolated state storage

### 2. Real-time Synchronization

- Uses localStorage events for cross-tab communication
- Uses BroadcastChannel API where available for better performance
- Uses postMessage for parent-child window communication
- Prevents circular updates with timestamp tracking

### 3. Pop-out State Transfer

- Captures complete widget state during pop-out
- Restores state in the popped-out window
- Maintains synchronization between main and popped-out instances

## Usage

### Basic Widget Implementation

```typescript
import { useWidgetState } from "shared";

interface MyWidgetState {
  value: string;
  count: number;
  settings: {
    enabled: boolean;
    mode: "light" | "dark";
  };
}

function MyWidget({ widgetId = "my-widget-default", isPopout = false }) {
  const { state, updateState } = useWidgetState<MyWidgetState>(
    widgetId,
    {
      value: "",
      count: 0,
      settings: {
        enabled: true,
        mode: "light",
      },
    },
    isPopout
  );

  const handleValueChange = (newValue: string) => {
    updateState((prev) => ({ ...prev, value: newValue }));
  };

  const incrementCount = () => {
    updateState((prev) => ({ ...prev, count: prev.count + 1 }));
  };

  return (
    <div>
      <input
        value={state.value}
        onChange={(e) => handleValueChange(e.target.value)}
      />
      <button onClick={incrementCount}>Count: {state.count}</button>
    </div>
  );
}
```

### Widget Factory Integration

When registering widgets in the WidgetFactoryService, pass the widget ID and popout flag:

```typescript
this.registerWidgetType("my-widget", (config) => {
  const widgetId = config?.id || `my-widget-${Date.now()}`;
  return {
    id: widgetId,
    title: config?.title || "My Widget",
    type: "my-widget",
    content: React.createElement(MyWidget as any, {
      widgetId,
      isPopout: config?.isPopout || false,
    }),
    // ... other config
  };
});
```

## Implementation Details

### Storage Keys

- Widget state: `widget-state-{widgetId}`
- Sync channel: `widget-sync-{widgetId}`
- Popout data: `modern-popped-widget-{widgetId}`

### Communication Methods

1. **localStorage Events**: Cross-tab synchronization
2. **BroadcastChannel**: Enhanced cross-window communication
3. **postMessage**: Parent-child window communication

### State Capture Process

1. Main widget captures current state when popping out
2. State is stored in the popout widget's metadata
3. Popped-out widget restores state on initialization
4. Both instances maintain real-time synchronization

## Supported Widgets

The following widgets currently support state synchronization:

### DDAWidget

Synchronizes:

- Form parameters (windowSize, stepSize, frequencyBand)
- Processing options (enablePreprocessing, includeMetadata)

### ChartWidget

Synchronizes:

- Time window settings
- Zoom level
- Selected channels
- View preferences

### DDALinePlotWidget

Synchronizes:

- Plot mode (average, individual, all)
- Selected row for individual mode
- Maximum display rows for all mode
- Processing state and errors

## Best Practices

### 1. State Design

- Keep state serializable (no functions, DOM elements, etc.)
- Use flat state structures when possible
- Include version numbers for state migration

### 2. Performance

- Avoid frequent state updates (debounce if necessary)
- Use partial updates with the spread operator
- Don't store large data objects in widget state

### 3. Error Handling

- Always provide default state values
- Handle JSON parsing errors gracefully
- Validate restored state before using

### 4. Cleanup

- State is automatically cleaned up when widgets are removed
- Manual cleanup available via `cleanupState()` function

## Troubleshooting

### State Not Synchronizing

1. Check that both widgets use the same `widgetId`
2. Verify `isPopout` flag is set correctly
3. Check browser console for errors
4. Ensure localStorage is available

### Performance Issues

1. Reduce state update frequency
2. Use smaller state objects
3. Check for circular update loops

### State Loss

1. Verify state is serializable
2. Check localStorage quotas
3. Ensure proper error handling

### `useWidgetDataSync`

A specialized hook for synchronizing external data dependencies (like Redux store data) between main and popped-out widgets.

#### Purpose

While `useWidgetState` handles widget-specific internal state, `useWidgetDataSync` handles external data that widgets depend on, such as:

- Redux store data (plots, analysis results, file selections)
- Real-time updates from API calls
- Shared application state

#### Features

- Automatic Redux state monitoring and synchronization
- Debounced updates to prevent performance issues
- Multiple communication channels (BroadcastChannel, localStorage, postMessage)
- Event listeners for handling incoming data updates

#### Usage

```typescript
import { useWidgetDataSync } from "shared";

function ChartWidget({ widgetId, isPopout = false }) {
  const reduxPlots = useAppSelector((state) => state.plots);

  // Set up data synchronization
  const { registerDataListener, unregisterDataListener } = useWidgetDataSync(
    widgetId,
    isPopout
  );

  // Local state for synchronized data (used in popout mode)
  const [syncedPlots, setSyncedPlots] = useState(null);

  // Register listener for plot data updates in popout mode
  useEffect(() => {
    if (isPopout) {
      const handlePlotDataUpdate = (plots) => {
        setSyncedPlots(plots);
      };

      registerDataListener("plots", handlePlotDataUpdate);

      return () => {
        unregisterDataListener("plots");
      };
    }
  }, [isPopout, registerDataListener, unregisterDataListener]);

  // Use synchronized data in popout, Redux data in main window
  const effectivePlots = isPopout ? syncedPlots || reduxPlots : reduxPlots;

  // Use effectivePlots instead of reduxPlots in your component logic
  return <div>{/* Your widget content */}</div>;
}
```

#### Options

```typescript
interface DataSyncOptions {
  enabled?: boolean; // Default: true
  debounceMs?: number; // Default: 100ms
}

useWidgetDataSync(widgetId, isPopout, options);
```

#### How It Works

1. **Main Window**: Monitors Redux state changes and broadcasts updates
2. **Popout Window**: Receives updates and applies them to local state
3. **Bidirectional**: Both windows can send updates to each other
4. **Debounced**: Updates are throttled to prevent excessive communication

#### Supported Data Types

- `plots`: Complete plots state from Redux store
- `dda-results`: DDA analysis results
- `file-selection`: Currently selected files

#### Integration with Pop-out System

The pop-out system automatically captures initial Redux state for data-dependent widgets:

```typescript
// ModernWidgetContainer captures initial state during pop-out
const plotDependentWidgets = ["chart", "dda-line-plot"];
if (plotDependentWidgets.includes(widget.type)) {
  serializableWidget.metadata.initialPlotsState = plots;
}
```

## Future Enhancements

- State versioning and migration
- Compression for large state objects
- State validation schemas
- Selective state synchronization
- State history and undo/redo
- Enhanced data sync for other Redux slices
- Real-time collaborative editing
- Data conflict resolution
