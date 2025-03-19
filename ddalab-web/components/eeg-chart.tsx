"use client";

import type React from "react";

import { useRef, useEffect, useState, useCallback } from "react";
import { useTheme } from "next-themes";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EEGData } from "./eeg-dashboard";

interface EEGChartProps {
  eegData: EEGData;
  selectedChannels: string[];
  timeWindow: [number, number];
  absoluteTimeWindow?: [number, number]; // Optional absolute time window for x-axis display
  zoomLevel: number;
  onTimeWindowChange: (window: [number, number]) => void;
}

export function EEGChart({
  eegData,
  selectedChannels,
  timeWindow,
  absoluteTimeWindow,
  zoomLevel,
  onTimeWindowChange,
}: EEGChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [currentTimeWindow, setCurrentTimeWindow] =
    useState<[number, number]>(timeWindow);

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

      // Determine zoom direction and factor
      const zoomFactor = e.deltaY < 0 ? 0.95 : 1.05; // Zoom in (0.8) or out (1.25)

      // Calculate new time range
      const newTimeRange = timeRange * zoomFactor;

      // Calculate new time window, keeping mouse position fixed
      const mouseRatio = (mouseTimePosition - currentTimeWindow[0]) / timeRange;
      const newStart = Math.max(
        0,
        mouseTimePosition - mouseRatio * newTimeRange
      );
      const newEnd = Math.min(eegData.duration, newStart + newTimeRange);

      // Adjust if we hit the boundaries
      if (newEnd === eegData.duration) {
        const adjustedStart = Math.max(0, eegData.duration - newTimeRange);
        setCurrentTimeWindow([adjustedStart, eegData.duration]);
        onTimeWindowChange([adjustedStart, eegData.duration]);
      } else {
        setCurrentTimeWindow([newStart, newEnd]);
        onTimeWindowChange([newStart, newEnd]);
      }
    },
    [eegData, currentTimeWindow, onTimeWindowChange]
  );

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

  // Update local state when props change
  useEffect(() => {
    setCurrentTimeWindow(timeWindow);
  }, [timeWindow]);

  // Use absolute time window for display if provided
  const displayTimeWindow = absoluteTimeWindow || currentTimeWindow;

  // Draw the EEG data
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !eegData || selectedChannels.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas dimensions
    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set background
    ctx.fillStyle = theme === "dark" ? "#1e1e2f" : "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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
        canvas.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();

      // Draw time labels - use absolute time if available, otherwise use relative time
      const displayTime = absoluteTimeWindow
        ? (absoluteTimeWindow[0] + t - currentTimeWindow[0]).toFixed(1)
        : t.toFixed(1);

      ctx.fillStyle = theme === "dark" ? "#a0a0b0" : "#666666";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${displayTime}s`, x, canvas.height - 5);
    }

    // Calculate channel height
    const channelHeight = canvas.height / selectedChannels.length;

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
      ctx.lineTo(canvas.width, yOffset + channelHeight / 2);
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
          canvas.width;

        // Normalize the value to the channel height
        const normalizedValue = 1 - (channelData[i] - min) / (max - min);
        const y =
          yOffset - channelHeight * 0.4 + normalizedValue * channelHeight * 0.8;

        if (isFirstPoint) {
          ctx.moveTo(x, y);
          isFirstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
    });
  }, [
    eegData,
    selectedChannels,
    currentTimeWindow,
    theme,
    zoomLevel,
    absoluteTimeWindow,
  ]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Mouse event handlers for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !eegData) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

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
      }
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      // Update parent component with new time window
      onTimeWindowChange(currentTimeWindow);
    }
  };

  const handleMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false);
      // Update parent component with new time window
      onTimeWindowChange(currentTimeWindow);
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

    // Clean up on unmount
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [handleWheel]); // handleWheel contains all the necessary dependencies

  return (
    <div className="relative w-full h-full" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={cn(
          "w-full h-full cursor-grab",
          isDragging && "cursor-grabbing"
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />

      {/* Navigation controls */}
      <div className="absolute bottom-4 right-4 flex gap-2">
        <Button
          variant="secondary"
          size="icon"
          onClick={moveLeft}
          className="h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={moveRight}
          className="h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Time range indicator */}
      <div className="absolute top-2 left-2 text-xs bg-background/80 backdrop-blur-sm px-2 py-1 rounded-md">
        {currentTimeWindow[0].toFixed(1)}s - {currentTimeWindow[1].toFixed(1)}s
        {eegData &&
          ` (${(
            ((currentTimeWindow[1] - currentTimeWindow[0]) / eegData.duration) *
            100
          ).toFixed(1)}%)`}
      </div>
    </div>
  );
}
