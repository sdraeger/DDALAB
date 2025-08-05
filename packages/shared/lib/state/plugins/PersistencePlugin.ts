import type { StatePlugin, StateStore, StateChangeEvent } from '../core/interfaces';

/**
 * Plugin for advanced persistence features
 */
export class PersistencePlugin implements StatePlugin {
  readonly name = 'persistence';

  private store: StateStore | null = null;
  private autoSaveInterval?: NodeJS.Timeout;
  private saveDelay: number;
  private pendingSave = false;

  constructor(
    options: {
      autoSaveInterval?: number; // milliseconds
      saveDelay?: number; // debounce delay
    } = {}
  ) {
    this.saveDelay = options.saveDelay ?? 1000;
    
    if (options.autoSaveInterval && options.autoSaveInterval > 0) {
      this.autoSaveInterval = setInterval(() => {
        this.forceSave();
      }, options.autoSaveInterval);
    }
  }

  install(store: StateStore): void {
    this.store = store;

    // Listen to all state changes and trigger saves
    store.onStateChange((event) => {
      this.debouncedSave();
    });

    // Save on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.forceSave();
      });

      // Save on visibility change (when tab becomes hidden)
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.forceSave();
        }
      });
    }
  }

  uninstall(store: StateStore): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    this.store = null;
  }

  private debouncedSave(): void {
    if (this.pendingSave) return;

    this.pendingSave = true;
    
    setTimeout(() => {
      this.forceSave();
      this.pendingSave = false;
    }, this.saveDelay);
  }

  private async forceSave(): Promise<void> {
    if (!this.store) return;

    try {
      await this.store.dehydrate();
    } catch (error) {
      console.error('[PersistencePlugin] Save failed:', error);
    }
  }
}

/**
 * Plugin for cross-tab synchronization
 */
export class CrossTabSyncPlugin implements StatePlugin {
  readonly name = 'cross-tab-sync';

  private store: StateStore | null = null;
  private channel: BroadcastChannel | null = null;
  private channelName: string;

  constructor(channelName: string = 'ddalab-state-sync') {
    this.channelName = channelName;
  }

  install(store: StateStore): void {
    this.store = store;

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel(this.channelName);

      // Listen for state changes from other tabs
      this.channel.onmessage = (event) => {
        this.handleRemoteStateChange(event.data);
      };

      // Broadcast state changes to other tabs
      store.onStateChange((event) => {
        this.broadcastStateChange(event);
      });
    }
  }

  uninstall(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.store = null;
  }

  private broadcastStateChange(event: StateChangeEvent): void {
    if (!this.channel) return;

    try {
      this.channel.postMessage({
        type: 'state-change',
        event: {
          key: event.key,
          newValue: event.newValue,
          timestamp: event.timestamp,
          source: 'cross-tab'
        }
      });
    } catch (error) {
      console.error('[CrossTabSyncPlugin] Broadcast failed:', error);
    }
  }

  private async handleRemoteStateChange(data: any): Promise<void> {
    if (!this.store || data.type !== 'state-change') return;

    try {
      const slice = this.store.getSlice(data.event.key);
      if (slice) {
        // Only update if the remote change is newer
        const currentValue = slice.getValue();
        if (this.shouldUpdateFromRemote(currentValue, data.event)) {
          await slice.setValue(data.event.newValue);
        }
      }
    } catch (error) {
      console.error('[CrossTabSyncPlugin] Remote update failed:', error);
    }
  }

  private shouldUpdateFromRemote(currentValue: any, remoteEvent: any): boolean {
    // Simple strategy: always accept remote changes
    // In a more sophisticated implementation, you might compare timestamps
    // or use conflict resolution strategies
    return true;
  }
}

/**
 * Plugin for state history and undo/redo functionality
 */
export class HistoryPlugin implements StatePlugin {
  readonly name = 'history';

  private store: StateStore | null = null;
  private history: Map<string, any[]> = new Map();
  private maxHistorySize: number;

  constructor(maxHistorySize: number = 50) {
    this.maxHistorySize = maxHistorySize;
  }

  install(store: StateStore): void {
    this.store = store;

    // Track state changes for history
    store.onStateChange((event) => {
      this.addToHistory(event.key, event.oldValue);
    });
  }

  uninstall(): void {
    this.history.clear();
    this.store = null;
  }

  private addToHistory(key: string, value: any): void {
    if (!this.history.has(key)) {
      this.history.set(key, []);
    }

    const keyHistory = this.history.get(key)!;
    keyHistory.push(value);

    // Limit history size
    if (keyHistory.length > this.maxHistorySize) {
      keyHistory.shift();
    }
  }

  /**
   * Undo the last change for a specific key
   */
  async undo(key: string): Promise<boolean> {
    if (!this.store) return false;

    const keyHistory = this.history.get(key);
    if (!keyHistory || keyHistory.length === 0) return false;

    const previousValue = keyHistory.pop();
    const slice = this.store.getSlice(key);
    
    if (slice) {
      try {
        await slice.setValue(previousValue);
        return true;
      } catch (error) {
        console.error(`[HistoryPlugin] Undo failed for "${key}":`, error);
      }
    }

    return false;
  }

  /**
   * Get history for a specific key
   */
  getHistory(key: string): any[] {
    return this.history.get(key) ?? [];
  }

  /**
   * Clear history for a specific key
   */
  clearHistory(key: string): void {
    this.history.delete(key);
  }

  /**
   * Clear all history
   */
  clearAllHistory(): void {
    this.history.clear();
  }

  /**
   * Get available undo operations
   */
  getUndoableKeys(): string[] {
    return Array.from(this.history.entries())
      .filter(([, history]) => history.length > 0)
      .map(([key]) => key);
  }
}