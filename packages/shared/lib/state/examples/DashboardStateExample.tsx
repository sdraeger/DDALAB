"use client";

import React, { type ReactNode } from 'react';
import {
  StateProvider,
  useState,
  useComputedState,
  useStateDebugger,
  LoggingMiddleware,
  PersistencePlugin,
  CrossTabSyncPlugin,
  HistoryPlugin,
  useStateStore,
  arrayValidator,
  rangeValidator,
  shapeValidator,
  enumValidator
} from '../index';

/**
 * Example implementation showing how to migrate dashboard state
 * to the new centralized state management system
 */

// Define state shape interfaces
export interface DashboardWidget {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  title: string;
  isPopOut: boolean;
}

interface DashboardLayoutState {
  widgets: DashboardWidget[];
  selectedWidget: string | null;
  gridSize: number;
  enableSnapping: boolean;
}

interface PlotState {
  currentFilePath: string | null;
  selectedChannels: string[];
  timeWindow: [number, number];
  zoomLevel: number;
}

interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  debugMode: boolean;
}

// State configurations
const dashboardLayoutConfig = {
  key: 'dashboard.layout',
  defaultValue: {
    widgets: [],
    selectedWidget: null,
    gridSize: 10,
    enableSnapping: false
  } as DashboardLayoutState,
  persistent: true,
  syncAcrossInstances: true,
  debugEnabled: true,
  validator: shapeValidator({
    widgets: arrayValidator,
    selectedWidget: { validate: (v) => v === null || typeof v === 'string', getErrorMessage: () => 'Must be string or null' },
    gridSize: rangeValidator(5, 50),
    enableSnapping: { validate: (v) => typeof v === 'boolean', getErrorMessage: () => 'Must be boolean' }
  })
};

const plotStateConfig = {
  key: 'dashboard.plot',
  defaultValue: {
    currentFilePath: null,
    selectedChannels: [],
    timeWindow: [0, 10] as [number, number],
    zoomLevel: 1
  } as PlotState,
  persistent: true,
  syncAcrossInstances: true,
  debugEnabled: true,
  validator: shapeValidator({
    currentFilePath: { validate: (v) => v === null || typeof v === 'string', getErrorMessage: () => 'Must be string or null' },
    selectedChannels: arrayValidator,
    timeWindow: { validate: (v) => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number'), getErrorMessage: () => 'Must be array of 2 numbers' },
    zoomLevel: { validate: (v) => typeof v === 'number' && v > 0, getErrorMessage: () => 'Must be positive number' }
  })
};

const appSettingsConfig = {
  key: 'app.settings',
  defaultValue: {
    theme: 'system' as const,
    sidebarCollapsed: false,
    debugMode: false
  } as AppSettings,
  persistent: true,
  syncAcrossInstances: false, // Keep settings local to each tab
  debugEnabled: true,
  validator: shapeValidator({
    theme: enumValidator(['light', 'dark', 'system']),
    sidebarCollapsed: { validate: (v) => typeof v === 'boolean', getErrorMessage: () => 'Must be boolean' },
    debugMode: { validate: (v) => typeof v === 'boolean', getErrorMessage: () => 'Must be boolean' }
  })
};

// Custom hook for dashboard layout management
export function useDashboardLayout() {
  const {
    value: layoutState,
    setValue: setLayoutState,
    reset: resetLayout,
    isLoading,
    error
  } = useState(dashboardLayoutConfig);

  const addWidget = React.useCallback(async (widget: DashboardWidget) => {
    const newState = {
      ...layoutState,
      widgets: [...layoutState.widgets, widget]
    };
    await setLayoutState(newState);
  }, [layoutState, setLayoutState]);

  const updateWidget = React.useCallback(async (
    id: string,
    updates: Partial<DashboardWidget>
  ) => {
    const newState = {
      ...layoutState,
      widgets: layoutState.widgets.map(widget =>
        widget.id === id ? { ...widget, ...updates } : widget
      )
    };
    await setLayoutState(newState);
  }, [layoutState, setLayoutState]);

  const removeWidget = React.useCallback(async (id: string) => {
    const newState = {
      ...layoutState,
      widgets: layoutState.widgets.filter(widget => widget.id !== id)
    };
    await setLayoutState(newState);
  }, [layoutState, setLayoutState]);

  const selectWidget = React.useCallback(async (id: string | null) => {
    const newState = { ...layoutState, selectedWidget: id };
    await setLayoutState(newState);
  }, [layoutState, setLayoutState]);

  return {
    ...layoutState,
    addWidget,
    updateWidget,
    removeWidget,
    selectWidget,
    resetLayout,
    isLoading,
    error
  };
}

// Custom hook for plot state management
export function usePlotState() {
  const {
    value: plotState,
    setValue: setPlotState,
    reset: resetPlot,
    isLoading,
    error
  } = useState(plotStateConfig);

  const setCurrentFile = React.useCallback(async (filePath: string | null) => {
    const newState = { ...plotState, currentFilePath: filePath };
    await setPlotState(newState);
  }, [plotState, setPlotState]);

  const setSelectedChannels = React.useCallback(async (channels: string[]) => {
    const newState = { ...plotState, selectedChannels: channels };
    await setPlotState(newState);
  }, [plotState, setPlotState]);

  const setTimeWindow = React.useCallback(async (timeWindow: [number, number]) => {
    const newState = { ...plotState, timeWindow };
    await setPlotState(newState);
  }, [plotState, setPlotState]);

  const setZoomLevel = React.useCallback(async (zoomLevel: number) => {
    const newState = { ...plotState, zoomLevel };
    await setPlotState(newState);
  }, [plotState, setPlotState]);

  return {
    ...plotState,
    setCurrentFile,
    setSelectedChannels,
    setTimeWindow,
    setZoomLevel,
    resetPlot,
    isLoading,
    error
  };
}

// Custom hook for app settings
export function useAppSettings() {
  const {
    value: settings,
    setValue: setSettings,
    reset: resetSettings,
    isLoading,
    error
  } = useState(appSettingsConfig);

  const setTheme = React.useCallback(async (theme: 'light' | 'dark' | 'system') => {
    const newState = { ...settings, theme };
    await setSettings(newState);
  }, [settings, setSettings]);

  const toggleSidebar = React.useCallback(async () => {
    const newState = { ...settings, sidebarCollapsed: !settings.sidebarCollapsed };
    await setSettings(newState);
  }, [settings, setSettings]);

  const toggleDebugMode = React.useCallback(async () => {
    const newState = { ...settings, debugMode: !settings.debugMode };
    await setSettings(newState);
  }, [settings, setSettings]);

  return {
    ...settings,
    setTheme,
    toggleSidebar,
    toggleDebugMode,
    resetSettings,
    isLoading,
    error
  };
}

// Computed state example: derive UI state from multiple sources
export function useUIState() {
  const hasWidgets = useComputedState(
    ['dashboard.layout'],
    (layoutState: DashboardLayoutState) => layoutState.widgets.length > 0,
    'ui.hasWidgets'
  );

  const hasActivePlot = useComputedState(
    ['dashboard.plot'],
    (plotState: PlotState) => plotState.currentFilePath !== null,
    'ui.hasActivePlot'
  );

  const isDebugEnabled = useComputedState(
    ['app.settings'],
    (settings: AppSettings) => settings.debugMode,
    'ui.isDebugEnabled'
  );

  return {
    hasWidgets: hasWidgets ?? false,
    hasActivePlot: hasActivePlot ?? false,
    isDebugEnabled: isDebugEnabled ?? false
  };
}

// Component to set up state management plugins and middleware
function StateSetup() {
  const store = useStateStore();

  React.useEffect(() => {
    // Add logging middleware for debugging
    const loggingMiddleware = new LoggingMiddleware({
      logLevel: 'debug'
    });
    store.addMiddleware(loggingMiddleware);

    // Install plugins
    const persistencePlugin = new PersistencePlugin({
      autoSaveInterval: 10000, // Save every 10 seconds
      saveDelay: 1000 // Debounce for 1 second
    });

    const crossTabPlugin = new CrossTabSyncPlugin('ddalab-state-sync');

    const historyPlugin = new HistoryPlugin(50); // Keep 50 history entries

    store.installPlugin(persistencePlugin);
    store.installPlugin(crossTabPlugin);
    store.installPlugin(historyPlugin);

    console.log('[StateSetup] Plugins and middleware installed');

    return () => {
      // Cleanup on unmount
      store.removeMiddleware(loggingMiddleware);
      store.uninstallPlugin('persistence');
      store.uninstallPlugin('cross-tab-sync');
      store.uninstallPlugin('history');
    };
  }, [store]);

  return null;
}

// Main provider component for the entire app
export function AppStateProvider({ children }: { children: ReactNode }) {
  return (
    <StateProvider
      storageType="indexedDB" // Use IndexedDB for better performance and capacity
      storagePrefix="ddalab_v2_"
      enableDebug={process.env.NODE_ENV === 'development'}
      syncInterval={30000} // Sync every 30 seconds
    >
      <StateSetup />
      {children}
    </StateProvider>
  );
}

// Debug panel component
export function DebugPanel() {
  const { DebuggerComponent } = useStateDebugger();
  const { debugMode } = useAppSettings();

  if (!debugMode) return null;

  return <DebuggerComponent />;
}

// Example usage in a dashboard component
export function ExampleDashboardComponent() {
  const dashboardLayout = useDashboardLayout();
  const plotState = usePlotState();
  const appSettings = useAppSettings();
  const uiState = useUIState();

  const handleAddWidget = async () => {
    const newWidget: DashboardWidget = {
      id: `widget-${Date.now()}`,
      type: 'chart',
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 },
      title: 'New Chart Widget',
      isPopOut: false
    };
    await dashboardLayout.addWidget(newWidget);
  };

  return (
    <div>
      <h2>Dashboard State Management Example</h2>

      <div>
        <p>Widgets: {dashboardLayout.widgets.length}</p>
        <p>Selected: {dashboardLayout.selectedWidget || 'None'}</p>
        <p>Current File: {plotState.currentFilePath || 'None'}</p>
        <p>Theme: {appSettings.theme}</p>
        <p>Has Widgets: {uiState.hasWidgets ? 'Yes' : 'No'}</p>
        <p>Has Active Plot: {uiState.hasActivePlot ? 'Yes' : 'No'}</p>
      </div>

      <div>
        <button onClick={handleAddWidget}>Add Widget</button>
        <button onClick={() => void dashboardLayout.resetLayout()}>Reset Layout</button>
        <button onClick={() => void appSettings.toggleSidebar()}>
          {appSettings.sidebarCollapsed ? 'Expand' : 'Collapse'} Sidebar
        </button>
        <button onClick={() => void appSettings.toggleDebugMode()}>
          Toggle Debug Mode
        </button>
      </div>

      <DebugPanel />
    </div>
  );
}