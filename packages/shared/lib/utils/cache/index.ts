import { PlotDataCacheManager, PlotCacheKey } from "./plotDataCache";
import { HeatmapCacheManager, HeatmapCacheKey } from "./heatmapCache";
import { AnnotationCacheManager } from "./annotationCache";

/**
 * Unified cache manager that coordinates specialized cache managers
 */
class UnifiedCacheManager {
  private static instance: UnifiedCacheManager;

  private plotCache: PlotDataCacheManager;
  private heatmapCache: HeatmapCacheManager;
  private annotationCache: AnnotationCacheManager;

  private constructor() {
    this.plotCache = PlotDataCacheManager.getInstance();
    this.heatmapCache = HeatmapCacheManager.getInstance();
    this.annotationCache = AnnotationCacheManager.getInstance();

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

  // Plot data methods
  getCachedPlotData(key: PlotCacheKey): any | null {
    return this.plotCache.getCachedPlotData(key);
  }

  cachePlotData(key: PlotCacheKey, data: any): void {
    this.plotCache.cachePlotData(key, data);
  }

  // Heatmap data methods
  getCachedHeatmapData(key: HeatmapCacheKey): any | null {
    return this.heatmapCache.getCachedHeatmapData(key);
  }

  cacheHeatmapData(key: HeatmapCacheKey, data: any): void {
    this.heatmapCache.cacheHeatmapData(key, data);
  }

  // Annotation methods
  getCachedAnnotations(filePath: string): any | null {
    return this.annotationCache.getCachedAnnotations(filePath);
  }

  cacheAnnotations(filePath: string, data: any): void {
    this.annotationCache.cacheAnnotations(filePath, data);
  }

  // File-specific cleanup
  clearFileCache(filePath: string): void {
    this.plotCache.clearFileCache(filePath);
    this.heatmapCache.clearFileCache(filePath);
    this.annotationCache.clearFileCache(filePath);
  }

  // Global cleanup
  clearExpiredCache(): void {
    this.plotCache.clearExpiredCache();
    this.heatmapCache.clearExpiredCache();
    this.annotationCache.clearExpiredCache();
  }

  // Clear memory cache (if available in individual managers)
  clearMemoryCache(): void {
    // Individual cache managers would need to implement this
    console.log(
      "clearMemoryCache called on UnifiedCacheManager - not implemented"
    );
  }

  // Cache statistics - get stats from actual cache managers
  getCacheStats() {
    console.log("UnifiedCacheManager getCacheStats called");

    // Get stats from PlotDataCacheManager (which now has getCacheStats method)
    const plotStats = this.plotCache.getCacheStats();

    // For heatmap and annotation counts, use CacheUtils as fallback
    const cacheUtilsStats = require("./cacheUtils").CacheUtils.getCacheStats();

    console.log("Plot cache stats:", plotStats);
    console.log("CacheUtils stats:", cacheUtilsStats);

    return {
      plotCount: plotStats.plotCount,
      heatmapCount: cacheUtilsStats.heatmapCount,
      annotationCount: cacheUtilsStats.annotationCount,
      totalSizeMB:
        plotStats.totalSizeMB +
        (cacheUtilsStats.totalSizeMB - plotStats.totalSizeMB), // Avoid double counting
      totalSizeBytes:
        plotStats.totalSizeBytes +
        (cacheUtilsStats.totalSize - plotStats.totalSizeBytes),
      memoryPlotCount: plotStats.memoryPlotCount,
      memoryHeatmapCount: 0, // TODO: implement in HeatmapCacheManager
      memoryAnnotationCount: 0, // TODO: implement in AnnotationCacheManager
      memorySizeMB: plotStats.memorySizeMB,
    };
  }
}

// Export singleton instance
export const plotCacheManager = UnifiedCacheManager.getInstance();

// Export utilities
export { CacheUtils } from "./cacheUtils";

// Export types for external use
export type { PlotCacheKey, HeatmapCacheKey };
