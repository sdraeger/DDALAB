"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@apollo/client";
import {
  GET_EDF_DATA,
  GET_DDA_TASK_RESULT,
  CREATE_ANNOTATION,
  DELETE_ANNOTATION,
  UPDATE_ANNOTATION,
  GET_ANNOTATIONS,
} from "@/lib/graphql/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { EEGChart } from "@/components/eeg-chart";
import { useToast } from "@/components/ui/use-toast";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Settings,
} from "lucide-react";
import type { EEGData } from "@/components/eeg-dashboard";
import { AnnotationEditor, Annotation } from "@/components/annotation-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EEGZoomSettings } from "@/components/eeg-zoom-settings";
import { useEDFPlot } from "@/contexts/edf-plot-context";
import { useSession } from "next-auth/react";
import logger from "@/lib/utils/logger";

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
  onChunkLoaded?: (data: EEGData) => void;
  preprocessingOptions?: any;
}

export function DDAPlot({
  filePath,
  taskId,
  onChunkLoaded,
  preprocessingOptions: externalPreprocessingOptions,
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
  const [showZoomControls, setShowZoomControls] = useState(false);
  const [showZoomSettings, setShowZoomSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [manualErrorMessage, setManualErrorMessage] = useState<string | null>(
    null
  );
  const [annotations, setAnnotations] = useState<Annotation[]>(
    plotState.annotations || []
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const { data: session, status } = useSession();
  const user = session?.user;

  // Add state to track annotation edit mode
  const [editMode, setEditMode] = useState(false);

  // Add state to track the annotation to focus on after loading a chunk
  const [targetAnnotationAfterLoad, setTargetAnnotationAfterLoad] =
    useState<Annotation | null>(null);

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
  const [selectedChannels, setSelectedChannels] = useState<string[]>(
    plotState.selectedChannels || []
  );
  const [zoomLevel, setZoomLevel] = useState(plotState.zoomLevel || 1);

  // Initialize preprocessing options - making sure to not interpret defaults as active preprocessing
  const defaultPreprocessingOptions = {
    removeOutliers: false,
    smoothing: false,
    smoothingWindow: 3, // Smaller default value, more appropriate for shorter windows
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
    // Use a ref to track if we've already processed this options object
    const optionsKey = JSON.stringify(preprocessingOptions);
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
  const { loading, error, data, refetch } = useQuery(GET_EDF_DATA, {
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
  });

  // Query for annotations
  const {
    data: annotationsData,
    loading: annotationsLoading,
    error: annotationsError,
  } = useQuery(GET_ANNOTATIONS, {
    variables: { filePath },
    skip: !filePath,
    fetchPolicy: "network-only",
  });

  // Update annotations when data is loaded from server
  useEffect(() => {
    if (annotationsData?.getAnnotations) {
      setAnnotations(annotationsData.getAnnotations);
      // Also update plot state to keep context in sync
      if (filePath) {
        updatePlotState(filePath, {
          annotations: annotationsData.getAnnotations,
        });
      }
    }
  }, [annotationsData, filePath, updatePlotState]);

  // Reset shouldLoadChunk after data is loaded
  useEffect(() => {
    if (data && shouldLoadChunk) {
      logger.info("Data loaded, resetting shouldLoadChunk flag");
      setShouldLoadChunk(false);
    }
  }, [data, shouldLoadChunk]);

  // Debug log when shouldLoadChunk changes
  useEffect(() => {
    logger.info(`shouldLoadChunk changed to: ${shouldLoadChunk}`);
  }, [shouldLoadChunk]);

  // Query for DDA results if task ID is provided
  const {
    loading: ddaLoading,
    error: ddaError,
    data: ddaData,
  } = useQuery(GET_DDA_TASK_RESULT, {
    variables: {
      taskId,
    },
    skip: !taskId,
    notifyOnNetworkStatusChange: true,
    fetchPolicy: "network-only",
  });

  // Store the data in the context when it's loaded
  useEffect(() => {
    if (data?.getEdfData && filePath) {
      updatePlotState(filePath, {
        edfData: data.getEdfData,
        lastFetchTime: Date.now(),
        // Only store preprocessing options if they're actually active
        preprocessingOptions: hasActivePreprocessing(preprocessingOptions)
          ? preprocessingOptions
          : null,
      });
    }
  }, [data, filePath, updatePlotState, preprocessingOptions]);

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

        // Select first 5 channels by default (or all if fewer)
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
    selectedChannels,
    chunkStart,
    timeWindow,
  ]);

  // Handle annotation changes
  const handleAnnotationsChange = (updatedAnnotations: Annotation[]) => {
    setAnnotations(updatedAnnotations);
    if (filePath) {
      updatePlotState(filePath, { annotations: updatedAnnotations });
    }
  };

  // Convert data to EEGData format for the chart component (use cached data if available)
  const convertToEEGData = (): EEGData | null => {
    // Use cached data if available
    const edfDataToUse =
      plotState.edfData && chunkStart === plotState.chunkStart
        ? plotState.edfData
        : data?.getEdfData;

    if (!edfDataToUse) return null;

    try {
      // Log the actual data received
      logger.info(
        `Received data: samples=${edfDataToUse.chunkSize}, samplingFrequency=${edfDataToUse.samplingFrequency}`
      );
      logger.info(
        `Duration: ${
          edfDataToUse.chunkSize / edfDataToUse.samplingFrequency
        } seconds`
      );

      const actualChunkDuration =
        edfDataToUse.chunkSize / edfDataToUse.samplingFrequency;
      const absoluteStartSec = chunkStart / edfDataToUse.samplingFrequency;

      const eegData = {
        channels: edfDataToUse.channelLabels,
        samplesPerChannel: edfDataToUse.chunkSize,
        sampleRate: edfDataToUse.samplingFrequency,
        data: edfDataToUse.data,
        startTime: new Date(),
        duration: actualChunkDuration,
        absoluteStartTime: absoluteStartSec,
        annotations: annotations,
      };

      if (onChunkLoaded) {
        onChunkLoaded(eegData);
      }

      return eegData;
    } catch (err) {
      console.error("Error converting EDF data:", err);
      setManualErrorMessage(
        `Error converting data: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
      return null;
    }
  };

  const eegData = convertToEEGData();

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
    if (zoomLevel < 10 && eegData) {
      const newZoom = zoomLevel * 1.5;
      setZoomLevel(newZoom);

      // Adjust time window to maintain center point
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) / 1.5;
      const newLocalWindow = [
        Math.max(0, center - newDuration / 2),
        Math.min(eegData.duration, center + newDuration / 2),
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
    if (zoomLevel > 0.1 && eegData) {
      const newZoom = zoomLevel / 1.5;
      setZoomLevel(newZoom);

      // Adjust time window to maintain center point
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) * 1.5;
      const newLocalWindow = [
        Math.max(0, center - newDuration / 2),
        Math.min(eegData.duration, center + newDuration / 2),
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
    if (eegData) {
      setZoomLevel(1);
      setTimeWindow([0, eegData.duration]);

      const absoluteChunkStart = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteChunkStart,
        absoluteChunkStart + eegData.duration,
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

    if (eegData?.absoluteStartTime !== undefined) {
      setAbsoluteTimeWindow([
        eegData.absoluteStartTime + newWindow[0],
        eegData.absoluteStartTime + newWindow[1],
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
        selectedChannels,
        // Only store preprocessing options if they're actually active
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
    selectedChannels,
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
    setSelectedChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((ch) => ch !== channel)
        : [...prev, channel]
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

  // Handle chart click to update current sample
  const handleChartClick = (e: React.MouseEvent<HTMLDivElement>) => {
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

  // Add mutation hooks for annotation management
  const [createAnnotation] = useMutation(CREATE_ANNOTATION, {
    onCompleted: (data) => {
      const newAnnotation = data.createAnnotation;
      // Update annotations list with the newly created one
      const updatedAnnotations = [...(annotations || []), newAnnotation];
      setAnnotations(updatedAnnotations);
      updatePlotState(filePath, { annotations: updatedAnnotations });

      toast({
        title: "Annotation added",
        description: "Your annotation has been saved.",
      });
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
      updatePlotState(filePath, { annotations: updatedAnnotations });

      toast({
        title: "Annotation updated",
        description: "Your annotation has been updated.",
      });
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

  // Update annotation handlers to use mutations
  const handleAnnotationAdd = (annotationData: Partial<Annotation>) => {
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

  const handleAnnotationDelete = (id: number) => {
    deleteAnnotation({
      variables: { id },
      update: (cache) => {
        // Update local state after deletion
        const updatedAnnotations =
          annotations?.filter((annotation) => annotation.id !== id) || [];
        setAnnotations(updatedAnnotations);
        updatePlotState(filePath, { annotations: updatedAnnotations });
      },
      context: {
        fetchOptions: {
          credentials: "include", // Ensure cookies are sent
        },
      },
    });
  };

  // Handle annotation updates
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
    if (eegData && targetAnnotationAfterLoad && !loading) {
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
    eegData,
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
      {/* Main EEG chart area - takes 4/6 of the space */}
      <div className="md:col-span-4">
        <Card>
          <CardContent className="p-4">
            {/* Control buttons */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Button
                size="sm"
                variant="outline"
                onClick={handlePrevChunk}
                disabled={loading || chunkStart <= 0}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Prev
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={handleNextChunk}
                disabled={loading || chunkStart + chunkSize >= totalSamples}
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleZoomIn}
                  title="Zoom In"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleZoomOut}
                  title="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReset}
                  title="Reset Zoom"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>

              {/* Edit Annotations button */}
              <Button
                size="sm"
                variant={editMode ? "destructive" : "outline"}
                onClick={() => setEditMode(!editMode)}
                title={editMode ? "Exit Edit Mode" : "Edit Annotations"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 mr-2"
                >
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path d="m15 5 4 4" />
                </svg>
                {editMode ? "Exit Edit Mode" : "Edit Annotations"}
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowZoomSettings(true)}
                className="ml-auto"
              >
                <Settings className="h-4 w-4 mr-1" /> Settings
              </Button>
            </div>

            {/* Download progress indicator */}
            {downloadProgress > 0 && (
              <div className="mb-4">
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

            {(loading || ddaLoading) && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                <Spinner size="lg" variant="loader" />
              </div>
            )}

            {/* Display errors if any */}
            {(error || manualErrorMessage || ddaError) && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  {error
                    ? `Error loading EDF data: ${error.message}`
                    : manualErrorMessage
                      ? manualErrorMessage
                      : ddaError
                        ? `Error loading DDA results: ${ddaError.message}`
                        : "An unknown error occurred"}
                </AlertDescription>
              </Alert>
            )}

            {/* Chart container */}
            <div
              ref={chartAreaRef}
              className="w-full h-[calc(100vh-300px)] border rounded-md relative overflow-hidden"
            >
              {eegData && selectedChannels.length > 0 ? (
                <div
                  onClick={handleChartClick}
                  className="w-full h-full absolute inset-0"
                >
                  <EEGChart
                    eegData={eegData}
                    selectedChannels={selectedChannels}
                    timeWindow={timeWindow}
                    absoluteTimeWindow={absoluteTimeWindow}
                    zoomLevel={zoomLevel}
                    onTimeWindowChange={handleTimeWindowChange}
                    customZoomFactor={user?.preferences?.eegZoomFactor}
                    className="w-full h-full"
                    editMode={editMode}
                    onAnnotationAdd={handleAnnotationAdd}
                    onAnnotationDelete={handleAnnotationDelete}
                    filePath={filePath}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  {!eegData
                    ? "No data available"
                    : selectedChannels.length === 0
                      ? "No channels selected"
                      : "Loading data..."}
                </div>
              )}
            </div>

            {/* DDA Results overlay */}
            {ddaData?.getDdaResult?.peaks && (
              <div className="mt-4 p-2 border rounded bg-muted/20">
                <h3 className="text-sm font-medium mb-2">
                  DDA Analysis Results
                </h3>
                <p className="text-xs text-muted-foreground">
                  Peaks detected:{" "}
                  {Array.isArray(ddaData.getDdaResult.peaks)
                    ? ddaData.getDdaResult.peaks.length
                    : "N/A"}
                </p>
                {/* Additional DDA result visualizations could be added here */}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Controls sidebar - takes 2/6 of the space */}
      <div className="md:col-span-2">
        <Card>
          <CardContent className="p-4 space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-3">Navigation</h3>

              {/* Chunk position indicator */}
              <div className="mb-4 bg-muted/30 p-3 rounded-md border">
                <p className="text-sm font-medium mb-2">
                  Position:{" "}
                  <span className="text-primary">
                    {positionPercentage.toFixed(1)}%
                  </span>
                  {sampleRate > 0 && (
                    <span className="ml-1">
                      ({formatTime(chunkStart / sampleRate)})
                    </span>
                  )}
                </p>
                <div className="w-full bg-muted h-3 rounded-full">
                  <div
                    className="bg-primary h-3 rounded-full"
                    style={{ width: `${positionPercentage}%` }}
                  />
                </div>
              </div>

              {/* Navigation buttons */}
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  size="default"
                  onClick={handlePrevChunk}
                  disabled={chunkStart <= 0}
                  className="flex items-center justify-center"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  onClick={handleNextChunk}
                  disabled={chunkStart + chunkSize >= totalSamples}
                  className="flex items-center justify-center"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium">Chunk Settings</h3>

              <div className="p-3 bg-muted/30 rounded-md border space-y-3">
                <div>
                  <Label
                    htmlFor="chunkSize"
                    className="text-sm font-medium mb-2 block"
                  >
                    Chunk size (samples)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="chunkSize"
                      value={chunkSize}
                      onChange={handleChunkSizeChange}
                      type="number"
                      min="100"
                      max="100000"
                      className="flex-1"
                    />
                    <Button
                      variant="default"
                      size="default"
                      onClick={handleLoadChunk}
                    >
                      Load
                    </Button>
                  </div>
                </div>

                {sampleRate > 0 && (
                  <div className="bg-background/50 p-2 rounded-md border border-dashed">
                    <p className="text-xs">
                      <span className="font-medium">Duration:</span>{" "}
                      {(chunkSize / sampleRate).toFixed(1)} seconds at{" "}
                      <span className="font-medium">{sampleRate}Hz</span>
                    </p>
                    {data?.getEdfData?.chunkSize &&
                      data.getEdfData.chunkSize !== chunkSize && (
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="font-medium">Actual:</span>{" "}
                          {(data.getEdfData.chunkSize / sampleRate).toFixed(1)}{" "}
                          seconds ({data.getEdfData.chunkSize} samples)
                        </p>
                      )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium mb-2">Channel Selection</h3>
              <div className="space-y-1 max-h-[250px] overflow-y-auto border rounded-md p-2">
                {error ? (
                  <p className="text-center text-red-500 py-2">
                    Error loading channels: {error.message}
                  </p>
                ) : availableChannels.length > 0 ? (
                  <div className="grid grid-cols-2 gap-1">
                    {availableChannels.map((channel) => (
                      <div key={channel} className="flex items-center">
                        <Button
                          variant={
                            selectedChannels.includes(channel)
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() => toggleChannel(channel)}
                          className="w-full justify-start text-xs py-1 h-7 truncate"
                          title={channel}
                        >
                          {channel}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : loading ? (
                  <p className="text-center text-muted-foreground py-2">
                    Loading channels...
                  </p>
                ) : (
                  <p className="text-center text-muted-foreground py-2">
                    No channels available
                  </p>
                )}
              </div>

              {availableChannels.length > 0 && (
                <div className="flex gap-2 mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedChannels(availableChannels)}
                    className="flex-1 text-xs"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedChannels([])}
                    className="flex-1 text-xs"
                  >
                    Clear
                  </Button>
                </div>
              )}
            </div>

            {/* File info */}
            <div>
              <h3 className="text-sm font-medium mb-2">File Info</h3>
              <div className="bg-muted/30 p-3 rounded-md border">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <p className="text-xs font-medium">Sampling rate</p>
                    <p className="text-sm">{sampleRate} Hz</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium">Channels</p>
                    <p className="text-sm">{availableChannels.length}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium">Total length</p>
                  <p className="text-sm">
                    {sampleRate > 0
                      ? formatTime(totalSamples / sampleRate)
                      : "Unknown"}
                  </p>
                </div>

                {/* Preprocessing indicator */}
                {hasActivePreprocessing(preprocessingOptions) && (
                  <div className="mt-3 border-t pt-3">
                    <p className="text-xs font-medium mb-1">
                      Active preprocessing
                    </p>
                    <div className="bg-primary/20 text-primary text-xs rounded-md px-3 py-2 flex items-start">
                      <Settings className="h-3 w-3 mr-2 mt-0.5" />
                      <span>
                        {preprocessingOptions.removeOutliers
                          ? "Outliers removed, "
                          : ""}
                        {preprocessingOptions.smoothing
                          ? `Smoothed (${preprocessingOptions.smoothingWindow}), `
                          : ""}
                        {preprocessingOptions.normalization !== "none"
                          ? `${preprocessingOptions.normalization} norm.`
                          : ""}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Add annotations section */}
            <div>
              <AnnotationEditor
                filePath={filePath}
                currentSample={currentSample}
                sampleRate={sampleRate}
                initialAnnotations={annotations}
                onAnnotationsChange={handleAnnotationsChange}
                onAnnotationUpdate={handleAnnotationUpdate}
                onAnnotationSelect={handleAnnotationSelect}
              />
            </div>

            {/* Zoom settings button */}
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
