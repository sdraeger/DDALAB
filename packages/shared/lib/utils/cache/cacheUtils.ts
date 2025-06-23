import logger from "../logger";

/**
 * Utility functions for cache management and debugging
 */
export class CacheUtils {
  /**
   * Get localStorage usage information
   */
  static getStorageInfo(): {
    used: number;
    usedMB: number;
    quota?: number;
    quotaMB?: number;
    available?: number;
    availableMB?: number;
    utilization?: number;
  } {
    let used = 0;

    // Calculate used space
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        used += (localStorage[key].length + key.length) * 2; // UTF-16 encoding
      }
    }

    const result = {
      used,
      usedMB: used / 1024 / 1024,
    };

    // Try to estimate quota using the Storage API if available
    if (
      "navigator" in globalThis &&
      "storage" in navigator &&
      "estimate" in navigator.storage
    ) {
      navigator.storage
        .estimate()
        .then((estimate) => {
          if (estimate.quota && estimate.usage) {
            const quota = estimate.quota;
            const available = quota - used;
            const utilization = (used / quota) * 100;

            logger.info("Storage estimate:", {
              used: `${(used / 1024 / 1024).toFixed(2)}MB`,
              quota: `${(quota / 1024 / 1024).toFixed(2)}MB`,
              available: `${(available / 1024 / 1024).toFixed(2)}MB`,
              utilization: `${utilization.toFixed(1)}%`,
            });
          }
        })
        .catch((err) => {
          logger.warn("Failed to get storage estimate:", err);
        });
    }

    return result;
  }

  /**
   * Clear all cache entries
   */
  static clearAllCache(): void {
    const keys = Object.keys(localStorage);
    const cacheKeys = keys.filter(
      (key) =>
        key.startsWith("plot:") ||
        key.startsWith("heatmap:") ||
        key.startsWith("annotations:")
    );

    cacheKeys.forEach((key) => {
      localStorage.removeItem(key);
    });

    logger.info(`Cleared ${cacheKeys.length} cache entries`);
  }

  /**
   * Get cache statistics
   */
  static getCacheStats(): {
    plotCount: number;
    heatmapCount: number;
    annotationCount: number;
    totalSize: number;
    totalSizeMB: number;
    oldestEntry?: string;
    newestEntry?: string;
  } {
    const keys = Object.keys(localStorage);
    let plotCount = 0;
    let heatmapCount = 0;
    let annotationCount = 0;
    let totalSize = 0;
    let oldestTimestamp = Date.now();
    let newestTimestamp = 0;
    let oldestEntry = "";
    let newestEntry = "";

    keys.forEach((key) => {
      if (key.startsWith("plot:")) {
        plotCount++;
      } else if (key.startsWith("heatmap:")) {
        heatmapCount++;
      } else if (key.startsWith("annotations:")) {
        annotationCount++;
      } else {
        return; // Skip non-cache keys
      }

      try {
        const value = localStorage[key];
        totalSize += (value.length + key.length) * 2;

        const entry = JSON.parse(value);
        if (entry.timestamp) {
          if (entry.timestamp < oldestTimestamp) {
            oldestTimestamp = entry.timestamp;
            oldestEntry = key;
          }
          if (entry.timestamp > newestTimestamp) {
            newestTimestamp = entry.timestamp;
            newestEntry = key;
          }
        }
      } catch (err) {
        // Skip invalid entries
      }
    });

    return {
      plotCount,
      heatmapCount,
      annotationCount,
      totalSize,
      totalSizeMB: totalSize / 1024 / 1024,
      oldestEntry: oldestEntry || undefined,
      newestEntry: newestEntry || undefined,
    };
  }

  /**
   * Log detailed cache information
   */
  static logCacheInfo(): void {
    const stats = this.getCacheStats();
    const storage = this.getStorageInfo();

    logger.info("Cache Statistics:", {
      "Plot cache entries": stats.plotCount,
      "Heatmap cache entries": stats.heatmapCount,
      "Annotation cache entries": stats.annotationCount,
      "Total cache size": `${stats.totalSizeMB.toFixed(2)}MB`,
      "Total localStorage used": `${storage.usedMB.toFixed(2)}MB`,
      "Oldest entry": stats.oldestEntry,
      "Newest entry": stats.newestEntry,
    });
  }

  /**
   * Test localStorage availability and capacity
   */
  static testStorageCapacity(): Promise<{
    available: boolean;
    estimatedCapacity?: number;
    estimatedCapacityMB?: number;
  }> {
    return new Promise((resolve) => {
      try {
        // Test basic availability
        const testKey = "__cache_test__";
        localStorage.setItem(testKey, "test");
        localStorage.removeItem(testKey);

        // Try to estimate capacity
        let capacity = 0;
        const testChunk = "x".repeat(1024); // 1KB chunks
        let testIndex = 0;

        const testInterval = setInterval(() => {
          try {
            const key = `__capacity_test_${testIndex}__`;
            localStorage.setItem(key, testChunk);
            capacity += 1024;
            testIndex++;

            // Stop after 100KB or if we hit an error
            if (capacity >= 100 * 1024) {
              clearInterval(testInterval);
              this.cleanupCapacityTest(testIndex);
              resolve({
                available: true,
                estimatedCapacity: capacity,
                estimatedCapacityMB: capacity / 1024 / 1024,
              });
            }
          } catch (err) {
            clearInterval(testInterval);
            this.cleanupCapacityTest(testIndex);
            resolve({
              available: true,
              estimatedCapacity: capacity,
              estimatedCapacityMB: capacity / 1024 / 1024,
            });
          }
        }, 1);
      } catch (err) {
        resolve({ available: false });
      }
    });
  }

  /**
   * Clean up capacity test entries
   */
  private static cleanupCapacityTest(maxIndex: number): void {
    for (let i = 0; i < maxIndex; i++) {
      try {
        localStorage.removeItem(`__capacity_test_${i}__`);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }
}
