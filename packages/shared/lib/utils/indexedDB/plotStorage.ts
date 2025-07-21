export interface PlotData {
  filePath: string;
  metadata: any;
  edfData: any;
  selectedChannels: string[];
  timeWindow: [number, number];
  absoluteTimeWindow: [number, number];
  zoomLevel: number;
  chunkSizeSeconds: number;
  currentChunkNumber: number;
  totalChunks: number;
  chunkStart: number;
  showHeatmap: boolean;
  ddaResults: any;
  annotations: any[];
  showSettingsDialog: boolean;
  showZoomSettingsDialog: boolean;
  preprocessingOptions: any;
  lastAccessed: number;
  size: number; // Size in bytes for cleanup
}

class IndexedDBPlotStorage {
  private static instance: IndexedDBPlotStorage;
  private db: IDBDatabase | null = null;
  private readonly DB_NAME = "DDALAB_PlotStorage";
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = "plots";
  private readonly MAX_STORAGE_SIZE = 100 * 1024 * 1024; // 100MB limit
  private readonly MAX_PLOTS = 20; // Maximum number of plots to store

  private constructor() {}

  public static getInstance(): IndexedDBPlotStorage {
    if (!IndexedDBPlotStorage.instance) {
      IndexedDBPlotStorage.instance = new IndexedDBPlotStorage();
    }
    return IndexedDBPlotStorage.instance;
  }

  private async openDatabase(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        console.error("Failed to open IndexedDB:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;

        // Set up database event handlers
        this.db.onerror = (event) => {
          console.error("IndexedDB error:", event);
        };

        this.db.onversionchange = () => {
          console.warn("IndexedDB version change detected");
          this.db?.close();
          this.db = null;
        };

        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store with filePath as key
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, {
            keyPath: "filePath",
          });

          // Create indexes for efficient querying
          store.createIndex("lastAccessed", "lastAccessed", { unique: false });
          store.createIndex("size", "size", { unique: false });
        }
      };
    });
  }

  private async ensureDatabaseReady(): Promise<IDBDatabase> {
    try {
      return await this.openDatabase();
    } catch (error) {
      console.error("Failed to ensure database is ready:", error);
      throw error;
    }
  }

  public async savePlot(plotData: PlotData): Promise<void> {
    try {
      const db = await this.ensureDatabaseReady();

      // Calculate size of the plot data first
      const serializedData = JSON.stringify(plotData);
      const size = new Blob([serializedData]).size;

      // Warn if data is very large
      if (size > 50 * 1024 * 1024) {
        // 50MB
        console.warn(
          `Large plot data detected: ${(size / 1024 / 1024).toFixed(2)}MB for ${
            plotData.filePath
          }`
        );
      }

      const plotWithSize = {
        ...plotData,
        size,
        lastAccessed: Date.now(),
      };

      // Check storage limits before creating transaction
      await this.enforceStorageLimits(size);

      // Create transaction and immediately start the operation
      const transaction = db.transaction([this.STORE_NAME], "readwrite");
      const store = transaction.objectStore(this.STORE_NAME);

      return new Promise((resolve, reject) => {
        // Set up transaction event handlers immediately
        transaction.oncomplete = () => {
          console.log(
            `Successfully saved plot to IndexedDB: ${plotData.filePath}`
          );
          resolve();
        };

        transaction.onerror = () => {
          console.error("Transaction error:", transaction.error);
          // Check if it's a quota exceeded error
          if (transaction.error?.name === "QuotaExceededError") {
            console.warn(
              "IndexedDB quota exceeded, clearing all data and retrying..."
            );
            this.handleQuotaExceeded(plotWithSize).then(resolve).catch(reject);
          } else {
            reject(transaction.error);
          }
        };

        transaction.onabort = () => {
          console.error("Transaction aborted:", transaction.error);
          reject(transaction.error);
        };

        // Start the put operation immediately
        const request = store.put(plotWithSize);

        request.onsuccess = () => {
          // Don't resolve here, wait for transaction completion
          console.log(`Put operation successful for: ${plotData.filePath}`);
        };

        request.onerror = () => {
          console.error("Put operation failed:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Error saving plot to IndexedDB:", error);
      throw error;
    }
  }

  private async handleQuotaExceeded(plotData: PlotData): Promise<void> {
    try {
      // Clear all data first
      await this.clearAll();

      // Wait a bit for the clear operation to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Try to save the plot again
      await this.savePlot(plotData);
    } catch (error) {
      console.error("Failed to save plot after clearing storage:", error);
      throw error;
    }
  }

  public async getPlot(filePath: string): Promise<PlotData | null> {
    try {
      const db = await this.ensureDatabaseReady();
      const transaction = db.transaction([this.STORE_NAME], "readonly");
      const store = transaction.objectStore(this.STORE_NAME);

      return new Promise((resolve, reject) => {
        // Set up transaction event handlers
        transaction.onerror = () => {
          console.error("Get transaction error:", transaction.error);
          reject(transaction.error);
        };

        transaction.onabort = () => {
          console.error("Get transaction aborted:", transaction.error);
          reject(transaction.error);
        };

        const request = store.get(filePath);

        request.onsuccess = () => {
          if (request.result) {
            // Update last accessed time (but don't wait for it)
            this.updateLastAccessed(filePath).catch((err) =>
              console.warn("Failed to update last accessed time:", err)
            );
            resolve(request.result);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => {
          console.error("Get request failed:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Error getting plot from IndexedDB:", error);
      return null;
    }
  }

  public async deletePlot(filePath: string): Promise<void> {
    try {
      const db = await this.ensureDatabaseReady();
      const transaction = db.transaction([this.STORE_NAME], "readwrite");
      const store = transaction.objectStore(this.STORE_NAME);

      return new Promise((resolve, reject) => {
        // Set up transaction event handlers
        transaction.oncomplete = () => {
          console.log(`Successfully deleted plot from IndexedDB: ${filePath}`);
          resolve();
        };

        transaction.onerror = () => {
          console.error("Delete transaction error:", transaction.error);
          reject(transaction.error);
        };

        transaction.onabort = () => {
          console.error("Delete transaction aborted:", transaction.error);
          reject(transaction.error);
        };

        const request = store.delete(filePath);

        request.onsuccess = () => {
          // Don't resolve here, wait for transaction completion
        };

        request.onerror = () => {
          console.error("Delete request failed:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Error deleting plot from IndexedDB:", error);
      throw error;
    }
  }

  public async getAllPlots(): Promise<PlotData[]> {
    try {
      const db = await this.ensureDatabaseReady();
      const transaction = db.transaction([this.STORE_NAME], "readonly");
      const store = transaction.objectStore(this.STORE_NAME);

      return new Promise((resolve, reject) => {
        // Set up transaction event handlers
        transaction.onerror = () => {
          console.error("GetAll transaction error:", transaction.error);
          reject(transaction.error);
        };

        transaction.onabort = () => {
          console.error("GetAll transaction aborted:", transaction.error);
          reject(transaction.error);
        };

        const request = store.getAll();

        request.onsuccess = () => {
          const result = request.result || [];
          console.log(`Retrieved ${result.length} plots from IndexedDB`);
          resolve(result);
        };

        request.onerror = () => {
          console.error("GetAll request failed:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Error getting all plots from IndexedDB:", error);
      return [];
    }
  }

  public async getStorageInfo(): Promise<{
    totalSize: number;
    plotCount: number;
  }> {
    try {
      const plots = await this.getAllPlots();
      const totalSize = plots.reduce((sum, plot) => sum + plot.size, 0);
      return { totalSize, plotCount: plots.length };
    } catch (error) {
      console.error("Error getting storage info:", error);
      return { totalSize: 0, plotCount: 0 };
    }
  }

  private async updateLastAccessed(filePath: string): Promise<void> {
    try {
      const plot = await this.getPlot(filePath);
      if (plot) {
        plot.lastAccessed = Date.now();
        await this.savePlot(plot);
      }
    } catch (error) {
      console.warn("Error updating last accessed time:", error);
    }
  }

  private async enforceStorageLimits(newPlotSize: number): Promise<void> {
    try {
      const plots = await this.getAllPlots();
      const { totalSize } = await this.getStorageInfo();

      // If adding this plot would exceed limits, clean up old plots
      if (
        totalSize + newPlotSize > this.MAX_STORAGE_SIZE ||
        plots.length >= this.MAX_PLOTS
      ) {
        await this.cleanupOldPlots();
      }
    } catch (error) {
      console.warn("Error enforcing storage limits:", error);
    }
  }

  private async cleanupOldPlots(): Promise<void> {
    try {
      const plots = await this.getAllPlots();

      // Sort by last accessed time (oldest first)
      plots.sort((a, b) => a.lastAccessed - b.lastAccessed);

      // Remove oldest plots until we're under limits
      const { totalSize } = await this.getStorageInfo();
      let currentSize = totalSize;
      let removedCount = 0;

      for (const plot of plots) {
        if (
          currentSize <= this.MAX_STORAGE_SIZE * 0.7 && // More aggressive cleanup
          plots.length - removedCount <= this.MAX_PLOTS * 0.7
        ) {
          break; // Stop if we're under 70% of limits
        }

        try {
          await this.deletePlot(plot.filePath);
          currentSize -= plot.size;
          removedCount++;
          console.log(
            `Cleaned up old plot: ${plot.filePath} (${(
              plot.size /
              1024 /
              1024
            ).toFixed(2)}MB)`
          );
        } catch (error) {
          console.warn(`Failed to clean up plot ${plot.filePath}:`, error);
        }
      }

      if (removedCount > 0) {
        console.log(`Storage cleanup completed: removed ${removedCount} plots`);
      }
    } catch (error) {
      console.error("Error cleaning up old plots:", error);
    }
  }

  public async clearAll(): Promise<void> {
    try {
      const db = await this.ensureDatabaseReady();
      const transaction = db.transaction([this.STORE_NAME], "readwrite");
      const store = transaction.objectStore(this.STORE_NAME);

      return new Promise((resolve, reject) => {
        // Set up transaction event handlers
        transaction.oncomplete = () => {
          console.log("Successfully cleared all plots from IndexedDB");
          resolve();
        };

        transaction.onerror = () => {
          console.error("ClearAll transaction error:", transaction.error);
          reject(transaction.error);
        };

        transaction.onabort = () => {
          console.error("ClearAll transaction aborted:", transaction.error);
          reject(transaction.error);
        };

        const request = store.clear();

        request.onsuccess = () => {
          // Don't resolve here, wait for transaction completion
        };

        request.onerror = () => {
          console.error("ClearAll request failed:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Error clearing IndexedDB:", error);
      throw error;
    }
  }
}

export const plotStorage = IndexedDBPlotStorage.getInstance();
