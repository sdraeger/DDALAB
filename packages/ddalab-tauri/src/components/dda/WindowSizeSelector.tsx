"use client";

import React, { useMemo, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";
import { Zap, Target, Microscope, Settings2 } from "lucide-react";

interface WindowPreset {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  windowLengthMs: number; // in milliseconds
  overlapPercent: number; // 0-99
}

const PRESETS: WindowPreset[] = [
  {
    id: "fast",
    name: "Fast",
    icon: <Zap className="h-4 w-4" />,
    description: "Quick analysis, lower resolution",
    windowLengthMs: 100,
    overlapPercent: 50,
  },
  {
    id: "standard",
    name: "Standard",
    icon: <Target className="h-4 w-4" />,
    description: "Balanced speed and accuracy",
    windowLengthMs: 250,
    overlapPercent: 75,
  },
  {
    id: "detailed",
    name: "Detailed",
    icon: <Microscope className="h-4 w-4" />,
    description: "High temporal resolution",
    windowLengthMs: 500,
    overlapPercent: 90,
  },
];

type DisplayUnit = "samples" | "ms";

interface WindowSizeSelectorProps {
  windowLength: number; // in samples
  windowStep: number; // in samples
  sampleRate: number;
  duration: number; // file duration in seconds
  disabled?: boolean;
  onWindowLengthChange: (samples: number) => void;
  onWindowStepChange: (samples: number) => void;
  className?: string;
}

export function WindowSizeSelector({
  windowLength,
  windowStep,
  sampleRate,
  duration,
  disabled = false,
  onWindowLengthChange,
  onWindowStepChange,
  className,
}: WindowSizeSelectorProps) {
  const [displayUnit, setDisplayUnit] = React.useState<DisplayUnit>("ms");
  const [activePreset, setActivePreset] = React.useState<string | null>(null);

  // Convert samples to ms
  const samplesToMs = useCallback(
    (samples: number) => (samples / sampleRate) * 1000,
    [sampleRate]
  );

  // Convert ms to samples
  const msToSamples = useCallback(
    (ms: number) => Math.round((ms / 1000) * sampleRate),
    [sampleRate]
  );

  // Calculate overlap percentage from window length and step
  const overlapPercent = useMemo(() => {
    if (windowLength <= 0) return 0;
    const overlap = windowLength - windowStep;
    return Math.round((overlap / windowLength) * 100);
  }, [windowLength, windowStep]);

  // Calculate step from overlap percentage
  const overlapToStep = useCallback(
    (overlap: number, length: number) => {
      const step = Math.round(length * (1 - overlap / 100));
      return Math.max(1, step); // Minimum step of 1
    },
    []
  );

  // Calculate analysis stats
  const analysisStats = useMemo(() => {
    const totalSamples = duration * sampleRate;
    const numWindows = Math.floor((totalSamples - windowLength) / windowStep) + 1;
    const effectiveStep = windowStep / sampleRate;
    const temporalResolution = effectiveStep * 1000; // in ms

    return {
      numWindows: Math.max(0, numWindows),
      temporalResolution,
      windowDurationMs: samplesToMs(windowLength),
    };
  }, [duration, sampleRate, windowLength, windowStep, samplesToMs]);

  // Check if current settings match a preset
  React.useEffect(() => {
    const windowMs = samplesToMs(windowLength);
    const matchingPreset = PRESETS.find(
      (p) =>
        Math.abs(p.windowLengthMs - windowMs) < 10 &&
        Math.abs(p.overlapPercent - overlapPercent) < 5
    );
    setActivePreset(matchingPreset?.id || null);
  }, [windowLength, overlapPercent, samplesToMs]);

  // Apply a preset
  const applyPreset = useCallback(
    (preset: WindowPreset) => {
      const newLength = msToSamples(preset.windowLengthMs);
      const newStep = overlapToStep(preset.overlapPercent, newLength);
      onWindowLengthChange(newLength);
      onWindowStepChange(newStep);
    },
    [msToSamples, overlapToStep, onWindowLengthChange, onWindowStepChange]
  );

  // Handle window length change
  const handleWindowLengthChange = useCallback(
    (value: number, unit: DisplayUnit) => {
      const samples = unit === "ms" ? msToSamples(value) : value;
      const clampedSamples = Math.max(10, Math.min(samples, sampleRate * 2)); // 10 samples to 2 seconds
      onWindowLengthChange(clampedSamples);
      // Adjust step to maintain overlap percentage
      const newStep = overlapToStep(overlapPercent, clampedSamples);
      onWindowStepChange(newStep);
    },
    [msToSamples, sampleRate, overlapPercent, overlapToStep, onWindowLengthChange, onWindowStepChange]
  );

  // Handle overlap change
  const handleOverlapChange = useCallback(
    (newOverlap: number) => {
      const newStep = overlapToStep(newOverlap, windowLength);
      onWindowStepChange(newStep);
    },
    [windowLength, overlapToStep, onWindowStepChange]
  );

  // Get display value based on unit
  const getDisplayValue = useCallback(
    (samples: number) => {
      if (displayUnit === "ms") {
        return samplesToMs(samples).toFixed(0);
      }
      return samples.toString();
    },
    [displayUnit, samplesToMs]
  );

  // Parse input value based on unit
  const parseInputValue = useCallback(
    (value: string): number => {
      const num = parseFloat(value) || 0;
      if (displayUnit === "ms") {
        return msToSamples(num);
      }
      return Math.round(num);
    },
    [displayUnit, msToSamples]
  );

  // Window length slider range based on sample rate
  const windowLengthRange = useMemo(() => {
    const minMs = 50; // 50ms minimum
    const maxMs = 1000; // 1000ms maximum
    return {
      min: msToSamples(minMs),
      max: msToSamples(maxMs),
      minMs,
      maxMs,
    };
  }, [msToSamples]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Presets */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Quick Presets
          </Label>
          <InfoTooltip
            content={
              <div className="space-y-1 text-sm">
                <p className="font-medium">Window Presets</p>
                <p>Choose a preset to quickly configure window settings optimized for different analysis needs.</p>
              </div>
            }
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant={activePreset === preset.id ? "default" : "outline"}
              size="sm"
              onClick={() => applyPreset(preset)}
              disabled={disabled}
              className={cn(
                "flex flex-col items-center gap-1 h-auto py-2 px-3",
                activePreset === preset.id && "ring-2 ring-primary ring-offset-1"
              )}
            >
              <div className="flex items-center gap-1.5">
                {preset.icon}
                <span className="font-medium">{preset.name}</span>
              </div>
              <span className="text-[10px] text-muted-foreground font-normal">
                {preset.windowLengthMs}ms / {preset.overlapPercent}%
              </span>
            </Button>
          ))}
        </div>
      </div>

      {/* Custom Settings */}
      <div className="space-y-4 pt-2 border-t">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Custom Settings
            </Label>
          </div>
          <Select
            value={displayUnit}
            onValueChange={(v) => setDisplayUnit(v as DisplayUnit)}
            disabled={disabled}
          >
            <SelectTrigger className="w-24 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ms">ms</SelectItem>
              <SelectItem value="samples">samples</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Window Length */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Window Length</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={getDisplayValue(windowLength)}
                onChange={(e) => {
                  const samples = parseInputValue(e.target.value);
                  handleWindowLengthChange(samples, "samples");
                }}
                disabled={disabled}
                className="w-20 h-8 text-sm text-right"
                min={displayUnit === "ms" ? 50 : windowLengthRange.min}
                max={displayUnit === "ms" ? 1000 : windowLengthRange.max}
              />
              <span className="text-xs text-muted-foreground w-12">
                {displayUnit}
              </span>
            </div>
          </div>
          <Slider
            value={[windowLength]}
            onValueChange={([value]) => handleWindowLengthChange(value, "samples")}
            min={windowLengthRange.min}
            max={windowLengthRange.max}
            step={Math.max(1, Math.round(windowLengthRange.max / 100))}
            disabled={disabled}
            className="py-2"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{windowLengthRange.minMs}ms</span>
            <span className="font-medium text-foreground">
              {samplesToMs(windowLength).toFixed(0)}ms ({windowLength} samples)
            </span>
            <span>{windowLengthRange.maxMs}ms</span>
          </div>
        </div>

        {/* Overlap Percentage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Window Overlap</Label>
              <InfoTooltip
                content={
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">Window Overlap</p>
                    <p>Higher overlap = more windows = smoother time series but longer computation.</p>
                    <p className="text-xs mt-1">Step size: {windowStep} samples ({samplesToMs(windowStep).toFixed(1)}ms)</p>
                  </div>
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={overlapPercent}
                onChange={(e) => {
                  const value = Math.max(0, Math.min(99, parseInt(e.target.value) || 0));
                  handleOverlapChange(value);
                }}
                disabled={disabled}
                className="w-16 h-8 text-sm text-right"
                min={0}
                max={99}
              />
              <span className="text-xs text-muted-foreground w-12">%</span>
            </div>
          </div>
          <Slider
            value={[overlapPercent]}
            onValueChange={([value]) => handleOverlapChange(value)}
            min={0}
            max={99}
            step={1}
            disabled={disabled}
            className="py-2"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0% (no overlap)</span>
            <span className="font-medium text-foreground">{overlapPercent}%</span>
            <span>99% (max overlap)</span>
          </div>
        </div>
      </div>

      {/* Analysis Summary */}
      <div className="bg-muted/50 rounded-lg p-3 space-y-1">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Analysis Preview
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-lg font-semibold text-primary">
              {analysisStats.numWindows.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">Windows</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-primary">
              {analysisStats.windowDurationMs.toFixed(0)}
            </div>
            <div className="text-[10px] text-muted-foreground">ms / window</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-primary">
              {analysisStats.temporalResolution.toFixed(1)}
            </div>
            <div className="text-[10px] text-muted-foreground">ms resolution</div>
          </div>
        </div>
        {analysisStats.numWindows > 10000 && (
          <p className="text-[10px] text-amber-600 mt-2 text-center">
            High window count may increase computation time
          </p>
        )}
        {analysisStats.numWindows < 10 && (
          <p className="text-[10px] text-amber-600 mt-2 text-center">
            Low window count may reduce analysis accuracy
          </p>
        )}
      </div>
    </div>
  );
}
