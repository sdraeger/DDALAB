"use client";

import { useEffect, useRef, memo, useState } from "react";
import { ChunkData } from "@/types/api";
import { PlotAnnotation } from "@/types/annotations";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface OverviewPlotProps {
  overviewData: ChunkData | null;
  currentTime: number;
  timeWindow: number;
  duration: number;
  onSeek: (time: number) => void;
  loading?: boolean;
  progress?: {
    has_cache: boolean;
    completion_percentage: number;
    is_complete: boolean;
  };
  annotations?: PlotAnnotation[];
}

function OverviewPlotComponent({
  overviewData,
  currentTime,
  timeWindow,
  duration,
  onSeek,
  loading = false,
  progress,
  annotations = [],
}: OverviewPlotProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const initObserverRef = useRef<ResizeObserver | null>(null);
  const onSeekRef = useRef(onSeek);
  const currentTimeRef = useRef(currentTime);
  const timeWindowRef = useRef(timeWindow);
  const annotationsRef = useRef<PlotAnnotation[]>(annotations);
  const lastDurationRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [containerReady, setContainerReady] = useState(false);
  const [plotCreated, setPlotCreated] = useState(false);

  // Keep refs up to date
  useEffect(() => {
    onSeekRef.current = onSeek;
    currentTimeRef.current = currentTime;
    timeWindowRef.current = timeWindow;
    annotationsRef.current = annotations;
  }, [onSeek, currentTime, timeWindow, annotations]);

  // Reset state when data changes (new file loaded)
  useEffect(() => {
    retryCountRef.current = 0;
    setContainerReady(false);
    setPlotCreated(false);
  }, [overviewData, duration]);

  // Watch for container to become ready (have valid dimensions)
  // This handles the race condition where the container isn't laid out yet
  useEffect(() => {
    if (!plotRef.current) return;

    const container = plotRef.current;

    // Check if already ready
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      setContainerReady(true);
      return;
    }

    // Set up observer to detect when container gets valid dimensions
    initObserverRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerReady(true);
          initObserverRef.current?.disconnect();
        }
      }
    });

    initObserverRef.current.observe(container);

    return () => {
      initObserverRef.current?.disconnect();
      initObserverRef.current = null;
    };
  }, []);

  // Render overview plot
  useEffect(() => {
    if (
      !plotRef.current ||
      !overviewData ||
      !overviewData.data ||
      overviewData.data.length === 0 ||
      duration <= 0
    ) {
      return;
    }

    // Validate that all channels have data (not empty arrays)
    const hasValidChannelData = overviewData.data.every(
      (channelData) => channelData && channelData.length > 0,
    );
    if (!hasValidChannelData) {
      return;
    }

    const container = plotRef.current;

    // Ensure container has been laid out with valid dimensions
    if (container.clientWidth <= 0 || container.clientHeight <= 0) {
      // Retry with exponential backoff (up to 10 times)
      if (retryCountRef.current < 10) {
        const delay = Math.min(50 * Math.pow(1.5, retryCountRef.current), 500);
        retryCountRef.current++;
        const timeoutId = setTimeout(() => {
          setRetryTrigger((prev) => prev + 1);
        }, delay);
        return () => clearTimeout(timeoutId);
      }
      return;
    }

    // Reset retry count on successful render
    retryCountRef.current = 0;

    // Check if duration changed significantly (indicates file switch)
    // If so, destroy the existing plot to force recreation with correct scale
    const durationChanged =
      lastDurationRef.current !== null &&
      Math.abs(lastDurationRef.current - duration) > 0.1;

    if (durationChanged && uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    lastDurationRef.current = duration;

    // Calculate time array for overview (spans entire file duration)
    const numPoints = overviewData.data[0]?.length || 0;
    const timeData = Array.from(
      { length: numPoints },
      (_, i) => (i / numPoints) * duration,
    );

    // Stack channels with offset and track min/max in single pass
    const channelOffset = 10;
    let yMin = Infinity;
    let yMax = -Infinity;
    const processedData = overviewData.data.map((channelData, channelIndex) => {
      const offset = channelIndex * channelOffset;
      return channelData.map((value) => {
        const v = value + offset;
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
        return v;
      });
    });
    const yPadding = (yMax - yMin) * 0.1 || 1;

    const data: uPlot.AlignedData = [timeData, ...processedData];

    const series: uPlot.Series[] = [
      {},
      ...overviewData.channels.map((channelName, idx) => ({
        label: channelName,
        stroke: getChannelColor(idx),
        width: 1,
        points: { show: false },
        show: true,
        scale: "y",
      })),
    ];

    const opts: uPlot.Options = {
      width: container.clientWidth,
      height: 100, // Compact height for overview
      series,
      scales: {
        x: {
          time: false,
          min: 0,
          max: duration,
        },
        y: {
          auto: false,
          min: yMin - yPadding,
          max: yMax + yPadding,
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
                  Math.min(timeValue - timeWindow / 2, duration - timeWindow),
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
                const endPixel = u.valToPos(
                  currentTimeValue + timeWindowValue,
                  "x",
                  true,
                );

                if (startPixel !== null && endPixel !== null) {
                  ctx.save();
                  ctx.fillStyle = "rgba(59, 130, 246, 0.2)"; // Blue highlight
                  ctx.fillRect(
                    startPixel,
                    u.bbox.top,
                    endPixel - startPixel,
                    u.bbox.height,
                  );

                  // Draw border around current chunk
                  ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
                  ctx.lineWidth = 2;
                  ctx.strokeRect(
                    startPixel,
                    u.bbox.top,
                    endPixel - startPixel,
                    u.bbox.height,
                  );

                  ctx.restore();
                }
              },
            ],
          },
        },
        // Plugin to draw annotation markers
        {
          hooks: {
            draw: [
              (u) => {
                const ctx = u.ctx;
                const currentAnnotations = annotationsRef.current;

                if (!currentAnnotations || currentAnnotations.length === 0) {
                  return;
                }

                ctx.save();

                // Draw each annotation as a vertical line
                currentAnnotations.forEach((annotation) => {
                  const pixelX = u.valToPos(annotation.position, "x", true);

                  if (pixelX !== null) {
                    // Use the annotation's color or default to red
                    const color = annotation.color || "#ef4444";

                    // Draw vertical bar
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(pixelX, u.bbox.top);
                    ctx.lineTo(pixelX, u.bbox.top + u.bbox.height);
                    ctx.stroke();
                  }
                });

                ctx.restore();
              },
            ],
          },
        },
      ],
    };

    // Create or update plot
    try {
      // Check if existing uPlot instance is still valid (its root element is in the DOM)
      // This handles the case where the component was unmounted and remounted (tab switch)
      const isExistingPlotValid =
        uplotRef.current &&
        uplotRef.current.root &&
        document.body.contains(uplotRef.current.root);

      if (isExistingPlotValid) {
        // Verify the plot's canvas is still properly sized
        const existingCanvas = uplotRef.current!.root?.querySelector("canvas");
        const canvasOk = existingCanvas && existingCanvas.width > 300;

        if (canvasOk) {
          uplotRef.current!.setData(data);
          uplotRef.current!.redraw();
        } else {
          // Canvas got corrupted, force recreation
          uplotRef.current!.destroy();
          uplotRef.current = null;
        }
      }

      // Create new plot if needed
      if (!uplotRef.current) {
        // Clean up any stale DOM content
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }

        // Get actual dimensions - use getBoundingClientRect for more accurate values
        const rect = container.getBoundingClientRect();
        const width = Math.max(rect.width, container.clientWidth);

        // If width is still 0, defer creation
        if (width <= 0) {
          requestAnimationFrame(() => setRetryTrigger((p) => p + 1));
          return;
        }

        // Update opts with accurate width
        opts.width = width;

        // Create the plot - uPlot will size canvases based on opts.width/height
        uplotRef.current = new uPlot(opts, data, container);

        // Check if canvas was properly created
        const canvas = uplotRef.current.root?.querySelector("canvas");

        // If canvas has wrong dimensions, force a setSize after a frame
        if (canvas && canvas.width <= 300) {
          requestAnimationFrame(() => {
            if (uplotRef.current && container) {
              const w =
                container.getBoundingClientRect().width ||
                container.clientWidth;
              if (w > 0) {
                uplotRef.current.setSize({ width: w, height: 100 });
                uplotRef.current.redraw();
              }
            }
          });
        }

        setPlotCreated(true);

        // Setup resize observer for responsive sizing
        if (resizeObserverRef.current) {
          resizeObserverRef.current.disconnect();
        }
        resizeObserverRef.current = new ResizeObserver((entries) => {
          if (uplotRef.current && container) {
            const entry = entries[0];
            if (entry && entry.contentRect.width > 0) {
              uplotRef.current.setSize({
                width: entry.contentRect.width,
                height: 100,
              });
            }
          }
        });
        resizeObserverRef.current.observe(container);
      }
    } catch (error) {
      console.error("[OverviewPlot] Error:", error);
      uplotRef.current = null;
      setPlotCreated(false);
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [overviewData, duration, retryTrigger, containerReady]); // Include retryTrigger and containerReady to handle container layout delays

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, []);

  // Update current position indicator and annotations when they change (without recreating the plot)
  useEffect(() => {
    // Only redraw if the plot is valid and still attached to the DOM
    if (
      uplotRef.current &&
      uplotRef.current.root &&
      document.body.contains(uplotRef.current.root)
    ) {
      // Just redraw to update the blue highlight box and annotation markers, don't recreate the whole plot
      uplotRef.current.redraw();
    }
  }, [currentTime, timeWindow, annotations]);

  // Handle visibility changes (e.g., when switching tabs without unmounting)
  // This ensures the plot redraws when the tab becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        uplotRef.current &&
        plotRef.current
      ) {
        // Force size update and redraw when becoming visible
        requestAnimationFrame(() => {
          if (uplotRef.current && plotRef.current) {
            const container = plotRef.current;
            if (container.clientWidth > 0) {
              uplotRef.current.setSize({
                width: container.clientWidth,
                height: 100,
              });
              uplotRef.current.redraw();
            }
          }
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Handle in-app tab visibility (when switching between subtabs within the app)
  // Uses IntersectionObserver to detect when the component becomes visible
  useEffect(() => {
    if (!plotRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          entry &&
          entry.isIntersecting &&
          uplotRef.current &&
          plotRef.current
        ) {
          const container = plotRef.current;
          const width =
            container.getBoundingClientRect().width || container.clientWidth;

          if (width > 0) {
            // Check if canvas needs resizing
            const canvas = uplotRef.current.root?.querySelector("canvas");
            if (
              canvas &&
              (canvas.width <= 300 ||
                Math.abs(uplotRef.current.width - width) > 10)
            ) {
              uplotRef.current.setSize({ width, height: 100 });
            }
            uplotRef.current.redraw();
          }
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(plotRef.current);
    return () => observer.disconnect();
  }, [plotCreated]);

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

  // Show progress bar when loading
  const progressPercentage = progress?.completion_percentage || 0;
  const isResuming =
    progress?.has_cache && progressPercentage > 0 && progressPercentage < 100;

  // Determine status message
  const getStatusMessage = () => {
    if (!progress) return "Initializing...";
    if (isResuming) return `Resuming from ${progressPercentage.toFixed(1)}%...`;
    if (progressPercentage > 0) return "Generating overview...";
    return "Starting generation...";
  };

  // Show initializing state when we have data but plot hasn't rendered yet
  const isInitializing =
    overviewData && !plotCreated && !loading && containerReady;

  return (
    <div className="relative w-full h-[100px] border-2 border-primary rounded-md bg-background">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10 animate-in fade-in-0 duration-200">
          <div className="flex flex-col items-center gap-3 w-full px-8">
            <>
              <div className="w-full">
                <div className="flex justify-between items-center mb-1">
                  <div className="text-xs text-muted-foreground font-medium">
                    {getStatusMessage()}
                  </div>
                  <div className="text-xs font-bold text-primary">
                    {progressPercentage.toFixed(1)}%
                  </div>
                </div>
                <div className="w-full h-2 bg-secondary/50 rounded-full overflow-hidden border border-primary/20">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-300 ease-out"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Progress is saved • Safe to interrupt and resume later
              </div>
            </>
          </div>
        </div>
      )}
      {!overviewData && !loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background animate-in fade-in-0 duration-200">
          <div className="text-xs text-muted-foreground">
            Overview will load when file is selected...
          </div>
        </div>
      )}
      {isInitializing && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-10 animate-in fade-in-0 duration-200">
          <div className="text-xs text-muted-foreground animate-pulse">
            Initializing plot...
          </div>
        </div>
      )}
      <div
        ref={plotRef}
        className="w-full h-full [&_.uplot]:bg-transparent [&_.u-wrap]:bg-transparent"
      />
      <div className="absolute bottom-1 right-2 text-[10px] text-muted-foreground pointer-events-none">
        Click to navigate • Blue region = current view
      </div>
    </div>
  );
}

// Memoize to prevent unnecessary re-renders (but allow currentTime and timeWindow to update)
export const OverviewPlot = memo(
  OverviewPlotComponent,
  (prevProps, nextProps) => {
    // Return TRUE to skip re-render, FALSE to allow re-render
    // We want to re-render when currentTime, timeWindow, or annotations change
    // But skip re-render if only unrelated props changed
    const shouldSkip =
      prevProps.overviewData === nextProps.overviewData &&
      prevProps.duration === nextProps.duration &&
      prevProps.loading === nextProps.loading &&
      prevProps.currentTime === nextProps.currentTime &&
      prevProps.timeWindow === nextProps.timeWindow &&
      prevProps.progress?.completion_percentage ===
        nextProps.progress?.completion_percentage &&
      prevProps.annotations === nextProps.annotations;

    return shouldSkip;
  },
);
