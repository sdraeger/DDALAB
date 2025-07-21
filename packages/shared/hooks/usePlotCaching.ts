import { useCallback, useEffect, useRef } from "react";
import { useAppSelector } from "../store";
import { plotCacheService, PlotParams } from "../lib/utils/plotCacheService";
import logger from "../lib/utils/logger";

interface UsePlotCachingOptions {
  enabled?: boolean;
  ttl?: number;
}

/**
 * Hook to automatically cache plots when they are generated
 */
export function usePlotCaching(options: UsePlotCachingOptions = {}) {
  const { enabled = true, ttl } = options;
  const plots = useAppSelector((state) => state.plots);
  const lastCachedRef = useRef<Set<string>>(new Set());

  const cachePlot = useCallback(
    async (filePath: string, plotData: any, plotParams: PlotParams) => {
      if (!enabled) {
        logger.debug("[usePlotCaching] Caching disabled, skipping");
        return;
      }

      try {
        const cacheKey = `${filePath}_${plotParams.chunk_start}_${plotParams.chunk_size}`;

        // Check if we've already cached this plot
        if (lastCachedRef.current.has(cacheKey)) {
          logger.debug(`[usePlotCaching] Plot already cached: ${cacheKey}`);
          return;
        }

        logger.info(`[usePlotCaching] Caching plot for: ${filePath}`);
        logger.debug(`[usePlotCaching] Cache details:`, {
          filePath,
          plotParams,
          plotDataKeys: Object.keys(plotData || {}),
          ttl,
        });

        const response = await plotCacheService.cachePlot({
          file_path: filePath,
          plot_params: plotParams,
          plot_data: plotData,
          ttl,
        });

        if (response.success) {
          logger.info(`[usePlotCaching] Successfully cached plot: ${cacheKey}`);
          lastCachedRef.current.add(cacheKey);
        } else {
          logger.error(
            `[usePlotCaching] Failed to cache plot: ${response.message}`
          );
        }
      } catch (error) {
        logger.error(`[usePlotCaching] Error caching plot:`, error);
      }
    },
    [enabled, ttl]
  );

  // Monitor plots and cache new ones
  useEffect(() => {
    if (!enabled || !plots) return;

    logger.debug(
      `[usePlotCaching] Monitoring ${
        Object.keys(plots).length
      } plots for caching`
    );

    Object.entries(plots).forEach(([plotKey, plotState]) => {
      if (!plotState || !plotState.metadata || !plotState.edfData) {
        logger.debug(
          `[usePlotCaching] Skipping plot ${plotKey} - missing metadata or edfData`
        );
        return;
      }

      // Check if this plot should be cached
      const shouldCache =
        plotState.metadata &&
        plotState.edfData &&
        plotState.chunkStart !== undefined &&
        plotState.chunkSizeSeconds !== undefined;

      if (shouldCache) {
        logger.debug(`[usePlotCaching] Plot ${plotKey} should be cached`);

        const plotParams: PlotParams = {
          chunk_start: plotState.chunkStart,
          chunk_size: Math.round(
            plotState.chunkSizeSeconds *
              (plotState.metadata.sampling_rate || 256)
          ),
          preprocessing_options: plotState.preprocessingOptions,
          selected_channels: plotState.selectedChannels,
          time_window: plotState.timeWindow,
          zoom_level: plotState.zoomLevel,
        };

        const plotData = {
          metadata: plotState.metadata,
          edfData: plotState.edfData,
          chunkStart: plotState.chunkStart,
          chunkSizeSeconds: plotState.chunkSizeSeconds,
          preprocessingOptions: plotState.preprocessingOptions,
          selectedChannels: plotState.selectedChannels,
          timeWindow: plotState.timeWindow,
          zoomLevel: plotState.zoomLevel,
        };

        // Extract file path from plot key or use a fallback
        const filePath = plotKey.includes("_")
          ? plotKey.split("_")[0]
          : plotKey;

        logger.debug(
          `[usePlotCaching] Caching plot ${plotKey} for file ${filePath}`
        );
        cachePlot(filePath, plotData, plotParams);
      } else {
        logger.debug(
          `[usePlotCaching] Plot ${plotKey} should not be cached - missing required data`
        );
      }
    });
  }, [plots, enabled, cachePlot]);

  return {
    cachePlot,
  };
}
