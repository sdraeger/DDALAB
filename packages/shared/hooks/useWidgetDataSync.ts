import { useEffect, useRef, useCallback } from "react";
import { useAppSelector } from "../store";

export interface DataSyncMessage {
  type: "DATA_UPDATE";
  widgetId: string;
  dataType: "plots" | "dda-results" | "file-selection";
  data: any;
  timestamp: number;
}

export interface DataSyncOptions {
  enabled?: boolean;
  debounceMs?: number;
}

/**
 * Hook for synchronizing external data dependencies (like Redux state)
 * between main dashboard and popped-out widgets
 */
export function useWidgetDataSync(
  widgetId: string,
  isPopout: boolean = false,
  options: DataSyncOptions = {}
) {
  const { enabled = true, debounceMs = 100 } = options;

  // Get relevant Redux state
  const plots = useAppSelector((state) => state.plots);

  // Refs for managing sync
  const lastDataRef = useRef<string>("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // Initialize broadcast channel for cross-window communication
  useEffect(() => {
    if (enabled && typeof BroadcastChannel !== "undefined") {
      const channelName = `widget-data-sync-${widgetId}`;
      broadcastChannelRef.current = new BroadcastChannel(channelName);
    }

    return () => {
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
        broadcastChannelRef.current = null;
      }
    };
  }, [widgetId, enabled]);

  // Send data updates to other instances
  const sendDataUpdate = useCallback(
    (dataType: string, data: any) => {
      if (!enabled) return;

      const message: DataSyncMessage = {
        type: "DATA_UPDATE",
        widgetId,
        dataType: dataType as any,
        data,
        timestamp: Date.now(),
      };

      // Send via BroadcastChannel if available
      if (broadcastChannelRef.current) {
        try {
          broadcastChannelRef.current.postMessage(message);
        } catch (error) {
          console.warn("Failed to send data via BroadcastChannel:", error);
        }
      }

      // Send via postMessage to child windows (if we're the main window)
      if (!isPopout) {
        // Try to notify any open popout windows
        try {
          // Store in localStorage as backup communication method
          const storageKey = `widget-data-update-${widgetId}`;
          localStorage.setItem(storageKey, JSON.stringify(message));

          // Remove after a short delay to avoid pollution
          setTimeout(() => {
            localStorage.removeItem(storageKey);
          }, 1000);
        } catch (error) {
          console.warn("Failed to send data via localStorage:", error);
        }
      }

      // If we're in a popout, send to parent window
      if (isPopout && window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(message, window.location.origin);
        } catch (error) {
          console.warn("Failed to send data to parent window:", error);
        }
      }
    },
    [widgetId, isPopout, enabled]
  );

  // Debounced data sync for plots data
  useEffect(() => {
    if (!enabled || isPopout) return; // Only main window sends updates

    const plotsData = JSON.stringify(plots);

    if (plotsData !== lastDataRef.current) {
      lastDataRef.current = plotsData;

      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Send update after debounce delay
      debounceTimerRef.current = setTimeout(() => {
        sendDataUpdate("plots", plots);
      }, debounceMs);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [plots, enabled, isPopout, debounceMs, sendDataUpdate]);

  // Listen for incoming data updates
  const dataUpdateListeners = useRef<Map<string, (data: any) => void>>(
    new Map()
  );

  const registerDataListener = useCallback(
    (dataType: string, callback: (data: any) => void) => {
      dataUpdateListeners.current.set(dataType, callback);
    },
    []
  );

  const unregisterDataListener = useCallback((dataType: string) => {
    dataUpdateListeners.current.delete(dataType);
  }, []);

  // Handle incoming messages
  useEffect(() => {
    if (!enabled) return;

    const handleBroadcastMessage = (event: MessageEvent) => {
      if (
        event.data?.type === "DATA_UPDATE" &&
        event.data?.widgetId === widgetId
      ) {
        const { dataType, data } = event.data;
        const listener = dataUpdateListeners.current.get(dataType);
        if (listener) {
          listener(data);
        }
      }
    };

    const handleWindowMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (
        event.data?.type === "DATA_UPDATE" &&
        event.data?.widgetId === widgetId
      ) {
        const { dataType, data } = event.data;
        const listener = dataUpdateListeners.current.get(dataType);
        if (listener) {
          listener(data);
        }
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      const key = `widget-data-update-${widgetId}`;
      if (event.key === key && event.newValue) {
        try {
          const message = JSON.parse(event.newValue);
          if (message.type === "DATA_UPDATE" && message.widgetId === widgetId) {
            const { dataType, data } = message;
            const listener = dataUpdateListeners.current.get(dataType);
            if (listener) {
              listener(data);
            }
          }
        } catch (error) {
          console.warn("Failed to parse storage data update:", error);
        }
      }
    };

    // Set up listeners
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.addEventListener(
        "message",
        handleBroadcastMessage
      );
    }
    window.addEventListener("message", handleWindowMessage);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.removeEventListener(
          "message",
          handleBroadcastMessage
        );
      }
      window.removeEventListener("message", handleWindowMessage);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [widgetId, enabled]);

  return {
    sendDataUpdate,
    registerDataListener,
    unregisterDataListener,
  };
}
