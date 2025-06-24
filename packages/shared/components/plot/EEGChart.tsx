"use client";

import React, {
  useRef,
  useCallback,
  useLayoutEffect,
  MutableRefObject,
  useState,
  useEffect,
} from "react";
import { useTheme } from "next-themes";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils/misc";
import { EEGData } from "../../types/EEGData";
import { Annotation } from "../../types/annotation";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { useToast } from "../ui/use-toast";
import { useSession } from "next-auth/react";

interface EEGChartProps {
  eegData: EEGData;
  selectedChannels: string[];
  timeWindow: [number, number];
  absoluteTimeWindow?: [number, number];
  zoomLevel: number;
  customZoomFactor?: number;
  onTimeWindowChange: (window: [number, number]) => void;
  className?: string;
  height?: string | number;
  editMode?: boolean;
  onAnnotationAdd?: (annotation: Partial<Annotation>) => void;
  onAnnotationDelete?: (id: number) => void;
  filePath?: string;
  annotations?: Annotation[];
  onAnnotationSelect?: (annotation: Annotation) => void;
  onChartClick?: (event: React.MouseEvent<HTMLCanvasElement>) => void;
}

const CHANNEL_COLORS = [
  "#f43f5e",
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#6366f1",
  "#ef4444",
  "#14b8a6",
  "#f97316",
];

const DEFAULT_HEIGHT = "400px";
const MIN_WINDOW = 0.1;

export function EEGChart({
  eegData,
  selectedChannels,
  timeWindow,
  absoluteTimeWindow,
  zoomLevel,
  customZoomFactor = 0.05,
  onTimeWindowChange,
  className,
  height = DEFAULT_HEIGHT,
  editMode = false,
  onAnnotationAdd,
  onAnnotationDelete,
  filePath,
  annotations = [],
  onAnnotationSelect,
  onChartClick,
}: EEGChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<MutableRefObject<HTMLDivElement | null>>({
    current: null,
  });
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const wheelListenerRef = useRef<((event: WheelEvent) => void) | null>(null);
  const { theme } = useTheme();
  const { data: session } = useSession();
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
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

  // Context menu state
  const lastMousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Add state to show zoom activity
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const effectiveZoomFactor =
    session?.user?.preferences?.eegZoomFactor ?? customZoomFactor;

  const drawEEGData = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      if (!eegData?.channels?.length || !selectedChannels.length) return;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = theme === "dark" ? "#1e1e2f" : "#ffffff";
      ctx.fillRect(0, 0, width, height);

      const gridColor =
        theme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";
      drawTimeGrid(ctx, width, height, gridColor);
      drawYAxisLabel(ctx, height);
      drawChannels(ctx, width, height, gridColor);
      drawAnnotations(ctx, width, height);
    },
    [
      eegData,
      selectedChannels,
      timeWindow,
      theme,
      annotations,
      hoveredAnnotation,
    ]
  );

  const drawTimeGrid = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    gridColor: string
  ) => {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    const timeRange = timeWindow[1] - timeWindow[0];
    const gridInterval = getGridInterval(timeRange);
    const startGrid = Math.ceil(timeWindow[0] / gridInterval) * gridInterval;

    for (let t = startGrid; t <= timeWindow[1]; t += gridInterval) {
      const x = ((t - timeWindow[0]) / timeRange) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      const displayTime = absoluteTimeWindow
        ? (absoluteTimeWindow[0] + t - timeWindow[0]).toFixed(1)
        : t.toFixed(1);
      ctx.fillStyle = theme === "dark" ? "#a0a0b0" : "#666666";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${displayTime}s`, x, height - 5);
    }
  };

  const drawYAxisLabel = (ctx: CanvasRenderingContext2D, height: number) => {
    ctx.save();
    ctx.fillStyle = theme === "dark" ? "#a0a0b0" : "#666666";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.translate(20, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Amplitude (μV)", 0, 0);
    ctx.restore();
  };

  const drawChannels = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    gridColor: string
  ) => {
    // Ensure minimum spacing between channels
    const channelHeight = Math.max(40, height / selectedChannels.length);
    const channelSpacing = channelHeight * 0.9; // 90% for drawing, 10% for spacing

    selectedChannels.forEach((channelName, channelIndex) => {
      const channelIdx = eegData.channels.indexOf(channelName);
      if (channelIdx === -1) return;

      const yOffset = channelHeight * channelIndex + channelHeight / 2;
      ctx.fillStyle = theme === "dark" ? "#ffffff" : "#000000";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(channelName, 5, yOffset - channelHeight / 2 + 15);

      // Draw horizontal separator line for each channel
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yOffset + channelHeight / 2);
      ctx.lineTo(width, yOffset + channelHeight / 2);
      ctx.stroke();

      const channelData = eegData.data[channelIdx];
      if (!channelData?.length) return;

      const startSample = Math.max(
        0,
        Math.floor(timeWindow[0] * eegData.sampleRate)
      );
      const endSample = Math.min(
        channelData.length,
        Math.ceil(timeWindow[1] * eegData.sampleRate)
      );

      if (endSample <= startSample) return;

      const visibleData = channelData.slice(startSample, endSample);
      if (visibleData.length === 0) return;

      const dataMin = Math.min(...visibleData);
      const dataMax = Math.max(...visibleData);
      const dataRange = dataMax - dataMin || 1;

      ctx.beginPath();
      ctx.strokeStyle = CHANNEL_COLORS[channelIndex % CHANNEL_COLORS.length];
      ctx.lineWidth = 1.5;

      let firstPoint = true;
      for (let i = startSample; i < endSample; i++) {
        const sampleTime = i / eegData.sampleRate;
        const x =
          ((sampleTime - timeWindow[0]) / (timeWindow[1] - timeWindow[0])) *
          width;
        const amplitude = channelData[i] ?? 0;

        // Use channelSpacing instead of channelHeight * 0.8 for better separation
        const y =
          yOffset - ((amplitude - dataMin) / dataRange - 0.5) * channelSpacing;

        firstPoint ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        firstPoint = false;
      }
      ctx.stroke();
    });
  };

  const drawAnnotations = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ) => {
    annotations.forEach((annotation) => {
      const annotationTime = annotation.startTime / eegData.sampleRate;
      if (annotationTime < timeWindow[0] || annotationTime > timeWindow[1])
        return;

      const x =
        ((annotationTime - timeWindow[0]) / (timeWindow[1] - timeWindow[0])) *
        width;
      ctx.beginPath();
      ctx.strokeStyle =
        annotation.id === hoveredAnnotation ? "#facc15" : "#fb923c";
      ctx.lineWidth = annotation.id === hoveredAnnotation ? 3 : 2;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      ctx.fillStyle =
        annotation.id === hoveredAnnotation ? "#fde047" : "#fed7aa";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = x > width - 50 ? "right" : "left";
      const displayText =
        annotation.text.length > 20
          ? `${annotation.text.substring(0, 17)}...`
          : annotation.text;
      ctx.fillText(displayText, x + 5, 15);
    });
  };

  const getGridInterval = (timeRange: number) => {
    if (timeRange <= 2) return 0.1;
    if (timeRange <= 5) return 0.2;
    if (timeRange <= 10) return 0.5;
    if (timeRange <= 30) return 1;
    if (timeRange <= 60) return 5;
    return 10;
  };

  const updateCanvasDimensions = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current.current;
    if (!canvas || !container) return false;

    const { width, height } = container.getBoundingClientRect();
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    if (ctx && eegData && selectedChannels.length) {
      drawEEGData(ctx, canvas.width, canvas.height);
    }
    return true;
  }, [eegData, selectedChannels, drawEEGData]);

  // Add effect to redraw when timeWindow changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !eegData || !selectedChannels.length) return;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      drawEEGData(ctx, canvas.width, canvas.height);
    }
  }, [timeWindow, drawEEGData, eegData, selectedChannels]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Show that we received a wheel event (always)
      setIsZooming(true);
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
      zoomTimeoutRef.current = setTimeout(() => {
        setIsZooming(false);
      }, 200);

      // Only allow zoom when meta key (Cmd on Mac) or ctrl key (Ctrl on Windows/Linux) is pressed
      if (!e.metaKey && !e.ctrlKey) {
        return; // Just return without toast spam
      }

      e.preventDefault();

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const currentRange = timeWindow[1] - timeWindow[0];
      const focusPoint = timeWindow[0] + (x / canvas.width) * currentRange;
      const zoomIntensity = 0.1 * effectiveZoomFactor;

      let newStartTime =
        focusPoint -
        (focusPoint - timeWindow[0]) *
        (e.deltaY < 0 ? 1 - zoomIntensity : 1 + zoomIntensity);
      let newEndTime =
        focusPoint +
        (timeWindow[1] - focusPoint) *
        (e.deltaY < 0 ? 1 - zoomIntensity : 1 + zoomIntensity);

      newStartTime = Math.max(0, newStartTime);
      newEndTime = Math.min(eegData.duration, newEndTime);

      if (newEndTime - newStartTime < MIN_WINDOW) {
        const mid = (newStartTime + newEndTime) / 2;
        newStartTime = mid - MIN_WINDOW / 2;
        newEndTime = mid + MIN_WINDOW / 2;
      }

      newStartTime = Math.max(0, newStartTime);
      newEndTime = Math.min(eegData.duration, newEndTime);

      if (newStartTime < newEndTime) {
        onTimeWindowChange([newStartTime, newEndTime]);
      }
    },
    [timeWindow, eegData.duration, effectiveZoomFactor, onTimeWindowChange]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    setDragStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Track mouse position for context menu
    const rect = canvas.getBoundingClientRect();
    lastMousePositionRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    if (editMode && onAnnotationAdd) {
      const x = e.clientX - rect.left;
      const foundAnnotation = annotations.find((anno) => {
        const annoX =
          ((anno.startTime - timeWindow[0]) / (timeWindow[1] - timeWindow[0])) *
          canvas.width;
        return Math.abs(x - annoX) < 5;
      });

      setHoveredAnnotation(foundAnnotation ? foundAnnotation.id : null);
      setHoveredPosition(
        foundAnnotation ? { x: e.clientX, y: e.clientY } : null
      );
    }

    if (!isDragging) return;

    const dx = e.clientX - dragStart;
    setDragStart(e.clientX);
    const timePerPixel = (timeWindow[1] - timeWindow[0]) / canvas.width;
    const proposedWindow: [number, number] = [
      timeWindow[0] - dx * timePerPixel,
      timeWindow[1] - dx * timePerPixel,
    ];

    // Apply robust bounds checking for mouse dragging
    if (!eegData || !eegData.duration) {
      return; // Can't apply bounds checking without data
    }

    const windowDuration = timeWindow[1] - timeWindow[0];
    let finalWindow: [number, number] = proposedWindow;

    // Check left boundary
    if (proposedWindow[0] < 0) {
      finalWindow = [0, windowDuration];
    }
    // Check right boundary
    else if (proposedWindow[1] > eegData.duration) {
      // Clamp to the right edge - ensure the end aligns with data end
      finalWindow = [
        Math.max(0, eegData.duration - windowDuration),
        eegData.duration
      ];
    }
    // Ensure both start and end stay within bounds
    else {
      finalWindow = [
        Math.max(0, Math.min(proposedWindow[0], eegData.duration - windowDuration)),
        Math.min(eegData.duration, Math.max(windowDuration, proposedWindow[1]))
      ];
    }

    // Check if we've hit the boundaries
    const hitRightBoundary = proposedWindow[1] > eegData.duration;
    const hitLeftBoundary = proposedWindow[0] < 0;

    if (hitRightBoundary) {
      console.log('DRAG RIGHT BOUNDARY HIT:', {
        proposedWindow,
        eegDataDuration: eegData.duration,
        finalWindow
      });
    }

    if (hitLeftBoundary) {
      console.log('DRAG LEFT BOUNDARY HIT:', {
        proposedWindow,
        finalWindow
      });
    }

    // Only update if the window actually changed (this prevents unnecessary re-renders)
    if (finalWindow[0] !== timeWindow[0] || finalWindow[1] !== timeWindow[1]) {
      onTimeWindowChange(finalWindow);
    } else if (hitRightBoundary || hitLeftBoundary) {
      console.log('DRAG BOUNDARY: Already at boundary position, no movement');
    }
  };

  const handleAddAnnotationFromContext = (e?: React.MouseEvent) => {
    // Use tracked mouse position for time calculation
    const canvas = canvasRef.current;
    if (canvas) {
      const x = lastMousePositionRef.current.x;
      const timeAtClick =
        timeWindow[0] + (x / canvas.width) * (timeWindow[1] - timeWindow[0]);
      setClickedTime(timeAtClick);
    }

    setAnnotationText("");
    setAnnotationDialogOpen(true);
  };

  const moveLeft = () => {
    if (!eegData || !eegData.duration) {
      console.warn('moveLeft: No eegData or duration available');
      return;
    }

    const step = (timeWindow[1] - timeWindow[0]) * 0.1;
    const windowDuration = timeWindow[1] - timeWindow[0];

    // Calculate the proposed new start time
    const proposedStartTime = timeWindow[0] - step;
    const proposedEndTime = proposedStartTime + windowDuration;

    // Apply bounds checking - prevent going below 0
    let finalStartTime: number;
    let finalEndTime: number;

    if (proposedStartTime < 0) {
      // Hit the left boundary - clamp to the start
      finalStartTime = 0;
      finalEndTime = Math.min(eegData.duration, windowDuration);
    } else {
      // Normal movement within bounds
      finalStartTime = proposedStartTime;
      finalEndTime = proposedEndTime;
    }

    // Ensure we don't exceed data duration
    finalStartTime = Math.max(0, finalStartTime);
    finalEndTime = Math.min(eegData.duration, finalEndTime);

    // Only move if we're not already at the leftmost position
    if (finalStartTime !== timeWindow[0] || finalEndTime !== timeWindow[1]) {
      onTimeWindowChange([finalStartTime, finalEndTime]);
    }
  };

  const moveRight = () => {
    if (!eegData || !eegData.duration) {
      console.warn('moveRight: No eegData or duration available');
      return;
    }

    const step = (timeWindow[1] - timeWindow[0]) * 0.1;
    const windowDuration = timeWindow[1] - timeWindow[0];

    // Calculate the proposed new start time
    const proposedStartTime = timeWindow[0] + step;
    const proposedEndTime = proposedStartTime + windowDuration;

    // Apply bounds checking - prevent going beyond the data duration
    let finalStartTime: number;
    let finalEndTime: number;

    if (proposedEndTime > eegData.duration) {
      // Hit the right boundary - clamp to the end
      finalEndTime = eegData.duration;
      finalStartTime = Math.max(0, finalEndTime - windowDuration);
    } else {
      // Normal movement within bounds
      finalStartTime = proposedStartTime;
      finalEndTime = proposedEndTime;
    }

    // Ensure we don't have negative start time or exceed duration
    finalStartTime = Math.max(0, finalStartTime);
    finalEndTime = Math.min(eegData.duration, finalEndTime);

    // Check if we've hit the right boundary
    const hitRightBoundary = proposedEndTime > eegData.duration;
    if (hitRightBoundary) {
      console.log('RIGHT BOUNDARY HIT:', {
        proposedEndTime,
        eegDataDuration: eegData.duration,
        finalWindow: [finalStartTime, finalEndTime]
      });
    }

    // Only move if we're not already at the rightmost position
    if (finalStartTime !== timeWindow[0] || finalEndTime !== timeWindow[1]) {
      onTimeWindowChange([finalStartTime, finalEndTime]);
    } else if (hitRightBoundary) {
      console.log('RIGHT BOUNDARY: Already at rightmost position, no movement');
    }
  };

  const handleChartClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      onChartClick?.(e);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const timeAtClick =
        timeWindow[0] + (x / canvas.width) * (timeWindow[1] - timeWindow[0]);

      // Always allow annotation selection, even without edit mode
      if (annotations && onAnnotationSelect) {
        const clickedAnnotation = annotations.find((anno) => {
          const annoX =
            ((anno.startTime - timeWindow[0]) /
              (timeWindow[1] - timeWindow[0])) *
            canvas.width;
          return Math.abs(x - annoX) < 5;
        });

        if (clickedAnnotation) {
          onAnnotationSelect(clickedAnnotation);
          toast({
            title: "Annotation Selected",
            description: clickedAnnotation.text,
          });
          return;
        }
      }

      // Only allow creating annotations via click in edit mode
      if (editMode && onAnnotationAdd) {
        setClickedTime(timeAtClick);
        setAnnotationText("");
        setAnnotationDialogOpen(true);
      }
    },
    [
      editMode,
      onAnnotationAdd,
      onAnnotationSelect,
      annotations,
      timeWindow,
      toast,
      onChartClick,
    ]
  );

  const handleAnnotationSave = () => {
    if (
      !onAnnotationAdd ||
      clickedTime === null ||
      !filePath ||
      !filePath.trim()
    ) {
      let missingItems = [];
      if (!onAnnotationAdd) missingItems.push("annotation handler");
      if (clickedTime === null) missingItems.push("click time");
      if (!filePath || !filePath.trim()) missingItems.push("valid file path");

      toast({
        title: "Error",
        description: `Could not save annotation. Missing: ${missingItems.join(
          ", "
        )}.`,
        variant: "destructive",
      });
      return;
    }

    const annotationStartTimeSamples = Math.round(
      clickedTime * eegData.sampleRate
    );

    onAnnotationAdd({
      filePath,
      startTime: annotationStartTimeSamples,
      text: annotationText,
    });
    toast({ title: "Annotation Added", description: annotationText });
    setAnnotationDialogOpen(false);
    setAnnotationText("");
    setClickedTime(null);
  };

  const handleContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      // Clean up previous listeners and observers
      if (containerRef.current.current && resizeObserverRef.current) {
        resizeObserverRef.current.unobserve(containerRef.current.current);
      }
      if (containerRef.current.current && wheelListenerRef.current) {
        containerRef.current.current.removeEventListener(
          "wheel",
          wheelListenerRef.current
        );
      }

      containerRef.current.current = node;

      if (node) {
        resizeObserverRef.current = new ResizeObserver(() => {
          updateCanvasDimensions();
        });
        resizeObserverRef.current.observe(node);
        updateCanvasDimensions();

        // Create wheel listener with proper typing and options
        const wheelListener = (event: WheelEvent) => {
          // Call handleWheel and stop propagation to prevent conflicts
          handleWheel(event);
          // Don't call stopPropagation here as preventDefault in handleWheel should be sufficient
        };

        wheelListenerRef.current = wheelListener;
        // Use passive: false to ensure preventDefault works
        node.addEventListener("wheel", wheelListener, {
          passive: false,
          capture: false,
        });
      }
    },
    [handleWheel, updateCanvasDimensions]
  );

  useLayoutEffect(() => {
    updateCanvasDimensions();
  }, [height, className, updateCanvasDimensions]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={handleContainerRef}
          className={cn(
            "relative w-full bg-background overflow-hidden select-none",
            className
          )}
          style={{ height }}
          onMouseDown={handleMouseDown}
          onMouseUp={() => setIsDragging(false)}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            setIsDragging(false);
            setHoveredAnnotation(null);
            setHoveredPosition(null);
          }}
        >
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            onClick={handleChartClick}
          />
          <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-50 hover:opacity-100 transition-opacity p-2 bg-background/50 rounded-md">
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={moveLeft}
                title="Pan Left"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={moveRight}
                title="Pan Right"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="text-xs text-muted-foreground text-center">
              Hold Cmd/Ctrl + Scroll to Zoom
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {onAnnotationAdd && filePath && filePath.trim() && (
          <ContextMenuItem onClick={handleAddAnnotationFromContext}>
            <Plus className="h-4 w-4 mr-2" />
            Add Annotation
          </ContextMenuItem>
        )}
      </ContextMenuContent>
      {annotationDialogOpen && (
        <Dialog
          open={annotationDialogOpen}
          onOpenChange={setAnnotationDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Annotation</DialogTitle>
            </DialogHeader>
            <div>
              <Input
                type="text"
                value={annotationText}
                onChange={(e) => setAnnotationText(e.target.value)}
                placeholder="Annotation text..."
                className="w-full"
              />
              <p className="text-sm text-muted-foreground mt-1">
                At time: {clickedTime?.toFixed(2)}s (relative to chunk start)
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setAnnotationDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleAnnotationSave}>Save Annotation</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {hoveredAnnotation !== null && hoveredPosition && (
        <div
          className="absolute p-2 bg-popover text-popover-foreground rounded-md shadow-lg text-xs pointer-events-none z-50"
          style={{
            left: `${hoveredPosition.x + 10}px`,
            top: `${hoveredPosition.y + 10}px`,
            transform: "translateY(-100%)",
          }}
        >
          {annotations.find((ann) => ann.id === hoveredAnnotation)?.text}
        </div>
      )}
    </ContextMenu>
  );
}
