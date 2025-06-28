import { BaseCacheManager, CacheEntry } from "./baseCacheManager";
import logger from "../logger";

export interface PlotCacheKey {
  filePath: string;
  chunkStart: number;
  chunkSize: number;
  preprocessingOptions?: any;
}

export class PlotDataCacheManager extends BaseCacheManager<any> {
  private static instance: PlotDataCacheManager;

  private constructor() {
    super("plot", 5 * 60 * 1000); // 5 minutes TTL
  }

  static getInstance(): PlotDataCacheManager {
    if (!PlotDataCacheManager.instance) {
      PlotDataCacheManager.instance = new PlotDataCacheManager();
    }
    return PlotDataCacheManager.instance;
  }

  /**
   * Generate a cache key for plot data
   */
  generateCacheKey(key: PlotCacheKey): string {
    const preprocessingKey = key.preprocessingOptions
      ? JSON.stringify(key.preprocessingOptions)
      : "none";
    return `${this.prefix}:${key.filePath}:${key.chunkStart}:${key.chunkSize}:${preprocessingKey}`;
  }

  /**
   * Get cached plot data
   */
  getCachedPlotData(key: PlotCacheKey): any | null {
    const cacheKey = this.generateCacheKey(key);
    const entry = this.getCacheEntry(cacheKey, this.ttl);

    if (entry) {
      logger.info("Cache hit for plot data:", key.filePath);
      return entry.data;
    }

    return null;
  }

  /**
   * Cache plot data
   */
  cachePlotData(key: PlotCacheKey, data: any): void {
    const cacheKey = this.generateCacheKey(key);
    const dataSize = this.estimateDataSize(data);

    // Check if data is too large to cache (>2MB)
    const MAX_SINGLE_ITEM_SIZE = 2 * 1024 * 1024; // 2MB
    if (dataSize > MAX_SINGLE_ITEM_SIZE) {
      logger.warn(
        `Plot data too large to cache: ${(dataSize / 1024 / 1024).toFixed(
          2
        )}MB, storing in memory only`
      );

      // Store only in memory cache with shorter TTL
      const entry: CacheEntry<any> = {
        data,
        timestamp: Date.now(),
        key: cacheKey,
        lastAccessed: Date.now(),
        size: dataSize,
      };

      // Store in memory cache only
      super.storeInMemoryOnly(cacheKey, entry);
      logger.info("Stored large plot data in memory cache only");
      return;
    }

    const entry: CacheEntry<any> = {
      data,
      timestamp: Date.now(),
      key: cacheKey,
      lastAccessed: Date.now(),
      size: dataSize,
    };

    this.setCacheEntry(cacheKey, entry);
    logger.info(
      `Cached plot data (${(dataSize / 1024).toFixed(1)}KB):`,
      key.filePath
    );
  }

  /**
   * Clear cache for a specific file
   */
  clearFileCache(filePath: string): void {
    const keys = this.getAllCacheKeys();
    const fileKeys = keys.filter((key) => key.includes(`:${filePath}:`));

    fileKeys.forEach((key) => {
      this.removeCacheEntry(key);
    });

    logger.info(`Cleared plot cache for file: ${filePath}`);
  }

  /**
   * Get cache statistics including memory cache
   */
  getCacheStats(): {
    totalEntries: number;
    memoryEntries: number;
    totalSizeMB: number;
    memorySizeMB: number;
    ttlSeconds: number;
  } {
    // Get localStorage stats
    const keys = this.getAllCacheKeys();
    let localStorageSize = 0;

    keys.forEach((key) => {
      try {
        if (typeof localStorage !== "undefined") {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry = JSON.parse(cached);
            localStorageSize += entry.size || this.estimateDataSize(entry.data);
          }
        }
      } catch {
        // Invalid entry
      }
    });

    // Get memory cache stats
    const memoryStats = this.getMemoryCacheStats();
    const memoryPlotKeys = memoryStats.keys.filter((key) =>
      key.startsWith("plot:")
    );

    const totalSizeBytes = localStorageSize + memoryStats.sizeMB * 1024 * 1024;

    return {
      totalEntries: keys.length + memoryPlotKeys.length,
      memoryEntries: memoryPlotKeys.length,
      totalSizeMB: totalSizeBytes / 1024 / 1024,
      memorySizeMB: memoryStats.sizeMB,
      ttlSeconds: this.ttl / 1000,
    };
  }
}
