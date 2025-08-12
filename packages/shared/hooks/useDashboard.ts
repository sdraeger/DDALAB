import { useState, useCallback, useEffect } from "react";
import {
  Widget,
  SerializableWidget,
} from "../components/dashboard/DashboardGrid";

export function useDashboard(initialWidgets: Widget[] = []) {
  const [widgets, setWidgets] = useState<Widget[]>(initialWidgets);
  const [poppedOutWindows, setPoppedOutWindows] = useState<Map<string, Window>>(
    new Map()
  );

  const updateWidget = useCallback(
    (id: string, updates: Partial<Widget>) => {
      setWidgets((prev) =>
        prev.map((widget) =>
          widget.id === id ? { ...widget, ...updates } : widget
        )
      );

      // If widget is popped out, update localStorage for the popped-out window
      const widget = widgets.find((w) => w.id === id);
      if (widget?.isPopOut) {
        const updatedWidget = { ...widget, ...updates };
        // Serialize only metadata, excluding the content property
        const { content, ...serializableWidget } = updatedWidget;
        localStorage.setItem(
          `popped-widget-${id}`,
          JSON.stringify(serializableWidget)
        );
      }
    },
    [widgets]
  );

  const addWidget = useCallback((widget: Widget) => {
    setWidgets((prev) => [...prev, widget]);
  }, []);

  const removeWidget = useCallback(
    (id: string) => {
      setWidgets((prev) => prev.filter((widget) => widget.id !== id));

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
    [poppedOutWindows]
  );

  const swapInWidget = useCallback(
    (id: string) => {
      // Update widget state to mark as not popped out
      updateWidget(id, { isPopOut: false });

      // Close the popped-out window if it exists
      const window = poppedOutWindows.get(id);
      if (window && !window.closed) {
        window.close();
      }

      // Clean up
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

      // Store widget data in localStorage for the new window (excluding content)
      const { content, ...serializableWidget } = widget;
      const widgetData: SerializableWidget = {
        ...serializableWidget,
        isPopOut: true,
      };
      localStorage.setItem(`popped-widget-${id}`, JSON.stringify(widgetData));

      // Open new window
      const newWindow = window.open(
        `/widget/${id}`,
        `widget-${id}`,
        `width=${widget.size.width + 100},height=${
          widget.size.height + 200
        },scrollbars=yes,resizable=yes,menubar=no,toolbar=no,location=no,status=no`
      );

      if (newWindow) {
        // Track the window
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

        // Update widget state to mark as popped out
        updateWidget(id, { isPopOut: true });

        // Listen for window close
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

            // Swap widget back in when window is closed
            swapInWidget(id);
          }
        }, 1000);
      }
    },
    [widgets, updateWidget, swapInWidget]
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
  }, [poppedOutWindows]);

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

  return {
    widgets,
    updateWidget,
    addWidget,
    removeWidget,
    resetWidgets,
    setWidgets,
    popOutWidget,
    swapInWidget,
  };
}
