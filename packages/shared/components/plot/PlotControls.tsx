"use client";

import { Button } from "../ui/button";
import { ChunkSelector } from "../ui/ChunkSelector";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Settings as SettingsIcon,
  Loader2,
  Zap,
  ZapOff,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { ArtifactIdentifier, type ArtifactInfo } from "../ui/ArtifactIdentifier";

export interface PlotControlsProps {
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
  onChunkSelect?: (chunkNumber: number) => void;
  hasHeatmapData?: boolean;
  artifactInfo?: ArtifactInfo;
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
  onChunkSelect,
  hasHeatmapData = false,
  artifactInfo,
}: PlotControlsProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* Artifact Information Header */}
      {artifactInfo && (
        <ArtifactIdentifier artifact={artifactInfo} variant="header" />
      )}

      {/* Plot Controls */}
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
          {onChunkSelect ? (
            <ChunkSelector
              currentChunk={currentChunkNumber}
              totalChunks={totalChunks}
              onChunkSelect={onChunkSelect}
              variant="compact"
            />
          ) : (
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              Chunk {currentChunkNumber} / {totalChunks}
            </span>
          )}
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
          {hasHeatmapData && (
            <Badge
              variant={showHeatmap ? "default" : "secondary"}
              className="flex items-center gap-1 cursor-pointer transition-colors hover:bg-primary/80"
              onClick={onToggleHeatmap}
            >
              {isHeatmapProcessing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : showHeatmap ? (
                <Zap className="h-3 w-3" />
              ) : (
                <ZapOff className="h-3 w-3" />
              )}
              <span className="text-xs">
                {isHeatmapProcessing
                  ? "Processing..."
                  : showHeatmap
                    ? "DDA Results Active"
                    : "DDA Results Available"
                }
              </span>
            </Badge>
          )}

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
    </div>
  );
}
