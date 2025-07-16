import { useCallback, useState, useEffect, useRef } from "react";
import { Layout } from "react-grid-layout";
import {
  IDashboardWidget,
  IWidgetFactory,
  IDashboardConfig,
} from "../types/dashboard";
import { LayoutPersistenceService } from "../services/LayoutPersistenceService";
import { WidgetFactoryService } from "../services/WidgetFactoryService";
import logger from "../lib/utils/logger";
import { useAuthMode } from "../contexts/AuthModeContext";
import { useUnifiedSessionData } from "./useUnifiedSession";
import {
  dashboardStorage,
  widgetLayoutStorage,
} from "../lib/utils/authModeStorage";

// Default configuration for the modern dashboard
const DEFAULT_CONFIG: IDashboardConfig = {
  cols: { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 },
  breakpoints: { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 },
  rowHeight: 60,
  margin: [10, 10],
  containerPadding: [10, 10],
  enableDocking: false,
  enablePersistence: true,
  autoSave: true,
  autoSaveDelay: 2000,
};

interface UseModernDashboardOptions {
  config?: Partial<IDashboardConfig>;
  widgetCallbacks?: {
    onFileSelect?: (filePath: string) => void;
    [key: string]: any;
  };
}

interface UseModernDashboardResult {
  layouts: Layout[];
  layout: Layout[];
  widgets: IDashboardWidget[];
  config: IDashboardConfig;
  isLoading: boolean;
  isSaving: boolean;
  saveStatus: "idle" | "saving" | "success" | "error";
  isLayoutInitialized: boolean;
  saveError: string | null;
  addWidget: (
    type: string,
    widgetConfig?: any,
    position?: Partial<Layout>
  ) => Promise<IDashboardWidget>;
  removeWidget: (widgetId: string) => void;
  updateWidget: (widgetId: string, updates: Partial<IDashboardWidget>) => void;
  updateLayout: (newLayouts: Layout[]) => void;
  saveLayout: () => Promise<boolean>;
  clearLayout: () => Promise<boolean>;
  loadLayout: () => Promise<void>;
  onBreakpointChange: (breakpoint: string, cols: number) => void;
}

export function useModernDashboard(
  options: UseModernDashboardOptions = {}
): UseModernDashboardResult {
  const { isMultiUserMode } = useAuthMode();

  // Always call useSession but only use in multi-user mode
  const { data: session } = useUnifiedSessionData();
  const authToken = isMultiUserMode ? session?.accessToken : "local-mode-token";

  // Merge user config with defaults
  const config = { ...DEFAULT_CONFIG, ...options.config };

  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [widgets, setWidgets] = useState<IDashboardWidget[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [isLayoutInitialized, setIsLayoutInitialized] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const persistenceService = useRef(LayoutPersistenceService.getInstance());
  const widgetFactory = useRef<IWidgetFactory>(
    WidgetFactoryService.getInstance()
  );

  const hasInitialized = useRef(false);

  // Update persistence service token when auth token changes
  useEffect(() => {
    if (authToken) {
      persistenceService.current.setAccessToken(authToken);
    }
  }, [authToken]);

  // Load initial layout
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      loadLayout();
    }
  }, []);

  const loadLayout = useCallback(async () => {
    // In local mode, always work with local storage
    if (!isMultiUserMode) {
      setIsLoading(true);
      try {
        const localLayouts =
          dashboardStorage.getItem<Layout[]>("layouts") || [];
        const localWidgets =
          widgetLayoutStorage.getItem<any[]>("widgets") || [];

        setLayouts(localLayouts);

        if (localWidgets.length > 0) {
          const restoredWidgets: IDashboardWidget[] = [];
          for (const serializableWidget of localWidgets) {
            try {
              const widget = widgetFactory.current.createWidget(
                serializableWidget.type,
                {
                  id: serializableWidget.id,
                  ...serializableWidget.metadata,
                  ...options.widgetCallbacks, // Include callbacks when restoring
                }
              );

              if (widget && serializableWidget.title) {
                widget.title = serializableWidget.title;
              }

              if (widget) {
                restoredWidgets.push(widget);
              }
            } catch (error) {
              logger.error(
                `Failed to restore local widget ${serializableWidget.id}:`,
                error
              );
            }
          }
          setWidgets(restoredWidgets);
        }

        logger.info("Loaded dashboard layout from local storage");
      } catch (error) {
        logger.error("Error loading local dashboard layout:", error);
      } finally {
        setIsLoading(false);
        setIsLayoutInitialized(true);
      }
      return;
    }

    // Multi-user mode - try server then fallback to local
    if (!authToken) {
      logger.warn("Cannot load layout: no auth token available");
      setIsLayoutInitialized(true);
      return;
    }

    setIsLoading(true);
    setSaveError(null);

    try {
      // First try to load from server
      const layoutData = await persistenceService.current.loadLayout();

      if (layoutData) {
        logger.info("Loaded dashboard layout from server");
        setLayouts(layoutData.layout);

        // Convert serialized widget data back to full widgets
        const restoredWidgets: IDashboardWidget[] = [];

        for (const serializableWidget of layoutData.widgets) {
          try {
            const widget = widgetFactory.current.createWidget(
              serializableWidget.type,
              {
                id: serializableWidget.id,
                ...serializableWidget.metadata,
                ...options.widgetCallbacks, // Include callbacks when restoring
              }
            );

            if (widget) {
              // Preserve the title from saved data
              if (serializableWidget.title) {
                widget.title = serializableWidget.title;
              }

              restoredWidgets.push(widget);
            }
          } catch (error) {
            logger.error(
              `Failed to restore widget ${serializableWidget.id}:`,
              error
            );
          }
        }

        setWidgets(restoredWidgets);

        // Store in auth mode storage as backup
        dashboardStorage.setItem("layouts", layoutData.layout);
        widgetLayoutStorage.setItem("widgets", layoutData.widgets);
      } else {
        logger.info("No saved layout found, checking local storage backup");

        // Try to load from auth mode storage as fallback
        const localLayouts =
          dashboardStorage.getItem<Layout[]>("layouts") || [];
        const localWidgets =
          widgetLayoutStorage.getItem<any[]>("widgets") || [];

        if (localLayouts.length > 0 || localWidgets.length > 0) {
          logger.info("Loaded dashboard layout from local auth mode storage");
          setLayouts(localLayouts);

          // Convert local widget data back to full widgets
          const restoredWidgets: IDashboardWidget[] = [];

          for (const serializableWidget of localWidgets) {
            try {
              const widget = widgetFactory.current.createWidget(
                serializableWidget.type,
                {
                  id: serializableWidget.id,
                  ...serializableWidget.metadata,
                  ...options.widgetCallbacks, // Include callbacks when restoring
                }
              );

              if (widget && serializableWidget.title) {
                widget.title = serializableWidget.title;
              }

              if (widget) {
                restoredWidgets.push(widget);
              }
            } catch (error) {
              logger.error(
                `Failed to restore local widget ${serializableWidget.id}:`,
                error
              );
            }
          }

          setWidgets(restoredWidgets);
        } else {
          logger.info("No saved layout found anywhere, starting fresh");
          setLayouts([]);
          setWidgets([]);
        }
      }
    } catch (error) {
      logger.error("Error loading dashboard layout:", error);
      setSaveError("Failed to load dashboard layout");

      // Fallback to auth mode storage
      const localLayouts = dashboardStorage.getItem<Layout[]>("layouts") || [];
      const localWidgets = widgetLayoutStorage.getItem<any[]>("widgets") || [];

      setLayouts(localLayouts);
      setWidgets([]); // Don't restore widgets on error to prevent issues
    } finally {
      setIsLoading(false);
      setIsLayoutInitialized(true);
    }
  }, [authToken, isMultiUserMode]);

  const updateLayout = useCallback((newLayouts: Layout[]) => {
    setLayouts(newLayouts);

    // Store in auth mode storage for backup
    dashboardStorage.setItem("layouts", newLayouts);

    logger.debug("Updated dashboard layout");
  }, []);

  const addWidget = useCallback(
    async (
      type: string,
      widgetConfig?: any,
      position?: Partial<Layout>
    ): Promise<IDashboardWidget> => {
      try {
        // Merge widgetCallbacks with the provided widgetConfig
        const configWithCallbacks = {
          ...widgetConfig,
          ...options.widgetCallbacks, // Include onFileSelect and other callbacks
        };

        const widget = widgetFactory.current.createWidget(
          type,
          configWithCallbacks
        );

        if (!widget) {
          throw new Error(`Failed to create widget of type: ${type}`);
        }

        const newWidgets = [...widgets, widget];
        setWidgets(newWidgets);

        // Add layout entry for new widget if position provided
        if (position) {
          const newLayout: Layout = {
            i: widget.id,
            x: position.x || 0,
            y: position.y || 0,
            w: position.w || 4,
            h: position.h || 3,
            ...position,
          };
          setLayouts([...layouts, newLayout]);
        }

        // Store widget in auth mode storage
        const serializableWidget = {
          id: widget.id,
          title: widget.title,
          type: widget.type,
          metadata: widget.metadata,
          constraints: widget.constraints,
        };

        const existingWidgets =
          widgetLayoutStorage.getItem<any[]>("widgets") || [];
        widgetLayoutStorage.setItem("widgets", [
          ...existingWidgets,
          serializableWidget,
        ]);

        // Clean up widget state from auth mode storage
        const stateKey = `widget-state-${widget.id}`;
        dashboardStorage.removeItem(stateKey);

        const popoutKey = `widget-popout-${widget.id}`;
        dashboardStorage.removeItem(popoutKey);

        logger.info(`Added widget: ${widget.title} (${widget.type})`);
        return widget;
      } catch (error) {
        logger.error("Error adding widget:", error);
        throw error;
      }
    },
    [widgets, layouts, options.widgetCallbacks]
  );

  const removeWidget = useCallback(
    (widgetId: string) => {
      const newWidgets = widgets.filter((w) => w.id !== widgetId);
      setWidgets(newWidgets);

      // Update auth mode storage
      const serializableWidgets = newWidgets.map((w) => ({
        id: w.id,
        title: w.title,
        type: w.type,
        metadata: w.metadata,
        constraints: w.constraints,
      }));
      widgetLayoutStorage.setItem("widgets", serializableWidgets);

      // Remove widget-specific data from auth mode storage
      const stateKey = `widget-state-${widgetId}`;
      dashboardStorage.removeItem(stateKey);

      const popoutKey = `widget-popout-${widgetId}`;
      dashboardStorage.removeItem(popoutKey);

      const newLayouts = layouts.filter((layout) => layout.i !== widgetId);
      setLayouts(newLayouts);
      dashboardStorage.setItem("layouts", newLayouts);

      logger.info(`Removed widget: ${widgetId}`);
    },
    [widgets, layouts]
  );

  const updateWidget = useCallback(
    (widgetId: string, updates: Partial<IDashboardWidget>) => {
      const newWidgets = widgets.map((widget) =>
        widget.id === widgetId ? { ...widget, ...updates } : widget
      );
      setWidgets(newWidgets);

      // Update auth mode storage
      const serializableWidgets = newWidgets.map((w) => ({
        id: w.id,
        title: w.title,
        type: w.type,
        metadata: w.metadata,
        constraints: w.constraints,
      }));
      widgetLayoutStorage.setItem("widgets", serializableWidgets);

      logger.debug(`Updated widget: ${widgetId}`);
    },
    [widgets]
  );

  const saveLayout = useCallback(async (): Promise<boolean> => {
    // In local mode, just save to local storage
    if (!isMultiUserMode) {
      dashboardStorage.setItem("layouts", layouts);
      const serializableWidgets = widgets.map((w) => ({
        id: w.id,
        title: w.title,
        type: w.type,
        metadata: w.metadata,
        constraints: w.constraints,
      }));
      widgetLayoutStorage.setItem("widgets", serializableWidgets);

      setSaveStatus("success");
      logger.info("Dashboard layout saved to local storage");
      setTimeout(() => setSaveStatus("idle"), 2000);
      return true;
    }

    // Multi-user mode - save to server
    if (!authToken) {
      setSaveError("Cannot save layout: no authentication token");
      return false;
    }

    if (layouts.length === 0 && widgets.length === 0) {
      logger.info("No layout to save (empty dashboard)");
      return true;
    }

    setIsSaving(true);
    setSaveStatus("saving");
    setSaveError(null);

    try {
      await persistenceService.current.saveLayout(layouts, widgets);

      // Also save to auth mode storage as backup
      dashboardStorage.setItem("layouts", layouts);
      const serializableWidgets = widgets.map((w) => ({
        id: w.id,
        title: w.title,
        type: w.type,
        metadata: w.metadata,
        constraints: w.constraints,
      }));
      widgetLayoutStorage.setItem("widgets", serializableWidgets);

      setSaveStatus("success");
      logger.info("Dashboard layout saved successfully");

      // Reset to idle after showing success
      setTimeout(() => setSaveStatus("idle"), 2000);

      return true;
    } catch (error) {
      logger.error("Error saving dashboard layout:", error);
      setSaveError("Failed to save dashboard layout");
      setSaveStatus("error");

      // Reset to idle after showing error
      setTimeout(() => setSaveStatus("idle"), 3000);

      return false;
    } finally {
      setIsSaving(false);
    }
  }, [authToken, layouts, widgets, isMultiUserMode]);

  const clearLayout = useCallback(async (): Promise<boolean> => {
    // In local mode, just clear local storage
    if (!isMultiUserMode) {
      dashboardStorage.clear();
      widgetLayoutStorage.clear();
      setLayouts([]);
      setWidgets([]);
      logger.info("Dashboard layout cleared from local storage");
      return true;
    }

    // Multi-user mode - clear from server
    if (!authToken) {
      setSaveError("Cannot clear layout: no authentication token");
      return false;
    }

    setIsLoading(true);
    setSaveError(null);

    try {
      await persistenceService.current.clearLayout();

      // Clear auth mode storage as well
      dashboardStorage.clear();
      widgetLayoutStorage.clear();

      setLayouts([]);
      setWidgets([]);

      logger.info("Dashboard layout cleared successfully");
      return true;
    } catch (error) {
      logger.error("Error clearing dashboard layout:", error);
      setSaveError("Failed to clear dashboard layout");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [authToken, isMultiUserMode]);

  const onBreakpointChange = useCallback(
    (breakpoint: string, cols: number) => {
      logger.debug(`Breakpoint changed to ${breakpoint} with ${cols} columns`);
      if (config.onBreakpointChange) {
        config.onBreakpointChange(breakpoint, cols);
      }
    },
    [config]
  );

  // Auto-save functionality with debouncing
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (config.autoSave && (layouts.length > 0 || widgets.length > 0)) {
      // Clear previous timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout for auto-save
      saveTimeoutRef.current = setTimeout(() => {
        logger.debug("Auto-saving dashboard layout");
        saveLayout();
      }, config.autoSaveDelay || 2000);
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [layouts, widgets, saveLayout, config.autoSave, config.autoSaveDelay]);

  return {
    layouts,
    layout: layouts, // Provide both for compatibility
    widgets,
    config,
    isLoading,
    isSaving,
    saveStatus,
    isLayoutInitialized,
    saveError,
    addWidget,
    removeWidget,
    updateWidget,
    updateLayout,
    saveLayout,
    clearLayout,
    loadLayout,
    onBreakpointChange,
  };
}
