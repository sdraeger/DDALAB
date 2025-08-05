import { StorageAdapter, StateValue } from '../core/interfaces';

/**
 * LocalStorage adapter implementation
 * Handles browser localStorage with proper error handling and serialization
 */
export class LocalStorageAdapter implements StorageAdapter {
  private prefix: string;

  constructor(prefix: string = 'ddalab_state_') {
    this.prefix = prefix;
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private isAvailable(): boolean {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<StateValue | undefined> {
    if (!this.isAvailable()) {
      console.warn('[LocalStorageAdapter] localStorage not available');
      return undefined;
    }

    try {
      const item = localStorage.getItem(this.getKey(key));
      if (item === null) return undefined;
      
      return JSON.parse(item);
    } catch (error) {
      console.error(`[LocalStorageAdapter] Error getting key "${key}":`, error);
      return undefined;
    }
  }

  async set(key: string, value: StateValue): Promise<void> {
    if (!this.isAvailable()) {
      console.warn('[LocalStorageAdapter] localStorage not available');
      return;
    }

    try {
      localStorage.setItem(this.getKey(key), JSON.stringify(value));
    } catch (error) {
      console.error(`[LocalStorageAdapter] Error setting key "${key}":`, error);
      
      // Try to clear some space if quota exceeded
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('[LocalStorageAdapter] Quota exceeded, attempting cleanup');
        await this.cleanup();
        
        // Retry once
        try {
          localStorage.setItem(this.getKey(key), JSON.stringify(value));
        } catch (retryError) {
          console.error(`[LocalStorageAdapter] Retry failed for key "${key}":`, retryError);
          throw retryError;
        }
      } else {
        throw error;
      }
    }
  }

  async remove(key: string): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      localStorage.removeItem(this.getKey(key));
    } catch (error) {
      console.error(`[LocalStorageAdapter] Error removing key "${key}":`, error);
    }
  }

  async clear(): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      const keys = await this.getAllKeys();
      for (const key of keys) {
        localStorage.removeItem(this.getKey(key));
      }
    } catch (error) {
      console.error('[LocalStorageAdapter] Error clearing storage:', error);
    }
  }

  async getAllKeys(): Promise<string[]> {
    if (!this.isAvailable()) return [];

    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.prefix)) {
          keys.push(key.substring(this.prefix.length));
        }
      }
      return keys;
    } catch (error) {
      console.error('[LocalStorageAdapter] Error getting all keys:', error);
      return [];
    }
  }

  async has(key: string): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      return localStorage.getItem(this.getKey(key)) !== null;
    } catch (error) {
      console.error(`[LocalStorageAdapter] Error checking key "${key}":`, error);
      return false;
    }
  }

  /**
   * Cleanup old or expired entries to free up space
   */
  private async cleanup(): Promise<void> {
    try {
      const keys = await this.getAllKeys();
      
      // Remove oldest entries (simple LRU-like cleanup)
      // In a real implementation, you might want to track access times
      const keysToRemove = keys.slice(0, Math.floor(keys.length * 0.1)); // Remove 10%
      
      for (const key of keysToRemove) {
        await this.remove(key);
      }
      
      console.log(`[LocalStorageAdapter] Cleaned up ${keysToRemove.length} entries`);
    } catch (error) {
      console.error('[LocalStorageAdapter] Cleanup failed:', error);
    }
  }

  /**
   * Get storage usage information
   */
  getStorageInfo(): { used: number; total: number; available: number } {
    if (!this.isAvailable()) {
      return { used: 0, total: 0, available: 0 };
    }

    let used = 0;
    try {
      for (const key in localStorage) {
        if (localStorage.hasOwnProperty(key) && key.startsWith(this.prefix)) {
          used += localStorage[key].length + key.length;
        }
      }
    } catch (error) {
      console.error('[LocalStorageAdapter] Error calculating storage usage:', error);
    }

    // Rough estimate of localStorage limit (usually 5-10MB)
    const total = 5 * 1024 * 1024; // 5MB estimate
    const available = total - used;

    return { used, total, available };
  }
}