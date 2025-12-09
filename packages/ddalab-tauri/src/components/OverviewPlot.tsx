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

// Generate unique ID for each component instance
let instanceCounter = 0;

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
  // Track component instance for debugging
  const instanceIdRef = useRef<number | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = ++instanceCounter;
  }

  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const initObserverRef = useRef<ResizeObserver | null>(null);
  const onSeekRef = useRef(onSeek);
  const currentTimeRef = useRef(currentTime);
  const timeWindowRef = useRef(timeWindow);
  const annotationsRef = useRef<PlotAnnotation[]>(annotations);
  const lastDurationRef = useRef<number | null>(null);
  const lastFilePathRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);
  const forceRedrawTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
    setPlotCreated(false);

    // Destroy the old plot instance when data changes to prevent stale state
    if (uplotRef.current) {
      try {
        uplotRef.current.destroy();
      } catch {
        // Ignore errors during cleanup
      }
      uplotRef.current = null;
    }
  }, [overviewData, duration]);

  // Watch for container to become ready (have valid dimensions)
  // This handles the race condition where the container isn't laid out yet
  useEffect(() => {
    if (!plotRef.current) return;

    const container = plotRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Check if already ready
    if (width > 0 && height > 0) {
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

    // Also check periodically in case resize observer doesn't fire (e.g., in popout windows)
    const checkInterval = setInterval(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        setContainerReady(true);
        clearInterval(checkInterval);
        initObserverRef.current?.disconnect();
      }
    }, 100);

    // Fallback: Force containerReady after 1 second even if dimensions seem 0
    // This handles edge cases in popout windows where layout calculations fail
    const fallbackTimeout = setTimeout(() => {
      setContainerReady(true);
    }, 1000);

    return () => {
      clearInterval(checkInterval);
      clearTimeout(fallbackTimeout);
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

    // Check if file changed - always destroy and recreate for new file
    const currentFilePath = overviewData.file_path;
    const fileChanged =
      lastFilePathRef.current !== null &&
      lastFilePathRef.current !== currentFilePath;

    // Check if duration changed significantly (indicates file switch)
    // If so, destroy the existing plot to force recreation with correct scale
    const durationChanged =
      lastDurationRef.current !== null &&
      Math.abs(lastDurationRef.current - duration) > 0.1;

    if ((durationChanged || fileChanged) && uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    lastDurationRef.current = duration;
    lastFilePathRef.current = currentFilePath;

    // The backend uses min-max decimation: data is [min1, max1, min2, max2, ...]
    // Overlay all channels on the same vertical space for better visibility
    const numChannels = overviewData.data.length;

    // Calculate per-channel min/max for individual scaling
    const channelRanges = overviewData.data.map((channelData) => {
      let min = Infinity;
      let max = -Infinity;
      for (const v of channelData) {
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (!Number.isFinite(min)) min = 0;
      if (!Number.isFinite(max)) max = 1;
      return { min, max, range: max - min || 1 };
    });

    // Extract min and max series - all channels normalized to [0, 1] range (overlaid)
    const processedMinData = overviewData.data.map(
      (channelData, channelIndex) => {
        const { min: globalMin, range } = channelRanges[channelIndex];
        const mins: number[] = [];

        for (let i = 0; i < channelData.length; i += 2) {
          const minVal = channelData[i];
          if (!Number.isFinite(minVal)) {
            mins.push(0.5);
          } else {
            // Normalize to [0, 1] - all channels share same vertical space
            const normalized = (minVal - globalMin) / range;
            mins.push(normalized);
          }
        }
        return mins;
      },
    );

    const processedMaxData = overviewData.data.map(
      (channelData, channelIndex) => {
        const { min: globalMin, range } = channelRanges[channelIndex];
        const maxs: number[] = [];

        for (let i = 1; i < channelData.length; i += 2) {
          const maxVal = channelData[i];
          if (!Number.isFinite(maxVal)) {
            maxs.push(0.5);
          } else {
            // Normalize to [0, 1] - all channels share same vertical space
            const normalized = (maxVal - globalMin) / range;
            maxs.push(normalized);
          }
        }
        return maxs;
      },
    );

    // All channels share the same [0, 1] vertical range
    const yMin = -0.05;
    const yMax = 1.05;

    // Time data needs to match the extracted series length (half of original)
    const extractedNumPoints = processedMinData[0]?.length || 0;
    const extractedTimeData = Array.from(
      { length: extractedNumPoints },
      (_, i) => (i / extractedNumPoints) * duration,
    );

    // For uPlot data, we'll pass mins - the draw hook will handle drawing bars between min and max
    const data: uPlot.AlignedData = [extractedTimeData, ...processedMinData];

    // Define colors inline to avoid any closure issues
    const channelColors = [
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

    const series: uPlot.Series[] = [
      {}, // x-axis series (time)
      ...overviewData.channels.map((channelName, idx) => ({
        label: channelName,
        stroke: channelColors[idx % channelColors.length],
        width: 1,
        points: { show: false },
        show: true,
        scale: "y",
        spanGaps: true, // Handle any gaps in data
      })),
    ];

    const opts: uPlot.Options = {
      width: container.clientWidth,
      height: 130, // Compact height for overview (includes x-axis)
      series,
      scales: {
        x: {
          time: false,
          min: 0,
          max: duration,
        },
        y: {
          auto: true, // Let uPlot auto-scale since data is already normalized
          range: [yMin, yMax], // Suggest range but allow auto adjustment
        },
      },
      axes: [
        {
          show: true,
          scale: "x",
          side: 2, // Bottom
          size: 24,
          gap: 2,
          stroke: "#666",
          grid: { show: false },
          ticks: { show: true, stroke: "#666", width: 1, size: 4 },
          values: (u, vals) =>
            vals.map((v) => {
              if (v >= 60) {
                const mins = Math.floor(v / 60);
                const secs = Math.floor(v % 60);
                return `${mins}m${secs > 0 ? secs + "s" : ""}`;
              }
              return v.toFixed(0) + "s";
            }),
          font: "bold 10px system-ui, -apple-system, sans-serif",
          space: 80,
        },
        {
          show: false,
          scale: "y",
          size: 0,
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
                const canvasWidth = rect.width;

                // Convert pixel position to time using direct calculation
                // (don't use u.posToVal which doesn't work correctly)
                const timeValue = (x / canvasWidth) * duration;

                // Seek to clicked position (center the view around clicked time)
                const seekTime = Math.max(
                  0,
                  Math.min(
                    timeValue - timeWindowRef.current / 2,
                    duration - timeWindowRef.current,
                  ),
                );

                onSeekRef.current(seekTime);
              });
            }
          },
        ],
        ready: [
          (u) => {
            // Force redraw after uPlot is fully initialized
            u.redraw();
          },
        ],
        draw: [
          (u) => {
            // Draw min-max envelope as vertical bars for each time point
            const ctx = u.ctx;
            const plotData = u.data;

            if (!ctx || !plotData || plotData.length < 2) return;

            const xData = plotData[0];
            const colors = [
              "#3b82f6",
              "#ef4444",
              "#10b981",
              "#f59e0b",
              "#8b5cf6",
              "#06b6d4",
              "#f97316",
              "#84cc16",
            ];

            const plotLeft = u.bbox.left;
            const plotTop = u.bbox.top;
            const plotWidth = u.bbox.width;
            const dprVal = window.devicePixelRatio || 1;
            // Reserve 30px at bottom for x-axis labels (increased from 25 to prevent overlap)
            const axisHeight = 30 * dprVal;
            const plotHeight = u.bbox.height - axisHeight;

            const xMinVal = 0;
            const xMaxVal = duration;
            const yMinVal = yMin;
            const yMaxVal = yMax;

            // Draw each channel's min-max envelope
            for (let s = 1; s < plotData.length; s++) {
              const minData = plotData[s]; // Min values from uPlot data
              const maxData = processedMaxData[s - 1]; // Max values from closure

              if (!minData || !maxData || minData.length === 0) continue;

              ctx.save();
              ctx.strokeStyle = colors[(s - 1) % colors.length];
              ctx.fillStyle = colors[(s - 1) % colors.length];
              ctx.globalAlpha = 0.8;
              ctx.lineWidth = 1.5;

              // Draw vertical bars from min to max at each time point
              const step = Math.max(1, Math.floor(xData.length / 2000));

              for (let i = 0; i < xData.length; i += step) {
                const xVal = xData[i];
                const yMinData = minData[i];
                const yMaxData = maxData[i];

                if (
                  xVal == null ||
                  yMinData == null ||
                  yMaxData == null ||
                  !Number.isFinite(xVal) ||
                  !Number.isFinite(yMinData) ||
                  !Number.isFinite(yMaxData)
                )
                  continue;

                const x =
                  plotLeft +
                  ((xVal - xMinVal) / (xMaxVal - xMinVal)) * plotWidth;
                const yBottom =
                  plotTop +
                  plotHeight -
                  ((yMinData - yMinVal) / (yMaxVal - yMinVal)) * plotHeight;
                const yTop =
                  plotTop +
                  plotHeight -
                  ((yMaxData - yMinVal) / (yMaxVal - yMinVal)) * plotHeight;

                if (
                  !Number.isFinite(x) ||
                  !Number.isFinite(yBottom) ||
                  !Number.isFinite(yTop)
                )
                  continue;

                // Draw vertical line from min to max
                ctx.beginPath();
                ctx.moveTo(x, yBottom);
                ctx.lineTo(x, yTop);
                ctx.stroke();
              }

              ctx.restore();
            }

            // Draw custom x-axis labels at bottom of plot area (not canvas)
            // The axis area starts at plotTop + plotHeight
            const axisTopY = plotTop + plotHeight;

            ctx.save();
            ctx.fillStyle = "#666";
            ctx.font = `${10 * dprVal}px system-ui, -apple-system, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";

            // Calculate nice tick intervals
            const targetTicks = Math.max(
              3,
              Math.floor(plotWidth / (100 * dprVal)),
            );
            const rawInterval = duration / targetTicks;
            const niceIntervals = [
              1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
            ];
            const interval =
              niceIntervals.find((i) => i >= rawInterval) || rawInterval;

            for (let t = 0; t <= duration; t += interval) {
              const x = plotLeft + (t / duration) * plotWidth;

              // Format time label
              let label: string;
              if (t >= 3600) {
                const hrs = Math.floor(t / 3600);
                const mins = Math.floor((t % 3600) / 60);
                label = mins > 0 ? `${hrs}h${mins}m` : `${hrs}h`;
              } else if (t >= 60) {
                const mins = Math.floor(t / 60);
                const secs = Math.floor(t % 60);
                label = secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
              } else {
                label = `${t}s`;
              }

              // Draw tick mark (starts at top of axis area)
              ctx.strokeStyle = "#666";
              ctx.lineWidth = dprVal;
              ctx.beginPath();
              ctx.moveTo(x, axisTopY + 2 * dprVal);
              ctx.lineTo(x, axisTopY + 6 * dprVal);
              ctx.stroke();

              // Draw label below tick
              ctx.fillText(label, x, axisTopY + 8 * dprVal);
            }

            ctx.restore();
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
                if (!ctx) return;

                // Use refs to get current values (not stale closure values)
                const currentTimeValue = currentTimeRef.current;
                const timeWindowValue = timeWindowRef.current;

                // Use direct pixel calculation (don't use u.valToPos which doesn't work)
                const plotLeft = u.bbox.left;
                const plotWidth = u.bbox.width;
                const dprVal = window.devicePixelRatio || 1;
                // Match the axis height from waveform drawing
                const axisHeightVal = 30 * dprVal;
                const plotHeightVal = u.bbox.height - axisHeightVal;

                // Calculate pixel positions using direct mapping
                const startPixel =
                  plotLeft + (currentTimeValue / duration) * plotWidth;
                const endPixel =
                  plotLeft +
                  ((currentTimeValue + timeWindowValue) / duration) * plotWidth;

                if (Number.isFinite(startPixel) && Number.isFinite(endPixel)) {
                  ctx.save();
                  ctx.fillStyle = "rgba(59, 130, 246, 0.2)"; // Blue highlight
                  ctx.fillRect(
                    startPixel,
                    u.bbox.top,
                    endPixel - startPixel,
                    plotHeightVal,
                  );

                  // Draw border around current chunk
                  ctx.strokeStyle = "rgba(59, 130, 246, 0.9)";
                  ctx.lineWidth = 1;
                  ctx.strokeRect(
                    startPixel + 0.5,
                    u.bbox.top + 0.5,
                    endPixel - startPixel - 1,
                    plotHeightVal - 1,
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
                if (!ctx) return;

                const currentAnnotations = annotationsRef.current;

                if (!currentAnnotations || currentAnnotations.length === 0) {
                  return;
                }

                const plotLeft = u.bbox.left;
                const plotWidth = u.bbox.width;
                const dprVal = window.devicePixelRatio || 1;
                // Match the axis height from waveform drawing
                const axisHeightVal = 30 * dprVal;
                const plotHeightVal = u.bbox.height - axisHeightVal;

                ctx.save();

                // Draw each annotation as a vertical line
                currentAnnotations.forEach((annotation) => {
                  // Use direct pixel calculation (don't use u.valToPos)
                  const pixelX =
                    plotLeft + (annotation.position / duration) * plotWidth;

                  if (Number.isFinite(pixelX)) {
                    // Use the annotation's color or default to red
                    const color = annotation.color || "#ef4444";

                    // Draw vertical bar
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(pixelX, u.bbox.top);
                    ctx.lineTo(pixelX, u.bbox.top + plotHeightVal);
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
      const isExistingPlotValid =
        uplotRef.current &&
        uplotRef.current.root &&
        document.body.contains(uplotRef.current.root);

      if (isExistingPlotValid) {
        // Verify the plot's canvas is still properly sized
        const existingCanvas = uplotRef.current!.root?.querySelector("canvas");
        const canvasOk = existingCanvas && existingCanvas.width > 300;

        // Check if series count matches - uPlot requires data arrays to match series count
        const plotSeriesCount = uplotRef.current!.series.length;
        const dataSeriesCount = data.length;
        const seriesMatch = plotSeriesCount === dataSeriesCount;

        if (canvasOk && seriesMatch) {
          uplotRef.current!.setData(data);
          uplotRef.current!.redraw();

          // Force delayed redraw for existing plots (helps in popout windows)
          setTimeout(() => {
            if (uplotRef.current && container) {
              const w =
                container.getBoundingClientRect().width ||
                container.clientWidth;
              if (w > 0) {
                uplotRef.current.setSize({ width: w, height: 130 });
                uplotRef.current.redraw();
              }
            }
          }, 100);
        } else if (!seriesMatch) {
          // Series count mismatch - need to recreate plot
          uplotRef.current!.destroy();
          uplotRef.current = null;
        } else {
          // Canvas got corrupted, force recreation
          uplotRef.current!.destroy();
          uplotRef.current = null;
        }
      } else if (uplotRef.current) {
        // Stale uPlot instance - clean it up
        try {
          uplotRef.current.destroy();
        } catch {
          // Ignore errors during cleanup
        }
        uplotRef.current = null;
      }

      // Create new plot if needed
      if (!uplotRef.current) {
        // Clean up any stale DOM content
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }

        // Get actual dimensions
        const rect = container.getBoundingClientRect();
        const width = Math.max(rect.width, container.clientWidth);

        // If width is still 0, defer creation
        if (width <= 0) {
          requestAnimationFrame(() => setRetryTrigger((p) => p + 1));
          return;
        }

        // Update opts with accurate width
        opts.width = width;

        // Clear any existing timeout
        if (forceRedrawTimeoutRef.current) {
          clearTimeout(forceRedrawTimeoutRef.current);
        }

        // Check if we're in a popout window
        const isPopout = window.location.pathname.includes("/popout/");

        // Function to create the plot
        const createPlot = () => {
          if (!plotRef.current) return;

          // Get fresh dimensions
          const freshRect = plotRef.current.getBoundingClientRect();
          const freshWidth = Math.max(
            freshRect.width,
            plotRef.current.clientWidth,
            width,
          );

          // Update opts with fresh width
          opts.width = freshWidth;

          // Destroy any existing plot first
          if (uplotRef.current) {
            try {
              uplotRef.current.destroy();
            } catch {
              // Ignore destroy errors
            }
            uplotRef.current = null;
          }

          // Clear container
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }

          // Create the plot
          uplotRef.current = new uPlot(opts, data, container);

          // Force immediate size update and redraw - this is critical for proper rendering
          // when the component doesn't remount on file switch
          uplotRef.current.setSize({ width: opts.width, height: 130 });
          uplotRef.current.setData(data);
          uplotRef.current.redraw();

          // In popout, schedule a redraw after paint cycle
          if (isPopout) {
            requestAnimationFrame(() => {
              if (uplotRef.current && plotRef.current) {
                const w =
                  plotRef.current.getBoundingClientRect().width || freshWidth;
                uplotRef.current.setSize({ width: w, height: 130 });
                uplotRef.current.redraw();
              }
            });
          }
        };

        if (isPopout) {
          // POPOUT WINDOW STRATEGY:
          // Wait for the browser to be truly ready before creating the plot.
          // In popout webviews, the canvas context isn't ready until after:
          // 1. Document is fully loaded (readyState === 'complete')
          // 2. A paint cycle has occurred (double RAF)

          const waitForBrowserReady = (callback: () => void) => {
            // First, ensure document is fully loaded
            if (document.readyState !== "complete") {
              window.addEventListener(
                "load",
                () => waitForBrowserReady(callback),
                {
                  once: true,
                },
              );
              return;
            }

            // Then wait for two animation frames (ensures a full paint cycle)
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                // Finally, use requestIdleCallback if available, otherwise small timeout
                if ("requestIdleCallback" in window) {
                  (
                    window as typeof window & {
                      requestIdleCallback: (cb: () => void) => void;
                    }
                  ).requestIdleCallback(callback);
                } else {
                  setTimeout(callback, 0);
                }
              });
            });
          };

          waitForBrowserReady(() => {
            createPlot();

            // Verify content rendered, retry if needed
            requestAnimationFrame(() => {
              if (!uplotRef.current || !plotRef.current) return;

              const canvas = uplotRef.current.root?.querySelector(
                "canvas",
              ) as HTMLCanvasElement | null;
              if (canvas) {
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  try {
                    const centerX = Math.floor(canvas.width / 2);
                    const centerY = Math.floor(canvas.height / 2);
                    const imgData = ctx.getImageData(
                      centerX - 25,
                      centerY - 10,
                      50,
                      20,
                    );
                    let hasContent = false;
                    for (let i = 0; i < imgData.data.length; i += 4) {
                      if (imgData.data[i + 3] > 50) {
                        hasContent = true;
                        break;
                      }
                    }

                    // If still blank, retry once after another paint cycle
                    if (!hasContent) {
                      requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                          createPlot();
                        });
                      });
                    }
                  } catch {
                    // Ignore getImageData errors
                  }
                }
              }
            });
          });
        } else {
          // MAIN WINDOW STRATEGY:
          // Create plot and force redraw after paint cycle
          createPlot();

          // Force redraw after paint cycle
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (uplotRef.current && plotRef.current) {
                uplotRef.current.redraw();
              }
            });
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
                height: 130,
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
      if (forceRedrawTimeoutRef.current) {
        clearTimeout(forceRedrawTimeoutRef.current);
        forceRedrawTimeoutRef.current = null;
      }
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
                height: 130,
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
              uplotRef.current.setSize({ width, height: 130 });
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

  // Check if channel data is valid (not empty arrays) - matches validation in plot creation effect
  const hasValidChannelData =
    overviewData?.data &&
    overviewData.data.length > 0 &&
    overviewData.data.every(
      (channelData) => channelData && channelData.length > 0,
    );

  // Show initializing state when we have data but plot hasn't rendered yet
  // Also require valid duration and valid channel data - during file transitions,
  // duration may briefly be 0 or data may be stale/incomplete
  const isInitializing =
    overviewData &&
    !plotCreated &&
    !loading &&
    containerReady &&
    duration > 0 &&
    hasValidChannelData;

  return (
    <div className="relative w-full h-[130px] border-2 border-primary rounded-md bg-background">
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
      {overviewData && !hasValidChannelData && !loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background animate-in fade-in-0 duration-200">
          <div className="text-xs text-muted-foreground animate-pulse">
            Loading channel data...
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
        className="w-full h-[130px] [&_.uplot]:bg-transparent [&_.u-wrap]:bg-transparent"
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
