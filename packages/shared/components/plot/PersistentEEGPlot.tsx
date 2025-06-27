"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@apollo/client";
import {
  GET_EDF_DATA,
  GET_EDF_DEFAULT_CHANNELS,
} from "../../lib/graphql/queries";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { Spinner } from "../ui/spinner";
import { Alert, AlertDescription } from "../ui/alert";
import { ScrollArea } from "../ui/scroll-area";
import { EEGChart } from "./EEGChart";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { EEGData } from "../../types/EEGData";
import { cn } from "../../lib/utils/misc";
import { useEDFPlot } from "../../contexts/EDFPlotContext";
import { Progress } from "../ui/progress";
import { plotCacheManager } from "../../lib/utils/plotCache";
import logger from "../../lib/utils/logger";
import { ResizableContainer } from "../ui/ResizableContainer";
import { ChunkSelector } from "../ui/ChunkSelector";
import { useLoadingManager } from "../../hooks/useLoadingManager";
import { LoadingOverlay } from "../ui/loading-overlay";

interface PersistentEEGPlotProps {
  filePath: string;
  className?: string;
}

export function PersistentEEGPlot({
  filePath,
  className,
}: PersistentEEGPlotProps) {
  // Default sampling rate (will be updated from data)
  const DEFAULT_SAMPLE_RATE = 256;

  // Use the context to manage state
  const { getPlotState, updatePlotState, initPlotState } = useEDFPlot();

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
  const [editMode, setEditMode] = useState(false);

  // Add cache checking state
  const [cacheChecked, setCacheChecked] = useState(false);
  const [useCachedData, setUseCachedData] = useState(false);

  // Initialize state for new files
  useEffect(() => {
    if (filePath) {
      initPlotState(filePath);
    }
  }, [filePath, initPlotState]);

  // Initialize loading manager
  const loadingManager = useLoadingManager();

  // Get state from context
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
    sampleRate: DEFAULT_SAMPLE_RATE,
  };

  // Destructure the state for easier use
  const {
    chunkSizeSeconds,
    selectedChannels: contextSelectedChannels,
    timeWindow,
    absoluteTimeWindow,
    zoomLevel,
    chunkStart,
    totalSamples,
    totalDuration,
    preprocessingOptions: contextPreprocessingOptions,
    sampleRate = DEFAULT_SAMPLE_RATE,
  } = plotState;

  // State for preprocessing options
  const [preprocessingOptions, setPreprocessingOptions] = useState<any>(
    contextPreprocessingOptions || {
      removeOutliers: false,
      smoothing: false,
      smoothingWindow: 3,
      normalization: "none",
    }
  );

  // Local state for selected channels
  const [selectedChannels, setSelectedChannelsLocal] = useState<string[]>([]);
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);

  // Keep local state in sync with context
  useEffect(() => {
    if (contextSelectedChannels.length > 0) {
      setSelectedChannelsLocal(contextSelectedChannels);
    }
  }, [contextSelectedChannels]);

  // Helper functions to update specific parts of state
  const setSelectedChannels = (value: string[]) => {
    setSelectedChannelsLocal(value);
    updatePlotState(filePath, { selectedChannels: value });
  };
  const setTimeWindow = (value: [number, number]) =>
    updatePlotState(filePath, { timeWindow: value });
  const setAbsoluteTimeWindow = (value: [number, number]) =>
    updatePlotState(filePath, { absoluteTimeWindow: value });
  const setZoomLevel = (value: number) =>
    updatePlotState(filePath, { zoomLevel: value });
  const setChunkStart = (value: number) =>
    updatePlotState(filePath, { chunkStart: value });

  // Calculate derived values
  const chunkSizeSamples = chunkSizeSeconds * sampleRate;

  // Check cache before making API requests
  const checkCache = useCallback(() => {
    if (!filePath || cacheChecked) return;

    const cacheKey = {
      filePath,
      chunkStart,
      chunkSize: Math.round(chunkSizeSeconds * sampleRate),
      preprocessingOptions,
    };

    const cachedData = plotCacheManager.getCachedPlotData(cacheKey);
    if (cachedData) {
      logger.info("PersistentEEGPlot: Using cached plot data for", filePath);
      setUseCachedData(true);
      updatePlotState(filePath, {
        edfData: cachedData,
        lastFetchTime: Date.now(),
      });
    }

    setCacheChecked(true);
  }, [
    filePath,
    chunkStart,
    chunkSizeSeconds,
    sampleRate,
    preprocessingOptions,
    cacheChecked,
    updatePlotState,
  ]);

  // Check cache when component mounts or key parameters change
  useEffect(() => {
    checkCache();
  }, [checkCache]);

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

  // Generate unique loading ID for this plot
  const loadingId = `eeg-plot-${filePath}-${chunkStart}`;

  // Query for EDF data
  const { loading, error, data, refetch } = useQuery(GET_EDF_DATA, {
    variables: {
      filename: filePath,
      chunkStart: chunkStart,
      chunkSize: Math.round(chunkSizeSeconds * sampleRate),
      preprocessingOptions: preprocessingOptions,
      includeNavigationInfo: true,
    },
    skip:
      !filePath ||
      useCachedData ||
      (plotState.edfData !== null &&
        chunkStart === plotState.chunkStart &&
        JSON.stringify(preprocessingOptions) ===
        JSON.stringify(plotState.preprocessingOptions)),
    fetchPolicy: useCachedData ? "cache-only" : "network-only",
    errorPolicy: "all",
    onCompleted: () => {
      // Stop loading when query completes
      loadingManager.stop(loadingId);
    },
    onError: () => {
      // Stop loading on error
      loadingManager.stop(loadingId);
    }
  });

  // Start loading when query begins
  useEffect(() => {
    if (loading && !useCachedData) {
      const chunkNumber = Math.floor(chunkStart / Math.round(chunkSizeSeconds * sampleRate)) + 1;
      loadingManager.startFileLoad(
        loadingId,
        `Loading EEG data chunk ${chunkNumber}...`,
        false // Don't show global overlay for individual chunks
      );
    }
  }, [loading, loadingId, chunkStart, chunkSizeSeconds, sampleRate, useCachedData, loadingManager]);

  // Store data in cache when it's loaded
  useEffect(() => {
    if (data?.getEdfData && filePath) {
      const edfData = data.getEdfData;

      // Cache the new data
      const cacheKey = {
        filePath,
        chunkStart,
        chunkSize: Math.round(chunkSizeSeconds * sampleRate),
        preprocessingOptions,
      };
      plotCacheManager.cachePlotData(cacheKey, edfData);

      updatePlotState(filePath, {
        edfData: edfData,
        lastFetchTime: Date.now(),
      });

      setUseCachedData(false);

      if (edfData.channelLabels.length > 0) {
        setAvailableChannels(edfData.channelLabels);

        // Use intelligent default channels if available and no channels are selected
        if (selectedChannels.length === 0) {
          if (defaultChannelsData?.getEdfDefaultChannels?.length > 0) {
            console.log(
              "Using intelligent default channels:",
              defaultChannelsData.getEdfDefaultChannels
            );
            setSelectedChannels(defaultChannelsData.getEdfDefaultChannels);
          } else {
            // Fallback: skip first channel (often Event) and select next few
            const fallbackChannels =
              edfData.channelLabels.length > 1
                ? edfData.channelLabels.slice(
                  1,
                  Math.min(6, edfData.channelLabels.length)
                ) // Skip index 0, take next 5
                : edfData.channelLabels.slice(
                  0,
                  Math.min(5, edfData.channelLabels.length)
                ); // Take first 5 if only 1 channel
            console.log(
              "Using fallback channel selection (skipping first channel):",
              fallbackChannels
            );
            setSelectedChannels(fallbackChannels);
          }
        }
      }

      // Update time window based on actual chunk duration if this appears to be initial load
      if (edfData.chunkSize && edfData.samplingFrequency) {
        const actualChunkDuration =
          edfData.chunkSize / edfData.samplingFrequency;
        // Only reset the time window if it appears to be using a default that's much larger than actual data
        if (timeWindow[1] > actualChunkDuration * 2) {
          console.log(
            `Adjusting time window from [${timeWindow[0]}, ${timeWindow[1]}] to [0, ${actualChunkDuration}] based on actual chunk duration`
          );
          setTimeWindow([0, actualChunkDuration]);
          const absoluteStartSec = chunkStart / edfData.samplingFrequency;
          setAbsoluteTimeWindow([
            absoluteStartSec,
            absoluteStartSec + actualChunkDuration,
          ]);
        }
      }
    }
  }, [
    data,
    defaultChannelsData, // Add dependency on intelligent channels
    filePath,
    updatePlotState,
    chunkStart,
    chunkSizeSeconds,
    sampleRate,
    preprocessingOptions,
    selectedChannels, // Add this dependency
    setSelectedChannels, // Add this dependency
    timeWindow, // Add timeWindow as dependency
    setTimeWindow, // Add setTimeWindow as dependency
    setAbsoluteTimeWindow, // Add setAbsoluteTimeWindow as dependency
  ]);

  // Convert to EEGData format
  const convertToEEGData = (): EEGData | null => {
    const edfDataToUse =
      plotState.edfData && chunkStart === plotState.chunkStart
        ? plotState.edfData
        : data?.getEdfData;

    if (!edfDataToUse) return null;

    try {
      const actualChunkDuration =
        edfDataToUse.chunkSize / edfDataToUse.samplingFrequency;
      const absoluteStartSec = chunkStart / edfDataToUse.samplingFrequency;

      // Filter annotations to only include those within the current chunk
      const chunkEndSample = chunkStart + edfDataToUse.chunkSize;
      const chunkAnnotations = (plotState.annotations || []).filter(
        (annotation) =>
          annotation.startTime >= chunkStart &&
          annotation.startTime < chunkEndSample
      );

      return {
        channels: edfDataToUse.channelLabels,
        samplesPerChannel: edfDataToUse.chunkSize,
        sampleRate: edfDataToUse.samplingFrequency,
        data: edfDataToUse.data,
        startTime: new Date(edfDataToUse.startTime || Date.now()).toISOString(),
        duration: actualChunkDuration,
        absoluteStartTime: absoluteStartSec,
        annotations: chunkAnnotations,
      };
    } catch (err) {
      console.error("Error converting EDF data:", err);
      return null;
    }
  };

  const eegData = convertToEEGData();

  // Navigation functions
  const handlePrevChunk = () => {
    const newStart = Math.max(0, chunkStart - chunkSizeSamples);
    setChunkStart(newStart);
    setLoadingNewChunk(true);
    setDownloadProgress(0);

    // Start loading with unified system
    const newChunkNumber = Math.floor(newStart / chunkSizeSamples) + 1;
    const newLoadingId = `eeg-plot-${filePath}-${newStart}`;
    loadingManager.startFileLoad(
      newLoadingId,
      `Loading chunk ${newChunkNumber}...`,
      false
    );
  };

  const handleNextChunk = () => {
    if (chunkStart + chunkSizeSamples < totalSamples) {
      const newStart = chunkStart + chunkSizeSamples;
      setChunkStart(newStart);
      setLoadingNewChunk(true);
      setDownloadProgress(0);

      // Start loading with unified system
      const newChunkNumber = Math.floor(newStart / chunkSizeSamples) + 1;
      const newLoadingId = `eeg-plot-${filePath}-${newStart}`;
      loadingManager.startFileLoad(
        newLoadingId,
        `Loading chunk ${newChunkNumber}...`,
        false
      );
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

      // Start loading with unified system
      const newLoadingId = `eeg-plot-${filePath}-${newStart}`;
      loadingManager.startFileLoad(
        newLoadingId,
        `Loading chunk ${chunkNumber}...`,
        false
      );
    } else {
      console.log('CHUNK SELECT: Invalid chunk selection attempted', {
        chunkNumber,
        newStart,
        chunkSizeSamples,
        totalSamples,
        wouldExceed: newStart + chunkSizeSamples > totalSamples
      });
    }
  };

  // Zoom functions
  const handleZoomIn = () => {
    if (zoomLevel < 10 && eegData) {
      const newZoom = zoomLevel * 1.5;
      setZoomLevel(newZoom);
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) / 1.5;
      const newWindow = [
        Math.max(0, center - newDuration / 2),
        Math.min(eegData.duration, center + newDuration / 2),
      ] as [number, number];
      setTimeWindow(newWindow);
      const absoluteStartSec = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteStartSec + newWindow[0],
        absoluteStartSec + newWindow[1],
      ]);
    }
  };

  const handleZoomOut = () => {
    if (zoomLevel > 0.2 && eegData) {
      const newZoom = zoomLevel / 1.5;
      setZoomLevel(newZoom);
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) * 1.5;
      const newWindow = [
        Math.max(0, center - newDuration / 2),
        Math.min(eegData.duration, center + newDuration / 2),
      ] as [number, number];
      setTimeWindow(newWindow);
      const absoluteStartSec = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteStartSec + newWindow[0],
        absoluteStartSec + newWindow[1],
      ]);
    }
  };

  // Toggle channel selection
  const toggleChannel = (channel: string) => {
    if (selectedChannels.includes(channel)) {
      setSelectedChannels(selectedChannels.filter((c) => c !== channel));
    } else {
      setSelectedChannels([...selectedChannels, channel]);
    }
  };

  // Check if loading via the unified system
  const isLoadingData = loading && !useCachedData;

  if (isLoadingData) {
    const chunkNumber = Math.floor(chunkStart / Math.round(chunkSizeSeconds * sampleRate)) + 1;
    return (
      <div className={cn("h-full relative", className)}>
        <LoadingOverlay
          show={true}
          message={`Loading EEG data chunk ${chunkNumber}...`}
          type="file-load"
          variant="modal"
          size="lg"
        />
      </div>
    );
  }

  if (error || manualErrorMessage) {
    return (
      <div className={cn("p-4", className)}>
        <Alert variant="destructive">
          <AlertDescription>
            {manualErrorMessage || error?.message || "Unknown error"}
          </AlertDescription>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              setManualErrorMessage(null);
              refetch();
            }}
          >
            Retry
          </Button>
        </Alert>
      </div>
    );
  }

  if (!eegData || selectedChannels.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center h-full text-center p-4",
          className
        )}
      >
        <div className="text-muted-foreground">
          {eegData
            ? "Please select at least one channel to display"
            : "No data available"}
        </div>
        {availableChannels.length > 0 && (
          <div className="mt-4 w-full max-w-xs">
            <Label className="text-sm font-medium">Available Channels:</Label>
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {availableChannels.slice(0, 5).map((channel) => (
                <div key={channel} className="flex items-center space-x-2">
                  <Checkbox
                    id={`quick-${channel}`}
                    checked={selectedChannels.includes(channel)}
                    onCheckedChange={() => toggleChannel(channel)}
                  />
                  <Label htmlFor={`quick-${channel}`} className="text-xs">
                    {channel}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex h-full", className)}>
      {/* Chart area */}
      <div className="flex-1 relative">
        {/* Navigation controls */}
        <div className="absolute top-2 left-2 z-10 flex gap-2">
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevChunk}
              disabled={chunkStart === 0 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                console.log('NEXT CHUNK BUTTON CLICKED:', {
                  chunkStart,
                  chunkSizeSamples,
                  totalSamples,
                  isAtEnd: chunkStart + chunkSizeSamples >= totalSamples
                });
                handleNextChunk();
              }}
              disabled={
                chunkStart + chunkSizeSamples >= totalSamples || loading
              }
            >
              <ChevronRight className="h-4 w-4" />
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

        {/* Zoom controls */}
        <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
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
            onClick={() => setZoomLevel(1)}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        {/* EEG Chart */}
        <ResizableContainer
          className="h-full"
          storageKey={`persistent-eeg-plot-height-${filePath}`}
          defaultHeight={500}
          minHeight={250}
          maxHeight={1000}
        >
          <EEGChart
            eegData={eegData}
            selectedChannels={selectedChannels}
            timeWindow={timeWindow}
            absoluteTimeWindow={absoluteTimeWindow}
            zoomLevel={zoomLevel}
            onTimeWindowChange={(newWindow) => {
              if (!eegData) {
                return; // Skip if no data is loaded
              }

              // Calculate the proposed window duration
              const windowDuration = newWindow[1] - newWindow[0];

              // Ensure the window duration doesn't exceed the available data duration
              const maxAllowedDuration = Math.min(windowDuration, eegData.duration);

              // Validate and clamp the new window with proper bounds checking
              let validatedWindow: [number, number];

              // Check if the proposed window would go below 0 (left boundary)
              if (newWindow[0] < 0) {
                validatedWindow = [0, maxAllowedDuration];
              }
              // Check if the proposed window would exceed data duration (right boundary)
              else if (newWindow[1] > eegData.duration) {
                const maxStartTime = Math.max(0, eegData.duration - maxAllowedDuration);
                validatedWindow = [maxStartTime, maxStartTime + maxAllowedDuration];
              }
              // Otherwise use the proposed window but ensure it's within bounds
              else {
                validatedWindow = [
                  Math.max(0, newWindow[0]),
                  Math.min(eegData.duration, newWindow[1]),
                ];
              }

              setTimeWindow(validatedWindow);
              const absoluteStartSec = chunkStart / sampleRate;
              setAbsoluteTimeWindow([
                absoluteStartSec + validatedWindow[0],
                absoluteStartSec + validatedWindow[1],
              ]);
            }}
            className="w-full h-full"
            height="100%"
            editMode={editMode}
            filePath={filePath}
          />
        </ResizableContainer>
      </div>

      {/* Controls sidebar */}
      <div className="w-64 border-l bg-muted/20 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1 p-2">
          <div className="space-y-4">
            {/* Channel selection */}
            <div>
              <Label className="text-sm font-medium">Channels:</Label>
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {availableChannels.map((channel) => (
                  <div key={channel} className="flex items-center space-x-2">
                    <Checkbox
                      id={`sidebar-${channel}`}
                      checked={selectedChannels.includes(channel)}
                      onCheckedChange={() => toggleChannel(channel)}
                    />
                    <Label
                      htmlFor={`sidebar-${channel}`}
                      className="text-xs cursor-pointer"
                    >
                      {channel}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Plot info */}
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Sample Rate: {eegData.sampleRate} Hz</div>
              <div>
                Position: {(chunkStart / sampleRate).toFixed(1)}s -{" "}
                {(
                  (chunkStart + eegData.samplesPerChannel) /
                  sampleRate
                ).toFixed(1)}
                s
              </div>
              <div>Zoom: {zoomLevel.toFixed(1)}x</div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
