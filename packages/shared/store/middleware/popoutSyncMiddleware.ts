import {
  Middleware,
  MiddlewareAPI,
  Dispatch,
  AnyAction,
  UnknownAction,
} from "@reduxjs/toolkit";
import { RootState } from "../rootReducer";
import logger from "../../lib/utils/logger";

// Types for pop-out synchronization
export interface PopoutSyncConfig {
  isPopoutWindow: boolean;
  parentWindowOrigin?: string;
  syncedSlices: string[];
  excludedActions: string[];
  validationRules?: Record<string, (state: any) => boolean>;
}

export interface PopoutSyncMessage {
  type: "REDUX_STATE_SYNC";
  action: any;
  timestamp: number;
  sourceWindow: "main" | "popout";
  sliceUpdates?: Partial<RootState>;
}

// Default configuration for pop-out synchronization
const DEFAULT_SYNC_CONFIG: Partial<PopoutSyncConfig> = {
  syncedSlices: ["plots", "auth", "loading"],
  excludedActions: [
    "persist/PERSIST",
    "persist/REHYDRATE",
    "persist/REGISTER",
    "persist/PURGE",
    "persist/FLUSH",
    "persist/PAUSE",
    "persist/RESUME",
    // Exclude actions that should only happen in main window
    "plots/initialize/pending",
    "plots/loadChunk/pending",
  ],
  validationRules: {
    auth: (state) => {
      return state && typeof state.isAuthenticated === "boolean";
    },
    plots: (state) => {
      return (
        state &&
        typeof state.byFilePath === "object" &&
        state.byFilePath !== null
      );
    },
  },
};

class PopoutSyncManager {
  private config: PopoutSyncConfig;
  private messageHandlers: Map<string, (message: PopoutSyncMessage) => void> =
    new Map();
  private lastSyncTimestamp: number = 0;
  private syncThrottleMs: number = 16; // ~60fps throttling

  constructor(config: PopoutSyncConfig) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
    this.setupMessageHandling();
  }

  private setupMessageHandling(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("message", this.handleMessage.bind(this));
    }
  }

  private handleMessage(event: MessageEvent): void {
    // Validate message origin for security
    if (
      this.config.parentWindowOrigin &&
      event.origin !== this.config.parentWindowOrigin
    ) {
      return;
    }

    if (event.data?.type === "REDUX_STATE_SYNC") {
      const message = event.data as PopoutSyncMessage;
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message);
      }
    }
  }

  public registerMessageHandler(
    type: string,
    handler: (message: PopoutSyncMessage) => void
  ): void {
    this.messageHandlers.set(type, handler);
  }

  public shouldSyncAction(action: any): boolean {
    // Don't sync excluded actions
    if (this.config.excludedActions.includes(action.type)) {
      return false;
    }

    // Only sync actions from configured slices
    const actionSlice = action.type.split("/")[0];
    return this.config.syncedSlices.includes(actionSlice);
  }

  public validateStateSlice(sliceName: string, state: any): boolean {
    const validator = this.config.validationRules?.[sliceName];
    if (validator) {
      try {
        return validator(state);
      } catch (error) {
        logger.error(
          `[PopoutSync] State validation failed for ${sliceName}:`,
          error
        );
        return false;
      }
    }
    return true;
  }

  public sendSyncMessage(action: any, sliceUpdates?: Partial<RootState>): void {
    const now = Date.now();

    // Throttle sync messages to avoid overwhelming the message channel
    if (now - this.lastSyncTimestamp < this.syncThrottleMs) {
      return;
    }

    const message: PopoutSyncMessage = {
      type: "REDUX_STATE_SYNC",
      action,
      timestamp: now,
      sourceWindow: this.config.isPopoutWindow ? "popout" : "main",
      sliceUpdates,
    };

    try {
      if (this.config.isPopoutWindow && window.opener) {
        // Send from popout to main window
        window.opener.postMessage(
          message,
          this.config.parentWindowOrigin || "*"
        );
      } else if (!this.config.isPopoutWindow) {
        // Send from main window to all popout windows
        this.broadcastToPopoutWindows(message);
      }

      this.lastSyncTimestamp = now;
    } catch (error) {
      logger.error("[PopoutSync] Failed to send sync message:", error);
    }
  }

  private broadcastToPopoutWindows(message: PopoutSyncMessage): void {
    // Get registered popout windows from global registry
    const popoutWindows = (window as any).__POPOUT_WINDOWS__ || new Map();

    popoutWindows.forEach((windowRef: Window, widgetId: string) => {
      try {
        if (windowRef && !windowRef.closed) {
          windowRef.postMessage(message, "*");
        } else {
          // Clean up closed windows
          popoutWindows.delete(widgetId);
        }
      } catch (error) {
        logger.warn(
          `[PopoutSync] Failed to send message to popout window ${widgetId}:`,
          error
        );
      }
    });
  }

  public extractSliceUpdates(
    state: RootState,
    action: any
  ): Partial<RootState> {
    const updates: Partial<RootState> = {};
    const actionSlice = action.type.split("/")[0];

    // Only include the slice that was updated
    if (this.config.syncedSlices.includes(actionSlice)) {
      (updates as any)[actionSlice] = (state as any)[actionSlice];
    }

    return updates;
  }
}

// Create the middleware factory
export const createPopoutSyncMiddleware = (config: PopoutSyncConfig) => {
  const syncManager = new PopoutSyncManager(config);

  return (store: any) => {
    // Register handler for incoming sync messages
    syncManager.registerMessageHandler(
      "REDUX_STATE_SYNC",
      (message: PopoutSyncMessage) => {
        // Avoid infinite loops by not processing messages from the same window type
        const isFromSameType =
          (message.sourceWindow === "main" && !config.isPopoutWindow) ||
          (message.sourceWindow === "popout" && config.isPopoutWindow);

        if (isFromSameType) {
          return;
        }

        // Apply selective state updates
        if (message.sliceUpdates) {
          Object.entries(message.sliceUpdates).forEach(
            ([sliceName, sliceState]) => {
              if (syncManager.validateStateSlice(sliceName, sliceState)) {
                // Create a synthetic action to update the slice
                const syncAction = {
                  type: `${sliceName}/syncFromRemote`,
                  payload: sliceState,
                  meta: { fromPopoutSync: true },
                };

                store.dispatch(syncAction);
              } else {
                logger.warn(
                  `[PopoutSync] Invalid state received for slice ${sliceName}`
                );
              }
            }
          );
        }
      }
    );

    return (next: any) => (action: any) => {
      // Skip sync actions to avoid loops
      if ((action as any).meta?.fromPopoutSync) {
        return next(action);
      }

      // Execute the action first
      const result = next(action);

      // Then handle synchronization
      if (syncManager.shouldSyncAction(action)) {
        const state = store.getState();
        const sliceUpdates = syncManager.extractSliceUpdates(state, action);

        // Only sync if there are actual updates
        if (Object.keys(sliceUpdates).length > 0) {
          syncManager.sendSyncMessage(action, sliceUpdates);
        }
      }

      return result;
    };
  };
};

// Helper function to initialize popout window registry
export const initializePopoutWindowRegistry = (): void => {
  if (typeof window !== "undefined" && !(window as any).__POPOUT_WINDOWS__) {
    (window as any).__POPOUT_WINDOWS__ = new Map<string, Window>();
  }
};

// Helper function to register a popout window
export const registerPopoutWindow = (
  widgetId: string,
  windowRef: Window
): void => {
  const registry = (window as any).__POPOUT_WINDOWS__;
  if (registry) {
    registry.set(widgetId, windowRef);
    logger.info(
      `[PopoutSync] Registered popout window for widget: ${widgetId}`
    );
  }
};

// Helper function to unregister a popout window
export const unregisterPopoutWindow = (widgetId: string): void => {
  const registry = (window as any).__POPOUT_WINDOWS__;
  if (registry) {
    registry.delete(widgetId);
    logger.info(
      `[PopoutSync] Unregistered popout window for widget: ${widgetId}`
    );
  }
};
