"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo, Suspense } from "react";
import { useAppStore } from "@/store/appStore";
import { profiler, useRenderProfiler } from "@/utils/performance";
import { throttle } from "@/utils/debounce";
import { DDAResult } from "@/types/api";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChannelSelector } from "@/components/ChannelSelector";
import {
  Download,
  RotateCcw,
  TrendingUp,
  Grid3x3,
  Eye,
  ExternalLink,
  Loader2,
  FileImage,
  FileCode,
  FileText,
  Database,
  Image,
} from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { TauriService } from "@/services/tauriService";
import {
  exportDDAToCSV,
  exportDDAToJSON,
  getDefaultExportFilename,
} from "@/utils/ddaExport";
import {
  canvasToPNG,
  canvasToSVG,
  canvasToPDF,
  getDefaultPlotFilename,
} from "@/utils/plotExport";
import { useDDAAnnotations } from "@/hooks/useAnnotations";
import { AnnotationContextMenu } from "@/components/annotations/AnnotationContextMenu";
import { AnnotationMarker } from "@/components/annotations/AnnotationMarker";
import { PlotAnnotation, PlotInfo } from "@/types/annotations";
import { PlotLoadingSkeleton } from "@/components/dda/PlotLoadingSkeleton";

interface DDAResultsProps {
  result: DDAResult;
}

type ColorScheme = "viridis" | "plasma" | "inferno" | "jet" | "cool" | "hot";
type ViewMode = "heatmap" | "lineplot" | "both";

// Internal component (will be wrapped with memo at export)
function DDAResultsComponent({ result }: DDAResultsProps) {
  // Performance profiling for this component
  // TEMPORARILY DISABLED to check if profiler is adding overhead
  // useRenderProfiler('DDAResults');

  // CRITICAL FIX: Progressive rendering to prevent UI freeze
  // Render controls first, defer heavy plot containers to next frame
  const [showPlots, setShowPlots] = useState(false);

  // Popout window hooks with memoization
  const { createWindow, broadcastToType } = usePopoutWindows();

  // Only select sample_rate, not the entire fileManager object
  const sampleRate = useAppStore(
    (state) => state.fileManager.selectedFile?.sample_rate || 256,
  );
  const heatmapRef = useRef<HTMLDivElement>(null);
  const linePlotRef = useRef<HTMLDivElement>(null);
  // Track when heatmap DOM is mounted to trigger effect re-run
  const [heatmapDOMMounted, setHeatmapDOMMounted] = useState(false);
  const [linePlotDOMMounted, setLinePlotDOMMounted] = useState(false);

  // Callback ref to detect when heatmap DOM is mounted/unmounted
  const heatmapCallbackRef = useCallback((node: HTMLDivElement | null) => {
    heatmapRef.current = node;
    setHeatmapDOMMounted(!!node);
    console.log(`[HEATMAP REF] DOM ${node ? "mounted" : "unmounted"}`);
  }, []);

  // Callback ref to detect when line plot DOM is mounted/unmounted
  const linePlotCallbackRef = useCallback((node: HTMLDivElement | null) => {
    linePlotRef.current = node;
    setLinePlotDOMMounted(!!node);
    console.log(`[LINEPLOT REF] DOM ${node ? "mounted" : "unmounted"}`);
  }, []);
  const uplotHeatmapRef = useRef<uPlot | null>(null);
  const uplotLinePlotRef = useRef<uPlot | null>(null);
  const lastRenderedResultId = useRef<string | null>(null);
  const renderTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastBroadcastTime = useRef<number>(0);
  const broadcastThrottleMs = 500; // Only broadcast every 500ms max
  const lastAnnotationCount = useRef<{ heatmap: number; lineplot: number }>({
    heatmap: 0,
    lineplot: 0,
  });
  const heatmapCleanupRef = useRef<(() => void) | null>(null);
  const linePlotCleanupRef = useRef<(() => void) | null>(null);
  // Track current channel count for ResizeObserver callback (initialized later)
  const currentChannelCountRef = useRef<number>(0);

  // Refs to track current plot heights for ResizeObserver callbacks
  // This prevents the observers from using stale closure values
  const heatmapHeightRef = useRef<number>(
    (() => {
      try {
        const saved = localStorage.getItem("dda-heatmap-height");
        return saved ? parseInt(saved) : 500;
      } catch {
        return 500;
      }
    })(),
  );
  const linePlotHeightRef = useRef<number>(
    (() => {
      try {
        const saved = localStorage.getItem("dda-lineplot-height");
        return saved ? parseInt(saved) : 400;
      } catch {
        return 400;
      }
    })(),
  );

  // Start with both views for better user experience
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [colorScheme, setColorScheme] = useState<ColorScheme>("viridis");
  const [heatmapHeight, setHeatmapHeight] = useState(() => {
    try {
      const saved = localStorage.getItem("dda-heatmap-height");
      return saved ? parseInt(saved) : 500;
    } catch {
      return 500;
    }
  });
  const [linePlotHeight, setLinePlotHeight] = useState(() => {
    try {
      const saved = localStorage.getItem("dda-lineplot-height");
      return saved ? parseInt(saved) : 400;
    } catch {
      return 400;
    }
  });
  const [isResizing, setIsResizing] = useState<"heatmap" | "lineplot" | null>(
    null,
  );

  // CRITICAL FIX: Progressive rendering - defer plot containers to prevent UI freeze
  // Render controls first, then mount heavy plot containers on next frame
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setShowPlots(true);
    });
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Persist plot heights to localStorage and keep refs in sync
  useEffect(() => {
    heatmapHeightRef.current = heatmapHeight;
    try {
      localStorage.setItem("dda-heatmap-height", heatmapHeight.toString());
    } catch (error) {
      console.error("Failed to save heatmap height:", error);
    }
  }, [heatmapHeight]);

  useEffect(() => {
    linePlotHeightRef.current = linePlotHeight;
    try {
      localStorage.setItem("dda-lineplot-height", linePlotHeight.toString());
    } catch (error) {
      console.error("Failed to save lineplot height:", error);
    }
  }, [linePlotHeight]);

  // Get available channels from the CURRENT variant's dda_matrix (source of truth)
  // NOTE: This needs to be computed AFTER currentVariantData, so we'll move it later

  // Initialize selectedChannels from actual dda_matrix keys, not result.channels
  // This ensures we only select channels that actually have data
  const [selectedChannels, setSelectedChannels] = useState<string[]>(() => {
    const firstVariant = result.results.variants[0];
    if (firstVariant && firstVariant.dda_matrix) {
      const channels = Object.keys(firstVariant.dda_matrix);
      // Use ALL channels from dda_matrix since those are the ones that were actually analyzed
      // result.channels might be outdated or incomplete from persistence
      return channels;
    }
    return result.channels;
  });

  const [selectedVariant, setSelectedVariant] = useState<number>(0);
  const [heatmapData, setHeatmapData] = useState<number[][]>([]);
  const [colorRange, setColorRange] = useState<[number, number]>([0, 1]);
  const [autoScale, setAutoScale] = useState(true);
  const [isProcessingData, setIsProcessingData] = useState(false);
  const [isRenderingHeatmap, setIsRenderingHeatmap] = useState(false);
  const [isRenderingLinePlot, setIsRenderingLinePlot] = useState(false);

  // Color schemes
  const colorSchemes: Record<ColorScheme, (t: number) => string> = {
    viridis: (t: number) => {
      const colors = [
        [68, 1, 84],
        [72, 40, 120],
        [62, 73, 137],
        [49, 104, 142],
        [38, 130, 142],
        [31, 158, 137],
        [53, 183, 121],
        [109, 205, 89],
        [180, 222, 44],
        [253, 231, 37],
      ];
      const idx = Math.floor(t * (colors.length - 1));
      const frac = t * (colors.length - 1) - idx;
      const c1 = colors[idx] || colors[0];
      const c2 = colors[idx + 1] || colors[colors.length - 1];
      const r = Math.round(c1[0] + frac * (c2[0] - c1[0]));
      const g = Math.round(c1[1] + frac * (c2[1] - c1[1]));
      const b = Math.round(c1[2] + frac * (c2[2] - c1[2]));
      return `rgb(${r},${g},${b})`;
    },
    plasma: (t: number) => {
      const colors = [
        [13, 8, 135],
        [75, 3, 161],
        [125, 3, 168],
        [168, 34, 150],
        [203, 70, 121],
        [229, 107, 93],
        [248, 148, 65],
        [253, 195, 40],
        [239, 248, 33],
      ];
      const idx = Math.floor(t * (colors.length - 1));
      const frac = t * (colors.length - 1) - idx;
      const c1 = colors[idx] || colors[0];
      const c2 = colors[idx + 1] || colors[colors.length - 1];
      const r = Math.round(c1[0] + frac * (c2[0] - c1[0]));
      const g = Math.round(c1[1] + frac * (c2[1] - c1[1]));
      const b = Math.round(c1[2] + frac * (c2[2] - c1[2]));
      return `rgb(${r},${g},${b})`;
    },
    inferno: (t: number) => {
      const colors = [
        [0, 0, 4],
        [31, 12, 72],
        [85, 15, 109],
        [136, 34, 106],
        [186, 54, 85],
        [227, 89, 51],
        [249, 140, 10],
        [249, 201, 50],
        [252, 255, 164],
      ];
      const idx = Math.floor(t * (colors.length - 1));
      const frac = t * (colors.length - 1) - idx;
      const c1 = colors[idx] || colors[0];
      const c2 = colors[idx + 1] || colors[colors.length - 1];
      const r = Math.round(c1[0] + frac * (c2[0] - c1[0]));
      const g = Math.round(c1[1] + frac * (c2[1] - c1[1]));
      const b = Math.round(c1[2] + frac * (c2[2] - c1[2]));
      return `rgb(${r},${g},${b})`;
    },
    jet: (t: number) => {
      const r = Math.max(
        0,
        Math.min(255, Math.round(255 * (1.5 - 4 * Math.abs(t - 0.75)))),
      );
      const g = Math.max(
        0,
        Math.min(255, Math.round(255 * (1.5 - 4 * Math.abs(t - 0.5)))),
      );
      const b = Math.max(
        0,
        Math.min(255, Math.round(255 * (1.5 - 4 * Math.abs(t - 0.25)))),
      );
      return `rgb(${r},${g},${b})`;
    },
    cool: (t: number) => {
      const r = Math.round(t * 255);
      const g = Math.round((1 - t) * 255);
      const b = 255;
      return `rgb(${r},${g},${b})`;
    },
    hot: (t: number) => {
      let r, g, b;
      if (t < 0.4) {
        r = Math.round((255 * t) / 0.4);
        g = 0;
        b = 0;
      } else if (t < 0.8) {
        r = 255;
        g = Math.round((255 * (t - 0.4)) / 0.4);
        b = 0;
      } else {
        r = 255;
        g = 255;
        b = Math.round((255 * (t - 0.8)) / 0.2);
      }
      return `rgb(${r},${g},${b})`;
    },
  };

  // Get available variants - memoized to prevent recreation
  // CRITICAL FIX: Use result.id as dependency instead of result.results object
  // This prevents re-renders when parent passes new result object with same data
  const availableVariants = useMemo(() => {
    // Removed verbose logging

    if (result.results.variants && result.results.variants.length > 0) {
      return result.results.variants;
    }
    // Fallback to legacy format
    if (result.results.dda_matrix) {
      return [
        {
          variant_id: "legacy",
          variant_name: "Combined Results",
          dda_matrix: result.results.dda_matrix,
          exponents: result.results.exponents || {},
          quality_metrics: result.results.quality_metrics || {},
        },
      ];
    }
    return [];
  }, [result.id]); // Only recalculate when result.id changes, not when object ref changes

  // Generate available plots for annotation visibility
  const availablePlots = useMemo<PlotInfo[]>(() => {
    const plots: PlotInfo[] = [
      { id: "timeseries", label: "Data Visualization" },
    ];

    // Add all DDA variant plots
    availableVariants.forEach((variant) => {
      plots.push({
        id: `dda:${variant.variant_id}:heatmap`,
        label: `${variant.variant_name} - Heatmap`,
      });
      plots.push({
        id: `dda:${variant.variant_id}:lineplot`,
        label: `${variant.variant_name} - Line Plot`,
      });
    });

    return plots;
  }, [availableVariants]);

  // Memoize current variant data to prevent re-renders when variant hasn't changed
  const currentVariantData = useMemo(() => {
    return availableVariants[selectedVariant] || availableVariants[0];
  }, [availableVariants, selectedVariant]);

  // Get available channels from the CURRENT variant's dda_matrix
  const availableChannels = useMemo(() => {
    if (currentVariantData?.dda_matrix) {
      return Object.keys(currentVariantData.dda_matrix);
    }
    return result.channels;
  }, [currentVariantData?.dda_matrix, result.channels]);

  // Update selectedChannels when variant changes - ONLY if channels actually changed
  useEffect(() => {
    if (!currentVariantData?.dda_matrix) return;

    const channels = Object.keys(currentVariantData.dda_matrix);

    // Reset the prevHeatmapDataRef when variant changes to force recalculation
    prevHeatmapDataRef.current.range = [0, 1];
    prevHeatmapDataRef.current.variantId = null; // Force data update detection

    // NOTE: We don't reset colorRange state here anymore. The ref reset above
    // ensures rangeChanged will be true, triggering proper color range update.
    // Resetting the state caused flat-color rendering during the transition.

    // Check if channels have actually changed (compare arrays)
    setSelectedChannels((prev) => {
      const hasChanged =
        prev.length !== channels.length ||
        prev.some((ch, i) => ch !== channels[i]);

      if (hasChanged) {
        console.log(
          "[DDARESULTS] Variant changed, updating selectedChannels:",
          {
            variantId: currentVariantData.variant_id,
            prevChannels: prev,
            newChannels: channels,
          },
        );
        // DON'T update ref here - it will be updated when creating new plot
        return channels;
      }

      // No change - return previous reference to avoid re-render
      return prev;
    });
  }, [currentVariantData?.variant_id, result.id, autoScale]);

  // CRITICAL: Clean up ResizeObservers immediately when channels change
  // This prevents old observers from firing with the wrong channel count
  useEffect(() => {
    return () => {
      // Cleanup on unmount or when channels change
      if (heatmapCleanupRef.current) {
        console.log("[HEATMAP] Cleaning up observer due to channel change");
        heatmapCleanupRef.current();
        heatmapCleanupRef.current = null;
      }
      if (linePlotCleanupRef.current) {
        console.log("[LINEPLOT] Cleaning up observer due to channel change");
        linePlotCleanupRef.current();
        linePlotCleanupRef.current = null;
      }
    };
  }, [selectedChannels.length]);

  // Extract current variant ID for annotation hooks
  const currentVariantId = currentVariantData?.variant_id || "legacy";

  // Annotation hooks for heatmap and line plot
  const heatmapAnnotations = useDDAAnnotations({
    resultId: result.id,
    variantId: currentVariantId,
    plotType: "heatmap",
    ddaResult: result,
    sampleRate: sampleRate,
  });

  const linePlotAnnotations = useDDAAnnotations({
    resultId: result.id,
    variantId: currentVariantId,
    plotType: "line",
    ddaResult: result,
    sampleRate: sampleRate,
  });

  const getCurrentVariantData = () => {
    const current = availableVariants[selectedVariant] || availableVariants[0];
    return current;
  };

  // Memoized heatmap data processing - only recompute when inputs change
  // CRITICAL FIX: Defer processing until showPlots is true to prevent UI freeze
  const { heatmapData: processedHeatmapData, colorRange: computedColorRange } =
    useMemo(() => {
      // Don't process data until plots are ready to show
      if (!showPlots) {
        return { heatmapData: [], colorRange: [0, 1] as [number, number] };
      }

      const startTime = performance.now();
      console.log(
        "[PERF] Starting heatmap data processing for",
        selectedChannels.length,
        "channels",
      );

      if (!currentVariantData || !currentVariantData.dda_matrix) {
        console.log("[PERF] No variant data available");
        return { heatmapData: [], colorRange: [0, 1] as [number, number] };
      }

      const dda_matrix = currentVariantData.dda_matrix;
      const data: number[][] = [];

      // Optimized: Pre-allocate array and avoid intermediate allValues array
      let count = 0;
      let sum = 0;
      let sumSquares = 0;
      let min = Infinity;
      let max = -Infinity;

      // Process channels in parallel-friendly way (map is faster than forEach)
      selectedChannels.forEach((channel) => {
        if (dda_matrix[channel]) {
          const rawChannelData = dda_matrix[channel];
          const channelData = new Array(rawChannelData.length);

          // Single-pass statistics collection with log transform
          for (let i = 0; i < rawChannelData.length; i++) {
            const logVal = Math.log10(Math.max(0.001, rawChannelData[i]));
            channelData[i] = logVal;

            // Accumulate statistics in one pass
            sum += logVal;
            sumSquares += logVal * logVal;
            count++;
            if (logVal < min) min = logVal;
            if (logVal > max) max = logVal;
          }

          data.push(channelData);
        }
      });

      const elapsedTransform = performance.now() - startTime;
      console.log(
        `[PERF] Data transform completed in ${elapsedTransform.toFixed(2)}ms`,
      );

      // Optimized statistics: single-pass mean and std (no sorting needed)
      let minVal = min;
      let maxVal = max;

      if (count > 0 && autoScale) {
        const mean = sum / count;
        const variance = sumSquares / count - mean * mean;
        const std = Math.sqrt(Math.max(0, variance)); // Prevent negative due to float precision

        // Use mean ± 3 * std instead of median (avoids expensive sorting)
        minVal = mean - 3 * std;
        maxVal = mean + 3 * std;

        const elapsedStats = performance.now() - startTime;
        console.log(
          `[PERF] Statistics calculated in ${elapsedStats.toFixed(2)}ms total`,
        );
      }

      const totalElapsed = performance.now() - startTime;
      console.log(
        `[PERF] Heatmap data processing completed in ${totalElapsed.toFixed(
          2,
        )}ms`,
      );

      return {
        heatmapData: data,
        colorRange: [minVal, maxVal] as [number, number],
      };
    }, [showPlots, selectedChannels, currentVariantData, autoScale]);

  // Track previous heatmap data to prevent unnecessary updates
  const prevHeatmapDataRef = useRef<{
    data: number[][];
    range: [number, number];
    variantId: string | null;
  }>({
    data: [],
    range: [0, 1],
    variantId: null,
  });

  // Update state when memoized data changes
  // Use RAF to defer updates and prevent blocking the main thread
  useEffect(() => {
    const currentVariantId = currentVariantData?.variant_id || null;

    // Check if data actually changed (prevent re-render loop)
    const dataChanged =
      processedHeatmapData.length !== prevHeatmapDataRef.current.data.length ||
      processedHeatmapData.length === 0 ||
      processedHeatmapData[0]?.length !==
        prevHeatmapDataRef.current.data[0]?.length ||
      currentVariantId !== prevHeatmapDataRef.current.variantId;

    const rangeChanged =
      computedColorRange[0] !== prevHeatmapDataRef.current.range[0] ||
      computedColorRange[1] !== prevHeatmapDataRef.current.range[1];

    if (!dataChanged && !rangeChanged) {
      return; // No actual changes, skip update
    }

    // CRITICAL: Update ref tracking IMMEDIATELY (synchronous) so render effect sees correct values
    // Ref updates are cheap and don't block, so no need to defer them
    if (dataChanged) {
      prevHeatmapDataRef.current.data = processedHeatmapData;
      prevHeatmapDataRef.current.variantId = currentVariantId;
    }
    if (rangeChanged) {
      prevHeatmapDataRef.current.range = computedColorRange;
    }

    // Data processing is already fast (~16ms), no need to defer the update
    if (dataChanged) {
      console.log(
        `[HEATMAP DATA] Updating heatmapData for variant ${currentVariantId}, ${processedHeatmapData.length} channels`,
      );
      setHeatmapData(processedHeatmapData);
    }

    if (
      autoScale &&
      rangeChanged &&
      computedColorRange[0] !== computedColorRange[1]
    ) {
      setColorRange(computedColorRange);
    }
  }, [
    processedHeatmapData,
    computedColorRange,
    autoScale,
    currentVariantData?.variant_id,
  ]);

  const renderHeatmap = useCallback(() => {
    if (!heatmapRef.current || heatmapData.length === 0) {
      setIsRenderingHeatmap(false);
      return;
    }

    // Set loading state immediately for instant feedback
    setIsRenderingHeatmap(true);

    // Clean up previous ResizeObserver first
    if (heatmapCleanupRef.current) {
      console.log(
        "[HEATMAP] Cleaning up previous plot before rendering new one",
      );
      heatmapCleanupRef.current();
      heatmapCleanupRef.current = null;
    }

    // Clean up existing plot
    if (uplotHeatmapRef.current) {
      uplotHeatmapRef.current.destroy();
      uplotHeatmapRef.current = null;
    }

    // Clear the container to remove any stale DOM elements
    if (heatmapRef.current) {
      heatmapRef.current.innerHTML = "";
    }

    // NOW update the ref for the NEW plot - after old observer is disconnected
    currentChannelCountRef.current = selectedChannels.length;
    console.log(
      `[HEATMAP] Updated currentChannelCountRef to ${selectedChannels.length}`,
    );

    // CRITICAL: Defer heavy rendering to NEXT frame so browser can paint loading state first
    // Without this, the loading overlay never shows because we block the main thread
    const deferredRender = () => {
      profiler.start('heatmap-render', {
        channels: selectedChannels.length,
        timePoints: result.results.scales.length,
        variant: currentVariantData?.variant_id,
      });

      try {
        // Double-check ref is still available
        if (!heatmapRef.current) {
          profiler.end('heatmap-render');
          return;
        }

        const width = heatmapRef.current.clientWidth || 800;
        const height = heatmapHeight;
        console.log(
          `[HEATMAP] Creating new plot for ${selectedChannels.length} channels, height: ${height}`,
        );

        // Prepare data for uPlot
        const plotData: uPlot.AlignedData = [
          result.results.scales,
          new Array(result.results.scales.length).fill(0),
        ];

        const opts: uPlot.Options = {
          width,
          height,
          scales: {
            x: {
              time: false,
              range: [
                result.results.scales[0],
                result.results.scales[result.results.scales.length - 1],
              ],
            },
            y: {
              range: [-0.5, selectedChannels.length - 0.5],
            },
          },
          axes: [
            {
              label: "Time Points",
              labelSize: 30,
              size: 50,
            },
            {
              label: "Channels",
              labelSize: 100,
              size: 120,
              splits: (
                u,
                axisIdx,
                scaleMin,
                scaleMax,
                foundIncr,
                foundSpace,
              ) => {
                // Generate splits at integer positions (0, 1, 2, ..., n-1) for channel centers
                const splits = [];
                for (let i = 0; i < selectedChannels.length; i++) {
                  splits.push(i);
                }
                return splits;
              },
              values: (u, ticks) =>
                ticks.map((tick) => {
                  // Ticks are already at integer positions from splits
                  const idx = Math.round(tick);
                  return idx >= 0 && idx < selectedChannels.length
                    ? selectedChannels[idx]
                    : "";
                }),
            },
          ],
          series: [
            {},
            {
              paths: () => null,
              points: { show: false },
            },
          ],
          cursor: {
            lock: false,
            drag: {
              x: true,
              y: false,
              uni: 50,
              dist: 10,
            },
          },
          hooks: {
            init: [
              (u) => {
                // Attach context menu handler to uPlot overlay
                u.over.addEventListener("contextmenu", (e: MouseEvent) => {
                  e.preventDefault();
                  const rect = u.over.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const scaleValue = u.posToVal(x, "x");
                  heatmapAnnotations.openContextMenu(
                    e.clientX,
                    e.clientY,
                    scaleValue,
                  );
                });
              },
            ],
            setSelect: [
              (u) => {
                const min = u.select.left;
                const max = u.select.left + u.select.width;

                if (u.select.width >= 10) {
                  u.setScale("x", {
                    min: u.posToVal(min, "x"),
                    max: u.posToVal(max, "x"),
                  });
                }

                u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
              },
            ],
            draw: [
              (u) => {
                const renderStartTime = performance.now();
                const ctx = u.ctx;
                const {
                  left,
                  top,
                  width: plotWidth,
                  height: plotHeight,
                } = u.bbox;

                if (plotWidth <= 0 || plotHeight <= 0) return;

                ctx.save();
                ctx.beginPath();
                ctx.rect(left, top, plotWidth, plotHeight);
                ctx.clip();

                const cellWidth = plotWidth / result.results.scales.length;
                const cellHeight = plotHeight / selectedChannels.length;

                // Pre-compute normalization factor (optimization: avoid repeated division)
                const colorRangeDiff = colorRange[1] - colorRange[0];
                const normFactor =
                  colorRangeDiff !== 0 ? 1 / colorRangeDiff : 0;
                const colorMin = colorRange[0];

                // Optimized rendering: batch operations and reduce function calls
                for (let y = 0; y < selectedChannels.length; y++) {
                  const rowData = heatmapData[y];
                  const yPos = top + y * cellHeight;

                  if (!rowData) continue;

                  for (let x = 0; x < result.results.scales.length; x++) {
                    const value = rowData[x] || 0;
                    // Optimized normalization with pre-computed factor
                    const normalized = (value - colorMin) * normFactor;
                    const clamped = Math.max(0, Math.min(1, normalized));

                    ctx.fillStyle = colorSchemes[colorScheme](clamped);
                    ctx.fillRect(
                      left + x * cellWidth,
                      yPos,
                      cellWidth + 1,
                      cellHeight + 1,
                    );
                  }
                }

                const renderElapsed = performance.now() - renderStartTime;
                console.log(
                  `[PERF] Heatmap render completed in ${renderElapsed.toFixed(
                    2,
                  )}ms`,
                );

                ctx.restore();
              },
            ],
          },
        };

        if (!heatmapRef.current) return;

        uplotHeatmapRef.current = new uPlot(opts, plotData, heatmapRef.current);

        const resizeObserver = new ResizeObserver(
          throttle(() => {
            profiler.start('heatmap-resize', { category: 'render' });
            try {
              if (uplotHeatmapRef.current && heatmapRef.current) {
                const newWidth = heatmapRef.current.clientWidth || 800;
                const currentHeight = heatmapHeightRef.current;
                console.log(
                  `[HEATMAP RESIZE] Resizing to width=${newWidth}, height=${currentHeight}`,
                );
                uplotHeatmapRef.current.setSize({
                  width: newWidth,
                  height: currentHeight,
                });
                uplotHeatmapRef.current.redraw();
              }
            } finally {
              profiler.end('heatmap-resize');
            }
          }, 100), // Throttle to max 10 times per second
        );

        if (heatmapRef.current) {
          resizeObserver.observe(heatmapRef.current);
        }

        // Store cleanup function so it can be called when switching variants
        heatmapCleanupRef.current = () => {
          console.log(
            "[HEATMAP CLEANUP] Disconnecting ResizeObserver and destroying plot",
          );
          resizeObserver.disconnect();
          if (uplotHeatmapRef.current) {
            uplotHeatmapRef.current.destroy();
            uplotHeatmapRef.current = null;
          }
        };

        // Clear loading state after plot is created
        setTimeout(() => {
          setIsRenderingHeatmap(false);
          profiler.end('heatmap-render');
        }, 50);
      } catch (error) {
        console.error("Error rendering heatmap:", error);
        setIsRenderingHeatmap(false);
        profiler.end('heatmap-render');
      }
    };

    // Call deferredRender directly since we're already in a setTimeout(0) from the effect
    // No need for additional deferral (requestIdleCallback/RAF) - that was causing 8+ second delays
    deferredRender();
  }, [
    heatmapData,
    selectedChannels,
    result.results.scales.length,
    colorRange[0],
    colorRange[1],
    colorScheme,
    heatmapHeight,
  ]);

  const renderLinePlot = useCallback(() => {
    if (!linePlotRef.current) {
      setIsRenderingLinePlot(false);
      return;
    }

    const currentVariant =
      availableVariants[selectedVariant] || availableVariants[0];

    if (!currentVariant || !currentVariant.dda_matrix) {
      // No variant data available
      setIsRenderingLinePlot(false);
      return;
    }

    // Set loading state immediately for instant feedback
    setIsRenderingLinePlot(true);

    // Clean up previous ResizeObserver first
    if (linePlotCleanupRef.current) {
      linePlotCleanupRef.current();
      linePlotCleanupRef.current = null;
    }

    // CRITICAL: Defer heavy rendering to NEXT frame so browser can paint loading state first
    const deferredRender = () => {
      try {
        // Clean up existing plot
        if (uplotLinePlotRef.current) {
          uplotLinePlotRef.current.destroy();
          uplotLinePlotRef.current = null;
        }

        // Clear the container to remove any stale DOM elements
        if (linePlotRef.current) {
          linePlotRef.current.innerHTML = "";
        }

        // Removed verbose logging

        // Prepare data for line plot
        const startPrepTime = performance.now();
        const scales = result.results.scales;

        // Defensive check for scales data
        if (!scales || !Array.isArray(scales) || scales.length === 0) {
          console.error(
            "[LINE PLOT] Invalid scales data for line plot:",
            scales,
          );
          console.error("[LINE PLOT] Result structure:", {
            hasResults: !!result.results,
            resultsKeys: result.results ? Object.keys(result.results) : [],
            scales: result.results?.scales,
            variants: result.results?.variants?.length || 0,
          });
          setIsRenderingLinePlot(false);
          return;
        }

        const data: uPlot.AlignedData = [scales];
        const validChannels: string[] = [];

        // Add DDA matrix data for selected channels - only include channels with valid data
        for (const channel of selectedChannels) {
          const channelData = currentVariant.dda_matrix[channel];
          if (
            channelData &&
            Array.isArray(channelData) &&
            channelData.length > 0
          ) {
            data.push(channelData);
            validChannels.push(channel);
          }
        }

        const prepElapsed = performance.now() - startPrepTime;
        console.log(
          `[PERF] Line plot data preparation completed in ${prepElapsed.toFixed(
            2,
          )}ms`,
        );

        // Check we have at least one data series besides x-axis
        if (data.length < 2 || validChannels.length === 0) {
          console.error("[LINE PLOT] No valid channel data for line plot", {
            dataLength: data.length,
            validChannelsCount: validChannels.length,
          });
          setIsRenderingLinePlot(false);
          return;
        }

        // Create series configuration - IMPORTANT: must match data array length
        const series: uPlot.Series[] = [
          {}, // x-axis
          ...validChannels.map((channel, index) => ({
            label: `${channel}`,
            stroke: getChannelColor(index),
            width: 2,
            points: { show: false },
          })),
        ];

        // Check ref again before accessing clientWidth
        if (!linePlotRef.current) {
          console.warn("Line plot ref became null during rendering");
          return;
        }

        const opts: uPlot.Options = {
          width: linePlotRef.current.clientWidth || 800, // Fallback width
          height: linePlotHeight,
          series,
          scales: {
            x: {
              time: false,
            },
            y: {},
          },
          axes: [
            {
              label: "Time Points",
              labelSize: 30,
              size: 50,
            },
            {
              label: "DDA Values",
              labelSize: 80,
              size: 80,
            },
          ],
          legend: {
            show: true,
            live: true,
          },
          cursor: {
            show: true,
            x: true,
            y: true,
            lock: false,
            drag: {
              x: true,
              y: false,
              uni: 50,
              dist: 10,
            },
          },
          hooks: {
            init: [
              (u) => {
                // Attach context menu handler to uPlot overlay
                u.over.addEventListener("contextmenu", (e: MouseEvent) => {
                  e.preventDefault();
                  const rect = u.over.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const scaleValue = u.posToVal(x, "x");
                  linePlotAnnotations.openContextMenu(
                    e.clientX,
                    e.clientY,
                    scaleValue,
                  );
                });
              },
            ],
            setSelect: [
              (u) => {
                const min = u.select.left;
                const max = u.select.left + u.select.width;

                if (u.select.width >= 10) {
                  // Only zoom if selection is wide enough
                  u.setScale("x", {
                    min: u.posToVal(min, "x"),
                    max: u.posToVal(max, "x"),
                  });
                }

                // Clear the selection box
                u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
              },
            ],
          },
        };

        // Final check before creating plot
        if (!linePlotRef.current) {
          console.warn("Line plot ref became null before creating uPlot");
          return;
        }

        const startRenderTime = performance.now();
        uplotLinePlotRef.current = new uPlot(opts, data, linePlotRef.current);
        const renderElapsed = performance.now() - startRenderTime;

        console.log(
          `[PERF] Line plot uPlot creation completed in ${renderElapsed.toFixed(
            2,
          )}ms`,
        );

        const totalElapsed = performance.now() - startPrepTime;
        console.log(
          `[PERF] Line plot total render time: ${totalElapsed.toFixed(2)}ms`,
        );

        // Handle resize
        const resizeObserver = new ResizeObserver(
          throttle(() => {
            profiler.start('lineplot-resize', { category: 'render' });
            try {
              if (uplotLinePlotRef.current && linePlotRef.current) {
                const currentHeight = linePlotHeightRef.current;
                uplotLinePlotRef.current.setSize({
                  width: linePlotRef.current.clientWidth || 800, // Fallback width
                  height: currentHeight,
                });
              }
            } finally {
              profiler.end('lineplot-resize');
            }
          }, 100), // Throttle to max 10 times per second
        );

        if (linePlotRef.current) {
          resizeObserver.observe(linePlotRef.current);
        }

        // Store cleanup function so it can be called when switching variants
        linePlotCleanupRef.current = () => {
          resizeObserver.disconnect();
          if (uplotLinePlotRef.current) {
            uplotLinePlotRef.current.destroy();
            uplotLinePlotRef.current = null;
          }
        };

        // Clear loading state after a short delay to ensure plot is rendered
        setTimeout(() => {
          setIsRenderingLinePlot(false);
        }, 100);
      } catch (error) {
        console.error("Error rendering line plot:", error);
        setIsRenderingLinePlot(false);
      }
    };

    // Call deferredRender directly since we're already in a setTimeout(0) from the effect
    // No need for additional deferral (requestIdleCallback/RAF) - that was causing 8+ second delays
    deferredRender();
  }, [
    result.id,
    selectedChannels,
    selectedVariant,
    availableVariants.length,
    result.results.scales.length,
    linePlotHeight,
  ]);

  // Variant color mapping (matches DDAAnalysis.tsx variant colors)
  const getVariantColor = (variantId: string): string => {
    const colorMap: Record<string, string> = {
      single_timeseries: "#00B0F0", // RGB(0, 176, 240) - Bright Blue
      cross_timeseries: "#33CC33", // RGB(51, 204, 51) - Bright Green
      cross_dynamical: "#ED2790", // RGB(237, 39, 144) - Magenta Pink
      dynamical_ergodicity: "#9900CC", // RGB(153, 0, 204) - Purple
      synchronization: "#CC3300", // RGB(204, 51, 0) - Orange Red
    };
    return colorMap[variantId] || "#64748b"; // Default to slate if unknown
  };

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

  const handleChannelToggle = (channel: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((ch) => ch !== channel)
        : [...prev, channel],
    );
  };

  const handlePopOut = useCallback(async () => {
    const ddaResultsData = {
      result,
      uiState: {
        selectedVariant,
        colorScheme,
        viewMode,
        selectedChannels,
        colorRange,
        autoScale,
      },
      annotations: {
        heatmap: heatmapAnnotations.annotations,
        lineplot: linePlotAnnotations.annotations,
      },
    };

    try {
      const windowId = await createWindow(
        "dda-results",
        result.id,
        ddaResultsData,
      );
      console.log("Created DDA results popout window:", windowId);
    } catch (error) {
      console.error("Failed to create popout window:", error);
    }
  }, [
    result,
    selectedVariant,
    colorScheme,
    viewMode,
    selectedChannels,
    colorRange,
    autoScale,
    createWindow,
    heatmapAnnotations.annotations,
    linePlotAnnotations.annotations,
  ]);

  // Handle resizing with drag
  const handleResizeStart = useCallback(
    (plotType: "heatmap" | "lineplot", e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(plotType);

      const startY = e.clientY;
      const startHeight =
        plotType === "heatmap" ? heatmapHeight : linePlotHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaY = moveEvent.clientY - startY;
        // Constrain height between 200px and 1200px
        const newHeight = Math.max(200, Math.min(1200, startHeight + deltaY));

        if (plotType === "heatmap") {
          setHeatmapHeight(newHeight);
          // Trigger re-render of heatmap with new height
          if (uplotHeatmapRef.current) {
            uplotHeatmapRef.current.setSize({
              width: uplotHeatmapRef.current.width,
              height: newHeight,
            });
          }
        } else {
          setLinePlotHeight(newHeight);
          // Trigger re-render of line plot with new height
          if (uplotLinePlotRef.current) {
            uplotLinePlotRef.current.setSize({
              width: uplotLinePlotRef.current.width,
              height: newHeight,
            });
          }
        }
      };

      const handleMouseUp = () => {
        setIsResizing(null);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [heatmapHeight, linePlotHeight],
  );

  const exportPlot = useCallback(
    async (format: "png" | "svg" | "pdf") => {
      try {
        let canvas: HTMLCanvasElement | null = null;
        let plotTypeForFilename: "heatmap" | "lineplot" = "heatmap";

        if (viewMode === "heatmap") {
          canvas = heatmapRef.current?.querySelector("canvas") || null;
          plotTypeForFilename = "heatmap";
        } else if (viewMode === "lineplot") {
          canvas = linePlotRef.current?.querySelector("canvas") || null;
          plotTypeForFilename = "lineplot";
        } else if (viewMode === "both") {
          const heatmapCanvas = heatmapRef.current?.querySelector("canvas");
          const linePlotCanvas = linePlotRef.current?.querySelector("canvas");

          if (heatmapCanvas && linePlotCanvas) {
            const combinedCanvas = document.createElement("canvas");
            combinedCanvas.width = Math.max(
              heatmapCanvas.width,
              linePlotCanvas.width,
            );
            combinedCanvas.height =
              heatmapCanvas.height + linePlotCanvas.height + 20;

            const ctx = combinedCanvas.getContext("2d");
            if (ctx) {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, combinedCanvas.width, combinedCanvas.height);
              ctx.drawImage(heatmapCanvas, 0, 0);
              ctx.drawImage(linePlotCanvas, 0, heatmapCanvas.height + 20);
              canvas = combinedCanvas;
              plotTypeForFilename = "heatmap";
            }
          } else {
            canvas = (heatmapCanvas || linePlotCanvas) ?? null;
            plotTypeForFilename = heatmapCanvas ? "heatmap" : "lineplot";
          }
        }

        if (!canvas) {
          console.error("No canvas found to export");
          return;
        }

        const resultName = result.name || result.id.slice(0, 8);
        const variant = availableVariants[selectedVariant];
        const variantId = variant?.variant_id || "unknown";
        const filename = getDefaultPlotFilename(
          resultName,
          variantId,
          plotTypeForFilename,
          format,
        );

        let imageData: Uint8Array;
        if (format === "png") {
          imageData = await canvasToPNG(canvas);
        } else if (format === "svg") {
          imageData = await canvasToSVG(canvas);
        } else {
          imageData = await canvasToPDF(canvas);
        }

        const savedPath = await TauriService.savePlotExportFile(
          imageData,
          format,
          filename,
        );
        if (savedPath) {
          console.log(`Plot exported successfully to: ${savedPath}`);
        }
      } catch (error) {
        console.error(`Failed to export plot as ${format}:`, error);
      }
    },
    [viewMode, selectedVariant, result, availableVariants],
  );

  const exportData = useCallback(
    async (format: "csv" | "json") => {
      try {
        let content: string;
        const variant = availableVariants[selectedVariant];
        const variantId = variant?.variant_id;

        if (format === "csv") {
          content = exportDDAToCSV(result, {
            variant: variantId,
            channels: selectedChannels,
            includeMetadata: true,
          });
        } else {
          content = exportDDAToJSON(result, {
            variant: variantId,
            channels: selectedChannels,
          });
        }

        const filename = getDefaultExportFilename(result, format, variantId);
        const savedPath = await TauriService.saveDDAExportFile(
          content,
          format,
          filename,
        );

        if (savedPath) {
          console.log(`Data exported successfully to: ${savedPath}`);
        }
      } catch (error) {
        console.error(`Failed to export data as ${format}:`, error);
      }
    },
    [result, selectedVariant, selectedChannels, availableVariants],
  );

  // Re-render plots when dependencies change - using IntersectionObserver to detect visibility
  // CRITICAL FIX: Track what we've rendered to prevent duplicate renders
  const lastRenderedHeatmapKey = useRef<string>("");
  const lastRenderedLinePlotKey = useRef<string>("");

  useEffect(() => {
    console.log(
      `[HEATMAP EFFECT] Running with: viewMode=${viewMode}, heatmapData.length=${heatmapData.length}, heatmapRef.current=${!!heatmapRef.current}, variant=${currentVariantData?.variant_id}`,
    );

    // CRITICAL: Don't check heatmapRef.current here - it may be null if DOM hasn't mounted yet
    // The IntersectionObserver will wait for the element to exist
    if ((viewMode === "heatmap" || viewMode === "both") && heatmapData.length > 0) {
      // Create a unique key for this render configuration FIRST
      // CRITICAL: Must include variant ID to distinguish between variants with same channels (e.g., DE vs SY)
      // CRITICAL: Don't include colorRange in key when autoScale is on, as it changes during processing
      // This prevents the effect from running again when colorRange updates automatically
      const variantId = currentVariantData?.variant_id || "unknown";
      const renderKey = autoScale
        ? `${result.id}_${variantId}_${selectedChannels.join(",")}_auto_${colorScheme}`
        : `${result.id}_${variantId}_${selectedChannels.join(",")}_${colorRange[0]}_${
            colorRange[1]
          }_${colorScheme}`;

      // CRITICAL: Ensure heatmapData and selectedChannels are in sync
      // If not, the data hasn't finished processing yet
      if (heatmapData.length !== selectedChannels.length) {
        console.log(
          `[HEATMAP] Data not in sync yet: heatmapData=${heatmapData.length}, selectedChannels=${selectedChannels.length}, variant=${currentVariantData?.variant_id}, lastRenderedKey="${lastRenderedHeatmapKey.current}"`,
        );

        // Clear the old plot so user doesn't see stale labels
        if (heatmapCleanupRef.current) {
          console.log("[HEATMAP] Clearing stale plot while waiting for data");
          heatmapCleanupRef.current();
          heatmapCleanupRef.current = null;
        }

        // CRITICAL FIX: Reset the render key so we'll re-render when data syncs
        // Without this, when effect re-runs with synced data, it thinks it already rendered
        lastRenderedHeatmapKey.current = "";

        return;
      }

      console.log(
        `[HEATMAP] Data IN SYNC: heatmapData=${heatmapData.length}, selectedChannels=${selectedChannels.length}, variant=${currentVariantData?.variant_id}, renderKey="${renderKey}", lastRenderedKey="${lastRenderedHeatmapKey.current}"`,
      );

      // CRITICAL: Check if DOM element is available FIRST
      // When switching tabs, the effect runs before new tab's DOM is mounted
      if (!heatmapRef.current) {
        console.log(
          "[HEATMAP] DOM element not ready, waiting for mount... renderKey:",
          renderKey,
        );
        // Reset render key so effect will retry when ref becomes available
        lastRenderedHeatmapKey.current = "";
        return;
      }

      // Check if we've already rendered this exact configuration
      if (lastRenderedHeatmapKey.current === renderKey) {
        console.log(
          "[HEATMAP] Already rendered this configuration, skipping:",
          renderKey,
        );
        // Already rendered this exact configuration, skip
        return;
      }

      console.log("[HEATMAP] DOM element ready, scheduling render:", renderKey);

      // FINAL FIX: Use single requestAnimationFrame to yield to browser for painting
      // This prevents UI freeze while keeping rendering fast and avoiding cascading delays
      const rafId = requestAnimationFrame(() => {
        if (lastRenderedHeatmapKey.current === renderKey) {
          console.log("[HEATMAP] Already rendered, skipping");
          return;
        }

        renderHeatmap();
        lastRenderedHeatmapKey.current = renderKey;
        console.log("[HEATMAP] Plot created successfully, marked as rendered:", renderKey);
      });

      return () => {
        // Cancel pending animation frame
        cancelAnimationFrame(rafId);

        // Clean up heatmap ResizeObserver when effect re-runs
        if (heatmapCleanupRef.current) {
          heatmapCleanupRef.current();
          heatmapCleanupRef.current = null;
        }
      };
    }
  }, [
    viewMode,
    heatmapData.length, // Use length since state updates are now synchronous
    autoScale ? "auto" : colorRange[0],
    autoScale ? "auto" : colorRange[1],
    autoScale,
    result.id,
    selectedChannels.join(","),
    colorScheme,
    currentVariantData?.variant_id, // Re-run when variant changes (even if channel count is same)
    heatmapDOMMounted, // Re-run when DOM element becomes available
  ]);

  useEffect(() => {
    console.log(
      `[LINEPLOT EFFECT] Running with: viewMode=${viewMode}, availableVariants.length=${availableVariants.length}, linePlotRef.current=${!!linePlotRef.current}, variant=${currentVariantData?.variant_id}`,
    );

    if (
      (viewMode === "lineplot" || viewMode === "both") &&
      availableVariants.length > 0
    ) {
      // Create a unique key for this render configuration FIRST
      const variantId = currentVariantData?.variant_id || "unknown";
      const renderKey = `${result.id}_${variantId}_${selectedChannels.join(",")}`;

      console.log(
        `[LINEPLOT] Preparing to render with renderKey="${renderKey}", lastRenderedKey="${lastRenderedLinePlotKey.current}"`,
      );

      // CRITICAL: Check if DOM element is available FIRST
      // When switching tabs, the effect runs before new tab's DOM is mounted
      if (!linePlotRef.current) {
        console.log(
          "[LINEPLOT] DOM element not ready, waiting for mount... renderKey:",
          renderKey,
        );
        // Reset render key so effect will retry when ref becomes available
        lastRenderedLinePlotKey.current = "";
        return;
      }

      // Skip if we've already rendered this exact configuration
      if (lastRenderedLinePlotKey.current === renderKey) {
        console.log("[LINEPLOT] Already rendered this configuration, skipping");
        return;
      }

      console.log("[LINEPLOT] DOM element ready, scheduling render:", renderKey);

      // FINAL FIX: Use single requestAnimationFrame to yield to browser for painting
      // This prevents UI freeze while keeping rendering fast and avoiding cascading delays
      const rafId = requestAnimationFrame(() => {
        if (lastRenderedLinePlotKey.current === renderKey) {
          console.log("[LINEPLOT] Already rendered, skipping");
          return;
        }

        renderLinePlot();
        lastRenderedLinePlotKey.current = renderKey;
        console.log("[LINEPLOT] Plot created successfully, marked as rendered:", renderKey);
      });

      return () => {
        // Cancel pending animation frame
        cancelAnimationFrame(rafId);

        // Clean up line plot ResizeObserver when effect re-runs
        if (linePlotCleanupRef.current) {
          linePlotCleanupRef.current();
          linePlotCleanupRef.current = null;
        }
      };
    }
  }, [
    viewMode,
    result.id,
    availableVariants.length,
    selectedChannels.join(","),
    currentVariantData?.variant_id, // Re-run when variant changes (even if channel count is same)
    linePlotDOMMounted, // Re-run when DOM element becomes available
  ]);

  // Broadcast state changes to popout windows
  useEffect(() => {
    const now = Date.now();
    const timeSinceLastBroadcast = now - lastBroadcastTime.current;

    const currentHeatmapCount = heatmapAnnotations.annotations.length;
    const currentLineplotCount = linePlotAnnotations.annotations.length;
    const annotationsChanged =
      currentHeatmapCount !== lastAnnotationCount.current.heatmap ||
      currentLineplotCount !== lastAnnotationCount.current.lineplot;

    // Throttle broadcasts to prevent excessive updates, UNLESS annotations just loaded
    if (timeSinceLastBroadcast < broadcastThrottleMs && !annotationsChanged) {
      return;
    }

    lastBroadcastTime.current = now;
    lastAnnotationCount.current = {
      heatmap: currentHeatmapCount,
      lineplot: currentLineplotCount,
    };

    // Only broadcast if there are actually pop-out windows of this type
    // This prevents unnecessary work when no windows are listening
    const ddaResultsData = {
      result,
      uiState: {
        selectedVariant,
        colorScheme,
        viewMode,
        selectedChannels,
        colorRange,
        autoScale,
      },
      annotations: {
        heatmap: heatmapAnnotations.annotations,
        lineplot: linePlotAnnotations.annotations,
      },
    };

    console.log("[DDA MAIN] Broadcasting data with annotations:", {
      resultId: result.id,
      variantIndex: selectedVariant,
      heatmapCount: heatmapAnnotations.annotations.length,
      lineplotCount: linePlotAnnotations.annotations.length,
      heatmapAnnotations: heatmapAnnotations.annotations,
      lineplotAnnotations: linePlotAnnotations.annotations,
      bypassedThrottle: annotationsChanged,
    });

    // Fire and forget - don't block on broadcast
    broadcastToType("dda-results", "data-update", ddaResultsData).catch(
      console.error,
    );
  }, [
    result.id,
    selectedVariant,
    colorScheme,
    viewMode,
    selectedChannels,
    colorRange,
    autoScale,
    broadcastToType,
    heatmapAnnotations.annotations,
    linePlotAnnotations.annotations,
  ]);

  return (
    <div className="flex flex-col pb-4">
      {/* Controls */}
      <Card className="flex-shrink-0">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                DDA Results Visualization
              </CardTitle>
              <CardDescription>
                Analysis from {new Date(result.created_at).toLocaleDateString()}{" "}
                • {selectedChannels.length} channels
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Database className="h-4 w-4 mr-2" />
                    Export Data
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportData("csv")}>
                    <FileText className="h-4 w-4 mr-2" />
                    Export as CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportData("json")}>
                    <FileCode className="h-4 w-4 mr-2" />
                    Export as JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Image className="h-4 w-4 mr-2" />
                    Save Plot
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportPlot("png")}>
                    <FileImage className="h-4 w-4 mr-2" />
                    Save as PNG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportPlot("svg")}>
                    <FileCode className="h-4 w-4 mr-2" />
                    Save as SVG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportPlot("pdf")}>
                    <FileText className="h-4 w-4 mr-2" />
                    Save as PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                onClick={handlePopOut}
                title="Pop out to separate window"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Pop Out
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            {/* View Mode */}
            <div className="flex items-center space-x-2">
              <Label className="text-sm">View:</Label>
              <Select
                value={viewMode}
                onValueChange={(value: ViewMode) => setViewMode(value)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">
                    <div className="flex items-center">
                      <Eye className="h-4 w-4 mr-2" />
                      Both
                    </div>
                  </SelectItem>
                  <SelectItem value="heatmap">
                    <div className="flex items-center">
                      <Grid3x3 className="h-4 w-4 mr-2" />
                      Heatmap
                    </div>
                  </SelectItem>
                  <SelectItem value="lineplot">
                    <div className="flex items-center">
                      <TrendingUp className="h-4 w-4 mr-2" />
                      Line Plot
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Color Scheme (for heatmap) */}
            {(viewMode === "heatmap" || viewMode === "both") && (
              <div className="flex items-center space-x-2">
                <Label className="text-sm">Colors:</Label>
                <Select
                  value={colorScheme}
                  onValueChange={(value: ColorScheme) => setColorScheme(value)}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viridis">Viridis</SelectItem>
                    <SelectItem value="plasma">Plasma</SelectItem>
                    <SelectItem value="inferno">Inferno</SelectItem>
                    <SelectItem value="jet">Jet</SelectItem>
                    <SelectItem value="cool">Cool</SelectItem>
                    <SelectItem value="hot">Hot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Reset button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedChannels(result.channels);
                setColorRange([0, 1]);
                setAutoScale(true);
                prevHeatmapDataRef.current.range = [0, 1];
              }}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>

            {/* Reset Zoom button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Reset zoom for both plots
                if (uplotHeatmapRef.current) {
                  uplotHeatmapRef.current.setScale("x", {
                    min: result.results.scales[0],
                    max: result.results.scales[
                      result.results.scales.length - 1
                    ],
                  });
                }
                if (uplotLinePlotRef.current) {
                  uplotLinePlotRef.current.setScale("x", {
                    min: result.results.scales[0],
                    max: result.results.scales[
                      result.results.scales.length - 1
                    ],
                  });
                }
              }}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset Zoom
            </Button>
          </div>

          {/* Channel Selection */}
          <ChannelSelector
            channels={availableChannels}
            selectedChannels={selectedChannels}
            onSelectionChange={setSelectedChannels}
            label="Channels"
            description="Select channels to display in results"
            variant="compact"
            maxHeight="max-h-32"
          />

          {/* Color Range Control (for heatmap) */}
          {(viewMode === "heatmap" || viewMode === "both") && (
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Label className="text-sm">Min:</Label>
                <input
                  type="number"
                  value={colorRange[0].toFixed(2)}
                  onChange={(e) =>
                    setColorRange([parseFloat(e.target.value), colorRange[1]])
                  }
                  disabled={autoScale}
                  className="w-20 px-2 py-1 text-sm border rounded"
                  step="0.1"
                />
              </div>
              <div className="flex items-center space-x-2">
                <Label className="text-sm">Max:</Label>
                <input
                  type="number"
                  value={colorRange[1].toFixed(2)}
                  onChange={(e) =>
                    setColorRange([colorRange[0], parseFloat(e.target.value)])
                  }
                  disabled={autoScale}
                  className="w-20 px-2 py-1 text-sm border rounded"
                  step="0.1"
                />
              </div>
              <label className="flex items-center space-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoScale}
                  onChange={(e) => setAutoScale(e.target.checked)}
                />
                <span>Auto Scale</span>
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Visualization Area - Deferred rendering to prevent UI freeze */}
      {!showPlots && (
        <Card className="mt-4">
          <CardContent className="flex items-center justify-center p-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
              <p className="text-sm text-muted-foreground">
                Initializing visualization...
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {showPlots && availableVariants.length > 1 ? (
        <Tabs
          value={selectedVariant.toString()}
          onValueChange={(v) => setSelectedVariant(parseInt(v))}
          className="mt-4 flex-1 flex flex-col gap-0"
        >
          <TabsList className="mb-0" style={{ marginBottom: 0 }}>
            {availableVariants.map((variant, index) => {
              const color = getVariantColor(variant.variant_id);
              const isActive = selectedVariant === index;
              return (
                <TabsTrigger
                  key={variant.variant_id}
                  value={index.toString()}
                  className="relative"
                  style={{
                    borderLeft: `4px solid ${color}`,
                    backgroundColor: isActive ? `${color}20` : "transparent",
                  }}
                >
                  {variant.variant_name}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Render all TabsContent (required for Tabs), but conditionally render expensive components inside */}
          {availableVariants.map((variant, index) => (
            <TabsContent
              key={variant.variant_id}
              value={index.toString()}
              className="flex flex-col"
              style={{ marginTop: 0, paddingTop: 0 }}
            >
              {/* Only render plots for the active variant to avoid running effects for invisible tabs */}
              {index === selectedVariant ? (
                <div className="space-y-4">
                  {/* Heatmap */}
                  {(viewMode === "heatmap" || viewMode === "both") && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          DDA Matrix Heatmap - {variant.variant_name}
                        </CardTitle>
                        <CardDescription>
                          Log-transformed DDA matrix values across time points
                          and channels
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div
                          className="w-full relative"
                          style={{
                            minHeight: Math.max(
                              300,
                              selectedChannels.length * 30 + 100,
                            ),
                          }}
                        >
                          {/* Show skeleton overlay while processing or rendering */}
                          {(isProcessingData || isRenderingHeatmap) && (
                            <div className="absolute inset-0 z-10">
                              <PlotLoadingSkeleton
                                height={Math.max(300, selectedChannels.length * 30 + 100)}
                                title={
                                  isProcessingData
                                    ? "Processing DDA data..."
                                    : "Rendering heatmap..."
                                }
                              />
                            </div>
                          )}
                          <div
                            ref={heatmapCallbackRef}
                            className="w-full"
                            style={{
                              minHeight: Math.max(
                                300,
                                selectedChannels.length * 30 + 100,
                              ),
                            }}
                          />

                          {/* Annotation overlay - Tabs view */}
                          {uplotHeatmapRef.current &&
                            heatmapAnnotations.annotations.length > 0 && (
                              <svg
                                className="absolute top-0 left-0"
                                style={{
                                  width: heatmapRef.current?.clientWidth || 0,
                                  height: heatmapRef.current?.clientHeight || 0,
                                  pointerEvents: "none",
                                }}
                              >
                                {heatmapAnnotations.annotations.map(
                                  (annotation) => {
                                    const scales = result.results.scales;
                                    if (!scales || scales.length === 0)
                                      return null;
                                    if (!uplotHeatmapRef.current) return null;

                                    const bbox = uplotHeatmapRef.current.bbox;
                                    if (!bbox) return null;

                                    const canvasX =
                                      uplotHeatmapRef.current.valToPos(
                                        annotation.position,
                                        "x",
                                      );
                                    // Filter out invalid values: null, undefined, Infinity, NaN
                                    if (
                                      canvasX === null ||
                                      canvasX === undefined ||
                                      !isFinite(canvasX)
                                    )
                                      return null;

                                    const xPosition = canvasX + bbox.left;
                                    const yOffset = bbox.top;
                                    const plotHeight = bbox.height;

                                    return (
                                      <AnnotationMarker
                                        key={annotation.id}
                                        annotation={annotation}
                                        plotHeight={plotHeight}
                                        xPosition={xPosition}
                                        yOffset={yOffset}
                                        onRightClick={(e, ann) => {
                                          e.preventDefault();
                                          heatmapAnnotations.openContextMenu(
                                            e.clientX,
                                            e.clientY,
                                            ann.position,
                                            ann,
                                          );
                                        }}
                                        onClick={(ann) => {
                                          const rect =
                                            heatmapRef.current?.getBoundingClientRect();
                                          if (rect) {
                                            heatmapAnnotations.handleAnnotationClick(
                                              ann,
                                              rect.left + xPosition,
                                              rect.top + 50,
                                            );
                                          }
                                        }}
                                      />
                                    );
                                  },
                                )}
                              </svg>
                            )}
                        </div>

                        {/* Heatmap Resize Handle */}
                        <div
                          className="flex items-center justify-center py-3 mt-2 cursor-ns-resize hover:bg-accent transition-colors border-t"
                          onMouseDown={(e) => handleResizeStart("heatmap", e)}
                          title="Drag to resize heatmap height"
                        >
                          <div className="w-16 h-1.5 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground/60 transition-colors" />
                        </div>

                        {/* Annotation context menu */}
                        {heatmapAnnotations.contextMenu && (
                          <AnnotationContextMenu
                            x={heatmapAnnotations.contextMenu.x}
                            y={heatmapAnnotations.contextMenu.y}
                            plotPosition={
                              heatmapAnnotations.contextMenu.plotPosition
                            }
                            existingAnnotation={
                              heatmapAnnotations.contextMenu.annotation
                            }
                            onCreateAnnotation={
                              heatmapAnnotations.handleCreateAnnotation
                            }
                            onEditAnnotation={
                              heatmapAnnotations.handleUpdateAnnotation
                            }
                            onDeleteAnnotation={
                              heatmapAnnotations.handleDeleteAnnotation
                            }
                            onClose={heatmapAnnotations.closeContextMenu}
                            availablePlots={heatmapAnnotations.availablePlots}
                            currentPlotId={heatmapAnnotations.currentPlotId}
                          />
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Line Plot */}
                  {(viewMode === "lineplot" || viewMode === "both") && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          DDA Time Series - {variant.variant_name}
                        </CardTitle>
                        <CardDescription>
                          DDA output time series - one line per channel (each
                          row of the DDA matrix)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div
                          className="w-full relative"
                          style={{ height: `${linePlotHeight}px` }}
                        >
                          {(isProcessingData || isRenderingLinePlot) && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                              <div className="flex flex-col items-center space-y-2">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">
                                  {isProcessingData
                                    ? "Processing DDA data..."
                                    : "Rendering line plot..."}
                                </p>
                              </div>
                            </div>
                          )}
                          <div
                            ref={linePlotCallbackRef}
                            className="w-full h-full overflow-hidden"
                          />

                          {/* Annotation overlay - Tabs view */}
                          {uplotLinePlotRef.current &&
                            linePlotAnnotations.annotations.length > 0 && (
                              <svg
                                className="absolute top-0 left-0"
                                style={{
                                  width: linePlotRef.current?.clientWidth || 0,
                                  height:
                                    linePlotRef.current?.clientHeight || 0,
                                  pointerEvents: "none",
                                }}
                              >
                                {linePlotAnnotations.annotations.map(
                                  (annotation) => {
                                    const scales = result.results.scales;
                                    if (!scales || scales.length === 0)
                                      return null;
                                    if (!uplotLinePlotRef.current) return null;

                                    const bbox = uplotLinePlotRef.current.bbox;
                                    if (!bbox) return null;

                                    const canvasX =
                                      uplotLinePlotRef.current.valToPos(
                                        annotation.position,
                                        "x",
                                      );
                                    // Filter out invalid values: null, undefined, Infinity, NaN
                                    if (
                                      canvasX === null ||
                                      canvasX === undefined ||
                                      !isFinite(canvasX)
                                    )
                                      return null;

                                    const xPosition = canvasX + bbox.left;
                                    const yOffset = bbox.top;
                                    const plotHeight = bbox.height;

                                    return (
                                      <AnnotationMarker
                                        key={annotation.id}
                                        annotation={annotation}
                                        plotHeight={plotHeight}
                                        xPosition={xPosition}
                                        yOffset={yOffset}
                                        onRightClick={(e, ann) => {
                                          e.preventDefault();
                                          linePlotAnnotations.openContextMenu(
                                            e.clientX,
                                            e.clientY,
                                            ann.position,
                                            ann,
                                          );
                                        }}
                                        onClick={(ann) => {
                                          const rect =
                                            linePlotRef.current?.getBoundingClientRect();
                                          if (rect) {
                                            linePlotAnnotations.handleAnnotationClick(
                                              ann,
                                              rect.left + xPosition,
                                              rect.top + 50,
                                            );
                                          }
                                        }}
                                      />
                                    );
                                  },
                                )}
                              </svg>
                            )}
                        </div>

                        {/* Line Plot Resize Handle */}
                        <div
                          className="flex items-center justify-center py-3 mt-4 cursor-ns-resize hover:bg-accent transition-colors border-t"
                          onMouseDown={(e) => handleResizeStart("lineplot", e)}
                          title="Drag to resize line plot height"
                        >
                          <div className="w-16 h-1.5 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground/60 transition-colors" />
                        </div>

                        {/* Annotation context menu */}
                        {linePlotAnnotations.contextMenu && (
                          <AnnotationContextMenu
                            x={linePlotAnnotations.contextMenu.x}
                            y={linePlotAnnotations.contextMenu.y}
                            plotPosition={
                              linePlotAnnotations.contextMenu.plotPosition
                            }
                            existingAnnotation={
                              linePlotAnnotations.contextMenu.annotation
                            }
                            onCreateAnnotation={
                              linePlotAnnotations.handleCreateAnnotation
                            }
                            onEditAnnotation={
                              linePlotAnnotations.handleUpdateAnnotation
                            }
                            onDeleteAnnotation={
                              linePlotAnnotations.handleDeleteAnnotation
                            }
                            onClose={linePlotAnnotations.closeContextMenu}
                            availablePlots={availablePlots}
                            currentPlotId={`dda:${
                              getCurrentVariantData()?.variant_id
                            }:lineplot`}
                          />
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                <div className="p-4 text-center text-muted-foreground">
                  Switch to this tab to view results
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      ) : showPlots ? (
        <div className="flex flex-col space-y-4">
          {/* Single variant view */}
          {/* Heatmap */}
          {(viewMode === "heatmap" || viewMode === "both") && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  DDA Matrix Heatmap -{" "}
                  {getCurrentVariantData()?.variant_name || "Unknown"}
                </CardTitle>
                <CardDescription>
                  Log-transformed DDA matrix values across time points and
                  channels
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="w-full relative"
                  style={{
                    minHeight: Math.max(
                      300,
                      selectedChannels.length * 30 + 100,
                    ),
                  }}
                >
                  {(isProcessingData || isRenderingHeatmap) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                      <div className="flex flex-col items-center space-y-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">
                          {isProcessingData
                            ? "Processing DDA data..."
                            : "Rendering heatmap..."}
                        </p>
                      </div>
                    </div>
                  )}
                  <div
                    ref={heatmapRef}
                    className="w-full"
                    style={{
                      minHeight: Math.max(
                        300,
                        selectedChannels.length * 30 + 100,
                      ),
                    }}
                  />

                  {/* Annotation overlay */}
                  {uplotHeatmapRef.current &&
                    heatmapAnnotations.annotations.length > 0 && (
                      <svg
                        className="absolute top-0 left-0"
                        style={{
                          width: heatmapRef.current?.clientWidth || 0,
                          height: heatmapRef.current?.clientHeight || 0,
                          pointerEvents: "none",
                        }}
                      >
                        {heatmapAnnotations.annotations.map((annotation) => {
                          const scales = result.results.scales;
                          if (!scales || scales.length === 0) return null;
                          if (!uplotHeatmapRef.current) return null;

                          const bbox = uplotHeatmapRef.current.bbox;
                          if (!bbox) return null;

                          const canvasX = uplotHeatmapRef.current.valToPos(
                            annotation.position,
                            "x",
                          );
                          if (canvasX === null || canvasX === undefined)
                            return null;

                          const xPosition = canvasX + bbox.left;
                          const yOffset = bbox.top;
                          const plotHeight = bbox.height;

                          return (
                            <AnnotationMarker
                              key={annotation.id}
                              annotation={annotation}
                              plotHeight={plotHeight}
                              xPosition={xPosition}
                              yOffset={yOffset}
                              onRightClick={(e, ann) => {
                                e.preventDefault();
                                heatmapAnnotations.openContextMenu(
                                  e.clientX,
                                  e.clientY,
                                  ann.position,
                                  ann,
                                );
                              }}
                              onClick={(ann) => {
                                const rect =
                                  heatmapRef.current?.getBoundingClientRect();
                                if (rect) {
                                  heatmapAnnotations.handleAnnotationClick(
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

                {/* Heatmap Resize Handle */}
                <div
                  className="flex items-center justify-center py-3 mt-2 cursor-ns-resize hover:bg-accent transition-colors border-t"
                  onMouseDown={(e) => handleResizeStart("heatmap", e)}
                  title="Drag to resize heatmap height"
                >
                  <div className="w-16 h-1.5 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground/60 transition-colors" />
                </div>

                {/* Annotation context menu */}
                {heatmapAnnotations.contextMenu && (
                  <AnnotationContextMenu
                    x={heatmapAnnotations.contextMenu.x}
                    y={heatmapAnnotations.contextMenu.y}
                    plotPosition={heatmapAnnotations.contextMenu.plotPosition}
                    existingAnnotation={
                      heatmapAnnotations.contextMenu.annotation
                    }
                    onCreateAnnotation={
                      heatmapAnnotations.handleCreateAnnotation
                    }
                    onEditAnnotation={heatmapAnnotations.handleUpdateAnnotation}
                    onDeleteAnnotation={
                      heatmapAnnotations.handleDeleteAnnotation
                    }
                    onClose={heatmapAnnotations.closeContextMenu}
                    availablePlots={heatmapAnnotations.availablePlots}
                    currentPlotId={heatmapAnnotations.currentPlotId}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Line Plot */}
          {(viewMode === "lineplot" || viewMode === "both") && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  DDA Time Series -{" "}
                  {getCurrentVariantData()?.variant_name || "Unknown"}
                </CardTitle>
                <CardDescription>
                  DDA output time series - one line per channel (each row of the
                  DDA matrix)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="w-full relative"
                  style={{ height: `${linePlotHeight}px` }}
                >
                  {(isProcessingData || isRenderingLinePlot) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                      <div className="flex flex-col items-center space-y-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">
                          {isProcessingData
                            ? "Processing DDA data..."
                            : "Rendering line plot..."}
                        </p>
                      </div>
                    </div>
                  )}
                  <div
                    ref={linePlotCallbackRef}
                    className="w-full h-full overflow-hidden"
                  />

                  {/* Annotation overlay */}
                  {uplotLinePlotRef.current &&
                    linePlotAnnotations.annotations.length > 0 && (
                      <svg
                        className="absolute top-0 left-0"
                        style={{
                          width: linePlotRef.current?.clientWidth || 0,
                          height: linePlotRef.current?.clientHeight || 0,
                          pointerEvents: "none",
                        }}
                      >
                        {linePlotAnnotations.annotations.map((annotation) => {
                          const scales = result.results.scales;
                          if (!scales || scales.length === 0) return null;
                          if (!uplotLinePlotRef.current) return null;

                          // Get uPlot bbox for accurate dimensions and offsets
                          const bbox = uplotLinePlotRef.current.bbox;
                          if (!bbox) return null;

                          // Use uPlot's valToPos to convert scale value to pixel position (relative to canvas)
                          const canvasX = uplotLinePlotRef.current.valToPos(
                            annotation.position,
                            "x",
                          );
                          if (canvasX === null || canvasX === undefined)
                            return null;

                          // Add bbox offsets since SVG is positioned at (0,0) but canvas starts at (bbox.left, bbox.top)
                          const xPosition = canvasX + bbox.left;
                          const yOffset = bbox.top;
                          const plotHeight = bbox.height;

                          return (
                            <AnnotationMarker
                              key={annotation.id}
                              annotation={annotation}
                              plotHeight={plotHeight}
                              xPosition={xPosition}
                              yOffset={yOffset}
                              onRightClick={(e, ann) => {
                                e.preventDefault();
                                linePlotAnnotations.openContextMenu(
                                  e.clientX,
                                  e.clientY,
                                  ann.position,
                                  ann,
                                );
                              }}
                              onClick={(ann) => {
                                const rect =
                                  linePlotRef.current?.getBoundingClientRect();
                                if (rect) {
                                  linePlotAnnotations.handleAnnotationClick(
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

                {/* Line Plot Resize Handle */}
                <div
                  className="flex items-center justify-center py-3 mt-4 cursor-ns-resize hover:bg-accent transition-colors border-t"
                  onMouseDown={(e) => handleResizeStart("lineplot", e)}
                  title="Drag to resize line plot height"
                >
                  <div className="w-16 h-1.5 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground/60 transition-colors" />
                </div>

                {/* Annotation context menu */}
                {linePlotAnnotations.contextMenu && (
                  <AnnotationContextMenu
                    x={linePlotAnnotations.contextMenu.x}
                    y={linePlotAnnotations.contextMenu.y}
                    plotPosition={linePlotAnnotations.contextMenu.plotPosition}
                    existingAnnotation={
                      linePlotAnnotations.contextMenu.annotation
                    }
                    onCreateAnnotation={
                      linePlotAnnotations.handleCreateAnnotation
                    }
                    onEditAnnotation={
                      linePlotAnnotations.handleUpdateAnnotation
                    }
                    onDeleteAnnotation={
                      linePlotAnnotations.handleDeleteAnnotation
                    }
                    onClose={linePlotAnnotations.closeContextMenu}
                    availablePlots={availablePlots}
                    currentPlotId={`dda:${
                      getCurrentVariantData()?.variant_id
                    }:lineplot`}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Export memoized version to prevent unnecessary re-renders
// Only re-render if result.id changes (new analysis loaded)
export const DDAResults = memo(DDAResultsComponent, (prevProps, nextProps) => {
  const areEqual = prevProps.result.id === nextProps.result.id;

  if (!areEqual && process.env.NODE_ENV === "development") {
    console.log("[DDARESULTS MEMO] Props changed, allowing re-render:", {
      prev: prevProps.result.id,
      next: nextProps.result.id,
    });
  }

  return areEqual; // Return true if props are equal (skip re-render)
});
