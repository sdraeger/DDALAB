import { useEffect } from "react";
import { plotCacheManager } from "../lib/utils/plotCache";
import logger from "../lib/utils/logger";

/**
 * Hook to manage plot cache lifecycle
 */
export function usePlotCache() {
  useEffect(() => {
    // Initialize cache cleanup on mount
    logger.info("Initializing plot cache management");

    // Clear expired cache entries on initialization
    plotCacheManager.clearExpiredCache();

    // Check cache size and clean up if needed
    const stats = plotCacheManager.getCacheStats();
    logger.info(
      `Initial cache stats: ${stats.plotCount} plots, ${stats.heatmapCount} heatmaps, ${stats.annotationCount} annotations (${stats.totalSizeMB}MB)`
    );

    // Set up periodic cleanup - every 2 minutes
    const cleanupInterval = setInterval(() => {
      // Clear expired entries first
      plotCacheManager.clearExpiredCache();

      // Log current cache status
      const currentStats = plotCacheManager.getCacheStats();
      logger.info(`Cache status: ${currentStats.totalSizeMB}MB used`);

      // If cache is getting large, log a warning
      if (currentStats.totalSizeMB > 3) {
        logger.warn(
          `Cache size is getting large: ${currentStats.totalSizeMB}MB`
        );
      }
    }, 120000); // Clean up every 2 minutes

    // Clean up on unmount
    return () => {
      clearInterval(cleanupInterval);
      logger.info("Plot cache management cleanup");
    };
  }, []);

  return {
    clearCache: plotCacheManager.clearFileCache.bind(plotCacheManager),
    clearExpiredCache:
      plotCacheManager.clearExpiredCache.bind(plotCacheManager),
    getCacheStats: plotCacheManager.getCacheStats.bind(plotCacheManager),
    forceCacheCleanup:
      plotCacheManager.forceCacheCleanup.bind(plotCacheManager),
  };
}
