"use client";

import React, {
  useMemo,
  useCallback,
  useState,
  useRef,
  useEffect,
} from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Focus,
  Eye,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatSecondsToDHMS } from "@/utils/timeFormat";

interface ViewPreset {
  id: string;
  name: string;
  icon: React.ReactNode;
  windowSeconds: number;
  description: string;
}

const VIEW_PRESETS: ViewPreset[] = [
  {
    id: "micro",
    name: "Micro",
    icon: <Focus className="h-3.5 w-3.5" />,
    windowSeconds: 1,
    description: "1 second - detailed waveform",
  },
  {
    id: "detail",
    name: "Detail",
    icon: <Eye className="h-3.5 w-3.5" />,
    windowSeconds: 5,
    description: "5 seconds - default view",
  },
  {
    id: "context",
    name: "Context",
    icon: <ZoomOut className="h-3.5 w-3.5" />,
    windowSeconds: 15,
    description: "15 seconds - broader context",
  },
  {
    id: "overview",
    name: "Overview",
    icon: <Maximize2 className="h-3.5 w-3.5" />,
    windowSeconds: 60,
    description: "60 seconds - full overview",
  },
];

interface ChunkNavigatorProps {
  currentTime: number; // in seconds
  timeWindow: number; // in seconds
  duration: number; // total file duration in seconds
  loading?: boolean;
  disabled?: boolean;
  onSeek: (time: number) => void;
  onTimeWindowChange: (window: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  className?: string;
}

export function ChunkNavigator({
  currentTime,
  timeWindow,
  duration,
  loading = false,
  disabled = false,
  onSeek,
  onTimeWindowChange,
  onPrev,
  onNext,
  className,
}: ChunkNavigatorProps) {
  const [jumpToInput, setJumpToInput] = useState("");
  const [isEditingTime, setIsEditingTime] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Calculate viewing range
  const viewStart = currentTime;
  const viewEnd = Math.min(currentTime + timeWindow, duration);
  const viewPercent =
    duration > 0 ? ((viewEnd - viewStart) / duration) * 100 : 0;
  const positionPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Determine active preset
  const activePreset = useMemo(() => {
    return (
      VIEW_PRESETS.find((p) => Math.abs(p.windowSeconds - timeWindow) < 0.5)
        ?.id || null
    );
  }, [timeWindow]);

  // Handle preset selection
  const handlePresetSelect = useCallback(
    (preset: ViewPreset) => {
      // Clamp window to not exceed duration
      const newWindow = Math.min(preset.windowSeconds, duration);
      onTimeWindowChange(newWindow);

      // If current position would go beyond file, adjust it
      if (currentTime + newWindow > duration) {
        onSeek(Math.max(0, duration - newWindow));
      }
    },
    [duration, currentTime, onTimeWindowChange, onSeek],
  );

  // Handle time input
  const handleJumpTo = useCallback(() => {
    if (!jumpToInput.trim()) {
      setIsEditingTime(false);
      return;
    }

    // Parse time input - supports formats: "1:30", "90", "1m30s", "1:30.5"
    let seconds = 0;
    const input = jumpToInput.trim().toLowerCase();

    // Try mm:ss or hh:mm:ss format
    if (input.includes(":")) {
      const parts = input.split(":").map((p) => parseFloat(p) || 0);
      if (parts.length === 2) {
        seconds = parts[0] * 60 + parts[1];
      } else if (parts.length === 3) {
        seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }
    // Try "XmYs" format
    else if (input.includes("m") || input.includes("s")) {
      const minMatch = input.match(/(\d+(?:\.\d+)?)\s*m/);
      const secMatch = input.match(/(\d+(?:\.\d+)?)\s*s/);
      if (minMatch) seconds += parseFloat(minMatch[1]) * 60;
      if (secMatch) seconds += parseFloat(secMatch[1]);
    }
    // Plain number (seconds)
    else {
      seconds = parseFloat(input) || 0;
    }

    // Clamp to valid range
    const clampedTime = Math.max(0, Math.min(seconds, duration - timeWindow));
    onSeek(clampedTime);
    setJumpToInput("");
    setIsEditingTime(false);
  }, [jumpToInput, duration, timeWindow, onSeek]);

  // Handle keyboard shortcuts in input
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleJumpTo();
      } else if (e.key === "Escape") {
        setIsEditingTime(false);
        setJumpToInput("");
      }
    },
    [handleJumpTo],
  );

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingTime && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingTime]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    const newWindow = Math.max(1, timeWindow / 2);
    onTimeWindowChange(newWindow);
  }, [timeWindow, onTimeWindowChange]);

  const handleZoomOut = useCallback(() => {
    const newWindow = Math.min(duration, timeWindow * 2);
    onTimeWindowChange(newWindow);
    // Adjust position if needed
    if (currentTime + newWindow > duration) {
      onSeek(Math.max(0, duration - newWindow));
    }
  }, [timeWindow, duration, currentTime, onTimeWindowChange, onSeek]);

  // Step navigation (move by 10% of window)
  const stepSize = Math.max(0.1, timeWindow * 0.1);

  const handleStepBack = useCallback(() => {
    onSeek(Math.max(0, currentTime - stepSize));
  }, [currentTime, stepSize, onSeek]);

  const handleStepForward = useCallback(() => {
    onSeek(Math.min(duration - timeWindow, currentTime + stepSize));
  }, [currentTime, stepSize, duration, timeWindow, onSeek]);

  const isDisabled = disabled || loading;

  return (
    <div className={cn("space-y-3", className)}>
      {/* View Presets */}
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide shrink-0">
          View
        </Label>
        <div className="flex gap-1 flex-1">
          {VIEW_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant={activePreset === preset.id ? "default" : "outline"}
              size="sm"
              onClick={() => handlePresetSelect(preset)}
              disabled={isDisabled || preset.windowSeconds > duration}
              className={cn(
                "flex-1 h-8 text-xs gap-1.5 px-2",
                activePreset === preset.id && "ring-1 ring-primary",
              )}
              title={preset.description}
            >
              {preset.icon}
              <span className="hidden sm:inline">{preset.name}</span>
              <span className="text-[10px] text-muted-foreground hidden md:inline">
                {preset.windowSeconds}s
              </span>
            </Button>
          ))}
        </div>
        <div className="flex gap-1 shrink-0">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleZoomIn}
            disabled={isDisabled || timeWindow <= 1}
            title="Zoom in (halve window size)"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleZoomOut}
            disabled={isDisabled || timeWindow >= duration}
            title="Zoom out (double window size)"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Position Navigator */}
      <div className="bg-muted/30 rounded-lg p-3 space-y-2">
        {/* Time Display / Jump To */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {isEditingTime ? (
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  type="text"
                  value={jumpToInput}
                  onChange={(e) => setJumpToInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  onBlur={() => {
                    if (!jumpToInput.trim()) {
                      setIsEditingTime(false);
                    }
                  }}
                  placeholder="0:00 or 90s"
                  className="w-24 h-7 text-sm"
                />
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handleJumpTo}
                >
                  Go
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setIsEditingTime(false);
                    setJumpToInput("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setJumpToInput(currentTime.toFixed(1));
                  setIsEditingTime(true);
                }}
                className="text-sm font-mono hover:bg-accent/50 px-2 py-0.5 rounded transition-colors"
                title="Click to jump to specific time"
              >
                <span className="font-semibold">
                  {formatSecondsToDHMS(viewStart, { precision: 2 })}
                </span>
                <span className="text-muted-foreground mx-1">-</span>
                <span className="font-semibold">
                  {formatSecondsToDHMS(viewEnd, { precision: 2 })}
                </span>
              </button>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">{timeWindow.toFixed(1)}s</span>
            <span className="mx-1">/</span>
            <span>{formatSecondsToDHMS(duration, { precision: 1 })}</span>
            <span className="ml-2 text-primary font-medium">
              ({viewPercent.toFixed(1)}% visible)
            </span>
          </div>
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center gap-2">
          {/* Skip to start */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onSeek(0)}
            disabled={isDisabled || currentTime === 0}
            title="Go to start"
            aria-label="Go to start"
          >
            <SkipBack className="h-4 w-4" aria-hidden="true" />
          </Button>

          {/* Step back */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onPrev || handleStepBack}
            disabled={isDisabled || currentTime <= 0}
            title={`Step back ${stepSize.toFixed(1)}s`}
            aria-label="Step back"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>

          {/* Position Slider */}
          <div className="flex-1 relative">
            <Slider
              value={[currentTime]}
              onValueChange={([time]) => onSeek(time)}
              min={0}
              max={Math.max(0, duration - timeWindow)}
              step={0.1}
              disabled={isDisabled}
              className="py-2"
            />
            {/* Visual indicator of viewing window on slider track */}
            <div
              className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-primary/30 rounded pointer-events-none"
              style={{
                left: `${positionPercent}%`,
                width: `${Math.min(viewPercent, 100 - positionPercent)}%`,
              }}
            />
          </div>

          {/* Step forward */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onNext || handleStepForward}
            disabled={isDisabled || currentTime >= duration - timeWindow}
            title={`Step forward ${stepSize.toFixed(1)}s`}
            aria-label="Step forward"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>

          {/* Skip to end */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onSeek(Math.max(0, duration - timeWindow))}
            disabled={isDisabled || currentTime >= duration - timeWindow}
            title="Go to end"
            aria-label="Go to end"
          >
            <SkipForward className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Time Window Slider (fine control) */}
        <div className="flex items-center gap-3 pt-1">
          <Label className="text-xs text-muted-foreground shrink-0 w-16">
            Window:
          </Label>
          <Slider
            value={[timeWindow]}
            onValueChange={([window]) => {
              onTimeWindowChange(window);
              // Adjust position if needed
              if (currentTime + window > duration) {
                onSeek(Math.max(0, duration - window));
              }
            }}
            min={1}
            max={Math.min(120, duration)}
            step={1}
            disabled={isDisabled}
            className="flex-1"
          />
          <div className="text-xs font-mono text-muted-foreground w-12 text-right">
            {timeWindow.toFixed(0)}s
          </div>
        </div>
      </div>
    </div>
  );
}
