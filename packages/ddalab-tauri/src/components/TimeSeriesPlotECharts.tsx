"use client";

import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { ChunkData } from "@/types/api";
import {
  useChunkData,
  useOverviewData,
  useOverviewProgress,
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChannelSelector } from "@/components/ChannelSelector";
import { Activity, AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import * as echarts from "echarts";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { useTimeSeriesAnnotations } from "@/hooks/useAnnotations";
import { AnnotationContextMenu } from "@/components/annotations/AnnotationContextMenu";
import { PlotInfo, PlotAnnotation } from "@/types/annotations";
import { PreprocessingOptions } from "@/types/persistence";
import {
  applyPreprocessing,
  getDefaultPreprocessing,
} from "@/utils/preprocessing";
import { OverviewPlot } from "@/components/OverviewPlot";
import { ChunkNavigator } from "@/components/visualization/ChunkNavigator";
import { QuickFilters } from "@/components/visualization/QuickFilters";

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
  // OPTIMIZED: Select specific properties instead of entire objects to prevent re-renders
  // and avoid issues with Immer freezing
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const selectedChannelsFromStore = useAppStore(
    (state) => state.fileManager.selectedChannels,
  );
  const plotState = useAppStore((state) => state.plot);
  const isPersistenceRestored = useAppStore(
    (state) => state.isPersistenceRestored,
  );

  // Actions
  const updatePlotState = useAppStore((state) => state.updatePlotState);
  const setCurrentChunk = useAppStore((state) => state.setCurrentChunk);
  const persistSelectedChannels = useAppStore(
    (state) => state.setSelectedChannels,
  );

  const { createWindow, updateWindowData, broadcastToType } =
    usePopoutWindows();

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

  // Debug log when annotations change
  useEffect(() => {
    console.log(
      "[ANNOTATIONS] Annotations updated for file:",
      filePath,
      "count:",
      annotationsFromStore.length,
    );
  }, [annotationsFromStore, filePath]);

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

  // IMPORTANT: Convert chunkStart from samples to seconds for UI state
  // Store saves in samples, but UI works in seconds
  const [currentTime, setCurrentTime] = useState(
    (plotState.chunkStart || 0) / (selectedFile?.sample_rate || 256),
  );
  const [duration, setDuration] = useState(0);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  // Time window control (in seconds) - start with smaller window for better performance
  // IMPORTANT: Convert chunkSize from samples to seconds
  const [timeWindow, setTimeWindow] = useState(
    plotState.chunkSize / (selectedFile?.sample_rate || 256) || 5,
  );

  // Preprocessing controls (must be declared before TanStack Query hooks)
  const [preprocessing, setPreprocessing] = useState<PreprocessingOptions>(
    plotState.preprocessing || getDefaultPreprocessing(),
  );

  // Cache invalidation utilities
  const { invalidateFile } = useInvalidateTimeSeriesCache();

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
    let strategy: string;

    // For small files (< 1 minute), use more points to show detail
    if (duration < 60) {
      maxPoints = Math.min(totalSamples, 1000);
      strategy = "small file";
    }
    // For medium files (1-10 minutes), scale proportionally
    // Aim for ~100-200 points per minute for good variation visibility
    else if (duration < 600) {
      const pointsPerMinute = 150;
      const minutes = duration / 60;
      maxPoints = Math.min(Math.floor(pointsPerMinute * minutes), 2000);
      strategy = "medium file (proportional)";
    }
    // For large files (10+ minutes), use a logarithmic scale
    // This ensures we get enough variation without requesting too many points
    // Formula: base_points + log_factor * log(duration_in_minutes)
    else {
      const minutes = duration / 60;
      const basePoints = 1500;
      const logFactor = 500;
      const calculatedPoints =
        basePoints + Math.floor(logFactor * Math.log10(minutes));
      // Cap between 1500 and 5000 points for very large files
      maxPoints = Math.min(Math.max(calculatedPoints, 1500), 5000);
      strategy = "large file (logarithmic)";
    }

    const decimationRatio = totalSamples / maxPoints;
    console.log(
      `[OVERVIEW] Adaptive decimation - Strategy: ${strategy}, Duration: ${duration.toFixed(
        1,
      )}s, ` +
        `Total samples: ${totalSamples.toLocaleString()}, Overview points: ${maxPoints.toLocaleString()}, ` +
        `Decimation ratio: ${decimationRatio.toFixed(1)}x`,
    );

    return maxPoints;
  }, [
    selectedFile?.total_samples,
    selectedFile?.duration,
    selectedFile?.sample_rate,
  ]);

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

  // TanStack Query: Load overview data in background as soon as file is selected
  // Use adaptive decimation based on file size for optimal overview visualization
  // IMPORTANT: Removed isChartReady dependency - overview loads in background
  // even when user is on other tabs, so it's cached when they switch to visualization
  const {
    data: overviewData,
    isLoading: overviewLoading,
    error: overviewError,
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

    // Detect transition from incomplete to complete
    if (isComplete && wasComplete === false) {
      console.log(
        "[TimeSeriesPlot] Overview generation completed, refetching data...",
      );
      refetchOverview();
    }

    prevOverviewCompleteRef.current = isComplete;
  }, [overviewProgress?.is_complete, refetchOverview]);

  // Derived loading/error states for UI
  const loading = chunkLoading;
  const error = chunkError ? (chunkError as Error).message : null;

  // Sync preprocessing with plot state
  useEffect(() => {
    if (plotState.preprocessing) {
      // IMMER FIX: Deep clone the preprocessing options from the store
      // because Immer freezes store state and we need a mutable copy
      setPreprocessing(JSON.parse(JSON.stringify(plotState.preprocessing)));
    }
  }, [plotState.preprocessing]);

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

      // Listen for clicks on markLine elements directly
      chart.on("click", (params: echarts.ECElementEvent) => {
        if (params.componentType === "markLine") {
          console.log("[ECharts] Clicked on markLine element:", params);
          // Store which annotation was clicked for the contextmenu handler
          (chart as EChartsInstanceWithCustomProps).__lastClickedMarkLineValue =
            params.value as number;
        }
      });

      // Listen for contextmenu on markLine elements
      chart.getZr().on("contextmenu", (params: any) => {
        const event = params.event;
        const target = params.target;

        console.log("[ECharts] ZRender contextmenu event:", { target, event });

        // Check if the click target is a markLine element
        if (
          target &&
          target.parent &&
          target.parent.__ecComponentInfo?.mainType === "series"
        ) {
          // Get the series index and check if it has markLine
          const seriesIndex = target.parent.__ecComponentInfo.index;
          const option = chart.getOption() as EChartsOptionWithSeries;
          const series = option.series;

          if (series?.[seriesIndex]?.markLine) {
            console.log(
              "[ECharts] Right-clicked on annotation markLine, series:",
              seriesIndex,
            );

            // Try to find which specific markLine was clicked
            // The target might have data about the markLine position
            if (target.position) {
              console.log(
                "[ECharts] MarkLine target position:",
                target.position,
              );
            }
          }
        }
      });

      // Listen to dataZoom events (minimap) to persist position when user navigates
      chart.on("datazoom", (event: any) => {
        // Get the current start value from the dataZoom event
        const startPercent = event.start; // 0-100 percentage
        const endPercent = event.end; // 0-100 percentage

        // Always get the latest state from the store
        const currentFile = useAppStore.getState().fileManager.selectedFile;

        if (startPercent !== undefined && currentFile) {
          const duration = currentFile.duration;
          const newStartTime = (startPercent / 100) * duration;

          // IMPORTANT: Convert time in seconds to samples for persistence
          // Store expects chunkStart in samples, not seconds
          const chunkStartSamples = Math.floor(
            newStartTime * currentFile.sample_rate,
          );

          console.log(
            "[ECharts] DataZoom event - updating position to:",
            newStartTime,
            "seconds (",
            chunkStartSamples,
            "samples)",
          );

          // Update state and trigger persistence
          setCurrentTime(newStartTime);
          updatePlotState({ chunkStart: chunkStartSamples });
        }
      });

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

    const startTime = performance.now();
    console.log(
      "[PERF] Starting preprocessing for",
      chunkData.data.length,
      "channels",
    );

    // Use shallow clone instead of JSON.parse(JSON.stringify())
    // which was causing ~5MB deep clones 10+ times per minute.
    // The map() already creates new arrays, and we return a new object,
    // so we don't need to deep clone the frozen TanStack Query result.
    const preprocessedData = chunkData.data.map((channelData: number[]) =>
      applyPreprocessing(channelData, selectedFile!.sample_rate, preprocessing),
    );

    const elapsed = performance.now() - startTime;
    console.log(`[PERF] Preprocessing completed in ${elapsed.toFixed(2)}ms`);

    // Return new object with processed data - spread operator preserves all metadata fields
    // while creating a new object reference (avoiding mutation of frozen TanStack Query result)
    return {
      ...chunkData,
      data: preprocessedData,
    };
  }, [chunkData, selectedFile, preprocessing]);

  // Process and render chunk data when query data changes
  useEffect(() => {
    if (!preprocessedChunkData) return;

    console.log("[ECharts] Chunk data received from query:", {
      dataLength: preprocessedChunkData.data?.length,
      timestampsLength: preprocessedChunkData.timestamps?.length,
      channels: preprocessedChunkData.channels?.length,
    });

    setCurrentChunk(preprocessedChunkData);
    renderChart(preprocessedChunkData, currentTime);
  }, [preprocessedChunkData, currentTime, timeWindow]);

  // Memoize annotation markLine config to avoid rebuilding on every update
  const annotationMarkLine = useMemo(() => {
    if (annotationsFromStore.length === 0) return undefined;

    const startTime = performance.now();

    const markLine = {
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

    const elapsed = performance.now() - startTime;
    console.log(`[PERF] Annotation markLine built in ${elapsed.toFixed(2)}ms`);

    return markLine;
  }, [annotationsFromStore]);

  // Separate effect for updating annotations without re-rendering the entire chart
  useEffect(() => {
    if (!chartInstanceRef.current || !isChartReady) return;

    // Only update markLine in the first series
    const currentOption =
      chartInstanceRef.current.getOption() as EChartsOptionWithSeries;
    if (
      !currentOption ||
      !currentOption.series ||
      currentOption.series.length === 0
    ) {
      console.log(
        "[ECharts] Skipping annotation update - chart not ready or no series yet",
      );
      return;
    }

    console.log(
      "[ECharts] Updating annotations - count:",
      annotationsFromStore.length,
    );

    // Use setOption with notMerge: false to efficiently update just the markLine
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

  // Load chunk - with TanStack Query, we just update the currentTime state
  // The query will automatically refetch based on the new query key
  const loadChunk = useCallback(
    (startTime: number) => {
      if (!selectedFile || selectedChannels.length === 0) {
        console.log("Cannot load chunk: no file or channels selected");
        return;
      }

      if (selectedFile.duration === 0) {
        console.error("File has no duration - data may not be properly loaded");
        return;
      }

      // IMPORTANT: Convert time in seconds to samples for persistence
      // Store expects chunkStart in samples, not seconds
      const chunkStartSamples = Math.floor(
        startTime * selectedFile.sample_rate,
      );

      console.log(
        "[ECharts] Loading chunk at time:",
        startTime,
        "seconds (",
        chunkStartSamples,
        "samples) - triggering persistence",
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

  // Render chart with ECharts
  const renderChart = (chunkData: ChunkData, startTime: number) => {
    console.log("[ECharts] renderChart called:", {
      hasChartInstance: !!chartInstanceRef.current,
      hasData: !!chunkData.data,
      dataLength: chunkData.data?.length || 0,
    });

    if (!chartInstanceRef.current) {
      console.warn(
        "[ECharts] Chart instance not ready, storing for later render",
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

    // Calculate channel offset for stacking with improved spacing algorithm
    const userOffset = channelOffsetSliderRef.current;

    // Auto-calculate stable offset based on data range with proper spacing
    let autoOffset = 0;
    if (stableOffsetRef.current === null) {
      const startTimeRanges = performance.now();

      // Calculate peak-to-peak range for each channel (more robust than just first 100 samples)
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

      const elapsedRanges = performance.now() - startTimeRanges;
      console.log(
        `[PERF] Channel ranges computed in ${elapsedRanges.toFixed(2)}ms`,
      );

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
        maxRange * 2.0, // Ensure minimum separation of 2x max range
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

    const startTimeSeries = performance.now();

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
          `[ECharts] Decimated channel ${channelName}: ${channelData.length} → ${decimatedData.length} points`,
        );
      } else {
        // Apply stacking offset without decimation
        decimatedData = channelData.map((value, idx) => {
          const time = startTime + idx / chunkData.sample_rate;
          const offsetValue = value + channelIndex * autoOffset;
          return [time, offsetValue];
        });
      }

      // Add annotation markers for the first series only (to avoid duplicates)
      // Use annotationsFromStore for instant updates
      let markLine = undefined;
      if (channelIndex === 0 && annotationsFromStore.length > 0) {
        console.log(
          "[ECharts] Rendering",
          annotationsFromStore.length,
          "annotations:",
          annotationsFromStore.map((a) => `${a.label} at ${a.position}s`),
        );

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

    const elapsedSeries = performance.now() - startTimeSeries;
    console.log(
      `[PERF] Series data built in ${elapsedSeries.toFixed(2)}ms for ${
        chunkData.channels.length
      } channels`,
    );

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

    // Broadcast to popout windows - flatten data structure and include file info
    if (selectedFile) {
      broadcastToType("timeseries", "data-update", {
        ...chunkData,
        startTime,
        selectedChannels,
        sampleRate: chunkData.sample_rate,
        timeWindow: duration,
        // Add file information for store sync
        filePath: selectedFile.file_path,
        fileName: selectedFile.file_name,
        duration: selectedFile.duration,
      });
    }
  };

  // Handle file/channel changes
  useEffect(() => {
    const currentFilePath = selectedFile?.file_path;
    const hasChannelsSelected = selectedChannels.length > 0;
    const isNewFile = currentFilePath !== loadedFileRef.current;

    console.log("[ECharts] File/channel effect:", {
      hasFile: !!selectedFile,
      channelsSelected: selectedChannels.length,
      isNewFile,
      isPersistenceRestored,
    });

    // Wait for persistence to be restored before loading initial chunk
    // This prevents loading chunk at 0 and then re-loading at persisted position
    if (!isPersistenceRestored) {
      console.log(
        "[ECharts] Waiting for persistence to restore before loading chunk",
      );
      return;
    }

    if (
      selectedFile &&
      selectedFile.channels?.length > 0 &&
      hasChannelsSelected &&
      (isNewFile || isInitialChannelSetRef.current)
    ) {
      console.log("[ECharts] Triggering chunk load");

      if (isNewFile) {
        // Clear all refs and state when switching to a new file
        stableOffsetRef.current = null;
        currentLabelsRef.current = null;

        // Clear channel labels and series data from chart to prevent showing old file's data
        if (chartInstanceRef.current) {
          chartInstanceRef.current.setOption(
            {
              graphic: [], // Clear all graphics (channel labels)
              series: [], // Clear all series data
            },
            { replaceMerge: ["graphic", "series"] },
          );
        }

        console.log(
          "[ECharts] Cleared all refs, graphics, and series for new file",
        );
      }

      // Use persisted position if available, otherwise start at 0
      // IMPORTANT: Get the LATEST plotState from store (not from closure)
      // This ensures we use the value that was just loaded from file-centric state
      const latestPlotState = useAppStore.getState().plot;
      const startTimeSamples = latestPlotState.chunkStart || 0;
      const startTime = startTimeSamples / selectedFile.sample_rate;
      console.log(
        `[ECharts] Loading chunk at time: ${startTime}s (${startTimeSamples} samples, persisted: ${latestPlotState.chunkStart})`,
      );
      loadChunk(startTime);
      setCurrentTime(startTime);

      setDuration(selectedFile.duration);
      loadedFileRef.current = currentFilePath!;
      isInitialChannelSetRef.current = false;
    } else if (isNewFile && !hasChannelsSelected && selectedFile) {
      // Don't clear the chart if it's marked as a "new file" but we haven't synced channels yet
      // This happens during component initialization or when auto-loading analysis on mount
      // Wait for the channel sync effect to run and populate selectedChannels
      console.log(
        "[ECharts] Waiting for channel sync before clearing chart for new file",
      );
      // Mark as loaded immediately to prevent re-clearing after channel sync
      loadedFileRef.current = currentFilePath!;
    } else if (
      !isNewFile &&
      !isInitialChannelSetRef.current &&
      hasChannelsSelected
    ) {
      console.log(
        "[ECharts] Same file, channels changed - will refetch via TanStack Query",
      );
      // TanStack Query will automatically refetch when selectedChannels changes
      // No need for manual debouncing - query already handles deduplication
    }
  }, [
    selectedFile?.file_path,
    selectedChannels,
    loadChunk,
    isPersistenceRestored,
  ]);

  // Respond to plotState.chunkStart changes from async file-centric state loading
  // This effect handles the case where the file-centric state loads AFTER the initial effect runs
  const hasRespondedToPersistedChunkRef = useRef(false);
  useEffect(() => {
    // Only run if:
    // 1. We have a selected file
    // 2. We have persistence restored
    // 3. We haven't already responded to this file's persisted chunk position
    // 4. The plotState.chunkStart is non-zero (indicates persisted state has loaded)
    if (
      selectedFile &&
      isPersistenceRestored &&
      !hasRespondedToPersistedChunkRef.current &&
      plotState.chunkStart > 0
    ) {
      const startTimeSamples = plotState.chunkStart;
      const startTime = startTimeSamples / selectedFile.sample_rate;

      console.log(
        `[ECharts] Persisted chunk position loaded from file-centric state: ${startTime.toFixed(2)}s (${startTimeSamples} samples) - reloading chunk`,
      );

      loadChunk(startTime);
      setCurrentTime(startTime);
      hasRespondedToPersistedChunkRef.current = true;
    }
  }, [plotState.chunkStart, selectedFile, isPersistenceRestored, loadChunk]);

  // Reset the persisted chunk response flag when file changes
  useEffect(() => {
    hasRespondedToPersistedChunkRef.current = false;
  }, [selectedFile?.file_path]);

  // Sync selected channels with file
  useEffect(() => {
    if (selectedFile && selectedChannelsFromStore.length > 0) {
      setSelectedChannels(selectedChannelsFromStore);
    } else if (selectedFile && selectedFile.channels.length > 0) {
      // Auto-select first 8 channels
      const initialChannels = selectedFile.channels.slice(0, 8);
      setSelectedChannels(initialChannels);
      persistSelectedChannels(initialChannels);
    }
  }, [selectedFile, selectedChannelsFromStore]);

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

      // Check if the chart is fully initialized with series data
      const chartOption = chartInstanceRef.current.getOption();
      if (
        !chartOption ||
        !chartOption.series ||
        (chartOption.series as unknown[]).length === 0
      ) {
        console.log("[ECharts] Chart not ready for right-click - no series");
        return;
      }

      console.log("[ECharts] Right-click event triggered");

      // Get the chart's bounding rectangle
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Convert pixel position to time value
      // ECharts uses the convertFromPixel method
      let pointInGrid: number[] | undefined;
      try {
        pointInGrid = chartInstanceRef.current.convertFromPixel(
          { seriesIndex: 0 },
          [x, 0],
        );
      } catch (err) {
        console.warn("[ECharts] Failed to convert pixel position:", err);
        return;
      }

      if (pointInGrid && typeof pointInGrid[0] === "number") {
        const timePosition = pointInGrid[0];

        // IMPORTANT: Get current file path from store to avoid stale closure
        const currentFilePath =
          useAppStore.getState().fileManager.selectedFile?.file_path;
        const allAnnotations = useAppStore.getState().annotations.timeSeries;
        const fileAnnotations = currentFilePath
          ? allAnnotations[currentFilePath]
          : null;
        const currentAnnotations = fileAnnotations?.globalAnnotations || [];

        console.log(
          "[ECharts] Converted click position to time:",
          timePosition,
        );
        console.log("[ECharts] Current file path from store:", currentFilePath);
        console.log("[ECharts] Annotations for this file:", currentAnnotations);

        // Check if clicking on an existing annotation
        // Use larger tolerance for easier clicking on annotations
        const clickedAnnotation = currentAnnotations.find(
          (ann) => Math.abs(ann.position - timePosition) < 1.0, // 1 second tolerance
        );

        if (clickedAnnotation) {
          console.log(
            "[ECharts] Right-clicked on existing annotation:",
            clickedAnnotation.label,
            "at position:",
            clickedAnnotation.position,
          );
        } else {
          console.log(
            "[ECharts] Right-clicked on empty space at time:",
            timePosition,
          );
        }

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
    const totalSamples = newWindow * sampleRate * selectedChannels.length;

    // Warn if loading might be slow (>500k samples)
    if (totalSamples > 500000) {
      console.warn(
        `[ECharts] Large data request: ${totalSamples.toLocaleString()} samples may be slow`,
      );
    }

    // IMPORTANT: Convert time window in seconds to samples for persistence
    // Store expects chunkSize in samples, not seconds
    const chunkSizeSamples = Math.floor(newWindow * sampleRate);

    console.log(
      "[ECharts] Time window changed from",
      timeWindow,
      "to",
      newWindow,
      "seconds (",
      chunkSizeSamples,
      "samples) - triggering persistence",
    );
    setTimeWindow(newWindow);
    updatePlotState({ chunkSize: chunkSizeSamples });
    // loadChunk will be called automatically when chunkSize updates from timeWindow state change
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
    if (plotState.currentChunk && selectedFile) {
      // Flatten data structure and include file info for popout
      createWindow("timeseries", `timeseries-${Date.now()}`, {
        ...plotState.currentChunk,
        startTime: currentTime,
        selectedChannels,
        sampleRate: plotState.currentChunk.sample_rate,
        timeWindow: duration,
        // Add file information for store sync
        filePath: selectedFile.file_path,
        fileName: selectedFile.file_name,
        duration: selectedFile.duration,
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
              disabled={!plotState.currentChunk}
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
            onSeek={(time) => {
              setCurrentTime(time);
              loadChunk(time);
            }}
            onTimeWindowChange={(window) => {
              handleTimeWindowChange([window]);
            }}
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

        {/* Chart Container */}
        <div className="flex-1 relative min-h-0">
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
                {/* Cancel button removed - TanStack Query handles request cancellation automatically */}
              </div>
            </div>
          )}
          <div ref={chartRef} className="w-full h-full" />
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
                setSelectedChannels(sortedChannels);
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

// Export memoized version to prevent unnecessary re-renders
export const TimeSeriesPlotECharts = memo(TimeSeriesPlotEChartsComponent);
