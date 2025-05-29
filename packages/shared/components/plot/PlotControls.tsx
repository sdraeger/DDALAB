"use client";

import { Button } from "../ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Settings as SettingsIcon,
  Loader2,
} from "lucide-react";

interface PlotControlsProps {
  onPrevChunk: () => void;
  onNextChunk: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onShowSettings: () => void;
  isLoading: boolean;
  currentChunkNumber: number;
  totalChunks: number;
  showHeatmap: boolean;
  onToggleHeatmap: () => void;
  isHeatmapProcessing: boolean;
}

export function PlotControls({
  onPrevChunk,
  onNextChunk,
  canGoPrev,
  canGoNext,
  onZoomIn,
  onZoomOut,
  onResetView,
  onShowSettings,
  isLoading,
  currentChunkNumber,
  totalChunks,
  showHeatmap,
  onToggleHeatmap,
  isHeatmapProcessing,
}: PlotControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-b bg-card sticky top-0 z-10">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onPrevChunk}
          disabled={!canGoPrev || isLoading}
          aria-label="Previous Chunk"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          Chunk {currentChunkNumber} / {totalChunks}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={onNextChunk}
          disabled={!canGoNext || isLoading}
          aria-label="Next Chunk"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onZoomIn}
          disabled={isLoading}
          aria-label="Zoom In"
        >
          <ZoomIn className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onZoomOut}
          disabled={isLoading}
          aria-label="Zoom Out"
        >
          <ZoomOut className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onResetView}
          disabled={isLoading}
          aria-label="Reset View"
        >
          <RotateCcw className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={onToggleHeatmap}
          disabled={isHeatmapProcessing || isLoading}
          size="sm"
        >
          {isHeatmapProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {showHeatmap ? "Hide DDA Heatmap" : "Show DDA Heatmap"}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onShowSettings}
          aria-label="Plot Settings"
        >
          <SettingsIcon className="h-5 w-5" />
        </Button>
      </div>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
