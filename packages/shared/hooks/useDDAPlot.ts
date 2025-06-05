import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@apollo/client";
import { useToast } from "./useToast";
import { useSession } from "next-auth/react";
import { GET_EDF_DATA, GET_EDF_DEFAULT_CHANNELS } from "../lib/graphql/queries";
import { useEDFPlot } from "../contexts/EDFPlotContext";
import { useAnnotationManagement } from "./useAnnotationManagement";
import { apiRequest } from "../lib/utils/request";
import logger from "../lib/utils/logger";
import { plotCacheManager } from "../lib/utils/plotCache";
import type { EEGData } from "../types/EEGData";
import type { Annotation } from "../types/annotation";
import type { HeatmapPoint } from "../components/plot/DDAHeatmap";
import type { DDAPlotProps } from "../types/DDAPlotProps";
import type { EdfFileInfo } from "../lib/schemas/edf";

// Memoized function to check if preprocessing is active (reduces logging)
const hasActivePreprocessing = (options: any): boolean => {
  if (!options) return false;
  return (
    options.removeOutliers ||
    options.smoothing ||
    (options.normalization && options.normalization !== "none")
  );
};

// Helper to generate a stable cache key
const generateCacheKey = (
  filePath: string,
  chunkStart: number,
  chunkSize: number,
  preprocessingOptions: any
) => {
  return `${filePath}:${chunkStart}:${chunkSize}:${JSON.stringify(
    preprocessingOptions || {}
  )}`;
};

export const useDDAPlot = ({
  filePath,
  Q,
  onChunkLoaded,
  preprocessingOptions: externalPreprocessingOptions,
  selectedChannels,
  setSelectedChannels,
  onChannelSelectionChange,
  onAvailableChannelsChange,
}: DDAPlotProps) => {
  const { getPlotState, updatePlotState, initPlotState } = useEDFPlot();
  const { toast } = useToast();
  const { data: session } = useSession();
  const token = session?.accessToken;
  const chartAreaRef = useRef<HTMLDivElement>(null);

  // Get plot state with more defensive defaults
  const plotState = getPlotState(filePath) || {
    chunkSizeSeconds: 10,
    selectedChannels: [],
    showPlot: false,
    timeWindow: [0, 10] as [number, number],
    absoluteTimeWindow: [0, 10] as [number, number],
    zoomLevel: 1,
    chunkStart: 0,
    totalSamples: 0,
    totalDuration: 0,
    currentChunkNumber: 1,
    totalChunks: 1,
    edfData: null,
    annotations: null,
    lastFetchTime: null,
    preprocessingOptions: null,
    sampleRate: 256,
  };

  const [currentSample, setCurrentSample] = useState(0);
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);
  const [shouldLoadChunk, setShouldLoadChunk] = useState(false);
  const [showZoomSettings, setShowZoomSettings] = useState(false);
  const [manualErrorMessage, setManualErrorMessage] = useState<string | null>(
    null
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [targetAnnotationAfterLoad, setTargetAnnotationAfterLoad] =
    useState<Annotation | null>(null);
  const [ddaHeatmapData, setDdaHeatmapData] = useState<HeatmapPoint[]>([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isHeatmapProcessing, setIsHeatmapProcessing] = useState(false);
  const [chunkStart, setChunkStart] = useState(plotState.chunkStart || 0);
  const [chunkSize, setChunkSize] = useState(
    plotState.sampleRate ? Math.round(10 * plotState.sampleRate) : 2560
  );
  const [totalSamples, setTotalSamples] = useState(plotState.totalSamples || 0);
  const [sampleRate, setSampleRate] = useState(plotState.sampleRate || 256);
  const [timeWindow, setTimeWindow] = useState<[number, number]>(
    plotState.timeWindow || [0, 10]
  );
  const [absoluteTimeWindow, setAbsoluteTimeWindow] = useState<
    [number, number] | undefined
  >(plotState.absoluteTimeWindow);
  const [zoomLevel, setZoomLevel] = useState(plotState.zoomLevel || 1);
  const [preprocessingOptions, setPreprocessingOptions] = useState<any>(
    externalPreprocessingOptions ||
      plotState.preprocessingOptions || {
        removeOutliers: false,
        smoothing: false,
        smoothingWindow: 3,
        normalization: "none",
      }
  );
  const [shouldUpdateViewContext, setShouldUpdateViewContext] = useState(false);
  const timeWindowUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Optimize cache management with stable references
  const [cacheState, setCacheState] = useState({
    checked: false,
    useCachedData: false,
    lastCacheKey: "",
  });

  // Memoize preprocessing check to prevent excessive logging
  const hasActivePreprocessingMemo = useMemo(() => {
    const isActive = hasActivePreprocessing(preprocessingOptions);
    // Only log when the value actually changes
    if (process.env.NODE_ENV === "development") {
      logger.debug("Preprocessing active:", isActive);
    }
    return isActive;
  }, [preprocessingOptions]);

  // Memoize current cache key
  const currentCacheKey = useMemo(() => {
    if (!filePath) return "";
    return generateCacheKey(
      filePath,
      chunkStart,
      chunkSize,
      preprocessingOptions
    );
  }, [filePath, chunkStart, chunkSize, preprocessingOptions]);

  // Enhanced cache checking function with optimization
  const checkCache = useCallback(() => {
    if (
      !filePath ||
      !currentCacheKey ||
      cacheState.lastCacheKey === currentCacheKey
    ) {
      return;
    }

    const cacheKey = {
      filePath,
      chunkStart,
      chunkSize,
      preprocessingOptions,
    };

    let cacheHit = false;

    // Check cached plot data
    const cachedData = plotCacheManager.getCachedPlotData(cacheKey);
    if (cachedData) {
      logger.info("Cache hit for plot data:", filePath);
      cacheHit = true;

      // Update plot state with cached data
      updatePlotState(filePath, {
        edfData: cachedData,
        lastFetchTime: Date.now(),
        showPlot: true,
      });

      onChunkLoaded?.(cachedData);
    }

    // Check cached annotations
    const cachedAnnotations = plotCacheManager.getCachedAnnotations(filePath);
    if (cachedAnnotations) {
      logger.info("Cache hit for annotations:", filePath);
      updatePlotState(filePath, { annotations: cachedAnnotations });
    }

    // Check cached heatmap data if Q is provided
    if (Q) {
      const heatmapCacheKey = { filePath, Q };
      const cachedHeatmap =
        plotCacheManager.getCachedHeatmapData(heatmapCacheKey);
      if (cachedHeatmap) {
        logger.info("Cache hit for heatmap data:", filePath);
        setDdaHeatmapData(cachedHeatmap);
        setShowHeatmap(true);
      }
    }

    // Update cache state
    setCacheState({
      checked: true,
      useCachedData: cacheHit,
      lastCacheKey: currentCacheKey,
    });
  }, [
    filePath,
    chunkStart,
    chunkSize,
    preprocessingOptions,
    Q,
    currentCacheKey,
    cacheState.lastCacheKey,
    updatePlotState,
    onChunkLoaded,
  ]);

  // Check cache only when cache key changes
  useEffect(() => {
    if (currentCacheKey && currentCacheKey !== cacheState.lastCacheKey) {
      checkCache();
    }
  }, [currentCacheKey, checkCache, cacheState.lastCacheKey]);

  const onAnnotationsChangeForPlotState = useCallback(
    (updatedAnnotations: Annotation[]) => {
      if (filePath) {
        updatePlotState(filePath, { annotations: updatedAnnotations });
      }
    },
    [filePath, updatePlotState]
  );

  const {
    annotations,
    setAnnotations,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
  } = useAnnotationManagement({
    filePath,
    initialAnnotationsFromPlotState: plotState.annotations || [],
    onAnnotationsChangeForPlotState,
  });

  // Memoize GraphQL variables to prevent unnecessary re-renders
  const graphqlVariables = useMemo(
    () => ({
      filename: filePath,
      chunkStart,
      chunkSize,
      includeNavigationInfo: true,
      ...(hasActivePreprocessingMemo ? { preprocessingOptions } : {}),
    }),
    [
      filePath,
      chunkStart,
      chunkSize,
      hasActivePreprocessingMemo,
      preprocessingOptions,
    ]
  );

  // Optimize GraphQL query skip condition
  const shouldSkipQuery = useMemo(() => {
    if (!filePath || filePath === "") return true;
    if (cacheState.useCachedData) return true;
    if (!shouldLoadChunk && plotState.edfData !== null) return true;

    // Only skip if we have data and parameters haven't changed
    if (
      plotState.edfData !== null &&
      chunkStart === plotState.chunkStart &&
      chunkSize === plotState.chunkSizeSeconds * plotState.sampleRate &&
      hasActivePreprocessingMemo ===
        hasActivePreprocessing(plotState.preprocessingOptions) &&
      JSON.stringify(preprocessingOptions) ===
        JSON.stringify(plotState.preprocessingOptions)
    ) {
      return true;
    }

    return false;
  }, [
    filePath,
    cacheState.useCachedData,
    shouldLoadChunk,
    plotState.edfData,
    plotState.chunkStart,
    plotState.chunkSizeSeconds,
    plotState.sampleRate,
    plotState.preprocessingOptions,
    chunkStart,
    chunkSize,
    hasActivePreprocessingMemo,
    preprocessingOptions,
  ]);

  const { loading, error, data, refetch, networkStatus } = useQuery(
    GET_EDF_DATA,
    {
      variables: graphqlVariables,
      skip: shouldSkipQuery,
      notifyOnNetworkStatusChange: true,
      fetchPolicy: cacheState.useCachedData
        ? "cache-only"
        : shouldLoadChunk
        ? "network-only"
        : "cache-first",
      context: {
        fetchOptions: {
          onDownloadProgress: (progressEvent: {
            loaded: number;
            total: number;
            lengthComputable: boolean;
          }) => {
            if (progressEvent.lengthComputable) {
              setDownloadProgress(
                Math.round((progressEvent.loaded / progressEvent.total) * 100)
              );
            } else {
              setDownloadProgress(Math.min(downloadProgress + 5, 95));
            }
          },
        },
      },
    }
  );

  // Add query for intelligent default channels
  const {
    data: defaultChannelsData,
    loading: defaultChannelsLoading,
    error: defaultChannelsError,
  } = useQuery(GET_EDF_DEFAULT_CHANNELS, {
    variables: {
      filename: filePath,
      maxChannels: 5,
    },
    skip: !filePath || selectedChannels.length > 0, // Only fetch if no channels selected
    fetchPolicy: "cache-first", // Cache the result for this file
  });

  const convertToEEGData = useCallback(
    (
      edfNumericData: number[][] | undefined,
      channelNames: string[] | undefined,
      selectedChannels: string[],
      sampleRate: number
    ): EEGData | null => {
      if (
        !edfNumericData ||
        !channelNames ||
        !sampleRate ||
        channelNames.length === 0 ||
        edfNumericData.length === 0 ||
        edfNumericData.length !== channelNames.length
      ) {
        logger.warn("convertToEEGData: Invalid input data", {
          edfNumericData,
          channelNames,
          sampleRate,
        });
        return null;
      }
      try {
        const samplesPerChannel = edfNumericData[0]?.length || 0;
        return {
          channels: channelNames,
          samplesPerChannel,
          sampleRate,
          data: edfNumericData,
          startTime: new Date(),
          duration: samplesPerChannel / sampleRate,
          absoluteStartTime: 0,
          annotations: [],
        };
      } catch (error) {
        logger.error("Error converting EEG data:", error);
        setManualErrorMessage(
          `Error converting data: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
        return null;
      }
    },
    [setManualErrorMessage]
  );

  const processMatrixForHeatmap = (matrix: any[][]): HeatmapPoint[] => {
    if (!matrix || !Array.isArray(matrix) || matrix.length === 0) {
      logger.warn("Invalid matrix data for heatmap processing");
      return [];
    }
    const heatmapData: HeatmapPoint[] = [];
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        if (matrix[i][j] !== null) {
          heatmapData.push({ x: i, y: j, value: matrix[i][j] });
        }
      }
    }

    // Cache the processed heatmap data
    if (filePath && Q) {
      const heatmapCacheKey = { filePath, Q };
      plotCacheManager.cacheHeatmapData(heatmapCacheKey, heatmapData);
    }

    return heatmapData;
  };

  useEffect(() => {
    const initializePlotStateAndMetadata = async () => {
      if (filePath && token) {
        initPlotState(filePath);
        try {
          const fileInfoResponse = await apiRequest<EdfFileInfo>({
            url: `/api/edf/info?file_path=${encodeURIComponent(filePath)}`,
            method: "GET",
            token,
            responseType: "json",
            contentType: "application/json",
          });
          if (fileInfoResponse) {
            updatePlotState(filePath, {
              totalChunks: fileInfoResponse.num_chunks,
              totalSamples: fileInfoResponse.total_samples,
              sampleRate: fileInfoResponse.sampling_rate,
              totalDuration: fileInfoResponse.total_duration,
            });
            setShouldLoadChunk(
              !getPlotState(filePath)?.edfData ||
                getPlotState(filePath)?.chunkStart !== 0
            );
          }
        } catch (error) {
          logger.error("Error fetching file info:", error);
          toast({
            title: "Error Fetching File Info",
            description:
              error instanceof Error
                ? error.message
                : "Could not load file metadata.",
            variant: "destructive",
          });
          setShouldLoadChunk(false);
        }
      }
    };
    if (filePath && token) initializePlotStateAndMetadata();
  }, [filePath, token, initPlotState, updatePlotState, toast]);

  useEffect(() => {
    if (externalPreprocessingOptions) {
      setPreprocessingOptions(externalPreprocessingOptions);
      if (
        JSON.stringify(externalPreprocessingOptions) !==
        JSON.stringify(preprocessingOptions)
      ) {
        setShouldLoadChunk(true);
      }
    }
  }, [externalPreprocessingOptions, preprocessingOptions]);

  useEffect(() => {
    if (
      preprocessingOptions &&
      !hasActivePreprocessing(preprocessingOptions) &&
      filePath
    ) {
      updatePlotState(filePath, { preprocessingOptions: null });
    }
  }, [preprocessingOptions, filePath, updatePlotState]);

  useEffect(() => {
    if (data?.getEdfData) {
      const {
        data: edfNumericData,
        samplingFrequency,
        totalSamples,
        channelLabels,
        annotations,
        chunkStart,
        chunkSize,
        totalDurationSeconds,
      } = data.getEdfData;

      setTotalSamples(totalSamples);
      setSampleRate(samplingFrequency);
      setChunkSize(Math.round(10 * samplingFrequency));
      setAvailableChannels(channelLabels);
      onAvailableChannelsChange?.(channelLabels);

      // Use intelligent default channels if available and no channels are selected
      if (selectedChannels.length === 0) {
        if (defaultChannelsData?.getEdfDefaultChannels?.length > 0) {
          logger.info(
            "Using intelligent default channels:",
            defaultChannelsData.getEdfDefaultChannels
          );
          setSelectedChannels(defaultChannelsData.getEdfDefaultChannels);
        } else {
          // Fallback: skip first channel (often Event) and select next few
          const fallbackChannels =
            channelLabels.length > 1
              ? channelLabels.slice(1, Math.min(6, channelLabels.length)) // Skip index 0, take next 5
              : channelLabels.slice(0, Math.min(5, channelLabels.length)); // Take first 5 if only 1 channel
          logger.info(
            "Using fallback channel selection (skipping first channel):",
            fallbackChannels
          );
          setSelectedChannels(fallbackChannels);
        }
      }

      const convertedData = convertToEEGData(
        edfNumericData,
        channelLabels,
        selectedChannels,
        samplingFrequency
      );

      if (convertedData) {
        // Cache the new data
        const cacheKey = {
          filePath,
          chunkStart,
          chunkSize,
          preprocessingOptions: hasActivePreprocessing(preprocessingOptions)
            ? preprocessingOptions
            : null,
        };
        plotCacheManager.cachePlotData(cacheKey, convertedData);

        updatePlotState(filePath, {
          edfData: convertedData,
          annotations: annotations || plotState.annotations,
          totalSamples,
          totalDuration: totalDurationSeconds || plotState.totalDuration,
          sampleRate: samplingFrequency,
          showPlot: true,
          lastFetchTime: Date.now(),
          preprocessingOptions: hasActivePreprocessing(preprocessingOptions)
            ? preprocessingOptions
            : null,
        });

        onChunkLoaded?.(convertedData);
        setDownloadProgress(100);
        setShouldLoadChunk(false);
        setCacheState({
          checked: true,
          useCachedData: false,
          lastCacheKey: currentCacheKey,
        });

        // Cache annotations if present
        if (annotations && filePath) {
          plotCacheManager.cacheAnnotations(filePath, annotations);
        }
      } else {
        setManualErrorMessage(
          "Data received but could not be processed for plotting."
        );
      }
    }
  }, [
    data,
    defaultChannelsData,
    filePath,
    updatePlotState,
    selectedChannels,
    preprocessingOptions,
    onChunkLoaded,
    onAvailableChannelsChange,
    plotState,
    convertToEEGData,
    currentCacheKey,
    cacheState,
  ]);

  useEffect(() => {
    if (Q && Array.isArray(Q) && Q.length > 0) {
      setIsHeatmapProcessing(true);
      try {
        const heatmapData = processMatrixForHeatmap(Q);
        setDdaHeatmapData(heatmapData);
        setShowHeatmap(true);
      } catch (err) {
        logger.error("Error processing Q matrix for heatmap:", err);
        toast({
          title: "Heatmap Error",
          description: "Could not process data for the DDA heatmap.",
          variant: "destructive",
        });
        setShowHeatmap(false);
      } finally {
        setIsHeatmapProcessing(false);
      }
    } else {
      setShowHeatmap(false);
      setDdaHeatmapData([]);
    }
  }, [Q, toast]);

  useEffect(() => {
    if (data && targetAnnotationAfterLoad && !loading) {
      const annotationSample = targetAnnotationAfterLoad.startTime;
      if (
        annotationSample >= chunkStart &&
        annotationSample <= chunkStart + chunkSize
      ) {
        const annotationTimeInChunk =
          (annotationSample - chunkStart) / sampleRate;
        const halfWindowSize = (timeWindow[1] - timeWindow[0]) / 2;
        const newLocalWindow: [number, number] = [
          Math.max(0, annotationTimeInChunk - halfWindowSize),
          Math.min(
            chunkSize / sampleRate,
            annotationTimeInChunk + halfWindowSize
          ),
        ];
        setTimeWindow(newLocalWindow);
        setCurrentSample(annotationSample);
        setAbsoluteTimeWindow([
          chunkStart / sampleRate + newLocalWindow[0],
          chunkStart / sampleRate + newLocalWindow[1],
        ]);
        setTimeout(() => setShouldUpdateViewContext(true), 300);
        setTargetAnnotationAfterLoad(null);
      }
    }
  }, [
    data,
    loading,
    targetAnnotationAfterLoad,
    chunkStart,
    chunkSize,
    sampleRate,
    timeWindow,
  ]);

  const handlePrevChunk = () => {
    const newChunkStart = Math.max(0, chunkStart - chunkSize);
    setChunkStart(newChunkStart);
    setShouldLoadChunk(true);
    setDownloadProgress(0);
    resetTimeWindow(newChunkStart);
    updatePlotState(filePath, {
      chunkStart: newChunkStart,
      currentChunkNumber: newChunkStart / chunkSize + 1,
    });
  };

  const handleNextChunk = () => {
    if (chunkStart + chunkSize < totalSamples) {
      const newChunkStart = chunkStart + chunkSize;
      setChunkStart(newChunkStart);
      setShouldLoadChunk(true);
      setDownloadProgress(0);
      resetTimeWindow(newChunkStart);
      updatePlotState(filePath, {
        chunkStart: newChunkStart,
        currentChunkNumber: newChunkStart / chunkSize + 1,
      });
    }
  };

  const resetTimeWindow = (start: number) => {
    const absStart = start / sampleRate;
    const actualDuration = data?.getEdfData?.chunkSize
      ? data.getEdfData.chunkSize / sampleRate
      : chunkSize / sampleRate || 10;
    setTimeWindow([0, actualDuration]);
    setAbsoluteTimeWindow([absStart, absStart + actualDuration]);
  };

  const handleZoomIn = () => {
    if (zoomLevel < 10 && data) {
      const newZoom = zoomLevel * 1.5;
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) / 1.5;
      const newLocalWindow: [number, number] = [
        Math.max(0, center - newDuration / 2),
        Math.min(data.getEdfData.duration, center + newDuration / 2),
      ];
      setZoomLevel(newZoom);
      setTimeWindow(newLocalWindow);
      setAbsoluteTimeWindow([
        chunkStart / sampleRate + newLocalWindow[0],
        chunkStart / sampleRate + newLocalWindow[1],
      ]);
      setTimeout(() => setShouldUpdateViewContext(true), 300);
    }
  };

  const handleZoomOut = () => {
    if (zoomLevel > 0.1 && data) {
      const newZoom = zoomLevel / 1.5;
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) * 1.5;
      const newLocalWindow: [number, number] = [
        Math.max(0, center - newDuration / 2),
        Math.min(data.getEdfData.duration, center + newDuration / 2),
      ];
      setZoomLevel(newZoom);
      setTimeWindow(newLocalWindow);
      setAbsoluteTimeWindow([
        chunkStart / sampleRate + newLocalWindow[0],
        chunkStart / sampleRate + newLocalWindow[1],
      ]);
      setTimeout(() => setShouldUpdateViewContext(true), 300);
    }
  };

  const handleReset = () => {
    if (data) {
      setZoomLevel(1);
      setTimeWindow([0, data.getEdfData.duration]);
      setAbsoluteTimeWindow([
        chunkStart / sampleRate,
        chunkStart / sampleRate + data.getEdfData.duration,
      ]);
      setTimeout(() => setShouldUpdateViewContext(true), 300);
    }
  };

  const handleChunkSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    if (!isNaN(value) && value > 0) {
      setChunkSize(value);
    }
  };

  const handleLoadChunk = () => {
    setShouldLoadChunk(true);
    setDownloadProgress(0);
    updatePlotState(filePath, {
      chunkStart,
      chunkSizeSeconds: chunkSize / sampleRate,
    });
  };

  const toggleChannel = (channel: string) => {
    onChannelSelectionChange(
      selectedChannels.includes(channel)
        ? selectedChannels.filter((ch) => ch !== channel)
        : [...selectedChannels, channel]
    );
  };

  const handleChartClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!chartAreaRef.current || !data) return;
    const rect = chartAreaRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const relativeX = x / rect.width;
    const timeOffset =
      timeWindow[0] + relativeX * (timeWindow[1] - timeWindow[0]);
    setCurrentSample(chunkStart + Math.floor(timeOffset * sampleRate));
  };

  const handleAnnotationSelect = (annotation: Annotation) => {
    const annotationSample = annotation.startTime;
    if (
      annotationSample >= chunkStart &&
      annotationSample <= chunkStart + chunkSize
    ) {
      const annotationTimeInChunk =
        (annotationSample - chunkStart) / sampleRate;
      const halfWindowSize = (timeWindow[1] - timeWindow[0]) / 2;
      const newLocalWindow: [number, number] = [
        Math.max(0, annotationTimeInChunk - halfWindowSize),
        Math.min(
          chunkSize / sampleRate,
          annotationTimeInChunk + halfWindowSize
        ),
      ];
      setTimeWindow(newLocalWindow);
      setCurrentSample(annotationSample);
      setAbsoluteTimeWindow([
        chunkStart / sampleRate + newLocalWindow[0],
        chunkStart / sampleRate + newLocalWindow[1],
      ]);
      setTimeout(() => setShouldUpdateViewContext(true), 300);
    } else {
      const newChunkStart = Math.max(
        0,
        annotationSample - Math.floor(chunkSize / 2)
      );
      setChunkStart(newChunkStart);
      setCurrentSample(annotationSample);
      const chunkDurationSec = chunkSize / sampleRate;
      setTimeWindow([0, Math.min(10, chunkDurationSec)]);
      setAbsoluteTimeWindow([
        newChunkStart / sampleRate,
        newChunkStart / sampleRate + Math.min(10, chunkDurationSec),
      ]);
      setShouldLoadChunk(true);
      setTargetAnnotationAfterLoad(annotation);
    }
  };

  const toggleHeatmap = () => {
    if (!showHeatmap && Q) {
      setIsHeatmapProcessing(true);
      try {
        const processed = processMatrixForHeatmap(Q);
        setDdaHeatmapData(processed);
        setShowHeatmap(true);
      } catch (err) {
        logger.error("Error processing heatmap data:", err);
        toast({
          title: "Heatmap Error",
          description: "Could not process data for the heatmap.",
          variant: "destructive",
        });
        setShowHeatmap(false);
      } finally {
        setIsHeatmapProcessing(false);
      }
    } else {
      setShowHeatmap(!showHeatmap);
    }
  };

  const handleSelectAllChannels = () =>
    onChannelSelectionChange(availableChannels);
  const handleClearAllChannels = () => onChannelSelectionChange([]);
  const handleSelectChannels = (channels: string[]) =>
    onChannelSelectionChange(channels);

  useEffect(() => {
    if (filePath && shouldLoadChunk) {
      updatePlotState(filePath, { chunkSizeSeconds: chunkSize / sampleRate });
    }
  }, [filePath, updatePlotState, chunkSize, sampleRate, shouldLoadChunk]);

  useEffect(() => {
    if (filePath && shouldUpdateViewContext) {
      updatePlotState(filePath, {
        timeWindow,
        absoluteTimeWindow: absoluteTimeWindow || [0, 10],
        zoomLevel,
      });
      setShouldUpdateViewContext(false);
    }
  }, [
    filePath,
    updatePlotState,
    timeWindow,
    absoluteTimeWindow,
    zoomLevel,
    shouldUpdateViewContext,
  ]);

  useEffect(() => {
    if (filePath) {
      updatePlotState(filePath, {
        chunkStart,
        totalSamples,
        preprocessingOptions: hasActivePreprocessing(preprocessingOptions)
          ? preprocessingOptions
          : null,
      });
    }
  }, [
    filePath,
    updatePlotState,
    chunkStart,
    totalSamples,
    preprocessingOptions,
  ]);

  useEffect(() => {
    if (loading) {
      setDownloadProgress(5);
      const interval = setInterval(
        () => setDownloadProgress((prev) => Math.min(prev + 2, 95)),
        200
      );
      return () => clearInterval(interval);
    } else if (!loading && downloadProgress > 0) {
      setDownloadProgress(100);
      const timeout = setTimeout(() => setDownloadProgress(0), 500);
      return () => clearTimeout(timeout);
    }
  }, [loading, downloadProgress]);

  useEffect(() => {
    if (filePath) {
      refetch({
        filename: filePath,
        chunkStart,
        chunkSize,
        ...(hasActivePreprocessing(preprocessingOptions)
          ? { preprocessingOptions }
          : {}),
      });
      setShouldLoadChunk(true);
    }
  }, [filePath, refetch, chunkStart, chunkSize, preprocessingOptions]);

  const handleTimeWindowChange = (newWindow: [number, number]) => {
    // Use plotState.edfData instead of data?.getEdfData since the plot might be loaded from cache
    if (!plotState.edfData) {
      return; // Skip if no plot data is loaded
    }

    // Calculate chunk duration from plotState
    const chunkDuration =
      plotState.edfData.duration || chunkSize / sampleRate || 10;

    // Validate and clamp the new window to the chunk's duration
    const validatedWindow: [number, number] = [
      Math.max(0, newWindow[0]),
      Math.min(chunkDuration, newWindow[1]),
    ];

    setTimeWindow(validatedWindow);

    // Calculate absolute time window in seconds
    const absoluteChunkStart = chunkStart / sampleRate;
    setAbsoluteTimeWindow([
      absoluteChunkStart + validatedWindow[0],
      absoluteChunkStart + validatedWindow[1],
    ]);

    // Debounce context update
    if (timeWindowUpdateTimeoutRef.current) {
      clearTimeout(timeWindowUpdateTimeoutRef.current);
    }
    timeWindowUpdateTimeoutRef.current = setTimeout(() => {
      setShouldUpdateViewContext(true);
    }, 300);
  };

  // Clean up expired cache entries periodically
  useEffect(() => {
    const interval = setInterval(() => {
      plotCacheManager.clearExpiredCache();
    }, 60000); // Clean up every minute

    return () => clearInterval(interval);
  }, []);

  return {
    plotState,
    loading,
    error,
    manualErrorMessage,
    downloadProgress,
    showHeatmap,
    ddaHeatmapData,
    isHeatmapProcessing,
    showZoomSettings,
    chartAreaRef,
    availableChannels,
    currentSample,
    timeWindow,
    zoomLevel,
    editMode,
    annotations,
    handlePrevChunk,
    handleNextChunk,
    handleZoomIn,
    handleZoomOut,
    handleReset,
    handleChunkSizeChange,
    handleLoadChunk,
    toggleChannel,
    handleChartClick,
    handleAnnotationSelect,
    toggleHeatmap,
    handleSelectAllChannels,
    handleClearAllChannels,
    handleSelectChannels,
    setShowZoomSettings,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    setAnnotations,
    handleTimeWindowChange,
  };
};
