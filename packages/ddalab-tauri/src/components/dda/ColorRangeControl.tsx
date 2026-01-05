"use client";

import { memo, useState, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ColorRangeControlProps {
  colorRange: [number, number];
  onColorRangeChange: (range: [number, number]) => void;
  autoScale: boolean;
  onAutoScaleChange: (autoScale: boolean) => void;
}

export const ColorRangeControl = memo(function ColorRangeControl({
  colorRange,
  onColorRangeChange,
  autoScale,
  onAutoScaleChange,
}: ColorRangeControlProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleMinChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newMin = parseFloat(e.target.value);
      if (isNaN(newMin)) {
        setValidationError("Min must be a number");
        return;
      }
      if (newMin >= colorRange[1]) {
        setValidationError("Min must be less than Max");
        return;
      }
      setValidationError(null);
      onColorRangeChange([newMin, colorRange[1]]);
    },
    [colorRange, onColorRangeChange],
  );

  const handleMaxChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newMax = parseFloat(e.target.value);
      if (isNaN(newMax)) {
        setValidationError("Max must be a number");
        return;
      }
      if (newMax <= colorRange[0]) {
        setValidationError("Max must be greater than Min");
        return;
      }
      setValidationError(null);
      onColorRangeChange([colorRange[0], newMax]);
    },
    [colorRange, onColorRangeChange],
  );

  const hasError = colorRange[0] >= colorRange[1];

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border/50">
        <span className="text-sm font-medium text-muted-foreground">
          Color Range
        </span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Min</Label>
            <input
              type="number"
              value={colorRange[0].toFixed(2)}
              onChange={handleMinChange}
              disabled={autoScale}
              className={cn(
                "w-20 h-8 px-2 text-sm border rounded-md bg-background transition-colors focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed",
                hasError && !autoScale && "border-destructive",
              )}
              step="0.1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Max</Label>
            <input
              type="number"
              value={colorRange[1].toFixed(2)}
              onChange={handleMaxChange}
              disabled={autoScale}
              className={cn(
                "w-20 h-8 px-2 text-sm border rounded-md bg-background transition-colors focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed",
                hasError && !autoScale && "border-destructive",
              )}
              step="0.1"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none ml-auto">
          <input
            type="checkbox"
            checked={autoScale}
            onChange={(e) => onAutoScaleChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary transition-colors"
          />
          <span className="text-muted-foreground">Auto Scale</span>
        </label>
      </div>
      {validationError && !autoScale && (
        <p className="text-xs text-destructive px-3">{validationError}</p>
      )}
    </div>
  );
});
