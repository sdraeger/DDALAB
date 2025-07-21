import { useCallback, useEffect, useRef, useState } from "react";
import logger from "../lib/utils/logger";
import { plotCacheService, PlotParams } from "../lib/utils/plotCacheService";

interface CachedPlotCheckParams {
  filePath: string;
  chunkStart: number;
  chunkSize: number;
  preprocessingOptions?: Record<string, any>;
  selectedChannels?: string[];
  timeWindow?: [number, number];
  zoomLevel?: number;
}

interface CachedPlotCheckResult {
  isChecking: boolean;
  hasCachedPlot: boolean;
  cachedPlotData: any | null;
  error: string | null;
}

const MAX_REQUESTS_PER_PARAMS = 3;

export function useCachedPlotCheck(
  params: CachedPlotCheckParams | null
): CachedPlotCheckResult {
  const [isChecking, setIsChecking] = useState(false);
  const [hasCachedPlot, setHasCachedPlot] = useState(false);
  const [cachedPlotData, setCachedPlotData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCheckingRef = useRef(false);
  const lastRequestRef = useRef<string>("");
  const requestCountRef = useRef(0);
  const lastParamsRef = useRef<string>("");

  const checkCachedPlot = useCallback(async () => {
    if (!params) {
      logger.debug(
        "[useCachedPlotCheck] No params provided, skipping cache check"
      );
      return;
    }

    // Create a unique request key for duplicate detection
    const requestKey = JSON.stringify({
      filePath: params.filePath,
      chunkStart: params.chunkStart,
      chunkSize: params.chunkSize,
      preprocessingOptions: params.preprocessingOptions,
      selectedChannels: params.selectedChannels,
      timeWindow: params.timeWindow,
      zoomLevel: params.zoomLevel,
    });

    // Check if this is a duplicate request
    if (lastRequestRef.current === requestKey && isCheckingRef.current) {
      logger.debug(
        `[useCachedPlotCheck] Skipping duplicate cache check request: ${requestKey}`
      );
      return;
    }

    // Check if we've exceeded the maximum requests for these params
    if (lastRequestRef.current === requestKey) {
      requestCountRef.current++;
      if (requestCountRef.current > MAX_REQUESTS_PER_PARAMS) {
        logger.warn(
          `[useCachedPlotCheck] Maximum requests exceeded for params: ${requestKey}`
        );
        return;
      }
    } else {
      requestCountRef.current = 1;
    }

    // Check if params have actually changed
    if (lastParamsRef.current === requestKey) {
      logger.debug(
        `[useCachedPlotCheck] Params unchanged, skipping cache check: ${requestKey}`
      );
      return;
    }

    lastRequestRef.current = requestKey;
    lastParamsRef.current = requestKey;
    isCheckingRef.current = true;
    setIsChecking(true);
    setError(null);

    try {
      logger.debug(
        `[useCachedPlotCheck] Checking for cached plot: ${requestKey}`
      );

      // Convert params to the format expected by the Redis service
      const plotParams: PlotParams = {
        chunk_start: params.chunkStart,
        chunk_size: params.chunkSize,
        preprocessing_options: params.preprocessingOptions,
        selected_channels: params.selectedChannels,
        time_window: params.timeWindow,
        zoom_level: params.zoomLevel,
      };

      // Check if cached plot exists using the Redis service
      const response = await plotCacheService.getCachedPlot({
        file_path: params.filePath,
        plot_params: plotParams,
      });

      if (response.success && response.plot_data) {
        logger.info(
          `[useCachedPlotCheck] Found cached plot for: ${params.filePath}`
        );
        setHasCachedPlot(true);
        setCachedPlotData(response.plot_data);
      } else {
        logger.debug(
          `[useCachedPlotCheck] No cached plot found for: ${params.filePath}`
        );
        setHasCachedPlot(false);
        setCachedPlotData(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      logger.error(
        `[useCachedPlotCheck] Error checking cached plot: ${errorMessage}`
      );
      setError(errorMessage);
      setHasCachedPlot(false);
      setCachedPlotData(null);
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  }, [params]);

  useEffect(() => {
    if (params) {
      checkCachedPlot();
    }
  }, [checkCachedPlot]);

  return {
    isChecking,
    hasCachedPlot,
    cachedPlotData,
    error,
  };
}
