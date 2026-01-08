"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  memo,
  forwardRef,
  useImperativeHandle,
} from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
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
}

export interface DDALinePlotHandle {
  resetZoom: () => void;
  getUplotInstance: () => uPlot | null;
  getContainerRef: () => HTMLDivElement | null;
}

const DDALinePlotComponent = forwardRef<DDALinePlotHandle, DDALinePlotProps>(
  function DDALinePlot(
    { variantId, ddaMatrix, selectedChannels, scales, height, onContextMenu },
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

    // Render line plot
    const renderLinePlot = useCallback(() => {
      if (!containerRef.current || scales.length === 0) {
        setIsRendering(false);
        return;
      }

      if (!ddaMatrix) {
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

        // Prepare data
        const data: uPlot.AlignedData = [scales];
        const validChannels: string[] = [];

        for (const channel of selectedChannels) {
          const channelData = ddaMatrix[channel];
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
        loggers.plot.debug("Line plot data prep", {
          elapsedMs: prepElapsed.toFixed(2),
        });

        if (data.length < 2 || validChannels.length === 0) {
          loggers.plot.error("No valid channel data for line plot");
          setIsRendering(false);
          return;
        }

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
          },
        };

        if (!containerRef.current) {
          setIsRendering(false);
          return;
        }

        const startRenderTime = performance.now();
        uplotRef.current = new uPlot(opts, data, containerRef.current);
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
        }, 100);
      } catch (error) {
        loggers.plot.error("Error rendering line plot", { error });
        setIsRendering(false);
      }
    }, [ddaMatrix, selectedChannels, scales, height, onContextMenu]);

    // Effect to trigger rendering
    useEffect(() => {
      if (!isDOMMounted || scales.length === 0) return;

      const renderKey = `${variantId}_${selectedChannels.join(",")}_${height}`;

      if (lastRenderedKey.current === renderKey) return;

      const rafId = requestAnimationFrame(() => {
        if (lastRenderedKey.current === renderKey) return;
        renderLinePlot();
        lastRenderedKey.current = renderKey;
      });

      return () => {
        cancelAnimationFrame(rafId);
      };
    }, [
      isDOMMounted,
      selectedChannels,
      variantId,
      scales.length,
      height,
      renderLinePlot,
    ]);

    return (
      <ChartErrorBoundary>
        <div className="relative w-full" style={{ height }}>
          {isRendering && (
            <div className="absolute inset-0 z-10">
              <PlotLoadingSkeleton
                height={height}
                title="Rendering line plot..."
              />
            </div>
          )}
          <div
            ref={callbackRef}
            className="w-full h-full overflow-hidden"
            style={{ height }}
          />
        </div>
      </ChartErrorBoundary>
    );
  },
);

export const DDALinePlot = memo(DDALinePlotComponent);
