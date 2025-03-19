"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@apollo/client";
import { GET_EDF_DATA } from "@/lib/graphql/queries";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EEGChart } from "@/components/eeg-chart";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { EEGData } from "@/components/eeg-dashboard";
import { cn } from "@/lib/utils";
import { useEDFPlot } from "@/contexts/edf-plot-context";

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
  // Default sampling rate (will be updated from data)
  const DEFAULT_SAMPLE_RATE = 256;

  // Use the context to manage state
  const { getPlotState, updatePlotState, initPlotState } = useEDFPlot();

  // Local state for error handling and loading which doesn't need to be preserved
  const [loadingNewChunk, setLoadingNewChunk] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [manualErrorMessage, setManualErrorMessage] = useState<string | null>(
    null
  );
  const [nearEdge, setNearEdge] = useState<"start" | "end" | null>(null);

  // Initialize state for new files
  useEffect(() => {
    if (open && filePath) {
      const existingState = getPlotState(filePath);
      if (!existingState) {
        // Only initialize if state doesn't exist for this file
        console.log(`Initializing plot state for file: ${filePath}`);
        initPlotState(filePath);
      }
    }
  }, [open, filePath, initPlotState, getPlotState]);

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
  };

  // Destructure the state for easier use
  const {
    chunkSizeSeconds,
    selectedChannels,
    showPlot,
    timeWindow,
    absoluteTimeWindow,
    zoomLevel,
    chunkStart,
    totalSamples,
    totalDuration,
    currentChunkNumber,
    totalChunks,
  } = plotState;

  // Helper functions to update specific parts of state
  const setChunkSizeSeconds = (value: number) =>
    updatePlotState(filePath, { chunkSizeSeconds: value });
  const setSelectedChannels = (value: string[]) =>
    updatePlotState(filePath, { selectedChannels: value });
  const setShowPlot = (value: boolean) =>
    updatePlotState(filePath, { showPlot: value });
  const setTimeWindow = (value: [number, number]) =>
    updatePlotState(filePath, { timeWindow: value });
  const setAbsoluteTimeWindow = (value: [number, number]) =>
    updatePlotState(filePath, { absoluteTimeWindow: value });
  const setZoomLevel = (value: number) =>
    updatePlotState(filePath, { zoomLevel: value });
  const setChunkStart = (value: number) =>
    updatePlotState(filePath, { chunkStart: value });
  const setTotalSamples = (value: number) =>
    updatePlotState(filePath, { totalSamples: value });
  const setTotalDuration = (value: number) =>
    updatePlotState(filePath, { totalDuration: value });
  const setCurrentChunkNumber = (value: number) =>
    updatePlotState(filePath, { currentChunkNumber: value });
  const setTotalChunks = (value: number) =>
    updatePlotState(filePath, { totalChunks: value });

  // Query for EDF data (use fixed chunk size in samples)
  const { loading, error, data, refetch } = useQuery(GET_EDF_DATA, {
    variables: {
      filename: filePath,
      chunkStart: chunkStart,
      chunkSize:
        chunkStart === 0
          ? chunkSizeSeconds * DEFAULT_SAMPLE_RATE * 2
          : chunkSizeSeconds * DEFAULT_SAMPLE_RATE,
      preprocessingOptions: null,
    },
    skip: !open || !filePath,
    fetchPolicy: "network-only",
    errorPolicy: "all", // Handle errors in the component
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
  });

  // Calculate derived values from data
  const sampleRate = data?.getEdfData?.samplingFrequency || DEFAULT_SAMPLE_RATE;
  const chunkSizeSamples = chunkSizeSeconds * sampleRate;

  // Update total duration and chunks when data is loaded
  useEffect(() => {
    if (data?.getEdfData) {
      // Only update if the values have actually changed to prevent infinite loops
      if (data.getEdfData.totalSamples !== totalSamples) {
        updatePlotState(filePath, {
          totalSamples: data.getEdfData.totalSamples,
          totalDuration:
            data.getEdfData.totalSamples / data.getEdfData.samplingFrequency,
        });

        const calculatedTotalDuration =
          data.getEdfData.totalSamples / data.getEdfData.samplingFrequency;

        // Calculate total chunks
        const calculatedTotalChunks = Math.ceil(
          calculatedTotalDuration / chunkSizeSeconds
        );
        if (calculatedTotalChunks !== totalChunks) {
          updatePlotState(filePath, { totalChunks: calculatedTotalChunks });
        }

        // Calculate current chunk number
        const currentPos = chunkStart / data.getEdfData.samplingFrequency;
        const newChunkNumber = Math.floor(currentPos / chunkSizeSeconds) + 1;
        if (newChunkNumber !== currentChunkNumber) {
          updatePlotState(filePath, { currentChunkNumber: newChunkNumber });
        }
      }

      // Check if the received chunk size matches what we expected
      const actualChunkDuration =
        data.getEdfData.chunkSize / data.getEdfData.samplingFrequency;
      const expectedChunkDuration = chunkSizeSeconds;

      // Log specific details about the first chunk vs subsequent chunks
      if (chunkStart === 0) {
        console.log(
          `FIRST CHUNK: Requested: ${expectedChunkDuration}s (doubled in request to ${
            expectedChunkDuration * 2
          }s), Received: ${actualChunkDuration.toFixed(1)}s`
        );
      } else {
        console.log(
          `SUBSEQUENT CHUNK: Requested: ${expectedChunkDuration}s, Received: ${actualChunkDuration.toFixed(
            1
          )}s`
        );
      }

      // Calculate absolute time position in the file
      const absoluteStartSec = chunkStart / data.getEdfData.samplingFrequency;

      // Update the absolute time window to reflect the actual position in the file
      const absoluteStartTime = absoluteStartSec;
      const absoluteEndTime = absoluteStartTime + actualChunkDuration;

      // Only update time window if it has changed
      const newAbsoluteTimeWindow = [absoluteStartTime, absoluteEndTime] as [
        number,
        number
      ];
      if (
        newAbsoluteTimeWindow[0] !== absoluteTimeWindow[0] ||
        newAbsoluteTimeWindow[1] !== absoluteTimeWindow[1]
      ) {
        // Set the absolute time window (file-based coordinates)
        updatePlotState(filePath, {
          absoluteTimeWindow: newAbsoluteTimeWindow,
        });
      }

      console.log(
        `Absolute time window: ${absoluteStartTime.toFixed(
          1
        )}s - ${absoluteEndTime.toFixed(1)}s`
      );

      // If the received chunk is significantly smaller than expected, we may need to adjust
      if (actualChunkDuration < expectedChunkDuration * 0.8) {
        console.warn(
          `Server returned smaller chunk than requested: ${actualChunkDuration.toFixed(
            1
          )}s vs ${expectedChunkDuration}s`
        );
      } else if (actualChunkDuration > expectedChunkDuration * 1.2) {
        console.warn(
          `Server returned larger chunk than requested: ${actualChunkDuration.toFixed(
            1
          )}s vs ${expectedChunkDuration}s`
        );
      }
    }
  }, [
    data,
    chunkSizeSeconds,
    chunkStart,
    filePath,
    updatePlotState,
    totalSamples,
    totalDuration,
    totalChunks,
    currentChunkNumber,
    absoluteTimeWindow,
  ]);

  const toggleChannel = (channel: string) => {
    if (selectedChannels.includes(channel)) {
      setSelectedChannels(selectedChannels.filter((ch) => ch !== channel));
    } else {
      setSelectedChannels([...selectedChannels, channel]);
    }
  };

  const selectAllChannels = () => {
    if (data?.getEdfData?.channelLabels) {
      setSelectedChannels([...data.getEdfData.channelLabels]);
    }
  };

  const deselectAllChannels = () => {
    setSelectedChannels([]);
  };

  const handlePlot = () => {
    setShowPlot(true);

    // If we have data, use the actual duration rather than assuming the requested chunk size
    if (data?.getEdfData) {
      const actualChunkDuration =
        data.getEdfData.chunkSize / data.getEdfData.samplingFrequency;

      // Set the local time window (relative to chunk)
      setTimeWindow([0, actualChunkDuration]);

      // Also set the absolute time window (relative to file)
      setAbsoluteTimeWindow([0, actualChunkDuration]);

      console.log(
        `Initial plot using actual chunk duration: ${actualChunkDuration.toFixed(
          1
        )}s (this is the first chunk which may be limited by the server)`
      );
    } else {
      // Fall back to requested size if we don't have data yet
      setTimeWindow([0, chunkSizeSeconds]);
      setAbsoluteTimeWindow([0, chunkSizeSeconds]);
    }

    setChunkStart(0); // Reset to first chunk
    setCurrentChunkNumber(1);
  };

  const handleTimeWindowChange = (window: [number, number]) => {
    // Constrain the time window to the actual available data
    if (eegData) {
      const constrainedWindow: [number, number] = [
        Math.max(0, window[0]), // Don't go below 0
        Math.min(eegData.duration, window[1]), // Don't go beyond actual data duration
      ];

      // Check if we're near an edge and set the indicator
      const edgeThreshold = eegData.duration * 0.1; // Within 10% of the edge
      if (constrainedWindow[0] < edgeThreshold) {
        setNearEdge("start");
      } else if (constrainedWindow[1] > eegData.duration - edgeThreshold) {
        setNearEdge("end");
      } else {
        setNearEdge(null);
      }

      // Update the local time window (relative to the current chunk)
      setTimeWindow(constrainedWindow);

      // Calculate and update the absolute time window (relative to file start)
      const absoluteChunkStart = chunkStart / sampleRate;
      const absoluteStart = absoluteChunkStart + constrainedWindow[0];
      const absoluteEnd = absoluteChunkStart + constrainedWindow[1];
      setAbsoluteTimeWindow([absoluteStart, absoluteEnd]);
    } else {
      setTimeWindow(window);
      setNearEdge(null);
    }

    // Disable automatic chunk loading on scroll
    // Previously, this would load next/previous chunks when scrolling to the edge
    // But now we want user to explicitly click the navigation buttons

    // Comment out the auto-loading behavior
    /*
    if (window[0] < 0) {
      loadPreviousChunk();
    } else if (
      window[1] > chunkSizeSeconds &&
      currentChunkNumber < totalChunks
    ) {
      loadNextChunk();
    }
    */
  };

  // Convert GraphQL data to EEGData format
  const convertToEEGData = (): EEGData | null => {
    if (!data?.getEdfData) return null;

    try {
      const actualChunkDuration =
        data.getEdfData.chunkSize / data.getEdfData.samplingFrequency;

      // Calculate absolute time position in the file
      const absoluteStartSec = chunkStart / data.getEdfData.samplingFrequency;

      return {
        channels: data.getEdfData.channelLabels,
        samplesPerChannel: data.getEdfData.chunkSize,
        sampleRate: data.getEdfData.samplingFrequency,
        data: data.getEdfData.data,
        startTime: new Date(),
        duration: actualChunkDuration, // Use actual duration from the data
        absoluteStartTime: absoluteStartSec, // Add absolute start time for x-axis positioning
      };
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
    }
  };

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
    }
  };

  const handleResetZoom = () => {
    setZoomLevel(1);
    // Use the actual data duration if available
    if (eegData) {
      setTimeWindow([0, eegData.duration]);

      // Reset absolute window to match current chunk position
      const absoluteChunkStart = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteChunkStart,
        absoluteChunkStart + eegData.duration,
      ]);
    } else {
      setTimeWindow([0, chunkSizeSeconds]);
      setAbsoluteTimeWindow([0, chunkSizeSeconds]);
    }
  };

  const loadPreviousChunk = () => {
    if (currentChunkNumber > 1 && !loadingNewChunk) {
      setLoadingNewChunk(true);
      setManualErrorMessage(null);
      setRetryCount(0);
      const newChunkStart = Math.max(0, chunkStart - chunkSizeSamples);
      setChunkStart(newChunkStart);

      // Set local time window for the new chunk
      setTimeWindow([0, chunkSizeSeconds]);

      // Calculate and set the absolute time window
      const absoluteStartTime = newChunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteStartTime,
        absoluteStartTime + chunkSizeSeconds,
      ]);

      // Brief delay before making the request to allow server to clean up resources
      setTimeout(() => {
        console.log(
          `Requesting previous chunk at ${newChunkStart} samples, size: ${chunkSizeSamples} samples (${chunkSizeSeconds}s)`
        );
        refetch({
          filename: filePath,
          chunkStart: newChunkStart,
          chunkSize: chunkSizeSamples,
          preprocessingOptions: null,
        })
          .then((result) => {
            // Check if we received valid data
            if (!result.data?.getEdfData) {
              setManualErrorMessage(
                "No data returned from server. Try again or check the file."
              );
            } else {
              // Check if we received the expected amount of data
              const actualDuration =
                result.data.getEdfData.chunkSize /
                result.data.getEdfData.samplingFrequency;
              console.log(
                `Received chunk with duration: ${actualDuration.toFixed(1)}s`
              );

              // Set the local time window to the actual duration we received, not the requested duration
              setTimeWindow([0, actualDuration]);

              // Update the absolute time window with the actual duration
              const absoluteStartTime = newChunkStart / sampleRate;
              setAbsoluteTimeWindow([
                absoluteStartTime,
                absoluteStartTime + actualDuration,
              ]);
            }
          })
          .catch((err) => {
            console.error("Error loading previous chunk:", err);
            setManualErrorMessage(
              `Error loading chunk: ${err.message || "Unknown error"}`
            );
          })
          .finally(() => {
            setLoadingNewChunk(false);
          });
      }, 300); // Short delay to allow file handles to be closed
    }
  };

  const loadNextChunk = () => {
    if (currentChunkNumber < totalChunks && !loadingNewChunk) {
      setLoadingNewChunk(true);
      setManualErrorMessage(null);
      setRetryCount(0);
      const newChunkStart = chunkStart + chunkSizeSamples;
      setChunkStart(newChunkStart);

      // Set local time window for the new chunk
      setTimeWindow([0, chunkSizeSeconds]);

      // Calculate and set the absolute time window
      const absoluteStartTime = newChunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteStartTime,
        absoluteStartTime + chunkSizeSeconds,
      ]);

      // Brief delay before making the request to allow server to clean up resources
      setTimeout(() => {
        console.log(
          `Requesting next chunk at ${newChunkStart} samples, size: ${chunkSizeSamples} samples (${chunkSizeSeconds}s)`
        );
        refetch({
          filename: filePath,
          chunkStart: newChunkStart,
          chunkSize: chunkSizeSamples,
          preprocessingOptions: null,
        })
          .then((result) => {
            // Check if we received valid data
            if (!result.data?.getEdfData) {
              setManualErrorMessage(
                "No data returned from server. Try again or check the file."
              );
            } else {
              // Check if we received the expected amount of data
              const actualDuration =
                result.data.getEdfData.chunkSize /
                result.data.getEdfData.samplingFrequency;
              console.log(
                `Received chunk with duration: ${actualDuration.toFixed(1)}s`
              );

              // Set the local time window to the actual duration we received, not the requested duration
              setTimeWindow([0, actualDuration]);

              // Update the absolute time window with the actual duration
              const absoluteStartTime = newChunkStart / sampleRate;
              setAbsoluteTimeWindow([
                absoluteStartTime,
                absoluteStartTime + actualDuration,
              ]);
            }
          })
          .catch((err) => {
            console.error("Error loading next chunk:", err);
            setManualErrorMessage(
              `Error loading chunk: ${err.message || "Unknown error"}`
            );
          })
          .finally(() => {
            setLoadingNewChunk(false);
          });
      }, 300); // Short delay to allow file handles to be closed
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        // We don't reset the state anymore, just close the dialog
        onOpenChange(newOpen);

        // Reset only error-related state which doesn't need to be preserved
        if (!newOpen) {
          setManualErrorMessage(null);
          setRetryCount(0);
        }
      }}
    >
      <DialogContent
        className={`sm:max-w-[800px] ${showPlot ? "min-h-[600px]" : ""}`}
      >
        <DialogHeader>
          <DialogTitle>EDF Data Visualization</DialogTitle>
        </DialogHeader>

        {!showPlot ? (
          <div className="grid gap-4 py-4">
            <div className="flex items-center gap-4">
              <Label htmlFor="chunkSize" className="w-32">
                Chunk Size (seconds):
              </Label>
              <Input
                id="chunkSize"
                type="number"
                min={1}
                max={60}
                value={chunkSizeSeconds}
                onChange={(e) => setChunkSizeSeconds(Number(e.target.value))}
                className="w-24"
              />
            </div>

            {loading ? (
              <div className="flex justify-center items-center h-40">
                <Spinner />
              </div>
            ) : error || manualErrorMessage ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {manualErrorMessage ||
                    `Error loading EDF data: ${
                      error?.message || "Unknown error"
                    }`}
                </AlertDescription>
              </Alert>
            ) : data?.getEdfData ? (
              <>
                <div className="flex justify-between items-center mt-2">
                  <Label>Select Channels:</Label>
                  <div className="space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={selectAllChannels}
                    >
                      Select All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={deselectAllChannels}
                    >
                      Deselect All
                    </Button>
                  </div>
                </div>

                <ScrollArea className="h-40 border rounded-md p-2">
                  <div className="grid grid-cols-2 gap-2">
                    {data.getEdfData.channelLabels.map((channel: string) => (
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
                          className="cursor-pointer text-sm"
                        >
                          {channel}
                        </Label>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="text-sm text-muted-foreground">
                  File: {filePath}
                  <br />
                  Sample Rate: {data.getEdfData.samplingFrequency} Hz
                  <br />
                  Channels: {data.getEdfData.channelLabels.length}
                  <br />
                  Total Samples: {data.getEdfData.totalSamples} (
                  {data.getEdfData.totalSamples /
                    data.getEdfData.samplingFrequency}{" "}
                  seconds)
                </div>
              </>
            ) : null}
          </div>
        ) : loading || (loadingNewChunk && !eegData) ? (
          <div className="space-y-4 py-4">
            <div className="h-[400px] flex flex-col items-center justify-center">
              <div className="animate-pulse mb-4">
                <Spinner className="h-8 w-8" />
              </div>
              <div className="text-sm font-medium mb-2">
                {loading
                  ? "Loading EDF data..."
                  : `Loading ${
                      currentChunkNumber < totalChunks ? "next" : "previous"
                    } chunk...`}
              </div>
              {manualErrorMessage && (
                <div
                  className={cn(
                    "text-sm text-destructive mt-2 max-w-xs text-center",
                    retryCount > 0 && "animate-pulse"
                  )}
                >
                  {manualErrorMessage}
                </div>
              )}
            </div>
          </div>
        ) : eegData ? (
          <div className="space-y-4 py-4">
            <div className="flex justify-between items-center">
              <div className="text-sm text-muted-foreground">
                Zoom Level: {zoomLevel.toFixed(1)}x
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleZoomOut}
                  disabled={zoomLevel <= 0.1}
                  title="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleZoomIn}
                  disabled={zoomLevel >= 10}
                  title="Zoom In"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetZoom}
                  title="Reset Zoom"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Chunk navigation controls */}
            <div className="flex justify-between items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={loadPreviousChunk}
                disabled={currentChunkNumber <= 1 || loading || loadingNewChunk}
                title="Previous Chunk"
              >
                {loadingNewChunk && currentChunkNumber > 1 ? (
                  <>
                    <Spinner className="h-3 w-3 mr-2" />
                    Loading...
                  </>
                ) : (
                  <>
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous Chunk
                  </>
                )}
              </Button>

              <div className="text-sm">
                Chunk {currentChunkNumber} of {totalChunks}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={loadNextChunk}
                disabled={
                  currentChunkNumber >= totalChunks ||
                  loading ||
                  loadingNewChunk
                }
                title="Next Chunk"
              >
                {loadingNewChunk && currentChunkNumber < totalChunks ? (
                  <>
                    <Spinner className="h-3 w-3 mr-2" />
                    Loading...
                  </>
                ) : (
                  <>
                    Next Chunk
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            </div>

            <div className="h-[400px] relative">
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                  <Spinner className="h-8 w-8" />
                </div>
              )}
              {!loading && loadingNewChunk && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
                  <div className="animate-pulse">
                    <Spinner className="h-8 w-8 mb-2" />
                  </div>
                  <div className="text-sm font-medium">
                    Loading{" "}
                    {currentChunkNumber < totalChunks ? "next" : "previous"}{" "}
                    chunk...
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {currentChunkNumber > 1 && currentChunkNumber < totalChunks
                      ? `Chunk ${currentChunkNumber} → ${
                          currentChunkNumber +
                          (currentChunkNumber < totalChunks ? 1 : -1)
                        }`
                      : `Navigating to ${
                          currentChunkNumber < totalChunks ? "next" : "previous"
                        } section`}
                  </div>
                  {manualErrorMessage && (
                    <div
                      className={cn(
                        "text-sm text-destructive mt-2 max-w-xs text-center",
                        retryCount > 0 && "animate-pulse"
                      )}
                    >
                      {manualErrorMessage}
                    </div>
                  )}
                </div>
              )}
              {/* Edge indicators */}
              {nearEdge === "start" && currentChunkNumber > 1 && (
                <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-yellow-500/20 to-transparent flex items-center justify-start pl-2 pointer-events-none">
                  <ChevronLeft className="h-6 w-6 text-amber-600" />
                  <div className="absolute bottom-4 left-2 bg-amber-50/90 text-amber-700 text-xs p-1 px-2 rounded whitespace-nowrap border border-amber-200">
                    Use "Previous Chunk" button to view earlier data
                  </div>
                </div>
              )}
              {nearEdge === "end" && currentChunkNumber < totalChunks && (
                <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-yellow-500/20 to-transparent flex items-center justify-end pr-2 pointer-events-none">
                  <ChevronRight className="h-6 w-6 text-amber-600" />
                  <div className="absolute bottom-4 right-2 bg-amber-50/90 text-amber-700 text-xs p-1 px-2 rounded whitespace-nowrap border border-amber-200">
                    Use "Next Chunk" button to view more data
                  </div>
                </div>
              )}
              <EEGChart
                eegData={eegData}
                selectedChannels={selectedChannels}
                timeWindow={timeWindow}
                absoluteTimeWindow={absoluteTimeWindow}
                zoomLevel={zoomLevel}
                onTimeWindowChange={handleTimeWindowChange}
              />
            </div>

            <div className="text-sm text-muted-foreground">
              <div className="flex justify-between">
                {loadingNewChunk ? (
                  <span className="italic">Loading new time window...</span>
                ) : (
                  <span>
                    Viewing: {(timeWindow[1] - timeWindow[0]).toFixed(1)}s
                    duration at {absoluteTimeWindow[0].toFixed(1)}s -{" "}
                    {absoluteTimeWindow[1].toFixed(1)}s in file
                  </span>
                )}
                <span>
                  Progress:{" "}
                  {((absoluteTimeWindow[0] / totalDuration) * 100).toFixed(1)}%
                  - {((absoluteTimeWindow[1] / totalDuration) * 100).toFixed(1)}
                  %
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span>
                  Total Duration: {totalDuration.toFixed(1)}s ({totalSamples}{" "}
                  samples at {sampleRate}Hz)
                </span>
                {eegData &&
                chunkStart === 0 &&
                eegData.duration < chunkSizeSeconds * 0.9 ? (
                  <span className="text-amber-500">
                    Note: First chunk is limited to{" "}
                    {eegData.duration.toFixed(1)}s by the server
                  </span>
                ) : (
                  eegData &&
                  chunkStart > 0 &&
                  Math.abs(eegData.duration - chunkSizeSeconds) >
                    chunkSizeSeconds * 0.2 && (
                    <span className="text-amber-500">
                      Note: Server returned {eegData.duration.toFixed(1)}s
                      instead of requested {chunkSizeSeconds}s
                    </span>
                  )
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-4 flex flex-col items-center justify-center">
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                {manualErrorMessage ||
                  "Failed to convert data for plotting. The data format may be invalid."}
              </AlertDescription>
            </Alert>
            <Button onClick={() => setShowPlot(false)} variant="outline">
              Back to Settings
            </Button>
          </div>
        )}

        <DialogFooter>
          {!showPlot ? (
            <Button
              type="submit"
              onClick={handlePlot}
              disabled={loading || selectedChannels.length === 0}
            >
              Plot Selected Channels
            </Button>
          ) : (
            <Button onClick={() => setShowPlot(false)}>Back to Settings</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
