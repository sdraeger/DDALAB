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
    
    // Set up periodic cleanup
    const cleanupInterval = setInterval(() => {
      plotCacheManager.clearExpiredCache();
    }, 60000); // Clean up every minute

    // Clean up on unmount
    return () => {
      clearInterval(cleanupInterval);
      logger.info("Plot cache management cleanup");
    };
  }, []);

  return {
    clearCache: plotCacheManager.clearFileCache.bind(plotCacheManager),
    clearExpiredCache: plotCacheManager.clearExpiredCache.bind(plotCacheManager),
    getCacheStats: plotCacheManager.getCacheStats.bind(plotCacheManager),
  };
} 