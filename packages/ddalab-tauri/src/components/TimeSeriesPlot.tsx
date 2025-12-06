"use client";

import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { ChunkData } from "@/types/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChannelSelector } from "@/components/ChannelSelector";
import {
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  Settings,
  Download,
  RotateCcw,
  Activity,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { useTimeSeriesAnnotations } from "@/hooks/useAnnotations";
import { AnnotationContextMenu } from "@/components/annotations/AnnotationContextMenu";
import { AnnotationMarker } from "@/components/annotations/AnnotationMarker";
import { PlotInfo } from "@/types/annotations";
import { PreprocessingOptions } from "@/types/persistence";
import {
  applyPreprocessing,
  getDefaultPreprocessing,
} from "@/utils/preprocessing";
import { useWorkflow } from "@/hooks/useWorkflow";
import { createTransformDataAction } from "@/types/workflow";
import { OverviewPlot } from "@/components/OverviewPlot";
import {
  useOverviewData,
  useOverviewProgress,
} from "@/hooks/useTimeSeriesData";

interface TimeSeriesPlotProps {
  apiService: ApiService;
}

// Internal component - wrapped with memo at export
function TimeSeriesPlotComponent({ apiService }: TimeSeriesPlotProps) {
  const {
    fileManager,
    plot,
    dda,
    updatePlotState,
    setCurrentChunk,
    setSelectedChannels: persistSelectedChannels,
    workflowRecording,
    incrementActionCount,
  } = useAppStore();

  const { recordAction } = useWorkflow();
  const { createWindow, updateWindowData, broadcastToType } =
    usePopoutWindows();

  // Annotation support for time series
  const timeSeriesAnnotations = useTimeSeriesAnnotations({
    filePath: fileManager.selectedFile?.file_path || "",
    // For time series, we use global annotations (not per-channel)
  });

  // Generate available plots for annotation visibility
  const availablePlots = useMemo<PlotInfo[]>(() => {
    const plots: PlotInfo[] = [
      { id: "timeseries", label: "Data Visualization" },
    ];

    // Add DDA results for this file if they exist
    const currentFilePath = fileManager.selectedFile?.file_path;
    if (currentFilePath) {
      // Check current analysis
      if (
        dda.currentAnalysis?.file_path === currentFilePath &&
        dda.currentAnalysis.results?.variants
      ) {
        for (const variant of dda.currentAnalysis.results.variants) {
          plots.push({
            id: `dda:${dda.currentAnalysis.id}:${variant.variant_id}`,
            label: `DDA: ${variant.variant_name || variant.variant_id}`,
          });
        }
      }

      // Check analysis history for other analyses of the same file
      for (const analysis of dda.analysisHistory) {
        if (
          analysis.file_path === currentFilePath &&
          analysis.id !== dda.currentAnalysis?.id &&
          analysis.results?.variants
        ) {
          for (const variant of analysis.results.variants) {
            plots.push({
              id: `dda:${analysis.id}:${variant.variant_id}`,
              label: `DDA (${analysis.name || analysis.id.slice(0, 8)}): ${variant.variant_name || variant.variant_id}`,
            });
          }
        }
      }
    }

    return plots;
  }, [
    fileManager.selectedFile?.file_path,
    dda.currentAnalysis,
    dda.analysisHistory,
  ]);

  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const userZoomRef = useRef<{ min: number; max: number } | null>(null);
  const currentChunkRangeRef = useRef<{ min: number; max: number }>({
    min: 0,
    max: 10,
  });
  const stableOffsetRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadChunkTimeout, setLoadChunkTimeout] =
    useState<NodeJS.Timeout | null>(null);

  // AbortController to cancel pending API requests when channel selection changes
  const abortControllerRef = useRef<AbortController | null>(null);

  // Preprocessing controls - initialize from plot state or defaults
  const [showPreprocessing, setShowPreprocessing] = useState(false);
  const [preprocessing, setPreprocessing] = useState<PreprocessingOptions>(
    plot.preprocessing || getDefaultPreprocessing(),
  );

  useEffect(() => {
    if (plot.preprocessing) {
      setPreprocessing(plot.preprocessing);
    }
  }, []);

  // Display controls
  const [timeWindow, setTimeWindow] = useState(10); // seconds - default 10s chunks
  const [channelOffset, setChannelOffset] = useState(70); // Default spacing between channels (higher = more space)

  // Use selectedChannels from store instead of local state
  const selectedChannels = fileManager.selectedChannels;

  // Overview plot state - using TanStack Query for better caching and loading states
  // IMPORTANT: These hooks must come AFTER selectedChannels is declared
  const { data: overviewData, isLoading: overviewLoading } = useOverviewData(
    apiService,
    fileManager.selectedFile?.file_path || "",
    selectedChannels,
    2000, // max points
    !!fileManager.selectedFile && selectedChannels.length > 0,
  );

  const { data: overviewProgress } = useOverviewProgress(
    apiService,
    fileManager.selectedFile?.file_path || "",
    selectedChannels,
    2000, // max points
    overviewLoading &&
      !!fileManager.selectedFile &&
      selectedChannels.length > 0,
  );

  // Extract file path to use as stable dependency for effects
  const filePath = fileManager.selectedFile?.file_path;

  // Initialize refs with default values after state is declared
  const channelOffsetRef = useRef(channelOffset);
  const timeWindowRef = useRef(timeWindow);

  // Update refs when values change
  useEffect(() => {
    channelOffsetRef.current = channelOffset;
    timeWindowRef.current = timeWindow;
  }, [channelOffset, timeWindow]);

  // Ref to track if this is the first time we're setting channels for a file
  const isInitialChannelSetRef = useRef<boolean>(true);
  // Ref to track which channels should be displayed (updated synchronously)
  const channelsToDisplayRef = useRef<string[]>(selectedChannels);

  useEffect(() => {
    if (
      fileManager.selectedFile &&
      fileManager.selectedFile.channels.length > 0
    ) {
      setDuration(fileManager.selectedFile.duration || 0);

      // Validate that persisted channels exist in the current file
      const availableChannels = fileManager.selectedFile.channels;
      const validPersistedChannels = fileManager.selectedChannels.filter((ch) =>
        availableChannels.includes(ch),
      );

      // Mark this as initial channel set (will trigger data load in the next effect)
      isInitialChannelSetRef.current = true;

      if (validPersistedChannels.length === 0) {
        const dataChannels = availableChannels.filter(
          (ch) => !ch.toLowerCase().match(/^(time|timestamp|t|sample)$/i),
        );
        const channelsToSelect =
          dataChannels.length > 0 ? dataChannels : availableChannels;
        const defaultChannels = channelsToSelect.slice(
          0,
          Math.min(8, channelsToSelect.length),
        );
        channelsToDisplayRef.current = defaultChannels;
        persistSelectedChannels(defaultChannels);
      } else if (
        validPersistedChannels.length !== fileManager.selectedChannels.length
      ) {
        channelsToDisplayRef.current = validPersistedChannels;
        persistSelectedChannels(validPersistedChannels);
      } else {
        channelsToDisplayRef.current = fileManager.selectedChannels;
      }
    } else {
      channelsToDisplayRef.current = [];
      persistSelectedChannels([]);
    }
  }, [fileManager.selectedFile, persistSelectedChannels]);

  const renderPlot = useCallback(
    (chunkData: ChunkData, startTime: number, channelsToShow?: string[]) => {
      // Use provided channels, or fall back to ref (which is updated synchronously), or selectedChannels
      const channelsToDisplay =
        channelsToShow || channelsToDisplayRef.current || selectedChannels;
      if (!plotRef.current) return;

      if (!chunkData.data || chunkData.data.length === 0) {
        setError("No data available for plotting");
        return;
      }

      // Prepare data for uPlot
      const dataLength = chunkData.data?.[0]?.length || 0;
      // Generate absolute time data starting from current position in file
      const timeData = Array.from(
        { length: dataLength },
        (_, i) => startTime + i / chunkData.sample_rate,
      );

      let autoOffset = stableOffsetRef.current;
      if (autoOffset === null && chunkData.data.length > 1) {
        const channelRanges = chunkData.data.map((channelData) => {
          const validData = channelData.filter(
            (v) => typeof v === "number" && !isNaN(v),
          );
          if (validData.length === 0) return 0;
          const min = Math.min(...validData);
          const max = Math.max(...validData);
          return max - min;
        });
        const maxRange = Math.max(...channelRanges);
        const offsetMultiplier = 3.5 * (channelOffsetRef.current / 50);
        autoOffset = Math.max(
          maxRange * offsetMultiplier,
          channelOffsetRef.current,
        );
        stableOffsetRef.current = autoOffset;
      } else if (autoOffset === null) {
        autoOffset = channelOffsetRef.current;
        stableOffsetRef.current = autoOffset;
      }

      // Build selected channel data in the order specified by channelsToDisplay (which is already sorted by file order)
      const selectedChannelData: Array<{
        name: string;
        data: number[];
        originalIndex: number;
      }> = [];
      channelsToDisplay.forEach((channelName) => {
        const index = chunkData.channels.indexOf(channelName);
        if (index !== -1) {
          selectedChannelData.push({
            name: channelName,
            data: chunkData.data[index],
            originalIndex: index,
          });
        }
      });

      // Stack ONLY selected channels with contiguous offsets (no gaps)
      const processedData = selectedChannelData.map(
        (channelInfo, displayIndex) => {
          const channelData = channelInfo.data;

          if (!Array.isArray(channelData)) {
            return Array(dataLength).fill(0);
          }

          return channelData.map((value) => {
            if (typeof value !== "number") return 0;
            const offsetValue = value + displayIndex * autoOffset;
            return isNaN(offsetValue) ? 0 : offsetValue;
          });
        },
      );

      const data: uPlot.AlignedData = [timeData, ...processedData];

      const hasValidData = data.every(
        (series) => Array.isArray(series) && series.length > 0,
      );
      const hasNumericData = data
        .slice(1)
        .every((series: any) =>
          series.every((val: any) => typeof val === "number" && !isNaN(val)),
        );

      if (!hasValidData || !hasNumericData) {
        setError("Invalid data format received");
        return;
      }

      const series: uPlot.Series[] = [
        {},
        ...selectedChannelData.map((channelInfo) => ({
          label: channelInfo.name,
          stroke: getChannelColor(channelInfo.originalIndex),
          width: 1.5,
          points: { show: false },
          focus: { alpha: 1.0 },
        })),
      ];

      const scales: uPlot.Scales = {
        x: {
          time: false,
          range: (u, dataMin, dataMax) => {
            // Use user zoom if set, otherwise use current chunk range
            if (userZoomRef.current) {
              return [userZoomRef.current.min, userZoomRef.current.max];
            }
            return [
              currentChunkRangeRef.current.min,
              currentChunkRangeRef.current.max,
            ];
          },
        },
        y: {
          range: (u, min, max) => {
            if (isNaN(min) || isNaN(max) || min === max) {
              const selectedCount = selectedChannelData.length;
              const totalOffset = (selectedCount - 1) * autoOffset;
              return [-autoOffset * 0.8, totalOffset + autoOffset * 0.8];
            }

            const padding = autoOffset * 0.8;
            return [min - padding, max + padding] as [number, number];
          },
        },
      };

      const axes: uPlot.Axis[] = [
        {
          label: "Time (s)",
          labelSize: 30,
          size: 50,
        },
        {
          label: "",
          labelSize: 0,
          size: 100,
          values: () => {
            // Return only selected channel names in the correct order
            return selectedChannelData.map((ch) => ch.name);
          },
          splits: () => {
            // Return Y-axis positions for only selected channels (contiguous stacking)
            return selectedChannelData.map((_, displayIdx) => {
              return displayIdx * autoOffset;
            });
          },
          gap: 5,
        },
      ];

      const opts: uPlot.Options = {
        width: plotRef.current.clientWidth,
        height: plotRef.current.clientHeight || 400,
        series,
        scales,
        axes,
        legend: {
          show: false,
        },
        cursor: {
          show: true,
          x: true,
          y: true,
          lock: false,
          drag: {
            x: true,
            y: false,
          },
        },
        select: {
          show: true,
          left: 0,
          top: 0,
          width: 0,
          height: 0,
        },
        hooks: {
          setSelect: [
            (u) => {
              if (!u.select.width || u.select.width < 10) return;

              const minX = u.posToVal(u.select.left, "x");
              const maxX = u.posToVal(u.select.left + u.select.width, "x");

              userZoomRef.current = { min: minX, max: maxX };
              u.setScale("x", { min: minX, max: maxX });

              setTimeout(() => {
                u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
              }, 10);
            },
          ],
          ready: [
            (u) => {
              const plotElement = u.root.querySelector(".u-over");
              if (plotElement) {
                plotElement.addEventListener("dblclick", () => {
                  userZoomRef.current = null;
                  u.redraw();
                });
              }
            },
          ],
        },
      };

      try {
        if (
          uplotRef.current &&
          uplotRef.current.series.length !== series.length
        ) {
          uplotRef.current.destroy();
          uplotRef.current = null;

          if (plotRef.current) {
            while (plotRef.current.firstChild) {
              plotRef.current.removeChild(plotRef.current.firstChild);
            }
          }
        }

        if (uplotRef.current) {
          currentChunkRangeRef.current = {
            min: startTime,
            max: startTime + timeWindowRef.current,
          };

          uplotRef.current.setData(data);
          uplotRef.current.redraw();
        } else {
          currentChunkRangeRef.current = {
            min: startTime,
            max: startTime + timeWindowRef.current,
          };

          uplotRef.current = new uPlot(opts, data, plotRef.current);

          if (!resizeObserverRef.current && plotRef.current) {
            resizeObserverRef.current = new ResizeObserver((entries) => {
              if (uplotRef.current && entries[0]) {
                const { width, height } = entries[0].contentRect;
                uplotRef.current.setSize({ width, height });
              }
            });
            resizeObserverRef.current.observe(plotRef.current);
          }
        }
      } catch (error) {
        setError("Failed to create plot: " + error);
        return;
      }
    },
    [],
  );

  // Clean up plot and observer on unmount
  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, []);

  // Use ref to create stable loadChunk function that doesn't recreate on every dependency change
  const loadChunkRef = useRef<((startTime: number) => Promise<void>) | null>(
    null,
  );

  loadChunkRef.current = async (startTime: number) => {
    if (!fileManager.selectedFile || selectedChannels.length === 0) return;

    if (fileManager.selectedFile.duration === 0) {
      setError("File has no duration - data may not be properly loaded");
      return;
    }

    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      setLoading(true);
      setError(null);

      const chunkSize = Math.floor(
        timeWindow * fileManager.selectedFile.sample_rate,
      );
      const chunkStart = Math.floor(
        startTime * fileManager.selectedFile.sample_rate,
      );

      const chunkData = await apiService.getChunkData(
        fileManager.selectedFile.file_path,
        chunkStart,
        chunkSize,
        selectedChannels,
        signal,
      );

      if (!chunkData.data || chunkData.data.length === 0) {
        setError("No data received from server");
        return;
      }

      const preprocessedData = chunkData.data.map((channelData) =>
        applyPreprocessing(
          channelData,
          fileManager.selectedFile!.sample_rate,
          preprocessing,
        ),
      );

      const processedChunk: ChunkData = {
        ...chunkData,
        data: preprocessedData,
      };

      setCurrentChunk(processedChunk);

      requestAnimationFrame(() => {
        renderPlot(processedChunk, startTime);
        setCurrentTime(startTime);
        setLoading(false);
      });
    } catch (err) {
      if (err instanceof Error && err.name === "CanceledError") {
        setLoading(false);
        return;
      }

      setError(err instanceof Error ? err.message : "Failed to load data");
      setLoading(false);
    }
  };

  // Stable wrapper function that doesn't change
  const loadChunk = useCallback((startTime: number) => {
    return loadChunkRef.current!(startTime);
  }, []);

  const getChannelColor = (index: number): string => {
    const colors = [
      "#3b82f6",
      "#ef4444",
      "#10b981",
      "#f59e0b",
      "#8b5cf6",
      "#06b6d4",
      "#f97316",
      "#84cc16",
      "#ec4899",
      "#6366f1",
    ];
    return colors[index % colors.length];
  };

  const handleSeek = useCallback(
    (time: number) => {
      setCurrentTime(time);
      userZoomRef.current = null;

      if (loadChunkTimeout) {
        clearTimeout(loadChunkTimeout);
      }

      const timeoutId = setTimeout(() => {
        loadChunk(time);
      }, 200);

      setLoadChunkTimeout(timeoutId);
    },
    [loadChunk, loadChunkTimeout],
  );

  const handleChannelToggle = (channel: string, checked: boolean) => {
    let newChannels: string[];

    if (checked) {
      // When adding a channel, insert it in file order
      if (fileManager.selectedFile) {
        const fileChannels = fileManager.selectedFile.channels;
        newChannels = [...selectedChannels, channel].sort((a, b) => {
          const indexA = fileChannels.indexOf(a);
          const indexB = fileChannels.indexOf(b);
          return indexA - indexB;
        });
      } else {
        // Fallback if no file loaded yet
        newChannels = [...selectedChannels, channel];
      }
    } else {
      // When removing a channel, filter it out
      newChannels = selectedChannels.filter((ch) => ch !== channel);
    }

    channelsToDisplayRef.current = newChannels;
    persistSelectedChannels(newChannels);
  };

  const handlePopOut = useCallback(async () => {
    if (!plot.currentChunk) return;

    const timeSeriesData = {
      channels: plot.currentChunk.channels,
      data: plot.currentChunk.data,
      timestamps: plot.currentChunk.timestamps,
      sampleRate: plot.currentChunk.sample_rate,
      chunkStart: plot.currentChunk.chunk_start,
      timeWindow: timeWindow,
      currentTime: currentTime,
      filters: preprocessing,
    };

    try {
      await createWindow("timeseries", "main", timeSeriesData);
    } catch {
      // Window creation failed silently
    }
  }, [plot.currentChunk, timeWindow, currentTime, preprocessing, createWindow]);

  // Track if we've loaded data for the current file
  const loadedFileRef = useRef<string | null>(null);

  useEffect(() => {
    const currentFilePath = filePath || null;
    const hasChannelsSelected = selectedChannels.length > 0;
    const isNewFile = currentFilePath !== loadedFileRef.current;
    const isInitialChannelSet = isInitialChannelSetRef.current;

    if (
      fileManager.selectedFile &&
      fileManager.selectedFile.channels?.length > 0 &&
      hasChannelsSelected &&
      (isNewFile || isInitialChannelSet)
    ) {
      if (isNewFile && uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
      if (isNewFile) {
        stableOffsetRef.current = null;
      }
      loadChunk(0);
      setCurrentTime(0);
      loadedFileRef.current = currentFilePath;
      isInitialChannelSetRef.current = false;
    } else if (!isNewFile && !isInitialChannelSet && hasChannelsSelected) {
      if (loadChunkTimeout) {
        clearTimeout(loadChunkTimeout);
      }
      const timeoutId = setTimeout(() => {
        loadChunk(currentTime);
      }, 600);
      setLoadChunkTimeout(timeoutId);
    }
  }, [filePath, selectedChannels, loadChunk]);

  // Handle time window changes separately to avoid recreating plot
  // NOTE: This effect only runs when timeWindow changes, NOT when file/channels change
  // File/channel changes are handled by the previous effect
  useEffect(() => {
    if (
      fileManager.selectedFile &&
      selectedChannels.length > 0 &&
      currentTime >= 0
    ) {
      const availableChannels = fileManager.selectedFile.channels;
      const allChannelsValid = selectedChannels.every((ch) =>
        availableChannels.includes(ch),
      );

      if (!allChannelsValid) return;

      loadChunk(currentTime);
    }
  }, [timeWindow]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (loadChunkTimeout) {
        clearTimeout(loadChunkTimeout);
      }
    };
  }, [loadChunkTimeout]);

  // Overview data is now loaded via TanStack Query hooks above
  // No need for manual useEffect - the hooks handle caching, loading states, and refetching

  useEffect(() => {
    updatePlotState({ preprocessing });

    if (workflowRecording.isRecording && fileManager.selectedFile) {
      const recordPreprocessing = async () => {
        try {
          if (preprocessing.highpass || preprocessing.lowpass) {
            const action = createTransformDataAction(
              fileManager.selectedFile!.file_path,
              {
                type: "BandpassFilter",
                low_freq: preprocessing.highpass || 0.1,
                high_freq: preprocessing.lowpass || 100,
              },
            );
            await recordAction(action);
            incrementActionCount();
          }
        } catch {
          // Recording failed silently
        }
      };
      recordPreprocessing();
    }
  }, [preprocessing, updatePlotState]);

  useEffect(() => {
    if (fileManager.selectedFile && selectedChannels.length > 0) {
      const availableChannels = fileManager.selectedFile.channels;
      const allChannelsValid = selectedChannels.every((ch) =>
        availableChannels.includes(ch),
      );

      if (!allChannelsValid) return;

      loadChunk(currentTime);
    }
  }, [preprocessing]);

  // Update popout windows when data changes
  useEffect(() => {
    if (plot.currentChunk) {
      const timeSeriesData = {
        channels: plot.currentChunk.channels,
        data: plot.currentChunk.data,
        timestamps: plot.currentChunk.timestamps,
        sampleRate: plot.currentChunk.sample_rate,
        chunkStart: plot.currentChunk.chunk_start,
        timeWindow: timeWindow,
        currentTime: currentTime,
        filters: preprocessing,
      };

      broadcastToType("timeseries", "data-update", timeSeriesData).catch(
        () => {},
      );
    }
  }, [
    plot.currentChunk,
    currentTime,
    timeWindow,
    preprocessing,
    broadcastToType,
  ]);

  if (!fileManager.selectedFile) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent>
          <div className="text-center">
            <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No File Selected</h3>
            <p className="text-muted-foreground">
              Select an EDF file from the file manager to start plotting
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Controls Panel */}
      <Card className="flex-shrink-0">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Data Visualization</CardTitle>
              <CardDescription>
                {fileManager.selectedFile.file_name} • {selectedChannels.length}{" "}
                channels
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPreprocessing(!showPreprocessing)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Preprocessing
              </Button>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePopOut}
                disabled={!plot.currentChunk}
                title="Pop out to separate window"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Pop Out
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Navigation Controls */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handleSeek(Math.max(0, currentTime - timeWindow))
                }
                disabled={loading || currentTime <= 0}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handleSeek(
                    Math.min(duration - timeWindow, currentTime + timeWindow),
                  )
                }
                disabled={loading || currentTime >= duration - timeWindow}
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1">
              <Label className="text-sm">
                Time: {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
              </Label>
              <Slider
                value={[currentTime]}
                onValueChange={([time]) => handleSeek(time)}
                min={0}
                max={Math.max(0, duration - timeWindow)}
                step={0.1}
                className="mt-1"
              />
            </div>
          </div>

          <Separator />

          {/* Display Controls */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Label className="text-sm">Time Window (s)</Label>
              <Select
                value={timeWindow.toString()}
                onValueChange={(value) => setTimeWindow(parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5s</SelectItem>
                  <SelectItem value="10">10s</SelectItem>
                  <SelectItem value="15">15s</SelectItem>
                  <SelectItem value="30">30s</SelectItem>
                  <SelectItem value="60">60s</SelectItem>
                  <SelectItem value="120">120s</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm">Channel Spacing</Label>
              <Input
                type="number"
                value={channelOffset}
                onChange={(e) => {
                  setChannelOffset(parseInt(e.target.value) || 0);
                  // Reset stable offset so it recalculates with new spacing
                  stableOffsetRef.current = null;
                }}
                min="10"
                max="200"
                step="10"
              />
            </div>

            <div className="flex items-end space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setChannelOffset(70);
                  setCurrentTime(0);
                  // Reset stable offset to recalculate with default spacing
                  stableOffsetRef.current = null;
                }}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Clear user zoom
                  userZoomRef.current = null;
                  // Update chunk range and redraw
                  currentChunkRangeRef.current = {
                    min: currentTime,
                    max: currentTime + timeWindow,
                  };
                  if (uplotRef.current) {
                    uplotRef.current.redraw();
                  }
                }}
                title="Reset X-axis zoom"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Preprocessing Controls */}
          {showPreprocessing && (
            <div className="border rounded-lg p-4 space-y-4 max-h-96 overflow-y-auto">
              <div className="flex items-center justify-between sticky top-0 bg-background pb-2">
                <h4 className="font-medium">Preprocessing Options</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreprocessing(getDefaultPreprocessing())}
                >
                  Reset All
                </Button>
              </div>

              {/* Filters */}
              <Separator />
              <div className="space-y-3">
                <h5 className="text-sm font-medium">Filters</h5>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">High-pass (Hz)</Label>
                    <Input
                      type="number"
                      value={preprocessing.highpass || ""}
                      onChange={(e) =>
                        setPreprocessing((prev) => ({
                          ...prev,
                          highpass: e.target.value
                            ? parseFloat(e.target.value)
                            : undefined,
                        }))
                      }
                      placeholder="0.5"
                      step="0.1"
                      min="0"
                      className="h-8"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Low-pass (Hz)</Label>
                    <Input
                      type="number"
                      value={preprocessing.lowpass || ""}
                      onChange={(e) =>
                        setPreprocessing((prev) => ({
                          ...prev,
                          lowpass: e.target.value
                            ? parseFloat(e.target.value)
                            : undefined,
                        }))
                      }
                      placeholder="70"
                      step="1"
                      min="1"
                      className="h-8"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Notch Filters</Label>
                  <div className="flex items-center space-x-3 mt-1">
                    <div className="flex items-center space-x-1">
                      <Checkbox
                        id="notch-50"
                        checked={preprocessing.notch?.includes(50) || false}
                        onCheckedChange={(checked) => {
                          setPreprocessing((prev) => ({
                            ...prev,
                            notch: checked
                              ? [...(prev.notch || []), 50]
                              : (prev.notch || []).filter((f) => f !== 50),
                          }));
                        }}
                      />
                      <Label htmlFor="notch-50" className="text-xs">
                        50Hz
                      </Label>
                    </div>

                    <div className="flex items-center space-x-1">
                      <Checkbox
                        id="notch-60"
                        checked={preprocessing.notch?.includes(60) || false}
                        onCheckedChange={(checked) => {
                          setPreprocessing((prev) => ({
                            ...prev,
                            notch: checked
                              ? [...(prev.notch || []), 60]
                              : (prev.notch || []).filter((f) => f !== 60),
                          }));
                        }}
                      />
                      <Label htmlFor="notch-60" className="text-xs">
                        60Hz
                      </Label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Signal Enhancement */}
              <Separator />
              <div className="space-y-3">
                <h5 className="text-sm font-medium">Signal Enhancement</h5>

                <div>
                  <Label className="text-xs">Baseline Correction</Label>
                  <Select
                    value={preprocessing.baselineCorrection || "none"}
                    onValueChange={(value: "none" | "mean" | "median") =>
                      setPreprocessing((prev) => ({
                        ...prev,
                        baselineCorrection: value,
                      }))
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="mean">Mean</SelectItem>
                      <SelectItem value="median">Median</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="smoothing-enabled"
                      checked={preprocessing.smoothing?.enabled || false}
                      onCheckedChange={(checked) => {
                        setPreprocessing((prev) => ({
                          ...prev,
                          smoothing: {
                            ...prev.smoothing,
                            enabled: !!checked,
                            method: prev.smoothing?.method || "moving_average",
                            windowSize: prev.smoothing?.windowSize || 5,
                          },
                        }));
                      }}
                    />
                    <Label htmlFor="smoothing-enabled" className="text-xs">
                      Smoothing
                    </Label>
                  </div>
                  {preprocessing.smoothing?.enabled && (
                    <div className="pl-6 space-y-2">
                      <Select
                        value={preprocessing.smoothing.method}
                        onValueChange={(
                          value: "moving_average" | "savitzky_golay",
                        ) =>
                          setPreprocessing((prev) => ({
                            ...prev,
                            smoothing: { ...prev.smoothing!, method: value },
                          }))
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="moving_average">
                            Moving Average
                          </SelectItem>
                          <SelectItem value="savitzky_golay">
                            Savitzky-Golay
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <div>
                        <Label className="text-xs">
                          Window Size: {preprocessing.smoothing.windowSize}
                        </Label>
                        <Slider
                          value={[preprocessing.smoothing.windowSize]}
                          onValueChange={([value]) =>
                            setPreprocessing((prev) => ({
                              ...prev,
                              smoothing: {
                                ...prev.smoothing!,
                                windowSize: value,
                              },
                            }))
                          }
                          min={3}
                          max={21}
                          step={2}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Artifact Removal */}
              <Separator />
              <div className="space-y-3">
                <h5 className="text-sm font-medium">Artifact Removal</h5>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="outlier-enabled"
                      checked={preprocessing.outlierRemoval?.enabled || false}
                      onCheckedChange={(checked) => {
                        setPreprocessing((prev) => ({
                          ...prev,
                          outlierRemoval: {
                            enabled: !!checked,
                            method: prev.outlierRemoval?.method || "clip",
                            threshold: prev.outlierRemoval?.threshold || 3,
                          },
                        }));
                      }}
                    />
                    <Label htmlFor="outlier-enabled" className="text-xs">
                      Outlier Removal
                    </Label>
                  </div>
                  {preprocessing.outlierRemoval?.enabled && (
                    <div className="pl-6 space-y-2">
                      <Select
                        value={preprocessing.outlierRemoval.method}
                        onValueChange={(
                          value: "clip" | "remove" | "interpolate",
                        ) =>
                          setPreprocessing((prev) => ({
                            ...prev,
                            outlierRemoval: {
                              ...prev.outlierRemoval!,
                              method: value,
                            },
                          }))
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="clip">Clip</SelectItem>
                          <SelectItem value="remove">Remove</SelectItem>
                          <SelectItem value="interpolate">
                            Interpolate
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <div>
                        <Label className="text-xs">
                          Threshold (σ):{" "}
                          {preprocessing.outlierRemoval.threshold}
                        </Label>
                        <Slider
                          value={[preprocessing.outlierRemoval.threshold]}
                          onValueChange={([value]) =>
                            setPreprocessing((prev) => ({
                              ...prev,
                              outlierRemoval: {
                                ...prev.outlierRemoval!,
                                threshold: value,
                              },
                            }))
                          }
                          min={1}
                          max={6}
                          step={0.5}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="spike-enabled"
                      checked={preprocessing.spikeRemoval?.enabled || false}
                      onCheckedChange={(checked) => {
                        setPreprocessing((prev) => ({
                          ...prev,
                          spikeRemoval: {
                            enabled: !!checked,
                            threshold: prev.spikeRemoval?.threshold || 4,
                            windowSize: prev.spikeRemoval?.windowSize || 10,
                          },
                        }));
                      }}
                    />
                    <Label htmlFor="spike-enabled" className="text-xs">
                      Spike Removal
                    </Label>
                  </div>
                  {preprocessing.spikeRemoval?.enabled && (
                    <div className="pl-6 space-y-2">
                      <div>
                        <Label className="text-xs">
                          Threshold (σ): {preprocessing.spikeRemoval.threshold}
                        </Label>
                        <Slider
                          value={[preprocessing.spikeRemoval.threshold]}
                          onValueChange={([value]) =>
                            setPreprocessing((prev) => ({
                              ...prev,
                              spikeRemoval: {
                                ...prev.spikeRemoval!,
                                threshold: value,
                              },
                            }))
                          }
                          min={2}
                          max={8}
                          step={0.5}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">
                          Window Size: {preprocessing.spikeRemoval.windowSize}
                        </Label>
                        <Slider
                          value={[preprocessing.spikeRemoval.windowSize]}
                          onValueChange={([value]) =>
                            setPreprocessing((prev) => ({
                              ...prev,
                              spikeRemoval: {
                                ...prev.spikeRemoval!,
                                windowSize: value,
                              },
                            }))
                          }
                          min={5}
                          max={25}
                          step={5}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Normalization */}
              <Separator />
              <div className="space-y-3">
                <h5 className="text-sm font-medium">Normalization</h5>
                <div>
                  <Label className="text-xs">Method</Label>
                  <Select
                    value={preprocessing.normalization || "none"}
                    onValueChange={(value: "none" | "zscore" | "minmax") =>
                      setPreprocessing((prev) => ({
                        ...prev,
                        normalization: value,
                      }))
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="zscore">Z-score</SelectItem>
                      <SelectItem value="minmax">Min-Max</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Channel Selection */}
          <ChannelSelector
            channels={fileManager.selectedFile.channels}
            selectedChannels={selectedChannels}
            onSelectionChange={(channels) => {
              if (!fileManager.selectedFile) return;
              const sortedChannels = channels.sort((a, b) => {
                const indexA = fileManager.selectedFile!.channels.indexOf(a);
                const indexB = fileManager.selectedFile!.channels.indexOf(b);
                return indexA - indexB;
              });
              persistSelectedChannels(sortedChannels);
            }}
            label="Channels"
            description="Select channels to display in the plot"
            variant="compact"
            maxHeight="max-h-32"
          />
        </CardContent>
      </Card>

      {/* Overview/Minimap - Global navigation for entire file */}
      <div className="flex-shrink-0">
        <OverviewPlot
          overviewData={overviewData || null}
          currentTime={currentTime}
          timeWindow={timeWindow}
          duration={duration}
          onSeek={handleSeek}
          loading={overviewLoading}
          progress={overviewProgress}
        />
      </div>

      {/* Plot Area */}
      <Card className="flex-1 flex flex-col min-h-0">
        <CardContent className="p-4 flex-1 flex flex-col min-h-0">
          {error && (
            <div className="flex items-center space-x-2 text-red-600 mb-4">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">Loading data...</p>
              </div>
            </div>
          )}

          <div
            className="w-full flex-1 relative"
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();

              if (!uplotRef.current || !plot.currentChunk) return;

              const rect = e.currentTarget.getBoundingClientRect();
              const plotX = e.clientX - rect.left;
              const plotWidth = rect.width;
              const timeValue = currentTime + (plotX / plotWidth) * timeWindow;

              timeSeriesAnnotations.openContextMenu(
                e.clientX,
                e.clientY,
                timeValue,
              );
            }}
          >
            <div ref={plotRef} className="w-full h-full" />

            {/* Annotation overlay */}
            {uplotRef.current &&
              plot.currentChunk &&
              timeSeriesAnnotations.annotations.length > 0 && (
                <svg
                  className="absolute top-0 left-0"
                  style={{
                    width: plotRef.current?.clientWidth || 0,
                    height: plotRef.current?.clientHeight || 0,
                    pointerEvents: "none",
                  }}
                >
                  {timeSeriesAnnotations.annotations.map((annotation) => {
                    // Only show annotations in current time window
                    if (
                      annotation.position < currentTime ||
                      annotation.position > currentTime + timeWindow
                    ) {
                      return null;
                    }

                    // Get uPlot bbox for accurate dimensions
                    const bbox = uplotRef.current?.bbox;
                    const plotWidth =
                      bbox?.width || plotRef.current?.clientWidth || 800;
                    const plotHeight =
                      bbox?.height || plotRef.current?.clientHeight || 400;
                    const relativeTime = annotation.position - currentTime;
                    const xPosition = (relativeTime / timeWindow) * plotWidth;

                    return (
                      <AnnotationMarker
                        key={annotation.id}
                        annotation={annotation}
                        plotHeight={plotHeight}
                        xPosition={xPosition}
                        onRightClick={(e, ann) => {
                          e.preventDefault();
                          timeSeriesAnnotations.openContextMenu(
                            e.clientX,
                            e.clientY,
                            ann.position,
                            ann,
                          );
                        }}
                        onClick={(ann) => {
                          const rect = plotRef.current?.getBoundingClientRect();
                          if (rect) {
                            timeSeriesAnnotations.handleAnnotationClick(
                              ann,
                              rect.left + xPosition,
                              rect.top + 50,
                            );
                          }
                        }}
                      />
                    );
                  })}
                </svg>
              )}
          </div>

          {/* Annotation context menu */}
          {timeSeriesAnnotations.contextMenu && (
            <AnnotationContextMenu
              x={timeSeriesAnnotations.contextMenu.x}
              y={timeSeriesAnnotations.contextMenu.y}
              plotPosition={timeSeriesAnnotations.contextMenu.plotPosition}
              existingAnnotation={timeSeriesAnnotations.contextMenu.annotation}
              onCreateAnnotation={timeSeriesAnnotations.handleCreateAnnotation}
              onEditAnnotation={timeSeriesAnnotations.handleUpdateAnnotation}
              onDeleteAnnotation={timeSeriesAnnotations.handleDeleteAnnotation}
              onClose={timeSeriesAnnotations.closeContextMenu}
              availablePlots={availablePlots}
              currentPlotId="timeseries"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Export memoized version to prevent unnecessary re-renders
// Only re-render when apiService reference changes (should be stable)
export const TimeSeriesPlot = memo(TimeSeriesPlotComponent);
