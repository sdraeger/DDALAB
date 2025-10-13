"use client";

import { useEffect, useRef, memo } from "react";
import { ChunkData } from "@/types/api";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface OverviewPlotProps {
  overviewData: ChunkData | null;
  currentTime: number;
  timeWindow: number;
  duration: number;
  onSeek: (time: number) => void;
  loading?: boolean;
}

function OverviewPlotComponent({
  overviewData,
  currentTime,
  timeWindow,
  duration,
  onSeek,
  loading = false,
}: OverviewPlotProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const onSeekRef = useRef(onSeek);
  const currentTimeRef = useRef(currentTime);
  const timeWindowRef = useRef(timeWindow);

  // Keep refs up to date
  useEffect(() => {
    onSeekRef.current = onSeek;
    currentTimeRef.current = currentTime;
    timeWindowRef.current = timeWindow;
  }, [onSeek, currentTime, timeWindow]);

  // Render overview plot
  useEffect(() => {
    if (!plotRef.current || !overviewData || !overviewData.data || overviewData.data.length === 0 || duration <= 0) {
      return;
    }

    const container = plotRef.current;

    // Calculate time array for overview (spans entire file duration)
    const numPoints = overviewData.data[0]?.length || 0;
    const timeData = Array.from({ length: numPoints }, (_, i) => (i / numPoints) * duration);

    // Stack channels with small offset for visibility
    const channelOffset = 10; // Small offset since this is just overview
    const processedData = overviewData.data.map((channelData, channelIndex) => {
      return channelData.map((value) => value + channelIndex * channelOffset);
    });

    const data: uPlot.AlignedData = [timeData, ...processedData];

    // Create series config
    const series: uPlot.Series[] = [
      {}, // time axis
      ...overviewData.channels.map((channelName, idx) => ({
        label: channelName,
        stroke: getChannelColor(idx),
        width: 0.5, // Thin lines for overview
        points: { show: false },
        show: true,
      })),
    ];

    const opts: uPlot.Options = {
      width: container.clientWidth,
      height: 100, // Compact height for overview
      series,
      scales: {
        x: {
          time: false,
        },
      },
      axes: [
        {
          label: "",
          size: 40,
          values: (u, vals) => vals.map((v) => v.toFixed(0) + "s"),
        },
        {
          label: "",
          size: 0, // Hide Y axis
          show: false,
        },
      ],
      legend: {
        show: false, // No legend in overview
      },
      cursor: {
        show: true,
        x: true,
        y: false,
        lock: false,
        drag: {
          x: false, // No dragging in overview - click to seek
          y: false,
        },
      },
      hooks: {
        init: [
          (u) => {
            // Add click handler to the canvas overlay
            const canvas = u.root.querySelector(".u-over");
            if (canvas) {
              canvas.addEventListener("click", (e: Event) => {
                const mouseEvent = e as MouseEvent;
                const rect = canvas.getBoundingClientRect();
                const x = mouseEvent.clientX - rect.left;

                // Convert pixel position to time
                const timeValue = u.posToVal(x, "x");

                // Seek to clicked position (center the view around clicked time)
                const seekTime = Math.max(
                  0,
                  Math.min(timeValue - timeWindow / 2, duration - timeWindow)
                );

                onSeekRef.current(seekTime);
              });
            }
          },
        ],
      },
      plugins: [
        // Plugin to draw current position indicator
        {
          hooks: {
            draw: [
              (u) => {
                const ctx = u.ctx;

                // Use refs to get current values (not stale closure values)
                const currentTimeValue = currentTimeRef.current;
                const timeWindowValue = timeWindowRef.current;

                // Draw current chunk position as a highlighted region
                const startPixel = u.valToPos(currentTimeValue, "x", true);
                const endPixel = u.valToPos(currentTimeValue + timeWindowValue, "x", true);

                if (startPixel !== null && endPixel !== null) {
                  ctx.save();
                  ctx.fillStyle = "rgba(59, 130, 246, 0.2)"; // Blue highlight
                  ctx.fillRect(
                    startPixel,
                    u.bbox.top,
                    endPixel - startPixel,
                    u.bbox.height
                  );

                  // Draw border around current chunk
                  ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
                  ctx.lineWidth = 2;
                  ctx.strokeRect(
                    startPixel,
                    u.bbox.top,
                    endPixel - startPixel,
                    u.bbox.height
                  );

                  ctx.restore();
                }
              },
            ],
          },
        },
      ],
    };

    // Create or update plot
    try {
      if (uplotRef.current) {
        uplotRef.current.setData(data);
        uplotRef.current.redraw();
      } else {
        uplotRef.current = new uPlot(opts, data, container);

        // Setup resize observer
        resizeObserverRef.current = new ResizeObserver(() => {
          if (uplotRef.current && container) {
            uplotRef.current.setSize({
              width: container.clientWidth,
              height: 100,
            });
          }
        });
        resizeObserverRef.current.observe(container);
      }
    } catch (error) {
      console.error('[OverviewPlot] Error:', error);
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [overviewData, duration]); // Don't include onSeek, currentTime, or timeWindow - they trigger too many re-renders

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, []);

  // Update current position indicator when time changes (without recreating the plot)
  useEffect(() => {
    if (uplotRef.current) {
      // Just redraw to update the blue highlight box, don't recreate the whole plot
      uplotRef.current.redraw();
    }
  }, [currentTime, timeWindow]);

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

  return (
    <div className="relative w-full h-[100px] border-2 border-primary rounded-md bg-background/50">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="text-xs text-muted-foreground">Loading overview...</div>
        </div>
      )}
      {!overviewData && !loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-xs text-muted-foreground">Overview will load when file is selected...</div>
        </div>
      )}
      <div ref={plotRef} className="w-full h-full" />
      <div className="absolute bottom-1 right-2 text-[10px] text-muted-foreground pointer-events-none">
        Click to navigate • Blue region = current view
      </div>
    </div>
  );
}

// Memoize to prevent unnecessary re-renders (but allow currentTime and timeWindow to update)
export const OverviewPlot = memo(OverviewPlotComponent, (prevProps, nextProps) => {
  // Return TRUE to skip re-render, FALSE to allow re-render
  // We want to re-render when currentTime or timeWindow changes (for the blue box)
  // But skip re-render if only unrelated props changed
  const shouldSkip = (
    prevProps.overviewData === nextProps.overviewData &&
    prevProps.duration === nextProps.duration &&
    prevProps.loading === nextProps.loading &&
    prevProps.currentTime === nextProps.currentTime &&
    prevProps.timeWindow === nextProps.timeWindow
  );

  return shouldSkip;
});
