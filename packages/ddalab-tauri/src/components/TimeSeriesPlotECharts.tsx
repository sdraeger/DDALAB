"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { ChunkData } from "@/types/api";
import {
  useChunkData,
  useOverviewData,
  useInvalidateTimeSeriesCache,
} from "@/hooks/useTimeSeriesData";
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
  Loader2,
  ChevronDown,
  ChevronRight,
  Sliders,
} from "lucide-react";
import * as echarts from "echarts";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { useTimeSeriesAnnotations } from "@/hooks/useAnnotations";
import { AnnotationContextMenu } from "@/components/annotations/AnnotationContextMenu";
import { AnnotationMarker } from "@/components/annotations/AnnotationMarker";
import { PreprocessingOptions } from "@/types/persistence";
import {
  applyPreprocessing,
  getDefaultPreprocessing,
} from "@/utils/preprocessing";
import { useWorkflow } from "@/hooks/useWorkflow";
import { createTransformDataAction } from "@/types/workflow";
import { OverviewPlot } from "@/components/OverviewPlot";

interface TimeSeriesPlotProps {
  apiService: ApiService;
}

export function TimeSeriesPlotECharts({ apiService }: TimeSeriesPlotProps) {
  const {
    fileManager,
    plot,
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
  });

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const loadedFileRef = useRef<string | null>(null);
  const isInitialChannelSetRef = useRef<boolean>(true);
  const stableOffsetRef = useRef<number | null>(null);
  const pendingRenderRef = useRef<{
    chunkData: ChunkData;
    startTime: number;
  } | null>(null);
  const currentLabelsRef = useRef<{
    channels: string[];
    autoOffset: number;
  } | null>(null);

  const [currentTime, setCurrentTime] = useState(plot.chunkStart || 0);
  const [duration, setDuration] = useState(0);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  // Preprocessing controls (must be declared before TanStack Query hooks)
  const [showPreprocessing, setShowPreprocessing] = useState(false);
  const [preprocessing, setPreprocessing] = useState<PreprocessingOptions>(
    plot.preprocessing || getDefaultPreprocessing()
  );

  // Cache invalidation utilities
  const { invalidateFile } = useInvalidateTimeSeriesCache();

  // Calculate chunk parameters
  const timeWindow = useRef(
    plot.chunkSize / (fileManager.selectedFile?.sample_rate || 256) || 5
  ).current;
  const chunkSize = useMemo(() => {
    if (!fileManager.selectedFile) return 0;
    return Math.floor(timeWindow * fileManager.selectedFile.sample_rate);
  }, [timeWindow, fileManager.selectedFile?.sample_rate]);

  const chunkStart = useMemo(() => {
    if (!fileManager.selectedFile) return 0;
    return Math.floor(currentTime * fileManager.selectedFile.sample_rate);
  }, [currentTime, fileManager.selectedFile?.sample_rate]);

  // Only enable queries when chart is ready to avoid premature data fetching
  const [isChartReady, setIsChartReady] = useState(false);

  // TanStack Query: Load chunk data
  const {
    data: chunkData,
    isLoading: chunkLoading,
    error: chunkError,
    refetch: refetchChunk,
  } = useChunkData(
    apiService,
    fileManager.selectedFile?.file_path || "",
    chunkStart,
    chunkSize,
    selectedChannels,
    preprocessing.highpass ||
      preprocessing.lowpass ||
      (preprocessing.notch && preprocessing.notch.length > 0)
      ? {
          highpass: preprocessing.highpass,
          lowpass: preprocessing.lowpass,
          notch: preprocessing.notch,
        }
      : undefined,
    !!(fileManager.selectedFile && selectedChannels.length > 0 && isChartReady)
  );

  // TanStack Query: Load overview data
  const {
    data: overviewData,
    isLoading: overviewLoading,
    error: overviewError,
  } = useOverviewData(
    apiService,
    fileManager.selectedFile?.file_path || "",
    selectedChannels,
    2000,
    !!(fileManager.selectedFile && selectedChannels.length > 0 && isChartReady)
  );

  // Derived loading/error states for UI
  const loading = chunkLoading;
  const error = chunkError ? (chunkError as Error).message : null;

  // Sync preprocessing with plot state
  useEffect(() => {
    if (plot.preprocessing) {
      setPreprocessing(plot.preprocessing);
    }
  }, [plot.preprocessing]);

  // Save preprocessing when it changes
  const handlePreprocessingChange = (
    newPreprocessing: PreprocessingOptions
  ) => {
    setPreprocessing(newPreprocessing);
    updatePlotState({ preprocessing: newPreprocessing });
    // Query will automatically refetch with new preprocessing due to query key change
  };

  // Time window control (in seconds) - start with smaller window for better performance
  const timeWindowRef = useRef(
    plot.chunkSize / (fileManager.selectedFile?.sample_rate || 256) || 5
  );

  // Channel offset for stacking
  const channelOffsetSliderRef = useRef(50); // User-defined offset percentage

  // Initialize ECharts instance
  useEffect(() => {
    if (!chartRef.current) return;

    // Prevent double initialization in React strict mode
    if (chartInstanceRef.current) return;

    // Wait for DOM to be fully ready with dimensions
    const initChart = () => {
      if (!chartRef.current) return;

      // Check again if already initialized (race condition protection)
      if (chartInstanceRef.current) return;

      const { clientWidth, clientHeight } = chartRef.current;
      if (clientWidth === 0 || clientHeight === 0) {
        // DOM not ready yet, wait for next frame
        requestAnimationFrame(initChart);
        return;
      }

      console.log("[ECharts] Initializing chart with dimensions:", {
        clientWidth,
        clientHeight,
      });

      // Get existing instance if any, or create new one
      let chart = echarts.getInstanceByDom(chartRef.current);

      if (!chart) {
        // Create chart instance with Canvas renderer for better performance
        chart = echarts.init(chartRef.current, null, {
          renderer: "canvas", // Use canvas renderer (WebGL not directly available in ECharts 5, but very optimized)
          useDirtyRect: true, // Performance optimization
        });
      }

      chartInstanceRef.current = chart;

      // Mark chart as ready for data loading
      setIsChartReady(true);

      // Setup resize observer with error suppression
      const resizeObserver = new ResizeObserver(() => {
        // Wrap in requestAnimationFrame to avoid "ResizeObserver loop" errors
        requestAnimationFrame(() => {
          chart?.resize();
          // Update channel labels after resize to keep them aligned
          updateChannelLabels();
        });
      });
      resizeObserver.observe(chartRef.current);
      resizeObserverRef.current = resizeObserver;

      console.log("[ECharts] Chart initialized successfully");

      // Add right-click handler for annotations
      chartRef.current.addEventListener("contextmenu", handleChartRightClick);

      // Render any pending data that arrived before chart was ready
      if (pendingRenderRef.current) {
        console.log("[ECharts] Rendering pending data after initialization");
        const { chunkData, startTime } = pendingRenderRef.current;
        pendingRenderRef.current = null;
        // Use setTimeout to ensure chart is fully ready
        setTimeout(() => renderChart(chunkData, startTime), 0);
      }
    };

    initChart();

    return () => {
      console.log("[ECharts] Cleaning up chart instance");
      // Remove right-click handler
      if (chartRef.current) {
        chartRef.current.removeEventListener(
          "contextmenu",
          handleChartRightClick
        );
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
        setIsChartReady(false);
      }
    };
  }, []);

  // Process and render chunk data when query data changes
  useEffect(() => {
    if (!chunkData || !fileManager.selectedFile) return;

    console.log("[ECharts] Chunk data received from query:", {
      dataLength: chunkData.data?.length,
      timestampsLength: chunkData.timestamps?.length,
      channels: chunkData.channels?.length,
    });

    if (!chunkData.data || chunkData.data.length === 0) {
      console.error("No data received from query");
      return;
    }

    // Apply preprocessing
    const preprocessedData = chunkData.data.map((channelData) =>
      applyPreprocessing(
        channelData,
        fileManager.selectedFile!.sample_rate,
        preprocessing
      )
    );

    const processedChunk: ChunkData = {
      ...chunkData,
      data: preprocessedData,
    };

    setCurrentChunk(processedChunk);
    renderChart(processedChunk, currentTime);
  }, [chunkData, fileManager.selectedFile, preprocessing, currentTime]);

  // Load chunk - with TanStack Query, we just update the currentTime state
  // The query will automatically refetch based on the new query key
  const loadChunk = useCallback(
    (startTime: number) => {
      if (!fileManager.selectedFile || selectedChannels.length === 0) {
        console.log("Cannot load chunk: no file or channels selected");
        return;
      }

      if (fileManager.selectedFile.duration === 0) {
        console.error("File has no duration - data may not be properly loaded");
        return;
      }

      console.log("[ECharts] Loading chunk at time:", startTime);
      setCurrentTime(startTime);
      updatePlotState({ chunkStart: startTime });
    },
    [fileManager.selectedFile, selectedChannels]
  );

  // Update channel labels based on current data
  const updateChannelLabels = useCallback(() => {
    if (!chartInstanceRef.current || !currentLabelsRef.current) return;

    const { channels, autoOffset } = currentLabelsRef.current;

    const channelLabels = channels.map((channelName, channelIndex) => {
      const yValue = channelIndex * autoOffset;
      const pixelY = chartInstanceRef.current!.convertToPixel(
        { yAxisIndex: 0 },
        yValue
      );

      return {
        type: "text",
        right: "auto",
        left: 10,
        top: pixelY - 10,
        z: 100,
        style: {
          text: channelName,
          fontSize: 12,
          fontWeight: "bold",
          fill: "#e5e5e5",
          backgroundColor: "rgba(24, 24, 27, 0.9)",
          padding: [4, 8],
          borderRadius: 4,
          borderColor: "rgba(63, 63, 70, 1)",
          borderWidth: 1,
        },
      };
    });

    chartInstanceRef.current.setOption({
      graphic: channelLabels,
    });
  }, []);

  // Render chart with ECharts
  const renderChart = (chunkData: ChunkData, startTime: number) => {
    console.log("[ECharts] renderChart called:", {
      hasChartInstance: !!chartInstanceRef.current,
      hasData: !!chunkData.data,
      dataLength: chunkData.data?.length || 0,
    });

    if (!chartInstanceRef.current) {
      console.warn(
        "[ECharts] Chart instance not ready, storing for later render"
      );
      // Store the data to render once chart is initialized
      pendingRenderRef.current = { chunkData, startTime };
      return;
    }

    if (!chunkData.data || chunkData.data.length === 0) {
      console.warn("[ECharts] No data to render");
      return;
    }

    const chart = chartInstanceRef.current;
    const timeWindow = timeWindowRef.current;

    // Calculate channel offset for stacking with improved spacing algorithm
    const userOffset = channelOffsetSliderRef.current;

    // Auto-calculate stable offset based on data range with proper spacing
    let autoOffset = 0;
    if (stableOffsetRef.current === null) {
      // Calculate peak-to-peak range for each channel (more robust than just first 100 samples)
      const channelRanges = chunkData.data.map((channelData) => {
        // Sample across the entire chunk for better representation
        const sampleSize = Math.min(1000, channelData.length);
        const step = Math.max(1, Math.floor(channelData.length / sampleSize));
        const samples = [];
        for (let i = 0; i < channelData.length; i += step) {
          samples.push(channelData[i]);
        }
        const min = Math.min(...samples);
        const max = Math.max(...samples);
        return max - min;
      });

      const maxRange = Math.max(...channelRanges);
      const avgRange =
        channelRanges.reduce((a, b) => a + b, 0) / channelRanges.length;

      // Use a spacing multiplier that ensures clear separation
      // Base spacing is 3x the average range, plus user adjustment
      // Minimum spacing is 2x max range to prevent any overlap
      const baseMultiplier = 3.0;
      const userMultiplier = userOffset / 50; // Convert percentage to multiplier (50% = 1x additional)
      const spacingMultiplier = baseMultiplier + userMultiplier;

      autoOffset = Math.max(
        avgRange * spacingMultiplier,
        maxRange * 2.0 // Ensure minimum separation of 2x max range
      );

      stableOffsetRef.current = autoOffset;
      console.log("[ECharts] Calculated spacing:", {
        maxRange,
        avgRange,
        spacingMultiplier,
        finalOffset: autoOffset,
      });
    } else {
      autoOffset = stableOffsetRef.current;
    }

    console.log("[ECharts] Auto-calculated offset:", autoOffset);

    // Prepare series data with aggressive decimation for better performance
    const series = chunkData.channels.map((channelName, channelIndex) => {
      const channelData = chunkData.data[channelIndex];

      // Decimate data intelligently based on visible pixels
      // For a typical 2000px wide chart, we don't need more than 4000 points
      const maxPoints = 4000;
      let decimatedData;

      if (channelData.length > maxPoints) {
        // Use simple decimation - take every Nth point
        const step = Math.ceil(channelData.length / maxPoints);
        decimatedData = [];
        for (let i = 0; i < channelData.length; i += step) {
          const time = startTime + i / chunkData.sample_rate;
          const offsetValue = channelData[i] + channelIndex * autoOffset;
          decimatedData.push([time, offsetValue]);
        }
        console.log(
          `[ECharts] Decimated channel ${channelName}: ${channelData.length} → ${decimatedData.length} points`
        );
      } else {
        // Apply stacking offset without decimation
        decimatedData = channelData.map((value, idx) => {
          const time = startTime + idx / chunkData.sample_rate;
          const offsetValue = value + channelIndex * autoOffset;
          return [time, offsetValue];
        });
      }

      return {
        name: channelName,
        type: "line" as const,
        data: decimatedData,
        symbol: "none", // No markers for performance
        sampling: "lttb" as const, // Additional downsampling by ECharts (Largest-Triangle-Three-Buckets)
        large: true, // Enable large mode for better performance with lots of data
        largeThreshold: 2000, // Use large mode if more than 2000 points
        progressive: 500, // Progressive rendering - render 500 points at a time
        progressiveThreshold: 1000, // Enable progressive rendering for >1000 points
        lineStyle: {
          width: 1,
        },
        emphasis: {
          disabled: true, // Disable hover effects for performance
        },
        animation: false, // Disable animation for performance
      };
    });

    // Configure chart options
    const option: echarts.EChartsOption = {
      title: {
        text: "Time Series Plot",
        left: "center",
        textStyle: {
          fontSize: 14,
          color: "hsl(var(--foreground))",
        },
      },
      tooltip: {
        show: false, // Disable default tooltip - use right-click annotation menu instead
      },
      legend: {
        data: chunkData.channels,
        top: 30,
        textStyle: {
          color: "hsl(var(--foreground))",
        },
      },
      grid: {
        left: "120px",
        right: "4%",
        bottom: "10%",
        top: "15%",
        containLabel: false,
      },
      toolbox: {
        feature: {
          dataZoom: {
            yAxisIndex: "none",
          },
          restore: {},
          saveAsImage: {},
        },
      },
      xAxis: {
        type: "value",
        name: "Time (s)",
        nameLocation: "middle",
        nameGap: 30,
        min: startTime,
        max: startTime + timeWindow,
        axisLabel: {
          color: "hsl(var(--foreground))",
        },
      },
      yAxis: {
        type: "value",
        name: "", // Remove amplitude label
        axisLabel: {
          show: false, // Hide numeric labels since we'll show channel names
        },
        axisTick: {
          show: false,
        },
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          filterMode: "none", // Don't filter data when zooming
          throttle: 100, // Throttle zoom events to 100ms for better performance
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
        },
        {
          type: "slider",
          xAxisIndex: 0,
          filterMode: "none",
          throttle: 100, // Throttle slider updates to 100ms
          textStyle: {
            color: "hsl(var(--foreground))",
          },
        },
      ],
      series: series,
    };

    // Use setOption with notMerge: false for better performance when updating
    chart.setOption(option, {
      notMerge: false, // Merge with existing option for better performance
      lazyUpdate: false,
    });

    // Store label data and update labels after chart is rendered (so convertToPixel works)
    currentLabelsRef.current = {
      channels: chunkData.channels,
      autoOffset: autoOffset,
    };

    setTimeout(() => {
      updateChannelLabels();
    }, 0);

    console.log("[ECharts] Chart rendered with", series.length, "series");

    // Broadcast to popout windows
    broadcastToType("timeseries", "data-update", { chunkData, startTime });
  };

  // Handle file/channel changes
  useEffect(() => {
    const currentFilePath = fileManager.selectedFile?.file_path;
    const hasChannelsSelected = selectedChannels.length > 0;
    const isNewFile = currentFilePath !== loadedFileRef.current;

    console.log("[ECharts] File/channel effect:", {
      hasFile: !!fileManager.selectedFile,
      channelsSelected: selectedChannels.length,
      isNewFile,
    });

    if (
      fileManager.selectedFile &&
      fileManager.selectedFile.channels?.length > 0 &&
      hasChannelsSelected &&
      (isNewFile || isInitialChannelSetRef.current)
    ) {
      console.log("[ECharts] Triggering chunk load");

      if (isNewFile) {
        stableOffsetRef.current = null;
        // Reset to start for new files
        const startTime = 0;
        loadChunk(startTime);
        setCurrentTime(startTime);
      } else {
        // Restore saved time position for same file
        const startTime = plot.chunkStart || 0;
        loadChunk(startTime);
        setCurrentTime(startTime);
      }

      setDuration(fileManager.selectedFile.duration);
      loadedFileRef.current = currentFilePath!;
      isInitialChannelSetRef.current = false;
    } else if (
      !isNewFile &&
      !isInitialChannelSetRef.current &&
      hasChannelsSelected
    ) {
      console.log(
        "[ECharts] Same file, channels changed - will refetch via TanStack Query"
      );
      // TanStack Query will automatically refetch when selectedChannels changes
      // No need for manual debouncing - query already handles deduplication
    }
  }, [fileManager.selectedFile?.file_path, selectedChannels, loadChunk]);

  // Sync selected channels with file
  useEffect(() => {
    if (fileManager.selectedFile && fileManager.selectedChannels.length > 0) {
      setSelectedChannels(fileManager.selectedChannels);
    } else if (
      fileManager.selectedFile &&
      fileManager.selectedFile.channels.length > 0
    ) {
      // Auto-select first 8 channels
      const initialChannels = fileManager.selectedFile.channels.slice(0, 8);
      setSelectedChannels(initialChannels);
      persistSelectedChannels(initialChannels);
    }
  }, [fileManager.selectedFile, fileManager.selectedChannels]);

  // Overview data is now loaded automatically by TanStack Query hook
  // Log when overview data changes
  useEffect(() => {
    if (overviewData) {
      console.log("[OVERVIEW] Overview loaded successfully from query:", {
        channels: overviewData.channels.length,
        pointsPerChannel: overviewData.data[0]?.length || 0,
      });
    }
  }, [overviewData]);

  // Right-click handler for annotations
  const handleChartRightClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();

      if (!chartInstanceRef.current) return;

      // Get the chart's bounding rectangle
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Convert pixel position to time value
      // ECharts uses the convertFromPixel method
      const pointInGrid = chartInstanceRef.current.convertFromPixel(
        { seriesIndex: 0 },
        [x, 0]
      );

      if (pointInGrid && typeof pointInGrid[0] === "number") {
        const timePosition = pointInGrid[0];

        // Check if clicking on an existing annotation
        const clickedAnnotation = timeSeriesAnnotations.annotations.find(
          (ann) => Math.abs(ann.position - timePosition) < 0.5 // 0.5 second tolerance
        );

        timeSeriesAnnotations.openContextMenu(
          e.clientX,
          e.clientY,
          timePosition,
          clickedAnnotation
        );
      }
    },
    [timeSeriesAnnotations]
  );

  // Navigation handlers
  const handlePrevChunk = () => {
    const newTime = Math.max(0, currentTime - timeWindowRef.current);
    loadChunk(newTime);
  };

  const handleNextChunk = () => {
    const maxTime = duration - timeWindowRef.current;
    const newTime = Math.min(maxTime, currentTime + timeWindowRef.current);
    loadChunk(newTime);
  };

  const handleTimeWindowChange = (value: number[]) => {
    const newWindow = value[0];
    const sampleRate = fileManager.selectedFile?.sample_rate || 256;
    const totalSamples = newWindow * sampleRate * selectedChannels.length;

    // Warn if loading might be slow (>500k samples)
    if (totalSamples > 500000) {
      console.warn(
        `[ECharts] Large data request: ${totalSamples.toLocaleString()} samples may be slow`
      );
    }

    timeWindowRef.current = newWindow;
    loadChunk(currentTime);
  };

  const handleSeek = (time: number) => {
    console.log("[ECharts] Seek requested to:", time);
    setCurrentTime(time);
    loadChunk(time);
  };

  const handleChannelToggle = (channelName: string, checked: boolean) => {
    const newSelection = checked
      ? [...selectedChannels, channelName]
      : selectedChannels.filter((c) => c !== channelName);

    console.log("[ECharts] Channel toggled:", channelName, "->", checked);
    setSelectedChannels(newSelection);
    persistSelectedChannels(newSelection);
  };

  const handlePopout = () => {
    if (plot.currentChunk) {
      createWindow("timeseries", `timeseries-${Date.now()}`, {
        chunkData: plot.currentChunk,
        startTime: currentTime,
        selectedChannels,
      });
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Time Series Visualization
              <Badge variant="outline" className="ml-2">
                WebGL Optimized
              </Badge>
            </CardTitle>
            <CardDescription>
              {fileManager.selectedFile
                ? `${fileManager.selectedFile.file_name} - ${selectedChannels.length} channels selected`
                : "No file selected"}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePopout}
              disabled={!plot.currentChunk}
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              Pop Out
            </Button>
          </div>
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="flex-1 p-4 flex flex-col min-h-0">
        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Controls */}
        <div className="mb-4 space-y-3">
          {/* Time Navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevChunk}
              disabled={loading || currentTime === 0}
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <div className="flex-1 text-sm text-center">
              {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextChunk}
              disabled={
                loading || currentTime >= duration - timeWindowRef.current
              }
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          {/* Seek Slider */}
          <div className="flex items-center gap-3">
            <Label className="text-xs whitespace-nowrap">Position:</Label>
            <Slider
              value={[currentTime]}
              onValueChange={([time]) => handleSeek(time)}
              min={0}
              max={Math.max(0, duration - timeWindowRef.current)}
              step={0.1}
              className="flex-1"
              disabled={loading}
            />
          </div>

          {/* Time Window Control */}
          <div className="flex items-center gap-3">
            <Label className="text-xs whitespace-nowrap">Time Window:</Label>
            <Slider
              value={[timeWindowRef.current]}
              onValueChange={handleTimeWindowChange}
              min={1}
              max={60}
              step={1}
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground w-12">
              {timeWindowRef.current}s
            </span>
          </div>
        </div>

        {/* Overview/Minimap - Global navigation for entire file */}
        <div className="mb-3">
          <OverviewPlot
            overviewData={overviewData || null}
            currentTime={currentTime}
            timeWindow={timeWindowRef.current}
            duration={duration}
            onSeek={handleSeek}
            loading={overviewLoading}
          />
        </div>

        {/* Preprocessing Controls */}
        <div className="mb-3 border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowPreprocessing(!showPreprocessing)}
            className="w-full flex items-center justify-between p-3 bg-accent/30 hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4" />
              <span className="font-medium text-sm">Signal Preprocessing</span>
              {(preprocessing.highpass ||
                preprocessing.lowpass ||
                preprocessing.notch?.length ||
                preprocessing.smoothing?.enabled ||
                preprocessing.outlierRemoval?.enabled) && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  Active
                </Badge>
              )}
            </div>
            {showPreprocessing ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          {showPreprocessing && (
            <div className="p-4 space-y-4 bg-background">
              {/* Filters Section */}
              <div>
                <Label className="text-xs font-semibold uppercase text-muted-foreground mb-2 block">
                  Frequency Filters
                </Label>
                <div className="space-y-3">
                  {/* Highpass Filter */}
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="highpass-enabled"
                      checked={!!preprocessing.highpass}
                      onCheckedChange={(checked) => {
                        handlePreprocessingChange({
                          ...preprocessing,
                          highpass: checked ? 0.5 : undefined,
                        });
                      }}
                    />
                    <Label
                      htmlFor="highpass-enabled"
                      className="text-sm flex-1"
                    >
                      Highpass (removes DC drift)
                    </Label>
                    {preprocessing.highpass !== undefined && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={preprocessing.highpass}
                          onChange={(e) => {
                            handlePreprocessingChange({
                              ...preprocessing,
                              highpass: parseFloat(e.target.value) || 0.5,
                            });
                          }}
                          className="w-20 h-8 text-sm"
                          step="0.1"
                          min="0.1"
                        />
                        <span className="text-xs text-muted-foreground">
                          Hz
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Lowpass Filter */}
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="lowpass-enabled"
                      checked={!!preprocessing.lowpass}
                      onCheckedChange={(checked) => {
                        handlePreprocessingChange({
                          ...preprocessing,
                          lowpass: checked ? 70 : undefined,
                        });
                      }}
                    />
                    <Label htmlFor="lowpass-enabled" className="text-sm flex-1">
                      Lowpass (anti-aliasing)
                    </Label>
                    {preprocessing.lowpass !== undefined && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={preprocessing.lowpass}
                          onChange={(e) => {
                            handlePreprocessingChange({
                              ...preprocessing,
                              lowpass: parseFloat(e.target.value) || 70,
                            });
                          }}
                          className="w-20 h-8 text-sm"
                          step="1"
                          min="1"
                        />
                        <span className="text-xs text-muted-foreground">
                          Hz
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Notch Filter */}
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="notch-enabled"
                      checked={
                        preprocessing.notch && preprocessing.notch.length > 0
                      }
                      onCheckedChange={(checked) => {
                        handlePreprocessingChange({
                          ...preprocessing,
                          notch: checked ? [50] : [],
                        });
                      }}
                    />
                    <Label htmlFor="notch-enabled" className="text-sm flex-1">
                      Notch (line noise)
                    </Label>
                    {preprocessing.notch && preprocessing.notch.length > 0 && (
                      <Select
                        value={preprocessing.notch[0].toString()}
                        onValueChange={(value) => {
                          handlePreprocessingChange({
                            ...preprocessing,
                            notch: [parseInt(value)],
                          });
                        }}
                      >
                        <SelectTrigger className="w-24 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="50">50 Hz</SelectItem>
                          <SelectItem value="60">60 Hz</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              {/* Baseline & Detrending */}
              <div>
                <Label className="text-xs font-semibold uppercase text-muted-foreground mb-2 block">
                  Baseline & Trend
                </Label>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Label className="text-sm flex-1">
                      Baseline Correction
                    </Label>
                    <Select
                      value={preprocessing.baselineCorrection || "none"}
                      onValueChange={(value: any) => {
                        handlePreprocessingChange({
                          ...preprocessing,
                          baselineCorrection: value,
                        });
                      }}
                    >
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="mean">Mean</SelectItem>
                        <SelectItem value="median">Median</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-3">
                    <Label className="text-sm flex-1">Detrending</Label>
                    <Select
                      value={preprocessing.detrending || "none"}
                      onValueChange={(value: any) => {
                        handlePreprocessingChange({
                          ...preprocessing,
                          detrending: value,
                        });
                      }}
                    >
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="linear">Linear</SelectItem>
                        <SelectItem value="polynomial">Polynomial</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Artifact Removal */}
              <div>
                <Label className="text-xs font-semibold uppercase text-muted-foreground mb-2 block">
                  Artifact Removal
                </Label>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="outlier-enabled"
                      checked={preprocessing.outlierRemoval?.enabled || false}
                      onCheckedChange={(checked) => {
                        handlePreprocessingChange({
                          ...preprocessing,
                          outlierRemoval: {
                            enabled: checked as boolean,
                            method:
                              preprocessing.outlierRemoval?.method || "clip",
                            threshold:
                              preprocessing.outlierRemoval?.threshold || 3,
                          },
                        });
                      }}
                    />
                    <Label htmlFor="outlier-enabled" className="text-sm flex-1">
                      Outlier Removal
                    </Label>
                    {preprocessing.outlierRemoval?.enabled && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={preprocessing.outlierRemoval.threshold}
                          onChange={(e) => {
                            handlePreprocessingChange({
                              ...preprocessing,
                              outlierRemoval: {
                                ...preprocessing.outlierRemoval!,
                                threshold: parseFloat(e.target.value) || 3,
                              },
                            });
                          }}
                          className="w-20 h-8 text-sm"
                          step="0.5"
                          min="1"
                        />
                        <span className="text-xs text-muted-foreground">σ</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="smoothing-enabled"
                      checked={preprocessing.smoothing?.enabled || false}
                      onCheckedChange={(checked) => {
                        handlePreprocessingChange({
                          ...preprocessing,
                          smoothing: {
                            enabled: checked as boolean,
                            method:
                              preprocessing.smoothing?.method ||
                              "moving_average",
                            windowSize:
                              preprocessing.smoothing?.windowSize || 5,
                          },
                        });
                      }}
                    />
                    <Label
                      htmlFor="smoothing-enabled"
                      className="text-sm flex-1"
                    >
                      Smoothing
                    </Label>
                    {preprocessing.smoothing?.enabled && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={preprocessing.smoothing.windowSize}
                          onChange={(e) => {
                            handlePreprocessingChange({
                              ...preprocessing,
                              smoothing: {
                                ...preprocessing.smoothing!,
                                windowSize: parseInt(e.target.value) || 5,
                              },
                            });
                          }}
                          className="w-20 h-8 text-sm"
                          step="1"
                          min="3"
                        />
                        <span className="text-xs text-muted-foreground">
                          pts
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Reset Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handlePreprocessingChange(getDefaultPreprocessing())
                }
                className="w-full"
              >
                <RotateCcw className="h-3 w-3 mr-2" />
                Reset All
              </Button>
            </div>
          )}
        </div>

        {/* Chart Container */}
        <div className="flex-1 relative min-h-0">
          {loading && (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3 bg-background border rounded-lg p-6 shadow-lg">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div className="text-sm font-medium">Loading data...</div>
                <div className="text-xs text-muted-foreground max-w-xs text-center">
                  Processing {selectedChannels.length} channels (
                  {Math.floor(
                    timeWindowRef.current *
                      (fileManager.selectedFile?.sample_rate || 0)
                  ).toLocaleString()}{" "}
                  samples)
                </div>
                {/* Cancel button removed - TanStack Query handles request cancellation automatically */}
              </div>
            </div>
          )}
          <div ref={chartRef} className="w-full h-full" />
        </div>

        {/* Channel Selection */}
        {fileManager.selectedFile &&
          fileManager.selectedFile.channels.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <Label className="text-xs mb-2 block">
                Channels ({selectedChannels.length} selected):
              </Label>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {fileManager.selectedFile.channels.map((channel) => (
                  <div key={channel} className="flex items-center gap-2">
                    <Checkbox
                      id={`channel-${channel}`}
                      checked={selectedChannels.includes(channel)}
                      onCheckedChange={(checked) =>
                        handleChannelToggle(channel, checked as boolean)
                      }
                    />
                    <label
                      htmlFor={`channel-${channel}`}
                      className="text-xs cursor-pointer"
                    >
                      {channel}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

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
          />
        )}
      </CardContent>
    </Card>
  );
}
