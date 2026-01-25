/**
 * Panel Service - Orchestrates window creation with panel definitions
 *
 * This service provides a clean API for creating and managing panel windows.
 * It bridges the PanelRegistry, WindowManager, and WindowStore.
 */

import { panelRegistry, type PanelContext } from "@/utils/panelRegistry";
import { useWindowStore, type WindowInstance } from "@/store/windowStore";

// ============================================================================
// Types
// ============================================================================

export interface CreateWindowOptions {
  /** Initial data to pass to the window */
  data?: unknown;
  /** Saved position for window restoration */
  position?: { x: number; y: number; width: number; height: number };
  /** Custom window ID suffix */
  instanceId?: string;
}

export interface CreateWindowResult {
  windowId: string;
  tauriLabel: string;
}

// ============================================================================
// Panel Service
// ============================================================================

class PanelServiceImpl {
  private windowManager: any = null;
  private initialized = false;

  /**
   * Initialize the service with the WindowManager
   * Called once during app startup
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Dynamic import to avoid circular dependencies
    const { windowManager } = await import("@/utils/windowManager");
    this.windowManager = windowManager;
    this.initialized = true;
  }

  /**
   * Create a new panel window
   */
  async createWindow(
    panelId: string,
    options: CreateWindowOptions = {},
  ): Promise<CreateWindowResult> {
    await this.initialize();

    const panel = panelRegistry.get(panelId);
    if (!panel) {
      throw new Error(`Unknown panel type: ${panelId}`);
    }

    const store = useWindowStore.getState();
    if (store.isAppClosing) {
      throw new Error("Cannot create window while app is closing");
    }

    // Generate instance ID
    const instanceId = options.instanceId || `${Date.now()}`;

    // Get initial data from panel definition or options
    let data = options.data;
    if (!data && panel.getInitialData) {
      data = panel.getInitialData({} as PanelContext);
    }

    // Create the window through WindowManager
    const windowId = await this.windowManager.createPopoutWindow(
      panelId,
      instanceId,
      data,
      options.position,
    );

    // Get the Tauri label from WindowManager
    const windowState = this.windowManager.getWindowState(windowId);
    const tauriLabel = windowState?.tauriLabel || windowId;

    // Add to WindowStore
    const windowInstance: WindowInstance = {
      id: windowId,
      panelId,
      tauriLabel,
      isLocked: false,
      data,
      position: options.position,
      createdAt: Date.now(),
      lastUpdate: Date.now(),
    };

    store.addWindow(windowInstance);

    // Invoke lifecycle hook
    if (panel.lifecycle?.onMount) {
      try {
        await panel.lifecycle.onMount(windowId, data);
      } catch (error) {
        console.error(`[PanelService] onMount hook failed for ${panelId}:`, error);
      }
    }

    return { windowId, tauriLabel };
  }

  /**
   * Close a panel window
   */
  async closeWindow(windowId: string): Promise<void> {
    await this.initialize();

    const store = useWindowStore.getState();
    const window = store.getWindow(windowId);

    if (window) {
      const panel = panelRegistry.get(window.panelId);

      // Invoke lifecycle hook before closing
      if (panel?.lifecycle?.onUnmount) {
        try {
          await panel.lifecycle.onUnmount(windowId);
        } catch (error) {
          console.error(
            `[PanelService] onUnmount hook failed for ${window.panelId}:`,
            error,
          );
        }
      }

      // Remove from store
      store.removeWindow(windowId);
    }

    // Close through WindowManager
    await this.windowManager.closePopoutWindow(windowId);
  }

  /**
   * Send data to a window
   */
  async sendData(windowId: string, data: unknown): Promise<void> {
    await this.initialize();

    const store = useWindowStore.getState();
    const window = store.getWindow(windowId);

    if (!window) return;

    // Check if locked
    if (window.isLocked) return;

    // Validate data if validator exists
    const panel = panelRegistry.get(window.panelId);
    if (panel?.lifecycle?.validateData && !panel.lifecycle.validateData(data)) {
      console.warn(
        `[PanelService] Data validation failed for ${window.panelId}`,
      );
      return;
    }

    // Update store
    store.updateData(windowId, data);

    // Send through WindowManager
    await this.windowManager.sendDataToWindow(windowId, data);

    // Invoke lifecycle hook
    if (panel?.lifecycle?.onDataChange) {
      try {
        await panel.lifecycle.onDataChange(windowId, data);
      } catch (error) {
        console.error(
          `[PanelService] onDataChange hook failed for ${window.panelId}:`,
          error,
        );
      }
    }
  }

  /**
   * Broadcast data to all windows of a panel type
   */
  async broadcastToPanel(panelId: string, data: unknown): Promise<void> {
    await this.initialize();

    const store = useWindowStore.getState();
    const windows = store.getWindowsByPanel(panelId);

    const promises = windows
      .filter((w) => !w.isLocked)
      .map((w) => this.sendData(w.id, data));

    await Promise.all(promises);
  }

  /**
   * Focus a window
   */
  async focusWindow(windowId: string): Promise<void> {
    await this.initialize();
    await this.windowManager.focusWindow(windowId);
  }

  /**
   * Set window lock state
   */
  setWindowLock(windowId: string, locked: boolean): void {
    const store = useWindowStore.getState();
    store.setLocked(windowId, locked);
    this.windowManager?.setWindowLock(windowId, locked);
  }

  /**
   * Toggle window lock
   */
  toggleWindowLock(windowId: string): void {
    const store = useWindowStore.getState();
    const window = store.getWindow(windowId);
    if (window) {
      this.setWindowLock(windowId, !window.isLocked);
    }
  }

  /**
   * Close all windows
   */
  async closeAllWindows(): Promise<void> {
    await this.initialize();

    const store = useWindowStore.getState();
    const windowIds = store.getAllWindowIds();

    for (const windowId of windowIds) {
      await this.closeWindow(windowId);
    }
  }

  /**
   * Close all windows of a specific panel type
   */
  async closePanelWindows(panelId: string): Promise<void> {
    await this.initialize();

    const store = useWindowStore.getState();
    const windows = store.getWindowsByPanel(panelId);

    for (const window of windows) {
      await this.closeWindow(window.id);
    }
  }

  /**
   * Get window state for persistence
   */
  getWindowsForPersistence(): Array<{
    id: string;
    panelId: string;
    isLocked: boolean;
    data: unknown;
    position?: { x: number; y: number; width: number; height: number };
  }> {
    const store = useWindowStore.getState();
    const windows: Array<{
      id: string;
      panelId: string;
      isLocked: boolean;
      data: unknown;
      position?: { x: number; y: number; width: number; height: number };
    }> = [];

    for (const window of store.windows.values()) {
      const panel = panelRegistry.get(window.panelId);
      let data = window.data;

      // Serialize state if serializer exists
      if (panel?.serializeState && data) {
        data = panel.serializeState(data);
      }

      windows.push({
        id: window.id,
        panelId: window.panelId,
        isLocked: window.isLocked,
        data,
        position: window.position,
      });
    }

    return windows;
  }

  /**
   * Restore windows from persisted state
   */
  async restoreWindows(
    windows: Array<{
      id: string;
      panelId: string;
      isLocked: boolean;
      data: unknown;
      position?: { x: number; y: number; width: number; height: number };
    }>,
  ): Promise<void> {
    const store = useWindowStore.getState();
    if (store.isAppClosing) return;

    for (const saved of windows) {
      const panel = panelRegistry.get(saved.panelId);
      if (!panel) continue;

      let data = saved.data;

      // Deserialize state if deserializer exists
      if (panel.deserializeState && data) {
        try {
          data = panel.deserializeState(data);
        } catch (error) {
          console.warn(
            `[PanelService] Failed to deserialize state for ${saved.panelId}`,
          );
        }
      }

      try {
        await this.createWindow(saved.panelId, {
          data,
          position: saved.position,
        });
      } catch (error) {
        console.error(`[PanelService] Failed to restore window ${saved.id}:`, error);
      }
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const panelService = new PanelServiceImpl();
