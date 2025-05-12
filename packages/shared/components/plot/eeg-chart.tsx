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
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { Label } from "../ui/label";
import { cn } from "../../lib/utils";
import type { EEGData } from "../eeg-dashboard";
import type { Annotation } from "../annotation-editor";
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
  annotations?: Annotation[];
  onAnnotationSelect?: (annotation: Annotation) => void;
  onChartClick?: (event: React.MouseEvent<HTMLCanvasElement>) => void;
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
  annotations,
  onAnnotationSelect,
  onChartClick,
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
  const [zoomSpeedMultiplier, setZoomSpeedMultiplier] = useState(1.0); // Added state for zoom speed

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
  const userZoomFactor = user?.preferences?.eegZoomFactor ?? customZoomFactor;
  const effectiveZoomFactor = userZoomFactor;

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
      if (!eegData || !Array.isArray(eegData.channels)) {
        console.warn(
          "EEGChart: eegData or eegData.channels is undefined or not an array",
          eegData
        );
        return;
      }
      if (selectedChannels.length === 0) return;

      console.debug(
        "[EEGChart] drawEEGData called. EEGData channels available:",
        eegData.channels,
        "Selected channels to draw:",
        selectedChannels
      );

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
        console.log("channelName", channelName);
        console.log("channelIndex", channelIndex);
        console.log("eegData.channels", eegData.channels);

        const channelIdx = eegData.channels.indexOf(channelName);
        if (channelIdx === -1) {
          console.warn(
            `[EEGChart] Channel "${channelName}" not found in eegData.channels. Skipping.`
          );
          return;
        }

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

        // Ensure scaling handles potential edge cases with data range
        const visibleChannelDataSegment = channelData.slice(
          startSample,
          endSample
        );
        const dataMin = Math.min(...visibleChannelDataSegment);
        const dataMax = Math.max(...visibleChannelDataSegment);
        const dataRange = dataMax - dataMin || 1; // Avoid division by zero

        ctx.beginPath();
        ctx.strokeStyle = channelColors[channelIndex % channelColors.length];
        ctx.lineWidth = 1.5;

        // Corrected loop: Iterate from startSample to endSample
        // Use a flag for the first point to handle moveTo correctly.
        let firstPointInPath = true;
        for (
          let currentSampleIdx = startSample;
          currentSampleIdx < endSample;
          currentSampleIdx++
        ) {
          // Calculate time of the current sample
          const sampleTime = currentSampleIdx / eegData.sampleRate;

          // Calculate x-coordinate based on the sample's time relative to the current time window
          const x =
            ((sampleTime - currentTimeWindow[0]) /
              (currentTimeWindow[1] - currentTimeWindow[0])) *
            width;

          // Get the amplitude value for the current sample
          const amplitudeValue = channelData[currentSampleIdx];

          // Calculate y-coordinate
          // Ensure amplitudeValue is a number; fallback if not (though data should be clean)
          const numericAmplitudeValue =
            typeof amplitudeValue === "number" ? amplitudeValue : 0;
          const y =
            yOffset -
            ((numericAmplitudeValue - dataMin) / dataRange - 0.5) * // Use numericAmplitudeValue
              channelHeight *
              0.8; // Scale and center

          if (firstPointInPath) {
            ctx.moveTo(x, y);
            firstPointInPath = false;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      });

      // Draw annotations
      if (annotations && annotations.length > 0) {
        annotations.forEach((annotation) => {
          const annotationTime = annotation.startTime / eegData.sampleRate;
          if (
            annotationTime >= currentTimeWindow[0] &&
            annotationTime <= currentTimeWindow[1]
          ) {
            const x =
              ((annotationTime - currentTimeWindow[0]) /
                (currentTimeWindow[1] - currentTimeWindow[0])) *
              width;

            // Draw a vertical line for the annotation
            ctx.beginPath();
            ctx.strokeStyle =
              annotation.id === hoveredAnnotation ? "#facc15" : "#fb923c"; // Highlight if hovered
            ctx.lineWidth = annotation.id === hoveredAnnotation ? 3 : 2;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            // Optionally, draw text or a marker
            ctx.fillStyle =
              annotation.id === hoveredAnnotation ? "#fde047" : "#fed7aa";
            ctx.font = "bold 12px sans-serif";
            ctx.textAlign = x > width - 50 ? "right" : "left";
            // Truncate text if too long for display
            const displayText =
              annotation.text.length > 20
                ? `${annotation.text.substring(0, 17)}...`
                : annotation.text;
            ctx.fillText(displayText, x + 5, 15);
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
      annotations,
      hoveredAnnotation,
    ]
  );

  // Effect for initial drawing and redraws on data/config changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !eegData || selectedChannels.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Initial draw
    updateCanvasDimensions();

    // Handle resize
    const handleResize = () => {
      updateCanvasDimensions();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [
    eegData,
    selectedChannels,
    currentTimeWindow,
    theme,
    updateCanvasDimensions,
  ]);

  // Sync currentTimeWindow with the prop timeWindow
  useEffect(() => {
    setCurrentTimeWindow(timeWindow);
  }, [timeWindow]);

  useLayoutEffect(() => {
    updateCanvasDimensions();
  }, [height, className, updateCanvasDimensions]); // Redraw if explicit height/class changes

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Only zoom if Meta (Cmd on Mac) or Ctrl key is pressed
      if (!e.metaKey && !e.ctrlKey) {
        return; // Allow default scroll behavior
      }

      e.preventDefault();
      e.stopPropagation();

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Determine zoom direction
      const baseZoomIntensity = 0.1 * effectiveZoomFactor; // Renamed for clarity
      const zoomIntensity = baseZoomIntensity * zoomSpeedMultiplier; // Apply speed multiplier
      let newStartTime, newEndTime;

      const currentRange = currentTimeWindow[1] - currentTimeWindow[0];
      const focusPoint =
        currentTimeWindow[0] + (x / canvas.width) * currentRange;

      if (e.deltaY < 0) {
        // Zoom in
        newStartTime =
          focusPoint -
          (focusPoint - currentTimeWindow[0]) * (1 - zoomIntensity);
        newEndTime =
          focusPoint +
          (currentTimeWindow[1] - focusPoint) * (1 - zoomIntensity);
      } else {
        // Zoom out
        newStartTime =
          focusPoint -
          (focusPoint - currentTimeWindow[0]) * (1 + zoomIntensity);
        newEndTime =
          focusPoint +
          (currentTimeWindow[1] - focusPoint) * (1 + zoomIntensity);
      }

      // Clamp to data bounds
      newStartTime = Math.max(0, newStartTime);
      newEndTime = Math.min(eegData.duration, newEndTime);
      if (newEndTime - newStartTime < 0.1) {
        // Minimum window of 0.1s
        const mid = (newStartTime + newEndTime) / 2;
        newStartTime = mid - 0.05;
        newEndTime = mid + 0.05;
      }
      newStartTime = Math.max(0, newStartTime);
      newEndTime = Math.min(eegData.duration, newEndTime);

      if (newStartTime < newEndTime) {
        setCurrentTimeWindow([newStartTime, newEndTime]);
        onTimeWindowChange([newStartTime, newEndTime]);
      }
    },
    [
      canvasRef,
      currentTimeWindow,
      eegData.duration,
      onTimeWindowChange,
      effectiveZoomFactor,
      setCurrentTimeWindow,
      zoomSpeedMultiplier,
    ]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    setDragStart(e.clientX);
  };

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, [setIsDragging]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (editMode && onAnnotationAdd) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      // const y = e.clientY - rect.top; // y is unused

      let foundAnnotation = false;
      if (annotations) {
        for (const anno of annotations) {
          // Corrected anno.time to anno.startTime
          const annoX =
            ((anno.startTime - currentTimeWindow[0]) /
              (currentTimeWindow[1] - currentTimeWindow[0])) *
            canvas.width;
          if (Math.abs(x - annoX) < 5) {
            // 5px hover radius
            setHoveredAnnotation(anno.id);
            setHoveredPosition({ x: e.clientX, y: e.clientY });
            foundAnnotation = true;
            break;
          }
        }
      }
      if (!foundAnnotation) {
        setHoveredAnnotation(null);
        setHoveredPosition(null);
      }
    }

    if (!isDragging) return;
    const dx = e.clientX - dragStart;
    setDragStart(e.clientX);
    const timePerPixel =
      (currentTimeWindow[1] - currentTimeWindow[0]) / canvas.width;
    const timeShift = dx * timePerPixel;
    const newWindow: [number, number] = [
      currentTimeWindow[0] - timeShift,
      currentTimeWindow[1] - timeShift,
    ];
    setCurrentTimeWindow(newWindow);
    if (
      newWindow[0] !== currentTimeWindow[0] ||
      newWindow[1] !== currentTimeWindow[1]
    ) {
      onTimeWindowChange(newWindow);
    }
  };

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
    setHoveredAnnotation(null);
    setHoveredPosition(null);
  }, [setIsDragging, setHoveredAnnotation, setHoveredPosition]);

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editMode || !onAnnotationAdd) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const timeAtClick =
      currentTimeWindow[0] +
      (x / canvas.width) * (currentTimeWindow[1] - currentTimeWindow[0]);
    setClickedTime(timeAtClick);
    setAnnotationText("");
    setAnnotationDialogOpen(true);
  };

  // Helper to calculate move step (e.g., 10% of the current window)
  const getMoveStep = () => (currentTimeWindow[1] - currentTimeWindow[0]) * 0.1;

  const moveLeft = () => {
    const step = getMoveStep();
    const newStartTime = Math.max(0, currentTimeWindow[0] - step);
    const newEndTime = Math.max(step, currentTimeWindow[1] - step);
    onTimeWindowChange([newStartTime, newEndTime]);
  };

  const moveRight = () => {
    const step = getMoveStep();
    const newStartTime = Math.min(
      eegData.duration - (currentTimeWindow[1] - currentTimeWindow[0]),
      currentTimeWindow[0] + step
    );
    const newEndTime = Math.min(eegData.duration, currentTimeWindow[1] + step);
    onTimeWindowChange([newStartTime, newEndTime]);
  };

  // Placeholder for global preference context if needed for zoom factor

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Use ResizeObserver for more robust container resize detection
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0].contentRect.width && entries[0].contentRect.height) {
        updateCanvasDimensions();
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Call it once to set initial size
    updateCanvasDimensions();

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, [updateCanvasDimensions]); // updateCanvasDimensions dependency

  const handleChartClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (onChartClick) {
        onChartClick(e); // Propagate click to parent if handler is provided
      }

      // Existing logic for edit mode clicks (creating annotations)
      if (editMode && onAnnotationAdd) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const timeAtClick =
          currentTimeWindow[0] +
          (x / canvas.width) * (currentTimeWindow[1] - currentTimeWindow[0]);

        // Check if clicking on an existing annotation to select it
        if (annotations && onAnnotationSelect) {
          for (const anno of annotations) {
            const annoTime = anno.startTime; // Assuming anno.startTime is the precise point in seconds
            const annoX =
              ((annoTime - currentTimeWindow[0]) /
                (currentTimeWindow[1] - currentTimeWindow[0])) *
              canvas.width;
            if (Math.abs(x - annoX) < 5) {
              // 5px click radius for selection
              onAnnotationSelect(anno);
              toast({ title: "Annotation Selected", description: anno.text });
              return; // Don't open new annotation dialog if an existing one is clicked
            }
          }
        }

        // If not clicking an existing annotation, proceed to create a new one
        setClickedTime(timeAtClick);
        setAnnotationText("");
        setAnnotationDialogOpen(true);
      }
    },
    [
      onChartClick,
      editMode,
      onAnnotationAdd,
      canvasRef,
      currentTimeWindow,
      annotations,
      onAnnotationSelect,
      toast,
      setClickedTime,
      setAnnotationText,
      setAnnotationDialogOpen,
    ]
  ); // Added dependencies

  const handleAnnotationSave = () => {
    if (onAnnotationAdd && clickedTime !== null && filePath) {
      const annotationStartTimeSeconds = clickedTime;
      const annotationStartTimeSamples = Math.round(
        annotationStartTimeSeconds * eegData.sampleRate
      );

      onAnnotationAdd({
        filePath,
        startTime: annotationStartTimeSamples, // Convert time to samples
        text: annotationText,
      });
      toast({ title: "Annotation Added", description: annotationText });
      setAnnotationDialogOpen(false);
      setAnnotationText("");
      setClickedTime(null);
    } else {
      toast({
        title: "Error",
        description: "Could not save annotation. Missing data.",
        variant: "destructive",
      });
    }
  };

  // Effect to attach wheel event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const wheelListener = (event: Event) => {
      handleWheel(event as unknown as WheelEvent);
    };

    const listenerOptions = { passive: false } as EventListenerOptions;

    container.addEventListener("wheel", wheelListener, listenerOptions);

    return () => {
      container.removeEventListener("wheel", wheelListener, listenerOptions);
    };
  }, [handleWheel]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full bg-background overflow-hidden select-none",
        className
      )}
      style={{ height: height || "400px" }} // Default or specified height
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu} // Right-click for annotations in edit mode
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onClick={handleChartClick}
      />
      {/* Controls for panning (optional, can be done via drag) */}
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
      {hoveredAnnotation !== null && hoveredPosition && annotations && (
        <div
          className="absolute p-2 bg-popover text-popover-foreground rounded-md shadow-lg text-xs pointer-events-none z-50"
          style={{
            left: `${hoveredPosition.x + 10}px`,
            top: `${hoveredPosition.y + 10}px`,
            transform: "translateY(-100%)", // Position tooltip above cursor
          }}
        >
          {annotations.find((ann) => ann.id === hoveredAnnotation)?.text}
        </div>
      )}
    </div>
  );
}
