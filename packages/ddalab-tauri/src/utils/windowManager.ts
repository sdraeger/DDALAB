import { emit, listen, UnlistenFn } from "@tauri-apps/api/event";

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
  private windows: Map<string, any> = new Map();
  private windowStates: Map<string, PopoutWindowState> = new Map();
  private listeners: Map<string, UnlistenFn> = new Map();
  private stateChangeListeners: Set<WindowStateChangeListener> = new Set();

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
    const config = this.getWindowConfig(type, id);
    const windowId = `${type}-${id}-${Date.now()}`;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
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
      this.windowStates.set(windowId, state);

      const readyListener = await listen(
        `popout-ready-${windowId}`,
        async () => {
          await this.sendDataToWindow(windowId, data);
        },
      );
      this.listeners.set(`${windowId}-ready`, readyListener);

      // Emit state change event for subscribers
      this.emitStateChange("created", windowId);

      return windowId;
    } catch (error) {
      throw error;
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
      state.position = { x, y, width, height };
      this.windowStates.set(windowId, state);
    } catch {
      // Position fetch failed silently
    }
  }

  /** Get all open windows for persistence */
  async getWindowsForPersistence(): Promise<PersistedPopoutWindow[]> {
    const windows: PersistedPopoutWindow[] = [];

    for (const [windowId, state] of this.windowStates.entries()) {
      // Update position before saving
      await this.updateWindowPosition(windowId);

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

    return windows;
  }

  /** Restore windows from persisted state */
  async restoreWindows(windows: PersistedPopoutWindow[]): Promise<void> {
    for (const saved of windows) {
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
      } catch {
        // Window restoration failed silently
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
    this.windows.delete(windowId);
    this.windowStates.delete(windowId);

    for (const suffix of ["close", "lock", "unlock", "ready"]) {
      const key = `${windowId}-${suffix}`;
      const listener = this.listeners.get(key);
      if (listener) {
        listener();
        this.listeners.delete(key);
      }
    }

    this.emitStateChange("closed", windowId);
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
