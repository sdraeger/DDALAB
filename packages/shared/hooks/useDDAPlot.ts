import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@apollo/client";
import {
  GET_EDF_DATA,
  GET_EDF_DEFAULT_CHANNELS,
  GET_DDA_ARTIFACT_DATA,
} from "../lib/graphql/queries";
import { useEDFPlot } from "../contexts/EDFPlotContext";
import { useAnnotationManagement } from "./useAnnotationManagement";
import { useChunkNavigation } from "./useChunkNavigation";
import { useTimeWindow } from "./useTimeWindow";
import { useHeatmapData } from "./useHeatmapData";
import logger from "../lib/utils/logger";
import { cacheManager } from "../lib/utils/cache";
import type { Annotation } from "../types/annotation";
import type { DDAPlotProps } from "../types/DDAPlotProps";
import {
  DEFAULT_CHUNK_SIZE_SECONDS,
  DEFAULT_SELECTED_CHANNELS,
  DEFAULT_TIME_WINDOW,
  DEFAULT_ABSOLUTE_TIME_WINDOW,
  DEFAULT_ZOOM_LEVEL,
  DEFAULT_CURRENT_CHUNK_NUMBER,
  DEFAULT_TOTAL_CHUNKS,
  DEFAULT_CHUNK_START,
  DEFAULT_ANNOTATIONS,
  DEFAULT_PREPROCESSING_OPTIONS,
  DEFAULT_SAMPLE_RATE,
} from "../lib/utils/plotDefaults";

// Helper functions moved to top level for better organization
const hasActivePreprocessing = (options: any): boolean => {
  if (!options) return false;
  return (
    options.removeOutliers ||
    options.smoothing ||
    (options.normalization && options.normalization !== "none")
  );
};

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
  const { getPlotState, updatePlotState } = useEDFPlot();
  const chartAreaRef = useRef<HTMLDivElement>(null);

  // Check if the file path is a DDA artifact (JSON file)
  const isDDArtifact = useMemo(() => {
    return (
      filePath &&
      filePath.includes("dda_results/") &&
      filePath.endsWith(".json")
    );
  }, [filePath]);

  // State to track the actual EDF file path (extracted from artifact if needed)
  const [actualEDFFilePath, setActualEDFFilePath] = useState<string | null>(
    null
  );
  const [ddaQMatrix, setDdaQMatrix] = useState<any>(Q);

  // Get plot state with defensive defaults
  const plotState = getPlotState(filePath) || {
    chunkSizeSeconds: DEFAULT_CHUNK_SIZE_SECONDS,
    selectedChannels: DEFAULT_SELECTED_CHANNELS,
    showPlot: false,
    timeWindow: DEFAULT_TIME_WINDOW,
    absoluteTimeWindow: DEFAULT_ABSOLUTE_TIME_WINDOW,
    zoomLevel: DEFAULT_ZOOM_LEVEL,
    chunkStart: DEFAULT_CHUNK_START,
    totalSamples: 0,
    totalDuration: 0,
    currentChunkNumber: DEFAULT_CURRENT_CHUNK_NUMBER,
    totalChunks: DEFAULT_TOTAL_CHUNKS,
    edfData: null,
    annotations: DEFAULT_ANNOTATIONS,
    lastFetchTime: null,
    preprocessingOptions: DEFAULT_PREPROCESSING_OPTIONS,
    sampleRate: DEFAULT_SAMPLE_RATE,
  };

  // Basic state management
  const [currentSample, setCurrentSample] = useState(0);
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);
  const [shouldLoadChunk, setShouldLoadChunk] = useState(false);
  const [manualErrorMessage, setManualErrorMessage] = useState<string | null>(
    null
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [targetAnnotationAfterLoad, setTargetAnnotationAfterLoad] =
    useState<Annotation | null>(null);
  const [totalSamples, setTotalSamples] = useState(plotState.totalSamples || 0);
  const [sampleRate, setSampleRate] = useState(plotState.sampleRate || 256);
  const [preprocessingOptions, setPreprocessingOptions] = useState<any>(
    externalPreprocessingOptions ||
      plotState.preprocessingOptions || {
        removeOutliers: false,
        smoothing: false,
        smoothingWindow: 3,
        normalization: "none",
      }
  );

  // Use modular hooks for specific functionality
  const chunkNavigation = useChunkNavigation({
    filePath: actualEDFFilePath || filePath,
    sampleRate,
    totalSamples,
    token: undefined, // DDA plots don't have access to token, only use state management
  });

  const timeWindowManager = useTimeWindow({
    filePath: actualEDFFilePath || filePath,
    sampleRate,
    chunkStart: chunkNavigation.chunkStart,
    chunkSize: chunkNavigation.chunkSize,
    plotData: plotState.edfData,
  });

  const heatmapManager = useHeatmapData({
    filePath: actualEDFFilePath || filePath,
    Q: ddaQMatrix || Q,
  });

  // Cache management
  const [cacheState, setCacheState] = useState({
    checked: false,
    useCachedData: false,
    lastCacheKey: "",
  });

  // Memoized preprocessing check
  const hasActivePreprocessingMemo = useMemo(() => {
    const isActive = hasActivePreprocessing(preprocessingOptions);
    if (process.env.NODE_ENV === "development") {
      logger.debug("Preprocessing active:", isActive);
    }
    return isActive;
  }, [preprocessingOptions]);

  // Memoized cache key
  const currentCacheKey = useMemo(() => {
    if (!filePath) return "";
    return generateCacheKey(
      filePath,
      chunkNavigation.chunkStart,
      chunkNavigation.chunkSize,
      preprocessingOptions
    );
  }, [
    filePath,
    chunkNavigation.chunkStart,
    chunkNavigation.chunkSize,
    preprocessingOptions,
  ]);

  // Cache checking functionality
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
      chunkStart: chunkNavigation.chunkStart,
      chunkSize: chunkNavigation.chunkSize,
      preprocessingOptions,
    };

    let cacheHit = false;

    // Check cached plot data
    const cachedData = cacheManager.getCachedPlotData(cacheKey);
    if (cachedData) {
      logger.info("Cache hit for plot data:", filePath);
      cacheHit = true;
      updatePlotState(filePath, {
        edfData: cachedData,
        lastFetchTime: Date.now(),
        showPlot: true,
      });
      onChunkLoaded?.(cachedData);
    }

    // Check cached annotations
    const cachedAnnotations = cacheManager.getCachedAnnotations(filePath);
    if (cachedAnnotations) {
      logger.info("Cache hit for annotations:", filePath);
      updatePlotState(filePath, { annotations: cachedAnnotations });
    }

    // Update cache state
    setCacheState({
      checked: true,
      useCachedData: cacheHit,
      lastCacheKey: currentCacheKey,
    });
  }, [
    filePath,
    chunkNavigation.chunkStart,
    chunkNavigation.chunkSize,
    preprocessingOptions,
    currentCacheKey,
    cacheState.lastCacheKey,
    updatePlotState,
    onChunkLoaded,
  ]);

  // Check cache when cache key changes
  useEffect(() => {
    if (currentCacheKey && currentCacheKey !== cacheState.lastCacheKey) {
      checkCache();
    }
  }, [currentCacheKey, checkCache, cacheState.lastCacheKey]);

  // Annotation management - use original filePath for plot state key but actual EDF path for queries
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
    filePath: actualEDFFilePath || filePath,
    initialAnnotationsFromPlotState: plotState.annotations || [],
    onAnnotationsChangeForPlotState,
  });

  // Query for DDA artifact data (if it's an artifact file)
  const {
    data: artifactData,
    loading: artifactLoading,
    error: artifactError,
  } = useQuery(GET_DDA_ARTIFACT_DATA, {
    variables: {
      // Clean the path before sending to GraphQL
      artifactPath: filePath?.replace(/^\/?(dda-results\/)+/, "dda_results/"),
    },
    skip: !isDDArtifact || !filePath,
    fetchPolicy: "cache-and-network",
    onCompleted: (data) => {
      if (data?.getDdaArtifactData) {
        const { originalFilePath, Q: artifactQ } = data.getDdaArtifactData;
        logger.info(`DDA artifact loaded. Original file: ${originalFilePath}`);

        // Only update if the data has changed
        if (originalFilePath !== actualEDFFilePath) {
          setActualEDFFilePath(originalFilePath);
        }

        // Deep compare Q matrices to prevent unnecessary updates
        if (JSON.stringify(artifactQ) !== JSON.stringify(ddaQMatrix)) {
          setDdaQMatrix(artifactQ);
        }
      }
    },
    onError: (err) => {
      logger.error("Error loading DDA artifact:", err);
      setManualErrorMessage("Failed to load DDA artifact data");
      // Clear the file path to prevent infinite retries
      setActualEDFFilePath(null);
    },
  });

  // Use the actual EDF file path for EDF data queries, or the original file path if not an artifact
  const edfFilePath = actualEDFFilePath || (!isDDArtifact ? filePath : null);

  // Update GraphQL variables to use the actual EDF file path
  const edfGraphqlVariables = useMemo(() => {
    if (!edfFilePath) return null;

    const variables = {
      filename: edfFilePath,
      chunkStart: chunkNavigation.chunkStart || 0,
      chunkSize:
        chunkNavigation.chunkSize || Math.round(10 * sampleRate) || 2560,
      includeNavigationInfo: true,
      ...(hasActivePreprocessingMemo ? { preprocessingOptions } : {}),
    };

    // Debug logging
    if (process.env.NODE_ENV === "development") {
      console.log(
        "GraphQL Variables for GET_EDF_DATA (using actual EDF path):",
        variables
      );
    }

    return variables;
  }, [
    edfFilePath,
    chunkNavigation.chunkStart,
    chunkNavigation.chunkSize,
    sampleRate,
    hasActivePreprocessingMemo,
    preprocessingOptions,
  ]);

  // Update skip condition to use actual EDF file path
  const shouldSkipEDFQuery = useMemo(() => {
    let skipReason = null;

    if (!edfFilePath || edfFilePath === "") {
      skipReason = "No EDF filePath available";
    } else if (!chunkNavigation.chunkSize || chunkNavigation.chunkSize <= 0) {
      skipReason = `Invalid chunkSize: ${chunkNavigation.chunkSize}`;
    } else if (cacheState.useCachedData) {
      skipReason = "Using cached data";
    } else if (!shouldLoadChunk && plotState.edfData !== null) {
      skipReason = "Not loading chunk and plot data exists";
    } else if (isDDArtifact && !actualEDFFilePath) {
      skipReason =
        "DDA artifact detected but original file path not yet loaded";
    }

    const shouldSkip = !!skipReason;

    // Debug logging
    if (process.env.NODE_ENV === "development") {
      if (shouldSkip) {
        console.log("Skipping GET_EDF_DATA query:", skipReason);
        console.log("Query skip state:", {
          isDDArtifact,
          edfFilePath: !!edfFilePath,
          actualEDFFilePath: !!actualEDFFilePath,
          chunkSize: chunkNavigation.chunkSize,
          useCachedData: cacheState.useCachedData,
          shouldLoadChunk,
          hasExistingData: plotState.edfData !== null,
        });
      } else {
        console.log("Executing GET_EDF_DATA query for EDF file:", edfFilePath);
      }
    }

    return shouldSkip;
  }, [
    edfFilePath,
    actualEDFFilePath,
    isDDArtifact,
    chunkNavigation.chunkSize,
    cacheState.useCachedData,
    shouldLoadChunk,
    plotState.edfData,
  ]);

  // GraphQL queries
  const { data, loading, error, refetch } = useQuery(GET_EDF_DATA, {
    variables: edfGraphqlVariables || {},
    skip: shouldSkipEDFQuery || !edfGraphqlVariables,
    fetchPolicy: "cache-and-network",
    notifyOnNetworkStatusChange: true,
  });

  const { data: channelsData } = useQuery(GET_EDF_DEFAULT_CHANNELS, {
    variables: { filename: edfFilePath || filePath },
    skip: !edfFilePath && !filePath,
  });

  // Initialize plot state and metadata
  const initializePlotStateAndMetadata = useCallback(async () => {
    if (!filePath || !data?.getEdfData) return;

    const rawEdfData = data.getEdfData;
    const navigationInfo = rawEdfData.navigationInfo;

    // Debug logging
    if (process.env.NODE_ENV === "development") {
      console.log("Raw EDF Data structure:", rawEdfData);
      console.log("Channel labels:", rawEdfData.channelLabels);
      console.log("Data array length:", rawEdfData.data?.length);
      console.log("Navigation info:", navigationInfo);
    }

    if (navigationInfo) {
      const {
        totalSamples: navTotalSamples,
        samplingFrequency: navSampleRate,
      } = rawEdfData;
      setTotalSamples(navTotalSamples);
      setSampleRate(navSampleRate);
      chunkNavigation.setChunkSize(Math.round(10 * navSampleRate));
    }

    // Transform the raw GraphQL data to match the EEGData interface
    const transformedEdfData = {
      channels: rawEdfData.channelLabels || [], // Map channelLabels to channels
      sampleRate: rawEdfData.samplingFrequency || 256, // Map samplingFrequency to sampleRate
      data: rawEdfData.data || [],
      startTime: new Date(), // Create a start time (could be enhanced with actual timestamp)
      duration: rawEdfData.totalSamples
        ? rawEdfData.totalSamples / rawEdfData.samplingFrequency
        : 0,
      samplesPerChannel: rawEdfData.data?.[0]?.length || 0,
      totalSamples: rawEdfData.totalSamples || 0,
      chunkSize: rawEdfData.chunkSize || chunkNavigation.chunkSize,
      chunkStart: chunkNavigation.chunkStart || 0,
      absoluteStartTime: 0, // Could be enhanced with actual file start time
      annotations: [], // Initialize empty annotations array
    };

    // Extract and set available channels from EDF data
    if (rawEdfData.channelLabels && rawEdfData.channelLabels.length > 0) {
      setAvailableChannels(rawEdfData.channelLabels);
      onAvailableChannelsChange?.(rawEdfData.channelLabels);

      // If no channels are selected yet, select the first 5
      if (selectedChannels.length === 0) {
        const defaultChannels = rawEdfData.channelLabels.slice(0, 5);
        onChannelSelectionChange(defaultChannels);
      }
    }

    // Update plot state with the transformed EDF data
    updatePlotState(filePath, {
      edfData: transformedEdfData,
      totalSamples: rawEdfData.totalSamples || 0,
      sampleRate: rawEdfData.samplingFrequency || 256,
      lastFetchTime: Date.now(),
      showPlot: true,
      chunkStart: chunkNavigation.chunkStart || 0,
      timeWindow: [0, Math.min(10, transformedEdfData.duration)], // Show first 10 seconds or full duration
      absoluteTimeWindow: [0, Math.min(10, transformedEdfData.duration)],
    });

    // Cache the transformed data using plotCacheManager
    const cacheKey = {
      filePath,
      chunkStart: chunkNavigation.chunkStart,
      chunkSize: chunkNavigation.chunkSize,
      preprocessingOptions: hasActivePreprocessing(preprocessingOptions)
        ? preprocessingOptions
        : undefined,
    };
    cacheManager.cachePlotData(cacheKey, transformedEdfData);
    setShouldLoadChunk(false);

    // Debug logging for transformed data
    if (process.env.NODE_ENV === "development") {
      console.log("Transformed EDF Data:", transformedEdfData);
    }
  }, [
    filePath,
    data,
    chunkNavigation,
    onAvailableChannelsChange,
    onChannelSelectionChange,
    updatePlotState,
    setShouldLoadChunk,
  ]);

  // Effect to initialize plot state
  useEffect(() => {
    if (data?.getEdfData && !loading) {
      initializePlotStateAndMetadata();
    }
  }, [data, loading, initializePlotStateAndMetadata]);

  // Channel selection handlers
  const handleSelectAllChannels = useCallback(() => {
    onChannelSelectionChange(availableChannels);
  }, [onChannelSelectionChange, availableChannels]);

  const handleClearAllChannels = useCallback(() => {
    onChannelSelectionChange([]);
  }, [onChannelSelectionChange]);

  const handleSelectChannels = useCallback(
    (channels: string[]) => {
      onChannelSelectionChange(channels);
    },
    [onChannelSelectionChange]
  );

  // Other handlers
  const toggleChannel = useCallback(
    (channel: string) => {
      const newChannels = selectedChannels.includes(channel)
        ? selectedChannels.filter((c) => c !== channel)
        : [...selectedChannels, channel];
      onChannelSelectionChange(newChannels);
    },
    [selectedChannels, onChannelSelectionChange]
  );

  const handleChartClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Chart click handling logic would go here
      console.log("Chart clicked", e);
    },
    []
  );

  const handleAnnotationSelect = useCallback(
    (annotation: Annotation) => {
      if (!filePath) return;

      const annotationSample = annotation.startTime * sampleRate;
      const newChunkStart = Math.max(
        0,
        annotationSample - Math.floor(chunkNavigation.chunkSize / 2)
      );

      chunkNavigation.setChunkStart(newChunkStart);
      setCurrentSample(annotationSample);

      const chunkDurationSec = chunkNavigation.chunkSize / sampleRate;
      timeWindowManager.setTimeWindow([0, Math.min(10, chunkDurationSec)]);
      timeWindowManager.setAbsoluteTimeWindow([
        newChunkStart / sampleRate,
        newChunkStart / sampleRate + Math.min(10, chunkDurationSec),
      ]);

      setShouldLoadChunk(true);
      setTargetAnnotationAfterLoad(annotation);
    },
    [filePath, sampleRate, chunkNavigation, timeWindowManager]
  );

  const handleLoadChunk = useCallback(() => {
    setShouldLoadChunk(true);
  }, []);

  // Set up available channels
  useEffect(() => {
    if (channelsData?.getEdfDefaultChannels) {
      const channels = channelsData.getEdfDefaultChannels;
      setAvailableChannels(channels);
      onAvailableChannelsChange?.(channels);
    }
  }, [channelsData, onAvailableChannelsChange]);

  // Download progress management
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

  // Initialize data loading for new plots
  useEffect(() => {
    // For DDA artifacts, wait until we have the actual EDF file path
    // For regular EDF files, proceed immediately
    const shouldInitialize =
      filePath &&
      !plotState.edfData &&
      !loading &&
      !cacheState.useCachedData &&
      (!isDDArtifact || (isDDArtifact && actualEDFFilePath));

    if (shouldInitialize) {
      const pathToUse = isDDArtifact ? actualEDFFilePath : filePath;
      logger.info("Initializing data load for new plot:", pathToUse);
      setShouldLoadChunk(true);
    }
  }, [
    filePath,
    actualEDFFilePath,
    isDDArtifact,
    plotState.edfData,
    loading,
    cacheState.useCachedData,
  ]);

  // Refetch when parameters change
  useEffect(() => {
    const pathForRefetch = edfFilePath || filePath;
    if (
      pathForRefetch &&
      chunkNavigation.chunkSize &&
      chunkNavigation.chunkSize > 0 &&
      (!isDDArtifact || actualEDFFilePath) // Wait for artifact processing if needed
    ) {
      refetch({
        filename: pathForRefetch,
        chunkStart: chunkNavigation.chunkStart || 0,
        chunkSize: chunkNavigation.chunkSize,
        ...(hasActivePreprocessing(preprocessingOptions)
          ? { preprocessingOptions }
          : {}),
      });
      setShouldLoadChunk(true);
    }
  }, [
    edfFilePath,
    filePath,
    actualEDFFilePath,
    isDDArtifact,
    refetch,
    chunkNavigation.chunkStart,
    chunkNavigation.chunkSize,
    preprocessingOptions,
  ]);

  // Periodic cache cleanup
  useEffect(() => {
    const interval = setInterval(() => {
      cacheManager.clearExpiredCache();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return {
    // Plot state
    plotState,
    loading: loading || artifactLoading,
    error: error || artifactError,
    manualErrorMessage,
    downloadProgress,
    chartAreaRef,
    availableChannels,
    currentSample,
    editMode,

    // DDA artifact data
    isDDArtifact,
    ddaQMatrix,
    actualEDFFilePath,

    // Chunk navigation
    ...chunkNavigation,

    // Time window management
    ...timeWindowManager,

    // Heatmap management
    ...heatmapManager,

    // Annotation management
    annotations,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    setAnnotations,
    handleAnnotationSelect,

    // Channel management
    toggleChannel,
    handleSelectAllChannels,
    handleClearAllChannels,
    handleSelectChannels,

    // Other handlers
    handleChartClick,
    handleLoadChunk,
  };
};
