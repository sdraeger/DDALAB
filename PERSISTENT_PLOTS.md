# Persistent Plot System

This document describes the persistent plot system that keeps EEG and DDA plots open and accessible across navigation, solving the issue where plots would disappear when switching between tabs.

## Problem Solved

**Before**: When users loaded an EEG plot from an EDF file and navigated to other tabs (like tickets), the plot would disappear and they would have to reselect the file and reload it.

**After**: Plots now persist across navigation as floating windows that can be:

- Moved and resized
- Minimized and restored
- Hidden and shown
- Managed from the navigation bar
- Automatically cached for performance

## Dashboard State Persistence

**Additional Problem Solved**: Dashboard tab state was not preserved when navigating away and returning, causing users to see the "Please select a file from the sidebar to analyze data" message instead of their previously selected file and configuration.

**Solution**: Added a comprehensive dashboard state management system that persists:

- Selected file path and its configuration
- File browser collapsed/expanded state
- Selected channel configuration
- Last activity timestamp for automatic cleanup

### Dashboard State Features

- **Cross-Navigation Persistence**: Dashboard remembers your selected file when you switch tabs
- **File Browser State**: Sidebar collapsed/expanded preference is maintained
- **Channel Selection**: Previously selected channels are restored
- **2-Hour TTL**: State expires after 2 hours to prevent stale configurations
- **Settings Integration**: View and manage dashboard state from the settings page

## Architecture Overview

### Core Components

1. **PersistentPlotsContext** (`packages/shared/contexts/PersistentPlotsContext.tsx`)

   - Manages the state of all open plots
   - Handles persistence in localStorage
   - Provides CRUD operations for plots

2. **DashboardStateContext** (`packages/shared/contexts/DashboardStateContext.tsx`)

   - Manages dashboard tab state persistence
   - Handles selected file, browser state, and channels
   - Automatic cleanup of expired state

3. **PersistentPlotContainer** (`packages/shared/components/plot/PersistentPlotContainer.tsx`)

   - Renders floating plot windows
   - Handles drag and resize functionality
   - Manages minimized plot bar

4. **PersistentEEGPlot** (`packages/shared/components/plot/PersistentEEGPlot.tsx`)

   - Specialized EEG plot component for persistent windows
   - Integrates with existing caching system
   - Optimized for floating window usage

5. **OpenPlotsIndicator** (`packages/shared/components/ui/open-plots-indicator.tsx`)

   - Shows open plots count in navigation
   - Provides quick access to plot management
   - Visible in the main header

6. **DashboardStateManager** (`packages/shared/components/ui/dashboard-state-manager.tsx`)

   - Settings component for viewing and managing dashboard state
   - Shows current state information and allows manual reset

7. **usePersistentPlotActions** (`packages/shared/hooks/usePersistentPlotActions.ts`)
   - Hook for easy plot management
   - Provides functions to open/close plots
   - Handles duplicate detection

## Features

### ✅ Cross-Navigation Persistence

- Plots remain open when navigating between tabs
- Dashboard state (selected file, channels) is preserved
- State is preserved in localStorage
- Automatic restoration on page refresh

### ✅ Intelligent Caching Integration

- Uses the existing plot caching system
- Instant loading from cache when available
- Automatic cache population for new data

### ✅ Window Management

- **Drag & Drop**: Move plots anywhere on screen
- **Resize**: Adjust plot size with handles
- **Minimize**: Reduce to taskbar-style bar
- **Hide/Show**: Toggle visibility without closing
- **Close**: Remove plot entirely

### ✅ Dashboard State Management

- **File Selection**: Remembers last selected file
- **Browser State**: Preserves sidebar collapsed/expanded state
- **Channel Memory**: Maintains selected channel configuration
- **Auto-Cleanup**: Expires state after 2 hours

### ✅ Multi-Plot Support

- Up to 5 simultaneous plots (configurable)
- Automatic cleanup of oldest plots when limit reached
- Duplicate detection prevents multiple plots of same file

### ✅ Visual Indicators

- Header shows open plot count
- Green dots indicate already-open files
- Real-time status updates

## Usage

### For Users

#### Dashboard Navigation

1. **Select a File**: Choose an EDF file from the file browser
2. **Navigate Away**: Switch to tickets, settings, or any other tab
3. **Return to Dashboard**: Your selected file and configuration are restored
4. **File Browser State**: Sidebar remains collapsed/expanded as you left it

#### Opening Plots

1. **From File Browser**: Use the chart icon button next to EDF files
2. **From Action Menu**: Select "Open EEG Plot" or "Open DDA Plot"
3. **Programmatically**: Use the `usePersistentPlotActions` hook

#### Managing Open Plots

1. **View All**: Click "Open Plots" in the header navigation
2. **Minimize**: Click the minimize button on any plot window
3. **Hide**: Click the eye icon to hide temporarily
4. **Restore**: Click minimized plots in the bottom taskbar
5. **Close**: Click the X button or use "Clear All" option

#### Managing Dashboard State

1. **View State**: Go to Settings → Dashboard State section
2. **Clear State**: Use "Reset Dashboard State" button
3. **Automatic Cleanup**: State expires after 2 hours of inactivity

#### Navigation Benefits

- **Navigate Freely**: Switch between tabs without losing plots or dashboard state
- **Persistent State**: Plot position, zoom, channel selection, and file selection are preserved
- **Quick Access**: Return to any plot or dashboard state instantly

### For Developers

#### Using Dashboard State

```typescript
import { useDashboardState } from "shared/contexts/DashboardStateContext";

function MyDashboardComponent() {
  const {
    selectedFilePath,
    fileBrowserCollapsed,
    selectedChannels,
    setSelectedFilePath,
    setFileBrowserCollapsed,
    setSelectedChannels,
    toggleFileBrowser,
    handleFileSelect,
    clearDashboardState,
  } = useDashboardState();

  const handleSelectFile = (filePath: string) => {
    // This automatically updates state and collapses browser
    handleFileSelect(filePath);
  };
}
```

#### Opening Plots Programmatically

```typescript
import { usePersistentPlotActions } from "shared/hooks/usePersistentPlotActions";

function MyComponent() {
  const { openEEGPlot, openDDAPlot } = usePersistentPlotActions();

  const handleOpenPlot = () => {
    // Opens an EEG plot in a persistent window
    const plotId = openEEGPlot("/path/to/file.edf", "My EEG File");

    // Or open a DDA plot
    const ddaPlotId = openDDAPlot("/path/to/file.edf", "My DDA Analysis");
  };
}
```

#### Checking for Existing Plots

```typescript
function FileRow({ filePath }) {
  const { getOpenPlotForFile } = usePersistentPlotActions();

  const existingPlot = getOpenPlotForFile(filePath, "eeg");
  const isAlreadyOpen = !!existingPlot;

  return (
    <div>
      <span>{filePath}</span>
      {isAlreadyOpen && <span className="text-green-500">●</span>}
    </div>
  );
}
```

#### Using with File Action Buttons

```typescript
import { FileActionButton } from "shared/components/files/FileActionButton";

function FileBrowser() {
  return (
    <div>
      {files.map((file) => (
        <div key={file.path} className="flex justify-between">
          <span>{file.name}</span>
          <FileActionButton
            filePath={file.path}
            fileName={file.name}
            isEdfFile={file.name.endsWith(".edf")}
          />
        </div>
      ))}
    </div>
  );
}
```

#### Direct Context Usage

```typescript
import { usePersistentPlots } from "shared/contexts/PersistentPlotsContext";

function PlotManager() {
  const { openPlots, addPlot, removePlot, updatePlot, clearAllPlots } =
    usePersistentPlots();

  const handleAddPlot = () => {
    const plotId = addPlot({
      filePath: "/path/to/file.edf",
      fileName: "example.edf",
      plotType: "eeg",
      isMinimized: false,
      position: { x: 100, y: 100 },
      size: { width: 800, height: 600 },
    });
  };
}
```

## Configuration

### Plot Limits

```typescript
// In PersistentPlotsContext.tsx
const MAX_PLOTS = 5; // Maximum concurrent plots
```

### Dashboard State TTL

```typescript
// In DashboardStateContext.tsx
const STATE_TTL = 2 * 60 * 60 * 1000; // 2 hours
```

### Cache Duration

The persistent plots integrate with the existing cache system:

- Plot data: 5 minutes
- Annotations: 10 minutes
- Heatmap data: 10 minutes

### Storage Cleanup

```typescript
// Plots older than 1 hour are automatically cleaned up
const validPlots = parsedPlots.filter(
  (plot) => Date.now() - plot.lastAccessed < 60 * 60 * 1000
);

// Dashboard state older than 2 hours is automatically cleaned up
const isStateValid = Date.now() - parsedState.lastActivity < STATE_TTL;
```

## Window Positioning

### Default Positions

- **EEG Plots**: 1000x700px, centered
- **DDA Plots**: 800x600px, centered

### Smart Positioning

- New plots open in center of screen
- Automatic boundary detection prevents off-screen placement
- Drag constraints keep windows within viewport

## Integration Points

### Existing Systems

1. **EDFPlotContext**: Continues to manage plot state and caching
2. **Apollo Cache**: Enhanced for persistent plot data
3. **Plot Cache Manager**: Provides efficient data retrieval
4. **File Browser**: Enhanced with persistent plot actions

### Provider Hierarchy

```typescript
<DashboardStateProvider>
  {" "}
  {/* For dashboard-specific pages */}
  <PersistentPlotsProvider>
    <EDFPlotProvider>
      <YourApp>
        <PersistentPlotContainer /> {/* Renders floating plots */}
      </YourApp>
    </EDFPlotProvider>
  </PersistentPlotsProvider>
</DashboardStateProvider>
```

## Performance Benefits

1. **Instant Navigation**: No loading when switching tabs
2. **Cached Data**: Leverages existing caching for quick restoration
3. **Efficient Rendering**: Only visible plots consume resources
4. **Memory Management**: Automatic cleanup of old plots and state
5. **Lazy Loading**: Minimized plots don't render heavy components

## Best Practices

### For Users

1. **Minimize Unused Plots**: Keep the interface clean
2. **Use Quick Access**: Navigate via header indicator
3. **Close When Done**: Free up system resources
4. **Organize Windows**: Arrange plots for your workflow
5. **Check Settings**: Monitor dashboard state from settings page

### For Developers

1. **Check for Existing Plots**: Prevent duplicates
2. **Use Hooks**: Leverage `usePersistentPlotActions` and `useDashboardState` for consistency
3. **Handle Errors**: Graceful fallback for plot opening failures
4. **Respect Limits**: Don't programmatically exceed MAX_PLOTS
5. **State Management**: Use context for dashboard state instead of local state

## Troubleshooting

### Common Issues

1. **Plot Not Opening**

   - Check file path validity
   - Verify file type is supported
   - Look for console errors

2. **State Not Persisting**

   - Check localStorage availability
   - Verify context provider is properly wrapped
   - Clear browser cache if corrupted

3. **Dashboard State Reset**

   - Check if 2-hour TTL has expired
   - Verify DashboardStateProvider is in correct location
   - Look for localStorage errors in console

4. **Performance Issues**
   - Close unused plots
   - Clear cache if memory usage is high
   - Check for memory leaks in dev tools

### Debug Mode

```typescript
// Enable detailed logging
localStorage.setItem("debug", "persistent-plots,dashboard-state");
```

## Migration Guide

### From Dialog-Based Plots

Replace dialog usage with persistent plot actions:

```typescript
// Before
const [dialogOpen, setDialogOpen] = useState(false);
<EDFPlotDialog
  open={dialogOpen}
  onOpenChange={setDialogOpen}
  filePath={path}
/>;

// After
const { openEEGPlot } = usePersistentPlotActions();
<Button onClick={() => openEEGPlot(path, fileName)}>Open Plot</Button>;
```

### From Legacy Plot Components

Use the new action components:

```typescript
// Before
<Button onClick={() => setSelectedFile(file)}>View Plot</Button>

// After
<FileActionButton filePath={file.path} fileName={file.name} isEdfFile={true} />
```

### From Local Dashboard State

Replace local state with context:

```typescript
// Before
const [selectedFile, setSelectedFile] = useState(null);
const [collapsed, setCollapsed] = useState(false);

// After
const {
  selectedFilePath,
  fileBrowserCollapsed,
  handleFileSelect,
  toggleFileBrowser,
} = useDashboardState();
```

## Future Enhancements

1. **Plot Layouts**: Save and restore window arrangements
2. **Cross-Session Persistence**: Maintain plots across browser sessions
3. **Plot Linking**: Synchronize related plots
4. **Advanced Window Management**: Tabbed interfaces, split views
5. **Collaboration**: Share plot arrangements with team members
6. **Dashboard Templates**: Save and load dashboard configurations
7. **Advanced State Sync**: Real-time state synchronization across tabs

This persistent plot system transforms the user experience by eliminating the frustration of losing plot state and dashboard configuration during navigation, while maintaining all the performance benefits of the enhanced caching system.
