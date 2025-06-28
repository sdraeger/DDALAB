import { BaseCacheManager, CacheEntry } from "./baseCacheManager";
import logger from "../logger";

export interface WidgetLayoutData {
  id: string;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
  isPopOut?: boolean;
  type?: string;
}

export class WidgetLayoutCacheManager extends BaseCacheManager<
  WidgetLayoutData[]
> {
  private static instance: WidgetLayoutCacheManager;

  private constructor() {
    super("widget-layout", 30 * 60 * 1000); // 30 minutes TTL
  }

  static getInstance(): WidgetLayoutCacheManager {
    if (!WidgetLayoutCacheManager.instance) {
      WidgetLayoutCacheManager.instance = new WidgetLayoutCacheManager();
    }
    return WidgetLayoutCacheManager.instance;
  }

  /**
   * Generate a cache key for user's widget layout
   */
  generateCacheKey(userId: string): string {
    return `${this.prefix}:user:${userId}`;
  }

  /**
   * Get cached widget layout for a user
   */
  getCachedLayout(userId: string): WidgetLayoutData[] | null {
    const cacheKey = this.generateCacheKey(userId);
    const entry = this.getCacheEntry(cacheKey, this.ttl);

    if (entry) {
      logger.info("Cache hit for widget layout:", userId);
      return entry.data;
    }

    return null;
  }

  /**
   * Cache widget layout for a user
   */
  cacheLayout(userId: string, widgets: WidgetLayoutData[]): void {
    const cacheKey = this.generateCacheKey(userId);
    const entry: CacheEntry<WidgetLayoutData[]> = {
      data: widgets,
      timestamp: Date.now(),
      key: cacheKey,
      lastAccessed: Date.now(),
      size: this.estimateDataSize(widgets),
    };

    this.setCacheEntry(cacheKey, entry);
    logger.info(
      `Cached widget layout for user ${userId} with ${widgets.length} widgets`
    );
  }

  /**
   * Clear cache for a specific user
   */
  clearUserCache(userId: string): void {
    const cacheKey = this.generateCacheKey(userId);
    this.removeCacheEntry(cacheKey);
    logger.info(`Cleared widget layout cache for user: ${userId}`);
  }

  /**
   * Invalidate and refresh cache for a user
   */
  invalidateUserCache(userId: string): void {
    this.clearUserCache(userId);
    logger.info(`Invalidated widget layout cache for user: ${userId}`);
  }
}
