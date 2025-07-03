import { useState, useCallback, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Layout } from "react-grid-layout";
import { useToast } from "../components/ui/use-toast";
import {
  IDashboardWidget,
  IDashboardConfig,
  IDashboardEvents,
  IModernDashboardState,
  IResponsiveState,
  IDockConfig,
} from "../types/dashboard";
import { WidgetFactoryService } from "../services/WidgetFactoryService";
import { LayoutPersistenceService } from "../services/LayoutPersistenceService";
import { dashboardDebugger } from "../lib/utils/dashboard-debug";
import logger from "../lib/utils/logger";

// Default dashboard configuration
const DEFAULT_CONFIG: IDashboardConfig = {
  cols: { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 },
  breakpoints: { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 },
  rowHeight: 60,
  margin: [8, 8],
  containerPadding: [8, 8],
  enableDocking: true,
  enablePersistence: true,
  autoSave: true,
  autoSaveDelay: 2000,
};

// Hook options
interface UseModernDashboardOptions {
  config?: Partial<IDashboardConfig>;
  events?: IDashboardEvents;
  initialWidgets?: IDashboardWidget[];
  initialLayout?: Layout[];
  // Callback providers for specific widget types
  widgetCallbacks?: {
    onFileSelect?: (filePath: string) => void;
    [key: string]: any;
  };
}

export function useModernDashboard(options: UseModernDashboardOptions = {}) {
  const { data: session } = useSession();
  const { toast } = useToast();

  // Merge configuration
  const config = { ...DEFAULT_CONFIG, ...options.config };

  // Services
  const widgetFactory = WidgetFactoryService.getInstance();
  const layoutPersistence = LayoutPersistenceService.getInstance();

  // State
  const [state, setState] = useState<IModernDashboardState>({
    widgets: options.initialWidgets || [],
    layout: options.initialLayout || [],
    dockPanels: new Map<string, IDockConfig>(),
    responsive: {
      currentBreakpoint: "lg",
      currentCols: config.cols.lg,
      containerWidth: 1200,
    },
    isLoading: false,
    isSaving: false,
    saveStatus: "idle",
  });

  // Auto-save timer
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const saveStatusTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedStateRef = useRef<string>("");

  // Update access token when session changes
  useEffect(() => {
    layoutPersistence.setAccessToken(session?.accessToken || null);
  }, [session?.accessToken]);

  // Layout management functions
  const updateLayout = useCallback(
    (newLayout: Layout[]) => {
      // Log size changes for debugging
      const sizeChanges = newLayout.map((item) => ({
        id: item.i,
        size: `${item.w}x${item.h}`,
        position: `(${item.x},${item.y})`,
      }));

      logger.info("Layout updated with widget sizes:", {
        widgetCount: newLayout.length,
        sizeInfo: sizeChanges,
      });

      setState((prev) => ({ ...prev, layout: newLayout }));
      options.events?.onLayoutChange?.(newLayout);

      // Schedule auto-save if enabled to preserve size changes
      if (config.autoSave && session?.accessToken) {
        scheduleAutoSave();
      }
    },
    [options.events, config.autoSave, session?.accessToken]
  );

  const addWidget = useCallback(
    (type: string, widgetConfig?: any, position?: Partial<Layout>) => {
      try {
        // Merge provided config with callbacks for specific widget types
        let finalConfig = { ...widgetConfig };
        if (type === "file-browser" && options.widgetCallbacks?.onFileSelect) {
          finalConfig.onFileSelect = options.widgetCallbacks.onFileSelect;
        }

        const widget = widgetFactory.createWidget(type, finalConfig);

        // Generate layout item with proper size handling
        const layoutItem: Layout = {
          i: widget.id,
          x: position?.x || 0,
          y: position?.y || 0,
          w: position?.w || widget.constraints?.minW || 4,
          h: position?.h || widget.constraints?.minH || 3,
          minW: widget.constraints?.minW,
          maxW: widget.constraints?.maxW,
          minH: widget.constraints?.minH,
          maxH: widget.constraints?.maxH,
          isDraggable: widget.constraints?.isDraggable !== false,
          isResizable: widget.constraints?.isResizable !== false,
          static: widget.constraints?.static || false,
        };

        setState((prev) => ({
          ...prev,
          widgets: [...prev.widgets, widget],
          layout: [...prev.layout, layoutItem],
        }));

        options.events?.onWidgetAdd?.(widget);

        // Schedule auto-save to capture the new widget size
        if (config.autoSave && session?.accessToken) {
          scheduleAutoSave();
        }

        logger.info(
          `Added widget: ${widget.id} (${type}) with size ${layoutItem.w}x${layoutItem.h}`
        );
      } catch (error) {
        logger.error("Error adding widget:", error);
        toast({
          title: "Error",
          description: "Failed to add widget",
          variant: "destructive",
        });
      }
    },
    [
      widgetFactory,
      options.events,
      config.autoSave,
      session?.accessToken,
      toast,
    ]
  );

  const removeWidget = useCallback(
    (widgetId: string) => {
      setState((prev) => ({
        ...prev,
        widgets: prev.widgets.filter((w) => w.id !== widgetId),
        layout: prev.layout.filter((l) => l.i !== widgetId),
      }));

      options.events?.onWidgetRemove?.(widgetId);

      // Clean up widget state from localStorage
      const stateKey = `widget-state-${widgetId}`;
      localStorage.removeItem(stateKey);

      // Clean up any popout data
      const popoutKey = `modern-popped-widget-${widgetId}`;
      localStorage.removeItem(popoutKey);

      // Schedule auto-save
      if (config.autoSave && session?.accessToken) {
        scheduleAutoSave();
      }

      logger.info(`Removed widget: ${widgetId} and cleaned up state`);
    },
    [options.events, config.autoSave, session?.accessToken]
  );

  const updateWidget = useCallback(
    (widgetId: string, updates: Partial<IDashboardWidget>) => {
      setState((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) =>
          w.id === widgetId ? { ...w, ...updates } : w
        ),
      }));

      options.events?.onWidgetUpdate?.(widgetId, updates);

      // Schedule auto-save
      if (config.autoSave && session?.accessToken) {
        scheduleAutoSave();
      }
    },
    [options.events, config.autoSave, session?.accessToken]
  );

  // Responsive breakpoint handling
  const onBreakpointChange = useCallback(
    (breakpoint: string, cols: number) => {
      setState((prev) => ({
        ...prev,
        responsive: {
          ...prev.responsive,
          currentBreakpoint: breakpoint,
          currentCols: cols,
        },
      }));

      options.events?.onBreakpointChange?.(breakpoint, cols);
      logger.info(`Breakpoint changed: ${breakpoint} (${cols} columns)`);
    },
    [options.events]
  );

  // Auto-save functionality
  const scheduleAutoSave = useCallback(() => {
    if (!config.autoSave || !session?.accessToken) return;

    // Don't auto-save if there are no widgets (empty layout)
    if (state.widgets.length === 0) {
      logger.info("Skipping auto-save for empty layout");
      return;
    }

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Check if state has changed
    const currentStateString = JSON.stringify({
      layout: state.layout,
      widgets: state.widgets.map((w) => ({ ...w, content: null })), // Exclude content for comparison
    });

    if (currentStateString === lastSavedStateRef.current) {
      return; // No changes to save
    }

    // Schedule save
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await saveLayout();
      } catch (error) {
        // Error is already handled in saveLayout
      }
    }, config.autoSaveDelay);
  }, [
    config.autoSave,
    config.autoSaveDelay,
    session?.accessToken,
    state.layout,
    state.widgets,
  ]);

  // Persistence functions
  const resetSaveStatus = useCallback(() => {
    if (saveStatusTimerRef.current) {
      clearTimeout(saveStatusTimerRef.current);
    }
    saveStatusTimerRef.current = setTimeout(() => {
      setState((prev) => ({ ...prev, saveStatus: "idle" }));
    }, 2500); // Reset after 2.5 seconds
  }, []);

  const saveLayout = useCallback(async () => {
    if (!session?.accessToken) {
      throw new Error("No authentication token available");
    }

    try {
      setState((prev) => ({ ...prev, isSaving: true, saveStatus: "saving" }));

      // Debug analysis before saving (in development)
      if (process.env.NODE_ENV === "development") {
        dashboardDebugger.analyzeLayout(state.layout, state.widgets);
      }

      await layoutPersistence.saveLayout(state.layout, state.widgets);

      // Update last saved reference
      lastSavedStateRef.current = JSON.stringify({
        layout: state.layout,
        widgets: state.widgets.map((w) => ({ ...w, content: null })),
      });

      setState((prev) => ({ ...prev, saveStatus: "success" }));
      resetSaveStatus();
    } catch (error) {
      logger.error("Error saving layout:", error);
      setState((prev) => ({ ...prev, saveStatus: "error" }));
      resetSaveStatus();
      throw error;
    } finally {
      setState((prev) => ({ ...prev, isSaving: false }));
    }
  }, [
    session?.accessToken,
    state.layout,
    state.widgets,
    layoutPersistence,
    resetSaveStatus,
  ]);

  const loadLayout = useCallback(async () => {
    if (!session?.accessToken) {
      return;
    }

    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      const result = await layoutPersistence.loadLayout();

      if (result) {
        // Create a map of layout items for easy lookup
        const layoutMap = new Map<string, Layout>();
        result.layout.forEach((item: Layout) => {
          layoutMap.set(item.i, item);
        });

        // Recreate widgets using factory
        const recreatedWidgets = result.widgets
          .map((widgetData: any) => {
            try {
              // Merge stored config with current callbacks
              let widgetConfig: any = {
                id: widgetData.id,
                title: widgetData.title,
                metadata: widgetData.metadata,
              };

              // Add callbacks for specific widget types
              if (
                widgetData.type === "file-browser" &&
                options.widgetCallbacks?.onFileSelect
              ) {
                widgetConfig.onFileSelect =
                  options.widgetCallbacks.onFileSelect;
              }

              const recreatedWidget = widgetFactory.createWidget(
                widgetData.type,
                widgetConfig
              );

              // Ensure the widget has the correct layout constraints from saved data
              if (widgetData.layoutInfo) {
                // Update constraints to match saved layout if available
                if (recreatedWidget.constraints) {
                  recreatedWidget.constraints = {
                    ...recreatedWidget.constraints,
                    // Preserve any stored constraint overrides
                    minW:
                      widgetData.layoutInfo.minW ??
                      recreatedWidget.constraints.minW,
                    maxW:
                      widgetData.layoutInfo.maxW ??
                      recreatedWidget.constraints.maxW,
                    minH:
                      widgetData.layoutInfo.minH ??
                      recreatedWidget.constraints.minH,
                    maxH:
                      widgetData.layoutInfo.maxH ??
                      recreatedWidget.constraints.maxH,
                  };
                }
              }

              return recreatedWidget;
            } catch (error) {
              logger.warn(`Failed to recreate widget ${widgetData.id}:`, error);
              return null;
            }
          })
          .filter(Boolean) as IDashboardWidget[];

        // Validate that all widgets have corresponding layout items
        const missingLayoutItems = recreatedWidgets.filter(
          (widget) => !layoutMap.has(widget.id)
        );

        if (missingLayoutItems.length > 0) {
          logger.warn(
            "Some widgets are missing layout information:",
            missingLayoutItems.map((w) => ({ id: w.id, type: w.type }))
          );
        }

        // Log layout restoration details
        logger.info("Widget layout restoration details:", {
          totalWidgets: recreatedWidgets.length,
          layoutItems: result.layout.length,
          sizePreservation: result.layout.map((item: Layout) => ({
            id: item.i,
            size: `${item.w}x${item.h}`,
            position: `(${item.x},${item.y})`,
          })),
        });

        setState((prev) => ({
          ...prev,
          widgets: recreatedWidgets,
          layout: result.layout,
        }));

        // Debug analysis after loading (in development)
        if (process.env.NODE_ENV === "development") {
          dashboardDebugger.analyzeLayout(result.layout, recreatedWidgets);
        }

        // Update last saved reference to prevent unnecessary auto-saves
        lastSavedStateRef.current = JSON.stringify({
          layout: result.layout,
          widgets: recreatedWidgets.map((w) => ({ ...w, content: null })),
        });

        toast({
          title: "Layout Loaded",
          description: `Loaded ${recreatedWidgets.length} widgets with preserved sizes.`,
          duration: 2000,
        });
      }
    } catch (error) {
      logger.error("Error loading layout:", error);
      toast({
        title: "Load Failed",
        description: "Failed to load saved layout.",
        variant: "destructive",
      });
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [session?.accessToken, layoutPersistence, widgetFactory, toast]);

  const clearLayout = useCallback(async () => {
    if (!session?.accessToken) return;

    try {
      await layoutPersistence.clearLayout();

      setState((prev) => ({
        ...prev,
        widgets: [],
        layout: [],
      }));

      lastSavedStateRef.current = "";

      toast({
        title: "Layout Cleared",
        description: "Your saved layout has been cleared.",
        duration: 2000,
      });
    } catch (error) {
      logger.error("Error clearing layout:", error);
      toast({
        title: "Clear Failed",
        description: "Failed to clear saved layout.",
        variant: "destructive",
      });
    }
  }, [session?.accessToken, layoutPersistence, toast]);

  // Load layout on session change
  useEffect(() => {
    if (session?.accessToken && config.enablePersistence) {
      loadLayout();
    }
  }, [session?.accessToken, config.enablePersistence]);

  // Cleanup auto-save timer
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      if (saveStatusTimerRef.current) {
        clearTimeout(saveStatusTimerRef.current);
      }
    };
  }, []);

  return {
    // State
    widgets: state.widgets,
    layout: state.layout,
    dockPanels: state.dockPanels,
    responsive: state.responsive,
    isLoading: state.isLoading,
    isSaving: state.isSaving,
    saveStatus: state.saveStatus,

    // Configuration
    config,

    // Widget management
    addWidget,
    removeWidget,
    updateWidget,

    // Layout management
    updateLayout,
    onBreakpointChange,

    // Persistence
    saveLayout,
    loadLayout,
    clearLayout,

    // Services (for advanced usage)
    widgetFactory,
    layoutPersistence,
  };
}
