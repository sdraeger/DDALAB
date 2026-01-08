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
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { profiler } from "@/utils/performance";
import { throttle } from "@/utils/debounce";
import {
  transformHeatmapWithStats,
  normalizeAndColormap,
  type Colormap,
} from "@/services/wasmService";
import { loggers } from "@/lib/logger";
import { PlotLoadingSkeleton } from "@/components/dda/PlotLoadingSkeleton";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import type { ColorScheme } from "@/components/dda/ColorSchemePicker";

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
}

export interface DDAHeatmapPlotHandle {
  resetZoom: () => void;
  getUplotInstance: () => uPlot | null;
  getContainerRef: () => HTMLDivElement | null;
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

  // Process heatmap data using WASM
  const { heatmapData, computedColorRange } = useMemo(() => {
    if (!ddaMatrix || selectedChannels.length === 0) {
      return {
        heatmapData: [],
        computedColorRange: [0, 1] as [number, number],
      };
    }

    const startTime = performance.now();

    const rawChannelData: number[][] = [];
    for (const channel of selectedChannels) {
      const channelData = ddaMatrix[channel];
      if (channelData) {
        rawChannelData.push(channelData);
      }
    }

    if (rawChannelData.length === 0) {
      return {
        heatmapData: [],
        computedColorRange: [0, 1] as [number, number],
      };
    }

    const { data, stats } = transformHeatmapWithStats(rawChannelData, 0.001);

    const elapsed = performance.now() - startTime;
    loggers.plot.debug("WASM heatmap transform", {
      elapsedMs: elapsed.toFixed(2),
      channels: data.length,
    });

    const range: [number, number] = autoScale
      ? [stats.scaleMin, stats.scaleMax]
      : [stats.min, stats.max];

    return { heatmapData: data, computedColorRange: range };
  }, [ddaMatrix, selectedChannels, autoScale]);

  // Update color range when auto-scale computes new values
  useEffect(() => {
    if (
      autoScale &&
      computedColorRange[0] !== computedColorRange[1] &&
      (computedColorRange[0] !== colorRange[0] ||
        computedColorRange[1] !== colorRange[1])
    ) {
      onColorRangeChange(computedColorRange);
    }
  }, [autoScale, computedColorRange, colorRange, onColorRangeChange]);

  // Render heatmap
  const renderHeatmap = useCallback(() => {
    if (
      !containerRef.current ||
      heatmapData.length === 0 ||
      scales.length === 0
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

    try {
      const width = containerRef.current.clientWidth || 800;
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

              const cellWidth = plotWidth / scales.length;
              const cellHeight = plotHeight / selectedChannels.length;

              // Flatten for WASM colormap
              const flatData: number[] = [];
              for (let y = 0; y < selectedChannels.length; y++) {
                const rowData = heatmapData[y];
                if (rowData) {
                  for (let x = 0; x < scales.length; x++) {
                    flatData.push(rowData[x] || 0);
                  }
                } else {
                  for (let x = 0; x < scales.length; x++) {
                    flatData.push(0);
                  }
                }
              }

              const rgbData = normalizeAndColormap(
                flatData,
                colorRange[0],
                colorRange[1],
                colorScheme as Colormap,
              );

              let rgbIndex = 0;
              for (let y = 0; y < selectedChannels.length; y++) {
                const yPos = top + y * cellHeight;
                for (let x = 0; x < scales.length; x++) {
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

              loggers.plot.debug("Heatmap render (WASM)", {
                elapsedMs: (performance.now() - renderStartTime).toFixed(2),
                cells: flatData.length,
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

      setTimeout(() => {
        setIsRendering(false);
        profiler.end("heatmap-render");
      }, 50);
    } catch (error) {
      loggers.plot.error("Error rendering heatmap", { error });
      setIsRendering(false);
      profiler.end("heatmap-render");
    }
  }, [
    heatmapData,
    selectedChannels,
    scales,
    colorRange,
    colorScheme,
    height,
    variantId,
    onContextMenu,
  ]);

  // Effect to trigger rendering when dependencies change
  useEffect(() => {
    if (heatmapData.length === 0 || !isDOMMounted) return;

    if (heatmapData.length !== selectedChannels.length) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      lastRenderedKey.current = "";
      return;
    }

    const renderKey = autoScale
      ? `${variantId}_${selectedChannels.join(",")}_auto_${colorScheme}`
      : `${variantId}_${selectedChannels.join(",")}_${colorRange[0]}_${colorRange[1]}_${colorScheme}`;

    if (lastRenderedKey.current === renderKey) return;

    const rafId = requestAnimationFrame(() => {
      if (lastRenderedKey.current === renderKey) return;
      renderHeatmap();
      lastRenderedKey.current = renderKey;
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [
    heatmapData.length,
    isDOMMounted,
    autoScale,
    colorRange,
    colorScheme,
    selectedChannels,
    variantId,
    renderHeatmap,
  ]);

  return (
    <ChartErrorBoundary>
      <div className="relative w-full" style={{ height }}>
        {isRendering && (
          <div className="absolute inset-0 z-10">
            <PlotLoadingSkeleton height={height} title="Rendering heatmap..." />
          </div>
        )}
        <div ref={callbackRef} className="w-full" style={{ height }} />
      </div>
    </ChartErrorBoundary>
  );
});

export const DDAHeatmapPlot = memo(DDAHeatmapPlotComponent);
