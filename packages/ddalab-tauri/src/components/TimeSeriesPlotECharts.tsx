"use client";

import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { ChunkData } from "@/types/api";
import {
  useChunkData,
  useOverviewData,
  useOverviewProgress,
} from "@/hooks/useTimeSeriesData";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChannelSelector } from "@/components/ChannelSelector";
import {
  Activity,
  AlertCircle,
  ExternalLink,
  GripHorizontal,
  Loader2,
} from "lucide-react";
import * as echarts from "echarts";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { useTimeSeriesAnnotations } from "@/hooks/useAnnotations";
import { AnnotationContextMenu } from "@/components/annotations/AnnotationContextMenu";
import { PlotInfo } from "@/types/annotations";
import { PreprocessingOptions } from "@/types/persistence";
import {
  applyPreprocessing,
  getDefaultPreprocessing,
} from "@/utils/preprocessing";
import { OverviewPlot } from "@/components/OverviewPlot";
import { ChunkNavigator } from "@/components/visualization/ChunkNavigator";
import { QuickFilters } from "@/components/visualization/QuickFilters";
import { useWasm } from "@/hooks/useWasm";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";

// ECharts type extensions for internal API access
interface EChartsInstanceWithCustomProps extends echarts.ECharts {
  __lastClickedMarkLineValue?: number;
}

interface EChartsSeriesOption {
  markLine?: unknown;
  [key: string]: unknown;
}

interface EChartsOptionWithSeries {
  series?: EChartsSeriesOption[];
  [key: string]: unknown;
}

interface TimeSeriesPlotProps {
  apiService: ApiService;
}

// Internal component - wrapped with memo at export
function TimeSeriesPlotEChartsComponent({ apiService }: TimeSeriesPlotProps) {
  const { decimate: wasmDecimate } = useWasm();

  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const selectedChannelsFromStore = useAppStore(
    (state) => state.fileManager.selectedChannels,
  );
  const plotPreprocessing = useAppStore((state) => state.plot.preprocessing);
  const plotChunkStart = useAppStore((state) => state.plot.chunkStart);
  const plotChunkSize = useAppStore((state) => state.plot.chunkSize);
  const plotCurrentChunk = useAppStore((state) => state.plot.currentChunk);
  const chartHeight = useAppStore((state) => state.plot.chartHeight);
  const isPersistenceRestored = useAppStore(
    (state) => state.isPersistenceRestored,
  );

  // Actions
  const updatePlotState = useAppStore((state) => state.updatePlotState);
  const setCurrentChunk = useAppStore((state) => state.setCurrentChunk);
  const persistSelectedChannels = useAppStore(
    (state) => state.setSelectedChannels,
  );

  const { createWindow, broadcastToType } = usePopoutWindows();

  // Annotation support for time series
  const timeSeriesAnnotations = useTimeSeriesAnnotations({
    filePath: selectedFile?.file_path || "",
  });

  // Generate available plots for annotation visibility
  const availablePlots = useMemo<PlotInfo[]>(() => {
    const plots: PlotInfo[] = [
      { id: "timeseries", label: "Data Visualization" },
    ];

    // TODO: Add DDA results for this file if they exist
    // This would require access to the DDA results from the store

    return plots;
  }, []);

  // Subscribe to annotation changes directly from store for instant re-renders
  const filePath = selectedFile?.file_path;

  // Get file annotations object from store (stable reference)
  const fileAnnotations = useAppStore((state) =>
    filePath ? state.annotations.timeSeries[filePath] : undefined,
  );

  // Memoize the annotations array to prevent infinite loops
  const annotationsFromStore = useMemo(() => {
    return fileAnnotations?.globalAnnotations || [];
  }, [fileAnnotations]);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const loadedFileRef = useRef<string | null>(null);
  const isInitialChannelSetRef = useRef<boolean>(true);
  const stableOffsetRef = useRef<number | null>(null);
  // Store the base offset and reference height for scaling
  const baseOffsetRef = useRef<{
    offset: number;
    height: number;
    avgRange: number;
  } | null>(null);
  const pendingRenderRef = useRef<{
    chunkData: ChunkData;
    startTime: number;
  } | null>(null);
  const currentLabelsRef = useRef<{
    channels: string[];
    autoOffset: number;
  } | null>(null);

  // IMPORTANT: Convert chunkStart from samples to seconds for UI state
  // Store saves in samples, but UI works in seconds
  const [currentTime, setCurrentTime] = useState(
    (plotChunkStart || 0) / (selectedFile?.sample_rate || 256),
  );

  // Derive duration directly from selectedFile to prevent stale values
  // when switching files (was causing overview x-axis to show old file's duration)
  const duration = selectedFile?.duration || 0;

  // Use store as single source of truth for selected channels
  // This avoids race conditions between local state and store state
  const selectedChannels = selectedChannelsFromStore;

  // Time window control (in seconds) - start with smaller window for better performance
  // IMPORTANT: Convert chunkSize from samples to seconds
  const [timeWindow, setTimeWindow] = useState(
    plotChunkSize / (selectedFile?.sample_rate || 256) || 5,
  );

  // Preprocessing controls (must be declared before TanStack Query hooks)
  const [preprocessing, setPreprocessing] = useState<PreprocessingOptions>(
    plotPreprocessing || getDefaultPreprocessing(),
  );

  // Refs for vertical resize handling (chartHeight comes from store)
  const isResizingRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(0);

  const chunkSize = useMemo(() => {
    if (!selectedFile) return 0;
    return Math.floor(timeWindow * selectedFile.sample_rate);
  }, [timeWindow, selectedFile?.sample_rate]);

  const chunkStart = useMemo(() => {
    if (!selectedFile) return 0;
    return Math.floor(currentTime * selectedFile.sample_rate);
  }, [currentTime, selectedFile?.sample_rate]);

  // Calculate adaptive overview decimation based on file size
  // Goal: Show enough detail for variation without overloading for large files
  const overviewMaxPoints = useMemo(() => {
    if (!selectedFile) return 500;

    const duration = selectedFile.duration;
    const sampleRate = selectedFile.sample_rate || 500;
    const totalSamples =
      selectedFile.total_samples || Math.floor(duration * sampleRate);

    let maxPoints: number;

    if (duration < 60) {
      // Small files: more points for detail
      maxPoints = Math.min(totalSamples, 1000);
    } else if (duration < 600) {
      // Medium files: scale proportionally (~150 points/minute)
      maxPoints = Math.min(Math.floor((duration / 60) * 150), 2000);
    } else {
      // Large files: logarithmic scale, capped at 5000
      const minutes = duration / 60;
      const calculatedPoints = 1500 + Math.floor(500 * Math.log10(minutes));
      maxPoints = Math.min(Math.max(calculatedPoints, 1500), 5000);
    }

    return maxPoints;
  }, [
    selectedFile?.total_samples,
    selectedFile?.duration,
    selectedFile?.sample_rate,
  ]);

  // Only enable queries when chart is ready to avoid premature data fetching
  const [isChartReady, setIsChartReady] = useState(false);

  const {
    data: chunkData,
    isLoading: chunkLoading,
    error: chunkError,
  } = useChunkData(
    apiService,
    selectedFile?.file_path || "",
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
    !!(selectedFile && selectedChannels.length > 0 && isChartReady),
  );

  const {
    data: overviewData,
    isLoading: overviewLoading,
    refetch: refetchOverview,
  } = useOverviewData(
    apiService,
    selectedFile?.file_path || "",
    selectedChannels,
    overviewMaxPoints,
    !!(selectedFile && selectedChannels.length > 0), // Load in background regardless of active tab
  );

  // Poll for overview progress while loading
  const { data: overviewProgress } = useOverviewProgress(
    apiService,
    selectedFile?.file_path || "",
    selectedChannels,
    overviewMaxPoints,
    overviewLoading && !!selectedFile && selectedChannels.length > 0,
  );

  // Track previous completion state to detect transitions
  const prevOverviewCompleteRef = useRef<boolean | undefined>(undefined);

  // Refetch overview data when generation completes
  // This handles the race condition where initial fetch might return partial/stale data
  useEffect(() => {
    const isComplete = overviewProgress?.is_complete;
    const wasComplete = prevOverviewCompleteRef.current;

    if (isComplete && wasComplete === false) {
      refetchOverview();
    }

    prevOverviewCompleteRef.current = isComplete;
  }, [overviewProgress?.is_complete, refetchOverview]);

  // Derived loading/error states for UI
  const loading = chunkLoading;
  const error = chunkError ? (chunkError as Error).message : null;

  // Sync preprocessing with plot state
  useEffect(() => {
    if (plotPreprocessing) {
      // IMMER FIX: Use structuredClone instead of JSON.parse/stringify
      // structuredClone is faster and handles more data types
      setPreprocessing(structuredClone(plotPreprocessing));
    }
  }, [plotPreprocessing]);

  // Save preprocessing when it changes
  const handlePreprocessingChange = (
    newPreprocessing: PreprocessingOptions,
  ) => {
    setPreprocessing(newPreprocessing);
    updatePlotState({ preprocessing: newPreprocessing });
    // Query will automatically refetch with new preprocessing due to query key change
  };

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

      chartRef.current.addEventListener("contextmenu", handleChartRightClick);

      chart.on("click", (params: echarts.ECElementEvent) => {
        if (params.componentType === "markLine") {
          (chart as EChartsInstanceWithCustomProps).__lastClickedMarkLineValue =
            params.value as number;
        }
      });

      chart.on("datazoom", (event: any) => {
        const startPercent = event.start;
        const currentFile = useAppStore.getState().fileManager.selectedFile;

        if (startPercent !== undefined && currentFile) {
          const newStartTime = (startPercent / 100) * currentFile.duration;
          const chunkStartSamples = Math.floor(
            newStartTime * currentFile.sample_rate,
          );
          setCurrentTime(newStartTime);
          updatePlotState({ chunkStart: chunkStartSamples });
        }
      });

      if (pendingRenderRef.current) {
        const { chunkData, startTime } = pendingRenderRef.current;
        pendingRenderRef.current = null;
        setTimeout(() => renderChart(chunkData, startTime), 0);
      }
    };

    initChart();

    return () => {
      if (chartRef.current) {
        chartRef.current.removeEventListener(
          "contextmenu",
          handleChartRightClick,
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

  // Memoize preprocessing to avoid redundant computation on re-renders
  const preprocessedChunkData = useMemo(() => {
    if (
      !chunkData ||
      !selectedFile ||
      !chunkData.data ||
      chunkData.data.length === 0
    ) {
      return null;
    }

    const preprocessedData = chunkData.data.map((channelData: number[]) =>
      applyPreprocessing(channelData, selectedFile!.sample_rate, preprocessing),
    );

    return {
      ...chunkData,
      data: preprocessedData,
    };
  }, [chunkData, selectedFile, preprocessing]);

  useEffect(() => {
    if (!preprocessedChunkData) return;
    setCurrentChunk(preprocessedChunkData);
    renderChart(preprocessedChunkData, currentTime);
  }, [preprocessedChunkData, currentTime, timeWindow]);

  const annotationMarkLine = useMemo(() => {
    if (annotationsFromStore.length === 0) return undefined;

    return {
      symbol: ["none", "none"],
      silent: false,
      animation: false,
      label: {
        show: true,
        position: "insideEndTop" as const,
        formatter: (params: any) => {
          const annotation = annotationsFromStore.find(
            (ann) => Math.abs(ann.position - params.value) < 0.01,
          );
          return annotation?.label || "";
        },
        fontSize: 12,
        fontWeight: "bold" as const,
        color: "#fff",
        backgroundColor: "#ef4444",
        padding: [6, 10],
        borderRadius: 4,
        borderWidth: 1,
        borderColor: "#dc2626",
      },
      lineStyle: {
        color: "#ef4444",
        width: 2,
        type: "dashed" as const,
        opacity: 0.7,
      },
      emphasis: {
        lineStyle: {
          width: 4,
          opacity: 1,
        },
        label: {
          show: true,
          backgroundColor: "#dc2626",
        },
      },
      data: annotationsFromStore.map((annotation) => ({
        xAxis: annotation.position,
        label: {
          formatter: annotation.label,
        },
      })),
    };
  }, [annotationsFromStore]);

  useEffect(() => {
    if (!chartInstanceRef.current || !isChartReady) return;

    const currentOption =
      chartInstanceRef.current.getOption() as EChartsOptionWithSeries;
    if (
      !currentOption ||
      !currentOption.series ||
      currentOption.series.length === 0
    ) {
      return;
    }

    chartInstanceRef.current.setOption(
      {
        series: [
          {
            markLine: annotationMarkLine,
          },
        ],
      },
      {
        notMerge: false, // Merge with existing options (efficient update)
        lazyUpdate: true, // Batch updates
      },
    );
  }, [annotationMarkLine, isChartReady]);

  const loadChunk = useCallback(
    (startTime: number) => {
      if (
        !selectedFile ||
        selectedChannels.length === 0 ||
        selectedFile.duration === 0
      ) {
        return;
      }

      const chunkStartSamples = Math.floor(
        startTime * selectedFile.sample_rate,
      );
      setCurrentTime(startTime);
      updatePlotState({ chunkStart: chunkStartSamples });
    },
    [selectedFile, selectedChannels, updatePlotState],
  );

  // Update channel labels based on current data
  const updateChannelLabels = useCallback(() => {
    if (!chartInstanceRef.current || !currentLabelsRef.current) return;

    const { channels, autoOffset } = currentLabelsRef.current;

    const channelLabels = channels.map((channelName, channelIndex) => {
      const yValue = channelIndex * autoOffset;
      const pixelY = chartInstanceRef.current!.convertToPixel(
        { yAxisIndex: 0 },
        yValue,
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

  const renderChart = (chunkData: ChunkData, startTime: number) => {
    if (!chartInstanceRef.current) {
      pendingRenderRef.current = { chunkData, startTime };
      return;
    }

    if (!chunkData.data || chunkData.data.length === 0) {
      return;
    }

    const chart = chartInstanceRef.current;

    // Calculate channel offset for stacking with improved spacing algorithm
    const userOffset = channelOffsetSliderRef.current;

    // Reference height for scaling (default chart height)
    const referenceHeight = 400;
    const currentHeight = chartHeight || referenceHeight;
    // Scale factor based on chart height for offset spacing
    const heightScaleFactor = currentHeight / referenceHeight;

    // Auto-calculate stable offset based on data range with proper spacing
    let autoOffset = 0;
    let amplitudeScaleFactor = 1.0;

    // Calculate base offset and amplitude scale if not yet computed
    if (baseOffsetRef.current === null) {
      const channelRanges = chunkData.data.map((channelData) => {
        // Sample across the entire chunk for better representation
        const sampleSize = Math.min(1000, channelData.length);
        const step = Math.max(1, Math.floor(channelData.length / sampleSize));
        let min = Infinity;
        let max = -Infinity;

        // Optimized loop - avoid array allocation
        for (let i = 0; i < channelData.length; i += step) {
          const val = channelData[i];
          if (val < min) min = val;
          if (val > max) max = val;
        }

        return max - min;
      });

      const maxRange = Math.max(...channelRanges);
      const avgRange =
        channelRanges.reduce((a, b) => a + b, 0) / channelRanges.length;

      // Use a spacing multiplier that ensures clear separation
      // Base spacing is 2.5x the average range, plus user adjustment
      // Minimum spacing is 1.8x max range to prevent any overlap
      const baseMultiplier = 2.5;
      const userMultiplier = userOffset / 50; // Convert percentage to multiplier (50% = 1x additional)
      const spacingMultiplier = baseMultiplier + userMultiplier;

      const baseOffset = Math.max(
        avgRange * spacingMultiplier,
        maxRange * 1.8, // Ensure minimum separation
      );

      // Store the base offset, reference height, and average range for amplitude scaling
      baseOffsetRef.current = {
        offset: baseOffset,
        height: currentHeight,
        avgRange: avgRange || 1, // Store avgRange for optimal amplitude calculation
      };
      stableOffsetRef.current = baseOffset * heightScaleFactor;
    }

    // Scale the base offset based on current chart height
    if (baseOffsetRef.current) {
      autoOffset = baseOffsetRef.current.offset * heightScaleFactor;
      stableOffsetRef.current = autoOffset;

      // Calculate optimal amplitude scale factor to fill available space
      // Target: signals should fill ~75% of the space between channels
      const targetFillRatio = 0.75;
      const avgRange = baseOffsetRef.current.avgRange || 1;
      // The amplitude scale makes signals fill targetFillRatio of the offset space
      amplitudeScaleFactor = (targetFillRatio * autoOffset) / avgRange;
    } else {
      autoOffset = stableOffsetRef.current || 0;
    }

    // Prepare series data with aggressive decimation for better performance
    const series = chunkData.channels.map((channelName, channelIndex) => {
      const channelData = chunkData.data[channelIndex];

      // Decimate data intelligently based on visible pixels
      // For a typical 2000px wide chart, we don't need more than 4000 points
      const maxPoints = 4000;
      let decimatedData;

      if (channelData.length > maxPoints) {
        // Use WASM-based LTTB decimation for better visual preservation
        // LTTB (Largest Triangle Three Buckets) maintains the visual shape
        // much better than simple step-based decimation
        const decimatedValues = wasmDecimate(channelData, maxPoints, "lttb");

        // Calculate time step for decimated data
        // The decimated data preserves important points, but we need to map them to time
        const originalStep = 1 / chunkData.sample_rate;
        const decimationRatio = channelData.length / decimatedValues.length;

        decimatedData = decimatedValues.map((value, idx) => {
          // Approximate the time position based on the decimation ratio
          const originalIdx = Math.round(idx * decimationRatio);
          const time = startTime + originalIdx * originalStep;
          // Scale amplitude to optimally fill available space between channels
          const scaledValue = value * amplitudeScaleFactor;
          const offsetValue = scaledValue + channelIndex * autoOffset;
          return [time, offsetValue];
        });
      } else {
        // Apply stacking offset without decimation
        decimatedData = channelData.map((value, idx) => {
          const time = startTime + idx / chunkData.sample_rate;
          // Scale amplitude to optimally fill available space between channels
          const scaledValue = value * amplitudeScaleFactor;
          const offsetValue = scaledValue + channelIndex * autoOffset;
          return [time, offsetValue];
        });
      }

      let markLine = undefined;
      if (channelIndex === 0 && annotationsFromStore.length > 0) {
        markLine = {
          symbol: ["none", "none"], // No arrow symbols
          silent: false, // Enable interaction - IMPORTANT for clicking
          animation: false,
          label: {
            show: true,
            position: "insideEndTop" as const, // Position label at top
            formatter: (params: any) => {
              const annotation = timeSeriesAnnotations.annotations.find(
                (ann) => Math.abs(ann.position - params.value) < 0.01,
              );
              return annotation?.label || "";
            },
            fontSize: 12,
            fontWeight: "bold" as const,
            color: "#fff",
            backgroundColor: "#ef4444",
            padding: [6, 10],
            borderRadius: 4,
            borderWidth: 1,
            borderColor: "#dc2626",
          },
          lineStyle: {
            color: "#ef4444",
            width: 2,
            type: "dashed" as const,
            opacity: 0.7,
          },
          emphasis: {
            // Highlight on hover
            lineStyle: {
              width: 4,
              opacity: 1,
            },
            label: {
              show: true,
              backgroundColor: "#dc2626",
            },
          },
          data: annotationsFromStore.map((annotation) => ({
            xAxis: annotation.position,
            label: {
              formatter: annotation.label,
            },
          })),
        };
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
        markLine,
      };
    });

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

    setTimeout(updateChannelLabels, 0);

    if (selectedFile) {
      broadcastToType("timeseries", "data-update", {
        ...chunkData,
        startTime,
        selectedChannels,
        sampleRate: chunkData.sample_rate,
        timeWindow: duration,
        filePath: selectedFile.file_path,
        fileName: selectedFile.file_name,
        duration: selectedFile.duration,
      });
    }
  };

  useEffect(() => {
    const currentFilePath = selectedFile?.file_path;
    const hasChannelsSelected = selectedChannels.length > 0;
    const isNewFile = currentFilePath !== loadedFileRef.current;

    if (!isPersistenceRestored) return;

    if (
      selectedFile &&
      selectedFile.channels?.length > 0 &&
      hasChannelsSelected &&
      (isNewFile || isInitialChannelSetRef.current)
    ) {
      if (isNewFile) {
        stableOffsetRef.current = null;
        baseOffsetRef.current = null;
        currentLabelsRef.current = null;

        if (chartInstanceRef.current) {
          chartInstanceRef.current.setOption(
            { graphic: [], series: [] },
            { replaceMerge: ["graphic", "series"] },
          );
        }
      }

      // Use persisted position if available, otherwise start at 0
      const latestPlotState = useAppStore.getState().plot;
      const startTimeSamples = latestPlotState.chunkStart || 0;
      const startTime = startTimeSamples / selectedFile.sample_rate;
      loadChunk(startTime);
      setCurrentTime(startTime);

      loadedFileRef.current = currentFilePath!;
      isInitialChannelSetRef.current = false;
    } else if (isNewFile && !hasChannelsSelected && selectedFile) {
      loadedFileRef.current = currentFilePath!;
    }
  }, [
    selectedFile?.file_path,
    selectedChannels,
    loadChunk,
    isPersistenceRestored,
  ]);

  const hasRespondedToPersistedChunkRef = useRef(false);
  useEffect(() => {
    if (
      selectedFile &&
      isPersistenceRestored &&
      !hasRespondedToPersistedChunkRef.current &&
      plotChunkStart > 0
    ) {
      const startTime = plotChunkStart / selectedFile.sample_rate;
      loadChunk(startTime);
      setCurrentTime(startTime);
      hasRespondedToPersistedChunkRef.current = true;
    }
  }, [plotChunkStart, selectedFile, isPersistenceRestored, loadChunk]);

  useEffect(() => {
    hasRespondedToPersistedChunkRef.current = false;
  }, [selectedFile?.file_path]);

  // Re-render chart when height changes to scale amplitudes appropriately
  const prevChartHeightRef = useRef(chartHeight);
  useEffect(() => {
    if (
      prevChartHeightRef.current !== chartHeight &&
      pendingRenderRef.current
    ) {
      // Height changed, re-render with the pending data to update amplitude scaling
      const { chunkData, startTime } = pendingRenderRef.current;
      renderChart(chunkData, startTime);
    }
    prevChartHeightRef.current = chartHeight;
  }, [chartHeight]);

  const lastAutoSelectedFileRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedFile || selectedFile.channels.length === 0) return;

    const currentFilePath = selectedFile.file_path;

    if (
      currentFilePath !== lastAutoSelectedFileRef.current &&
      selectedChannelsFromStore.length === 0
    ) {
      const initialChannels = selectedFile.channels.slice(0, 8);
      persistSelectedChannels(initialChannels);
      lastAutoSelectedFileRef.current = currentFilePath;
    } else if (currentFilePath !== lastAutoSelectedFileRef.current) {
      lastAutoSelectedFileRef.current = currentFilePath;
    }
  }, [
    selectedFile?.file_path,
    selectedFile?.channels,
    selectedChannelsFromStore.length,
    persistSelectedChannels,
  ]);

  const handleChartRightClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();

      if (!chartInstanceRef.current) return;

      const chartOption = chartInstanceRef.current.getOption();
      if (
        !chartOption ||
        !chartOption.series ||
        (chartOption.series as unknown[]).length === 0
      ) {
        return;
      }

      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;

      let pointInGrid: number[] | undefined;
      try {
        pointInGrid = chartInstanceRef.current.convertFromPixel(
          { seriesIndex: 0 },
          [x, 0],
        );
      } catch {
        return;
      }

      if (pointInGrid && typeof pointInGrid[0] === "number") {
        const timePosition = pointInGrid[0];

        const currentFilePath =
          useAppStore.getState().fileManager.selectedFile?.file_path;
        const allAnnotations = useAppStore.getState().annotations.timeSeries;
        const fileAnnotations = currentFilePath
          ? allAnnotations[currentFilePath]
          : null;
        const currentAnnotations = fileAnnotations?.globalAnnotations || [];

        const clickedAnnotation = currentAnnotations.find(
          (ann) => Math.abs(ann.position - timePosition) < 1.0,
        );

        timeSeriesAnnotations.openContextMenu(
          e.clientX,
          e.clientY,
          timePosition,
          clickedAnnotation,
        );
      }
    },
    [timeSeriesAnnotations],
  );

  // Navigation handlers
  const handlePrevChunk = () => {
    const newTime = Math.max(0, currentTime - timeWindow);
    setCurrentTime(newTime);
    loadChunk(newTime);
  };

  const handleNextChunk = () => {
    const maxTime = duration - timeWindow;
    const newTime = Math.min(maxTime, currentTime + timeWindow);
    setCurrentTime(newTime);
    loadChunk(newTime);
  };

  const handleTimeWindowChange = (value: number[]) => {
    const newWindow = value[0];
    const sampleRate = selectedFile?.sample_rate || 256;
    const chunkSizeSamples = Math.floor(newWindow * sampleRate);
    setTimeWindow(newWindow);
    updatePlotState({ chunkSize: chunkSizeSamples });
    // loadChunk will be called automatically when chunkSize updates from timeWindow state change
  };

  const handleSeek = useCallback(
    (time: number) => {
      setCurrentTime(time);
      loadChunk(time);
    },
    [loadChunk],
  );

  const handleTimeWindowChangeSingle = useCallback(
    (window: number) => {
      handleTimeWindowChange([window]);
    },
    [handleTimeWindowChange],
  );

  // Vertical resize handlers for chart height
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      resizeStartYRef.current = e.clientY;
      resizeStartHeightRef.current = chartHeight;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [chartHeight],
  );

  useEffect(() => {
    const handleResizeMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientY - resizeStartYRef.current;
      // Min 150px, no upper limit - let users resize as large as they want
      const newHeight = Math.max(150, resizeStartHeightRef.current + delta);
      updatePlotState({ chartHeight: newHeight });
    };

    const handleResizeEnd = async () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Trigger a full state save to persist the new chart height
        const { saveCurrentState, isPersistenceRestored } =
          useAppStore.getState();
        if (isPersistenceRestored) {
          await saveCurrentState();
        }
      }
    };

    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", handleResizeEnd);
    return () => {
      document.removeEventListener("mousemove", handleResizeMove);
      document.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [updatePlotState]);

  const handleChannelToggle = (channelName: string, checked: boolean) => {
    const newSelection = checked
      ? [...selectedChannels, channelName]
      : selectedChannels.filter((c) => c !== channelName);
    persistSelectedChannels(newSelection);
  };

  const handlePopout = () => {
    if (plotCurrentChunk && selectedFile) {
      // Flatten data structure and include file info for popout
      createWindow("timeseries", `timeseries-${Date.now()}`, {
        ...plotCurrentChunk,
        startTime: currentTime,
        selectedChannels,
        sampleRate: plotCurrentChunk.sample_rate,
        timeWindow: duration,
        // Add file information for store sync
        filePath: selectedFile.file_path,
        fileName: selectedFile.file_name,
        duration: selectedFile.duration,
      });
    }
  };

  return (
    <Card className="flex flex-col">
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
              {selectedFile
                ? `${selectedFile.file_name} - ${selectedChannels.length} channels selected`
                : "No file selected"}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePopout}
              disabled={!plotCurrentChunk}
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

        {/* Chunk Navigator - Position & Window Size Controls */}
        <div className="mb-4">
          <ChunkNavigator
            currentTime={currentTime}
            timeWindow={timeWindow}
            duration={duration}
            loading={loading}
            onSeek={handleSeek}
            onTimeWindowChange={handleTimeWindowChangeSingle}
            onPrev={handlePrevChunk}
            onNext={handleNextChunk}
          />
        </div>

        {/* Overview/Minimap - Global navigation for entire file */}
        <div className="mb-3">
          <OverviewPlot
            overviewData={overviewData || null}
            currentTime={currentTime}
            timeWindow={timeWindow}
            duration={duration}
            onSeek={handleSeek}
            loading={overviewLoading}
            progress={overviewProgress}
            annotations={annotationsFromStore}
          />
        </div>

        {/* Quick Filters - Compact visualization filters */}
        <div className="mb-3 py-2 px-3 border rounded-lg bg-muted/20">
          <QuickFilters
            preprocessing={preprocessing}
            onPreprocessingChange={handlePreprocessingChange}
            sampleRate={selectedFile?.sample_rate}
          />
        </div>

        {/* Chart Container - Vertically Resizable */}
        <div className="relative" style={{ height: chartHeight }}>
          {loading && (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-10 animate-in fade-in-0 duration-200">
              <div className="flex flex-col items-center gap-3 bg-background border rounded-lg p-6 shadow-lg animate-in zoom-in-95 duration-200">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div className="text-sm font-medium">Loading data...</div>
                <div className="text-xs text-muted-foreground max-w-xs text-center">
                  Processing {selectedChannels.length} channels (
                  {Math.floor(
                    timeWindow * (selectedFile?.sample_rate || 0),
                  ).toLocaleString()}{" "}
                  samples)
                </div>
              </div>
            </div>
          )}
          <div ref={chartRef} className="w-full h-full" />
        </div>
        {/* Resize handle - positioned below chart with spacing */}
        <div
          className="h-6 cursor-ns-resize flex items-center justify-center hover:bg-muted/30 transition-colors group rounded-b-md border-t border-border/50"
          onMouseDown={handleResizeStart}
        >
          <GripHorizontal className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </div>

        {/* Channel Selection */}
        {selectedFile && selectedFile.channels.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <ChannelSelector
              channels={selectedFile.channels}
              selectedChannels={selectedChannels}
              onSelectionChange={(channels) => {
                if (!selectedFile) return;
                // Create a copy before sorting since channels may be readonly
                const sortedChannels = [...channels].sort((a, b) => {
                  const indexA = selectedFile.channels.indexOf(a);
                  const indexB = selectedFile.channels.indexOf(b);
                  return indexA - indexB;
                });
                persistSelectedChannels(sortedChannels);
              }}
              label="Channels"
              description="Select channels to display in the plot"
              variant="compact"
              maxHeight="max-h-40"
            />
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
            availablePlots={availablePlots}
            currentPlotId="timeseries"
          />
        )}
      </CardContent>
    </Card>
  );
}

// Memoized component to prevent unnecessary re-renders
const TimeSeriesPlotEChartsMemo = memo(TimeSeriesPlotEChartsComponent);

// Export wrapped with error boundary for graceful error handling
export function TimeSeriesPlotECharts(props: TimeSeriesPlotProps) {
  return (
    <ChartErrorBoundary chartName="Time Series Plot" minHeight={400}>
      <TimeSeriesPlotEChartsMemo {...props} />
    </ChartErrorBoundary>
  );
}
