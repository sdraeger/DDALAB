"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RotateCcw } from "lucide-react";
import { ViewModeSelector, ViewMode } from "@/components/dda/ViewModeSelector";
import {
  ColorSchemePicker,
  ColorScheme,
} from "@/components/dda/ColorSchemePicker";

interface PlotToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  colorScheme: ColorScheme;
  onColorSchemeChange: (scheme: ColorScheme) => void;
  hasNetworkMotifs: boolean;
  onResetZoom: () => void;
  onResetAll: () => void;
}

export const PlotToolbar = memo(function PlotToolbar({
  viewMode,
  onViewModeChange,
  colorScheme,
  onColorSchemeChange,
  hasNetworkMotifs,
  onResetZoom,
  onResetAll,
}: PlotToolbarProps) {
  const showColorScheme = viewMode === "heatmap" || viewMode === "all";

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* View Mode Toggle */}
      <ViewModeSelector
        value={viewMode}
        onValueChange={onViewModeChange}
        hasNetworkMotifs={hasNetworkMotifs}
      />

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Color Scheme (visible for heatmap views) */}
      {showColorScheme && (
        <ColorSchemePicker
          value={colorScheme}
          onValueChange={onColorSchemeChange}
        />
      )}

      {/* Spacer to push actions to the right */}
      <div className="flex-1" />

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetZoom}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcw className="h-4 w-4 mr-1.5" />
          Reset Zoom
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetAll}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcw className="h-4 w-4 mr-1.5" />
          Reset All
        </Button>
      </div>
    </div>
  );
});
