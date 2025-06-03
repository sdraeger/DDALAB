import { apolloCache } from "./apollo-client";
import logger from "./logger";

// Types for cache entries
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  key: string;
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

  private constructor() {}

  static getInstance(): PlotCacheManager {
    if (!PlotCacheManager.instance) {
      PlotCacheManager.instance = new PlotCacheManager();
    }
    return PlotCacheManager.instance;
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
   * Check if a cache entry is still valid
   */
  private isEntryValid(entry: CacheEntry<any>, ttl: number): boolean {
    const now = Date.now();
    return (now - entry.timestamp) < ttl;
  }

  /**
   * Get cached plot data if available and valid
   */
  getCachedPlotData(key: PlotCacheKey): any | null {
    try {
      const cacheKey = this.generatePlotCacheKey(key);
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
        const entry: CacheEntry<any> = JSON.parse(cached);
        if (this.isEntryValid(entry, this.DEFAULT_TTL)) {
          logger.info(`Cache hit for plot data: ${cacheKey}`);
          return entry.data;
        } else {
          logger.info(`Cache expired for plot data: ${cacheKey}`);
          localStorage.removeItem(cacheKey);
        }
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
      const cacheKey = this.generatePlotCacheKey(key);
      const entry: CacheEntry<any> = {
        data,
        timestamp: Date.now(),
        key: cacheKey,
      };
      
      localStorage.setItem(cacheKey, JSON.stringify(entry));
      logger.info(`Cached plot data: ${cacheKey}`);
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
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
        const entry: CacheEntry<any> = JSON.parse(cached);
        if (this.isEntryValid(entry, this.HEATMAP_TTL)) {
          logger.info(`Cache hit for heatmap data: ${cacheKey}`);
          return entry.data;
        } else {
          logger.info(`Cache expired for heatmap data: ${cacheKey}`);
          localStorage.removeItem(cacheKey);
        }
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
      const cacheKey = this.generateHeatmapCacheKey(key);
      const entry: CacheEntry<any> = {
        data,
        timestamp: Date.now(),
        key: cacheKey,
      };
      
      localStorage.setItem(cacheKey, JSON.stringify(entry));
      logger.info(`Cached heatmap data: ${cacheKey}`);
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
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
        const entry: CacheEntry<any> = JSON.parse(cached);
        if (this.isEntryValid(entry, this.ANNOTATION_TTL)) {
          logger.info(`Cache hit for annotations: ${cacheKey}`);
          return entry.data;
        } else {
          logger.info(`Cache expired for annotations: ${cacheKey}`);
          localStorage.removeItem(cacheKey);
        }
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
      const cacheKey = this.generateAnnotationCacheKey(filePath);
      const entry: CacheEntry<any> = {
        data,
        timestamp: Date.now(),
        key: cacheKey,
      };
      
      localStorage.setItem(cacheKey, JSON.stringify(entry));
      logger.info(`Cached annotations: ${cacheKey}`);
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
      const fileKeys = keys.filter(key => 
        key.includes(filePath) && 
        (key.startsWith("plot:") || key.startsWith("heatmap:") || key.startsWith("annotations:"))
      );
      
      fileKeys.forEach(key => {
        localStorage.removeItem(key);
        logger.info(`Cleared cache key: ${key}`);
      });
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
      const cacheKeys = keys.filter(key => 
        key.startsWith("plot:") || key.startsWith("heatmap:") || key.startsWith("annotations:")
      );
      
      cacheKeys.forEach(key => {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry: CacheEntry<any> = JSON.parse(cached);
            const ttl = key.startsWith("plot:") ? this.DEFAULT_TTL : 
                      key.startsWith("annotations:") ? this.ANNOTATION_TTL : 
                      this.HEATMAP_TTL;
            
            if (!this.isEntryValid(entry, ttl)) {
              localStorage.removeItem(key);
              logger.info(`Cleared expired cache key: ${key}`);
            }
          }
        } catch (error) {
          // Invalid cache entry, remove it
          localStorage.removeItem(key);
          logger.warn(`Removed invalid cache key: ${key}`);
        }
      });
    } catch (error) {
      logger.error("Error clearing expired cache:", error);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { plotCount: number; heatmapCount: number; annotationCount: number } {
    try {
      const keys = Object.keys(localStorage);
      const plotCount = keys.filter(key => key.startsWith("plot:")).length;
      const heatmapCount = keys.filter(key => key.startsWith("heatmap:")).length;
      const annotationCount = keys.filter(key => key.startsWith("annotations:")).length;
      
      return { plotCount, heatmapCount, annotationCount };
    } catch (error) {
      logger.error("Error getting cache stats:", error);
      return { plotCount: 0, heatmapCount: 0, annotationCount: 0 };
    }
  }
}

// Export singleton instance
export const plotCacheManager = PlotCacheManager.getInstance();

// Export types for use in other modules
export type { PlotCacheKey, HeatmapCacheKey }; 