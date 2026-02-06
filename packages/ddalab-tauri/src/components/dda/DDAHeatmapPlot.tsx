"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useQuery } from "@tanstack/react-query";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { profiler } from "@/utils/performance";
import { throttle } from "@/utils/debounce";
import {
  computeHeatmapDataOffThread,
  wasmHeatmapWorker,
} from "@/services/wasmHeatmapWorkerService";
import { loggers } from "@/lib/logger";
import { PlotLoadingSkeleton } from "@/components/dda/PlotLoadingSkeleton";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import type { ColorScheme } from "@/components/dda/ColorSchemePicker";

// Stable default references to prevent unnecessary re-renders
const DEFAULT_COLOR_RANGE: [number, number] = [0, 1];

export interface DDAHeatmapPlotProps {
  variantId: string;
  ddaMatrix: Record<string, number[]>;
  selectedChannels: string[];
  scales: number[];
  colorScheme: ColorScheme;
  colorRange: [number, number];
  autoScale: boolean;
  onColorRangeChange: (range: [number, number]) => void;
  height: number;
  onContextMenu?: (
    clientX: number,
    clientY: number,
    scaleValue: number,
  ) => void;
  children?: React.ReactNode;
}

export interface DDAHeatmapPlotHandle {
  resetZoom: () => void;
  getUplotInstance: () => uPlot | null;
  getContainerRef: () => HTMLDivElement | null;
}

interface HeatmapComputeResult {
  // NOTE: heatmapData is intentionally NOT returned - structured clone of 2D array blocks main thread
  // Use numChannels for length checks instead
  computedColorRange: [number, number];
  imageBitmap: ImageBitmap | null; // Pre-rendered bitmap ready for canvas drawImage
  numChannels: number;
  numTimePoints: number;
}

/**
 * Async wrapper that delegates ALL computation to a Web Worker.
 * This ensures WASM calls run off the main thread, keeping the UI responsive.
 */
async function computeHeatmapDataAsync(
  ddaMatrix: Record<string, number[]>,
  selectedChannels: string[],
  autoScale: boolean,
  colorRange: [number, number],
  colorScheme: ColorScheme,
): Promise<HeatmapComputeResult> {
  if (!ddaMatrix || selectedChannels.length === 0) {
    return {
      computedColorRange: [0, 1] as [number, number],
      imageBitmap: null,
      numChannels: 0,
      numTimePoints: 0,
    };
  }

  const startTime = performance.now();

  // Extract channel data
  const rawChannelData: number[][] = [];
  for (const channel of selectedChannels) {
    const channelData = ddaMatrix[channel];
    if (channelData) {
      rawChannelData.push(channelData);
    }
  }

  if (rawChannelData.length === 0) {
    return {
      computedColorRange: [0, 1] as [number, number],
      imageBitmap: null,
      numChannels: 0,
      numTimePoints: 0,
    };
  }

  // Check if worker is available, fall back to main thread if not
  if (!wasmHeatmapWorker.isAvailable()) {
    loggers.plot.warn("Web Worker not available, falling back to main thread");
    // Dynamic import and use main thread fallback
    const { transformHeatmapWithStats, normalizeAndColormap } = await import(
      "@/services/wasmService"
    );

    const { data, stats } = transformHeatmapWithStats(rawChannelData, 0.001);
    const computedRange: [number, number] = autoScale
      ? [stats.scaleMin, stats.scaleMax]
      : [stats.min, stats.max];
    const effectiveRange = autoScale ? computedRange : colorRange;

    const numChannels = data.length;
    const numTimePoints = numChannels > 0 ? data[0].length : 0;
    const totalPixels = numChannels * numTimePoints;

    const flatData: number[] = [];
    for (let y = 0; y < numChannels; y++) {
      const rowData = data[y];
      if (rowData) {
        for (let x = 0; x < numTimePoints; x++) {
          flatData.push(rowData[x] || 0);
        }
      }
    }

    const rgbData = normalizeAndColormap(
      flatData,
      effectiveRange[0],
      effectiveRange[1],
      colorScheme as import("@/services/wasmService").Colormap,
    );

    const rgbaData = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const rgbIndex = i * 3;
      const rgbaIndex = i * 4;
      rgbaData[rgbaIndex] = rgbData[rgbIndex];
      rgbaData[rgbaIndex + 1] = rgbData[rgbIndex + 1];
      rgbaData[rgbaIndex + 2] = rgbData[rgbIndex + 2];
      rgbaData[rgbaIndex + 3] = 255;
    }

    // Create ImageBitmap on main thread as fallback
    let imageBitmap: ImageBitmap | null = null;
    if (totalPixels > 0) {
      const imageData = new ImageData(rgbaData, numTimePoints, numChannels);
      imageBitmap = await createImageBitmap(imageData);
    }

    return {
      computedColorRange: computedRange,
      imageBitmap,
      numChannels,
      numTimePoints,
    };
  }

  // Use the Web Worker for off-thread computation
  try {
    const result = await computeHeatmapDataOffThread(
      rawChannelData,
      0.001,
      autoScale,
      colorRange,
      colorScheme,
    );

    loggers.plot.debug("Worker heatmap complete", {
      totalMs: (performance.now() - startTime).toFixed(2),
      pixels: result.numChannels * result.numTimePoints,
    });

    return result;
  } catch (error) {
    loggers.plot.error(
      "Worker computation failed, falling back to main thread",
      { error },
    );

    // Fallback to main thread on worker error
    const { transformHeatmapWithStats, normalizeAndColormap } = await import(
      "@/services/wasmService"
    );

    const { data, stats } = transformHeatmapWithStats(rawChannelData, 0.001);
    const computedRange: [number, number] = autoScale
      ? [stats.scaleMin, stats.scaleMax]
      : [stats.min, stats.max];
    const effectiveRange = autoScale ? computedRange : colorRange;

    const numChannels = data.length;
    const numTimePoints = numChannels > 0 ? data[0].length : 0;
    const totalPixels = numChannels * numTimePoints;

    const flatData: number[] = [];
    for (let y = 0; y < numChannels; y++) {
      const rowData = data[y];
      if (rowData) {
        for (let x = 0; x < numTimePoints; x++) {
          flatData.push(rowData[x] || 0);
        }
      }
    }

    const rgbData = normalizeAndColormap(
      flatData,
      effectiveRange[0],
      effectiveRange[1],
      colorScheme as import("@/services/wasmService").Colormap,
    );

    const rgbaData = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const rgbIndex = i * 3;
      const rgbaIndex = i * 4;
      rgbaData[rgbaIndex] = rgbData[rgbIndex];
      rgbaData[rgbaIndex + 1] = rgbData[rgbIndex + 1];
      rgbaData[rgbaIndex + 2] = rgbData[rgbIndex + 2];
      rgbaData[rgbaIndex + 3] = 255;
    }

    // Create ImageBitmap on main thread as fallback
    let imageBitmap: ImageBitmap | null = null;
    if (totalPixels > 0) {
      const imageData = new ImageData(rgbaData, numTimePoints, numChannels);
      imageBitmap = await createImageBitmap(imageData);
    }

    return {
      computedColorRange: computedRange,
      imageBitmap,
      numChannels,
      numTimePoints,
    };
  }
}

const DDAHeatmapPlotComponent = forwardRef<
  DDAHeatmapPlotHandle,
  DDAHeatmapPlotProps
>(function DDAHeatmapPlot(
  {
    variantId,
    ddaMatrix,
    selectedChannels,
    scales,
    colorScheme,
    colorRange,
    autoScale,
    onColorRangeChange,
    height,
    onContextMenu,
    children,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const heightRef = useRef(height);
  const lastRenderedKey = useRef<string>("");

  const [isRendering, setIsRendering] = useState(false);
  const [isDOMMounted, setIsDOMMounted] = useState(false);

  // Use TanStack Query to handle ALL async computation including colormap
  // This allows the loading skeleton to render while computation runs
  // IMPORTANT: When autoScale is true, colorRange is an OUTPUT (computed by query),
  // so it must NOT be in the query key to avoid infinite loops.
  // When autoScale is false, colorRange is an INPUT and must be in the key.
  // Memoize the matrix key to avoid expensive Object.keys on every render
  // Must recompute when ddaMatrix changes (e.g., data loads from cache)
  const matrixKey = useMemo(() => {
    const keyCount = ddaMatrix ? Object.keys(ddaMatrix).length : 0;
    return `${variantId}_${keyCount}`;
  }, [ddaMatrix, variantId]);

  const {
    data: computedData,
    isLoading: isComputing,
    isFetching,
  } = useQuery({
    queryKey: [
      "heatmap-data-v2",
      variantId,
      selectedChannels.join(","),
      autoScale,
      // Only include colorRange in key when it's an input (autoScale=false)
      ...(autoScale ? [] : [colorRange[0], colorRange[1]]),
      colorScheme,
      matrixKey,
    ],
    queryFn: () =>
      computeHeatmapDataAsync(
        ddaMatrix,
        selectedChannels,
        autoScale,
        colorRange,
        colorScheme,
      ),
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // NOTE: heatmapData not returned from worker - use numChannels for length checks
  // Use stable references for defaults to prevent unnecessary effect triggers
  const computedColorRange =
    computedData?.computedColorRange ?? DEFAULT_COLOR_RANGE;
  const imageBitmap = computedData?.imageBitmap ?? null;
  const numChannels = computedData?.numChannels ?? 0;
  const numTimePoints = computedData?.numTimePoints ?? 0;

  // Expose methods to parent
  useImperativeHandle(
    ref,
    () => ({
      resetZoom: () => {
        if (uplotRef.current && scales.length > 0) {
          uplotRef.current.setScale("x", {
            min: scales[0],
            max: scales[scales.length - 1],
          });
        }
      },
      getUplotInstance: () => uplotRef.current,
      getContainerRef: () => containerRef.current,
    }),
    [scales],
  );

  // Callback ref to detect DOM mount/unmount
  const callbackRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    setIsDOMMounted(!!node);
    if (!node) lastRenderedKey.current = "";
  }, []);

  // Keep height ref in sync
  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  // Update color range when auto-scale computes new values
  // Only trigger when we have valid computed data and values actually differ
  useEffect(() => {
    if (!autoScale) return;
    if (!computedData) return; // Don't trigger on default values
    if (computedColorRange[0] === computedColorRange[1]) return; // Invalid range

    // Compare with small epsilon for floating point comparison
    const eps = 1e-10;
    const minDiff = Math.abs(computedColorRange[0] - colorRange[0]);
    const maxDiff = Math.abs(computedColorRange[1] - colorRange[1]);

    if (minDiff > eps || maxDiff > eps) {
      onColorRangeChange(computedColorRange);
    }
  }, [
    autoScale,
    computedData,
    computedColorRange,
    colorRange,
    onColorRangeChange,
  ]);

  // Render heatmap using two-phase approach:
  // Phase 1: Immediately show ImageBitmap on a plain canvas (instant feedback)
  // Phase 2: Create uPlot in background for interactivity (zoom, pan, axes)
  const renderHeatmap = useCallback(() => {
    if (
      !containerRef.current ||
      numChannels === 0 ||
      scales.length === 0 ||
      !imageBitmap
    ) {
      setIsRendering(false);
      return;
    }

    setIsRendering(true);

    // Clean up previous
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    containerRef.current.innerHTML = "";

    profiler.start("heatmap-render", {
      channels: selectedChannels.length,
      timePoints: scales.length,
      variant: variantId,
    });

    const width = containerRef.current.clientWidth || 800;

    // PHASE 1: Immediately render ImageBitmap to a simple canvas
    // This gives instant visual feedback while uPlot initializes
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = width;
    previewCanvas.height = height;
    previewCanvas.style.width = "100%";
    previewCanvas.style.height = `${height}px`;
    const previewCtx = previewCanvas.getContext("2d");
    if (previewCtx && imageBitmap) {
      previewCtx.imageSmoothingEnabled = false;
      previewCtx.drawImage(imageBitmap, 0, 0, width, height);
    }
    containerRef.current.appendChild(previewCanvas);

    // Mark as no longer "rendering" - user can see the heatmap now
    setIsRendering(false);

    // PHASE 2: Create uPlot in background for full interactivity
    // Use requestIdleCallback to avoid blocking
    const createUPlot = () => {
      if (!containerRef.current) return;

      // Remove preview canvas
      if (previewCanvas.parentNode) {
        previewCanvas.remove();
      }

      try {
        const plotData: uPlot.AlignedData = [
          scales,
          new Array(scales.length).fill(0),
        ];

        const opts: uPlot.Options = {
          width,
          height,
          scales: {
            x: {
              time: false,
              range: [scales[0], scales[scales.length - 1]],
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
              splits: () => {
                const splits = [];
                for (let i = 0; i < selectedChannels.length; i++) {
                  splits.push(i);
                }
                return splits;
              },
              values: (_u, ticks) =>
                ticks.map((tick) => {
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
          legend: { show: false },
          cursor: {
            lock: false,
            drag: { x: true, y: false, uni: 50, dist: 10 },
          },
          hooks: {
            init: [
              (u) => {
                if (onContextMenu) {
                  u.over.addEventListener("contextmenu", (e: MouseEvent) => {
                    e.preventDefault();
                    const rect = u.over.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const scaleValue = u.posToVal(x, "x");
                    onContextMenu(e.clientX, e.clientY, scaleValue);
                  });
                }
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
                // ULTRA-FAST draw hook using pre-rendered ImageBitmap from Web Worker
                // ImageBitmap is created off-thread and transferred with zero-copy
                const renderStartTime = performance.now();
                const ctx = u.ctx;
                const {
                  left,
                  top,
                  width: plotWidth,
                  height: plotHeight,
                } = u.bbox;

                if (plotWidth <= 0 || plotHeight <= 0) return;
                if (!imageBitmap) return;

                ctx.save();
                ctx.beginPath();
                ctx.rect(left, top, plotWidth, plotHeight);
                ctx.clip();

                // Draw ImageBitmap directly - this is instant!
                // ImageBitmap is a GPU-backed texture, drawImage is hardware accelerated
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(imageBitmap, left, top, plotWidth, plotHeight);

                loggers.plot.debug("Heatmap ImageBitmap blit", {
                  elapsedMs: (performance.now() - renderStartTime).toFixed(2),
                  pixels: numChannels * numTimePoints,
                  dataSize: `${numTimePoints}x${numChannels}`,
                  plotSize: `${Math.round(plotWidth)}x${Math.round(plotHeight)}`,
                });

                ctx.restore();
              },
            ],
          },
        };

        if (!containerRef.current) return;

        uplotRef.current = new uPlot(opts, plotData, containerRef.current);

        const resizeObserver = new ResizeObserver(
          throttle(() => {
            profiler.start("heatmap-resize", { category: "render" });
            try {
              if (uplotRef.current && containerRef.current) {
                const newWidth = containerRef.current.clientWidth || 800;
                uplotRef.current.setSize({
                  width: newWidth,
                  height: heightRef.current,
                });
                uplotRef.current.redraw();
              }
            } finally {
              profiler.end("heatmap-resize");
            }
          }, 100),
        );

        if (containerRef.current) {
          resizeObserver.observe(containerRef.current);
        }

        cleanupRef.current = () => {
          resizeObserver.disconnect();
          if (uplotRef.current) {
            uplotRef.current.destroy();
            uplotRef.current = null;
          }
        };

        profiler.end("heatmap-render");
      } catch (error) {
        loggers.plot.error("Error rendering heatmap", { error });
        profiler.end("heatmap-render");
      }
    };

    // Schedule uPlot creation using requestIdleCallback for non-blocking behavior
    let idleId: number | NodeJS.Timeout;
    if (typeof requestIdleCallback !== "undefined") {
      idleId = requestIdleCallback(createUPlot, { timeout: 200 });
    } else {
      idleId = setTimeout(createUPlot, 50);
    }

    // Store cancel function for the idle callback
    // Note: createUPlot will overwrite cleanupRef.current when it runs
    cleanupRef.current = () => {
      if (
        typeof cancelIdleCallback !== "undefined" &&
        typeof idleId === "number"
      ) {
        cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId as NodeJS.Timeout);
      }
    };
  }, [
    selectedChannels,
    scales,
    imageBitmap,
    numChannels,
    numTimePoints,
    height,
    variantId,
    onContextMenu,
  ]);

  // Effect to trigger rendering when dependencies change
  // IMPORTANT: Call renderHeatmap IMMEDIATELY (not via requestIdleCallback) to show preview canvas instantly
  // The deferred uPlot creation happens inside renderHeatmap via requestIdleCallback
  useEffect(() => {
    if (numChannels === 0 || !isDOMMounted || isComputing) return;
    if (!imageBitmap) return;

    if (numChannels !== selectedChannels.length) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      lastRenderedKey.current = "";
      return;
    }

    // Use imageBitmap identity as part of the key (width*height as proxy)
    const bitmapKey = imageBitmap
      ? `${imageBitmap.width}x${imageBitmap.height}`
      : "none";
    const renderKey = `${variantId}_${selectedChannels.join(",")}_${colorRange[0]}_${colorRange[1]}_${colorScheme}_${bitmapKey}`;

    if (lastRenderedKey.current === renderKey) return;

    // Call renderHeatmap immediately - it will show preview canvas instantly
    // and defer the heavy uPlot creation via requestIdleCallback internally
    renderHeatmap();
    lastRenderedKey.current = renderKey;
  }, [
    numChannels,
    isDOMMounted,
    isComputing,
    colorRange,
    colorScheme,
    selectedChannels,
    variantId,
    imageBitmap,
    renderHeatmap,
  ]);

  // Show loading state when computing or rendering
  const showLoading = isComputing || isFetching || isRendering;

  return (
    <ChartErrorBoundary>
      <div className="relative w-full" style={{ height }}>
        {showLoading && (
          <div className="absolute inset-0 z-10">
            <PlotLoadingSkeleton
              height={height}
              title={
                isComputing || isFetching
                  ? "Computing heatmap..."
                  : "Rendering heatmap..."
              }
            />
          </div>
        )}
        <div
          ref={callbackRef}
          className="w-full"
          style={{
            height,
            opacity: showLoading ? 0.3 : 1,
            transition: "opacity 150ms",
          }}
        />
        {children}
      </div>
    </ChartErrorBoundary>
  );
});

export const DDAHeatmapPlot = memo(DDAHeatmapPlotComponent);
