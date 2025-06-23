import { BaseCacheManager, CacheEntry } from "./baseCacheManager";
import logger from "../logger";

export class AnnotationCacheManager extends BaseCacheManager<any> {
  private static instance: AnnotationCacheManager;

  private constructor() {
    super("annotations", 10 * 60 * 1000); // 10 minutes TTL
  }

  static getInstance(): AnnotationCacheManager {
    if (!AnnotationCacheManager.instance) {
      AnnotationCacheManager.instance = new AnnotationCacheManager();
    }
    return AnnotationCacheManager.instance;
  }

  /**
   * Generate a cache key for annotations
   */
  generateCacheKey(filePath: string): string {
    return `${this.prefix}:${filePath}`;
  }

  /**
   * Get cached annotations
   */
  getCachedAnnotations(filePath: string): any | null {
    const cacheKey = this.generateCacheKey(filePath);
    const entry = this.getCacheEntry(cacheKey, this.ttl);

    if (entry) {
      logger.info("Cache hit for annotations:", filePath);
      return entry.data;
    }

    return null;
  }

  /**
   * Cache annotations
   */
  cacheAnnotations(filePath: string, data: any): void {
    const cacheKey = this.generateCacheKey(filePath);
    const entry: CacheEntry<any> = {
      data,
      timestamp: Date.now(),
      key: cacheKey,
      lastAccessed: Date.now(),
      size: this.estimateDataSize(data),
    };

    this.setCacheEntry(cacheKey, entry);
    logger.info("Cached annotations:", filePath);
  }

  /**
   * Clear cache for a specific file
   */
  clearFileCache(filePath: string): void {
    const cacheKey = this.generateCacheKey(filePath);
    this.removeCacheEntry(cacheKey);
    logger.info(`Cleared annotation cache for file: ${filePath}`);
  }
}
