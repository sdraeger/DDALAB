/**
 * QuickFilters Component
 *
 * Compact inline filter controls for data visualization.
 * Provides quick access to common filters without taking up much space.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { PreprocessingOptions } from "@/types/persistence";
import { cn } from "@/lib/utils";
import {
  SlidersHorizontal,
  Waves,
  Zap,
  TrendingDown,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";

interface QuickFiltersProps {
  preprocessing: PreprocessingOptions;
  onPreprocessingChange: (preprocessing: PreprocessingOptions) => void;
  sampleRate?: number;
  className?: string;
}

export function QuickFilters({
  preprocessing,
  onPreprocessingChange,
  sampleRate = 256,
  className,
}: QuickFiltersProps) {
  const setSecondaryNav = useAppStore((state) => state.setSecondaryNav);
  const setPrimaryNav = useAppStore((state) => state.setPrimaryNav);

  // Check which filters are active
  const hasHighpass = !!preprocessing.highpass;
  const hasLowpass = !!preprocessing.lowpass;
  const hasNotch = preprocessing.notch && preprocessing.notch.length > 0;
  const hasAnyFilter = hasHighpass || hasLowpass || hasNotch;

  // Quick toggle handlers
  const toggleHighpass = () => {
    onPreprocessingChange({
      ...preprocessing,
      highpass: hasHighpass ? undefined : 0.5,
    });
  };

  const toggleLowpass = () => {
    onPreprocessingChange({
      ...preprocessing,
      lowpass: hasLowpass ? undefined : 70,
    });
  };

  const toggleNotch = () => {
    onPreprocessingChange({
      ...preprocessing,
      notch: hasNotch ? [] : [50],
    });
  };

  const resetFilters = () => {
    onPreprocessingChange({
      ...preprocessing,
      highpass: undefined,
      lowpass: undefined,
      notch: [],
      baselineCorrection: undefined,
      smoothing: undefined,
      outlierRemoval: undefined,
    });
  };

  const goToPreprocessingPipeline = () => {
    setPrimaryNav("explore");
    setSecondaryNav("preprocessing");
  };

  // Generate filter summary text
  const getFilterSummary = () => {
    const parts: string[] = [];
    if (hasHighpass) parts.push(`HP ${preprocessing.highpass}Hz`);
    if (hasLowpass) parts.push(`LP ${preprocessing.lowpass}Hz`);
    if (hasNotch) parts.push(`Notch ${preprocessing.notch?.[0]}Hz`);
    return parts.length > 0 ? parts.join(" • ") : "No filters";
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Filter indicator / summary */}
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-1.5">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Filters:</span>
        </div>

        {/* Quick toggle buttons */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={hasHighpass ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={toggleHighpass}
              >
                <TrendingDown className="h-3 w-3 mr-1" />
                HP
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Highpass filter - removes slow drifts</p>
              {hasHighpass && (
                <p className="text-xs text-muted-foreground">
                  Currently: {preprocessing.highpass} Hz
                </p>
              )}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={hasLowpass ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={toggleLowpass}
              >
                <Waves className="h-3 w-3 mr-1" />
                LP
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Lowpass filter - removes high-frequency noise</p>
              {hasLowpass && (
                <p className="text-xs text-muted-foreground">
                  Currently: {preprocessing.lowpass} Hz
                </p>
              )}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={hasNotch ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={toggleNotch}
              >
                <Zap className="h-3 w-3 mr-1" />
                Notch
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Notch filter - removes line noise (50/60 Hz)</p>
              {hasNotch && (
                <p className="text-xs text-muted-foreground">
                  Currently: {preprocessing.notch?.[0]} Hz
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Settings popover for fine-tuning */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2">
              <span className="text-xs text-muted-foreground">
                {getFilterSummary()}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="start">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">Filter Settings</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={resetFilters}
                  disabled={!hasAnyFilter}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              </div>

              {/* Highpass */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Highpass (Hz)</Label>
                  <Input
                    type="number"
                    value={preprocessing.highpass ?? ""}
                    onChange={(e) =>
                      onPreprocessingChange({
                        ...preprocessing,
                        highpass: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder="Off"
                    className="w-20 h-7 text-xs"
                    step={0.1}
                    min={0.1}
                    max={sampleRate / 4}
                  />
                </div>
                {hasHighpass && (
                  <Slider
                    value={[preprocessing.highpass || 0.5]}
                    onValueChange={([v]) =>
                      onPreprocessingChange({ ...preprocessing, highpass: v })
                    }
                    min={0.1}
                    max={10}
                    step={0.1}
                    className="py-1"
                  />
                )}
              </div>

              {/* Lowpass */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Lowpass (Hz)</Label>
                  <Input
                    type="number"
                    value={preprocessing.lowpass ?? ""}
                    onChange={(e) =>
                      onPreprocessingChange({
                        ...preprocessing,
                        lowpass: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder="Off"
                    className="w-20 h-7 text-xs"
                    step={1}
                    min={1}
                    max={sampleRate / 2}
                  />
                </div>
                {hasLowpass && (
                  <Slider
                    value={[preprocessing.lowpass || 70]}
                    onValueChange={([v]) =>
                      onPreprocessingChange({ ...preprocessing, lowpass: v })
                    }
                    min={10}
                    max={Math.min(200, sampleRate / 2)}
                    step={1}
                    className="py-1"
                  />
                )}
              </div>

              {/* Notch */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Notch Filter</Label>
                  <div className="flex gap-1">
                    <Button
                      variant={
                        preprocessing.notch?.includes(50)
                          ? "default"
                          : "outline"
                      }
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() =>
                        onPreprocessingChange({
                          ...preprocessing,
                          notch: preprocessing.notch?.includes(50) ? [] : [50],
                        })
                      }
                    >
                      50 Hz
                    </Button>
                    <Button
                      variant={
                        preprocessing.notch?.includes(60)
                          ? "default"
                          : "outline"
                      }
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() =>
                        onPreprocessingChange({
                          ...preprocessing,
                          notch: preprocessing.notch?.includes(60) ? [] : [60],
                        })
                      }
                    >
                      60 Hz
                    </Button>
                  </div>
                </div>
              </div>

              {/* Link to full preprocessing pipeline */}
              <div className="pt-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between text-xs"
                  onClick={goToPreprocessingPipeline}
                >
                  <span>Advanced preprocessing pipeline</span>
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Active filter badges */}
        {hasAnyFilter && (
          <Badge variant="secondary" className="text-xs">
            {[hasHighpass && "HP", hasLowpass && "LP", hasNotch && "Notch"]
              .filter(Boolean)
              .join("+")}
          </Badge>
        )}
      </TooltipProvider>
    </div>
  );
}
