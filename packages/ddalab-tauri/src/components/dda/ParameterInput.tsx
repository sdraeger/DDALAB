"use client";

import React, { useState, useEffect, useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";

type TimeUnit = "samples" | "ms" | "s";

interface ParameterInputProps {
  label: string;
  value: number; // Always in samples
  onChange: (samples: number) => void;
  sampleRate: number; // Hz
  disabled?: boolean;
  min?: number; // In samples
  max?: number; // In samples
  step?: number; // In samples
  tooltip?: React.ReactNode;
  className?: string;
  defaultUnit?: TimeUnit;
  allowedUnits?: TimeUnit[];
}

export function ParameterInput({
  label,
  value,
  onChange,
  sampleRate,
  disabled = false,
  min,
  max,
  step = 1,
  tooltip,
  className,
  defaultUnit = "samples",
  allowedUnits = ["samples", "ms", "s"],
}: ParameterInputProps) {
  const [unit, setUnit] = useState<TimeUnit>(defaultUnit);
  const [displayValue, setDisplayValue] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [constraintInfo, setConstraintInfo] = useState<string | null>(null);
  const errorId = useId();
  const inputId = useId();

  // Convert samples to the current unit
  const samplesToUnit = (samples: number, targetUnit: TimeUnit): number => {
    switch (targetUnit) {
      case "samples":
        return samples;
      case "ms":
        return (samples / sampleRate) * 1000;
      case "s":
        return samples / sampleRate;
    }
  };

  // Convert from current unit to samples
  const unitToSamples = (val: number, fromUnit: TimeUnit): number => {
    switch (fromUnit) {
      case "samples":
        return Math.round(val);
      case "ms":
        return Math.round((val / 1000) * sampleRate);
      case "s":
        return Math.round(val * sampleRate);
    }
  };

  // Update display value when value or unit changes
  useEffect(() => {
    const converted = samplesToUnit(value, unit);
    setDisplayValue(converted.toFixed(unit === "samples" ? 0 : 3));
  }, [value, unit, sampleRate]);

  const handleValueChange = (inputValue: string) => {
    setDisplayValue(inputValue);

    // Validate input
    if (inputValue.trim() === "") {
      setValidationError("Value is required");
      return;
    }

    const numericValue = parseFloat(inputValue);
    if (isNaN(numericValue)) {
      setValidationError("Please enter a valid number");
      return;
    }

    if (numericValue < 0) {
      setValidationError("Value must be positive");
      return;
    }

    const samplesValue = unitToSamples(numericValue, unit);

    // Apply min/max constraints in samples
    let constrainedValue = samplesValue;
    let wasConstrained = false;

    if (min !== undefined && constrainedValue < min) {
      constrainedValue = min;
      wasConstrained = true;
    }
    if (max !== undefined && constrainedValue > max) {
      constrainedValue = max;
      wasConstrained = true;
    }

    setValidationError(null);
    if (wasConstrained) {
      const minDisplay =
        min !== undefined
          ? samplesToUnit(min, unit).toFixed(unit === "samples" ? 0 : 2)
          : "";
      const maxDisplay =
        max !== undefined
          ? samplesToUnit(max, unit).toFixed(unit === "samples" ? 0 : 2)
          : "";
      setConstraintInfo(
        `Adjusted to ${min !== undefined && constrainedValue === min ? "minimum" : "maximum"} (${minDisplay && maxDisplay ? `${minDisplay}–${maxDisplay}` : minDisplay || maxDisplay} ${unit})`,
      );
      // Clear the info message after 3 seconds
      setTimeout(() => setConstraintInfo(null), 3000);
    } else {
      setConstraintInfo(null);
    }

    onChange(constrainedValue);
  };

  const handleUnitChange = (newUnit: TimeUnit) => {
    setUnit(newUnit);
    // Display value will be updated by the useEffect
  };

  const getStepForUnit = (): string => {
    switch (unit) {
      case "samples":
        return step.toString();
      case "ms":
        return "0.1";
      case "s":
        return "0.001";
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Label htmlFor={inputId} className="text-sm">
          {label}
        </Label>
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className="flex gap-2">
        <Input
          id={inputId}
          type="number"
          value={displayValue}
          onChange={(e) => handleValueChange(e.target.value)}
          disabled={disabled}
          step={getStepForUnit()}
          className={cn(
            "flex-1",
            validationError &&
              "border-destructive focus-visible:ring-destructive",
          )}
          aria-invalid={!!validationError}
          aria-describedby={validationError ? errorId : undefined}
        />
        <Select
          value={unit}
          onValueChange={handleUnitChange}
          disabled={disabled}
        >
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowedUnits.includes("samples") && (
              <SelectItem value="samples">samples</SelectItem>
            )}
            {allowedUnits.includes("ms") && (
              <SelectItem value="ms">ms</SelectItem>
            )}
            {allowedUnits.includes("s") && <SelectItem value="s">s</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      {validationError ? (
        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="text-xs text-destructive"
        >
          {validationError}
        </p>
      ) : constraintInfo ? (
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-amber-700 dark:text-amber-300 animate-in fade-in duration-200"
        >
          {constraintInfo}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          = {value} samples ({(value / sampleRate).toFixed(3)}s)
        </p>
      )}
    </div>
  );
}
