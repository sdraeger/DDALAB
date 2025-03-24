"use client";

import type React from "react";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useLayoutEffect,
} from "react";
import { useTheme } from "next-themes";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EEGData } from "./eeg-dashboard";
import type { Annotation } from "./annotation-editor";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useSession } from "next-auth/react";

interface EEGChartProps {
  eegData: EEGData;
  selectedChannels: string[];
  timeWindow: [number, number];
  absoluteTimeWindow?: [number, number]; // Optional absolute time window for x-axis display
  zoomLevel: number;
  customZoomFactor?: number; // Custom zoom factor - controls how aggressive zoom is
  onTimeWindowChange: (window: [number, number]) => void; // This should only update the view, not trigger data fetching
  className?: string; // Add className prop
  height?: string | number; // Allow explicit height to be specified
  editMode?: boolean; // New prop to enable edit mode
  onAnnotationAdd?: (annotation: Partial<Annotation>) => void; // Callback when annotation is added
  onAnnotationDelete?: (id: number) => void; // Callback when annotation is deleted
  filePath?: string; // Add filePath as a separate prop
}

export function EEGChart({
  eegData,
  selectedChannels,
  timeWindow,
  absoluteTimeWindow,
  zoomLevel,
  customZoomFactor = 0.05, // Default zoom factor of 5%
  onTimeWindowChange,
  className,
  height,
  editMode = false,
  onAnnotationAdd,
  onAnnotationDelete,
  filePath,
}: EEGChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const { data: session, status } = useSession();
  const user = session?.user;
  const { toast } = useToast(); // Import toast function
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [currentTimeWindow, setCurrentTimeWindow] =
    useState<[number, number]>(timeWindow);

  // Edit mode state
  const [annotationDialogOpen, setAnnotationDialogOpen] = useState(false);
  const [annotationText, setAnnotationText] = useState("");
  const [clickedTime, setClickedTime] = useState<number | null>(null);
  const [hoveredAnnotation, setHoveredAnnotation] = useState<number | null>(
    null
  );
  const [hoveredPosition, setHoveredPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Use the user's preferred zoom factor from preferences, if available
  // Otherwise, use the provided customZoomFactor or the default
  const userZoomFactor = user?.preferences?.eegZoomFactor;
  const effectiveZoomFactor =
    userZoomFactor !== undefined ? userZoomFactor : customZoomFactor;

  // Colors for each channel
  const channelColors = [
    "#f43f5e", // rose
    "#8b5cf6", // violet
    "#3b82f6", // blue
    "#10b981", // emerald
    "#f59e0b", // amber
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#84cc16", // lime
    "#6366f1", // indigo
    "#ef4444", // red
    "#14b8a6", // teal
    "#f97316", // orange
  ];

  // Use absolute time window for display if provided
  const displayTimeWindow = absoluteTimeWindow || currentTimeWindow;

  // Function to update canvas dimensions and trigger redraw
  const updateCanvasDimensions = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas && container) {
      const { width, height } = container.getBoundingClientRect();

      // Only update if dimensions actually changed to avoid needless redraws
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      // Always redraw after dimension check - don't make this conditional
      if (eegData && selectedChannels.length > 0) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          drawEEGData(ctx, canvas.width, canvas.height);
        }
      }

      return true;
    }

    return false;
  }, [eegData, selectedChannels, currentTimeWindow, theme, absoluteTimeWindow]);

  // Separate drawing function for easier reuse
  const drawEEGData = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      if (!eegData || selectedChannels.length === 0) return;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Set background
      ctx.fillStyle = theme === "dark" ? "#1e1e2f" : "#ffffff";
      ctx.fillRect(0, 0, width, height);

      // Draw time grid
      const gridColor =
        theme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;

      // Calculate time interval for grid lines (1s, 0.5s, 0.2s, etc. based on zoom)
      const timeRange = currentTimeWindow[1] - currentTimeWindow[0];
      let gridInterval = 1; // 1 second default

      if (timeRange <= 2) gridInterval = 0.1;
      else if (timeRange <= 5) gridInterval = 0.2;
      else if (timeRange <= 10) gridInterval = 0.5;
      else if (timeRange <= 30) gridInterval = 1;
      else if (timeRange <= 60) gridInterval = 5;
      else gridInterval = 10;

      // Draw vertical time grid lines
      const startGrid =
        Math.ceil(currentTimeWindow[0] / gridInterval) * gridInterval;
      for (let t = startGrid; t <= currentTimeWindow[1]; t += gridInterval) {
        const x =
          ((t - currentTimeWindow[0]) /
            (currentTimeWindow[1] - currentTimeWindow[0])) *
          width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        // Draw time labels - use absolute time if available, otherwise use relative time
        const displayTime = absoluteTimeWindow
          ? (absoluteTimeWindow[0] + t - currentTimeWindow[0]).toFixed(1)
          : t.toFixed(1);

        ctx.fillStyle = theme === "dark" ? "#a0a0b0" : "#666666";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${displayTime}s`, x, height - 5);
      }

      // Draw y-axis label (μV)
      ctx.save();
      ctx.fillStyle = theme === "dark" ? "#a0a0b0" : "#666666";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      // Rotate and position the text on the left side
      ctx.translate(20, height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("Amplitude (μV)", 0, 0);
      ctx.restore();

      // Calculate channel height
      const channelHeight = height / selectedChannels.length;

      // Draw each selected channel
      selectedChannels.forEach((channelName, channelIndex) => {
        const channelIdx = eegData.channels.indexOf(channelName);
        if (channelIdx === -1) return;

        const yOffset = channelHeight * channelIndex + channelHeight / 2;

        // Draw channel label
        ctx.fillStyle = theme === "dark" ? "#ffffff" : "#000000";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(channelName, 5, yOffset - channelHeight / 2 + 15);

        // Draw horizontal divider
        ctx.strokeStyle = gridColor;
        ctx.beginPath();
        ctx.moveTo(0, yOffset + channelHeight / 2);
        ctx.lineTo(width, yOffset + channelHeight / 2);
        ctx.stroke();

        // Get channel data for the visible time window
        const channelData = eegData.data[channelIdx];
        if (!channelData || channelData.length === 0) {
          console.warn(
            `No data for channel ${channelName} (index ${channelIdx})`
          );
          return;
        }

        // Calculate sample indices for the visible window
        const startSample = Math.max(
          0,
          Math.floor(currentTimeWindow[0] * eegData.sampleRate)
        );
        const endSample = Math.min(
          channelData.length,
          Math.ceil(currentTimeWindow[1] * eegData.sampleRate)
        );

        // Skip samples to improve performance with large datasets
        const totalSamples = endSample - startSample;
        const skipFactor = Math.max(1, Math.floor(totalSamples / 2000)); // Limit to ~2000 points

        // Find min/max for scaling
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (
          let i = startSample;
          i < endSample && i < channelData.length;
          i += skipFactor
        ) {
          if (channelData[i] < min) min = channelData[i];
          if (channelData[i] > max) max = channelData[i];
        }

        // If all values are the same, add a small range
        if (min === max) {
          min -= 0.5;
          max += 0.5;
        }

        // Add 10% padding to min/max
        const range = max - min;
        min -= range * 0.1;
        max += range * 0.1;

        // Display min/max amplitude values for this channel
        ctx.fillStyle = theme === "dark" ? "#a0a0b0" : "#666666";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "right";
        // Round values to 1 decimal place and add unit
        ctx.fillText(`${min.toFixed(1)} μV`, 45, yOffset + channelHeight * 0.4);
        ctx.fillText(`${max.toFixed(1)} μV`, 45, yOffset - channelHeight * 0.4);

        // Set line style
        ctx.strokeStyle = channelColors[channelIndex % channelColors.length];
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        // Draw the signal
        let isFirstPoint = true;
        for (
          let i = startSample;
          i < endSample && i < channelData.length;
          i += skipFactor
        ) {
          const x =
            ((i / eegData.sampleRate - currentTimeWindow[0]) /
              (currentTimeWindow[1] - currentTimeWindow[0])) *
            width;

          // Normalize the value to the channel height
          const normalizedValue = 1 - (channelData[i] - min) / (max - min);
          const y =
            yOffset -
            channelHeight * 0.4 +
            normalizedValue * channelHeight * 0.8;

          if (isFirstPoint) {
            ctx.moveTo(x, y);
            isFirstPoint = false;
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      });

      // Draw annotations if they exist
      if (eegData.annotations && eegData.annotations.length > 0) {
        eegData.annotations.forEach((annotation) => {
          const isHovered = hoveredAnnotation === annotation.id;

          // Convert the annotation startTime to x-coordinate
          const annotationTime =
            annotation.startTime / eegData.sampleRate -
            (eegData.absoluteStartTime || 0);

          // Only draw annotations that are within the current time window
          if (
            annotationTime >= currentTimeWindow[0] &&
            annotationTime <= currentTimeWindow[1]
          ) {
            const x =
              ((annotationTime - currentTimeWindow[0]) /
                (currentTimeWindow[1] - currentTimeWindow[0])) *
              width;

            // Draw annotation line with different color when hovered
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.strokeStyle = isHovered ? "#f43f5e" : "#f59e0b";
            ctx.lineWidth = isHovered ? 2 : 1.5;
            ctx.stroke();

            // Draw annotation text
            if (annotation.text) {
              ctx.save();
              ctx.fillStyle = theme === "dark" ? "#ffffff" : "#000000";
              ctx.font = "12px sans-serif";
              ctx.textAlign = "left";
              ctx.translate(x + 5, 15);
              ctx.rotate(0);
              ctx.fillText(annotation.text, 0, 0);
              ctx.restore();
            }
          }
        });
      }
    },
    [
      eegData,
      selectedChannels,
      currentTimeWindow,
      theme,
      absoluteTimeWindow,
      hoveredAnnotation,
    ]
  );

  // Use layout effect for initial sizing to ensure it happens before painting
  useLayoutEffect(() => {
    updateCanvasDimensions();
  }, [updateCanvasDimensions]);

  // Update when critical props change
  useEffect(() => {
    updateCanvasDimensions();
  }, [updateCanvasDimensions, theme, zoomLevel]);

  // Update local state when props change
  useEffect(() => {
    setCurrentTimeWindow(timeWindow);
  }, [timeWindow]);

  // Draw the EEG data on mount and when dependencies change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !eegData || selectedChannels.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Make sure the canvas has the right dimensions
    updateCanvasDimensions();

    // Draw the data
    drawEEGData(ctx, canvas.width, canvas.height);
  }, [
    eegData,
    selectedChannels,
    currentTimeWindow,
    theme,
    zoomLevel,
    absoluteTimeWindow,
    drawEEGData,
    updateCanvasDimensions,
  ]);

  // Handle mouse wheel zoom
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();

      if (!eegData) return;

      // Get the mouse position relative to the canvas
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const canvasWidth = rect.width;

      // Calculate where in the time window the mouse is pointing
      const timeRange = currentTimeWindow[1] - currentTimeWindow[0];
      const mouseTimePosition =
        currentTimeWindow[0] + (mouseX / canvasWidth) * timeRange;

      // Use the effectiveZoomFactor (user preference or default)
      const baseZoomAmount = effectiveZoomFactor;
      const zoomFactor =
        e.deltaY < 0
          ? 1 - baseZoomAmount // Zoom in: reduce the visible range
          : 1 + baseZoomAmount; // Zoom out: increase the visible range

      // Calculate new time range
      const newTimeRange = timeRange * zoomFactor;

      // Ensure minimum and maximum reasonable zoom levels
      const maxZoom = eegData.duration; // Can't zoom out more than full duration
      const minZoom = 0.1; // Don't allow zooming in beyond 100ms

      const clampedTimeRange = Math.min(
        Math.max(newTimeRange, minZoom),
        maxZoom
      );

      // Calculate new time window, keeping mouse position fixed
      const mouseRatio = (mouseTimePosition - currentTimeWindow[0]) / timeRange;
      const newStart = Math.max(
        0,
        mouseTimePosition - mouseRatio * clampedTimeRange
      );
      const newEnd = Math.min(eegData.duration, newStart + clampedTimeRange);

      // Adjust if we hit the boundaries
      if (newEnd === eegData.duration) {
        const adjustedStart = Math.max(0, eegData.duration - clampedTimeRange);
        setCurrentTimeWindow([adjustedStart, eegData.duration]);
        onTimeWindowChange([adjustedStart, eegData.duration]);
      } else {
        setCurrentTimeWindow([newStart, newEnd]);
        onTimeWindowChange([newStart, newEnd]);
      }

      // Force an immediate redraw without waiting for React to re-render
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Use a new time window for immediate feedback
          const immediateTimeWindow =
            newEnd === eegData.duration
              ? [
                  Math.max(0, eegData.duration - clampedTimeRange),
                  eegData.duration,
                ]
              : [newStart, newEnd];

          // We need to temporarily update the time window for drawing
          const originalTimeWindow = [...currentTimeWindow];
          currentTimeWindow[0] = immediateTimeWindow[0];
          currentTimeWindow[1] = immediateTimeWindow[1];

          // Draw with the new time window
          drawEEGData(ctx, canvas.width, canvas.height);

          // Restore the original time window (React will update it properly)
          currentTimeWindow[0] = originalTimeWindow[0];
          currentTimeWindow[1] = originalTimeWindow[1];
        }
      }
    },
    [
      eegData,
      currentTimeWindow,
      onTimeWindowChange,
      drawEEGData,
      effectiveZoomFactor,
    ]
  );

  // Handle mouse event for dragging
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !eegData) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const relativeX = x / rect.width;

      // Store mouse position for tooltip
      setHoveredPosition({ x, y });

      if (editMode && eegData.annotations) {
        // Check if mouse is near any annotation
        const timeAtMouse =
          currentTimeWindow[0] +
          relativeX * (currentTimeWindow[1] - currentTimeWindow[0]);

        // Find the closest annotation within 10 pixels
        const pixelThreshold = 10;
        const timeThreshold =
          (pixelThreshold * (currentTimeWindow[1] - currentTimeWindow[0])) /
          rect.width;

        let closestAnnotation = null;
        let minDistance = timeThreshold;

        eegData.annotations.forEach((annotation) => {
          const annotationTime =
            annotation.startTime / eegData.sampleRate -
            (eegData.absoluteStartTime || 0);
          if (Math.abs(annotationTime - timeAtMouse) < minDistance) {
            closestAnnotation = annotation.id;
            minDistance = Math.abs(annotationTime - timeAtMouse);
          }
        });

        setHoveredAnnotation(closestAnnotation);
      } else {
        setHoveredAnnotation(null);
      }

      if (isDragging) {
        const dx = e.clientX - dragStart;
        const timeRange = currentTimeWindow[1] - currentTimeWindow[0];
        const timeDelta = (dx / canvas.width) * timeRange * -1;

        if (Math.abs(timeDelta) > 0.01) {
          // Only update if moved enough
          const newStart = Math.max(0, currentTimeWindow[0] + timeDelta);
          const newEnd = Math.min(
            eegData.duration,
            currentTimeWindow[1] + timeDelta
          );

          // Keep the window size constant
          if (newEnd - newStart === timeRange) {
            setCurrentTimeWindow([newStart, newEnd]);
            setDragStart(e.clientX);

            // Force an immediate redraw for smoother dragging
            const ctx = canvas.getContext("2d");
            if (ctx) {
              // Create a temporary time window for drawing
              const immediateTimeWindow = [newStart, newEnd];
              const originalTimeWindow = [...currentTimeWindow];

              // Update time window temporarily for drawing
              currentTimeWindow[0] = immediateTimeWindow[0];
              currentTimeWindow[1] = immediateTimeWindow[1];

              // Draw with the immediate window
              drawEEGData(ctx, canvas.width, canvas.height);

              // Restore original (React will update it properly)
              currentTimeWindow[0] = originalTimeWindow[0];
              currentTimeWindow[1] = originalTimeWindow[1];
            }
          }
        }
      }
    },
    [
      isDragging,
      currentTimeWindow,
      dragStart,
      onTimeWindowChange,
      eegData,
      editMode,
    ]
  );

  // Mouse event handlers for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart(e.clientX);
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      // Update parent component with new time window
      onTimeWindowChange(currentTimeWindow);
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setHoveredAnnotation(null);
    setHoveredPosition(null);
  };

  // Handle right-click to delete annotations
  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editMode || !eegData || !eegData.annotations) return;

    // Always prevent the default context menu in edit mode
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const relativeX = x / rect.width;

    // Calculate the time at the clicked position
    const clickTime =
      currentTimeWindow[0] +
      relativeX * (currentTimeWindow[1] - currentTimeWindow[0]);

    // Find the closest annotation within a threshold
    const pixelThreshold = 10;
    const timeThreshold =
      (pixelThreshold * (currentTimeWindow[1] - currentTimeWindow[0])) /
      rect.width;

    let closestAnnotation = null;
    let minDistance = timeThreshold;

    eegData.annotations.forEach((annotation) => {
      const annotationTime =
        annotation.startTime / eegData.sampleRate -
        (eegData.absoluteStartTime || 0);
      if (Math.abs(annotationTime - clickTime) < minDistance) {
        closestAnnotation = annotation.id;
        minDistance = Math.abs(annotationTime - clickTime);
      }
    });

    // Delete the annotation if one was found
    if (closestAnnotation !== null && onAnnotationDelete) {
      onAnnotationDelete(closestAnnotation);
    }
  };

  // Navigation buttons
  const moveLeft = () => {
    if (!eegData) return;

    const timeRange = currentTimeWindow[1] - currentTimeWindow[0];
    const moveAmount = timeRange * 0.2; // Move 20% of visible window

    const newStart = Math.max(0, currentTimeWindow[0] - moveAmount);
    const newEnd = newStart + timeRange;

    setCurrentTimeWindow([newStart, newEnd]);
    onTimeWindowChange([newStart, newEnd]);
  };

  const moveRight = () => {
    if (!eegData) return;

    const timeRange = currentTimeWindow[1] - currentTimeWindow[0];
    const moveAmount = timeRange * 0.2; // Move 20% of visible window

    const newEnd = Math.min(
      eegData.duration,
      currentTimeWindow[1] + moveAmount
    );
    const newStart = newEnd - timeRange;

    setCurrentTimeWindow([newStart, newEnd]);
    onTimeWindowChange([newStart, newEnd]);
  };

  // Add non-passive wheel event listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Add wheel event listener with { passive: false }
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    // Also ensure the canvas is properly sized
    updateCanvasDimensions();

    // Clean up on unmount
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [handleWheel, updateCanvasDimensions]); // handleWheel contains all the necessary dependencies

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      updateCanvasDimensions();
    };

    window.addEventListener("resize", handleResize);

    // Add ResizeObserver to handle parent container size changes
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Initial size setting
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
    };
  }, [updateCanvasDimensions]);

  const handleChartClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Skip if not in edit mode or if it's a right-click
    if (!editMode || e.button === 2) {
      // Handle existing panning/zooming behavior if not in edit mode
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || !eegData) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const relativeX = x / rect.width;

    // Calculate the time at the clicked position
    const clickTime =
      currentTimeWindow[0] +
      relativeX * (currentTimeWindow[1] - currentTimeWindow[0]);

    // Calculate absolute time and sample
    const absoluteClickTime = (eegData.absoluteStartTime || 0) + clickTime;
    const samplePosition = Math.round(absoluteClickTime * eegData.sampleRate);

    // Open annotation dialog
    setClickedTime(samplePosition);
    setAnnotationText("");
    setAnnotationDialogOpen(true);
  };

  const handleAnnotationSave = () => {
    if (!clickedTime || !onAnnotationAdd) return;

    const newAnnotation: Partial<Annotation> = {
      filePath: filePath || "",
      startTime: clickedTime,
      text: annotationText,
    };

    onAnnotationAdd(newAnnotation);
    setAnnotationDialogOpen(false);
    setAnnotationText("");
  };

  // Render the chart
  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "relative w-full h-full flex flex-col overflow-hidden",
          editMode && "border-2 border-blue-500",
          className
        )}
        style={{
          height: height || "100%",
          minHeight: height || "100%",
        }}
      >
        {editMode && (
          <div className="absolute top-0 left-0 right-0 bg-blue-500 text-white px-2 py-1 text-xs z-20 flex items-center justify-between">
            <span>
              Edit Mode - Click on the chart to add annotations, right-click to
              delete them
            </span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={cn(
            "w-full h-full absolute inset-0",
            isDragging ? "cursor-grabbing" : "cursor-grab"
          )}
          style={{
            touchAction: "none",
          }}
          onMouseDown={editMode ? handleChartClick : handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleContextMenu}
        />

        {/* Navigation controls */}
        <div className="absolute bottom-4 right-4 flex gap-2 z-10">
          <Button
            variant="secondary"
            size="icon"
            onClick={moveLeft}
            disabled={currentTimeWindow[0] <= 0}
            className="h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm shadow-sm"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={moveRight}
            disabled={currentTimeWindow[1] >= eegData.duration}
            className="h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm shadow-sm"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Time range indicator */}
        <div className="absolute top-2 left-2 text-xs bg-background/80 backdrop-blur-sm rounded px-2 py-1 shadow-sm">
          {displayTimeWindow[0].toFixed(1)}s - {displayTimeWindow[1].toFixed(1)}
          s
          {eegData.duration > 0 && (
            <span>
              {" "}
              (
              {(
                ((displayTimeWindow[1] - displayTimeWindow[0]) /
                  eegData.duration) *
                100
              ).toFixed(1)}
              %)
            </span>
          )}
        </div>
      </div>

      {/* Annotation dialog */}
      <Dialog
        open={annotationDialogOpen}
        onOpenChange={setAnnotationDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Annotation</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="annotationText">Description</label>
              <Input
                id="annotationText"
                value={annotationText}
                onChange={(e) => setAnnotationText(e.target.value)}
                placeholder="Enter annotation description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAnnotationDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleAnnotationSave}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
