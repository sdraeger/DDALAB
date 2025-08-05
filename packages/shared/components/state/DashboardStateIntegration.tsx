"use client";

import React, { useCallback, useEffect } from 'react';
import { useDashboardLayout, usePlotState, useAppSettings, DebugPanel } from '../../lib/state/examples/DashboardStateExample';
import type { DashboardWidget } from '../../lib/state/examples/DashboardStateExample';

/**
 * Integration component that bridges existing dashboard functionality 
 * with the new centralized state management system
 */
export function DashboardStateIntegration({ children }: { children: React.ReactNode }) {
  const dashboardLayout = useDashboardLayout();
  const plotState = usePlotState();
  const appSettings = useAppSettings();

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
    console.log('[DashboardStateIntegration] Plot state:', {
      currentFile: plotState.currentFilePath,
      selectedChannels: plotState.selectedChannels,
      timeWindow: plotState.timeWindow,
      zoomLevel: plotState.zoomLevel,
      isLoading: plotState.isLoading,
      error: plotState.error
    });
  }, [plotState]);

  useEffect(() => {
    console.log('[DashboardStateIntegration] App settings:', {
      theme: appSettings.theme,
      sidebarCollapsed: appSettings.sidebarCollapsed,
      debugMode: appSettings.debugMode,
      isLoading: appSettings.isLoading,
      error: appSettings.error
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
  const plotState = usePlotState();
  const appSettings = useAppSettings();

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
    await plotState.setCurrentFile(filePath);
    console.log('[DashboardStateBridge] File path updated to:', filePath);
  }, [plotState]);

  const enhancedSetSelectedChannels = useCallback(async (channels: string[]) => {
    await plotState.setSelectedChannels(channels);
    console.log('[DashboardStateBridge] Selected channels updated to:', channels);
  }, [plotState]);

  // Enhanced app settings management
  const enhancedToggleSidebar = useCallback(async () => {
    await appSettings.toggleSidebar();
    console.log('[DashboardStateBridge] Sidebar toggled, collapsed:', !appSettings.sidebarCollapsed);
  }, [appSettings]);

  const enhancedSetTheme = useCallback(async (theme: 'light' | 'dark' | 'system') => {
    await appSettings.setTheme(theme);
    console.log('[DashboardStateBridge] Theme updated to:', theme);
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
    currentFilePath: plotState.currentFilePath,
    selectedChannels: plotState.selectedChannels,
    timeWindow: plotState.timeWindow,
    zoomLevel: plotState.zoomLevel,
    setCurrentFile: enhancedSetCurrentFile,
    setSelectedChannels: enhancedSetSelectedChannels,
    setTimeWindow: plotState.setTimeWindow,
    setZoomLevel: plotState.setZoomLevel,
    resetPlot: plotState.resetPlot,

    // App settings management
    theme: appSettings.theme,
    sidebarCollapsed: appSettings.sidebarCollapsed,
    debugMode: appSettings.debugMode,
    setTheme: enhancedSetTheme,
    toggleSidebar: enhancedToggleSidebar,
    toggleDebugMode: appSettings.toggleDebugMode,
    resetSettings: appSettings.resetSettings,

    // Loading states
    isLayoutLoading: dashboardLayout.isLoading,
    isPlotLoading: plotState.isLoading,
    isSettingsLoading: appSettings.isLoading,

    // Error states
    layoutError: dashboardLayout.error,
    plotError: plotState.error,
    settingsError: appSettings.error
  };
}