"use client";

import React, {
  useRef,
  useCallback,
  useLayoutEffect,
  MutableRefObject,
  useState,
} from "react";
import { useTheme } from "next-themes";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { Label } from "../ui/label";
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
  const [zoomSpeedMultiplier, setZoomSpeedMultiplier] = useState(1.0);
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
    const channelHeight = height / selectedChannels.length;

    selectedChannels.forEach((channelName, channelIndex) => {
      const channelIdx = eegData.channels.indexOf(channelName);
      if (channelIdx === -1) return;

      const yOffset = channelHeight * channelIndex + channelHeight / 2;
      ctx.fillStyle = theme === "dark" ? "#ffffff" : "#000000";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(channelName, 5, yOffset - channelHeight / 2 + 15);

      ctx.strokeStyle = gridColor;
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
      const visibleData = channelData.slice(startSample, endSample);
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
        const y =
          yOffset -
          ((amplitude - dataMin) / dataRange - 0.5) * channelHeight * 0.8;

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

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const currentRange = timeWindow[1] - timeWindow[0];
      const focusPoint = timeWindow[0] + (x / canvas.width) * currentRange;
      const zoomIntensity = 0.1 * effectiveZoomFactor * zoomSpeedMultiplier;

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
    [
      timeWindow,
      eegData.duration,
      effectiveZoomFactor,
      zoomSpeedMultiplier,
      onTimeWindowChange,
    ]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    setDragStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (editMode && onAnnotationAdd) {
      const rect = canvas.getBoundingClientRect();
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
    const newWindow: [number, number] = [
      timeWindow[0] - dx * timePerPixel,
      timeWindow[1] - dx * timePerPixel,
    ];
    onTimeWindowChange(newWindow);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editMode || !onAnnotationAdd) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const timeAtClick =
      timeWindow[0] + (x / canvas.width) * (timeWindow[1] - timeWindow[0]);
    setClickedTime(timeAtClick);
    setAnnotationText("");
    setAnnotationDialogOpen(true);
  };

  const moveLeft = () => {
    const step = (timeWindow[1] - timeWindow[0]) * 0.1;
    const newStartTime = Math.max(0, timeWindow[0] - step);
    const newEndTime = Math.max(step, timeWindow[1] - step);
    onTimeWindowChange([newStartTime, newEndTime]);
  };

  const moveRight = () => {
    const step = (timeWindow[1] - timeWindow[0]) * 0.1;
    const newStartTime = Math.min(
      eegData.duration - (timeWindow[1] - timeWindow[0]),
      timeWindow[0] + step
    );
    const newEndTime = Math.min(eegData.duration, timeWindow[1] + step);
    onTimeWindowChange([newStartTime, newEndTime]);
  };

  const handleChartClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      onChartClick?.(e);

      if (!editMode || !onAnnotationAdd) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const timeAtClick =
        timeWindow[0] + (x / canvas.width) * (timeWindow[1] - timeWindow[0]);

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

      setClickedTime(timeAtClick);
      setAnnotationText("");
      setAnnotationDialogOpen(true);
    },
    [
      editMode,
      onAnnotationAdd,
      onAnnotationSelect,
      annotations,
      timeWindow,
      toast,
    ]
  );

  const handleAnnotationSave = () => {
    if (!onAnnotationAdd || clickedTime === null || !filePath) {
      toast({
        title: "Error",
        description: "Could not save annotation. Missing data.",
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

        const wheelListener = (event: WheelEvent) => handleWheel(event);
        wheelListenerRef.current = wheelListener;
        node.addEventListener("wheel", wheelListener, { passive: false });
      }
    },
    [handleWheel, updateCanvasDimensions]
  );

  useLayoutEffect(() => {
    updateCanvasDimensions();
  }, [height, className, updateCanvasDimensions]);

  return (
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
      onContextMenu={handleContextMenu}
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
        <div className="flex flex-col gap-1 items-center">
          <Label htmlFor="zoomSpeedSlider" className="text-xs">
            Zoom Speed: {zoomSpeedMultiplier.toFixed(1)}x
          </Label>
          <Slider
            id="zoomSpeedSlider"
            min={0.1}
            max={5.0}
            step={0.1}
            defaultValue={[1.0]}
            value={[zoomSpeedMultiplier]}
            onValueChange={(value) => setZoomSpeedMultiplier(value[0])}
            className="w-24"
          />
        </div>
      </div>
      {editMode && annotationDialogOpen && (
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
    </div>
  );
}
