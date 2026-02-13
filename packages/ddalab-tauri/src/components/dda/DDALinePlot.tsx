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
import { clientToCSS, zoomCursorMove } from "@/lib/uplot-zoom";
import { profiler } from "@/utils/performance";
import { throttle } from "@/utils/debounce";
import { loggers } from "@/lib/logger";
import { PlotLoadingSkeleton } from "@/components/dda/PlotLoadingSkeleton";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";

const CHANNEL_COLORS = [
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

function getChannelColor(index: number): string {
  return CHANNEL_COLORS[index % CHANNEL_COLORS.length];
}

export interface DDALinePlotProps {
  variantId: string;
  ddaMatrix: Record<string, number[]>;
  selectedChannels: string[];
  scales: number[];
  height: number;
  onContextMenu?: (
    clientX: number,
    clientY: number,
    scaleValue: number,
  ) => void;
  children?: React.ReactNode;
}

export interface DDALinePlotHandle {
  resetZoom: () => void;
  getUplotInstance: () => uPlot | null;
  getContainerRef: () => HTMLDivElement | null;
}

interface PreparedLineData {
  data: uPlot.AlignedData;
  validChannels: string[];
}

/**
 * Yields to the event loop to keep UI responsive.
 * Uses requestIdleCallback if available, falls back to setTimeout.
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Async wrapper for line plot data preparation.
 * Uses multiple yield points to keep UI responsive.
 */
async function prepareLineDataAsync(
  ddaMatrix: Record<string, number[]>,
  selectedChannels: string[],
  scales: number[],
): Promise<PreparedLineData> {
  // Yield to let loading skeleton paint
  await yieldToMain();

  const data: uPlot.AlignedData = [scales];
  const validChannels: string[] = [];

  for (const channel of selectedChannels) {
    const channelData = ddaMatrix[channel];
    if (channelData && Array.isArray(channelData) && channelData.length > 0) {
      data.push(channelData);
      validChannels.push(channel);
    }
  }

  // Yield after data preparation
  await yieldToMain();

  return { data, validChannels };
}

const DDALinePlotComponent = forwardRef<DDALinePlotHandle, DDALinePlotProps>(
  function DDALinePlot(
    {
      variantId,
      ddaMatrix,
      selectedChannels,
      scales,
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

    // Memoize the matrix key - must recompute when ddaMatrix changes
    // IMPORTANT: Include actual channel keys, not just count - different variants
    // may have same channel count but different keys (e.g., ST: "Ch1" vs CT: "Ch1-Ch2")
    const matrixKey = useMemo(() => {
      const keys = ddaMatrix ? Object.keys(ddaMatrix).sort().join("|") : "";
      return `${variantId}_${keys}`;
    }, [ddaMatrix, variantId]);

    // Use TanStack Query to handle async data preparation
    // This allows the loading skeleton to render while computation runs
    const {
      data: preparedData,
      isLoading: isPreparing,
      isFetching,
    } = useQuery({
      queryKey: [
        "lineplot-data-v2",
        variantId,
        selectedChannels.join(","),
        scales.length,
        matrixKey,
      ],
      queryFn: () => prepareLineDataAsync(ddaMatrix, selectedChannels, scales),
      staleTime: Infinity,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      enabled: scales.length > 0,
    });

    const lineData = preparedData?.data ?? [scales];
    const validChannels = preparedData?.validChannels ?? [];

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

    // Render line plot
    const renderLinePlot = useCallback(() => {
      if (!containerRef.current || scales.length === 0) {
        setIsRendering(false);
        return;
      }

      if (lineData.length < 2 || validChannels.length === 0) {
        setIsRendering(false);
        return;
      }

      setIsRendering(true);

      // Clean up previous
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      try {
        if (uplotRef.current) {
          uplotRef.current.destroy();
          uplotRef.current = null;
        }

        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }

        const startPrepTime = performance.now();

        loggers.plot.debug("Line plot data prep", {
          elapsedMs: (performance.now() - startPrepTime).toFixed(2),
        });

        // Create series configuration
        const series: uPlot.Series[] = [
          {}, // x-axis
          ...validChannels.map((channel, index) => ({
            label: channel,
            stroke: getChannelColor(index),
            width: 2,
            points: { show: false },
          })),
        ];

        if (!containerRef.current) {
          setIsRendering(false);
          return;
        }

        const opts: uPlot.Options = {
          width: containerRef.current.clientWidth || 800,
          height,
          series,
          scales: {
            x: { time: false },
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
            move: zoomCursorMove(),
            drag: { x: true, y: false, uni: 50, dist: 10 },
          },
          hooks: {
            init: [
              (u) => {
                if (onContextMenu) {
                  u.over.addEventListener("contextmenu", (e: MouseEvent) => {
                    e.preventDefault();
                    const rect = u.over.getBoundingClientRect();
                    const x = clientToCSS(e.clientX, rect.left);
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
          },
        };

        if (!containerRef.current) {
          setIsRendering(false);
          return;
        }

        const startRenderTime = performance.now();
        uplotRef.current = new uPlot(opts, lineData, containerRef.current);
        const renderElapsed = performance.now() - startRenderTime;
        loggers.plot.debug("Line plot uPlot created", {
          elapsedMs: renderElapsed.toFixed(2),
        });

        // Handle resize
        const resizeObserver = new ResizeObserver(
          throttle(() => {
            profiler.start("lineplot-resize", { category: "render" });
            try {
              if (uplotRef.current && containerRef.current) {
                uplotRef.current.setSize({
                  width: containerRef.current.clientWidth || 800,
                  height: heightRef.current,
                });
              }
            } finally {
              profiler.end("lineplot-resize");
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
        }, 16); // One frame
      } catch (error) {
        loggers.plot.error("Error rendering line plot", { error });
        setIsRendering(false);
      }
    }, [lineData, validChannels, scales, height, onContextMenu]);

    // Effect to trigger rendering
    // Call renderLinePlot immediately - no extra delay needed
    // The uPlot creation is fast enough (~50-100ms) that requestIdleCallback just adds perceived lag
    useEffect(() => {
      if (!isDOMMounted || scales.length === 0 || isPreparing) return;

      const renderKey = `${variantId}_${validChannels.join(",")}_${height}`;

      if (lastRenderedKey.current === renderKey) return;

      // Render immediately - data is already prepared by TanStack Query
      renderLinePlot();
      lastRenderedKey.current = renderKey;
    }, [
      isDOMMounted,
      isPreparing,
      validChannels,
      variantId,
      scales.length,
      height,
      renderLinePlot,
    ]);

    // Show loading state when preparing data or rendering
    const showLoading = isPreparing || isFetching || isRendering;

    return (
      <ChartErrorBoundary>
        <div className="relative w-full" style={{ height }}>
          {showLoading && (
            <div className="absolute inset-0 z-10">
              <PlotLoadingSkeleton
                height={height}
                title={
                  isPreparing || isFetching
                    ? "Preparing data..."
                    : "Rendering line plot..."
                }
              />
            </div>
          )}
          <div
            ref={callbackRef}
            className="w-full h-full overflow-hidden"
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
  },
);

export const DDALinePlot = memo(DDALinePlotComponent);
