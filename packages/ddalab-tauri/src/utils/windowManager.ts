import { emit, listen, UnlistenFn } from "@tauri-apps/api/event";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getPanel } from "./panelRegistry";

// Legacy type alias for backward compatibility during migration
export type WindowType = string;

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

  /** Initialize event listeners - call once from main window */
  async initializeListeners(): Promise<void> {
    if (this.popoutClosingListener) return;

    this.popoutClosingListener = await listen(
      "popout-closing",
      (event: any) => {
        const { windowId } = event.payload;
        if (windowId) {
          this.forceCleanup(windowId);
        }
      },
    );
  }

  /** Force cleanup of a window and trigger state save */
  forceCleanup(windowId: string): void {
    this.cleanupVersion++;
    this.windows.delete(windowId);
    this.windowStates.delete(windowId);

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

    if (this.windowStates.size === 0) {
      this.stopPositionTracking();
    }

    // Trigger state save (dynamic import to avoid circular dependency)
    import("@/store/appStore").then(({ useAppStore }) => {
      useAppStore.getState().saveCurrentState?.();
    });
  }

  setAppClosing(closing: boolean): void {
    this.isAppClosing = closing;
  }

  getCleanupVersion(): number {
    return this.cleanupVersion;
  }

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

  private getWindowConfig(panelId: string, instanceId: string): WindowConfig {
    const panel = getPanel(panelId);
    if (!panel) {
      throw new Error(`Unknown panel type: ${panelId}`);
    }

    return {
      label: `${panelId}-${instanceId}`,
      title: panel.title,
      url: `${panel.popoutUrl}?id=${instanceId}`,
      width: panel.defaultSize.width,
      height: panel.defaultSize.height,
      minWidth: panel.minSize?.width,
      minHeight: panel.minSize?.height,
      resizable: true,
      decorations: true,
      alwaysOnTop: false,
    };
  }

  async createPopoutWindow(
    type: WindowType,
    id: string,
    data: any,
    savedPosition?: WindowPosition,
  ): Promise<string> {
    if (this.isAppClosing) {
      throw new Error("Cannot create window while app is closing");
    }

    const config = this.getWindowConfig(type, id);
    const windowId = `${type}-${id}-${Date.now()}`;

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
    this.windowStates.set(windowId, state);

    if (webviewWindow) {
      this.windows.set(windowId, webviewWindow);

      const closeListener = await webviewWindow.onCloseRequested(async () => {
        await this.updateWindowPosition(windowId);
        this.cleanup(windowId);
      });
      this.listeners.set(`${windowId}-close`, closeListener);

      const moveListener = await webviewWindow.onMoved(async () => {
        await this.updateWindowPosition(windowId);
      });
      this.listeners.set(`${windowId}-move`, moveListener);

      const resizeListener = await webviewWindow.onResized(async () => {
        await this.updateWindowPosition(windowId);
      });
      this.listeners.set(`${windowId}-resize`, resizeListener);
    }

    const readyListener = await listen(`popout-ready-${windowId}`, async () => {
      await this.sendDataToWindow(windowId, data);
    });
    this.listeners.set(`${windowId}-ready`, readyListener);

    this.emitStateChange("created", windowId);
    this.startPositionTracking();

    return windowId;
  }

  private startPositionTracking(): void {
    if (this.positionUpdateInterval) return;
    this.positionUpdateInterval = setInterval(async () => {
      for (const windowId of this.windowStates.keys()) {
        await this.updateWindowPosition(windowId);
      }
    }, 5000);
  }

  private stopPositionTracking(): void {
    if (this.positionUpdateInterval) {
      clearInterval(this.positionUpdateInterval);
      this.positionUpdateInterval = null;
    }
  }

  private async updateWindowPosition(windowId: string): Promise<void> {
    const state = this.windowStates.get(windowId);
    if (!state?.tauriLabel) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [x, y, width, height] = await invoke<
        [number, number, number, number]
      >("get_window_position", { windowLabel: state.tauriLabel });
      // Check window still exists after async call
      if (this.windowStates.has(windowId)) {
        state.position = { x, y, width, height };
        this.windowStates.set(windowId, state);
      }
    } catch {
      // Position fetch may fail if window is closing
    }
  }

  async getWindowsForPersistence(): Promise<PersistedPopoutWindow[]> {
    // Snapshot window IDs to prevent concurrent modification issues
    const windowIds = Array.from(this.windowStates.keys());
    const windows: PersistedPopoutWindow[] = [];

    for (const windowId of windowIds) {
      const state = this.windowStates.get(windowId);
      if (!state) continue;

      try {
        await this.updateWindowPosition(windowId);
      } catch {
        // Use cached position if fetch fails
      }

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

  async restoreWindows(windows: PersistedPopoutWindow[]): Promise<void> {
    if (this.isAppClosing) return;

    for (const saved of windows) {
      if (this.isAppClosing) break;

      try {
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
        // Window restoration failed
      }
    }
  }

  async closePopoutWindow(windowId: string): Promise<void> {
    const window = this.windows.get(windowId);
    if (!window) return;

    try {
      await window.close();
      this.cleanup(windowId);
    } catch {
      // Window may already be closed
    }
  }

  private cleanup(windowId: string): void {
    if (this.isAppClosing) return;

    this.windows.delete(windowId);
    this.windowStates.delete(windowId);

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

    if (this.windowStates.size === 0) {
      this.stopPositionTracking();
    }
  }

  async sendDataToWindow(windowId: string, data: any): Promise<void> {
    const state = this.windowStates.get(windowId);
    if (!state || state.isLocked) return;

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
      // Window may have been closed
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
      } catch {}
    }
  }

  async broadcastToType(type: WindowType, data: any): Promise<void> {
    const promises = this.getWindowsByType(type).map(async (windowId) => {
      const state = this.windowStates.get(windowId);
      if (state && !state.isLocked) {
        await this.sendDataToWindow(windowId, data);
      }
    });
    await Promise.all(promises).catch(() => {});
  }

  async broadcastEmptyState(): Promise<void> {
    const emptyPayload = { isEmpty: true, timestamp: Date.now() };

    const promises = Array.from(this.windowStates.keys()).map(
      async (windowId) => {
        const state = this.windowStates.get(windowId);
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
          } catch {}
        }
      },
    );
    await Promise.all(promises).catch(() => {});
  }

  isWindowOpen(windowId: string): boolean {
    return this.windows.has(windowId);
  }

  async focusWindow(windowId: string): Promise<void> {
    try {
      await this.windows.get(windowId)?.setFocus();
    } catch {}
  }

  getWindowsByPanel(): Map<string, PopoutWindowState[]> {
    const grouped = new Map<string, PopoutWindowState[]>();
    for (const [, state] of this.windowStates) {
      const existing = grouped.get(state.type) || [];
      existing.push(state);
      grouped.set(state.type, existing);
    }
    return grouped;
  }

  getWindowSummary(): { panelId: string; count: number; title: string }[] {
    const grouped = this.getWindowsByPanel();
    const summary: { panelId: string; count: number; title: string }[] = [];

    for (const [panelId, windows] of grouped) {
      const panel = getPanel(panelId);
      summary.push({
        panelId,
        count: windows.length,
        title: panel?.title || panelId,
      });
    }

    return summary;
  }

  getTotalWindowCount(): number {
    return this.windowStates.size;
  }
}

export const windowManager = new WindowManager();
export default windowManager;
