import { useState, useCallback, useEffect, useRef } from "react";
import {
  Widget,
  SerializableWidget,
} from "../components/dashboard/DashboardGrid";
import { createWidgetContent } from "../lib/utils/widgetFactory";
import {
  WidgetLayoutCacheManager,
  WidgetLayoutData,
} from "../lib/utils/cache/widgetLayoutCache";
import { useToast } from "../components/ui/use-toast";
import { get, post, _delete } from "../lib/utils/request";
import { useUnifiedSessionData } from "./useUnifiedSession";

// Hook configuration
interface UsePersistentDashboardOptions {
  autoSaveDelay?: number; // Auto-save delay in milliseconds
  enableAutoSave?: boolean; // Enable automatic saving
  enableCache?: boolean; // Enable caching
}

const DEFAULT_OPTIONS: UsePersistentDashboardOptions = {
  autoSaveDelay: 2000, // 2 seconds
  enableAutoSave: true,
  enableCache: true,
};

export function usePersistentDashboard(
  initialWidgets: Widget[] = [],
  options: UsePersistentDashboardOptions = {}
) {
  const { data: session } = useUnifiedSessionData();
  const { toast } = useToast();
  const config = { ...DEFAULT_OPTIONS, ...options };

  const [widgets, setWidgets] = useState<Widget[]>(initialWidgets);
  const [poppedOutWindows, setPoppedOutWindows] = useState<Map<string, Window>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLayoutLoaded, setIsLayoutLoaded] = useState(false);

  // Cache manager instance
  const cacheManager = config.enableCache
    ? WidgetLayoutCacheManager.getInstance()
    : null;

  // Auto-save timer ref
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedLayoutRef = useRef<string>("");

  /**
   * Convert Widget to WidgetLayoutData for persistence
   */
  const serializeWidgetsForPersistence = useCallback(
    (widgets: Widget[]): WidgetLayoutData[] => {
      return widgets.map((widget) => {
        const { content, ...serializableData } = widget;
        return serializableData as WidgetLayoutData;
      });
    },
    []
  );

  /**
   * Convert WidgetLayoutData to Widget for rendering
   */
  const deserializeWidgetsFromPersistence = useCallback(
    (layoutData: WidgetLayoutData[]): Widget[] => {
      return layoutData.map((data) => ({
        ...data,
        content: createWidgetContent(data.type, data.id, false),
      }));
    },
    []
  );

  /**
   * Save layout to database
   */
  const saveLayoutToDatabase = useCallback(
    async (widgets: Widget[]) => {
      if (!session?.accessToken) {
        return;
      }

      try {
        setIsSaving(true);
        const widgetData = serializeWidgetsForPersistence(widgets);

        const response = await post("/api/widget-layouts", {
          widgets: widgetData,
        });

        if (!response.ok) {
          // Try to get the error details from response
          let errorDetails = response.statusText;
          try {
            const errorData = await response.json();
            errorDetails = JSON.stringify(errorData, null, 2);
          } catch {
            // If response is not JSON, use statusText
          }
          throw new Error(`Failed to save layout: ${errorDetails}`);
        }

        const result = await response.json();

        // Update cache
        if (cacheManager && session.user?.id) {
          cacheManager.cacheLayout(session.user.id, widgetData);
        }

        // Update last saved reference
        lastSavedLayoutRef.current = JSON.stringify(widgetData);

        toast({
          title: "Layout Saved",
          description: "Your widget layout has been saved successfully.",
          duration: 2000,
        });

        return result;
      } catch (error) {
        toast({
          title: "Save Failed",
          description: "Failed to save widget layout. Please try again.",
          variant: "destructive",
          duration: 4000,
        });
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [session, serializeWidgetsForPersistence, cacheManager, toast]
  );

  /**
   * Load layout from database or cache
   */
  const loadLayoutFromDatabase = useCallback(async (): Promise<Widget[]> => {
    if (!session?.accessToken) {
      return initialWidgets;
    }

    try {
      setIsLoading(true);

      // Try cache first
      if (cacheManager && session.user?.id) {
        const cachedLayout = cacheManager.getCachedLayout(session.user.id);
        if (cachedLayout) {
          return deserializeWidgetsFromPersistence(cachedLayout);
        }
      }

      // Fetch from database
      const response = await get("/api/widget-layouts");

      if (!response.ok) {
        if (response.status === 404) {
          // No saved layout found, use initial widgets
          return initialWidgets;
        }
        throw new Error(`Failed to load layout: ${response.statusText}`);
      }

      const result = await response.json();
      const loadedWidgets = deserializeWidgetsFromPersistence(
        result.widgets || []
      );

      // Cache the loaded layout
      if (cacheManager && session.user?.id) {
        cacheManager.cacheLayout(session.user.id, result.widgets || []);
      }

      // Update last saved reference
      lastSavedLayoutRef.current = JSON.stringify(result.widgets || []);

      return loadedWidgets.length > 0 ? loadedWidgets : initialWidgets;
    } catch (error) {
      toast({
        title: "Load Failed",
        description: "Failed to load saved layout. Using default layout.",
        variant: "destructive",
        duration: 4000,
      });
      return initialWidgets;
    } finally {
      setIsLoading(false);
    }
  }, [
    session,
    cacheManager,
    deserializeWidgetsFromPersistence,
    initialWidgets,
    toast,
  ]);

  /**
   * Auto-save functionality
   */
  const scheduleAutoSave = useCallback(
    (widgets: Widget[]) => {
      if (!config.enableAutoSave || !session?.accessToken) return;

      // Clear existing timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      // Check if layout has actually changed
      const currentLayoutString = JSON.stringify(
        serializeWidgetsForPersistence(widgets)
      );
      if (currentLayoutString === lastSavedLayoutRef.current) {
        return; // No changes to save
      }

      // Schedule save
      autoSaveTimerRef.current = setTimeout(() => {
        saveLayoutToDatabase(widgets);
      }, config.autoSaveDelay);
    },
    [
      config.enableAutoSave,
      config.autoSaveDelay,
      session,
      saveLayoutToDatabase,
      serializeWidgetsForPersistence,
    ]
  );

  /**
   * Load layout on session/mount
   */
  useEffect(() => {
    if (session?.accessToken && !isLayoutLoaded) {
      loadLayoutFromDatabase().then((loadedWidgets) => {
        setWidgets(loadedWidgets);
        setIsLayoutLoaded(true);
      });
    } else if (session === null && !isLayoutLoaded) {
      // No session (user not logged in), mark as loaded to prevent loading state
      setIsLayoutLoaded(true);
    }
  }, [session?.accessToken, session, loadLayoutFromDatabase, isLayoutLoaded]);

  /**
   * Widget management functions
   */
  const updateWidget = useCallback(
    (id: string, updates: Partial<Widget>) => {
      setWidgets((prev) => {
        const updated = prev.map((widget) =>
          widget.id === id ? { ...widget, ...updates } : widget
        );

        // Schedule auto-save
        scheduleAutoSave(updated);

        return updated;
      });

      // Handle popped-out window updates
      const widget = widgets.find((w) => w.id === id);
      if (widget?.isPopOut) {
        const updatedWidget = { ...widget, ...updates };
        const { content, ...serializableWidget } = updatedWidget;
        localStorage.setItem(
          `popped-widget-${id}`,
          JSON.stringify(serializableWidget)
        );
      }
    },
    [widgets, scheduleAutoSave]
  );

  const addWidget = useCallback(
    (widget: Widget) => {
      setWidgets((prev) => {
        const updated = [...prev, widget];
        scheduleAutoSave(updated);
        return updated;
      });
    },
    [scheduleAutoSave]
  );

  const removeWidget = useCallback(
    (id: string) => {
      setWidgets((prev) => {
        const updated = prev.filter((widget) => widget.id !== id);
        scheduleAutoSave(updated);
        return updated;
      });

      // Close popped-out window if it exists
      const window = poppedOutWindows.get(id);
      if (window && !window.closed) {
        window.close();
      }
      setPoppedOutWindows((prev) => {
        const newMap = new Map(prev);
        newMap.delete(id);
        return newMap;
      });

      // Clean up localStorage
      localStorage.removeItem(`popped-widget-${id}`);
    },
    [poppedOutWindows, scheduleAutoSave]
  );

  const resetWidgets = useCallback(() => {
    // Close all popped-out windows
    poppedOutWindows.forEach((window, id) => {
      if (!window.closed) {
        window.close();
      }
      localStorage.removeItem(`popped-widget-${id}`);
    });
    setPoppedOutWindows(new Map());

    setWidgets([]);
    scheduleAutoSave([]);
  }, [poppedOutWindows, scheduleAutoSave]);

  const swapInWidget = useCallback(
    (id: string) => {
      updateWidget(id, { isPopOut: false });

      const window = poppedOutWindows.get(id);
      if (window && !window.closed) {
        window.close();
      }

      setPoppedOutWindows((prev) => {
        const newMap = new Map(prev);
        newMap.delete(id);
        return newMap;
      });
      localStorage.removeItem(`popped-widget-${id}`);
    },
    [updateWidget, poppedOutWindows]
  );

  const popOutWidget = useCallback(
    (id: string) => {
      const widget = widgets.find((w) => w.id === id);
      if (!widget) return;

      const { content, ...serializableWidget } = widget;
      const widgetData: SerializableWidget = {
        ...serializableWidget,
        isPopOut: true,
      };
      localStorage.setItem(`popped-widget-${id}`, JSON.stringify(widgetData));

      const newWindow = window.open(
        `/widget/${id}`,
        `widget-${id}`,
        `width=${widget.size.width + 100},height=${
          widget.size.height + 200
        },scrollbars=yes,resizable=yes,menubar=no,toolbar=no,location=no,status=no`
      );

      if (newWindow) {
        setPoppedOutWindows((prev) => new Map(prev).set(id, newWindow));

        // Register with popout auth manager
        import("../services/PopoutAuthManager").then(
          ({ getPopoutAuthManager }) => {
            const authManager = getPopoutAuthManager();
            if (authManager) {
              authManager.registerPopoutWindow(id, newWindow);
            }
          }
        );

        updateWidget(id, { isPopOut: true });

        const checkClosed = setInterval(() => {
          if (newWindow.closed) {
            clearInterval(checkClosed);

            // Unregister from auth manager
            import("../services/PopoutAuthManager").then(
              ({ getPopoutAuthManager }) => {
                const authManager = getPopoutAuthManager();
                if (authManager) {
                  authManager.unregisterPopoutWindow(id);
                }
              }
            );

            swapInWidget(id);
          }
        }, 1000);
      }
    },
    [widgets, updateWidget, swapInWidget]
  );

  /**
   * Manual save function
   */
  const saveLayout = useCallback(async () => {
    return saveLayoutToDatabase(widgets);
  }, [saveLayoutToDatabase, widgets]);

  /**
   * Manual load function
   */
  const loadLayout = useCallback(async () => {
    const loadedWidgets = await loadLayoutFromDatabase();
    setWidgets(loadedWidgets);
    return loadedWidgets;
  }, [loadLayoutFromDatabase]);

  /**
   * Delete layout from database
   */
  const deleteLayoutFromDatabase = useCallback(async (): Promise<void> => {
    if (!session?.accessToken) {
      return;
    }

    try {
      setIsSaving(true);

      const response = await _delete("/api/widget-layouts");

      if (!response.ok) {
        throw new Error(`Failed to delete layout: ${response.statusText}`);
      }

      // Clear cache
      if (cacheManager) {
        cacheManager.clearCache();
      }

      // Reset to initial widgets
      setWidgets(initialWidgets);
      lastSavedLayoutRef.current = "";

      toast({
        title: "Layout Deleted",
        description: "Your saved layout has been deleted.",
        duration: 2000,
      });
    } catch (error) {
      toast({
        title: "Delete Failed",
        description: "Failed to delete widget layout. Please try again.",
        variant: "destructive",
        duration: 4000,
      });
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [session, cacheManager, initialWidgets, toast]);

  // Listen for messages from popped-out windows
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (event.data.type === "SWAP_IN_WIDGET") {
        swapInWidget(event.data.widgetId);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [swapInWidget]);

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  return {
    widgets,
    updateWidget,
    addWidget,
    removeWidget,
    resetWidgets,
    setWidgets,
    popOutWidget,
    swapInWidget,
    // Persistence functions
    saveLayout,
    loadLayout,
    deleteLayoutFromDatabase,
    // State indicators
    isLoading,
    isSaving,
    isLayoutLoaded,
  };
}
