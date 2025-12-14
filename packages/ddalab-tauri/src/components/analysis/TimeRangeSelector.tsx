"use client";

import React, { useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { InfoTooltip } from "@/components/ui/info-tooltip";

export interface TimeRangeSelectorProps {
  startTime: number;
  endTime: number;
  maxDuration: number;
  onStartTimeChange: (value: number) => void;
  onEndTimeChange: (value: number) => void;
  disabled?: boolean;
  showDuration?: boolean;
  className?: string;
}

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = ({
  startTime,
  endTime,
  maxDuration,
  onStartTimeChange,
  onEndTimeChange,
  disabled = false,
  showDuration = true,
  className = "",
}) => {
  const handleStartTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputValue = parseFloat(e.target.value) || 0;
      const clampedValue = Math.max(0, inputValue);

      if (inputValue !== clampedValue) {
        toast.warning(
          "Value Adjusted",
          `Start time cannot be negative. Set to ${clampedValue.toFixed(1)}s`,
        );
      }

      onStartTimeChange(clampedValue);
    },
    [onStartTimeChange],
  );

  const handleEndTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputValue = parseFloat(e.target.value) || 0;
      const minValue = startTime + 0.1;
      const clampedValue = Math.min(
        maxDuration,
        Math.max(minValue, inputValue),
      );

      if (inputValue !== clampedValue) {
        if (inputValue > maxDuration) {
          toast.warning(
            "Value Adjusted",
            `End time cannot exceed file duration. Set to ${clampedValue.toFixed(1)}s`,
          );
        } else if (inputValue < minValue) {
          toast.warning(
            "Value Adjusted",
            `End time must be at least 0.1s after start. Set to ${clampedValue.toFixed(1)}s`,
          );
        }
      }

      onEndTimeChange(clampedValue);
    },
    [startTime, maxDuration, onEndTimeChange],
  );

  const duration = endTime - startTime;

  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Label className="text-sm">Start Time (s)</Label>
          <InfoTooltip content="The beginning of the time range to analyze from your data file" />
        </div>
        <Input
          type="number"
          value={startTime}
          onChange={handleStartTimeChange}
          disabled={disabled}
          min="0"
          max={maxDuration}
          step="0.1"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Valid range: 0 - {maxDuration.toFixed(1)}s
        </p>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Label className="text-sm">End Time (s)</Label>
          <InfoTooltip content="The end of the time range to analyze from your data file" />
        </div>
        <Input
          type="number"
          value={endTime}
          onChange={handleEndTimeChange}
          disabled={disabled}
          min={startTime + 0.1}
          max={maxDuration}
          step="0.1"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Valid range: {(startTime + 0.1).toFixed(1)} - {maxDuration.toFixed(1)}
          s
        </p>
      </div>

      {showDuration && (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
          <span className="font-medium">Analysis Duration:</span>{" "}
          <span className="font-mono">{duration.toFixed(1)}s</span>
        </div>
      )}
    </div>
  );
};
