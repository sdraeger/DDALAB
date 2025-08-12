"use client";

import React, { useCallback, useEffect } from 'react';
import { useModernDashboard } from '../../hooks/useModernDashboard';
import { useEDFPlot } from '../../contexts/EDFPlotContext';
import { useSettings } from '../../contexts/SettingsContext';

// Temporary stubs for deleted functionality
type DashboardWidget = {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  title: string;
  isPopOut: boolean;
};

// Use the proper modern dashboard hook instead of stubs
const useDashboardLayout = () => {
  const modernDashboard = useModernDashboard({
    widgetCallbacks: {
      // Include any callback functions needed by widgets
    }
  });

  // Create a map of widget ID to layout for easy lookup
  const layoutMap = new Map(modernDashboard.layouts.map(layout => [layout.i, layout]));

  // Convert IDashboardWidget[] to DashboardWidget[] for compatibility
  const convertedWidgets: DashboardWidget[] = modernDashboard.widgets.map(widget => {
    const layout = layoutMap.get(widget.id);
    return {
      id: widget.id,
      type: widget.type,
      // Use actual layout positions/sizes, or defaults if no layout exists
      position: layout ? { x: layout.x * 100, y: layout.y * 60 } : { x: 0, y: 0 }, // Convert grid units to pixels
      size: layout ? { width: layout.w * 100, height: layout.h * 60 } : { width: 400, height: 300 }, // Convert grid units to pixels
      title: widget.title,
      isPopOut: false
    };
  });

  return {
    widgets: convertedWidgets,
    selectedWidget: null as string | null,
    gridSize: 12,
    enableSnapping: true,
    isLoading: modernDashboard.isLoading,
    isInitialized: modernDashboard.isLayoutInitialized,
    error: modernDashboard.saveError ? new Error(modernDashboard.saveError) : null,
    addWidget: async (widget: DashboardWidget) => {
      // Convert DashboardWidget back to the format expected by modern dashboard
      await modernDashboard.addWidget(widget.type, {
        title: widget.title,
        position: widget.position,
        size: widget.size
      });
    },
    updateWidget: async (id: string, updates: Partial<DashboardWidget>) => {
      // Update the widget first
      modernDashboard.updateWidget(id, updates);

      // If position or size changed, update the layout as well
      if (updates.position || updates.size) {
        const existingLayout = layoutMap.get(id);
        const currentWidget = modernDashboard.widgets.find(w => w.id === id);

        if (currentWidget) {
          // Convert pixel-based position/size back to grid units
          const gridPosition = {
            x: updates.position ? Math.round(updates.position.x / 100) : (existingLayout?.x || 0),
            y: updates.position ? Math.round(updates.position.y / 60) : (existingLayout?.y || 0)
          };
          const gridSize = {
            w: updates.size ? Math.round(updates.size.width / 100) : (existingLayout?.w || 4),
            h: updates.size ? Math.round(updates.size.height / 60) : (existingLayout?.h || 3)
          };

          // Update the layout array
          const newLayouts = modernDashboard.layouts.map(layout =>
            layout.i === id
              ? { ...layout, ...gridPosition, ...gridSize }
              : layout
          );

          // If layout doesn't exist for this widget, create one
          if (!existingLayout) {
            newLayouts.push({
              i: id,
              x: gridPosition.x,
              y: gridPosition.y,
              w: gridSize.w,
              h: gridSize.h
            });
          }

          // Update the layout, which will trigger auto-save
          modernDashboard.updateLayout(newLayouts);
        }
      }
    },
    removeWidget: async (id: string) => {
      modernDashboard.removeWidget(id);
    },
    selectWidget: async (_id: string | null) => {
      // Modern dashboard doesn't have widget selection yet
    },
    resetLayout: async () => {
      await modernDashboard.clearLayout();
    }
  };
};

const DebugPanel = () => null; // Removed DebugPanel content

/**
 * Integration component that bridges existing dashboard functionality 
 * with the new centralized state management system
 */
export function DashboardStateIntegration({ children }: { children: React.ReactNode }) {
  const dashboardLayout = useDashboardLayout();
  const plotState = useEDFPlot(); // Use the actual EDFPlotContext
  const appSettings = useSettings(); // Use the actual SettingsContext

  // Expose state management functions globally for gradual migration
  useEffect(() => {
    // Attach to window for easy access during migration
    (window as any).dashboardState = {
      layout: dashboardLayout,
      plot: plotState,
      settings: appSettings
    };

    return () => {
      delete (window as any).dashboardState;
    };
  }, [dashboardLayout, plotState, appSettings]);

  // Log state changes for debugging
  useEffect(() => {
    console.log('[DashboardStateIntegration] Dashboard layout state:', {
      widgetCount: dashboardLayout.widgets.length,
      selectedWidget: dashboardLayout.selectedWidget,
      gridSize: dashboardLayout.gridSize,
      isLoading: dashboardLayout.isLoading,
      error: dashboardLayout.error
    });
  }, [dashboardLayout]);

  useEffect(() => {
    // Get the current plot state for the selected file
    const currentPlotState = plotState.getPlotState(plotState.selectedFilePath);
    console.log('[DashboardStateIntegration] Plot state:', {
      currentFile: plotState.selectedFilePath,
      selectedChannels: currentPlotState?.selectedChannels || [],
      timeWindow: currentPlotState?.timeWindow || [0, 0],
      zoomLevel: currentPlotState?.zoomLevel || 1,
      isLoading: plotState.plotStates.size === 0 && !plotState.selectedFilePath,
      error: plotState.plotStates.size === 0 && plotState.selectedFilePath ? new Error("Plot not loaded") : null,
    });
  }, [plotState]);

  useEffect(() => {
    console.log('[DashboardStateIntegration] App settings:', {
      theme: appSettings.userPreferences.theme,
      sidebarCollapsed: appSettings.userPreferences.sidebarCollapsed,
      debugMode: appSettings.userPreferences.debugMode,
      isLoading: false,
      error: null,
    });
  }, [appSettings]);

  return (
    <>
      {children}
      <DebugPanel />
    </>
  );
}

/**
 * Hook for accessing dashboard state management functions
 * This provides a bridge between old and new state systems
 */
export function useDashboardStateBridge() {
  const dashboardLayout = useDashboardLayout();
  const plotState = useEDFPlot();
  const appSettings = useSettings();

  // Enhanced widget management with automatic persistence
  const enhancedAddWidget = useCallback(async (
    widgetOrType: any, // Accept DashboardGrid Widget object or string type
    config: {
      position?: { x: number; y: number };
      size?: { width: number; height: number };
      title?: string;
      isPopOut?: boolean;
    } = {}
  ) => {
    let type: string;
    let widgetConfig = config;

    // Handle both Widget object from DashboardToolbar and string type
    if (typeof widgetOrType === 'string') {
      type = widgetOrType;
    } else if (widgetOrType && typeof widgetOrType === 'object') {
      // Widget object from DashboardToolbar (has id, title, content, position, size, type)
      type = widgetOrType.type || 'unknown';
      widgetConfig = {
        position: widgetOrType.position || config.position,
        size: widgetOrType.size || config.size,
        title: widgetOrType.title || config.title,
        isPopOut: widgetOrType.isPopOut || config.isPopOut
      };
    } else {
      type = 'unknown';
    }

    const newWidget: DashboardWidget = {
      id: widgetOrType.id || `widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      position: widgetConfig.position || { x: 100, y: 100 },
      size: widgetConfig.size || { width: 400, height: 300 },
      title: widgetConfig.title || (type ? `${type.charAt(0).toUpperCase() + type.slice(1)} Widget` : 'Unknown Widget'),
      isPopOut: widgetConfig.isPopOut || false
    };

    await dashboardLayout.addWidget(newWidget);
    return newWidget;
  }, [dashboardLayout]);

  const enhancedUpdateWidget = useCallback(async (
    id: string,
    updates: Partial<DashboardWidget>
  ) => {
    await dashboardLayout.updateWidget(id, updates);
  }, [dashboardLayout]);

  const enhancedRemoveWidget = useCallback(async (id: string) => {
    await dashboardLayout.removeWidget(id);
  }, [dashboardLayout]);

  // Enhanced plot state management
  const enhancedSetCurrentFile = useCallback(async (filePath: string | null) => {
    if (filePath !== null) {
      plotState.setSelectedFilePath(filePath);
    } else {
      // Handle null case, e.g., clear the selected file path
      plotState.setSelectedFilePath(""); // Or some other default/clear value
    }
    console.log('[DashboardStateBridge] File path updated to:', filePath);
  }, [plotState]);

  const enhancedSetSelectedChannels = useCallback(async (channels: string[]) => {
    if (plotState.selectedFilePath) {
      plotState.updatePlotState(plotState.selectedFilePath, { selectedChannels: channels });
      console.log('[DashboardStateBridge] Selected channels updated to:', channels);
    }
  }, [plotState]);

  // Enhanced app settings management
  const enhancedToggleSidebar = useCallback(async () => {
    appSettings.updatePreference("sidebarCollapsed", !appSettings.userPreferences.sidebarCollapsed);
    console.log('[DashboardStateBridge] Sidebar toggled, collapsed:', !appSettings.userPreferences.sidebarCollapsed);
  }, [appSettings]);

  const enhancedSetTheme = useCallback(async (theme: 'light' | 'dark' | 'system') => {
    appSettings.updatePreference("theme", theme);
    console.log('[DashboardStateBridge] Theme updated to:', theme);
  }, [appSettings]);

  const enhancedToggleDebugMode = useCallback(async () => {
    appSettings.updatePreference("debugMode", !appSettings.userPreferences.debugMode);
    console.log('[DashboardStateBridge] Debug mode toggled, debugMode:', !appSettings.userPreferences.debugMode);
  }, [appSettings]);

  return {
    // Dashboard layout management
    widgets: dashboardLayout.widgets,
    selectedWidget: dashboardLayout.selectedWidget,
    gridSize: dashboardLayout.gridSize,
    enableSnapping: dashboardLayout.enableSnapping,
    addWidget: enhancedAddWidget,
    updateWidget: enhancedUpdateWidget,
    removeWidget: enhancedRemoveWidget,
    selectWidget: dashboardLayout.selectWidget,
    resetLayout: dashboardLayout.resetLayout,

    // Plot state management
    currentFilePath: plotState.selectedFilePath,
    selectedChannels: plotState.getPlotState(plotState.selectedFilePath)?.selectedChannels || [],
    timeWindow: plotState.getPlotState(plotState.selectedFilePath)?.timeWindow || [0, 0],
    zoomLevel: plotState.getPlotState(plotState.selectedFilePath)?.zoomLevel || 1,
    setCurrentFile: enhancedSetCurrentFile,
    setSelectedChannels: enhancedSetSelectedChannels,
    setTimeWindow: (timeWindow: [number, number]) => {
      if (plotState.selectedFilePath) {
        plotState.updatePlotState(plotState.selectedFilePath, { timeWindow });
      }
    },
    setZoomLevel: (zoomLevel: number) => {
      if (plotState.selectedFilePath) {
        plotState.updatePlotState(plotState.selectedFilePath, { zoomLevel });
      }
    },
    resetPlot: plotState.clearAllPlotStates,

    // App settings management
    theme: appSettings.userPreferences.theme,
    sidebarCollapsed: appSettings.userPreferences.sidebarCollapsed,
    debugMode: appSettings.userPreferences.debugMode,
    setTheme: enhancedSetTheme,
    toggleSidebar: enhancedToggleSidebar,
    toggleDebugMode: enhancedToggleDebugMode,
    resetSettings: appSettings.resetChanges,

    // Loading states
    isLayoutLoading: dashboardLayout.isLoading,
    isLayoutInitialized: dashboardLayout.isInitialized,
    isPlotLoading: plotState.plotStates.size === 0 && !plotState.selectedFilePath,
    isPlotInitialized: true,
    isSettingsLoading: false,
    isSettingsInitialized: true,

    // Error states
    layoutError: dashboardLayout.error,
    plotError: plotState.plotStates.size === 0 && plotState.selectedFilePath ? new Error("Plot not loaded") : null,
    settingsError: null
  };
}