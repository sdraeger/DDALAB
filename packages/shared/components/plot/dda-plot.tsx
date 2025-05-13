"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, NetworkStatus } from "@apollo/client";
import { GET_EDF_DATA } from "../../lib/graphql/queries";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Alert, AlertDescription } from "../ui/alert";
import { EEGChart } from "./eeg-chart";
import { useToast } from "../ui/use-toast";
import { Settings } from "lucide-react";
import { EEGData, Annotation } from "../../types/eeg-types";
import { AnnotationEditor } from "../annotation-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { EEGZoomSettings } from "../settings/eeg-zoom-settings";
import { useEDFPlot } from "../../contexts/edf-plot-context";
import { useSession } from "next-auth/react";
import logger from "../../lib/utils/logger";
import { DDAHeatmap } from "./dda-heatmap";
import type { HeatmapPoint } from "./dda-heatmap";
import { PlotControls } from "./PlotControls";
import { ChannelSelectorUI } from "../ui/ChannelSelectorUI";
import { useAnnotationManagement } from "../../hooks/use-annotation-management";

// Helper function to determine if any preprocessing options are active
const hasActivePreprocessing = (options: any): boolean => {
  if (!options) return false;
  const isActive =
    options.removeOutliers ||
    options.smoothing ||
    (options.normalization && options.normalization !== "none");

  logger.info("Preprocessing options active check:", options, isActive);
  return isActive;
};

interface DDAPlotProps {
  filePath: string;
  taskId?: string;
  Q?: any;
  onChunkLoaded?: (data: EEGData) => void;
  preprocessingOptions?: any;
  selectedChannels: string[];
  setSelectedChannels: (channels: string[]) => void;
  onChannelSelectionChange: (channels: string[]) => void;
  onAvailableChannelsChange?: (channels: string[]) => void;
}

export function DDAPlot({
  filePath,
  Q,
  onChunkLoaded,
  preprocessingOptions: externalPreprocessingOptions,
  selectedChannels,
  setSelectedChannels,
  onChannelSelectionChange,
  onAvailableChannelsChange,
}: DDAPlotProps) {
  // Context for managing shared state between components
  const { getPlotState, updatePlotState, initPlotState } = useEDFPlot();
  const { toast } = useToast();
  const chartAreaRef = useRef<HTMLDivElement>(null);

  // Get the plot state for this file
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
    sampleRate: 256, // Default sample rate
  };

  // Local state for UI interaction
  const [currentSample, setCurrentSample] = useState(0);
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);
  const [shouldLoadChunk, setShouldLoadChunk] = useState(false);
  const [showZoomSettings, setShowZoomSettings] = useState(false);
  const [manualErrorMessage, setManualErrorMessage] = useState<string | null>(
    null
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const { data: session } = useSession();
  const user = session?.user;

  // Add state to track annotation edit mode
  const [editMode, setEditMode] = useState(false);

  // Add state to track the annotation to focus on after loading a chunk
  const [targetAnnotationAfterLoad, setTargetAnnotationAfterLoad] =
    useState<Annotation | null>(null);

  const [ddaHeatmapData, setDdaHeatmapData] = useState<any[]>([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isHeatmapProcessing, setIsHeatmapProcessing] = useState(false);

  // Initialize the plot state if needed
  useEffect(() => {
    if (filePath) {
      logger.info("Initializing plot state for file:", filePath);
      initPlotState(filePath);

      // Set flag to load the chunk on initial file selection
      // Only if we don't already have data for this file
      const currentPlotState = getPlotState(filePath);
      logger.info("Initial plot state:", currentPlotState);

      if (!currentPlotState || !currentPlotState.edfData) {
        logger.info("No existing data found, setting shouldLoadChunk to true");
        setShouldLoadChunk(true);
      } else {
        logger.info("Using existing cached data, not loading chunk");
      }
    }
  }, [filePath, initPlotState, getPlotState]);

  // Use cached values or initialize state
  const [chunkStart, setChunkStart] = useState(plotState.chunkStart || 0);
  const [chunkSize, setChunkSize] = useState(
    // Calculate based on the file's actual sample rate (or use default of 256Hz)
    plotState.sampleRate
      ? Math.round(10 * plotState.sampleRate) // 10 seconds at the actual sample rate
      : 2560 // Default to 10 seconds at 256 Hz if no sample rate yet (10*256=2560)
  );
  const [totalSamples, setTotalSamples] = useState(plotState.totalSamples || 0);
  const [sampleRate, setSampleRate] = useState(plotState.sampleRate || 256);
  const [timeWindow, setTimeWindow] = useState<[number, number]>(
    plotState.timeWindow || [0, 10]
  ); // In seconds
  const [absoluteTimeWindow, setAbsoluteTimeWindow] = useState<
    [number, number] | undefined
  >(plotState.absoluteTimeWindow);
  const [zoomLevel, setZoomLevel] = useState(plotState.zoomLevel || 1);

  // Initialize preprocessing options - making sure to not interpret defaults as active preprocessing
  const defaultPreprocessingOptions = {
    removeOutliers: false,
    smoothing: false,
    smoothingWindow: 3,
    normalization: "none",
  };

  // Use external preprocessing options if provided, otherwise use from plotState or defaults
  const [preprocessingOptions, setPreprocessingOptions] = useState<any>(
    externalPreprocessingOptions ||
      plotState.preprocessingOptions ||
      defaultPreprocessingOptions
  );

  // Update preprocessingOptions when they change externally
  useEffect(() => {
    if (externalPreprocessingOptions) {
      setPreprocessingOptions(externalPreprocessingOptions);
      // Only load new data if the options are different
      if (
        JSON.stringify(externalPreprocessingOptions) !==
        JSON.stringify(preprocessingOptions)
      ) {
        setShouldLoadChunk(true);
      }
    }
  }, [externalPreprocessingOptions]);

  // Ensure we don't consider default values as active preprocessing
  useEffect(() => {
    // Check if we have only default values
    const hasDefaultValuesOnly =
      preprocessingOptions &&
      !preprocessingOptions.removeOutliers &&
      !preprocessingOptions.smoothing &&
      preprocessingOptions.normalization === "none";

    if (hasDefaultValuesOnly && filePath) {
      logger.info(
        "Detected default preprocessingOptions - updating context only"
      );
      // Only update the context, don't change the local state to avoid a loop
      updatePlotState(filePath, {
        preprocessingOptions: null,
      });
    }
  }, [preprocessingOptions, filePath, updatePlotState]);

  // Add state to track when to update the context for time window changes
  const [shouldUpdateViewContext, setShouldUpdateViewContext] = useState(false);
  const timeWindowUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Query for EDF data (skip if cached data is available and valid)
  const { loading, error, data, refetch, networkStatus } = useQuery(
    GET_EDF_DATA,
    {
      variables: {
        filename: filePath,
        chunkStart,
        chunkSize,
        includeNavigationInfo: true,
        // Only send preprocessing options if any non-default options are active
        ...(hasActivePreprocessing(preprocessingOptions)
          ? { preprocessingOptions }
          : {}),
      },
      skip:
        !filePath ||
        filePath === "" ||
        // Enhanced skip condition to prevent unnecessary refetching
        (!shouldLoadChunk && plotState.edfData !== null) || // Skip if not explicitly loading and we have cached data
        (plotState.edfData !== null &&
          chunkStart === plotState.chunkStart &&
          chunkSize === plotState.chunkSizeSeconds * plotState.sampleRate && // Compare actual chunk sizes
          hasActivePreprocessing(preprocessingOptions) ===
            hasActivePreprocessing(plotState.preprocessingOptions) &&
          JSON.stringify(preprocessingOptions) ===
            JSON.stringify(plotState.preprocessingOptions)),
      notifyOnNetworkStatusChange: true,
      // Use cache-first policy to prefer cached data when available
      fetchPolicy: shouldLoadChunk ? "network-only" : "cache-first",
      context: {
        fetchOptions: {
          onDownloadProgress: (progressEvent: {
            loaded: number;
            total: number;
            lengthComputable: boolean;
          }) => {
            if (progressEvent.lengthComputable) {
              const percentComplete = Math.round(
                (progressEvent.loaded / progressEvent.total) * 100
              );
              setDownloadProgress(percentComplete);
            } else {
              // If length isn't computable, use a simulated progress
              const simulatedProgress = Math.min(downloadProgress + 5, 95);
              setDownloadProgress(simulatedProgress);
            }
          },
        },
      },
    }
  );

  // ANNOTATION MANAGEMENT HOOK
  const {
    annotations,
    setAnnotations: setHookAnnotations,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
  } = useAnnotationManagement({
    filePath,
    initialAnnotationsFromPlotState: plotState.annotations || [],
    onAnnotationsChangeForPlotState: (updatedPlotStateAnnotations) => {
      if (filePath) {
        updatePlotState(filePath, { annotations: updatedPlotStateAnnotations });
      }
    },
  });

  // Reset shouldLoadChunk after data is loaded
  useEffect(() => {
    if (data && shouldLoadChunk) {
      logger.info("Data loaded, resetting shouldLoadChunk flag");
      setShouldLoadChunk(false);
    }
  }, [data, shouldLoadChunk]);

  // Effect to process Q matrix when it arrives or changes
  useEffect(() => {
    if (Q && Array.isArray(Q) && Q.length > 0) {
      logger.info("Q matrix prop received, processing for heatmap...");
      setIsHeatmapProcessing(true);
      setShowHeatmap(false); // Hide old heatmap while processing
      try {
        const heatmapData = processMatrixForHeatmap(Q);
        setDdaHeatmapData(heatmapData);
        setShowHeatmap(true);
        logger.info("Heatmap data processed and set.");
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
      // If Q is cleared or not provided, hide heatmap and reset data
      setShowHeatmap(false);
      setDdaHeatmapData([]);
      // No need to set processing to false here as it wasn't set to true
      logger.info("Q matrix not provided or cleared, heatmap hidden.");
    }
  }, [Q, toast]); // Dependency on Q prop and toast

  // Helper function to process matrix data for heatmap
  const processMatrixForHeatmap = (matrix: any[][]): HeatmapPoint[] => {
    logger.info(
      "Processing matrix for heatmap. Matrix length (time points):",
      matrix?.length
    );
    if (matrix?.length > 0) {
      logger.info("Matrix[0] length (channels):", matrix[0]?.length);
    }

    if (!matrix || !Array.isArray(matrix) || matrix.length === 0) {
      console.warn("Invalid matrix data for heatmap processing");
      return [];
    }

    const heatmapData: HeatmapPoint[] = [];
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        if (matrix[i][j] !== null) {
          heatmapData.push({
            x: i,
            y: j,
            value: matrix[i][j],
          });
        }
      }
    }

    return heatmapData;
  };

  // Update total samples when data is loaded
  useEffect(() => {
    if (data?.getEdfData?.totalSamples) {
      setTotalSamples(data.getEdfData.totalSamples);
      setSampleRate(data.getEdfData.samplingFrequency);

      // Update the sample rate in the context
      if (filePath) {
        updatePlotState(filePath, {
          sampleRate: data.getEdfData.samplingFrequency,
        });
      }

      // Update chunk size when sample rate changes to maintain 10 seconds
      const newChunkSize = Math.round(10 * data.getEdfData.samplingFrequency);
      setChunkSize(newChunkSize);

      // Adjust time window if needed
      const actualChunkDuration =
        data.getEdfData.chunkSize / data.getEdfData.samplingFrequency;
      if (Math.abs(timeWindow[1] - actualChunkDuration) > 1) {
        // If the time window is significantly different from the actual chunk duration
        // reset it to match the actual data
        setTimeWindow([0, actualChunkDuration]);
        const absoluteStartSec = chunkStart / data.getEdfData.samplingFrequency;
        setAbsoluteTimeWindow([
          absoluteStartSec,
          absoluteStartSec + actualChunkDuration,
        ]);
      }

      if (
        data.getEdfData.channelLabels &&
        data.getEdfData.channelLabels.length > 0
      ) {
        setAvailableChannels(data.getEdfData.channelLabels);

        if (onAvailableChannelsChange) {
          onAvailableChannelsChange(data.getEdfData.channelLabels);
        }

        if (selectedChannels.length === 0) {
          setSelectedChannels(
            data.getEdfData.channelLabels.slice(
              0,
              Math.min(5, data.getEdfData.channelLabels.length)
            )
          );
        }
      }
    }
  }, [
    data,
    filePath,
    updatePlotState,
    chunkStart,
    timeWindow,
    onAvailableChannelsChange,
  ]);

  // Moved convertToEEGData outside and before the useEffect that uses it.
  const convertToEEGData = useCallback(
    (
      edfNumericDataFromQuery: number[][] | undefined,
      allChannelNamesFromQuery: string[] | undefined,
      currentSelectedChannelsFromProp: string[],
      currentSampleRate: number
    ): EEGData | null => {
      logger.debug("[DDAPlot] convertToEEGData called with:", {
        allChannelNamesFromQuery,
        currentSelectedChannelsFromProp,
        // edfNumericDataFromQuery, // Avoid logging potentially large data array
        hasNumericData: !!edfNumericDataFromQuery,
      });

      if (
        !edfNumericDataFromQuery ||
        !allChannelNamesFromQuery ||
        !currentSampleRate ||
        allChannelNamesFromQuery.length === 0 ||
        edfNumericDataFromQuery.length === 0 ||
        edfNumericDataFromQuery.length !== allChannelNamesFromQuery.length // Ensure data and channel name arrays match
      ) {
        logger.warn(
          "convertToEEGData: Missing critical input data or mismatched arrays",
          {
            hasNumericData: !!edfNumericDataFromQuery,
            numNumericDataArrays: edfNumericDataFromQuery?.length,
            numAllChannelNames: allChannelNamesFromQuery?.length,
            currentSampleRate: !!currentSampleRate,
          }
        );
        return null;
      }

      try {
        const samplesPerChannel = edfNumericDataFromQuery[0]?.length || 0;

        if (samplesPerChannel === 0 && allChannelNamesFromQuery.length > 0) {
          logger.warn(
            "convertToEEGData: Channels from query appear to have no samples."
          );
        }

        const eegData: EEGData = {
          channels: allChannelNamesFromQuery, // Use all available channel names from the query
          samplesPerChannel: samplesPerChannel,
          sampleRate: currentSampleRate,
          data: edfNumericDataFromQuery, // Use all corresponding data from the query
          startTime: new Date(), // Or a more accurate start time if available from query
          duration: samplesPerChannel / currentSampleRate,
          absoluteStartTime: 0, // Or a more accurate absolute start time if available
          annotations: [], // Or actual annotations if available
        };

        logger.debug("[DDAPlot] convertToEEGData produced:", {
          channels: eegData.channels,
          samplesPerChannel: eegData.samplesPerChannel,
          numDataArrays: eegData.data.length,
        });
        return eegData;
      } catch (error) {
        logger.error("Error converting EDF data:", error);
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

  // Handle data, loading, and error states from the query
  useEffect(() => {
    if (networkStatus === NetworkStatus.error || error) {
      logger.error("GraphQL Query Error:", error);
      setManualErrorMessage(
        `Error fetching EDF data: ${error?.message || "Unknown error"}`
      );
      if (plotState.edfData) {
        // If there's stale data, allow user to see it but show error
        toast({
          title: "Failed to refresh data",
          description: error?.message || "Could not load new data.",
          variant: "destructive",
          duration: 5000,
        });
      }
      setShouldLoadChunk(false);
      return;
    }

    if (loading || networkStatus === NetworkStatus.loading) {
      return;
    }

    if (data?.getEdfData) {
      logger.debug("GraphQL Query Success");
      setManualErrorMessage(null); // Clear error on success

      logger.debug(
        "[DDAPlot] Main data useEffect: Raw data from query",
        data.getEdfData
      );
      logger.debug(
        "[DDAPlot] Main data useEffect: Current selectedChannels state before conversion:",
        selectedChannels
      );

      const {
        data: edfNumericDataFromQuery,
        samplingFrequency: newSampleRateFromQuery,
        totalSamples: newTotalSamplesFromQuery,
        channelLabels: newChannelNamesFromQuery,
        annotations: fetchedAnnotations,
        chunkStart: returnedChunkStart,
        chunkSize: returnedChunkSize,
        hasMore: returnedHasMore,
      } = data.getEdfData;

      if (
        newChannelNamesFromQuery &&
        JSON.stringify(newChannelNamesFromQuery) !==
          JSON.stringify(availableChannels)
      ) {
        setAvailableChannels(newChannelNamesFromQuery);
        if (onAvailableChannelsChange) {
          onAvailableChannelsChange(newChannelNamesFromQuery);
        }
      }

      if (newTotalSamplesFromQuery) setTotalSamples(newTotalSamplesFromQuery);
      const effectiveSampleRate = newSampleRateFromQuery || sampleRate;
      if (newSampleRateFromQuery && newSampleRateFromQuery !== sampleRate) {
        setSampleRate(newSampleRateFromQuery);
      }
      if (
        newSampleRateFromQuery &&
        newSampleRateFromQuery !== plotState.sampleRate
      ) {
        setChunkSize(Math.round(10 * newSampleRateFromQuery));
      }

      const convertedData = convertToEEGData(
        edfNumericDataFromQuery,
        newChannelNamesFromQuery,
        selectedChannels,
        effectiveSampleRate
      );

      logger.debug(
        "[DDAPlot] Main data useEffect: Data after conversion by convertToEEGData:",
        {
          channels: convertedData?.channels,
          numDataArrays: convertedData?.data?.length,
        }
      );

      if (convertedData) {
        updatePlotState(filePath, {
          edfData: convertedData,
          annotations: fetchedAnnotations || plotState.annotations,
          totalSamples: newTotalSamplesFromQuery || plotState.totalSamples,
          totalDuration:
            data.getEdfData.totalDurationSeconds || plotState.totalDuration,
          sampleRate: effectiveSampleRate,
          showPlot: true,
          lastFetchTime: Date.now(),
          preprocessingOptions: hasActivePreprocessing(preprocessingOptions)
            ? preprocessingOptions
            : null,
        });

        if (onChunkLoaded && convertedData) {
          onChunkLoaded(convertedData);
        }
        setDownloadProgress(100);
        setShouldLoadChunk(false);

        if (targetAnnotationAfterLoad && fetchedAnnotations && convertedData) {
          const foundAnnotation = fetchedAnnotations.find(
            (ann: Annotation) => ann.id === targetAnnotationAfterLoad.id
          );
          if (foundAnnotation) {
            const annotationStartSample = Math.round(
              foundAnnotation.start_time * effectiveSampleRate
            );
            const currentChunkSizeSamples = Math.round(
              10 * effectiveSampleRate
            );
            const chunkContainingAnnotationStart = Math.floor(
              annotationStartSample / currentChunkSizeSamples
            );
            const currentLoadedChunkStartSamples = chunkStart;
            const currentLoadedChunkIndex = Math.floor(
              currentLoadedChunkStartSamples / currentChunkSizeSamples
            );

            if (chunkContainingAnnotationStart === currentLoadedChunkIndex) {
              const chart = chartAreaRef.current?.querySelector("canvas");
              if (chart) {
                const relativeStartTime =
                  foundAnnotation.start_time -
                  currentLoadedChunkStartSamples / effectiveSampleRate;
                const xPosition =
                  (relativeStartTime /
                    (currentChunkSizeSamples / effectiveSampleRate)) *
                  chart.width;
                chart.parentElement?.scrollTo({
                  left: xPosition - chart.width / 2,
                  behavior: "smooth",
                });
              }
            }
          }
          setTargetAnnotationAfterLoad(null);
        }
      } else {
        logger.error(
          "Failed to convert EDF data after successful GraphQL query. Plot will not be updated."
        );
        if (!manualErrorMessage) {
          setManualErrorMessage(
            "Data received but could not be processed for plotting."
          );
        }
      }
    } else if (!loading && !error && (!data || !data.getEdfData)) {
      logger.info(
        "GraphQL Query: No data returned, no error, and not loading."
      );
      if (shouldLoadChunk && !plotState.edfData) {
        setManualErrorMessage(
          "No data was received for the plot. The file might be empty or an issue occurred."
        );
      }
      setShouldLoadChunk(false);
    }
  }, [
    data,
    error,
    networkStatus,
    filePath,
    updatePlotState,
    getPlotState,
    selectedChannels,
    preprocessingOptions,
    shouldLoadChunk,
    targetAnnotationAfterLoad,
    onAvailableChannelsChange,
    onChunkLoaded,
    plotState.annotations,
    plotState.totalSamples,
    plotState.totalDuration,
    plotState.sampleRate,
    plotState.edfData,
    sampleRate,
    availableChannels,
    chunkStart,
    convertToEEGData,
    manualErrorMessage,
  ]);

  // Navigate to previous chunk
  const handlePrevChunk = () => {
    const newChunkStart = Math.max(0, chunkStart - chunkSize);
    setChunkStart(newChunkStart);
    setShouldLoadChunk(true);
    setDownloadProgress(0);
    resetTimeWindow(newChunkStart);
    updatePlotState(filePath, {
      chunkStart: newChunkStart,
    });
  };

  // Navigate to next chunk
  const handleNextChunk = () => {
    if (chunkStart + chunkSize < totalSamples) {
      const newChunkStart = chunkStart + chunkSize;
      setChunkStart(newChunkStart);
      setShouldLoadChunk(true);
      setDownloadProgress(0);
      resetTimeWindow(newChunkStart);
      updatePlotState(filePath, {
        chunkStart: newChunkStart,
      });
    }
  };

  // Reset time window when navigating between chunks
  const resetTimeWindow = (start: number) => {
    const absStart = start / sampleRate;

    // Get the actual duration from the data if available
    const actualDuration = data?.getEdfData?.chunkSize
      ? data.getEdfData.chunkSize / sampleRate
      : chunkSize / sampleRate || 10; // Default to 10 seconds

    // Use the actual duration for the time window
    setTimeWindow([0, actualDuration]);
    setAbsoluteTimeWindow([absStart, absStart + actualDuration]);

    logger.info(
      `Reset time window: start=${absStart}s, duration=${actualDuration}s`
    );
  };

  // Handle zoom in
  const handleZoomIn = () => {
    if (zoomLevel < 10 && data) {
      const newZoom = zoomLevel * 1.5;
      setZoomLevel(newZoom);

      // Adjust time window to maintain center point
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) / 1.5;
      const newLocalWindow = [
        Math.max(0, center - newDuration / 2),
        Math.min(data.duration, center + newDuration / 2),
      ] as [number, number];

      setTimeWindow(newLocalWindow);

      // Update absolute window
      const absoluteChunkStart = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteChunkStart + newLocalWindow[0],
        absoluteChunkStart + newLocalWindow[1],
      ]);

      // Set a flag to update the context after debounce
      if (timeWindowUpdateTimeoutRef.current) {
        clearTimeout(timeWindowUpdateTimeoutRef.current);
      }

      timeWindowUpdateTimeoutRef.current = setTimeout(() => {
        setShouldUpdateViewContext(true);
        // Important: Do NOT set shouldLoadChunk to true when zooming
      }, 300);
    }
  };

  // Handle zoom out
  const handleZoomOut = () => {
    if (zoomLevel > 0.1 && data) {
      const newZoom = zoomLevel / 1.5;
      setZoomLevel(newZoom);

      // Adjust time window to maintain center point
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) * 1.5;
      const newLocalWindow = [
        Math.max(0, center - newDuration / 2),
        Math.min(data.duration, center + newDuration / 2),
      ] as [number, number];

      setTimeWindow(newLocalWindow);

      // Update absolute window
      const absoluteChunkStart = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteChunkStart + newLocalWindow[0],
        absoluteChunkStart + newLocalWindow[1],
      ]);

      // Set a flag to update the context after debounce
      if (timeWindowUpdateTimeoutRef.current) {
        clearTimeout(timeWindowUpdateTimeoutRef.current);
      }

      timeWindowUpdateTimeoutRef.current = setTimeout(() => {
        setShouldUpdateViewContext(true);
        // Important: Do NOT set shouldLoadChunk to true when zooming
      }, 300);
    }
  };

  // Reset to full view
  const handleReset = () => {
    if (data) {
      setZoomLevel(1);
      setTimeWindow([0, data.duration]);

      const absoluteChunkStart = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteChunkStart,
        absoluteChunkStart + data.duration,
      ]);

      // Set a flag to update the context after debounce
      if (timeWindowUpdateTimeoutRef.current) {
        clearTimeout(timeWindowUpdateTimeoutRef.current);
      }

      timeWindowUpdateTimeoutRef.current = setTimeout(() => {
        setShouldUpdateViewContext(true);
        // Important: Do NOT set shouldLoadChunk to true when resetting view
      }, 300);
    }
  };

  // Update chunk size
  const handleChunkSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    if (!isNaN(value) && value > 0) {
      logger.info(
        `Chunk size changed to ${value} samples (${
          value / sampleRate
        }s) - not loading yet`
      );

      // Store the chunk size in samples
      setChunkSize(value);
    }
  };

  // Separate useEffect for chunk size-related context updates
  // This prevents changes to chunk size from triggering data loading
  useEffect(() => {
    if (filePath && shouldLoadChunk) {
      updatePlotState(filePath, {
        chunkSizeSeconds: chunkSize / sampleRate,
      });
    }
  }, [filePath, updatePlotState, chunkSize, sampleRate, shouldLoadChunk]);

  // Handle time window changes from the EEG chart
  const handleTimeWindowChange = (newWindow: [number, number]) => {
    // Don't set shouldLoadChunk to true here - we're just changing the view window
    setTimeWindow(newWindow);

    if (data?.absoluteStartTime !== undefined) {
      setAbsoluteTimeWindow([
        data.absoluteStartTime + newWindow[0],
        data.absoluteStartTime + newWindow[1],
      ]);
    }

    // Set a flag to update the context, but debounce it
    if (timeWindowUpdateTimeoutRef.current) {
      clearTimeout(timeWindowUpdateTimeoutRef.current);
    }

    timeWindowUpdateTimeoutRef.current = setTimeout(() => {
      setShouldUpdateViewContext(true);
      // Note: We're NOT calling setShouldLoadChunk(true) here as we don't need to fetch new data
      // When panning/zooming within the same chunk
    }, 300);
  };

  // Separate useEffect for view-related updates (zooming and panning)
  useEffect(() => {
    if (filePath && shouldUpdateViewContext) {
      updatePlotState(filePath, {
        timeWindow,
        absoluteTimeWindow: absoluteTimeWindow || [0, 10],
        zoomLevel,
      });
      setShouldUpdateViewContext(false);

      // We should NOT set shouldLoadChunk to true here
      // as that would cause unnecessary data refetching during zoom/pan
    }
  }, [
    filePath,
    updatePlotState,
    timeWindow,
    absoluteTimeWindow,
    zoomLevel,
    shouldUpdateViewContext,
  ]);

  // Update the context for other state changes (not zoom/pan related)
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

  // Load chunk with new size - only called when the load button is clicked
  const handleLoadChunk = () => {
    logger.info("Loading chunk at position:", chunkStart);
    setShouldLoadChunk(true);
    setDownloadProgress(0);
    updatePlotState(filePath, {
      chunkStart,
      chunkSizeSeconds: chunkSize / sampleRate,
    });
  };

  // Toggle channel selection
  const toggleChannel = (channel: string) => {
    console.log("toggleChannel", channel);
    onChannelSelectionChange(
      selectedChannels.includes(channel)
        ? selectedChannels.filter((ch) => ch !== channel)
        : [...selectedChannels, channel]
    );
  };

  // Calculate position in file as percentage
  const positionPercentage = totalSamples
    ? ((chunkStart + chunkSize / 2) / totalSamples) * 100
    : 0;

  // Format time for display (MM:SS.ms)
  const formatTime = (timeInSeconds: number): string => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    const ms = Math.floor((timeInSeconds % 1) * 1000);
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
  };

  // Handle annotation selection
  const handleAnnotationSelect = (annotation: Annotation) => {
    const annotationSample = annotation.startTime;
    const chunkStartSample = chunkStart;
    const chunkEndSample = chunkStart + chunkSize;

    logger.info(
      `Selecting annotation at sample ${annotationSample}, current chunk: ${chunkStartSample}-${chunkEndSample}`
    );

    // Check if the annotation is within the current chunk
    if (
      annotationSample >= chunkStartSample &&
      annotationSample <= chunkEndSample
    ) {
      logger.info("Annotation is in current chunk, panning to it");
      // Annotation is in the current chunk, just pan to it
      // Calculate annotation position within the chunk in seconds
      const annotationTimeInChunk =
        (annotationSample - chunkStartSample) / sampleRate;
      const halfWindowSize = (timeWindow[1] - timeWindow[0]) / 2;

      // Center the view on the annotation
      const newLocalWindow = [
        Math.max(0, annotationTimeInChunk - halfWindowSize),
        Math.min(
          chunkSize / sampleRate,
          annotationTimeInChunk + halfWindowSize
        ),
      ] as [number, number];

      setTimeWindow(newLocalWindow);
      setCurrentSample(annotationSample);

      // Update absolute time window
      const absoluteChunkStart = chunkStartSample / sampleRate;
      setAbsoluteTimeWindow([
        absoluteChunkStart + newLocalWindow[0],
        absoluteChunkStart + newLocalWindow[1],
      ]);

      // Set a flag to update the context after debounce
      if (timeWindowUpdateTimeoutRef.current) {
        clearTimeout(timeWindowUpdateTimeoutRef.current);
      }

      timeWindowUpdateTimeoutRef.current = setTimeout(() => {
        setShouldUpdateViewContext(true);
      }, 300);
    } else {
      // Annotation is in a different chunk, need to load that chunk
      logger.info("Annotation is in a different chunk, loading it");

      // Calculate the new chunk start to center the annotation in the chunk if possible
      // Ensure the annotation will be roughly in the middle of the new chunk
      const newChunkStart = Math.max(
        0,
        annotationSample - Math.floor(chunkSize / 2)
      );

      // Update chunk start position
      setChunkStart(newChunkStart);
      setCurrentSample(annotationSample);

      // Reset time window to default size
      // After the chunk loads, we'll pan to the annotation
      const chunkDurationSec = chunkSize / sampleRate;
      setTimeWindow([0, Math.min(10, chunkDurationSec)]);

      // Update absolute time window
      const absoluteStartSec = newChunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteStartSec,
        absoluteStartSec + Math.min(10, chunkDurationSec),
      ]);

      // Set flag to load the chunk
      setShouldLoadChunk(true);

      // Store the target annotation to pan to after loading
      setTargetAnnotationAfterLoad(annotation);
    }
  };

  // Click handler for the chart area (e.g., for annotations)
  const handleChartClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!chartAreaRef.current || !data) return;

    const rect = chartAreaRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const relativeX = x / rect.width;
    const timeOffset =
      timeWindow[0] + relativeX * (timeWindow[1] - timeWindow[0]);

    // Convert time to sample position
    const samplePosition = chunkStart + Math.floor(timeOffset * sampleRate);
    setCurrentSample(samplePosition);
    // If a more specific click handler is needed for annotations, EEGChart can handle it internally
    // or call a specific prop like onAnnotationRelatedClick if DDAPlot needs to be involved.
  };

  // Create a QuickZoomSettings component to reuse in the dialog
  const QuickZoomSettings = ({ onClose }: { onClose: () => void }) => {
    return (
      <div className="p-4">
        <EEGZoomSettings />
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  };

  // Simulate download progress with interval when loading
  useEffect(() => {
    if (loading) {
      // Start with a small value to show that loading has begun
      setDownloadProgress(5);

      // Simulate progress if length isn't computable
      const interval = setInterval(() => {
        setDownloadProgress((prev) => {
          // Don't go beyond 95% with simulation (actual completion will set to 100%)
          return Math.min(prev + 2, 95);
        });
      }, 200);

      return () => clearInterval(interval);
    } else if (!loading && downloadProgress > 0) {
      // Set to 100% when loading completes
      setDownloadProgress(100);

      // Reset after a short delay
      const timeout = setTimeout(() => {
        setDownloadProgress(0);
      }, 500);

      return () => clearTimeout(timeout);
    }
  }, [loading, downloadProgress]);

  // Effect to load the first chunk when filePath changes
  useEffect(() => {
    if (filePath) {
      // Use the refetch function from the useQuery hook for GET_EDF_DATA
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

  // Effect to focus on target annotation after a chunk is loaded
  useEffect(() => {
    // Check if we have loaded data and have a target annotation to focus on
    if (data && targetAnnotationAfterLoad && !loading) {
      logger.info(
        "Chunk loaded, focusing on annotation:",
        targetAnnotationAfterLoad
      );

      // Calculate annotation position within the chunk in seconds
      const annotationSample = targetAnnotationAfterLoad.startTime;
      const annotationTimeInChunk =
        (annotationSample - chunkStart) / sampleRate;
      const halfWindowSize = (timeWindow[1] - timeWindow[0]) / 2;

      // Verify the annotation is in the current chunk
      if (
        annotationSample >= chunkStart &&
        annotationSample <= chunkStart + chunkSize
      ) {
        // Center the view on the annotation
        const newLocalWindow = [
          Math.max(0, annotationTimeInChunk - halfWindowSize),
          Math.min(
            chunkSize / sampleRate,
            annotationTimeInChunk + halfWindowSize
          ),
        ] as [number, number];

        setTimeWindow(newLocalWindow);
        setCurrentSample(annotationSample);

        // Update absolute time window
        const absoluteChunkStart = chunkStart / sampleRate;
        setAbsoluteTimeWindow([
          absoluteChunkStart + newLocalWindow[0],
          absoluteChunkStart + newLocalWindow[1],
        ]);

        // Update context
        if (timeWindowUpdateTimeoutRef.current) {
          clearTimeout(timeWindowUpdateTimeoutRef.current);
        }

        timeWindowUpdateTimeoutRef.current = setTimeout(() => {
          setShouldUpdateViewContext(true);
        }, 300);
      }

      // Clear the target annotation
      setTargetAnnotationAfterLoad(null);
    }
  }, [
    data,
    loading,
    targetAnnotationAfterLoad,
    chunkStart,
    chunkSize,
    sampleRate,
    timeWindow,
    setTimeWindow,
    setCurrentSample,
    setAbsoluteTimeWindow,
    setShouldUpdateViewContext,
  ]);

  // Function to toggle heatmap visibility and process data if needed
  const toggleHeatmap = async () => {
    if (!showHeatmap && Q) {
      // If turning on and Q data is available
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
        setShowHeatmap(false); // Ensure it's off if processing fails
      }
      setIsHeatmapProcessing(false);
    } else {
      setShowHeatmap(!showHeatmap); // Toggle off or if Q is not available
    }
  };

  const handleSelectAllChannels = () => {
    onChannelSelectionChange(availableChannels);
  };

  const handleClearAllChannels = () => {
    onChannelSelectionChange([]);
  };

  return (
    <Card className="h-full flex flex-col relative">
      <PlotControls
        onPrevChunk={handlePrevChunk}
        onNextChunk={handleNextChunk}
        canGoPrev={plotState.currentChunkNumber > 1}
        canGoNext={plotState.currentChunkNumber < plotState.totalChunks}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleReset}
        onShowSettings={() => setShowZoomSettings(true)}
        isLoading={loading || networkStatus === 4}
        currentChunkNumber={plotState.currentChunkNumber}
        totalChunks={plotState.totalChunks}
        showHeatmap={showHeatmap}
        onToggleHeatmap={toggleHeatmap}
        isHeatmapProcessing={isHeatmapProcessing}
      />

      {/* Settings Dialog (QuickZoomSettings) */}
      {showZoomSettings && (
        <Dialog open={showZoomSettings} onOpenChange={setShowZoomSettings}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowZoomSettings(true)}
              className="flex items-center gap-1"
            >
              <Settings className="h-4 w-4" />
              <span>Zoom Settings</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Zoom Settings</DialogTitle>
              <DialogDescription>
                Customize how the EEG chart responds to mouse wheel zooming
              </DialogDescription>
            </DialogHeader>
            <QuickZoomSettings onClose={() => setShowZoomSettings(false)} />
          </DialogContent>
        </Dialog>
      )}

      {/* Main chart area */}
      <CardContent ref={chartAreaRef} className="flex-grow p-0 relative">
        <div className="border-b px-4 py-2 bg-muted/30">
          <h2 className="text-lg font-semibold">EEG Time Series Plot</h2>
        </div>
        {manualErrorMessage && !loading && (
          <Alert variant="destructive" className="m-4">
            <AlertDescription>{manualErrorMessage}</AlertDescription>
          </Alert>
        )}

        {/* EEGChart and Heatmap layout */}
        <div
          className={`w-full flex flex-col md:flex-row items-stretch justify-center relative gap-4`}
        >
          {/* EEG Chart always visible */}
          <div
            className={
              showHeatmap && Q
                ? "md:w-1/2 w-full h-[400px]"
                : "w-full h-[400px]"
            }
          >
            {plotState.edfData &&
            plotState.edfData.channels &&
            plotState.edfData.channels.length > 0 ? (
              <EEGChart
                eegData={plotState.edfData}
                timeWindow={timeWindow}
                selectedChannels={selectedChannels}
                annotations={annotations}
                onAnnotationSelect={handleAnnotationSelect}
                onChartClick={handleChartClick}
                zoomLevel={zoomLevel}
                onTimeWindowChange={handleTimeWindowChange}
                absoluteTimeWindow={absoluteTimeWindow}
                editMode={editMode}
                onAnnotationAdd={addAnnotation}
              />
            ) : (
              <div className="text-muted-foreground text-center w-full flex items-center justify-center h-full">
                {loading || networkStatus === 4
                  ? "Loading EEG data..."
                  : manualErrorMessage ||
                    "No data to display or plot not loaded."}
              </div>
            )}
          </div>

          {/* Heatmap visible side by side if toggled on */}
          {showHeatmap && Q && (
            <div className="md:w-1/2 w-full flex flex-col items-center justify-center relative border-l md:border-l border-t md:border-t-0 border-border">
              <div className="w-full flex justify-end p-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowHeatmap(false)}
                >
                  Close Heatmap
                </Button>
              </div>
              <DDAHeatmap
                data={ddaHeatmapData}
                // channels={Q.channels} // Commenting this out for now as Q is just the matrix
                onClose={() => setShowHeatmap(false)}
              />
            </div>
          )}
        </div>
      </CardContent>

      {/* Annotation Editor Dialog */}
      <AnnotationEditor
        filePath={filePath}
        currentSample={currentSample}
        sampleRate={sampleRate}
        initialAnnotations={annotations}
        onAnnotationsChange={setHookAnnotations}
        onAnnotationUpdate={updateAnnotation}
        onAnnotationSelect={handleAnnotationSelect}
      />
      <Card className="mt-4">
        <CardContent className="p-4">
          <ChannelSelectorUI
            availableChannels={availableChannels}
            selectedChannels={selectedChannels}
            onToggleChannel={toggleChannel}
            onSelectAllChannels={handleSelectAllChannels}
            onClearAllChannels={handleClearAllChannels}
            isLoading={loading && availableChannels.length === 0}
            error={error && availableChannels.length === 0 ? error : null}
          />
        </CardContent>
      </Card>
    </Card>
  );
}
