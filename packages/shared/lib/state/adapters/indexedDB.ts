import { StorageAdapter, StateValue } from '../core/interfaces';

/**
 * IndexedDB adapter implementation
 * Provides more robust storage with larger capacity and better performance
 */
export class IndexedDBAdapter implements StorageAdapter {
  private dbName: string;
  private version: number;
  private storeName: string;
  private db: IDBDatabase | null = null;

  constructor(
    dbName: string = 'ddalab_state_db',
    version: number = 1,
    storeName: string = 'state_store'
  ) {
    this.dbName = dbName;
    this.version = version;
    this.storeName = storeName;
  }

  private async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB not supported'));
        return;
      }

      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  private async withTransaction<T>(
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.initDB();
    const transaction = db.transaction(this.storeName, mode);
    const store = transaction.objectStore(this.storeName);
    
    return new Promise((resolve, reject) => {
      const request = callback(store);
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async get(key: string): Promise<StateValue | undefined> {
    try {
      const result = await this.withTransaction('readonly', (store) => 
        store.get(key)
      );
      
      return result?.value;
    } catch (error) {
      console.error(`[IndexedDBAdapter] Error getting key "${key}":`, error);
      return undefined;
    }
  }

  async set(key: string, value: StateValue): Promise<void> {
    try {
      await this.withTransaction('readwrite', (store) => 
        store.put({
          key,
          value,
          timestamp: Date.now()
        })
      );
    } catch (error) {
      console.error(`[IndexedDBAdapter] Error setting key "${key}":`, error);
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.withTransaction('readwrite', (store) => 
        store.delete(key)
      );
    } catch (error) {
      console.error(`[IndexedDBAdapter] Error removing key "${key}":`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.withTransaction('readwrite', (store) => 
        store.clear()
      );
    } catch (error) {
      console.error('[IndexedDBAdapter] Error clearing storage:', error);
    }
  }

  async getAllKeys(): Promise<string[]> {
    try {
      const result = await this.withTransaction('readonly', (store) => 
        store.getAllKeys()
      );
      
      return result as string[];
    } catch (error) {
      console.error('[IndexedDBAdapter] Error getting all keys:', error);
      return [];
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const result = await this.withTransaction('readonly', (store) => 
        store.count(key)
      );
      
      return result > 0;
    } catch (error) {
      console.error(`[IndexedDBAdapter] Error checking key "${key}":`, error);
      return false;
    }
  }

  /**
   * Get all entries sorted by timestamp
   */
  async getAllEntries(): Promise<Array<{ key: string; value: StateValue; timestamp: number }>> {
    try {
      const result = await this.withTransaction('readonly', (store) => 
        store.getAll()
      );
      
      return result.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('[IndexedDBAdapter] Error getting all entries:', error);
      return [];
    }
  }

  /**
   * Clean up old entries based on age or count
   */
  async cleanup(maxAge?: number, maxCount?: number): Promise<void> {
    try {
      const entries = await this.getAllEntries();
      const now = Date.now();
      const keysToRemove: string[] = [];

      // Remove entries older than maxAge
      if (maxAge) {
        entries.forEach(entry => {
          if (now - entry.timestamp > maxAge) {
            keysToRemove.push(entry.key);
          }
        });
      }

      // Remove excess entries if over maxCount
      if (maxCount && entries.length > maxCount) {
        const excess = entries.slice(maxCount);
        excess.forEach(entry => keysToRemove.push(entry.key));
      }

      // Remove duplicate keys and execute removals
      const uniqueKeys = [...new Set(keysToRemove)];
      
      for (const key of uniqueKeys) {
        await this.remove(key);
      }

      if (uniqueKeys.length > 0) {
        console.log(`[IndexedDBAdapter] Cleaned up ${uniqueKeys.length} entries`);
      }
    } catch (error) {
      console.error('[IndexedDBAdapter] Cleanup failed:', error);
    }
  }

  /**
   * Get storage usage estimate
   */
  async getStorageEstimate(): Promise<{ quota?: number; usage?: number; available?: number }> {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return {
          quota: estimate.quota,
          usage: estimate.usage,
          available: estimate.quota && estimate.usage ? estimate.quota - estimate.usage : undefined
        };
      }
    } catch (error) {
      console.error('[IndexedDBAdapter] Error getting storage estimate:', error);
    }
    
    return {};
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}