"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
import * as echarts from 'echarts';
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
  const pendingRenderRef = useRef<{ chunkData: ChunkData; startTime: number } | null>(null);
  const currentLabelsRef = useRef<{ channels: string[]; autoOffset: number } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(plot.chunkStart || 0);
  const [duration, setDuration] = useState(0);
  const [loadChunkTimeout, setLoadChunkTimeout] =
    useState<NodeJS.Timeout | null>(null);
  const [loadOverviewTimeout, setLoadOverviewTimeout] =
    useState<NodeJS.Timeout | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  // Overview plot state
  const [overviewData, setOverviewData] = useState<ChunkData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // AbortController to cancel pending API requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Preprocessing controls
  const [showPreprocessing, setShowPreprocessing] = useState(false);
  const [preprocessing, setPreprocessing] = useState<PreprocessingOptions>(
    plot.preprocessing || getDefaultPreprocessing()
  );

  // Time window control (in seconds)
  const timeWindowRef = useRef(plot.chunkSize / (fileManager.selectedFile?.sample_rate || 256) || 10);

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

      console.log('[ECharts] Initializing chart with dimensions:', { clientWidth, clientHeight });

      // Get existing instance if any, or create new one
      let chart = echarts.getInstanceByDom(chartRef.current);

      if (!chart) {
        // Create chart instance with Canvas renderer for better performance
        chart = echarts.init(chartRef.current, null, {
          renderer: 'canvas', // Use canvas renderer (WebGL not directly available in ECharts 5, but very optimized)
          useDirtyRect: true, // Performance optimization
        });
      }

      chartInstanceRef.current = chart;

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

      console.log('[ECharts] Chart initialized successfully');

      // Add right-click handler for annotations
      chartRef.current.addEventListener('contextmenu', handleChartRightClick);

      // Render any pending data that arrived before chart was ready
      if (pendingRenderRef.current) {
        console.log('[ECharts] Rendering pending data after initialization');
        const { chunkData, startTime } = pendingRenderRef.current;
        pendingRenderRef.current = null;
        // Use setTimeout to ensure chart is fully ready
        setTimeout(() => renderChart(chunkData, startTime), 0);
      }
    };

    initChart();

    return () => {
      console.log('[ECharts] Cleaning up chart instance');
      // Remove right-click handler
      if (chartRef.current) {
        chartRef.current.removeEventListener('contextmenu', handleChartRightClick);
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  // Load chunk data function
  const loadChunkData = async (startTime: number) => {
    if (!fileManager.selectedFile || selectedChannels.length === 0) {
      console.log("Cannot load chunk: no file or channels selected");
      return;
    }

    if (fileManager.selectedFile.duration === 0) {
      setError("File has no duration - data may not be properly loaded");
      return;
    }

    try {
      // Cancel any pending request
      if (abortControllerRef.current) {
        console.log('[ABORT] Cancelling previous chunk request');
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      setLoading(true);
      setError(null);

      const timeWindow = timeWindowRef.current;
      const chunkSize = Math.floor(timeWindow * fileManager.selectedFile.sample_rate);
      const chunkStart = Math.floor(startTime * fileManager.selectedFile.sample_rate);

      console.log('[ECharts] Loading chunk:', {
        startTime,
        timeWindow,
        chunkSize,
        selectedChannels: selectedChannels.length,
      });

      // Load ONLY selected channels
      const chunkData = await apiService.getChunkData(
        fileManager.selectedFile.file_path,
        chunkStart,
        chunkSize,
        selectedChannels,
        signal
      );

      console.log('[ECharts] Received chunk data:', {
        dataLength: chunkData.data?.length,
        timestampsLength: chunkData.timestamps?.length,
        channels: chunkData.channels?.length,
      });

      if (!chunkData.data || chunkData.data.length === 0) {
        setError("No data received from server");
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
      renderChart(processedChunk, startTime);
      setCurrentTime(startTime);
      updatePlotState({ chunkStart: startTime });
      setLoading(false);
    } catch (err) {
      if (err instanceof Error && err.name === 'CanceledError') {
        console.log('[ABORT] Chunk request was cancelled');
        setLoading(false);
        return;
      }

      console.error("Failed to load chunk:", err);
      setError(err instanceof Error ? err.message : "Failed to load data");
      setLoading(false);
    }
  };

  const loadChunk = useCallback((startTime: number) => {
    loadChunkData(startTime);
  }, [fileManager.selectedFile, selectedChannels, preprocessing]);

  // Update channel labels based on current data
  const updateChannelLabels = useCallback(() => {
    if (!chartInstanceRef.current || !currentLabelsRef.current) return;

    const { channels, autoOffset } = currentLabelsRef.current;

    const channelLabels = channels.map((channelName, channelIndex) => {
      const yValue = channelIndex * autoOffset;
      const pixelY = chartInstanceRef.current!.convertToPixel({ yAxisIndex: 0 }, yValue);

      return {
        type: 'text',
        right: 'auto',
        left: 10,
        top: pixelY - 10,
        z: 100,
        style: {
          text: channelName,
          fontSize: 12,
          fontWeight: 'bold',
          fill: '#e5e5e5',
          backgroundColor: 'rgba(24, 24, 27, 0.9)',
          padding: [4, 8],
          borderRadius: 4,
          borderColor: 'rgba(63, 63, 70, 1)',
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
    console.log('[ECharts] renderChart called:', {
      hasChartInstance: !!chartInstanceRef.current,
      hasData: !!chunkData.data,
      dataLength: chunkData.data?.length || 0
    });

    if (!chartInstanceRef.current) {
      console.warn('[ECharts] Chart instance not ready, storing for later render');
      // Store the data to render once chart is initialized
      pendingRenderRef.current = { chunkData, startTime };
      return;
    }

    if (!chunkData.data || chunkData.data.length === 0) {
      console.warn('[ECharts] No data to render');
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
      const avgRange = channelRanges.reduce((a, b) => a + b, 0) / channelRanges.length;

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
      console.log('[ECharts] Calculated spacing:', {
        maxRange,
        avgRange,
        spacingMultiplier,
        finalOffset: autoOffset,
      });
    } else {
      autoOffset = stableOffsetRef.current;
    }

    console.log('[ECharts] Auto-calculated offset:', autoOffset);

    // Prepare series data
    const series = chunkData.channels.map((channelName, channelIndex) => {
      const channelData = chunkData.data[channelIndex];

      // Apply stacking offset
      const offsetData = channelData.map((value, idx) => {
        const time = startTime + (idx / chunkData.sample_rate);
        const offsetValue = value + channelIndex * autoOffset;
        return [time, offsetValue];
      });

      return {
        name: channelName,
        type: 'line' as const,
        data: offsetData,
        symbol: 'none', // No markers for performance
        sampling: 'lttb' as const, // Downsample for performance (Largest-Triangle-Three-Buckets)
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
        text: 'Time Series Plot',
        left: 'center',
        textStyle: {
          fontSize: 14,
          color: 'hsl(var(--foreground))',
        },
      },
      tooltip: {
        show: false, // Disable default tooltip - use right-click annotation menu instead
      },
      legend: {
        data: chunkData.channels,
        top: 30,
        textStyle: {
          color: 'hsl(var(--foreground))',
        },
      },
      grid: {
        left: '120px',
        right: '4%',
        bottom: '10%',
        top: '15%',
        containLabel: false,
      },
      toolbox: {
        feature: {
          dataZoom: {
            yAxisIndex: 'none',
          },
          restore: {},
          saveAsImage: {},
        },
      },
      xAxis: {
        type: 'value',
        name: 'Time (s)',
        nameLocation: 'middle',
        nameGap: 30,
        min: startTime,
        max: startTime + timeWindow,
        axisLabel: {
          color: 'hsl(var(--foreground))',
        },
      },
      yAxis: {
        type: 'value',
        name: '', // Remove amplitude label
        axisLabel: {
          show: false, // Hide numeric labels since we'll show channel names
        },
        axisTick: {
          show: false,
        },
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none', // Don't filter data when zooming
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          filterMode: 'none',
          textStyle: {
            color: 'hsl(var(--foreground))',
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

    console.log('[ECharts] Chart rendered with', series.length, 'series');

    // Broadcast to popout windows
    broadcastToType("timeseries", "data-update", { chunkData, startTime });
  };

  // Handle file/channel changes
  useEffect(() => {
    const currentFilePath = fileManager.selectedFile?.file_path;
    const hasChannelsSelected = selectedChannels.length > 0;
    const isNewFile = currentFilePath !== loadedFileRef.current;

    console.log('[ECharts] File/channel effect:', {
      hasFile: !!fileManager.selectedFile,
      channelsSelected: selectedChannels.length,
      isNewFile,
    });

    if (fileManager.selectedFile &&
        fileManager.selectedFile.channels?.length > 0 &&
        hasChannelsSelected &&
        (isNewFile || isInitialChannelSetRef.current)) {

      console.log('[ECharts] Triggering chunk load');

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
    } else if (!isNewFile && !isInitialChannelSetRef.current && hasChannelsSelected) {
      console.log('[ECharts] Same file, channels changed - reloading');

      // Debounce channel changes
      if (loadChunkTimeout) {
        clearTimeout(loadChunkTimeout);
      }
      const timeoutId = setTimeout(() => {
        loadChunk(currentTime);
      }, 300); // 300ms debounce
      setLoadChunkTimeout(timeoutId);
    }
  }, [fileManager.selectedFile?.file_path, selectedChannels, loadChunk]);

  // Sync selected channels with file
  useEffect(() => {
    if (fileManager.selectedFile && fileManager.selectedChannels.length > 0) {
      setSelectedChannels(fileManager.selectedChannels);
    } else if (fileManager.selectedFile && fileManager.selectedFile.channels.length > 0) {
      // Auto-select first 8 channels
      const initialChannels = fileManager.selectedFile.channels.slice(0, 8);
      setSelectedChannels(initialChannels);
      persistSelectedChannels(initialChannels);
    }
  }, [fileManager.selectedFile, fileManager.selectedChannels]);

  // Load overview data when file or selected channels change
  useEffect(() => {
    const loadOverview = async () => {
      if (!fileManager.selectedFile || selectedChannels.length === 0) {
        setOverviewData(null);
        return;
      }

      console.log('[OVERVIEW] Loading overview for file:', fileManager.selectedFile.file_name);
      setOverviewLoading(true);

      try {
        const data = await apiService.getOverviewData(
          fileManager.selectedFile.file_path,
          selectedChannels,
          2000 // max points for overview
        );

        console.log('[OVERVIEW] Overview loaded successfully:', {
          channels: data.channels.length,
          pointsPerChannel: data.data[0]?.length || 0,
        });

        setOverviewData(data);
      } catch (error) {
        console.error('[OVERVIEW] Failed to load overview:', error);
        // Don't show error to user - overview is optional feature
      } finally {
        setOverviewLoading(false);
      }
    };

    // Debounce overview loading to prevent rapid requests when selecting multiple channels
    if (loadOverviewTimeout) {
      clearTimeout(loadOverviewTimeout);
    }

    const timeoutId = setTimeout(() => {
      loadOverview();
    }, 300); // 300ms debounce for overview

    setLoadOverviewTimeout(timeoutId);

    // Cleanup timeout on unmount
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [fileManager.selectedFile?.file_path, selectedChannels, apiService]);

  // Right-click handler for annotations
  const handleChartRightClick = useCallback((e: MouseEvent) => {
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

    if (pointInGrid && typeof pointInGrid[0] === 'number') {
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
  }, [timeSeriesAnnotations]);

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
    timeWindowRef.current = value[0];
    loadChunk(currentTime);
  };

  const handleSeek = (time: number) => {
    console.log('[ECharts] Seek requested to:', time);
    setCurrentTime(time);
    loadChunk(time);
  };

  const handleChannelToggle = (channelName: string, checked: boolean) => {
    const newSelection = checked
      ? [...selectedChannels, channelName]
      : selectedChannels.filter((c) => c !== channelName);

    console.log('[ECharts] Channel toggled:', channelName, '->', checked);
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
              Time Series Visualization (ECharts)
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
              disabled={loading || currentTime >= duration - timeWindowRef.current}
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
            overviewData={overviewData}
            currentTime={currentTime}
            timeWindow={timeWindowRef.current}
            duration={duration}
            onSeek={handleSeek}
            loading={overviewLoading}
          />
        </div>

        {/* Chart Container */}
        <div className="flex-1 relative min-h-0">
          {loading && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
              <div className="text-sm">Loading...</div>
            </div>
          )}
          <div ref={chartRef} className="w-full h-full" />
        </div>

        {/* Channel Selection */}
        {fileManager.selectedFile && fileManager.selectedFile.channels.length > 0 && (
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
