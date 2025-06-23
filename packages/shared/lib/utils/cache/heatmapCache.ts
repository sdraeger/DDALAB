import { BaseCacheManager, CacheEntry } from "./baseCacheManager";
import logger from "../logger";

export interface HeatmapCacheKey {
  filePath: string;
  taskId?: string;
  Q?: any;
}

export class HeatmapCacheManager extends BaseCacheManager<any> {
  private static instance: HeatmapCacheManager;

  private constructor() {
    super("heatmap", 10 * 60 * 1000); // 10 minutes TTL
  }

  static getInstance(): HeatmapCacheManager {
    if (!HeatmapCacheManager.instance) {
      HeatmapCacheManager.instance = new HeatmapCacheManager();
    }
    return HeatmapCacheManager.instance;
  }

  /**
   * Generate a cache key for heatmap data
   */
  generateCacheKey(key: HeatmapCacheKey): string {
    const taskKey = key.taskId || "default";
    const qKey = key.Q ? JSON.stringify(key.Q) : "none";
    return `${this.prefix}:${key.filePath}:${taskKey}:${qKey}`;
  }

  /**
   * Get cached heatmap data
   */
  getCachedHeatmapData(key: HeatmapCacheKey): any | null {
    const cacheKey = this.generateCacheKey(key);
    const entry = this.getCacheEntry(cacheKey, this.ttl);

    if (entry) {
      logger.info("Cache hit for heatmap data:", key.filePath);
      return entry.data;
    }

    return null;
  }

  /**
   * Cache heatmap data
   */
  cacheHeatmapData(key: HeatmapCacheKey, data: any): void {
    const cacheKey = this.generateCacheKey(key);
    const entry: CacheEntry<any> = {
      data,
      timestamp: Date.now(),
      key: cacheKey,
      lastAccessed: Date.now(),
      size: this.estimateDataSize(data),
    };

    this.setCacheEntry(cacheKey, entry);
    logger.info("Cached heatmap data:", key.filePath);
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

    logger.info(`Cleared heatmap cache for file: ${filePath}`);
  }
}
