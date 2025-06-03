import { apolloCache } from "./apollo-client";
import logger from "./logger";

// Types for cache entries
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  key: string;
  lastAccessed: number;
  size: number;
}

interface PlotCacheKey {
  filePath: string;
  chunkStart: number;
  chunkSize: number;
  preprocessingOptions?: any;
}

interface HeatmapCacheKey {
  filePath: string;
  taskId?: string;
  Q?: any;
}

class PlotCacheManager {
  private static instance: PlotCacheManager;
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly ANNOTATION_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly HEATMAP_TTL = 10 * 60 * 1000; // 10 minutes

  // Cache size management
  private readonly MAX_CACHE_SIZE_MB = 4; // 4MB limit to stay well under localStorage quota
  private readonly MAX_CACHE_SIZE_BYTES = this.MAX_CACHE_SIZE_MB * 1024 * 1024;
  private readonly CLEANUP_THRESHOLD = 0.8; // Clean up when cache is 80% full

  // In-memory cache for hot data (reduces localStorage I/O)
  private memoryCache = new Map<
    string,
    { entry: CacheEntry<any>; expiry: number }
  >();
  private readonly MEMORY_CACHE_SIZE_LIMIT = 50; // Max items in memory cache
  private readonly MEMORY_CACHE_TTL = 2 * 60 * 1000; // 2 minutes in memory

  // Track last cleanup time to prevent excessive cleanup operations
  private lastCleanupTime = 0;
  private readonly CLEANUP_INTERVAL = 30 * 1000; // 30 seconds minimum between cleanups

  private constructor() {
    // Set up periodic memory cache cleanup
    setInterval(() => {
      this.cleanupMemoryCache();
    }, 60 * 1000); // Every minute
  }

  static getInstance(): PlotCacheManager {
    if (!PlotCacheManager.instance) {
      PlotCacheManager.instance = new PlotCacheManager();
    }
    return PlotCacheManager.instance;
  }

  /**
   * Clean up expired entries from memory cache
   */
  private cleanupMemoryCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, { expiry }] of this.memoryCache.entries()) {
      if (now > expiry) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.memoryCache.delete(key));

    // If memory cache is too large, remove oldest entries
    if (this.memoryCache.size > this.MEMORY_CACHE_SIZE_LIMIT) {
      const entries = Array.from(this.memoryCache.entries()).sort(
        (a, b) => a[1].entry.lastAccessed - b[1].entry.lastAccessed
      );

      const entriesToRemove = entries.slice(
        0,
        this.memoryCache.size - this.MEMORY_CACHE_SIZE_LIMIT
      );
      entriesToRemove.forEach(([key]) => this.memoryCache.delete(key));
    }
  }

  /**
   * Get entry from memory cache or localStorage
   */
  private getCacheEntry(cacheKey: string, ttl: number): CacheEntry<any> | null {
    // Check memory cache first
    const memoryEntry = this.memoryCache.get(cacheKey);
    if (memoryEntry && Date.now() < memoryEntry.expiry) {
      // Update last accessed time
      memoryEntry.entry.lastAccessed = Date.now();
      return memoryEntry.entry;
    }

    // Check localStorage
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const entry: CacheEntry<any> = JSON.parse(cached);
        if (this.isEntryValid(entry, ttl)) {
          // Update last accessed time
          entry.lastAccessed = Date.now();

          // Store in memory cache for faster access
          this.memoryCache.set(cacheKey, {
            entry,
            expiry: Date.now() + this.MEMORY_CACHE_TTL,
          });

          // Update localStorage less frequently to reduce I/O
          if (Date.now() - entry.timestamp > 30000) {
            // Only update every 30 seconds
            localStorage.setItem(cacheKey, JSON.stringify(entry));
          }

          return entry;
        } else {
          // Remove expired entry
          localStorage.removeItem(cacheKey);
          this.memoryCache.delete(cacheKey);
        }
      }
    } catch (error) {
      logger.error("Error reading cache entry:", error);
      // Clean up potentially corrupted entry
      this.memoryCache.delete(cacheKey);
    }

    return null;
  }

  /**
   * Generate a cache key for plot data
   */
  private generatePlotCacheKey(key: PlotCacheKey): string {
    const preprocessingKey = key.preprocessingOptions
      ? JSON.stringify(key.preprocessingOptions)
      : "none";
    return `plot:${key.filePath}:${key.chunkStart}:${key.chunkSize}:${preprocessingKey}`;
  }

  /**
   * Generate a cache key for heatmap data
   */
  private generateHeatmapCacheKey(key: HeatmapCacheKey): string {
    const taskKey = key.taskId || "default";
    const qKey = key.Q ? JSON.stringify(key.Q) : "none";
    return `heatmap:${key.filePath}:${taskKey}:${qKey}`;
  }

  /**
   * Generate a cache key for annotations
   */
  private generateAnnotationCacheKey(filePath: string): string {
    return `annotations:${filePath}`;
  }

  /**
   * Estimate the size of data in bytes when stored as JSON
   */
  private estimateDataSize(data: any): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      // Fallback estimation
      return JSON.stringify(data).length * 2; // Rough estimate for UTF-16
    }
  }

  /**
   * Get current cache size in bytes
   */
  private getCurrentCacheSize(): number {
    let totalSize = 0;
    const keys = Object.keys(localStorage);
    const cacheKeys = keys.filter(
      (key) =>
        key.startsWith("plot:") ||
        key.startsWith("heatmap:") ||
        key.startsWith("annotations:")
    );

    cacheKeys.forEach((key) => {
      try {
        const cached = localStorage.getItem(key);
        if (cached) {
          const entry: CacheEntry<any> = JSON.parse(cached);
          totalSize += entry.size || this.estimateDataSize(entry);
        }
      } catch {
        // Invalid entry, will be cleaned up later
      }
    });

    return totalSize;
  }

  /**
   * Clean up cache using LRU strategy when size exceeds threshold
   */
  private cleanupCacheIfNeeded(): void {
    const now = Date.now();

    // Prevent excessive cleanup operations
    if (now - this.lastCleanupTime < this.CLEANUP_INTERVAL) {
      return;
    }

    try {
      const currentSize = this.getCurrentCacheSize();

      if (currentSize > this.MAX_CACHE_SIZE_BYTES * this.CLEANUP_THRESHOLD) {
        logger.info(
          `Cache size (${(currentSize / 1024 / 1024).toFixed(
            2
          )}MB) exceeds threshold, starting cleanup`
        );

        // Get all cache entries with their access times
        const entries: Array<{
          key: string;
          lastAccessed: number;
          size: number;
        }> = [];
        const keys = Object.keys(localStorage);
        const cacheKeys = keys.filter(
          (key) =>
            key.startsWith("plot:") ||
            key.startsWith("heatmap:") ||
            key.startsWith("annotations:")
        );

        cacheKeys.forEach((key) => {
          try {
            const cached = localStorage.getItem(key);
            if (cached) {
              const entry: CacheEntry<any> = JSON.parse(cached);
              entries.push({
                key,
                lastAccessed: entry.lastAccessed || entry.timestamp,
                size: entry.size || this.estimateDataSize(entry),
              });
            }
          } catch {
            // Invalid entry, add to removal list
            localStorage.removeItem(key);
            this.memoryCache.delete(key);
          }
        });

        // Sort by last accessed (oldest first) and remove until we're under threshold
        entries.sort((a, b) => a.lastAccessed - b.lastAccessed);

        let removedSize = 0;
        const targetSize = this.MAX_CACHE_SIZE_BYTES * 0.6; // Clean to 60% capacity

        for (const entry of entries) {
          if (currentSize - removedSize <= targetSize) break;

          localStorage.removeItem(entry.key);
          this.memoryCache.delete(entry.key);
          removedSize += entry.size;
          logger.debug(
            `Removed cache entry: ${entry.key} (${(entry.size / 1024).toFixed(
              2
            )}KB)`
          );
        }

        logger.info(
          `Cache cleanup completed. Removed ${(
            removedSize /
            1024 /
            1024
          ).toFixed(2)}MB`
        );

        this.lastCleanupTime = now;
      }
    } catch (error) {
      logger.error("Error during cache cleanup:", error);
    }
  }

  /**
   * Handle QuotaExceededError by forcing cache cleanup and retrying
   */
  private handleQuotaExceeded(key: string, data: string): boolean {
    try {
      logger.warn("LocalStorage quota exceeded, forcing cache cleanup");

      // Remove expired entries first
      this.clearExpiredCache();

      // Force aggressive cleanup (remove 50% of cache)
      const entries: Array<{ key: string; lastAccessed: number }> = [];
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter(
        (k) =>
          k.startsWith("plot:") ||
          k.startsWith("heatmap:") ||
          k.startsWith("annotations:")
      );

      cacheKeys.forEach((k) => {
        try {
          const cached = localStorage.getItem(k);
          if (cached) {
            const entry: CacheEntry<any> = JSON.parse(cached);
            entries.push({
              key: k,
              lastAccessed: entry.lastAccessed || entry.timestamp,
            });
          }
        } catch {
          localStorage.removeItem(k);
        }
      });

      // Remove oldest 50% of entries
      entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
      const entriesToRemove = Math.ceil(entries.length * 0.5);

      for (let i = 0; i < entriesToRemove; i++) {
        localStorage.removeItem(entries[i].key);
        logger.info(`Force removed cache entry: ${entries[i].key}`);
      }

      // Try to store again
      localStorage.setItem(key, data);
      logger.info("Successfully stored data after cache cleanup");
      return true;
    } catch (retryError) {
      logger.error(
        "Failed to store data even after cache cleanup:",
        retryError
      );
      return false;
    }
  }

  /**
   * Check if a cache entry is still valid
   */
  private isEntryValid(entry: CacheEntry<any>, ttl: number): boolean {
    const now = Date.now();
    return now - entry.timestamp < ttl;
  }

  /**
   * Get cached plot data if available and valid
   */
  getCachedPlotData(key: PlotCacheKey): any | null {
    try {
      const cacheKey = this.generatePlotCacheKey(key);
      const cached = this.getCacheEntry(cacheKey, this.DEFAULT_TTL);

      if (cached) {
        logger.info(`Cache hit for plot data: ${cacheKey}`);
        return cached.data;
      }

      // Also check Apollo cache
      const apolloCacheData = this.getFromApolloCache("getEdfData", {
        filename: key.filePath,
        chunkStart: key.chunkStart,
        chunkSize: key.chunkSize,
        preprocessingOptions: key.preprocessingOptions,
      });

      if (apolloCacheData) {
        logger.info(`Apollo cache hit for plot data: ${cacheKey}`);
        return apolloCacheData;
      }

      return null;
    } catch (error) {
      logger.error("Error getting cached plot data:", error);
      return null;
    }
  }

  /**
   * Cache plot data
   */
  cachePlotData(key: PlotCacheKey, data: any): void {
    try {
      // Cleanup cache proactively if needed
      this.cleanupCacheIfNeeded();

      const cacheKey = this.generatePlotCacheKey(key);
      const dataSize = this.estimateDataSize(data);

      // Check if single entry is too large
      if (dataSize > this.MAX_CACHE_SIZE_BYTES * 0.3) {
        logger.warn(
          `Data too large to cache: ${(dataSize / 1024 / 1024).toFixed(2)}MB`
        );
        return;
      }

      const entry: CacheEntry<any> = {
        data,
        timestamp: Date.now(),
        lastAccessed: Date.now(),
        key: cacheKey,
        size: dataSize,
      };

      // Store in memory cache immediately
      this.memoryCache.set(cacheKey, {
        entry,
        expiry: Date.now() + this.MEMORY_CACHE_TTL,
      });

      const entryString = JSON.stringify(entry);

      try {
        localStorage.setItem(cacheKey, entryString);
        logger.info(
          `Cached plot data: ${cacheKey} (${(dataSize / 1024).toFixed(2)}KB)`
        );
      } catch (error) {
        if (error instanceof Error && error.name === "QuotaExceededError") {
          if (this.handleQuotaExceeded(cacheKey, entryString)) {
            logger.info(
              `Successfully cached plot data after cleanup: ${cacheKey}`
            );
          } else {
            logger.error(
              `Failed to cache plot data due to quota limits: ${cacheKey}`
            );
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error("Error caching plot data:", error);
    }
  }

  /**
   * Get cached heatmap data if available and valid
   */
  getCachedHeatmapData(key: HeatmapCacheKey): any | null {
    try {
      const cacheKey = this.generateHeatmapCacheKey(key);
      const cached = this.getCacheEntry(cacheKey, this.HEATMAP_TTL);

      if (cached) {
        logger.info(`Cache hit for heatmap data: ${cacheKey}`);
        return cached.data;
      }

      return null;
    } catch (error) {
      logger.error("Error getting cached heatmap data:", error);
      return null;
    }
  }

  /**
   * Cache heatmap data
   */
  cacheHeatmapData(key: HeatmapCacheKey, data: any): void {
    try {
      // Cleanup cache proactively if needed
      this.cleanupCacheIfNeeded();

      const cacheKey = this.generateHeatmapCacheKey(key);
      const dataSize = this.estimateDataSize(data);

      // Check if single entry is too large
      if (dataSize > this.MAX_CACHE_SIZE_BYTES * 0.3) {
        logger.warn(
          `Heatmap data too large to cache: ${(dataSize / 1024 / 1024).toFixed(
            2
          )}MB`
        );
        return;
      }

      const entry: CacheEntry<any> = {
        data,
        timestamp: Date.now(),
        lastAccessed: Date.now(),
        key: cacheKey,
        size: dataSize,
      };

      // Store in memory cache immediately
      this.memoryCache.set(cacheKey, {
        entry,
        expiry: Date.now() + this.MEMORY_CACHE_TTL,
      });

      const entryString = JSON.stringify(entry);

      try {
        localStorage.setItem(cacheKey, entryString);
        logger.info(
          `Cached heatmap data: ${cacheKey} (${(dataSize / 1024).toFixed(2)}KB)`
        );
      } catch (error) {
        if (error instanceof Error && error.name === "QuotaExceededError") {
          if (this.handleQuotaExceeded(cacheKey, entryString)) {
            logger.info(
              `Successfully cached heatmap data after cleanup: ${cacheKey}`
            );
          } else {
            logger.error(
              `Failed to cache heatmap data due to quota limits: ${cacheKey}`
            );
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error("Error caching heatmap data:", error);
    }
  }

  /**
   * Get cached annotations if available and valid
   */
  getCachedAnnotations(filePath: string): any | null {
    try {
      const cacheKey = this.generateAnnotationCacheKey(filePath);
      const cached = this.getCacheEntry(cacheKey, this.ANNOTATION_TTL);

      if (cached) {
        logger.info(`Cache hit for annotations: ${cacheKey}`);
        return cached.data;
      }

      return null;
    } catch (error) {
      logger.error("Error getting cached annotations:", error);
      return null;
    }
  }

  /**
   * Cache annotations
   */
  cacheAnnotations(filePath: string, data: any): void {
    try {
      // Cleanup cache proactively if needed
      this.cleanupCacheIfNeeded();

      const cacheKey = this.generateAnnotationCacheKey(filePath);
      const dataSize = this.estimateDataSize(data);

      const entry: CacheEntry<any> = {
        data,
        timestamp: Date.now(),
        lastAccessed: Date.now(),
        key: cacheKey,
        size: dataSize,
      };

      // Store in memory cache immediately
      this.memoryCache.set(cacheKey, {
        entry,
        expiry: Date.now() + this.MEMORY_CACHE_TTL,
      });

      const entryString = JSON.stringify(entry);

      try {
        localStorage.setItem(cacheKey, entryString);
        logger.info(
          `Cached annotations: ${cacheKey} (${(dataSize / 1024).toFixed(2)}KB)`
        );
      } catch (error) {
        if (error instanceof Error && error.name === "QuotaExceededError") {
          if (this.handleQuotaExceeded(cacheKey, entryString)) {
            logger.info(
              `Successfully cached annotations after cleanup: ${cacheKey}`
            );
          } else {
            logger.error(
              `Failed to cache annotations due to quota limits: ${cacheKey}`
            );
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error("Error caching annotations:", error);
    }
  }

  /**
   * Get data from Apollo cache
   */
  private getFromApolloCache(queryName: string, variables: any): any | null {
    try {
      const cachedData = apolloCache.readQuery({
        query: require("../graphql/queries")[queryName.toUpperCase()],
        variables,
      });
      return cachedData;
    } catch (error) {
      // Cache miss or query not found
      return null;
    }
  }

  /**
   * Clear all cached data for a specific file
   */
  clearFileCache(filePath: string): void {
    try {
      const keys = Object.keys(localStorage);
      const fileKeys = keys.filter(
        (key) =>
          key.includes(filePath) &&
          (key.startsWith("plot:") ||
            key.startsWith("heatmap:") ||
            key.startsWith("annotations:"))
      );

      fileKeys.forEach((key) => {
        localStorage.removeItem(key);
        this.memoryCache.delete(key);
        logger.debug(`Cleared cache key: ${key}`);
      });

      // Also clear memory cache entries for this file
      for (const [key] of this.memoryCache.entries()) {
        if (key.includes(filePath)) {
          this.memoryCache.delete(key);
        }
      }
    } catch (error) {
      logger.error("Error clearing file cache:", error);
    }
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): void {
    try {
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter(
        (key) =>
          key.startsWith("plot:") ||
          key.startsWith("heatmap:") ||
          key.startsWith("annotations:")
      );

      let cleanedCount = 0;
      cacheKeys.forEach((key) => {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry: CacheEntry<any> = JSON.parse(cached);
            const ttl = key.startsWith("plot:")
              ? this.DEFAULT_TTL
              : key.startsWith("annotations:")
              ? this.ANNOTATION_TTL
              : this.HEATMAP_TTL;

            if (!this.isEntryValid(entry, ttl)) {
              localStorage.removeItem(key);
              this.memoryCache.delete(key);
              cleanedCount++;
            }
          }
        } catch {
          // Invalid entry, remove it
          localStorage.removeItem(key);
          this.memoryCache.delete(key);
          cleanedCount++;
        }
      });

      // Also clean memory cache
      this.cleanupMemoryCache();

      if (cleanedCount > 0) {
        logger.info(`Cleared ${cleanedCount} expired cache entries`);
      }
    } catch (error) {
      logger.error("Error clearing expired cache:", error);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    plotCount: number;
    heatmapCount: number;
    annotationCount: number;
    totalSizeMB: number;
    totalSizeBytes: number;
  } {
    try {
      const keys = Object.keys(localStorage);
      const plotCount = keys.filter((key) => key.startsWith("plot:")).length;
      const heatmapCount = keys.filter((key) =>
        key.startsWith("heatmap:")
      ).length;
      const annotationCount = keys.filter((key) =>
        key.startsWith("annotations:")
      ).length;

      const totalSizeBytes = this.getCurrentCacheSize();
      const totalSizeMB = totalSizeBytes / 1024 / 1024;

      return {
        plotCount,
        heatmapCount,
        annotationCount,
        totalSizeMB: parseFloat(totalSizeMB.toFixed(2)),
        totalSizeBytes,
      };
    } catch (error) {
      logger.error("Error getting cache stats:", error);
      return {
        plotCount: 0,
        heatmapCount: 0,
        annotationCount: 0,
        totalSizeMB: 0,
        totalSizeBytes: 0,
      };
    }
  }

  /**
   * Manually trigger cache cleanup - useful for UI or debugging
   */
  forceCacheCleanup(targetPercentage: number = 0.5): void {
    try {
      logger.info(
        `Forcing cache cleanup to ${targetPercentage * 100}% capacity`
      );

      const entries: Array<{
        key: string;
        lastAccessed: number;
        size: number;
      }> = [];
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter(
        (key) =>
          key.startsWith("plot:") ||
          key.startsWith("heatmap:") ||
          key.startsWith("annotations:")
      );

      // Collect all entries with metadata
      cacheKeys.forEach((key) => {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry: CacheEntry<any> = JSON.parse(cached);
            entries.push({
              key,
              lastAccessed: entry.lastAccessed || entry.timestamp,
              size: entry.size || this.estimateDataSize(entry),
            });
          }
        } catch {
          // Invalid entry, remove it
          localStorage.removeItem(key);
        }
      });

      if (entries.length === 0) {
        logger.info("No cache entries to clean up");
        return;
      }

      // Calculate target size
      const currentSize = entries.reduce((sum, entry) => sum + entry.size, 0);
      const targetSize = this.MAX_CACHE_SIZE_BYTES * targetPercentage;

      if (currentSize <= targetSize) {
        logger.info(
          `Cache size (${(currentSize / 1024 / 1024).toFixed(
            2
          )}MB) already below target`
        );
        return;
      }

      // Sort by last accessed (oldest first) and remove entries
      entries.sort((a, b) => a.lastAccessed - b.lastAccessed);

      let removedSize = 0;
      let removedCount = 0;

      for (const entry of entries) {
        if (currentSize - removedSize <= targetSize) break;

        localStorage.removeItem(entry.key);
        removedSize += entry.size;
        removedCount++;

        logger.info(
          `Removed cache entry: ${entry.key} (${(entry.size / 1024).toFixed(
            2
          )}KB)`
        );
      }

      logger.info(
        `Manual cache cleanup completed. Removed ${removedCount} entries (${(
          removedSize /
          1024 /
          1024
        ).toFixed(2)}MB)`
      );
    } catch (error) {
      logger.error("Error during manual cache cleanup:", error);
    }
  }
}

// Export singleton instance
export const plotCacheManager = PlotCacheManager.getInstance();

// Export types for use in other modules
export type { PlotCacheKey, HeatmapCacheKey };
