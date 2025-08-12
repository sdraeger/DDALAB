"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";

import { Alert, AlertDescription } from "../../ui/alert";
import { EEGChart2 } from "../../plot/EEGChart2";
import { useWidgetState } from "../../../hooks/useWidgetState";
import { useWidgetDataSync } from "../../../hooks/useWidgetDataSync";
import { usePopoutAuth } from "../../../hooks/usePopoutAuth";
import { useCachedPlotCheck } from "../../../hooks/useCachedPlotCheck";
import { useAppSelector, useAppDispatch } from "../../../store";
import logger from "../../../lib/utils/logger";
import type { EEGData } from "../../../types/EEGData";
import type { PlotsState } from "../../../store/slices/plotSlice";
import { plotCacheService } from "../../../lib/utils/plotCacheService";
import {
  ensurePlotState,
  setSelectedChannels,
  setTimeWindow,
  setZoomLevel,
  setPlotPreprocessingOptions,
} from "../../../store/slices/plotSlice";
import { Skeleton } from "../../ui/skeleton";
import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-react";
import "uplot/dist/uPlot.min.css";
import { Button } from "../../ui/button";
import { useCurrentEdfFile } from "../../../hooks/useCurrentEdfFile";
import { useChunkNavigation } from "../../../hooks/useChunkNavigation";
import { useUnifiedSessionData } from "../../../hooks/useUnifiedSession";
import {
  DEFAULT_TIME_WINDOW,
  DEFAULT_ZOOM_LEVEL,
  DEFAULT_SELECTED_CHANNELS,
} from "../../../lib/utils/plotDefaults";
import { ChannelSelectorUI } from "../../ui/ChannelSelectorUI";

interface ChartWidgetProps {
  // Props for popout mode - when provided, these override Redux state
  widgetId?: string;
  isPopout?: boolean;
  popoutPlotState?: {
    edfData?: EEGData;
    selectedChannels?: string[];
    timeWindow?: [number, number];
    zoomLevel?: number;
  };
}

export function ChartWidget({
  widgetId = "chart-widget-default",
  isPopout = false,
  popoutPlotState,
}: ChartWidgetProps) {
  // Get plot state from Redux (main window) or sync (popout)
  const plots = useAppSelector((state) => state.plots);
  const dispatch = useAppDispatch();
  const { registerDataListener, unregisterDataListener, syncData } =
    useWidgetDataSync(widgetId, isPopout);

  // Use popout authentication hook
  const { isAuthenticated } = usePopoutAuth({
    widgetId,
    isPopout,
  });

  // Widget state for UI preferences
  const { state: chartState, updateState: setChartState } = useWidgetState(
    widgetId,
    {
      timeWindow: DEFAULT_TIME_WINDOW,
      zoomLevel: DEFAULT_ZOOM_LEVEL,
      selectedChannels: DEFAULT_SELECTED_CHANNELS,
    },
    isPopout
  );

  // Track initialization
  const initializationAttempted = useRef(false);
  const dataRequestedRef = useRef(false);
  const channelsInitialized = useRef(false);

  // Effect for handling plot data synchronization in popout mode
  useEffect(() => {
    if (isPopout) {
      logger.info(`[ChartWidget] Setting up plot data sync:`, {
        widgetId,
        hasPopoutState: !!popoutPlotState,
        hasInitialPlots: !!plots,
      });

      // Register data listener for plot updates
      registerDataListener("plots", (plotsData: PlotsState) => {
        logger.info(`[ChartWidget] Received plots data:`, {
          widgetId,
          hasData: !!plotsData,
          plotKeys: Object.keys(plotsData),
          hasEdfData: !!Object.values(plotsData)[0]?.edfData?.data,
        });

        // Validate received data
        const isValidPlotData = Object.values(plotsData).some(
          (plot) =>
            plot?.edfData?.data &&
            Array.isArray(plot.edfData.data) &&
            plot.edfData.data.length > 0
        );

        if (isValidPlotData) {
          logger.debug(`[ChartWidget] Valid plots data received`);
        } else {
          logger.warn(`[ChartWidget] Invalid plot data received:`, {
            widgetId,
            dataKeys: Object.keys(plotsData),
          });
        }
      });

      // Request initial data if not already received
      if (!dataRequestedRef.current) {
        logger.info(`[ChartWidget] Requesting initial plot data:`, {
          widgetId,
        });
        syncData("plots", null);
        dataRequestedRef.current = true;
      }

      return () => {
        unregisterDataListener("plots");
      };
    }
  }, [
    isPopout,
    widgetId,
    registerDataListener,
    unregisterDataListener,
    syncData,
  ]);

  // Initialize chart state from popout state if provided
  useEffect(() => {
    if (isPopout && popoutPlotState && !initializationAttempted.current) {
      logger.info(`[ChartWidget] Initializing from popout state:`, {
        widgetId,
        hasEdfData: !!popoutPlotState.edfData,
        hasSelectedChannels: !!popoutPlotState.selectedChannels,
        hasTimeWindow: !!popoutPlotState.timeWindow,
      });

      // Set initial chart state
      if (popoutPlotState.selectedChannels) {
        setChartState({ selectedChannels: popoutPlotState.selectedChannels });
      }
      if (popoutPlotState.timeWindow) {
        setChartState({ timeWindow: popoutPlotState.timeWindow });
      }
      if (popoutPlotState.zoomLevel) {
        setChartState({ zoomLevel: popoutPlotState.zoomLevel });
      }

      // Request full data from main window
      if (!dataRequestedRef.current) {
        logger.info(`[ChartWidget] Requesting full plot data:`, { widgetId });
        syncData("plots", null);
        dataRequestedRef.current = true;
      }

      initializationAttempted.current = true;
    }
  }, [isPopout, popoutPlotState, widgetId, setChartState, syncData]);

  // Get the current plot state based on whether we're in popout mode
  const currentPlots = plots;

  // Debug log for currentPlots structure
  console.log("[ChartWidget] currentPlots:", currentPlots);
  console.log(
    "[ChartWidget] currentPlots.byFilePath:",
    currentPlots?.byFilePath
  );

  // Debug the actual plot state content
  if (currentPlots?.currentFilePath && currentPlots?.byFilePath) {
    const currentPlot = currentPlots.byFilePath[currentPlots.currentFilePath];
    console.log("[ChartWidget] Current plot state details:", {
      filePath: currentPlots.currentFilePath,
      hasPlotState: !!currentPlot,
      plotStateKeys: currentPlot ? Object.keys(currentPlot) : null,
      hasEdfData: !!currentPlot?.edfData,
      edfDataKeys: currentPlot?.edfData
        ? Object.keys(currentPlot.edfData)
        : null,
      hasMetadata: !!currentPlot?.metadata,
      metadataKeys: currentPlot?.metadata
        ? Object.keys(currentPlot.metadata)
        : null,
      isLoading: currentPlot?.isLoading,
      error: currentPlot?.error,
      selectedChannels: currentPlot?.selectedChannels,
      selectedChannelsLength: currentPlot?.selectedChannels?.length,
    });
  }

  const {
    currentFilePath,
    currentPlotState,
    currentEdfData,
    currentChunkMetadata,
    selectFile,
    selectChannels,
  } = useCurrentEdfFile();

  // Local UI toggles for controls
  const [showChannelSelector, setShowChannelSelector] = useState(false);
  const [showPreprocessing, setShowPreprocessing] = useState(false);

  // Handlers: channel selection
  const handleToggleChannel = useCallback(
    (channel: string) => {
      if (!currentFilePath || !memoizedPlotState?.edfData?.channels) return;
      const alreadySelected = chartState.selectedChannels.includes(channel);
      const newSelection = alreadySelected
        ? chartState.selectedChannels.filter((c) => c !== channel)
        : [...chartState.selectedChannels, channel];
      setChartState((prev) => ({ ...prev, selectedChannels: newSelection }));
      dispatch(
        setSelectedChannels({ filePath: currentFilePath, channels: newSelection })
      );
    },
    [chartState.selectedChannels, currentFilePath, memoizedPlotState?.edfData?.channels, dispatch, setChartState]
  );

  const handleSelectAllChannels = useCallback(() => {
    if (!currentFilePath || !memoizedPlotState?.edfData?.channels) return;
    const all = memoizedPlotState.edfData.channels;
    setChartState((prev) => ({ ...prev, selectedChannels: all }));
    dispatch(setSelectedChannels({ filePath: currentFilePath, channels: all }));
  }, [currentFilePath, memoizedPlotState?.edfData?.channels, dispatch, setChartState]);

  const handleClearAllChannels = useCallback(() => {
    if (!currentFilePath) return;
    setChartState((prev) => ({ ...prev, selectedChannels: [] }));
    dispatch(setSelectedChannels({ filePath: currentFilePath, channels: [] }));
  }, [currentFilePath, dispatch, setChartState]);

  // Simple preprocessing controls state (local)
  const [preprocessOptionsLocal, setPreprocessOptionsLocal] = useState<any>({
    notchFilter: false,
    highpassFilter: false,
    lowpassFilter: false,
    resample: true,
  });

  useEffect(() => {
    if (memoizedPlotState?.preprocessingOptions) {
      setPreprocessOptionsLocal(memoizedPlotState.preprocessingOptions);
    }
  }, [memoizedPlotState?.preprocessingOptions]);

  const handleApplyPreprocessing = useCallback(async () => {
    if (!currentFilePath) return;
    // Update Redux preprocessing options
    dispatch(
      setPlotPreprocessingOptions({
        filePath: currentFilePath,
        options: preprocessOptionsLocal,
      })
    );

    // Reload current chunk with new preprocessing
    const token = (session as any)?.accessToken || (session as any)?.data?.accessToken;
    const chunkNumber = memoizedPlotState?.currentChunkNumber || 1;
    const chunkSizeSeconds = memoizedPlotState?.chunkSizeSeconds || 10;
    try {
      await dispatch(
        // @ts-expect-error thunk imported from slice
        (await import("../../../store/slices/plotSlice")).loadChunk({
          filePath: currentFilePath,
          chunkNumber,
          chunkSizeSeconds,
          token,
          preprocessingOptions: preprocessOptionsLocal,
        })
      ).unwrap();
    } catch (e) {
      logger.error("[ChartWidget] Failed to reload chunk with preprocessing", e);
    }
  }, [currentFilePath, preprocessOptionsLocal, dispatch, memoizedPlotState?.currentChunkNumber, memoizedPlotState?.chunkSizeSeconds, session]);

  // Use currentPlotState only if it exists and has the required properties
  const selectedChannels =
    currentPlotState?.selectedChannels || DEFAULT_SELECTED_CHANNELS;
  const timeWindow = currentPlotState?.timeWindow || DEFAULT_TIME_WINDOW;
  const zoomLevel = currentPlotState?.zoomLevel || DEFAULT_ZOOM_LEVEL;

  // Find the best plot state - prioritize plots with edfData
  const memoizedPlotState = useMemo(() => {
    if (!currentPlots || !currentPlots.byFilePath) return null;
    // First, try to find a plot with edfData
    const plotWithData = Object.values(currentPlots.byFilePath).find(
      (plot) => plot && plot.edfData && plot.metadata
    );
    if (plotWithData) {
      return plotWithData;
    }
    // Fallback to first plot if no plot with data found
    return Object.values(currentPlots.byFilePath)[0] || null;
  }, [currentPlots]);

  // Session for authentication
  const { data: session } = useUnifiedSessionData();

  // Chunk navigation hook
  const chunkNavigation = useChunkNavigation({
    filePath: currentFilePath || "",
    sampleRate: memoizedPlotState?.edfData?.sampleRate || 256,
    totalSamples: memoizedPlotState?.edfData?.totalSamples || 0,
    token: session?.accessToken,
  });

  // Update widget metadata with current file path for restoration
  useEffect(() => {
    if (currentFilePath && !isPopout) {
      // Update the widget's metadata to include the current file path
      // This allows the restoration system to find this widget and restore its data
      const widgetElement = document.querySelector(
        `[data-widget-id="${widgetId}"]`
      );
      if (widgetElement) {
        // Store the file path in the widget's data attributes for restoration
        widgetElement.setAttribute("data-file-path", currentFilePath);
        widgetElement.setAttribute(
          "data-selected-channels",
          JSON.stringify(chartState.selectedChannels || [])
        );

        logger.debug(`[ChartWidget] Updated widget metadata for restoration:`, {
          widgetId,
          filePath: currentFilePath,
          selectedChannels: chartState.selectedChannels,
        });
      } else {
        logger.warn(
          `[ChartWidget] Could not find widget element with data-widget-id="${widgetId}"`
        );
      }
    } else if (!currentFilePath && !isPopout) {
      logger.debug(
        `[ChartWidget] No current file path available for widget ${widgetId}`
      );
    }
  }, [currentFilePath, widgetId, chartState.selectedChannels, isPopout]);

  // Check for cached plot when widget is created and file path is available
  const cachedPlotParams = useMemo(() => {
    if (!currentFilePath || !memoizedPlotState) return null;

    const params = {
      filePath: currentFilePath,
      chunkStart: memoizedPlotState.chunkStart || 0,
      chunkSize: memoizedPlotState.chunkSizeSeconds
        ? Math.round(
          memoizedPlotState.chunkSizeSeconds *
          (memoizedPlotState.metadata?.sampling_rate || 256)
        )
        : 25600,
      preprocessingOptions: memoizedPlotState.preprocessingOptions,
      selectedChannels: chartState.selectedChannels,
      timeWindow: chartState.timeWindow,
      zoomLevel: chartState.zoomLevel,
    };

    logger.debug(
      `[ChartWidget] cachedPlotParams updated for widget ${widgetId}:`,
      {
        filePath: params.filePath,
        chunkStart: params.chunkStart,
        chunkSize: params.chunkSize,
        hasPreprocessingOptions: !!params.preprocessingOptions,
        selectedChannels: params.selectedChannels,
        timeWindow: params.timeWindow,
        zoomLevel: params.zoomLevel,
        plotStateKeys: Object.keys(memoizedPlotState),
        plotStateChunkStart: memoizedPlotState.chunkStart,
        plotStateChunkSizeSeconds: memoizedPlotState.chunkSizeSeconds,
        plotStateMetadata: memoizedPlotState.metadata ? "exists" : "null",
        plotStatePreprocessingOptions: memoizedPlotState.preprocessingOptions
          ? "exists"
          : "null",
      }
    );

    return params;
  }, [
    currentFilePath,
    memoizedPlotState,
    chartState.selectedChannels,
    chartState.timeWindow,
    chartState.zoomLevel,
    widgetId,
  ]);

  // Memoize callback functions to prevent infinite loops
  const handleCacheHit = useCallback(
    (result: any) => {
      logger.info(`[ChartWidget] Cache hit detected for widget ${widgetId}:`, {
        filePath: result.filePath,
        chunkStart: result.chunkStart,
        chunkSize: result.chunkSize,
      });
    },
    [widgetId]
  );

  const handleCacheMiss = useCallback(() => {
    logger.info(`[ChartWidget] Cache miss for widget ${widgetId}:`, {
      filePath: currentFilePath,
    });
  }, [widgetId, currentFilePath]);

  // Check for cached plots using the new Redis-based system
  const {
    isChecking,
    hasCachedPlot,
    cachedPlotData,
    error: cacheError,
  } = useCachedPlotCheck(cachedPlotParams);

  // Load cached plots from Redis when component mounts (for page reload restoration)
  useEffect(() => {
    const loadCachedPlots = async () => {
      if (!isPopout && !memoizedPlotState) {
        logger.info(
          `[ChartWidget] Starting plot restoration for widget ${widgetId}`
        );
        try {
          logger.debug(
            `[ChartWidget] Loading cached plots from Redis for widget ${widgetId}`
          );
          const cachedPlots = await plotCacheService.loadUserCachedPlots();

          if (Object.keys(cachedPlots).length > 0) {
            logger.info(
              `[ChartWidget] Loaded ${Object.keys(cachedPlots).length
              } cached plots from Redis for widget ${widgetId}`
            );

            // Find the most recent cached plot or use the first one
            const plotEntries = Object.entries(cachedPlots);
            const [plotKey, plotData] = plotEntries[0]; // For now, use the first cached plot

            logger.debug(
              `[ChartWidget] Using cached plot: ${plotKey} for widget ${widgetId}`
            );

            const typedPlotData = plotData as any;

            // Ensure plot state exists in Redux store
            dispatch(ensurePlotState(typedPlotData.filePath));

            // Update the chart state with cached data
            setChartState({
              timeWindow: typedPlotData.timeWindow || [0, 10],
              zoomLevel: typedPlotData.zoomLevel || 1,
              selectedChannels: typedPlotData.selectedChannels || [],
            });

            // Ensure plot state exists in Redux store so restoration events can find it
            dispatch(ensurePlotState(typedPlotData.filePath));

            // Update the available actions
            if (typedPlotData.selectedChannels) {
              dispatch(
                setSelectedChannels({
                  filePath: typedPlotData.filePath,
                  channels: typedPlotData.selectedChannels,
                })
              );
            }

            if (typedPlotData.timeWindow) {
              dispatch(
                setTimeWindow({
                  filePath: typedPlotData.filePath,
                  timeWindow: typedPlotData.timeWindow,
                })
              );
            }

            if (typedPlotData.zoomLevel) {
              dispatch(
                setZoomLevel({
                  filePath: typedPlotData.filePath,
                  zoomLevel: typedPlotData.zoomLevel,
                })
              );
            }

            if (typedPlotData.preprocessingOptions) {
              dispatch(
                setPlotPreprocessingOptions({
                  filePath: typedPlotData.filePath,
                  options: typedPlotData.preprocessingOptions,
                })
              );
            }

            // Restore the metadata first to ensure the plot state exists
            if (typedPlotData.metadata) {
              dispatch({
                type: "plots/initialize/fulfilled",
                payload: {
                  filePath: typedPlotData.filePath,
                  fileInfo: typedPlotData.metadata,
                },
                meta: {
                  requestId: `restore-metadata-${typedPlotData.filePath}`,
                  arg: {
                    filePath: typedPlotData.filePath,
                    token: null,
                  },
                },
              });
            }

            // Restore the edfData directly to the Redux store
            // Since there's no specific action for edfData, we need to dispatch a custom action
            if (typedPlotData.edfData) {
              dispatch({
                type: "plots/loadChunk/fulfilled",
                payload: {
                  filePath: typedPlotData.filePath,
                  chunkNumber: 1,
                  chunkStart: typedPlotData.chunkStart || 0,
                  eegData: typedPlotData.edfData,
                },
                meta: {
                  requestId: `restore-${typedPlotData.filePath}`,
                  arg: {
                    filePath: typedPlotData.filePath,
                    chunkNumber: 1,
                    chunkSizeSeconds: typedPlotData.chunkSizeSeconds || 10,
                    token: null,
                  },
                },
              });
            }

            logger.info(
              `[ChartWidget] Updated Redux store with cached plot data for ${typedPlotData.filePath}`
            );

            logger.info(
              `[ChartWidget] Successfully restored plot state for widget ${widgetId} from cache`
            );
            logger.debug(`[ChartWidget] Restored plot details:`, {
              filePath: typedPlotData.filePath,
              chunkStart: typedPlotData.chunkStart,
              chunkSizeSeconds: typedPlotData.chunkSizeSeconds,
              selectedChannels: typedPlotData.selectedChannels?.length || 0,
              preprocessingOptions: typedPlotData.preprocessingOptions,
              cachedAt: typedPlotData.cachedAt,
            });

            // Log all restored plots for debugging
            Object.entries(cachedPlots).forEach(([key, data]) => {
              const plotData = data as any;
              logger.debug(`[ChartWidget] Available cached plot: ${key}`, {
                filePath: plotData.filePath,
                hasMetadata: !!plotData.metadata,
                hasEdfData: !!plotData.edfData,
                hasChunkStart: !!plotData.chunkStart,
                hasChunkSizeSeconds: !!plotData.chunkSizeSeconds,
                hasPreprocessingOptions: !!plotData.preprocessingOptions,
                hasSelectedChannels: !!plotData.selectedChannels,
                hasTimeWindow: !!plotData.timeWindow,
                hasZoomLevel: !!plotData.zoomLevel,
              });
            });
          } else {
            logger.info(
              `[ChartWidget] No cached plots found in Redis for widget ${widgetId}`
            );
          }
        } catch (error) {
          logger.error(
            `[ChartWidget] Error loading cached plots from Redis for widget ${widgetId}:`,
            error
          );
        }
      } else {
        logger.debug(
          `[ChartWidget] Skipping plot restoration - isPopout: ${isPopout}, hasPlotState: ${!!memoizedPlotState}`
        );
      }
    };

    loadCachedPlots();
  }, [isPopout, memoizedPlotState, widgetId, setChartState, dispatch]);

  // Handle cache hit from the new Redis-based system
  useEffect(() => {
    if (hasCachedPlot && cachedPlotData && !isPopout) {
      logger.info(
        `[ChartWidget] Cache hit for widget ${widgetId}, loading cached plot data`
      );

      // Update the plot state with the cached data
      if (cachedPlotParams?.filePath) {
        // This function is not directly available in useWidgetState,
        // so we'll simulate it or assume it's handled by the global updatePlotState
        logger.debug(
          `[ChartWidget] Simulating updatePlotState for cached plot data:`,
          {
            filePath: cachedPlotParams.filePath,
            hasMetadata: !!cachedPlotData.metadata,
            hasEdfData: !!cachedPlotData.edfData,
            hasChunkStart: !!cachedPlotParams.chunkStart,
            hasChunkSizeSeconds: !!cachedPlotParams.chunkSize,
            hasPreprocessingOptions: !!cachedPlotParams.preprocessingOptions,
            hasSelectedChannels: !!cachedPlotParams.selectedChannels,
            hasTimeWindow: !!cachedPlotParams.timeWindow,
            hasZoomLevel: !!cachedPlotParams.zoomLevel,
          }
        );
      }
    }
  }, [hasCachedPlot, cachedPlotData, isPopout, widgetId, cachedPlotParams]);

  // Debug logging for restoration process
  useEffect(() => {
    logger.info(`[ChartWidget] State update for widget ${widgetId}:`, {
      isPopout,
      hasPlotState: !!memoizedPlotState,
      isLoading: memoizedPlotState?.isLoading,
      hasEdfData: !!memoizedPlotState?.edfData,
      hasError: !!memoizedPlotState?.error,
      channelsCount: memoizedPlotState?.edfData?.channels?.length || 0,
      dataLength: memoizedPlotState?.edfData?.data?.length || 0,
      currentFilePath,
      isCheckingCache: isChecking,
      cacheResult: hasCachedPlot,
      availablePlots: currentPlots ? Object.keys(currentPlots) : [],
      plotsWithData: currentPlots
        ? Object.entries(currentPlots)
          .filter(([_, plot]) => plot?.edfData)
          .map(([key, _]) => key)
        : [],
    });
  }, [
    memoizedPlotState,
    widgetId,
    isPopout,
    currentFilePath,
    isChecking,
    hasCachedPlot,
    currentPlots,
  ]);

  // Auto-select default channels when EDF data becomes available
  useEffect(() => {
    if (
      memoizedPlotState?.edfData?.channels &&
      chartState.selectedChannels.length === 0 &&
      !channelsInitialized.current
    ) {
      logger.info(`[ChartWidget] Auto-selecting default channels:`, {
        widgetId,
        availableChannels: memoizedPlotState.edfData.channels.length,
        channels: memoizedPlotState.edfData.channels.slice(0, 5),
      });

      // Select first 5 channels by default, similar to useDDAPlot
      const defaultChannels = memoizedPlotState.edfData.channels.slice(0, 5);

      // Also initialize time window based on data duration
      const dataDuration = memoizedPlotState.edfData.duration || 10;
      const initialTimeWindow: [number, number] = [
        0,
        Math.min(10, dataDuration),
      ];

      setChartState((prev) => ({
        ...prev,
        selectedChannels: defaultChannels,
        timeWindow: initialTimeWindow,
      }));

      channelsInitialized.current = true;
    }
  }, [
    memoizedPlotState?.edfData?.channels,
    memoizedPlotState?.edfData?.duration,
    chartState.selectedChannels.length,
    setChartState,
    widgetId,
  ]);

  // Reset channel initialization flag when plot state changes
  useEffect(() => {
    if (!memoizedPlotState?.edfData) {
      channelsInitialized.current = false;
    }
  }, [memoizedPlotState?.edfData]);

  // Sync chartState.selectedChannels with Redux plotState.selectedChannels
  useEffect(() => {
    if (
      memoizedPlotState?.selectedChannels &&
      memoizedPlotState.selectedChannels.length > 0 &&
      chartState.selectedChannels.join(",") !==
      memoizedPlotState.selectedChannels.join(",")
    ) {
      setChartState((prev) => ({
        ...prev,
        selectedChannels: memoizedPlotState.selectedChannels,
      }));
    }
  }, [
    memoizedPlotState?.selectedChannels,
    chartState.selectedChannels,
    setChartState,
  ]);

  // Add a timeout for loading state
  const [loadingTimeout, setLoadingTimeout] = useState<NodeJS.Timeout | null>(
    null
  );
  const [hasTimedOut, setHasTimedOut] = useState(false);

  useEffect(() => {
    // Set a timeout to prevent infinite loading
    // Only show timeout when we have a file path and are actually loading
    const shouldShowTimeout =
      currentFilePath &&
      ((memoizedPlotState?.isLoading && !memoizedPlotState?.edfData) ||
        (!memoizedPlotState?.edfData &&
          !memoizedPlotState?.isLoading &&
          !memoizedPlotState?.error &&
          !isPopout));

    if (shouldShowTimeout) {
      const timeout = setTimeout(() => {
        logger.warn(`[ChartWidget] Loading timeout for widget ${widgetId}`);
        setHasTimedOut(true);
      }, 60000); // 60 seconds timeout (increased from 30 to match restoration timeout + buffer)

      setLoadingTimeout(timeout);
    } else {
      if (loadingTimeout) {
        clearTimeout(loadingTimeout);
        setLoadingTimeout(null);
      }
      // Reset timeout state when data loads successfully
      if (memoizedPlotState?.edfData) {
        setHasTimedOut(false);
      }
    }

    return () => {
      if (loadingTimeout) {
        clearTimeout(loadingTimeout);
      }
    };
  }, [
    memoizedPlotState?.isLoading,
    memoizedPlotState?.edfData,
    memoizedPlotState?.error,
    isPopout,
    widgetId,
    currentFilePath,
  ]);

  // --- Centralized loading state logic ---
  const isWidgetLoading = useMemo(() => {
    // Don't show loading if there's an error or timeout
    if (memoizedPlotState?.error || hasTimedOut) return false;

    // Show loading if the plot state is actively loading
    if (memoizedPlotState?.isLoading) return true;

    // Only show loading if we have a file path but missing data
    // This prevents showing loading when no file is selected
    if (
      currentFilePath &&
      (!memoizedPlotState?.edfData || !memoizedPlotState?.metadata)
    ) {
      return true;
    }

    return false;
  }, [memoizedPlotState, hasTimedOut, currentFilePath]);

  // Debug logging for loading state
  useEffect(() => {
    console.log(`[ChartWidget] Loading state for widget ${widgetId}:`, {
      isWidgetLoading,
      currentFilePath,
      hasPlotState: !!memoizedPlotState,
      hasEdfData: !!memoizedPlotState?.edfData,
      hasMetadata: !!memoizedPlotState?.metadata,
      isLoading: memoizedPlotState?.isLoading,
      hasError: !!memoizedPlotState?.error,
      hasTimedOut,
    });
  }, [
    isWidgetLoading,
    currentFilePath,
    memoizedPlotState,
    hasTimedOut,
    widgetId,
  ]);

  // --- Centralized error/timeout logic ---
  if (hasTimedOut && !memoizedPlotState?.edfData) {
    return (
      <div
        className="flex h-full w-full items-center justify-center opacity-100"
        data-widget-id={widgetId}
      >
        <Alert variant="destructive">
          <AlertDescription>
            Loading timeout: Chart data took too long to load. Please try
            refreshing or selecting a different file.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (memoizedPlotState?.error) {
    return (
      <div
        className="flex h-full w-full items-center justify-center opacity-100"
        data-widget-id={widgetId}
      >
        <Alert variant="destructive">
          <AlertDescription>
            {memoizedPlotState.error || "Failed to load chart data"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // --- Main return: loading or chart ---
  return (
    <div
      className={`h-full w-full transition-opacity duration-300 flex flex-col ${isWidgetLoading ? "opacity-50 pointer-events-none" : "opacity-100"
        }`}
      data-widget-id={widgetId}
    >
      {isWidgetLoading ? (
        <div className="flex flex-col items-center justify-center h-full p-4 space-y-4">
          <Skeleton className="w-full h-40 mb-4" />
          <div className="text-lg font-medium">Loading chart data...</div>
        </div>
      ) : // Only render chart if all required data is present
        memoizedPlotState &&
          memoizedPlotState.edfData &&
          memoizedPlotState.metadata ? (
          <>
            {/* Controls Bar */}
            <div className="flex items-center gap-2 mb-2">
              <Button variant="outline" size="sm" onClick={() => setShowChannelSelector((v) => !v)}>
                {showChannelSelector ? "Hide" : "Channels"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowPreprocessing((v) => !v)}>
                {showPreprocessing ? "Hide" : "Preprocess"}
              </Button>
              {showPreprocessing && (
                <div className="flex items-center gap-3 ml-2 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!preprocessOptionsLocal.notchFilter}
                      onChange={(e) =>
                        setPreprocessOptionsLocal((p: any) => ({
                          ...p,
                          notchFilter: e.target.checked,
                        }))
                      }
                    />
                    Notch
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!preprocessOptionsLocal.highpassFilter}
                      onChange={(e) =>
                        setPreprocessOptionsLocal((p: any) => ({
                          ...p,
                          highpassFilter: e.target.checked,
                        }))
                      }
                    />
                    Highpass
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!preprocessOptionsLocal.lowpassFilter}
                      onChange={(e) =>
                        setPreprocessOptionsLocal((p: any) => ({
                          ...p,
                          lowpassFilter: e.target.checked,
                        }))
                      }
                    />
                    Lowpass
                  </label>
                  <Button size="sm" onClick={handleApplyPreprocessing}>
                    Apply
                  </Button>
                </div>
              )}
            </div>

            {showChannelSelector && (
              <div className="mb-3">
                <ChannelSelectorUI
                  availableChannels={memoizedPlotState.edfData.channels || []}
                  selectedChannels={chartState.selectedChannels}
                  onToggleChannel={handleToggleChannel}
                  onSelectAllChannels={handleSelectAllChannels}
                  onClearAllChannels={handleClearAllChannels}
                />
              </div>
            )}

            {/* Navigation Controls */}
            {memoizedPlotState.edfData.totalSamples &&
              memoizedPlotState.edfData.totalSamples > 0 && (
                <div className="flex-shrink-0 mb-4 p-3 bg-muted/50 rounded-lg border">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => chunkNavigation.handleChunkSelect(1)}
                        title="Jump to start"
                        disabled={chunkNavigation.currentChunkNumber <= 1}
                      >
                        <SkipBack className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={chunkNavigation.handlePrevChunk}
                        title="Previous chunk"
                        disabled={chunkNavigation.currentChunkNumber <= 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>
                        Chunk {chunkNavigation.currentChunkNumber} of{" "}
                        {chunkNavigation.totalChunks}
                      </span>
                      <span>•</span>
                      <span>
                        {Math.round(
                          chunkNavigation.chunkStart /
                          (memoizedPlotState.edfData.sampleRate || 256)
                        )}
                        s -{" "}
                        {Math.round(
                          (chunkNavigation.chunkStart +
                            chunkNavigation.chunkSize) /
                          (memoizedPlotState.edfData.sampleRate || 256)
                        )}
                        s
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={chunkNavigation.handleNextChunk}
                        title="Next chunk"
                        disabled={
                          chunkNavigation.currentChunkNumber >=
                          chunkNavigation.totalChunks
                        }
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          chunkNavigation.handleChunkSelect(
                            chunkNavigation.totalChunks
                          )
                        }
                        title="Jump to end"
                        disabled={
                          chunkNavigation.currentChunkNumber >=
                          chunkNavigation.totalChunks
                        }
                      >
                        <SkipForward className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

            {/* Chart Container - Takes remaining space */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <EEGChart2
                eegData={memoizedPlotState.edfData}
                selectedChannels={chartState.selectedChannels}
                timeWindow={chartState.timeWindow}
                zoomLevel={chartState.zoomLevel}
                onTimeWindowChange={(newWindow) => {
                  setChartState((prev) => ({ ...prev, timeWindow: newWindow }));
                }}
              />
            </div>
          </>
        ) : (
          // Fallback: no data to display
          <div className="flex h-full w-full items-center justify-center">
            <Alert>
              <AlertDescription>
                {currentFilePath
                  ? "No chart data available. Please wait for data to load or try selecting a different file."
                  : "No file selected. Use the file browser to select an EDF file to view charts."}
              </AlertDescription>
            </Alert>
          </div>
        )}
    </div>
  );
}
