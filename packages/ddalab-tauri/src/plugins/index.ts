/**
 * Plugin Extension API
 *
 * This module provides the public API for plugins to extend DDALAB
 * with custom panels and window types.
 *
 * Example usage:
 *
 * ```typescript
 * import { pluginAPI } from "@/plugins";
 *
 * // Register a custom panel
 * pluginAPI.registerPanel({
 *   id: "my-plugin:custom-view",
 *   title: "My Custom View",
 *   icon: MyIcon,
 *   category: "plugin",
 *   namespace: "my-plugin",
 *   defaultSize: { width: 800, height: 600 },
 *   popoutUrl: "/popout/plugin/my-custom-view",
 * });
 *
 * // Create a window
 * const { windowId } = await pluginAPI.createWindow("my-plugin:custom-view", {
 *   data: { someData: true },
 * });
 *
 * // Cleanup on plugin unload
 * pluginAPI.unregisterNamespace("my-plugin");
 * ```
 */

import {
  panelRegistry,
  type PanelDefinition,
  type PanelContext,
  type PanelLifecycle,
  type PanelRegistryEvent,
} from "@/utils/panelRegistry";
import {
  useWindowStore,
  type WindowInstance,
  type WindowGroup,
} from "@/store/windowStore";
import { panelService, type CreateWindowOptions } from "@/services/panelService";

// ============================================================================
// Plugin Panel Registration
// ============================================================================

export interface PluginPanelDefinition<TData = unknown>
  extends Omit<PanelDefinition<TData>, "category"> {
  /** Namespace is required for plugin panels */
  namespace: string;
}

/**
 * Register a plugin panel
 * Automatically sets category to "plugin"
 */
function registerPluginPanel<TData = unknown>(
  definition: PluginPanelDefinition<TData>,
): void {
  panelRegistry.register({
    ...definition,
    category: "plugin",
  });
}

/**
 * Unregister a specific panel
 */
function unregisterPanel(panelId: string): boolean {
  return panelRegistry.unregister(panelId);
}

/**
 * Unregister all panels from a namespace (plugin unload)
 */
function unregisterNamespace(namespace: string): string[] {
  return panelRegistry.unregisterNamespace(namespace);
}

/**
 * Get panels registered by a specific namespace
 */
function getNamespacePanels(namespace: string): PanelDefinition<unknown>[] {
  return panelRegistry.getByNamespace(namespace);
}

// ============================================================================
// Window Management
// ============================================================================

/**
 * Create a window for a panel
 */
async function createWindow(
  panelId: string,
  options?: CreateWindowOptions,
): Promise<{ windowId: string; tauriLabel: string }> {
  return panelService.createWindow(panelId, options);
}

/**
 * Close a window
 */
async function closeWindow(windowId: string): Promise<void> {
  return panelService.closeWindow(windowId);
}

/**
 * Close all windows of a panel type
 */
async function closePanelWindows(panelId: string): Promise<void> {
  return panelService.closePanelWindows(panelId);
}

/**
 * Send data to a window
 */
async function sendData(windowId: string, data: unknown): Promise<void> {
  return panelService.sendData(windowId, data);
}

/**
 * Broadcast data to all windows of a panel type
 */
async function broadcastToPanel(panelId: string, data: unknown): Promise<void> {
  return panelService.broadcastToPanel(panelId, data);
}

/**
 * Focus a window
 */
async function focusWindow(windowId: string): Promise<void> {
  return panelService.focusWindow(windowId);
}

/**
 * Set window lock state
 */
function setWindowLock(windowId: string, locked: boolean): void {
  return panelService.setWindowLock(windowId, locked);
}

// ============================================================================
// State Queries
// ============================================================================

/**
 * Get all windows for a panel type
 */
function getWindowsByPanel(panelId: string): WindowInstance[] {
  return useWindowStore.getState().getWindowsByPanel(panelId);
}

/**
 * Get a specific window's state
 */
function getWindow(windowId: string): WindowInstance | undefined {
  return useWindowStore.getState().getWindow(windowId);
}

/**
 * Get all windows grouped by panel
 */
function getGroupedWindows(): WindowGroup[] {
  return useWindowStore.getState().getGroupedWindows();
}

/**
 * Get total window count
 */
function getTotalWindowCount(): number {
  return useWindowStore.getState().getTotalCount();
}

// ============================================================================
// Event Subscriptions
// ============================================================================

/**
 * Subscribe to panel registry changes
 */
function onPanelRegistryChange(
  listener: (event: PanelRegistryEvent) => void,
): () => void {
  return panelRegistry.subscribe(listener);
}

/**
 * Subscribe to window store changes
 * Returns unsubscribe function
 */
function onWindowStoreChange(
  selector: (state: ReturnType<typeof useWindowStore.getState>) => unknown,
  listener: (selectedState: unknown, previousSelectedState: unknown) => void,
): () => void {
  return useWindowStore.subscribe(selector, listener);
}

// ============================================================================
// Plugin API Export
// ============================================================================

export const pluginAPI = {
  // Panel registration
  registerPanel: registerPluginPanel,
  unregisterPanel,
  unregisterNamespace,
  getNamespacePanels,

  // Window management
  createWindow,
  closeWindow,
  closePanelWindows,
  sendData,
  broadcastToPanel,
  focusWindow,
  setWindowLock,

  // State queries
  getWindow,
  getWindowsByPanel,
  getGroupedWindows,
  getTotalWindowCount,

  // Event subscriptions
  onPanelRegistryChange,
  onWindowStoreChange,
};

// Also export types for plugin developers
export type {
  PanelDefinition,
  PanelContext,
  PanelLifecycle,
  PanelRegistryEvent,
  WindowInstance,
  WindowGroup,
  CreateWindowOptions,
};
