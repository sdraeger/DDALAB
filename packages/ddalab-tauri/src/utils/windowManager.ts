import { emit, listen, UnlistenFn } from "@tauri-apps/api/event";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export type WindowType = "timeseries" | "dda-results" | "eeg-visualization";

// Event types for window state changes
export type WindowStateChangeType = "created" | "closed" | "updated";
export interface WindowStateChangeEvent {
  type: WindowStateChangeType;
  windowId: string;
  allWindows: string[];
}

type WindowStateChangeListener = (event: WindowStateChangeEvent) => void;

export interface WindowConfig {
  label: string;
  title: string;
  url: string;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  decorations?: boolean;
  alwaysOnTop?: boolean;
}

export interface WindowPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PopoutWindowState {
  id: string;
  type: WindowType;
  isLocked: boolean;
  data: any;
  lastUpdate: number;
  position?: WindowPosition;
  tauriLabel?: string;
}

/** Serializable state for persistence */
export interface PersistedPopoutWindow {
  id: string;
  type: WindowType;
  isLocked: boolean;
  data: any;
  position: WindowPosition;
}

class WindowManager {
  private windows: Map<string, WebviewWindow> = new Map();
  private windowStates: Map<string, PopoutWindowState> = new Map();
  private listeners: Map<string, UnlistenFn> = new Map();
  private stateChangeListeners: Set<WindowStateChangeListener> = new Set();
  private positionUpdateInterval: ReturnType<typeof setInterval> | null = null;
  private isAppClosing: boolean = false;
  private popoutClosingListener: UnlistenFn | null = null;
  /** Version counter incremented on cleanup - used to detect stale saves */
  private cleanupVersion: number = 0;

  /**
   * Initialize event listeners for popout window management
   * Should be called once from the main window
   */
  async initializeListeners(): Promise<void> {
    if (this.popoutClosingListener) return;

    console.log("[WindowManager] Initializing popout-closing listener");
    this.popoutClosingListener = await listen(
      "popout-closing",
      (event: any) => {
        console.log("[WindowManager] Received popout-closing event:", event);
        const { windowId } = event.payload;
        if (windowId) {
          console.log("[WindowManager] Cleaning up window:", windowId);
          this.forceCleanup(windowId);
          console.log(
            "[WindowManager] After cleanup, windowStates size:",
            this.windowStates.size,
          );
        }
      },
    );
  }

  /**
   * Force cleanup of a window (used when popout notifies it's closing)
   * Also triggers a state save to ensure the cleanup is persisted
   */
  forceCleanup(windowId: string): void {
    // Increment cleanup version FIRST to invalidate any in-flight saves
    this.cleanupVersion++;
    console.log(
      "[WindowManager] Cleanup version incremented to:",
      this.cleanupVersion,
    );

    console.log(
      "[WindowManager] forceCleanup deleting window:",
      windowId,
      "windowStates.size before:",
      this.windowStates.size,
    );
    this.windows.delete(windowId);
    this.windowStates.delete(windowId);
    console.log(
      "[WindowManager] forceCleanup after delete, windowStates.size:",
      this.windowStates.size,
    );

    // Clean up all listeners for this window
    for (const suffix of [
      "close",
      "lock",
      "unlock",
      "ready",
      "move",
      "resize",
    ]) {
      const key = `${windowId}-${suffix}`;
      const listener = this.listeners.get(key);
      if (listener) {
        listener();
        this.listeners.delete(key);
      }
    }

    this.emitStateChange("closed", windowId);

    // Stop position tracking if no windows remain
    if (this.windowStates.size === 0) {
      this.stopPositionTracking();
    }

    // Trigger a state save to persist the cleanup
    // This uses dynamic import to avoid circular dependency
    import("@/store/appStore").then(({ useAppStore }) => {
      const saveCurrentState = useAppStore.getState().saveCurrentState;
      if (saveCurrentState) {
        console.log(
          "[WindowManager] Triggering state save after cleanup, remaining windows:",
          this.windowStates.size,
        );
        saveCurrentState().catch((err) =>
          console.error(
            "[WindowManager] Failed to save state after cleanup:",
            err,
          ),
        );
      }
    });
  }

  /**
   * Mark that the app is closing - prevents popout window cleanup
   * so that window state can be persisted before windows are destroyed
   */
  setAppClosing(closing: boolean): void {
    this.isAppClosing = closing;
  }

  /** Get current cleanup version - used to detect stale saves */
  getCleanupVersion(): number {
    return this.cleanupVersion;
  }

  // Subscribe to window state changes (event-based, no polling needed)
  onStateChange(listener: WindowStateChangeListener): () => void {
    this.stateChangeListeners.add(listener);
    return () => this.stateChangeListeners.delete(listener);
  }

  private emitStateChange(type: WindowStateChangeType, windowId: string): void {
    const event: WindowStateChangeEvent = {
      type,
      windowId,
      allWindows: this.getAllWindows(),
    };
    this.stateChangeListeners.forEach((listener) => listener(event));
  }

  private getWindowConfig(type: WindowType, id: string): WindowConfig {
    const baseConfigs: Record<WindowType, WindowConfig> = {
      timeseries: {
        label: `timeseries-${id}`,
        title: "Time Series Visualization",
        url: `/popout/timeseries?id=${id}`,
        width: 1200,
        height: 800,
        minWidth: 600,
        minHeight: 400,
        resizable: true,
        decorations: true,
        alwaysOnTop: false,
      },
      "dda-results": {
        label: `dda-results-${id}`,
        title: "DDA Analysis Results",
        url: `/popout/minimal?type=dda-results&id=${id}`,
        width: 1000,
        height: 700,
        minWidth: 600,
        minHeight: 400,
        resizable: true,
        decorations: true,
        alwaysOnTop: false,
      },
      "eeg-visualization": {
        label: `eeg-viz-${id}`,
        title: "EEG Visualization",
        url: `/popout/minimal?type=eeg-visualization&id=${id}`,
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 500,
        resizable: true,
        decorations: true,
        alwaysOnTop: false,
      },
    };

    return baseConfigs[type];
  }

  async createPopoutWindow(
    type: WindowType,
    id: string,
    data: any,
    savedPosition?: WindowPosition,
  ): Promise<string> {
    // Prevent creating windows when app is closing
    if (this.isAppClosing) {
      console.log("[WindowManager] Skipping window creation - app is closing");
      throw new Error("Cannot create window while app is closing");
    }

    const config = this.getWindowConfig(type, id);
    const windowId = `${type}-${id}-${Date.now()}`;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const updatedUrl = config.url.replace(`id=${id}`, `id=${windowId}`);

      const tauriLabel = await invoke<string>("create_popout_window", {
        windowType: type,
        windowId: id,
        title: config.title,
        url: updatedUrl,
        width: savedPosition?.width ?? config.width,
        height: savedPosition?.height ?? config.height,
        x: savedPosition?.x,
        y: savedPosition?.y,
      });

      // Get reference to the created window for tracking
      const webviewWindow = await WebviewWindow.getByLabel(tauriLabel);

      const state: PopoutWindowState = {
        id: windowId,
        type,
        isLocked: false,
        data,
        lastUpdate: Date.now(),
        position: savedPosition ?? {
          x: 0,
          y: 0,
          width: config.width,
          height: config.height,
        },
        tauriLabel,
      };
      console.log(
        "[WindowManager] Adding window to windowStates:",
        windowId,
        "windowStates.size before:",
        this.windowStates.size,
      );
      this.windowStates.set(windowId, state);
      console.log(
        "[WindowManager] After adding, windowStates.size:",
        this.windowStates.size,
      );

      // Track the window reference
      if (webviewWindow) {
        this.windows.set(windowId, webviewWindow);

        // Listen for window close event to clean up state
        const closeListener = await webviewWindow.onCloseRequested(async () => {
          // Update position one last time before closing
          await this.updateWindowPosition(windowId);
          this.cleanup(windowId);
        });
        this.listeners.set(`${windowId}-close`, closeListener);

        // Listen for window move/resize to track position in real-time
        const moveListener = await webviewWindow.onMoved(async () => {
          await this.updateWindowPosition(windowId);
        });
        this.listeners.set(`${windowId}-move`, moveListener);

        const resizeListener = await webviewWindow.onResized(async () => {
          await this.updateWindowPosition(windowId);
        });
        this.listeners.set(`${windowId}-resize`, resizeListener);
      }

      const readyListener = await listen(
        `popout-ready-${windowId}`,
        async () => {
          await this.sendDataToWindow(windowId, data);
        },
      );
      this.listeners.set(`${windowId}-ready`, readyListener);

      // Emit state change event for subscribers
      this.emitStateChange("created", windowId);

      // Start periodic position updates if not already running
      this.startPositionTracking();

      return windowId;
    } catch (error) {
      throw error;
    }
  }

  /** Start periodic position tracking for all windows */
  private startPositionTracking(): void {
    if (this.positionUpdateInterval) return;

    // Update positions every 5 seconds as a fallback
    this.positionUpdateInterval = setInterval(async () => {
      for (const windowId of this.windowStates.keys()) {
        await this.updateWindowPosition(windowId);
      }
    }, 5000);
  }

  /** Stop position tracking */
  private stopPositionTracking(): void {
    if (this.positionUpdateInterval) {
      clearInterval(this.positionUpdateInterval);
      this.positionUpdateInterval = null;
    }
  }

  /** Update the stored position of a window */
  async updateWindowPosition(windowId: string): Promise<void> {
    const state = this.windowStates.get(windowId);
    if (!state?.tauriLabel) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [x, y, width, height] = await invoke<
        [number, number, number, number]
      >("get_window_position", { windowLabel: state.tauriLabel });

      // CRITICAL: Check if window still exists before updating
      // It may have been deleted during the async invoke call
      if (this.windowStates.has(windowId)) {
        state.position = { x, y, width, height };
        this.windowStates.set(windowId, state);
      }
    } catch {
      // Position fetch failed silently
    }
  }

  /** Get all open windows for persistence */
  async getWindowsForPersistence(): Promise<PersistedPopoutWindow[]> {
    // CRITICAL: Take a snapshot of window IDs at the start
    // This prevents issues with concurrent modifications during async operations
    const windowIds = Array.from(this.windowStates.keys());
    const snapshotSize = windowIds.length;

    console.log(
      "[WindowManager] getWindowsForPersistence called, snapshot size:",
      snapshotSize,
      "keys:",
      windowIds,
    );

    const windows: PersistedPopoutWindow[] = [];

    for (const windowId of windowIds) {
      // Check if window still exists (may have been deleted during iteration)
      const state = this.windowStates.get(windowId);
      if (!state) {
        console.log(
          "[WindowManager] Window deleted during iteration:",
          windowId,
        );
        continue;
      }

      // Try to update position, but use cached position if fetch fails
      try {
        await this.updateWindowPosition(windowId);
      } catch {
        // Position fetch may fail if window is closing - use cached position
      }

      // Re-check if window still exists after async operation
      const updatedState = this.windowStates.get(windowId);
      if (updatedState?.position) {
        windows.push({
          id: windowId,
          type: updatedState.type,
          isLocked: updatedState.isLocked,
          data: updatedState.data,
          position: updatedState.position,
        });
      }
    }

    console.log(
      "[WindowManager] getWindowsForPersistence returning:",
      windows.length,
      "windows",
    );
    return windows;
  }

  /** Restore windows from persisted state */
  async restoreWindows(windows: PersistedPopoutWindow[]): Promise<void> {
    // Don't restore windows if app is closing
    if (this.isAppClosing) {
      console.log(
        "[WindowManager] Skipping window restoration - app is closing",
      );
      return;
    }

    for (const saved of windows) {
      // Check again before each window creation
      if (this.isAppClosing) {
        console.log(
          "[WindowManager] Stopping window restoration - app is closing",
        );
        break;
      }

      try {
        // Extract the original id from the saved window id
        // Format is: type-id-timestamp
        const parts = saved.id.split("-");
        const originalId =
          parts.slice(1, -1).join("-") || parts[1] || "restored";

        await this.createPopoutWindow(
          saved.type,
          originalId,
          saved.data,
          saved.position,
        );
      } catch (error) {
        console.error(`[WindowManager] Failed to restore window:`, error);
      }
    }
  }

  async closePopoutWindow(windowId: string): Promise<void> {
    const window = this.windows.get(windowId);
    if (window) {
      try {
        await window.close();
        this.cleanup(windowId);
      } catch {
        // Window close failed silently
      }
    }
  }

  private cleanup(windowId: string): void {
    // Skip cleanup if app is closing - we need to preserve window state for persistence
    if (this.isAppClosing) {
      return;
    }

    this.windows.delete(windowId);
    this.windowStates.delete(windowId);

    // Clean up all listeners for this window
    for (const suffix of [
      "close",
      "lock",
      "unlock",
      "ready",
      "move",
      "resize",
    ]) {
      const key = `${windowId}-${suffix}`;
      const listener = this.listeners.get(key);
      if (listener) {
        listener();
        this.listeners.delete(key);
      }
    }

    this.emitStateChange("closed", windowId);

    // Stop position tracking if no windows remain
    if (this.windowStates.size === 0) {
      this.stopPositionTracking();
    }
  }

  async sendDataToWindow(windowId: string, data: any): Promise<void> {
    const state = this.windowStates.get(windowId);
    if (!state || state.isLocked) {
      return;
    }

    try {
      await emit(`data-update-${windowId}`, {
        windowId,
        data,
        timestamp: Date.now(),
      });

      state.data = data;
      state.lastUpdate = Date.now();
      this.windowStates.set(windowId, state);
    } catch {
      // Data send failed silently
    }
  }

  setWindowLock(windowId: string, locked: boolean): void {
    const state = this.windowStates.get(windowId);
    if (state) {
      state.isLocked = locked;
      this.windowStates.set(windowId, state);
      emit(`lock-state-${windowId}`, { locked });
    }
  }

  getWindowState(windowId: string): PopoutWindowState | undefined {
    return this.windowStates.get(windowId);
  }

  getAllWindows(): string[] {
    return Array.from(this.windows.keys());
  }

  getWindowsByType(type: WindowType): string[] {
    return Array.from(this.windowStates.entries())
      .filter(([, state]) => state.type === type)
      .map(([windowId]) => windowId);
  }

  async broadcastToAllWindows(eventName: string, data: any): Promise<void> {
    for (const windowId of this.windows.keys()) {
      try {
        await emit(`${eventName}-${windowId}`, data);
      } catch {
        // Broadcast failed silently
      }
    }
  }

  async broadcastToType(type: WindowType, data: any): Promise<void> {
    const windowIds = this.getWindowsByType(type);

    const promises = windowIds.map(async (windowId) => {
      const state = this.windowStates.get(windowId);
      if (state && !state.isLocked) {
        try {
          await this.sendDataToWindow(windowId, data);
        } catch {
          // Broadcast to window failed silently
        }
      }
    });

    Promise.all(promises).catch(() => {});
  }

  /**
   * Broadcast empty state to all popout windows (called when all tabs are closed)
   * This sends a special payload with isEmpty: true to trigger empty state in popouts
   */
  async broadcastEmptyState(): Promise<void> {
    const emptyPayload = { isEmpty: true, timestamp: Date.now() };

    const promises = Array.from(this.windowStates.keys()).map(
      async (windowId) => {
        const state = this.windowStates.get(windowId);
        // Send even to locked windows - they should know there's no file
        if (state) {
          try {
            await emit(`data-update-${windowId}`, {
              windowId,
              data: emptyPayload,
              timestamp: Date.now(),
            });
            state.data = emptyPayload;
            state.lastUpdate = Date.now();
            this.windowStates.set(windowId, state);
          } catch {
            // Broadcast failed silently
          }
        }
      },
    );

    Promise.all(promises).catch(() => {});
  }

  isWindowOpen(windowId: string): boolean {
    return this.windows.has(windowId);
  }

  async focusWindow(windowId: string): Promise<void> {
    const window = this.windows.get(windowId);
    if (window) {
      try {
        await window.setFocus();
      } catch {
        // Focus failed silently
      }
    }
  }
}

export const windowManager = new WindowManager();
export default windowManager;
