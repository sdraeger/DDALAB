export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  key: string;
  lastAccessed: number;
  size: number;
}

export abstract class BaseCacheManager<T> {
  protected readonly prefix: string;
  protected readonly ttl: number;
  private readonly MAX_CACHE_SIZE_MB = 4; // 4MB limit
  private readonly MAX_CACHE_SIZE_BYTES = this.MAX_CACHE_SIZE_MB * 1024 * 1024;
  private readonly CLEANUP_THRESHOLD = 0.8; // Clean up when cache is 80% full

  // In-memory cache for hot data
  private memoryCache = new Map<
    string,
    { entry: CacheEntry<T>; expiry: number }
  >();
  private readonly MEMORY_CACHE_SIZE_LIMIT = 50;
  private readonly MEMORY_CACHE_TTL = 2 * 60 * 1000; // 2 minutes in memory

  constructor(prefix: string, ttl: number) {
    this.prefix = prefix;
    this.ttl = ttl;

    // Set up periodic memory cache cleanup
    setInterval(() => {
      this.cleanupMemoryCache();
    }, 60 * 1000); // Every minute
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
  protected getCacheEntry(cacheKey: string, ttl: number): CacheEntry<T> | null {
    // Check memory cache first
    const memoryEntry = this.memoryCache.get(cacheKey);
    if (memoryEntry && Date.now() < memoryEntry.expiry) {
      // Update last accessed time
      memoryEntry.entry.lastAccessed = Date.now();
      return memoryEntry.entry;
    }

    // Check if we're in a browser environment with localStorage
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      return null; // Return null on server side
    }

    // Check localStorage
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const entry: CacheEntry<T> = JSON.parse(cached);
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
      console.error("Error reading cache entry:", error);
      this.memoryCache.delete(cacheKey);
    }

    return null;
  }

  /**
   * Set cache entry in both memory and localStorage
   */
  protected setCacheEntry(cacheKey: string, entry: CacheEntry<T>): void {
    // Check if we need to clean up first
    this.cleanupCacheIfNeeded();

    // Always store in memory cache
    this.memoryCache.set(cacheKey, {
      entry,
      expiry: Date.now() + this.MEMORY_CACHE_TTL,
    });

    // Only try localStorage in browser environment
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      return; // Skip localStorage on server side
    }

    try {
      // Store in localStorage
      localStorage.setItem(cacheKey, JSON.stringify(entry));
    } catch (error) {
      if (this.isQuotaExceededError(error)) {
        console.warn(
          "localStorage quota exceeded, attempting cleanup and retry"
        );
        this.handleQuotaExceeded(cacheKey, entry);
      } else {
        console.error("Error setting cache entry:", error);
      }
    }
  }

  /**
   * Check if error is a quota exceeded error
   */
  private isQuotaExceededError(error: any): boolean {
    return (
      error instanceof DOMException &&
      (error.code === 22 ||
        error.code === 1014 ||
        error.name === "QuotaExceededError" ||
        error.name === "NS_ERROR_DOM_QUOTA_REACHED")
    );
  }

  /**
   * Handle quota exceeded by aggressive cleanup and retry
   */
  private handleQuotaExceeded(cacheKey: string, entry: CacheEntry<T>): void {
    console.log("Handling localStorage quota exceeded error");

    // Check if we're in a browser environment with localStorage
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      // On server side, just store in memory
      this.memoryCache.set(cacheKey, {
        entry,
        expiry: Date.now() + this.MEMORY_CACHE_TTL,
      });
      return;
    }

    // Try aggressive cleanup (keep only 25% of cache)
    this.forceCacheCleanup(0.25);

    try {
      // Retry storing after cleanup
      localStorage.setItem(cacheKey, JSON.stringify(entry));

      // Store in memory cache
      this.memoryCache.set(cacheKey, {
        entry,
        expiry: Date.now() + this.MEMORY_CACHE_TTL,
      });

      console.log("Successfully cached after cleanup");
    } catch (retryError) {
      if (this.isQuotaExceededError(retryError)) {
        console.warn(
          "Still quota exceeded after cleanup, storing in memory only"
        );

        // If still failing, store only in memory with longer TTL
        this.memoryCache.set(cacheKey, {
          entry,
          expiry: Date.now() + this.MEMORY_CACHE_TTL * 3, // Triple the memory cache time
        });

        // Also try to clear even more aggressively
        this.emergencyCleanup();
      } else {
        console.error("Error setting cache entry after cleanup:", retryError);
      }
    }
  }

  /**
   * Emergency cleanup - remove all but the most recent entries
   */
  private emergencyCleanup(): void {
    console.log("Performing emergency cache cleanup");

    // Check if we're in a browser environment with localStorage
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      return; // Skip cleanup on server side
    }

    try {
      const keys = this.getAllCacheKeys();
      const entries: Array<{
        key: string;
        entry: CacheEntry<T>;
        timestamp: number;
      }> = [];

      // Collect all entries with timestamps
      keys.forEach((key) => {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry: CacheEntry<T> = JSON.parse(cached);
            entries.push({ key, entry, timestamp: entry.timestamp });
          }
        } catch {
          // Remove corrupted entries
          localStorage.removeItem(key);
        }
      });

      // Sort by timestamp (newest first)
      entries.sort((a, b) => b.timestamp - a.timestamp);

      // Keep only the 3 most recent entries for this cache type
      const entriesToKeep = 3;
      for (let i = entriesToKeep; i < entries.length; i++) {
        this.removeCacheEntry(entries[i].key);
      }

      console.log(
        `Emergency cleanup: kept ${Math.min(
          entriesToKeep,
          entries.length
        )} entries, removed ${Math.max(0, entries.length - entriesToKeep)}`
      );
    } catch (error) {
      console.error("Error during emergency cleanup:", error);
    }
  }

  /**
   * Remove cache entry from both memory and localStorage
   */
  protected removeCacheEntry(cacheKey: string): void {
    try {
      // Always remove from memory cache
      this.memoryCache.delete(cacheKey);

      // Only try localStorage in browser environment
      if (
        typeof window !== "undefined" &&
        typeof localStorage !== "undefined"
      ) {
        localStorage.removeItem(cacheKey);
      }
    } catch (error) {
      console.error("Error removing cache entry:", error);
    }
  }

  /**
   * Get all cache keys for this manager
   */
  protected getAllCacheKeys(): string[] {
    // Check if we're in a browser environment with localStorage
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      return []; // Return empty array on server side
    }

    try {
      const keys = Object.keys(localStorage);
      return keys.filter((key) => key.startsWith(`${this.prefix}:`));
    } catch (error) {
      console.warn("Error accessing localStorage:", error);
      return [];
    }
  }

  /**
   * Store entry in memory cache only (for large items)
   */
  protected storeInMemoryOnly(cacheKey: string, entry: CacheEntry<T>): void {
    this.memoryCache.set(cacheKey, {
      entry,
      expiry: Date.now() + this.MEMORY_CACHE_TTL / 2, // Shorter TTL for memory-only items
    });
  }

  /**
   * Check if cache entry is still valid
   */
  private isEntryValid(entry: CacheEntry<T>, ttl: number): boolean {
    return Date.now() - entry.timestamp < ttl;
  }

  /**
   * Estimate the size of data in bytes when stored as JSON
   */
  protected estimateDataSize(data: T): number {
    try {
      const jsonString = JSON.stringify(data);
      return new Blob([jsonString]).size;
    } catch {
      try {
        // Fallback estimation using string length
        const jsonString = JSON.stringify(data);
        return jsonString.length * 2; // Rough estimate for UTF-16
      } catch {
        // If JSON.stringify fails, estimate based on object structure
        return this.roughSizeEstimate(data);
      }
    }
  }

  /**
   * Rough size estimate for complex objects when JSON.stringify fails
   */
  private roughSizeEstimate(obj: any): number {
    let bytes = 0;

    if (obj === null || obj === undefined) {
      return 4;
    }

    switch (typeof obj) {
      case "boolean":
        return 4;
      case "number":
        return 8;
      case "string":
        return obj.length * 2;
      case "object":
        if (Array.isArray(obj)) {
          bytes = 4; // Array overhead
          for (const item of obj) {
            bytes += this.roughSizeEstimate(item);
          }
        } else {
          bytes = 4; // Object overhead
          for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
              bytes += key.length * 2; // Key size
              bytes += this.roughSizeEstimate(obj[key]);
            }
          }
        }
        break;
      default:
        bytes = 8;
    }

    return bytes;
  }

  /**
   * Clean up cache if it's getting too large
   */
  private cleanupCacheIfNeeded(): void {
    try {
      const currentSize = this.getCurrentCacheSize();
      const threshold = this.MAX_CACHE_SIZE_BYTES * this.CLEANUP_THRESHOLD;

      if (currentSize > threshold) {
        console.log(
          `Cache size ${(currentSize / 1024 / 1024).toFixed(
            2
          )}MB exceeds threshold ${(threshold / 1024 / 1024).toFixed(
            2
          )}MB, cleaning up`
        );
        this.forceCacheCleanup(0.5); // Clean up to 50%
      }
    } catch (error) {
      console.error("Error during cleanup check:", error);
      // If we can't check size, do emergency cleanup to be safe
      this.emergencyCleanup();
    }
  }

  /**
   * Get current cache size in bytes
   */
  private getCurrentCacheSize(): number {
    // Check if we're in a browser environment with localStorage
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      return 0; // Return 0 on server side
    }

    let totalSize = 0;
    const keys = this.getAllCacheKeys();

    keys.forEach((key) => {
      try {
        const cached = localStorage.getItem(key);
        if (cached) {
          const entry: CacheEntry<T> = JSON.parse(cached);
          totalSize += entry.size || this.estimateDataSize(entry.data);
        }
      } catch {
        // Invalid entry, will be cleaned up later
      }
    });

    return totalSize;
  }

  /**
   * Force cleanup to target percentage of current cache
   */
  protected forceCacheCleanup(targetPercentage: number = 0.5): void {
    // Check if we're in a browser environment with localStorage
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      return; // Skip cleanup on server side
    }

    const keys = this.getAllCacheKeys();
    const entries: Array<{ key: string; entry: CacheEntry<T> }> = [];

    // Collect all valid entries
    keys.forEach((key) => {
      try {
        const cached = localStorage.getItem(key);
        if (cached) {
          const entry: CacheEntry<T> = JSON.parse(cached);
          entries.push({ key, entry });
        }
      } catch {
        // Remove invalid entries
        localStorage.removeItem(key);
      }
    });

    // Sort by last accessed time (oldest first)
    entries.sort((a, b) => a.entry.lastAccessed - b.entry.lastAccessed);

    // Remove oldest entries
    const entriesToRemove = Math.floor(entries.length * (1 - targetPercentage));
    for (let i = 0; i < entriesToRemove; i++) {
      this.removeCacheEntry(entries[i].key);
    }
  }

  /**
   * Get memory cache statistics
   */
  protected getMemoryCacheStats(): {
    count: number;
    sizeMB: number;
    keys: string[];
  } {
    let totalSize = 0;
    const keys: string[] = [];

    for (const [key, { entry }] of this.memoryCache.entries()) {
      keys.push(key);
      totalSize += entry.size || this.estimateDataSize(entry.data);
    }

    return {
      count: this.memoryCache.size,
      sizeMB: totalSize / 1024 / 1024,
      keys,
    };
  }

  /**
   * Clear all expired entries
   */
  clearExpiredCache(): void {
    // Check if we're in a browser environment with localStorage
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      return; // Skip cleanup on server side
    }

    const keys = this.getAllCacheKeys();
    let removedCount = 0;

    keys.forEach((key) => {
      try {
        const cached = localStorage.getItem(key);
        if (cached) {
          const entry: CacheEntry<T> = JSON.parse(cached);
          if (!this.isEntryValid(entry, this.ttl)) {
            this.removeCacheEntry(key);
            removedCount++;
          }
        }
      } catch {
        // Remove corrupted entries
        this.removeCacheEntry(key);
        removedCount++;
      }
    });

    if (removedCount > 0) {
      console.log(`Removed ${removedCount} expired cache entries`);
    }
  }

  /**
   * Clear all cache entries for this manager
   */
  clearCache(): void {
    const keys = this.getAllCacheKeys();
    keys.forEach((key) => {
      this.removeCacheEntry(key);
    });
    this.memoryCache.clear();
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredEntries(): void {
    const now = Date.now();

    // Clear expired memory cache
    for (const [key, value] of this.memoryCache.entries()) {
      if (now > value.expiry) {
        this.memoryCache.delete(key);
      }
    }

    // Clear expired localStorage entries
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      const keys = this.getAllCacheKeys();
      keys.forEach((key) => {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry: CacheEntry<T> = JSON.parse(cached);
            if (!this.isEntryValid(entry, this.ttl)) {
              localStorage.removeItem(key);
            }
          }
        } catch {
          // Invalid entry, remove it
          localStorage.removeItem(key);
        }
      });
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalEntries: number;
    memoryEntries: number;
    totalSizeMB: number;
    memorySizeMB: number;
    ttlSeconds: number;
  } {
    const memorySize = Array.from(this.memoryCache.values()).reduce(
      (sum, value) => sum + value.entry.size,
      0
    );

    const totalSize = this.getCurrentCacheSize();

    return {
      totalEntries: this.getAllCacheKeys().length,
      memoryEntries: this.memoryCache.size,
      totalSizeMB: totalSize / (1024 * 1024),
      memorySizeMB: memorySize / (1024 * 1024),
      ttlSeconds: this.ttl / 1000,
    };
  }
}
