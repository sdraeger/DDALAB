import { PlotDataCacheManager, PlotCacheKey } from "./plotDataCache";
import { HeatmapCacheManager, HeatmapCacheKey } from "./heatmapCache";
import { AnnotationCacheManager } from "./annotationCache";
import {
  WidgetLayoutCacheManager,
  WidgetLayoutData,
} from "./widgetLayoutCache";

/**
 * Unified cache manager that coordinates specialized cache managers
 */
class UnifiedCacheManager {
  private static instance: UnifiedCacheManager;

  private plotCache: PlotDataCacheManager;
  private heatmapCache: HeatmapCacheManager;
  private annotationCache: AnnotationCacheManager;
  private widgetLayoutCache: WidgetLayoutCacheManager;

  private constructor() {
    this.plotCache = PlotDataCacheManager.getInstance();
    this.heatmapCache = HeatmapCacheManager.getInstance();
    this.annotationCache = AnnotationCacheManager.getInstance();
    this.widgetLayoutCache = WidgetLayoutCacheManager.getInstance();

    // Set up periodic cleanup for all cache managers only in browser environment
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      setInterval(() => {
        this.clearExpiredCache();
      }, 60000); // Clean up every minute
    }
  }

  static getInstance(): UnifiedCacheManager {
    if (!UnifiedCacheManager.instance) {
      UnifiedCacheManager.instance = new UnifiedCacheManager();
    }
    return UnifiedCacheManager.instance;
  }

  // Plot cache methods
  getCachedPlotData(key: PlotCacheKey) {
    return this.plotCache.getCachedPlotData(key);
  }

  cachePlotData(key: PlotCacheKey, data: any) {
    return this.plotCache.cachePlotData(key, data);
  }

  clearPlotCache() {
    return this.plotCache.clearCache();
  }

  clearPlotFileCache(filePath: string) {
    return this.plotCache.clearFileCache(filePath);
  }

  // Heatmap cache methods
  getCachedHeatmapData(key: HeatmapCacheKey) {
    return this.heatmapCache.getCachedHeatmapData(key);
  }

  cacheHeatmapData(key: HeatmapCacheKey, data: any) {
    return this.heatmapCache.cacheHeatmapData(key, data);
  }

  clearHeatmapCache() {
    return this.heatmapCache.clearCache();
  }

  clearHeatmapFileCache(filePath: string) {
    return this.heatmapCache.clearFileCache(filePath);
  }

  // Annotation cache methods
  getCachedAnnotations(filePath: string) {
    return this.annotationCache.getCachedAnnotations(filePath);
  }

  cacheAnnotations(filePath: string, data: any) {
    return this.annotationCache.cacheAnnotations(filePath, data);
  }

  clearAnnotationCache() {
    return this.annotationCache.clearCache();
  }

  clearAnnotationFileCache(filePath: string) {
    return this.annotationCache.clearFileCache(filePath);
  }

  // Widget layout cache methods
  getCachedWidgetLayout(userId: string): WidgetLayoutData[] | null {
    return this.widgetLayoutCache.getCachedLayout(userId);
  }

  cacheWidgetLayout(userId: string, widgets: WidgetLayoutData[]) {
    return this.widgetLayoutCache.cacheLayout(userId, widgets);
  }

  clearWidgetLayoutCache() {
    return this.widgetLayoutCache.clearCache();
  }

  clearUserWidgetLayoutCache(userId: string) {
    return this.widgetLayoutCache.clearUserCache(userId);
  }

  // Clear specific file caches across all cache types
  clearFileCache(filePath: string) {
    this.clearPlotFileCache(filePath);
    this.clearHeatmapFileCache(filePath);
    this.clearAnnotationFileCache(filePath);
  }

  // Clear expired cache entries across all cache types
  clearExpiredCache() {
    try {
      this.plotCache.clearExpiredEntries();
      this.heatmapCache.clearExpiredEntries();
      this.annotationCache.clearExpiredEntries();
      this.widgetLayoutCache.clearExpiredEntries();
    } catch (error) {
      console.warn("Error during cache cleanup:", error);
    }
  }

  // Clear all caches
  clearAllCache() {
    this.clearPlotCache();
    this.clearHeatmapCache();
    this.clearAnnotationCache();
    this.clearWidgetLayoutCache();
  }

  // Get cache statistics
  getCacheStats() {
    return {
      plot: this.plotCache.getCacheStats(),
      heatmap: this.heatmapCache.getCacheStats(),
      annotation: this.annotationCache.getCacheStats(),
      widgetLayout: this.widgetLayoutCache.getCacheStats(),
    };
  }
}

// Export the unified cache manager instance
export const cacheManager = UnifiedCacheManager.getInstance();

// Export individual cache managers for direct access if needed
export {
  PlotDataCacheManager,
  HeatmapCacheManager,
  AnnotationCacheManager,
  WidgetLayoutCacheManager,
};

// Export types
export type { PlotCacheKey, HeatmapCacheKey, WidgetLayoutData };
