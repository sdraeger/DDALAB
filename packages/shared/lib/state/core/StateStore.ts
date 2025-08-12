import {
  StateStore as IStateStore,
  StateSlice,
  StateSliceConfig,
  StateListener,
  StateValue,
  StorageAdapter,
  StateMiddleware,
  StatePlugin,
  StateChangeEvent,
} from "./interfaces";
import { StateSlice as StateSliceImpl } from "./StateSlice";

/**
 * Central state store implementation
 * Manages all state slices with middleware, plugins, and global operations
 */
export class StateStore implements IStateStore {
  private slices: Map<string, StateSliceImpl<any>> = new Map();
  private globalListeners: Set<StateListener> = new Set();
  private middlewares: StateMiddleware[] = [];
  private plugins: StatePlugin[] = [];
  private storageAdapter: StorageAdapter;
  private isHydrated = false;
  private syncInterval?: NodeJS.Timeout;

  // Debugging and monitoring
  private totalEvents = 0;
  private lastUpdate = 0;
  private debugEnabled: boolean;

  constructor(
    storageAdapter: StorageAdapter,
    options: {
      debugEnabled?: boolean;
      syncInterval?: number;
    } = {}
  ) {
    this.storageAdapter = storageAdapter;
    this.debugEnabled = options.debugEnabled ?? false;

    // Set up periodic sync if specified
    if (options.syncInterval && options.syncInterval > 0) {
      this.syncInterval = setInterval(() => {
        this.syncWithStorage();
      }, options.syncInterval);
    }

    // Set up cleanup on page unload
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        this.cleanup();
      });
    }
  }

  registerSlice<T extends StateValue = StateValue>(
    config: StateSliceConfig<T>
  ): StateSlice<T> {
    if (this.slices.has(config.key)) {
      throw new Error(`State slice with key "${config.key}" already exists`);
    }

    const slice = new StateSliceImpl<T>(config, this.storageAdapter);
    this.slices.set(config.key, slice);

    // Subscribe to slice changes for global notifications and middleware
    slice.subscribe((event) => {
      this.handleSliceChange(event as StateChangeEvent<StateValue>);
    });

    if (this.debugEnabled) {
      console.log(`[StateStore] Registered slice "${config.key}"`);
    }

    return slice;
  }

  unregisterSlice(key: string): void {
    const slice = this.slices.get(key);
    if (slice) {
      // Clean up the slice
      if ("dispose" in slice && typeof slice.dispose === "function") {
        slice.dispose();
      }

      this.slices.delete(key);

      if (this.debugEnabled) {
        console.log(`[StateStore] Unregistered slice "${key}"`);
      }
    }
  }

  getSlice<T extends StateValue = StateValue>(
    key: string
  ): StateSlice<T> | undefined {
    return this.slices.get(key) as StateSlice<T> | undefined;
  }

  getAllSlices(): StateSlice[] {
    return Array.from(this.slices.values());
  }

  async hydrate(): Promise<void> {
    if (this.isHydrated) {
      console.warn("[StateStore] Already hydrated");
      return;
    }

    try {
      const keys = await this.storageAdapter.getAllKeys();

      if (this.debugEnabled) {
        console.log(`[StateStore] Hydrating from ${keys.length} stored keys`);
      }

      // Storage initialization is handled internally by each slice
      // No need to manually call private methods

      this.isHydrated = true;

      if (this.debugEnabled) {
        console.log("[StateStore] Hydration complete");
      }
    } catch (error) {
      console.error("[StateStore] Hydration failed:", error);
      throw error;
    }
  }

  async dehydrate(): Promise<void> {
    try {
      const promises = Array.from(this.slices.entries()).map(
        async ([key, slice]) => {
          if (slice.config.persistent) {
            try {
              let value = slice.getValue();

              // Apply transformer if available
              if (slice.config.transformer) {
                value = slice.config.transformer.serialize(value);
              }

              await this.storageAdapter.set(key, value);
            } catch (error) {
              console.error(
                `[StateStore] Error dehydrating slice "${key}":`,
                error
              );
            }
          }
        }
      );

      await Promise.all(promises);

      if (this.debugEnabled) {
        console.log("[StateStore] Dehydration complete");
      }
    } catch (error) {
      console.error("[StateStore] Dehydration failed:", error);
      throw error;
    }
  }

  async reset(): Promise<void> {
    try {
      // Reset all slices
      const resetPromises = Array.from(this.slices.values()).map((slice) =>
        slice.reset()
      );
      await Promise.all(resetPromises);

      // Clear storage
      await this.storageAdapter.clear();

      // Reset internal state
      this.totalEvents = 0;
      this.lastUpdate = 0;

      if (this.debugEnabled) {
        console.log("[StateStore] Reset complete");
      }
    } catch (error) {
      console.error("[StateStore] Reset failed:", error);
      throw error;
    }
  }

  onStateChange(listener: StateListener): () => void {
    this.globalListeners.add(listener);

    return () => {
      this.globalListeners.delete(listener);
    };
  }

  getDebugInfo() {
    return {
      slices: Array.from(this.slices.keys()),
      totalEvents: this.totalEvents,
      lastUpdate: this.lastUpdate,
      isHydrated: this.isHydrated,
      middlewareCount: this.middlewares.length,
      pluginCount: this.plugins.length,
      globalListenerCount: this.globalListeners.size,
    };
  }

  /**
   * Add middleware to intercept state changes
   */
  addMiddleware(middleware: StateMiddleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Remove middleware
   */
  removeMiddleware(middleware: StateMiddleware): void {
    const index = this.middlewares.indexOf(middleware);
    if (index > -1) {
      this.middlewares.splice(index, 1);
    }
  }

  /**
   * Install a plugin
   */
  installPlugin(plugin: StatePlugin): void {
    if (this.plugins.find((p) => p.name === plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already installed`);
    }

    this.plugins.push(plugin);
    plugin.install(this as IStateStore);

    if (this.debugEnabled) {
      console.log(`[StateStore] Installed plugin "${plugin.name}"`);
    }
  }

  /**
   * Uninstall a plugin
   */
  uninstallPlugin(pluginName: string): void {
    const plugin = this.plugins.find((p) => p.name === pluginName);
    if (plugin) {
      if (plugin.uninstall) {
        plugin.uninstall(this as IStateStore);
      }

      this.plugins = this.plugins.filter((p) => p.name !== pluginName);

      if (this.debugEnabled) {
        console.log(`[StateStore] Uninstalled plugin "${pluginName}"`);
      }
    }
  }

  private async handleSliceChange(
    event: StateChangeEvent<StateValue>
  ): Promise<void> {
    this.totalEvents++;
    this.lastUpdate = event.timestamp;

    try {
      // Run beforeChange middleware
      for (const middleware of this.middlewares) {
        const shouldContinue = await middleware.beforeChange(event);
        if (!shouldContinue) {
          if (this.debugEnabled) {
            console.log(
              `[StateStore] Change blocked by middleware for "${event.key}"`
            );
          }
          return;
        }
      }

      // Notify global listeners
      this.globalListeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          console.error("[StateStore] Error in global listener:", error);
        }
      });

      // Run afterChange middleware
      for (const middleware of this.middlewares) {
        await middleware.afterChange(event);
      }
    } catch (error) {
      console.error("[StateStore] Error handling slice change:", error);
    }
  }

  private async syncWithStorage(): Promise<void> {
    if (!this.isHydrated) return;

    try {
      // This could be enhanced to sync with remote storage or cross-tab
      await this.dehydrate();

      if (this.debugEnabled) {
        console.log("[StateStore] Sync with storage complete");
      }
    } catch (error) {
      console.error("[StateStore] Sync with storage failed:", error);
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Dehydrate before cleanup
    this.dehydrate().catch((error) => {
      console.error("[StateStore] Error during cleanup dehydration:", error);
    });

    // Clean up slices
    this.slices.forEach((slice) => {
      if ("dispose" in slice && typeof slice.dispose === "function") {
        slice.dispose();
      }
    });

    this.slices.clear();
    this.globalListeners.clear();
  }

  /**
   * Get detailed information about all slices for debugging
   */
  getSlicesMetadata() {
    const metadata: Record<string, any> = {};

    this.slices.forEach((slice, key) => {
      if ("getMetadata" in slice && typeof slice.getMetadata === "function") {
        metadata[key] = slice.getMetadata();
      } else {
        metadata[key] = {
          key,
          value: slice.getValue(),
          config: slice.config,
        };
      }
    });

    return metadata;
  }

  /**
   * Export all state for backup/debugging
   */
  exportState(): Record<string, StateValue> {
    const state: Record<string, StateValue> = {};

    this.slices.forEach((slice, key) => {
      state[key] = slice.getValue();
    });

    return state;
  }

  /**
   * Import state (useful for testing or migration)
   */
  async importState(state: Record<string, StateValue>): Promise<void> {
    const promises = Object.entries(state).map(async ([key, value]) => {
      const slice = this.slices.get(key);
      if (slice) {
        try {
          await slice.setValue(value);
        } catch (error) {
          console.error(
            `[StateStore] Error importing state for "${key}":`,
            error
          );
        }
      }
    });

    await Promise.all(promises);

    if (this.debugEnabled) {
      console.log(
        `[StateStore] Imported state for ${Object.keys(state).length} slices`
      );
    }
  }
}
