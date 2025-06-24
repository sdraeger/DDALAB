"use client";

import { useState, useEffect, useCallback } from "react";
import {
  usePersistentPlots,
  type PersistentPlot,
} from "../../contexts/PersistentPlotsContext";
import { DDAPlot } from "./DDAPlot";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import {
  X,
  Minimize2,
  Maximize2,
  Eye,
  EyeOff,
  BarChart3,
} from "lucide-react";
import { cn } from "../../lib/utils/misc";
import { PersistentEEGPlot } from "./PersistentEEGPlot";
import { useArtifactFromFilePath } from "../../hooks/useArtifactInfo";

interface FloatingPlotWindowProps {
  plot: PersistentPlot;
  onClose: () => void;
  onMinimize: () => void;
  onToggleVisibility: () => void;
  onUpdatePosition: (position: { x: number; y: number }) => void;
  onUpdateSize: (size: { width: number; height: number }) => void;
}

function FloatingPlotWindow({
  plot,
  onClose,
  onMinimize,
  onToggleVisibility,
  onUpdatePosition,
  onUpdateSize,
}: FloatingPlotWindowProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // State for DDA plot
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);

  // Fetch artifact information for this file path
  const { artifactInfo } = useArtifactFromFilePath(plot.filePath);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (
        e.target === e.currentTarget ||
        (e.target as HTMLElement).classList.contains("drag-handle")
      ) {
        setIsDragging(true);
        setDragStart({
          x: e.clientX - plot.position.x,
          y: e.clientY - plot.position.y,
        });
      }
    },
    [plot.position]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        const newPosition = {
          x: Math.max(
            0,
            Math.min(
              window.innerWidth - plot.size.width,
              e.clientX - dragStart.x
            )
          ),
          y: Math.max(
            0,
            Math.min(
              window.innerHeight - plot.size.height,
              e.clientY - dragStart.y
            )
          ),
        };
        onUpdatePosition(newPosition);
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStart.x;
        const deltaY = e.clientY - resizeStart.y;

        const newWidth = Math.max(300, resizeStart.width + deltaX);
        const newHeight = Math.max(200, resizeStart.height + deltaY);

        // Make sure the window doesn't go outside the viewport
        const maxWidth = window.innerWidth - plot.position.x;
        const maxHeight = window.innerHeight - plot.position.y;

        const finalWidth = Math.min(newWidth, maxWidth);
        const finalHeight = Math.min(newHeight, maxHeight);

        onUpdateSize({ width: finalWidth, height: finalHeight });
      }
    },
    [isDragging, isResizing, dragStart, resizeStart, plot.size, plot.position, onUpdatePosition, onUpdateSize]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: plot.size.width,
      height: plot.size.height,
    });
  }, [plot.size]);

  // Channel selection handlers for DDA plot
  const handleChannelSelectionChange = useCallback((channels: string[]) => {
    setSelectedChannels(channels);
  }, []);

  const handleAvailableChannelsChange = useCallback((channels: string[]) => {
    setAvailableChannels(channels);
  }, []);

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  if (plot.isMinimized) return null;

  return (
    <div
      className={cn(
        "fixed bg-background border border-border rounded-lg shadow-2xl z-50 overflow-hidden",
        isDragging && "cursor-move",
        isResizing && "cursor-se-resize"
      )}
      style={{
        left: plot.position.x,
        top: plot.position.y,
        width: plot.size.width,
        height: plot.size.height,
        display: plot.isVisible ? "block" : "none",
      }}
    >
      {/* Window Header */}
      <div
        className="drag-handle flex items-center justify-between p-2 bg-muted border-b cursor-move"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <BarChart3 className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-medium truncate">{plot.fileName}</span>
          <Badge variant="secondary" className="text-xs">
            {plot.plotType.toUpperCase()}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleVisibility}
            className="h-6 w-6 p-0"
            title={plot.isVisible ? "Hide" : "Show"}
          >
            {plot.isVisible ? (
              <EyeOff className="h-3 w-3" />
            ) : (
              <Eye className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onMinimize}
            className="h-6 w-6 p-0"
            title="Minimize"
          >
            <Minimize2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
            title="Close"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Plot Content */}
      <div className="h-[calc(100%-40px)] overflow-hidden">
        {plot.plotType === "eeg" ? (
          <PersistentEEGPlot filePath={plot.filePath} className="h-full" />
        ) : (
          <div className="h-full p-2">
            <DDAPlot
              filePath={plot.filePath}
              selectedChannels={selectedChannels}
              setSelectedChannels={setSelectedChannels}
              onChannelSelectionChange={handleChannelSelectionChange}
              onAvailableChannelsChange={handleAvailableChannelsChange}
              artifactInfo={artifactInfo || undefined}
            />
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-muted/50 hover:bg-muted"
        onMouseDown={handleResizeStart}
      >
        <div className="absolute bottom-1 right-1 w-2 h-2 border-r border-b border-border" />
      </div>
    </div>
  );
}

function MinimizedPlotBar() {
  const { openPlots, restorePlot, removePlot } = usePersistentPlots();
  const minimizedPlots = openPlots.filter((plot) => plot.isMinimized);

  if (minimizedPlots.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 flex items-center gap-2 flex-wrap">
      {minimizedPlots.map((plot) => (
        <Card key={plot.id} className="min-w-0 max-w-64">
          <CardContent className="flex items-center gap-2 p-2">
            <BarChart3 className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="text-sm truncate flex-1">{plot.fileName}</span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => restorePlot(plot.id)}
                className="h-6 w-6 p-0"
                title="Restore"
              >
                <Maximize2 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removePlot(plot.id)}
                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                title="Close"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function PersistentPlotContainer() {
  const {
    openPlots,
    removePlot,
    updatePlot,
    minimizePlot,
    togglePlotVisibility,
  } = usePersistentPlots();

  const visiblePlots = openPlots.filter((plot) => !plot.isMinimized);

  return (
    <>
      {/* Floating Plot Windows */}
      {visiblePlots.map((plot) => (
        <FloatingPlotWindow
          key={plot.id}
          plot={plot}
          onClose={() => removePlot(plot.id)}
          onMinimize={() => minimizePlot(plot.id)}
          onToggleVisibility={() => togglePlotVisibility(plot.id)}
          onUpdatePosition={(position) => updatePlot(plot.id, { position })}
          onUpdateSize={(size) => updatePlot(plot.id, { size })}
        />
      ))}

      {/* Minimized Plots Bar */}
      <MinimizedPlotBar />
    </>
  );
}
