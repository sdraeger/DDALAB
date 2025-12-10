"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useAppStore } from "@/store/appStore";
import { profiler } from "@/utils/performance";
import { throttle } from "@/utils/debounce";
import { DDAResult } from "@/types/api";
import {
  transformHeatmapWithStats,
  normalizeAndColormap,
  type Colormap,
} from "@/services/wasmService";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChannelSelector } from "@/components/ChannelSelector";
import { Loader2 } from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { TauriService } from "@/services/tauriService";
import { loggers } from "@/lib/logger";
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
import { PlotInfo } from "@/types/annotations";
import { PlotLoadingSkeleton } from "@/components/dda/PlotLoadingSkeleton";
import { NetworkMotifPlot } from "@/components/dda/NetworkMotifPlot";
import { ResizeHandle } from "@/components/dda/ResizeHandle";
import { getVariantColor, VARIANT_ORDER } from "@/types/variantConfig";
import type { ViewMode } from "@/components/dda/ViewModeSelector";
import type { ColorScheme } from "@/components/dda/ColorSchemePicker";
import { toast } from "@/components/ui/toaster";
import { useSync } from "@/hooks/useSync";
import type { AccessPolicy, AccessPolicyType } from "@/types/sync";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import { ShareResultDialog } from "@/components/dda/ShareResultDialog";
import { ExportMenu } from "@/components/dda/ExportMenu";
import { ColorRangeControl } from "@/components/dda/ColorRangeControl";
import { PlotToolbar } from "@/components/dda/PlotToolbar";

interface DDAResultsProps {
  result: DDAResult;
}

// Internal component (will be wrapped with memo at export)
function DDAResultsComponent({ result }: DDAResultsProps) {
  // Progressive rendering to prevent UI freeze
  // Render controls first, defer heavy plot containers to next frame
  const [showPlots, setShowPlots] = useState(false);

  // Popout window hooks with memoization
  const { createWindow, broadcastToType } = usePopoutWindows();

  // Sync/sharing hooks
  const { shareResult, isConnected: isSyncConnected } = useSync();

  // Share dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);
  // Store share links per result.id so they persist when dialog is closed
  const sharedResultsRef = useRef<Map<string, string>>(new Map());

  // Only select sample_rate, not the entire fileManager object
  const sampleRate = useAppStore(
    (state) => state.fileManager.selectedFile?.sample_rate || 256,
  );
  const heatmapRef = useRef<HTMLDivElement>(null);
  const linePlotRef = useRef<HTMLDivElement>(null);
  // Track when heatmap DOM is mounted to trigger effect re-run
  const [heatmapDOMMounted, setHeatmapDOMMounted] = useState(false);
  const [linePlotDOMMounted, setLinePlotDOMMounted] = useState(false);

  // Track what we've rendered to prevent duplicate renders
  // These MUST be declared before the callback refs so they can be reset on unmount
  const lastRenderedHeatmapKey = useRef<string>("");
  const lastRenderedLinePlotKey = useRef<string>("");

  // Callback refs to detect when plot DOM is mounted/unmounted
  const heatmapCallbackRef = useCallback((node: HTMLDivElement | null) => {
    heatmapRef.current = node;
    setHeatmapDOMMounted(!!node);
    if (!node) lastRenderedHeatmapKey.current = "";
  }, []);

  const linePlotCallbackRef = useCallback((node: HTMLDivElement | null) => {
    linePlotRef.current = node;
    setLinePlotDOMMounted(!!node);
    if (!node) lastRenderedLinePlotKey.current = "";
  }, []);
  const uplotHeatmapRef = useRef<uPlot | null>(null);
  const uplotLinePlotRef = useRef<uPlot | null>(null);
  const lastBroadcastTime = useRef<number>(0);
  const broadcastThrottleMs = 500; // Only broadcast every 500ms max
  const lastAnnotationCount = useRef<{ heatmap: number; lineplot: number }>({
    heatmap: 0,
    lineplot: 0,
  });
  const heatmapCleanupRef = useRef<(() => void) | null>(null);
  const linePlotCleanupRef = useRef<(() => void) | null>(null);

  // SAFETY NET: Unconditional cleanup on unmount
  // This ensures cleanup runs even if conditional effects' early returns prevent cleanup
  useEffect(() => {
    return () => {
      if (heatmapCleanupRef.current) {
        heatmapCleanupRef.current();
        heatmapCleanupRef.current = null;
      }
      if (linePlotCleanupRef.current) {
        linePlotCleanupRef.current();
        linePlotCleanupRef.current = null;
      }
    };
  }, []);

  // Track current channel count for ResizeObserver callback
  const currentChannelCountRef = useRef<number>(0);

  // Helper to read persisted height
  const getPersistedHeight = (key: string, defaultValue: number) => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? parseInt(saved) : defaultValue;
    } catch {
      return defaultValue;
    }
  };

  // Plot heights - refs for ResizeObserver callbacks, state for React rendering
  const heatmapHeightRef = useRef<number>(500);
  const linePlotHeightRef = useRef<number>(400);

  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [colorScheme, setColorScheme] = useState<ColorScheme>("viridis");
  const [heatmapHeight, setHeatmapHeight] = useState(() =>
    getPersistedHeight("dda-heatmap-height", 500),
  );
  const [linePlotHeight, setLinePlotHeight] = useState(() =>
    getPersistedHeight("dda-lineplot-height", 400),
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
    } catch {
      // Ignore localStorage errors (e.g., private browsing)
    }
  }, [heatmapHeight]);

  useEffect(() => {
    linePlotHeightRef.current = linePlotHeight;
    try {
      localStorage.setItem("dda-lineplot-height", linePlotHeight.toString());
    } catch {
      // Ignore localStorage errors
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
  const [isProcessingData] = useState(false);
  const [isRenderingHeatmap, setIsRenderingHeatmap] = useState(false);
  const [isRenderingLinePlot, setIsRenderingLinePlot] = useState(false);

  // Get available variants - memoized to prevent recreation
  // CRITICAL FIX: Use result.id as dependency instead of result.results object
  // This prevents re-renders when parent passes new result object with same data
  const availableVariants = useMemo(() => {
    if (result.results.variants && result.results.variants.length > 0) {
      return [...result.results.variants].sort((a, b) => {
        const orderA = VARIANT_ORDER[a.variant_id] ?? 99;
        const orderB = VARIANT_ORDER[b.variant_id] ?? 99;
        return orderA - orderB;
      });
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

  // Safe scales array - derives from dda_matrix if scales is missing from stored results
  const safeScales = useMemo((): number[] => {
    // Use existing scales if available
    const originalScales = result.results?.scales;
    if (
      originalScales &&
      Array.isArray(originalScales) &&
      originalScales.length > 0
    ) {
      return originalScales;
    }

    // Derive scales from dda_matrix data if available
    const firstVariant = availableVariants[0];
    if (firstVariant?.dda_matrix) {
      const firstChannel = Object.values(firstVariant.dda_matrix)[0];
      if (Array.isArray(firstChannel) && firstChannel.length > 0) {
        return Array.from({ length: firstChannel.length }, (_, i) => i);
      }
    }

    return [];
  }, [result.results?.scales, availableVariants]);

  // Generate available plots for annotation visibility
  const availablePlots = useMemo<PlotInfo[]>(() => {
    const plots: PlotInfo[] = [
      { id: "timeseries", label: "Data Visualization" },
    ];

    // Add all DDA variant plots - use for...of for better performance
    for (const variant of availableVariants) {
      plots.push({
        id: `dda:${variant.variant_id}:heatmap`,
        label: `${variant.variant_name} - Heatmap`,
      });
      plots.push({
        id: `dda:${variant.variant_id}:lineplot`,
        label: `${variant.variant_name} - Line Plot`,
      });
    }

    return plots;
  }, [availableVariants]);

  // Memoize current variant data to prevent re-renders when variant hasn't changed
  const currentVariantData = useMemo(
    () => availableVariants[selectedVariant] || availableVariants[0],
    [availableVariants, selectedVariant],
  );

  // Get available channels from the CURRENT variant's dda_matrix
  const availableChannels = useMemo(() => {
    if (currentVariantData?.dda_matrix) {
      return Object.keys(currentVariantData.dda_matrix);
    }
    return result.channels;
  }, [currentVariantData?.dda_matrix, result.channels]);

  // Update selectedChannels when variant changes
  // Uses memoized availableChannels instead of recalculating Object.keys()
  useEffect(() => {
    if (!currentVariantData?.dda_matrix) return;

    // Reset the prevHeatmapDataRef when variant changes to force recalculation
    prevHeatmapDataRef.current.range = [0, 1];
    prevHeatmapDataRef.current.variantId = null;

    setSelectedChannels((prev) => {
      const hasChanged =
        prev.length !== availableChannels.length ||
        prev.some((ch, i) => ch !== availableChannels[i]);
      return hasChanged ? availableChannels : prev;
    });
  }, [currentVariantData?.variant_id, result.id, autoScale, availableChannels]);

  // Reset view mode to default when switching to a variant that doesn't support the current view
  // "network" view is only available for variants with network_motifs (CD-DDA)
  useEffect(() => {
    const hasNetworkMotifs = !!currentVariantData?.network_motifs;
    if (viewMode === "network" && !hasNetworkMotifs) {
      setViewMode("all");
    }
  }, [
    currentVariantData?.variant_id,
    currentVariantData?.network_motifs,
    viewMode,
  ]);

  // Clean up ResizeObservers when channels change to prevent stale callbacks
  useEffect(() => {
    return () => {
      if (heatmapCleanupRef.current) {
        heatmapCleanupRef.current();
        heatmapCleanupRef.current = null;
      }
      if (linePlotCleanupRef.current) {
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

  // Memoized heatmap data processing using WASM for efficiency
  // CRITICAL FIX: Defer processing until showPlots is true to prevent UI freeze
  const { heatmapData: processedHeatmapData, colorRange: computedColorRange } =
    useMemo(() => {
      // Don't process data until plots are ready to show
      if (!showPlots) {
        return { heatmapData: [], colorRange: [0, 1] as [number, number] };
      }

      const startTime = performance.now();
      loggers.plot.debug("Starting heatmap data processing (WASM)", {
        channelCount: selectedChannels.length,
      });

      if (!currentVariantData || !currentVariantData.dda_matrix) {
        loggers.plot.debug("No variant data available");
        return { heatmapData: [], colorRange: [0, 1] as [number, number] };
      }

      const dda_matrix = currentVariantData.dda_matrix;

      // Collect raw channel data for WASM processing
      const rawChannelData: number[][] = [];
      for (const channel of selectedChannels) {
        const channelData = dda_matrix[channel];
        if (channelData) {
          rawChannelData.push(channelData);
        }
      }

      if (rawChannelData.length === 0) {
        loggers.plot.debug("No valid channel data found");
        return { heatmapData: [], colorRange: [0, 1] as [number, number] };
      }

      // Use WASM to transform data and compute statistics in a single pass
      const { data, stats } = transformHeatmapWithStats(rawChannelData, 0.001);

      const elapsedTransform = performance.now() - startTime;
      loggers.plot.debug("WASM transform completed", {
        elapsedMs: elapsedTransform.toFixed(2),
        channelCount: data.length,
        stats: {
          min: stats.min,
          max: stats.max,
          mean: stats.mean,
          std: stats.std,
        },
      });

      // Use auto-scale range from WASM stats (mean ± 3*std)
      const colorRangeResult: [number, number] = autoScale
        ? [stats.scaleMin, stats.scaleMax]
        : [stats.min, stats.max];

      const totalElapsed = performance.now() - startTime;
      loggers.plot.debug("Heatmap data processing completed", {
        elapsedMs: totalElapsed.toFixed(2),
      });

      return {
        heatmapData: data,
        colorRange: colorRangeResult,
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
      loggers.plot.debug("Updating heatmapData", {
        variant: currentVariantId,
        channelCount: processedHeatmapData.length,
      });
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
      loggers.plot.debug("Cleaning up previous plot before rendering new one");
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
    loggers.plot.debug("Updated currentChannelCountRef", {
      count: selectedChannels.length,
    });

    // CRITICAL: Defer heavy rendering to NEXT frame so browser can paint loading state first
    // Without this, the loading overlay never shows because we block the main thread
    const deferredRender = () => {
      // Guard against empty scales
      if (safeScales.length === 0) {
        loggers.plot.warn("No scales available, skipping render");
        setIsRenderingHeatmap(false);
        return;
      }

      profiler.start("heatmap-render", {
        channels: selectedChannels.length,
        timePoints: safeScales.length,
        variant: currentVariantData?.variant_id,
      });

      try {
        // Double-check ref is still available
        if (!heatmapRef.current) {
          profiler.end("heatmap-render");
          return;
        }

        const width = heatmapRef.current.clientWidth || 800;
        const height = heatmapHeight;
        loggers.plot.debug("Creating new heatmap", {
          channelCount: selectedChannels.length,
          height,
        });

        // Prepare data for uPlot
        const plotData: uPlot.AlignedData = [
          safeScales,
          new Array(safeScales.length).fill(0),
        ];

        const opts: uPlot.Options = {
          width,
          height,
          scales: {
            x: {
              time: false,
              range: [safeScales[0], safeScales[safeScales.length - 1]],
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
                _u,
                _axisIdx,
                _scaleMin,
                _scaleMax,
                _foundIncr,
                _foundSpace,
              ) => {
                // Generate splits at integer positions (0, 1, 2, ..., n-1) for channel centers
                const splits = [];
                for (let i = 0; i < selectedChannels.length; i++) {
                  splits.push(i);
                }
                return splits;
              },
              values: (_u, ticks) =>
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
          legend: {
            show: false, // Hide legend for heatmap as it doesn't add value
          },
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

                const cellWidth = plotWidth / safeScales.length;
                const cellHeight = plotHeight / selectedChannels.length;

                // Use WASM to pre-compute all colors in one pass
                // Flatten heatmap data for WASM processing
                const flatData: number[] = [];
                for (let y = 0; y < selectedChannels.length; y++) {
                  const rowData = heatmapData[y];
                  if (rowData) {
                    for (let x = 0; x < safeScales.length; x++) {
                      flatData.push(rowData[x] || 0);
                    }
                  } else {
                    // Fill with zeros for missing rows
                    for (let x = 0; x < safeScales.length; x++) {
                      flatData.push(0);
                    }
                  }
                }

                // Get RGB values from WASM colormap
                const rgbData = normalizeAndColormap(
                  flatData,
                  colorRange[0],
                  colorRange[1],
                  colorScheme as Colormap,
                );

                // Render using pre-computed colors
                let rgbIndex = 0;
                for (let y = 0; y < selectedChannels.length; y++) {
                  const yPos = top + y * cellHeight;

                  for (let x = 0; x < safeScales.length; x++) {
                    const r = rgbData[rgbIndex];
                    const g = rgbData[rgbIndex + 1];
                    const b = rgbData[rgbIndex + 2];
                    rgbIndex += 3;

                    ctx.fillStyle = `rgb(${r},${g},${b})`;
                    ctx.fillRect(
                      left + x * cellWidth,
                      yPos,
                      cellWidth + 1,
                      cellHeight + 1,
                    );
                  }
                }

                const renderElapsed = performance.now() - renderStartTime;
                loggers.plot.debug("Heatmap render completed (WASM colormap)", {
                  elapsedMs: renderElapsed.toFixed(2),
                  cells: flatData.length,
                });

                ctx.restore();
              },
            ],
          },
        };

        if (!heatmapRef.current) return;

        uplotHeatmapRef.current = new uPlot(opts, plotData, heatmapRef.current);

        const resizeObserver = new ResizeObserver(
          throttle(() => {
            profiler.start("heatmap-resize", { category: "render" });
            try {
              if (uplotHeatmapRef.current && heatmapRef.current) {
                const newWidth = heatmapRef.current.clientWidth || 800;
                const currentHeight = heatmapHeightRef.current;
                loggers.plot.debug("Heatmap resizing", {
                  width: newWidth,
                  height: currentHeight,
                });
                uplotHeatmapRef.current.setSize({
                  width: newWidth,
                  height: currentHeight,
                });
                uplotHeatmapRef.current.redraw();
              }
            } finally {
              profiler.end("heatmap-resize");
            }
          }, 100), // Throttle to max 10 times per second
        );

        if (heatmapRef.current) {
          resizeObserver.observe(heatmapRef.current);
        }

        // Store cleanup function so it can be called when switching variants
        heatmapCleanupRef.current = () => {
          loggers.plot.debug(
            "Disconnecting ResizeObserver and destroying plot",
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
          profiler.end("heatmap-render");
        }, 50);
      } catch (error) {
        loggers.plot.error("Error rendering heatmap", { error });
        setIsRenderingHeatmap(false);
        profiler.end("heatmap-render");
      }
    };

    // Call deferredRender directly since we're already in a setTimeout(0) from the effect
    // No need for additional deferral (requestIdleCallback/RAF) - that was causing 8+ second delays
    deferredRender();
  }, [
    heatmapData,
    selectedChannels,
    safeScales.length,
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

        // Defensive check for scales data
        if (safeScales.length === 0) {
          loggers.plot.error("Invalid scales data for line plot", {
            scales: safeScales,
            hasResults: !!result.results,
            resultsKeys: result.results ? Object.keys(result.results) : [],
            resultScales: result.results?.scales,
            variants: result.results?.variants?.length || 0,
          });
          setIsRenderingLinePlot(false);
          return;
        }

        const data: uPlot.AlignedData = [safeScales];
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
        loggers.plot.debug("Line plot data preparation completed", {
          elapsedMs: prepElapsed.toFixed(2),
        });

        // Check we have at least one data series besides x-axis
        if (data.length < 2 || validChannels.length === 0) {
          loggers.plot.error("No valid channel data for line plot", {
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
          loggers.plot.warn("Line plot ref became null during rendering");
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
          loggers.plot.warn("Line plot ref became null before creating uPlot");
          return;
        }

        const startRenderTime = performance.now();
        uplotLinePlotRef.current = new uPlot(opts, data, linePlotRef.current);
        const renderElapsed = performance.now() - startRenderTime;
        loggers.plot.debug("Line plot uPlot creation completed", {
          elapsedMs: renderElapsed.toFixed(2),
        });

        const totalElapsed = performance.now() - startPrepTime;
        loggers.plot.debug("Line plot total render time", {
          elapsedMs: totalElapsed.toFixed(2),
        });

        // Handle resize
        const resizeObserver = new ResizeObserver(
          throttle(() => {
            profiler.start("lineplot-resize", { category: "render" });
            try {
              if (uplotLinePlotRef.current && linePlotRef.current) {
                const currentHeight = linePlotHeightRef.current;
                uplotLinePlotRef.current.setSize({
                  width: linePlotRef.current.clientWidth || 800, // Fallback width
                  height: currentHeight,
                });
              }
            } finally {
              profiler.end("lineplot-resize");
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
        loggers.plot.error("Error rendering line plot", { error });
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
    safeScales.length,
    linePlotHeight,
  ]);

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
      loggers.ui.debug("Created DDA results popout window", { windowId });
    } catch (error) {
      loggers.ui.error("Failed to create popout window", { error });
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
        } else if (viewMode === "all") {
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
          loggers.export.error("No canvas found to export");
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
          loggers.export.info("Plot exported successfully", {
            savedPath,
            format,
          });
          toast.success(
            "Plot exported",
            `Saved as ${format.toUpperCase()} to ${savedPath.split("/").pop()}`,
          );
        }
      } catch (error) {
        loggers.export.error("Failed to export plot", { format, error });
        toast.error(
          "Export failed",
          `Could not export plot as ${format.toUpperCase()}`,
        );
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
          loggers.export.info("Data exported successfully", {
            savedPath,
            format,
          });
          toast.success(
            "Data exported",
            `Saved as ${format.toUpperCase()} to ${savedPath.split("/").pop()}`,
          );
        }
      } catch (error) {
        loggers.export.error("Failed to export data", { format, error });
        toast.error(
          "Export failed",
          `Could not export data as ${format.toUpperCase()}`,
        );
      }
    },
    [result, selectedVariant, selectedChannels, availableVariants],
  );

  // Open share dialog
  const openShareDialog = useCallback(() => {
    setShowShareDialog(true);
  }, []);

  // Handle share submission - called by ShareResultDialog
  const handleShare = useCallback(
    async (
      title: string,
      description: string,
      accessPolicyType: AccessPolicyType,
    ): Promise<string | null> => {
      try {
        const accessPolicy: AccessPolicy = { type: accessPolicyType };
        const link = await shareResult(
          result.id,
          title,
          description || null,
          accessPolicy,
        );
        // Store the link so it persists when dialog is closed
        sharedResultsRef.current.set(result.id, link);
        toast.success(
          "Share created",
          "Your result is now shared with colleagues",
        );
        return link;
      } catch (error) {
        loggers.api.error("Failed to share result", { error });
        toast.error(
          "Share failed",
          error instanceof Error ? error.message : "Could not share result",
        );
        return null;
      }
    },
    [shareResult, result.id],
  );

  // Re-render plots when dependencies change - using IntersectionObserver to detect visibility
  // Note: lastRenderedHeatmapKey and lastRenderedLinePlotKey are declared near the callback refs
  // so they can be reset when DOM unmounts (prevents white screen on view mode changes)

  useEffect(() => {
    loggers.plot.debug("HEATMAP EFFECT running", {
      viewMode,
      heatmapDataLength: heatmapData.length,
      heatmapRefExists: !!heatmapRef.current,
      variant: currentVariantData?.variant_id,
    });

    // CRITICAL: Don't check heatmapRef.current here - it may be null if DOM hasn't mounted yet
    // The IntersectionObserver will wait for the element to exist
    if (
      (viewMode === "heatmap" || viewMode === "all") &&
      heatmapData.length > 0
    ) {
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
        loggers.plot.debug("HEATMAP data not in sync yet", {
          heatmapDataLength: heatmapData.length,
          selectedChannelsLength: selectedChannels.length,
          variant: currentVariantData?.variant_id,
          lastRenderedKey: lastRenderedHeatmapKey.current,
        });

        // Clear the old plot so user doesn't see stale labels
        if (heatmapCleanupRef.current) {
          loggers.plot.debug(
            "HEATMAP clearing stale plot while waiting for data",
          );
          heatmapCleanupRef.current();
          heatmapCleanupRef.current = null;
        }

        // CRITICAL FIX: Reset the render key so we'll re-render when data syncs
        // Without this, when effect re-runs with synced data, it thinks it already rendered
        lastRenderedHeatmapKey.current = "";

        return;
      }

      loggers.plot.debug("HEATMAP data IN SYNC", {
        heatmapDataLength: heatmapData.length,
        selectedChannelsLength: selectedChannels.length,
        variant: currentVariantData?.variant_id,
        renderKey,
        lastRenderedKey: lastRenderedHeatmapKey.current,
      });

      // CRITICAL: Check if DOM element is available FIRST
      // When switching tabs, the effect runs before new tab's DOM is mounted
      if (!heatmapRef.current) {
        loggers.plot.debug("HEATMAP DOM element not ready, waiting for mount", {
          renderKey,
        });
        // Reset render key so effect will retry when ref becomes available
        lastRenderedHeatmapKey.current = "";
        return;
      }

      // Check if we've already rendered this exact configuration
      if (lastRenderedHeatmapKey.current === renderKey) {
        loggers.plot.debug(
          "HEATMAP already rendered this configuration, skipping",
          { renderKey },
        );
        // Already rendered this exact configuration, skip
        return;
      }

      loggers.plot.debug("HEATMAP DOM element ready, scheduling render", {
        renderKey,
      });

      // FINAL FIX: Use single requestAnimationFrame to yield to browser for painting
      // This prevents UI freeze while keeping rendering fast and avoiding cascading delays
      const rafId = requestAnimationFrame(() => {
        if (lastRenderedHeatmapKey.current === renderKey) {
          loggers.plot.debug("HEATMAP already rendered, skipping");
          return;
        }

        renderHeatmap();
        lastRenderedHeatmapKey.current = renderKey;
        loggers.plot.debug("HEATMAP plot created successfully", { renderKey });
      });

      return () => {
        // Cancel pending animation frame
        cancelAnimationFrame(rafId);

        // Clean up heatmap ResizeObserver when effect re-runs
        if (heatmapCleanupRef.current) {
          heatmapCleanupRef.current();
          heatmapCleanupRef.current = null;
          // CRITICAL: Reset render key when cleanup destroys the plot
          // This ensures we re-render when the effect runs again
          // (handles case where DOM stays mounted but plot is destroyed)
          lastRenderedHeatmapKey.current = "";
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
    loggers.plot.debug("LINEPLOT EFFECT running", {
      viewMode,
      availableVariantsLength: availableVariants.length,
      linePlotRefExists: !!linePlotRef.current,
      variant: currentVariantData?.variant_id,
    });

    if (
      (viewMode === "lineplot" || viewMode === "all") &&
      availableVariants.length > 0
    ) {
      // Create a unique key for this render configuration FIRST
      const variantId = currentVariantData?.variant_id || "unknown";
      const renderKey = `${result.id}_${variantId}_${selectedChannels.join(",")}`;

      loggers.plot.debug("LINEPLOT preparing to render", {
        renderKey,
        lastRenderedKey: lastRenderedLinePlotKey.current,
      });

      // CRITICAL: Check if DOM element is available FIRST
      // When switching tabs, the effect runs before new tab's DOM is mounted
      if (!linePlotRef.current) {
        loggers.plot.debug(
          "LINEPLOT DOM element not ready, waiting for mount",
          { renderKey },
        );
        // Reset render key so effect will retry when ref becomes available
        lastRenderedLinePlotKey.current = "";
        return;
      }

      // Skip if we've already rendered this exact configuration
      if (lastRenderedLinePlotKey.current === renderKey) {
        loggers.plot.debug(
          "LINEPLOT already rendered this configuration, skipping",
        );
        return;
      }

      loggers.plot.debug("LINEPLOT DOM element ready, scheduling render", {
        renderKey,
      });

      // FINAL FIX: Use single requestAnimationFrame to yield to browser for painting
      // This prevents UI freeze while keeping rendering fast and avoiding cascading delays
      const rafId = requestAnimationFrame(() => {
        if (lastRenderedLinePlotKey.current === renderKey) {
          loggers.plot.debug("LINEPLOT already rendered, skipping");
          return;
        }

        renderLinePlot();
        lastRenderedLinePlotKey.current = renderKey;
        loggers.plot.debug("LINEPLOT plot created successfully", { renderKey });
      });

      return () => {
        // Cancel pending animation frame
        cancelAnimationFrame(rafId);

        // Clean up line plot ResizeObserver when effect re-runs
        if (linePlotCleanupRef.current) {
          linePlotCleanupRef.current();
          linePlotCleanupRef.current = null;
          // CRITICAL: Reset render key when cleanup destroys the plot
          // This ensures we re-render when the effect runs again
          // (handles case where DOM stays mounted but plot is destroyed)
          lastRenderedLinePlotKey.current = "";
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

    loggers.dda.debug("Broadcasting data with annotations", {
      resultId: result.id,
      variantIndex: selectedVariant,
      heatmapCount: heatmapAnnotations.annotations.length,
      lineplotCount: linePlotAnnotations.annotations.length,
      bypassedThrottle: annotationsChanged,
    });

    // Fire and forget - don't block on broadcast
    broadcastToType("dda-results", ddaResultsData).catch((error) =>
      loggers.ui.error("Failed to broadcast DDA results", { error }),
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
            <ExportMenu
              onExportData={exportData}
              onExportPlot={exportPlot}
              onShare={openShareDialog}
              onPopOut={handlePopOut}
              showShare={isSyncConnected}
              showPopOut={true}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Primary Toolbar - View Controls */}
          <PlotToolbar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            colorScheme={colorScheme}
            onColorSchemeChange={setColorScheme}
            hasNetworkMotifs={!!currentVariantData?.network_motifs}
            onResetZoom={() => {
              if (uplotHeatmapRef.current && safeScales.length > 0) {
                uplotHeatmapRef.current.setScale("x", {
                  min: safeScales[0],
                  max: safeScales[safeScales.length - 1],
                });
              }
              if (uplotLinePlotRef.current && safeScales.length > 0) {
                uplotLinePlotRef.current.setScale("x", {
                  min: safeScales[0],
                  max: safeScales[safeScales.length - 1],
                });
              }
            }}
            onResetAll={() => {
              setSelectedChannels(result.channels);
              setColorRange([0, 1]);
              setAutoScale(true);
              prevHeatmapDataRef.current.range = [0, 1];
            }}
          />

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

          {/* Heatmap Color Range Control */}
          {(viewMode === "heatmap" || viewMode === "all") && (
            <ColorRangeControl
              colorRange={colorRange}
              onColorRangeChange={setColorRange}
              autoScale={autoScale}
              onAutoScaleChange={setAutoScale}
            />
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
                  {(viewMode === "heatmap" || viewMode === "all") && (
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
                            height: heatmapHeight,
                          }}
                        >
                          {/* Show skeleton overlay while processing or rendering */}
                          {(isProcessingData || isRenderingHeatmap) && (
                            <div className="absolute inset-0 z-10">
                              <PlotLoadingSkeleton
                                height={heatmapHeight}
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
                              height: heatmapHeight,
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
                                    if (safeScales.length === 0) return null;
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

                        <ResizeHandle
                          plotType="heatmap"
                          currentHeight={heatmapHeight}
                          onHeightChange={(newHeight) => {
                            setHeatmapHeight(newHeight);
                            if (uplotHeatmapRef.current) {
                              uplotHeatmapRef.current.setSize({
                                width: uplotHeatmapRef.current.width,
                                height: newHeight,
                              });
                            }
                          }}
                        />

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
                  {(viewMode === "lineplot" || viewMode === "all") && (
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
                          {/* Show skeleton overlay while processing or rendering */}
                          {(isProcessingData || isRenderingLinePlot) && (
                            <div className="absolute inset-0 z-10">
                              <PlotLoadingSkeleton
                                height={linePlotHeight}
                                title={
                                  isProcessingData
                                    ? "Processing DDA data..."
                                    : "Rendering line plot..."
                                }
                              />
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
                                    if (safeScales.length === 0) return null;
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

                        <ResizeHandle
                          plotType="lineplot"
                          currentHeight={linePlotHeight}
                          onHeightChange={(newHeight) => {
                            setLinePlotHeight(newHeight);
                            if (uplotLinePlotRef.current) {
                              uplotLinePlotRef.current.setSize({
                                width: uplotLinePlotRef.current.width,
                                height: newHeight,
                              });
                            }
                          }}
                        />

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

                  {/* Network Motifs (CD-DDA only) */}
                  {(viewMode === "network" || viewMode === "all") &&
                    variant.network_motifs && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">
                            Network Motifs - {variant.variant_name}
                          </CardTitle>
                          <CardDescription>
                            Directed network graphs showing cross-dynamical
                            relationships between channels at different delays
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <NetworkMotifPlot data={variant.network_motifs} />
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
          {(viewMode === "heatmap" || viewMode === "all") && (
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
                          if (safeScales.length === 0) return null;
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

                <ResizeHandle
                  plotType="heatmap"
                  currentHeight={heatmapHeight}
                  onHeightChange={(newHeight) => {
                    setHeatmapHeight(newHeight);
                    if (uplotHeatmapRef.current) {
                      uplotHeatmapRef.current.setSize({
                        width: uplotHeatmapRef.current.width,
                        height: newHeight,
                      });
                    }
                  }}
                />

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
          {(viewMode === "lineplot" || viewMode === "all") && (
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
                  {/* Show skeleton overlay while processing or rendering */}
                  {(isProcessingData || isRenderingLinePlot) && (
                    <div className="absolute inset-0 z-10">
                      <PlotLoadingSkeleton
                        height={linePlotHeight}
                        title={
                          isProcessingData
                            ? "Processing DDA data..."
                            : "Rendering line plot..."
                        }
                      />
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
                          if (safeScales.length === 0) return null;
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

                <ResizeHandle
                  plotType="lineplot"
                  currentHeight={linePlotHeight}
                  onHeightChange={(newHeight) => {
                    setLinePlotHeight(newHeight);
                    if (uplotLinePlotRef.current) {
                      uplotLinePlotRef.current.setSize({
                        width: uplotLinePlotRef.current.width,
                        height: newHeight,
                      });
                    }
                  }}
                />

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

          {/* Network Motifs (CD-DDA only) - Single variant view */}
          {(viewMode === "network" || viewMode === "all") &&
            getCurrentVariantData()?.network_motifs && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Network Motifs -{" "}
                    {getCurrentVariantData()?.variant_name || "Unknown"}
                  </CardTitle>
                  <CardDescription>
                    Directed network graphs showing cross-dynamical
                    relationships between channels at different delays
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <NetworkMotifPlot
                    data={getCurrentVariantData()!.network_motifs!}
                  />
                </CardContent>
              </Card>
            )}
        </div>
      ) : null}

      {/* Share Dialog */}
      <ShareResultDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        result={result}
        onShare={handleShare}
        existingShareLink={sharedResultsRef.current.get(result.id) || null}
      />
    </div>
  );
}

// Memoized version to prevent unnecessary re-renders
// Only re-render if result.id changes (new analysis loaded)
const DDAResultsMemo = memo(DDAResultsComponent, (prevProps, nextProps) => {
  return prevProps.result.id === nextProps.result.id;
});

// Export wrapped with error boundary for graceful error handling
export function DDAResults(props: DDAResultsProps) {
  return (
    <ChartErrorBoundary chartName="DDA Results" minHeight={400}>
      <DDAResultsMemo {...props} />
    </ChartErrorBoundary>
  );
}
