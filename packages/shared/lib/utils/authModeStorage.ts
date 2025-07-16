/**
 * Storage utility for managing separate state between local mode and multi-user mode
 */

export type AuthModeType = "local" | "multi-user";

interface AuthModeStorageConfig {
  prefix: string;
  authMode: AuthModeType;
}

class AuthModeStorage {
  private prefix: string;
  private authMode: AuthModeType;

  constructor(config: AuthModeStorageConfig) {
    this.prefix = config.prefix;
    this.authMode = config.authMode;
  }

  /**
   * Get the storage key with auth mode prefix
   */
  private getKey(key: string): string {
    return `${this.prefix}_${this.authMode}_${key}`;
  }

  /**
   * Set the current auth mode
   */
  setAuthMode(authMode: AuthModeType): void {
    this.authMode = authMode;
  }

  /**
   * Get the current auth mode
   */
  getAuthMode(): AuthModeType {
    return this.authMode;
  }

  /**
   * Store a value for the current auth mode
   */
  setItem(key: string, value: any): void {
    try {
      const storageKey = this.getKey(key);
      const serializedValue = JSON.stringify(value);
      localStorage.setItem(storageKey, serializedValue);
    } catch (error) {
      console.warn(
        `Failed to store ${key} for auth mode ${this.authMode}:`,
        error
      );
    }
  }

  /**
   * Get a value for the current auth mode
   */
  getItem<T = any>(key: string, defaultValue?: T): T | null {
    try {
      const storageKey = this.getKey(key);
      const item = localStorage.getItem(storageKey);

      if (item === null) {
        return defaultValue ?? null;
      }

      return JSON.parse(item);
    } catch (error) {
      console.warn(
        `Failed to retrieve ${key} for auth mode ${this.authMode}:`,
        error
      );
      return defaultValue ?? null;
    }
  }

  /**
   * Remove a value for the current auth mode
   */
  removeItem(key: string): void {
    try {
      const storageKey = this.getKey(key);
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.warn(
        `Failed to remove ${key} for auth mode ${this.authMode}:`,
        error
      );
    }
  }

  /**
   * Clear all data for the current auth mode
   */
  clear(): void {
    try {
      const keysToRemove: string[] = [];
      const authModePrefix = `${this.prefix}_${this.authMode}_`;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(authModePrefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn(
        `Failed to clear storage for auth mode ${this.authMode}:`,
        error
      );
    }
  }

  /**
   * Get all keys for the current auth mode
   */
  getAllKeys(): string[] {
    try {
      const keys: string[] = [];
      const authModePrefix = `${this.prefix}_${this.authMode}_`;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(authModePrefix)) {
          // Remove the prefix to get the original key
          const originalKey = key.substring(authModePrefix.length);
          keys.push(originalKey);
        }
      }

      return keys;
    } catch (error) {
      console.warn(`Failed to get keys for auth mode ${this.authMode}:`, error);
      return [];
    }
  }

  /**
   * Migrate data from one auth mode to another
   */
  migrateData(fromMode: AuthModeType, toMode: AuthModeType): void {
    try {
      const fromPrefix = `${this.prefix}_${fromMode}_`;
      const toPrefix = `${this.prefix}_${toMode}_`;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(fromPrefix)) {
          const value = localStorage.getItem(key);
          if (value !== null) {
            const newKey = key.replace(fromPrefix, toPrefix);
            localStorage.setItem(newKey, value);
          }
        }
      }
    } catch (error) {
      console.warn(
        `Failed to migrate data from ${fromMode} to ${toMode}:`,
        error
      );
    }
  }

  /**
   * Check if data exists for a specific auth mode
   */
  hasDataForMode(authMode: AuthModeType): boolean {
    try {
      const authModePrefix = `${this.prefix}_${authMode}_`;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(authModePrefix)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.warn(`Failed to check data for auth mode ${authMode}:`, error);
      return false;
    }
  }
}

// Create storage instances for different features
export const userPreferencesStorage = new AuthModeStorage({
  prefix: "ddalab_preferences",
  authMode: "multi-user", // Default mode
});

export const dashboardStorage = new AuthModeStorage({
  prefix: "ddalab_dashboard",
  authMode: "multi-user", // Default mode
});

export const plotStorage = new AuthModeStorage({
  prefix: "ddalab_plots",
  authMode: "multi-user", // Default mode
});

export const widgetLayoutStorage = new AuthModeStorage({
  prefix: "ddalab_widget_layouts",
  authMode: "multi-user", // Default mode
});

/**
 * Update all storage instances to use a new auth mode
 */
export function switchAuthMode(newAuthMode: AuthModeType): void {
  userPreferencesStorage.setAuthMode(newAuthMode);
  dashboardStorage.setAuthMode(newAuthMode);
  plotStorage.setAuthMode(newAuthMode);
  widgetLayoutStorage.setAuthMode(newAuthMode);

  console.log(`Switched storage context to ${newAuthMode} mode`);
}

/**
 * Get the current auth mode from any storage instance
 */
export function getCurrentAuthMode(): AuthModeType {
  return userPreferencesStorage.getAuthMode();
}

export type { AuthModeStorageConfig };
export { AuthModeStorage };
