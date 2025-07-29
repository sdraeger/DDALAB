"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@apollo/client";
import { GET_EDF_DATA, GET_ANNOTATIONS } from "../../lib/graphql/queries";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { Spinner } from "../ui/spinner";
import { Alert, AlertDescription } from "../ui/alert";
import { ScrollArea } from "../ui/scroll-area";
import { EEGChart } from "../plot/EEGChart";
import { AnnotationEditor } from "../ui/annotation-editor";
import { ResizableContainer } from "../ui/ResizableContainer";
import { ChunkSelector } from "../ui/ChunkSelector";
import { Annotation } from "../../types/annotation";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { EEGData } from "../../types/EEGData";
import { cn } from "../../lib/utils/misc";
import { useCurrentEdfFile } from "../../hooks/useCurrentEdfFile";
import { toast } from "../ui/use-toast";
import { Slider } from "../ui/slider";
import { Progress } from "../ui/progress";
import {
  CREATE_ANNOTATION,
  DELETE_ANNOTATION,
  UPDATE_ANNOTATION,
} from "../../lib/graphql/queries";
import { plotCacheManager } from "../../lib/utils/plotCache";
import logger from "../../lib/utils/logger";
import {
  DEFAULT_CHUNK_SIZE_SECONDS,
  DEFAULT_SELECTED_CHANNELS,
  DEFAULT_TIME_WINDOW,
  DEFAULT_ABSOLUTE_TIME_WINDOW,
  DEFAULT_ZOOM_LEVEL,
  DEFAULT_PREPROCESSING_OPTIONS_STRUCT
} from "../../lib/utils/plotDefaults";

interface EDFPlotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
}

export function EDFPlotDialog({
  open,
  onOpenChange,
  filePath,
}: EDFPlotDialogProps) {
  // Use the context to manage state
  const {
    currentFilePath,
    currentPlotState,
    currentEdfData,
    currentChunkMetadata,
    selectFile,
    selectChannels,
  } = useCurrentEdfFile();

  // Only declare these variables ONCE at the top of the component:
  const chunkSizeSeconds = currentPlotState?.chunkSizeSeconds ?? DEFAULT_CHUNK_SIZE_SECONDS;
  const selectedChannels = currentPlotState?.selectedChannels ?? DEFAULT_SELECTED_CHANNELS;
  const timeWindow = currentPlotState?.timeWindow ?? DEFAULT_TIME_WINDOW;
  const absoluteTimeWindow = currentPlotState?.absoluteTimeWindow ?? DEFAULT_ABSOLUTE_TIME_WINDOW;
  const zoomLevel = currentPlotState?.zoomLevel ?? DEFAULT_ZOOM_LEVEL;
  const chunkStart = currentPlotState?.chunkStart ?? 0;
  const totalSamples = currentPlotState?.edfData?.totalSamples ?? 0;
  const sampleRate = currentPlotState?.edfData?.sampleRate ?? 256;
  const preprocessingOptions = currentPlotState?.preprocessingOptions ?? null;
  if (!currentPlotState) return null; // Or a loading/error UI

  // Local state for error handling and loading which doesn't need to be preserved
  const [loadingNewChunk, setLoadingNewChunk] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [manualErrorMessage, setManualErrorMessage] = useState<string | null>(
    null
  );
  const [nearEdge, setNearEdge] = useState<"start" | "end" | null>(null);
  const [currentSample, setCurrentSample] = useState(0);
  const chartAreaRef = useRef<HTMLDivElement>(null);

  // Add edit mode state
  const [editMode, setEditMode] = useState(false);

  // Add cache checking state
  const [cacheChecked, setCacheChecked] = useState(false);
  const [useCachedData, setUseCachedData] = useState(false);

  // Initialize state for new files
  useEffect(() => {
    if (open && filePath) {
      // Initialize plot state
      selectFile(filePath);
    }
  }, [open, filePath, selectFile]);

  // Memoize preprocessing options initialization to prevent unnecessary updates
  const initialPreprocessingOptions = useMemo(
    () =>
      preprocessingOptions || DEFAULT_PREPROCESSING_OPTIONS_STRUCT,
    [preprocessingOptions]
  );

  // State for preprocessing options with stable reference
  const [preprocessingOptionsState, setPreprocessingOptions] = useState<any>(
    initialPreprocessingOptions
  );

  // Local state for selected channels
  const [selectedChannelsLocal, setSelectedChannelsLocal] = useState<string[]>([]);
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);

  // Keep local state in sync with context only when necessary
  useEffect(() => {
    if (
      selectedChannels.length > 0 &&
      JSON.stringify(selectedChannels) !==
      JSON.stringify(selectedChannelsLocal)
    ) {
      setSelectedChannelsLocal(selectedChannels);
    }
  }, [selectedChannels]);

  // Sync preprocessing options with context only when context changes
  useEffect(() => {
    if (
      preprocessingOptionsState &&
      JSON.stringify(preprocessingOptionsState) !==
      JSON.stringify(initialPreprocessingOptions)
    ) {
      setPreprocessingOptions(preprocessingOptionsState);
    }
  }, [preprocessingOptionsState, initialPreprocessingOptions]);

  // Memoized preprocessing options updater to prevent unnecessary re-renders
  const setPreprocessingOptionsWithUpdate = useCallback(
    (newOptions: any) => {
      // Only update if options actually changed
      if (JSON.stringify(newOptions) !== JSON.stringify(preprocessingOptionsState)) {
        setPreprocessingOptions(newOptions);
        // selectFile(filePath); // This will be handled by the hook
        // updatePlotState(filePath, { // This will be handled by the hook
        //   preprocessingOptions: newOptions,
        //   edfData: null,
        // });
      }
    },
    [preprocessingOptionsState]
  );

  // Optimized event handlers with useCallback
  const handlePreprocessingChange = useCallback(
    (field: string, value: any) => {
      setPreprocessingOptions((prevOptions: any) => {
        const newOptions = { ...prevOptions, [field]: value };
        // Debounce context updates to reduce re-renders
        setTimeout(() => {
          // selectFile(filePath); // This will be handled by the hook
          // updatePlotState(filePath, { // This will be handled by the hook
          //   preprocessingOptions: newOptions,
          //   edfData: null,
          // });
        }, 100);
        return newOptions;
      });
    },
    []
  );

  // Helper functions to update specific parts of state
  const setChunkSizeSeconds = (value: number) =>
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { chunkSizeSeconds: value }); // This will be handled by the hook
    null;
  const setSelectedChannels = (value: string[]) => {
    setSelectedChannelsLocal(value);
    selectChannels(value);
  };
  const setShowPlot = (value: boolean) =>
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { showPlot: value }); // This will be handled by the hook
    null;
  const setTimeWindow = (value: [number, number]) =>
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { timeWindow: value }); // This will be handled by the hook
    null;
  const setAbsoluteTimeWindow = (value: [number, number]) =>
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { absoluteTimeWindow: value }); // This will be handled by the hook
    null;
  const setZoomLevel = (value: number) =>
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { zoomLevel: value }); // This will be handled by the hook
    null;
  const setChunkStart = (value: number) =>
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { chunkStart: value }); // This will be handled by the hook
    null;
  const setTotalSamples = (value: number) =>
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { totalSamples: value }); // This will be handled by the hook
    null;
  const setTotalDuration = (value: number) =>
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { totalDuration: value }); // This will be handled by the hook
    null;
  const setCurrentChunkNumber = (value: number) =>
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { currentChunkNumber: value }); // This will be handled by the hook
    null;
  const setTotalChunks = (value: number) =>
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { totalChunks: value }); // This will be handled by the hook
    null;

  // Calculate derived values
  const chunkSizeSamples = chunkSizeSeconds * sampleRate;

  // Check cache before making API requests
  const checkCache = useCallback(() => {
    if (!filePath || !open || cacheChecked) return;

    const cacheKey = {
      filePath,
      chunkStart,
      chunkSize: Math.round(chunkSizeSeconds * sampleRate),
      preprocessingOptions: preprocessingOptionsState,
    };

    const cachedData = plotCacheManager.getCachedPlotData(cacheKey);
    if (cachedData) {
      logger.info("EDFPlotDialog: Using cached plot data for", filePath);
      setUseCachedData(true);

      // Update plot state with cached data
      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, { // This will be handled by the hook
      //   edfData: cachedData,
      //   lastFetchTime: Date.now(),
      // });
    }

    // Check cached annotations
    const cachedAnnotations = plotCacheManager.getCachedAnnotations(filePath);
    if (cachedAnnotations) {
      logger.info("EDFPlotDialog: Using cached annotations for", filePath);
      // setAnnotations(cachedAnnotations); // This will be handled by the hook
      // updatePlotState(filePath, { annotations: cachedAnnotations }); // This will be handled by the hook
    }

    setCacheChecked(true);
  }, [
    filePath,
    open,
    chunkStart,
    chunkSizeSeconds,
    sampleRate,
    preprocessingOptionsState,
    cacheChecked,
    // selectFile, // This will be handled by the hook
    // updatePlotState, // This will be handled by the hook
  ]);

  // Check cache when dialog opens or key parameters change
  useEffect(() => {
    if (open) {
      checkCache();
    } else {
      // Reset cache check when dialog closes
      setCacheChecked(false);
      setUseCachedData(false);
    }
  }, [open, checkCache]);

  // Query for EDF data
  const { loading, error, data, refetch } = useQuery(GET_EDF_DATA, {
    variables: {
      filename: filePath,
      chunkStart: chunkStart,
      chunkSize: Math.round(chunkSizeSeconds * sampleRate),
      preprocessingOptions: preprocessingOptionsState,
      includeNavigationInfo: true,
    },
    skip:
      !open ||
      !filePath ||
      useCachedData || // Skip if we're using cached data
      (currentPlotState?.edfData !== null &&
        chunkStart === currentPlotState.chunkStart &&
        JSON.stringify(preprocessingOptionsState) ===
        JSON.stringify(currentPlotState.preprocessingOptions)),
    fetchPolicy: useCachedData ? "cache-only" : "network-only",
    errorPolicy: "all",
    onError: (err) => {
      // Check if this is a "file already opened" error
      if (
        err.message.includes("file has already been opened") &&
        retryCount < 3
      ) {
        // Exponential backoff for retries: 1s, 2s, 4s
        const delayMs = Math.pow(2, retryCount) * 1000;
        setManualErrorMessage(
          `File is busy. Retrying in ${delayMs / 1000} seconds...`
        );
        setRetryCount((prev) => prev + 1);

        // Wait with increasing delay and retry
        setTimeout(() => {
          setManualErrorMessage(null);
          refetch();
        }, delayMs);
      } else if (retryCount >= 3) {
        setManualErrorMessage(
          "Could not load data after multiple attempts. Please close and reopen the dialog."
        );
      }
    },
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
            const simulatedProgress = Math.min(downloadProgress + 5, 95);
            setDownloadProgress(simulatedProgress);
          }
        },
      },
    },
  });

  // Query for annotations
  const {
    loading: annotationsLoading,
    error: annotationsError,
    data: annotationsData,
    refetch: refetchAnnotations,
  } = useQuery(GET_ANNOTATIONS, {
    variables: {
      filePath: filePath,
    },
    skip: !open || !filePath,
    fetchPolicy: "network-only",
    errorPolicy: "all",
    onCompleted: (data) => {
      if (data?.getAnnotations) {
        // setAnnotations(data.getAnnotations); // This will be handled by the hook
        // updatePlotState(filePath, { annotations: data.getAnnotations }); // This will be handled by the hook
        // Cache the annotations
        plotCacheManager.cacheAnnotations(filePath, data.getAnnotations);
      }
    },
    onError: (err) => {
      console.warn("Error loading annotations:", err.message);
      // Don't show error toast for annotations as it's not critical
    },
  });

  // Handle preprocessing form submission (moved after refetch is defined)
  const handlePreprocessingSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      // Force refetch with new preprocessing options
      refetch({
        filename: filePath,
        chunkStart: chunkStart,
        chunkSize: Math.round(chunkSizeSeconds * sampleRate),
        preprocessingOptions: preprocessingOptionsState,
      });

      toast({
        title: "Preprocessing applied",
        description:
          "The data has been updated with your preprocessing settings.",
      });
    },
    [
      filePath,
      chunkStart,
      chunkSizeSeconds,
      sampleRate,
      preprocessingOptionsState,
      refetch,
      toast,
    ]
  );

  // Store data in cache when it's loaded
  useEffect(() => {
    if (data?.getEdfData && filePath) {
      const edfData = data.getEdfData;

      // Cache the new data
      const cacheKey = {
        filePath,
        chunkStart,
        chunkSize: Math.round(chunkSizeSeconds * sampleRate),
        preprocessingOptions: preprocessingOptionsState,
      };
      plotCacheManager.cachePlotData(cacheKey, edfData);

      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, { // This will be handled by the hook
      //   edfData: edfData,
      //   lastFetchTime: Date.now(),
      // });

      setUseCachedData(false); // Reset for next potential fetch

      // Update total samples, sample rate, and available channels
      setTotalSamples(edfData.totalSamples);
      const actualSampleRate = edfData.samplingFrequency;
      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, { sampleRate: actualSampleRate }); // This will be handled by the hook

      // Calculate and set total chunks
      if (actualSampleRate > 0 && chunkSizeSeconds > 0) {
        const calculatedChunkSizeSamples = chunkSizeSeconds * actualSampleRate;
        const newTotalChunks = Math.ceil(
          edfData.totalSamples / calculatedChunkSizeSamples
        );
        setTotalChunks(newTotalChunks);
      }

      if (edfData.channelLabels?.length > 0) {
        setAvailableChannels(edfData.channelLabels);

        // Select first few channels by default (or all if fewer)
        if (selectedChannelsLocal.length === 0) {
          const defaultChannelCount = Math.min(5, edfData.channelLabels.length);
          setSelectedChannelsLocal(
            edfData.channelLabels.slice(0, defaultChannelCount)
          );
        }
      }

      // Only reset the time window if it's the first load
      if (timeWindow[0] === 0 && timeWindow[1] === 10) {
        resetTimeWindow(chunkStart);
      }
    }
  }, [
    data,
    filePath,
    // updatePlotState, // This will be handled by the hook
    chunkStart,
    chunkSizeSeconds,
    sampleRate,
    preprocessingOptionsState,
  ]);

  // Reset time window based on chunk start
  const resetTimeWindow = (newChunkStart: number) => {
    const startSec = 0;
    // Use actual chunk duration from loaded data if available, otherwise fall back to chunkSizeSeconds
    const actualChunkDuration =
      data?.getEdfData?.chunkSize && data?.getEdfData?.samplingFrequency
        ? data.getEdfData.chunkSize / data.getEdfData.samplingFrequency
        : chunkSizeSeconds;

    const endSec = Math.min(
      actualChunkDuration,
      totalSamples / sampleRate - newChunkStart / sampleRate
    );
    setTimeWindow([startSec, endSec]);

    // Calculate absolute time window
    const absoluteStartSec = newChunkStart / sampleRate;
    setAbsoluteTimeWindow([
      absoluteStartSec + startSec,
      absoluteStartSec + endSec,
    ]);
  };

  // Reset progress when starting a new fetch
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

  // Navigate to previous chunk
  const handlePrevChunk = () => {
    const newStart = Math.max(0, chunkStart - chunkSizeSamples);
    setChunkStart(newStart);
    setLoadingNewChunk(true);
    setDownloadProgress(0);
    resetTimeWindow(newStart);
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, {}); // This will be handled by the hook
  };

  // Navigate to next chunk
  const handleNextChunk = () => {
    if (chunkStart + chunkSizeSamples < totalSamples) {
      const newStart = chunkStart + chunkSizeSamples;
      setChunkStart(newStart);
      setLoadingNewChunk(true);
      setDownloadProgress(0);
      resetTimeWindow(newStart);
      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, {}); // This will be handled by the hook
    }
  };

  // Jump to specific chunk
  const handleChunkSelect = (chunkNumber: number) => {
    // Convert chunk number (1-based) to chunk start (0-based sample position)
    const newStart = (chunkNumber - 1) * chunkSizeSamples;

    // Ensure the entire chunk fits within the total samples
    if (newStart >= 0 && newStart + chunkSizeSamples <= totalSamples) {
      setChunkStart(newStart);
      setLoadingNewChunk(true);
      setDownloadProgress(0);
      resetTimeWindow(newStart);
      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, {}); // This will be handled by the hook
    } else {
      console.log('CHUNK SELECT (EDFPlotDialog): Invalid chunk selection attempted', {
        chunkNumber,
        newStart,
        chunkSizeSamples,
        totalSamples,
        wouldExceed: newStart + chunkSizeSamples > totalSamples
      });
    }
  };

  // Check for loading completion
  useEffect(() => {
    if (loadingNewChunk && !loading) {
      setLoadingNewChunk(false);
    }
  }, [loading, loadingNewChunk]);

  // Monitor time window position relative to chunk edges
  useEffect(() => {
    if (!data?.getEdfData || !timeWindow) return;

    const chunkDuration =
      data.getEdfData.chunkSize / data.getEdfData.samplingFrequency;

    // Check if we're near the start or end of the chunk
    if (timeWindow[0] < 1) {
      setNearEdge("start");
    } else if (timeWindow[1] > chunkDuration - 1) {
      setNearEdge("end");
    } else {
      setNearEdge(null);
    }
  }, [timeWindow, data]);

  // Handle time window changes from the chart
  const handleTimeWindowChange = (newWindow: [number, number]) => {
    if (!data?.getEdfData) {
      return; // Skip if no data is loaded
    }

    // Calculate chunk duration from the loaded data
    const chunkDuration = data.getEdfData.chunkSize / data.getEdfData.samplingFrequency;

    // Calculate the proposed window duration
    const windowDuration = newWindow[1] - newWindow[0];

    // Ensure the window duration doesn't exceed the available data duration
    const maxAllowedDuration = Math.min(windowDuration, chunkDuration);

    // Validate and clamp the new window with proper bounds checking
    let validatedWindow: [number, number];

    // Check if the proposed window would go below 0 (left boundary)
    if (newWindow[0] < 0) {
      validatedWindow = [0, maxAllowedDuration];
    }
    // Check if the proposed window would exceed chunk duration (right boundary)
    else if (newWindow[1] > chunkDuration) {
      const maxStartTime = Math.max(0, chunkDuration - maxAllowedDuration);
      validatedWindow = [maxStartTime, maxStartTime + maxAllowedDuration];
    }
    // Otherwise use the proposed window but ensure it's within bounds
    else {
      validatedWindow = [
        Math.max(0, newWindow[0]),
        Math.min(chunkDuration, newWindow[1]),
      ];
    }

    setTimeWindow(validatedWindow);

    // Update absolute time window
    const absoluteStartSec = chunkStart / sampleRate;
    setAbsoluteTimeWindow([
      absoluteStartSec + validatedWindow[0],
      absoluteStartSec + validatedWindow[1],
    ]);

    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, {}); // This will be handled by the hook
  };

  // Handle zoom in button
  const handleZoomIn = () => {
    if (zoomLevel < 10 && data?.getEdfData) {
      const newZoom = zoomLevel * 1.5;
      setZoomLevel(newZoom);

      // Adjust time window to maintain center point
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) / 1.5;
      const newWindow = [
        Math.max(0, center - newDuration / 2),
        Math.min(
          data.getEdfData.chunkSize / data.getEdfData.samplingFrequency,
          center + newDuration / 2
        ),
      ] as [number, number];

      setTimeWindow(newWindow);

      // Update absolute time window
      const absoluteStartSec = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteStartSec + newWindow[0],
        absoluteStartSec + newWindow[1],
      ]);

      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, {}); // This will be handled by the hook
    }
  };

  // Handle zoom out button
  const handleZoomOut = () => {
    if (zoomLevel > 0.2 && data?.getEdfData) {
      const newZoom = zoomLevel / 1.5;
      setZoomLevel(newZoom);

      // Adjust time window to maintain center point
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) * 1.5;
      const newWindow = [
        Math.max(0, center - newDuration / 2),
        Math.min(
          data.getEdfData.chunkSize / data.getEdfData.samplingFrequency,
          center + newDuration / 2
        ),
      ] as [number, number];

      setTimeWindow(newWindow);

      // Update absolute time window
      const absoluteStartSec = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteStartSec + newWindow[0],
        absoluteStartSec + newWindow[1],
      ]);

      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, {}); // This will be handled by the hook
    }
  };

  // Reset zoom
  const handleResetZoom = () => {
    setZoomLevel(1);
    resetTimeWindow(chunkStart);
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, {}); // This will be handled by the hook
  };

  // Select or deselect a single channel
  const toggleChannel = (channel: string) => {
    if (selectedChannelsLocal.includes(channel)) {
      setSelectedChannelsLocal(selectedChannelsLocal.filter((c) => c !== channel));
    } else {
      setSelectedChannelsLocal([...selectedChannelsLocal, channel]);
    }
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, {}); // This will be handled by the hook
  };

  // Select all channels
  const selectAllChannels = () => {
    setSelectedChannelsLocal([...availableChannels]);
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, {}); // This will be handled by the hook
  };

  // Deselect all channels
  const deselectAllChannels = () => {
    setSelectedChannelsLocal([]);
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, {}); // This will be handled by the hook
  };

  // Convert to EEGData format (use cached data if available)
  const convertToEEGData = (): EEGData | null => {
    // Use cached data if available for the current chunk
    const edfDataToUse =
      currentPlotState?.edfData && chunkStart === currentPlotState.chunkStart
        ? currentPlotState.edfData
        : data?.getEdfData;

    if (!edfDataToUse) return null;

    try {
      const actualChunkDuration =
        edfDataToUse.chunkSize / edfDataToUse.samplingFrequency;

      // Calculate absolute time position in the file
      const absoluteStartSec = chunkStart / edfDataToUse.samplingFrequency;

      // Filter annotations to only include those within the current chunk
      const chunkEndSample = chunkStart + edfDataToUse.chunkSize;
      const chunkAnnotations = (currentPlotState?.annotations || []).filter(
        (annotation) =>
          annotation.startTime >= chunkStart &&
          annotation.startTime < chunkEndSample
      );

      return {
        channels: edfDataToUse.channelLabels,
        samplesPerChannel: edfDataToUse.chunkSize,
        sampleRate: edfDataToUse.samplingFrequency,
        data: edfDataToUse.data,
        startTime: edfDataToUse.startTime || new Date().toISOString(),
        duration: actualChunkDuration, // Use actual duration from the data
        absoluteStartTime: absoluteStartSec, // Add absolute start time for x-axis positioning
        annotations: chunkAnnotations,
      };
    } catch (err) {
      console.error("Error converting EDF data:", err);
      setManualErrorMessage(
        `Error converting data: ${err instanceof Error ? err.message : "Unknown error"
        }`
      );
      return null;
    }
  };

  const eegData = convertToEEGData();

  // Add state for annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // Load cached annotations when the component mounts
  useEffect(() => {
    if (currentPlotState?.annotations) {
      setAnnotations(currentPlotState.annotations);
    }
  }, [currentPlotState?.annotations]);

  // Handle annotation change
  const handleAnnotationChange = (updatedAnnotations: Annotation[]) => {
    setAnnotations(updatedAnnotations);
    // selectFile(filePath); // This will be handled by the hook
    // updatePlotState(filePath, { annotations: updatedAnnotations }); // This will be handled by the hook
  };

  // Handle annotation update from the AnnotationEditor
  const handleAnnotationUpdate = (
    id: number,
    annotationData: Partial<Annotation>
  ) => {
    updateAnnotation({
      variables: {
        id,
        annotationInput: {
          filePath: annotationData.filePath || filePath,
          startTime: annotationData.startTime || 0,
          endTime: annotationData.endTime,
          text: annotationData.text || "",
        },
      },
    });
  };

  // Handle annotation selection
  const handleAnnotationSelect = (annotation: Annotation) => {
    const chunkStartSample = chunkStart;
    const chunkEndSample = chunkStart + chunkSizeSamples;

    // Check if the annotation is within the current chunk
    if (
      annotation.startTime >= chunkStartSample &&
      annotation.startTime <= chunkEndSample
    ) {
      // Update the time window to center on the annotation
      const annotationTime = (annotation.startTime - chunkStart) / sampleRate;
      const halfWindowSize = (timeWindow[1] - timeWindow[0]) / 2;

      const newLocalWindow = [
        Math.max(0, annotationTime - halfWindowSize),
        Math.min(eegData?.duration || 10, annotationTime + halfWindowSize),
      ] as [number, number];

      setTimeWindow(newLocalWindow);
      setCurrentSample(annotation.startTime);

      // Update absolute time window
      const absoluteChunkStart = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteChunkStart + newLocalWindow[0],
        absoluteChunkStart + newLocalWindow[1],
      ]);

      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, {}); // This will be handled by the hook
    } else {
      // If annotation is outside current chunk, navigate to the correct chunk
      const newChunkStart = Math.max(
        0,
        annotation.startTime - Math.floor(chunkSizeSamples / 2)
      );
      setChunkStart(newChunkStart);
      setCurrentSample(annotation.startTime);

      // Reset time window - will be updated when data loads
      resetTimeWindow(newChunkStart);
      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, {}); // This will be handled by the hook

      toast({
        title: "Loading new chunk",
        description:
          "Navigating to the chunk containing the selected annotation.",
      });
    }
  };

  // Handle chart click to update current sample
  const handleChartClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!chartAreaRef.current || !eegData) return;

    const rect = chartAreaRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const relativeX = x / rect.width;
    const timeOffset =
      timeWindow[0] + relativeX * (timeWindow[1] - timeWindow[0]);

    // Convert time to sample position
    const samplePosition = chunkStart + Math.floor(timeOffset * sampleRate);
    setCurrentSample(samplePosition);
  };

  // Mutations for handling annotations
  const [createAnnotation] = useMutation(CREATE_ANNOTATION, {
    onCompleted: (data) => {
      const newAnnotation = data.createAnnotation;
      // Update annotations list with the newly created one
      const updatedAnnotations = [...(annotations || []), newAnnotation];
      setAnnotations(updatedAnnotations);
      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, { annotations: updatedAnnotations }); // This will be handled by the hook

      // Cache the updated annotations
      plotCacheManager.cacheAnnotations(filePath, updatedAnnotations);

      toast({
        title: "Annotation added",
        description: "Your annotation has been saved.",
      });

      // Refetch annotations to ensure consistency
      refetchAnnotations();
    },
    onError: (error) => {
      toast({
        title: "Error creating annotation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [updateAnnotation] = useMutation(UPDATE_ANNOTATION, {
    onCompleted: (data) => {
      const updatedAnnotation = data.updateAnnotation;
      // Update annotations list with the updated one
      const updatedAnnotations =
        annotations?.map((annotation) =>
          annotation.id === updatedAnnotation.id
            ? updatedAnnotation
            : annotation
        ) || [];
      setAnnotations(updatedAnnotations);
      // selectFile(filePath); // This will be handled by the hook
      // updatePlotState(filePath, { annotations: updatedAnnotations }); // This will be handled by the hook

      // Cache the updated annotations
      plotCacheManager.cacheAnnotations(filePath, updatedAnnotations);

      toast({
        title: "Annotation updated",
        description: "Your annotation has been updated.",
      });

      // Refetch annotations to ensure consistency
      refetchAnnotations();
    },
    onError: (error) => {
      toast({
        title: "Error updating annotation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [deleteAnnotation] = useMutation(DELETE_ANNOTATION, {
    onCompleted: () => {
      // Refetch annotations to ensure consistency
      refetchAnnotations();

      toast({
        title: "Annotation deleted",
        description: "Your annotation has been removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error deleting annotation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Handle annotation creation
  const handleAddAnnotation = (annotationData: Partial<Annotation>) => {
    createAnnotation({
      variables: {
        annotationInput: {
          filePath: annotationData.filePath,
          startTime: annotationData.startTime,
          endTime: null,
          text: annotationData.text,
        },
      },
    });
  };

  // Handle annotation deletion
  const handleDeleteAnnotation = (id: number) => {
    deleteAnnotation({
      variables: { id },
      update: (cache) => {
        // Update local state after deletion
        const updatedAnnotations =
          annotations?.filter((annotation) => annotation.id !== id) || [];
        setAnnotations(updatedAnnotations);
        // selectFile(filePath); // This will be handled by the hook
        // updatePlotState(filePath, { annotations: updatedAnnotations }); // This will be handled by the hook
      },
      context: {
        fetchOptions: {
          credentials: "include", // Ensure cookies are sent
        },
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-full flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>EDF Plot: {filePath}</DialogTitle>

          {/* Chunk and navigation info */}
          {eegData && (
            <div className="flex items-center gap-4 text-sm">
              <div>
                <span className="font-medium">Channels:</span>{" "}
                {eegData.channels?.length || 0}
              </div>
              <div>
                <span className="font-medium">Sample Rate:</span>{" "}
                {eegData.sampleRate} Hz
              </div>
              <div>
                <span className="font-medium">Position:</span>{" "}
                {(chunkStart / sampleRate).toFixed(1)}s -{" "}
                {(
                  (chunkStart + data?.getEdfData?.chunkSize || 0) / sampleRate
                ).toFixed(1)}
                s / {(totalSamples / sampleRate).toFixed(1)}s
              </div>
            </div>
          )}

          {/* Download progress indicator */}
          {downloadProgress > 0 && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Downloading data</span>
                <span>{Math.min(downloadProgress, 100).toFixed(0)}%</span>
              </div>
              <Progress
                value={Math.min(downloadProgress, 100)}
                className="h-1"
              />
            </div>
          )}
        </DialogHeader>

        <div className="flex-grow min-h-0 relative flex flex-col">
          {/* Error display */}
          {(error || manualErrorMessage) && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                {manualErrorMessage || `Error: ${error?.message}`}
              </AlertDescription>
            </Alert>
          )}

          {/* Main content */}
          <div className="grid grid-cols-5 gap-6 h-full overflow-hidden">
            {/* Chart area */}
            <div
              className="col-span-3 relative min-h-[500px]"
              ref={chartAreaRef}
            >
              {/* Add floating edit button */}
              <Button
                variant={editMode ? "destructive" : "default"}
                size="icon"
                className="absolute top-4 left-4 z-30 rounded-full shadow-lg h-12 w-12"
                onClick={() => setEditMode(!editMode)}
                title={editMode ? "Exit Edit Mode" : "Edit Annotations"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-pencil"
                >
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path d="m15 5 4 4" />
                </svg>
              </Button>

              {/* Loading state */}
              {(loading || loadingNewChunk) && (
                <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
                  <Spinner size="lg" />
                </div>
              )}

              {/* Navigation cues */}
              {nearEdge === "start" && !loading && (
                <button
                  className="absolute left-0 top-1/2 transform -translate-y-1/2 h-1/2 w-16 z-10
                             bg-gradient-to-r from-primary/20 to-transparent hover:from-primary/40
                             flex items-center justify-start pl-2 rounded-r-lg"
                  onClick={handlePrevChunk}
                  disabled={chunkStart === 0}
                >
                  <ChevronLeft
                    className={cn(
                      "h-8 w-8",
                      chunkStart === 0
                        ? "text-muted-foreground"
                        : "text-primary"
                    )}
                  />
                </button>
              )}

              {nearEdge === "end" && !loading && (
                <button
                  className="absolute right-0 top-1/2 transform -translate-y-1/2 h-1/2 w-16 z-10
                             bg-gradient-to-l from-primary/20 to-transparent hover:from-primary/40
                             flex items-center justify-end pr-2 rounded-l-lg"
                  onClick={handleNextChunk}
                  disabled={chunkStart + chunkSizeSamples >= totalSamples}
                >
                  <ChevronRight
                    className={cn(
                      "h-8 w-8",
                      chunkStart + chunkSizeSamples >= totalSamples
                        ? "text-muted-foreground"
                        : "text-primary"
                    )}
                  />
                </button>
              )}

              {/* EEG Chart */}
              <ResizableContainer
                className="flex-1 overflow-hidden relative"
                storageKey={`edf-dialog-plot-height-${filePath}`}
                defaultHeight={600}
                minHeight={300}
                maxHeight={1200}
              >
                {editMode && (
                  <div className="absolute top-2 left-0 right-0 mx-auto w-fit z-30 bg-blue-600 text-white px-4 py-2 rounded-md shadow-lg text-center">
                    <p className="font-medium">Edit Mode Active</p>
                    <p className="text-sm">
                      Click on the plot to add annotations. Right-click on
                      existing annotations to delete them.
                    </p>
                  </div>
                )}

                {loading ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <Spinner size="lg" />
                    <div className="mt-4 text-sm text-muted-foreground">
                      Loading EDF data...
                    </div>
                    {downloadProgress > 0 && (
                      <Progress
                        value={downloadProgress}
                        className="w-1/2 mt-2"
                      />
                    )}
                  </div>
                ) : error || manualErrorMessage ? (
                  <Alert variant="destructive" className="mt-4">
                    <AlertDescription>
                      {manualErrorMessage || error?.message || "Unknown error"}
                    </AlertDescription>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        setManualErrorMessage(null);
                        setRetryCount(retryCount + 1);
                        refetch();
                      }}
                    >
                      Retry
                    </Button>
                  </Alert>
                ) : !eegData || selectedChannels.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    {eegData ? (
                      <div>Please select at least one channel to display</div>
                    ) : (
                      <div>No data available</div>
                    )}
                  </div>
                ) : (
                  (() => {
                    return (
                      <EEGChart
                        eegData={eegData}
                        selectedChannels={selectedChannelsLocal}
                        timeWindow={timeWindow}
                        absoluteTimeWindow={absoluteTimeWindow}
                        zoomLevel={zoomLevel}
                        onTimeWindowChange={handleTimeWindowChange}
                        className="w-full h-full"
                        height="100%"
                        editMode={editMode}
                        onAnnotationAdd={handleAddAnnotation}
                        onAnnotationDelete={handleDeleteAnnotation}
                        filePath={filePath}
                        annotations={annotations}
                        onAnnotationSelect={handleAnnotationSelect}
                        onChartClick={handleChartClick}
                      />
                    );
                  })()
                )}
              </ResizableContainer>

              {/* Zoom controls */}
              <div className="absolute top-4 right-4 flex flex-col space-y-2">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={handleZoomIn}
                  disabled={zoomLevel >= 10}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={handleZoomOut}
                  disabled={zoomLevel <= 0.2}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={handleResetZoom}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Controls panel */}
            <div className="col-span-2 h-full overflow-hidden flex flex-col">
              <ScrollArea className="flex-grow">
                {eegData && (
                  <>
                    <div className="flex justify-between items-center mt-2">
                      <Label>Select Channels:</Label>
                      <div className="space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={selectAllChannels}
                          disabled={!availableChannels.length}
                        >
                          Select All
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={deselectAllChannels}
                          disabled={!selectedChannels.length}
                        >
                          Deselect All
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      {error ? (
                        <div className="text-red-500 p-2 border border-red-200 rounded-md">
                          Error loading channels: {error.message}
                        </div>
                      ) : loading ? (
                        <div className="text-center text-muted-foreground p-2">
                          Loading channels...
                        </div>
                      ) : availableChannels.length === 0 ? (
                        <div className="text-center text-muted-foreground p-2">
                          No channels available
                        </div>
                      ) : (
                        availableChannels.map((channel) => (
                          <div
                            key={channel}
                            className="flex items-center space-x-2"
                          >
                            <Checkbox
                              id={`channel-${channel}`}
                              checked={selectedChannels.includes(channel)}
                              onCheckedChange={() => toggleChannel(channel)}
                            />
                            <Label
                              htmlFor={`channel-${channel}`}
                              className="cursor-pointer"
                            >
                              {channel}
                            </Label>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Preprocessing Options Section */}
                    <div className="mt-6">
                      <h3 className="text-sm font-medium mb-2">
                        Preprocessing Options
                      </h3>
                      <form
                        onSubmit={handlePreprocessingSubmit}
                        className="space-y-4"
                      >
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="removeOutliers"
                            checked={preprocessingOptionsState.removeOutliers}
                            onCheckedChange={(checked) =>
                              handlePreprocessingChange(
                                "removeOutliers",
                                checked
                              )
                            }
                          />
                          <Label htmlFor="removeOutliers">
                            Remove outliers
                          </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="smoothing"
                            checked={preprocessingOptionsState.smoothing}
                            onCheckedChange={(checked) =>
                              handlePreprocessingChange("smoothing", checked)
                            }
                          />
                          <Label htmlFor="smoothing">Apply smoothing</Label>
                        </div>

                        {preprocessingOptionsState.smoothing && (
                          <div className="space-y-2">
                            <Label htmlFor="smoothingWindow">
                              Smoothing window:{" "}
                              {preprocessingOptionsState.smoothingWindow}
                            </Label>
                            <Slider
                              id="smoothingWindow"
                              min={3}
                              max={15}
                              step={2}
                              value={[preprocessingOptionsState.smoothingWindow]}
                              onValueChange={(values) =>
                                handlePreprocessingChange(
                                  "smoothingWindow",
                                  values[0]
                                )
                              }
                            />
                          </div>
                        )}

                        <div className="space-y-2">
                          <Label htmlFor="normalization">Normalization</Label>
                          <select
                            id="normalization"
                            className="w-full rounded-md border border-input bg-background px-3 py-2"
                            value={preprocessingOptionsState.normalization}
                            onChange={(e) =>
                              handlePreprocessingChange(
                                "normalization",
                                e.target.value
                              )
                            }
                          >
                            <option value="none">None</option>
                            <option value="minmax">Min-Max</option>
                            <option value="zscore">Z-Score</option>
                          </select>
                        </div>

                        <Button type="submit" className="w-full">
                          Apply Preprocessing
                        </Button>
                      </form>
                    </div>

                    {/* Annotation editor (only show in non-edit mode) */}
                    {!editMode && (
                      <div className="border-t p-4 h-60 overflow-auto">
                        <AnnotationEditor
                          filePath={filePath}
                          currentSample={currentSample}
                          sampleRate={
                            data?.getEdfData?.samplingFrequency || sampleRate
                          }
                          initialAnnotations={annotations}
                          onAnnotationsChange={handleAnnotationChange}
                          onAnnotationUpdate={handleAnnotationUpdate}
                        />
                      </div>
                    )}
                  </>
                )}
              </ScrollArea>
            </div>
          </div>
        </div>

        <DialogFooter className="space-x-2">
          <div className="flex-1 flex items-center justify-start gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handlePrevChunk}
                disabled={chunkStart === 0 || loading}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <Button
                variant="outline"
                onClick={handleNextChunk}
                disabled={
                  chunkStart + chunkSizeSamples >= totalSamples || loading
                }
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            {totalSamples > 0 && (
              <ChunkSelector
                currentChunk={Math.floor(chunkStart / chunkSizeSamples) + 1}
                totalChunks={Math.ceil(totalSamples / chunkSizeSamples)}
                onChunkSelect={handleChunkSelect}
                variant="compact"
              />
            )}
          </div>

          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
