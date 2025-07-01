import { useState, useEffect, useCallback, useRef } from "react";

// Generic widget state interface
export interface WidgetState {
  [key: string]: any;
}

// State synchronization events
export interface StateSync {
  type: "STATE_UPDATE";
  widgetId: string;
  state: WidgetState;
  timestamp: number;
}

// Hook for managing widget state with sync capabilities
export function useWidgetState<T extends WidgetState>(
  widgetId: string,
  initialState: T,
  isPopout: boolean = false
) {
  const [state, setState] = useState<T>(initialState);
  const isInitializedRef = useRef(false);
  const lastSyncTimestampRef = useRef(0);

  // Storage keys
  const stateStorageKey = `widget-state-${widgetId}`;
  const syncChannelKey = `widget-sync-${widgetId}`;

  // Load persisted state on mount
  useEffect(() => {
    if (!isInitializedRef.current) {
      const storedState = localStorage.getItem(stateStorageKey);
      if (storedState) {
        try {
          const parsedState = JSON.parse(storedState);
          setState((prevState) => ({ ...prevState, ...parsedState }));
        } catch (error) {
          console.warn("Failed to parse stored widget state:", error);
        }
      }
      isInitializedRef.current = true;
    }
  }, [stateStorageKey]);

  // Listen for state updates from other instances (main/popout)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === stateStorageKey && e.newValue) {
        try {
          const newState = JSON.parse(e.newValue);
          setState((prevState) => ({ ...prevState, ...newState }));
        } catch (error) {
          console.warn("Failed to sync state from storage:", error);
        }
      }
    };

    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;

      if (e.data.type === "STATE_UPDATE" && e.data.widgetId === widgetId) {
        // Avoid circular updates by checking timestamp
        if (e.data.timestamp > lastSyncTimestampRef.current) {
          setState((prevState) => ({ ...prevState, ...e.data.state }));
          lastSyncTimestampRef.current = e.data.timestamp;
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("message", handleMessage);
    };
  }, [stateStorageKey, widgetId]);

  // Update state and sync to other instances
  const updateState = useCallback(
    (updates: Partial<T> | ((prev: T) => T)) => {
      setState((prevState) => {
        const newState =
          typeof updates === "function"
            ? updates(prevState)
            : { ...prevState, ...updates };

        // Persist to localStorage for cross-tab sync
        localStorage.setItem(stateStorageKey, JSON.stringify(newState));

        // Send message to other windows/tabs
        const syncMessage: StateSync = {
          type: "STATE_UPDATE",
          widgetId,
          state: newState,
          timestamp: Date.now(),
        };

        // Notify main window if we're in a popout
        if (isPopout && window.opener && !window.opener.closed) {
          window.opener.postMessage(syncMessage, window.location.origin);
        }

        // Notify popout windows if we're in main window
        if (!isPopout) {
          // Try to find and notify any open popout windows
          try {
            // Use a broadcast channel for better cross-window communication
            const channel = new BroadcastChannel(syncChannelKey);
            channel.postMessage(syncMessage);
            channel.close();
          } catch (error) {
            // Fallback: BroadcastChannel not supported
            console.warn(
              "BroadcastChannel not supported, using storage events"
            );
          }
        }

        return newState;
      });
    },
    [stateStorageKey, widgetId, isPopout, syncChannelKey]
  );

  // Clean up storage when widget is removed
  const cleanupState = useCallback(() => {
    localStorage.removeItem(stateStorageKey);
  }, [stateStorageKey]);

  return {
    state,
    updateState,
    cleanupState,
  };
}
