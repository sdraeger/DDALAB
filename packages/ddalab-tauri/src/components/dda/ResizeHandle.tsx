/**
 * ResizeHandle Component
 *
 * Accessible drag handle for resizing plot heights.
 * Supports mouse drag and keyboard arrow key controls.
 * Extracted from DDAResults.tsx to reduce duplication.
 */

import { memo, useCallback } from "react";

interface ResizeHandleProps {
  plotType: "heatmap" | "lineplot";
  currentHeight: number;
  onHeightChange: (newHeight: number) => void;
  minHeight?: number;
  maxHeight?: number;
}

export const ResizeHandle = memo(function ResizeHandle({
  plotType,
  currentHeight,
  onHeightChange,
  minHeight = 200,
  maxHeight = 1200,
}: ResizeHandleProps) {
  const label = plotType === "heatmap" ? "heatmap" : "line plot";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = currentHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaY = moveEvent.clientY - startY;
        const newHeight = Math.max(
          minHeight,
          Math.min(maxHeight, startHeight + deltaY),
        );
        onHeightChange(newHeight);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [currentHeight, minHeight, maxHeight, onHeightChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 50 : 10;

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? -step : step;
        const newHeight = Math.max(
          minHeight,
          Math.min(maxHeight, currentHeight + delta),
        );
        onHeightChange(newHeight);
      }
    },
    [currentHeight, minHeight, maxHeight, onHeightChange],
  );

  return (
    <div
      className="flex items-center justify-center py-3 mt-2 cursor-ns-resize hover:bg-accent focus:bg-accent focus:outline-none focus:ring-2 focus:ring-ring transition-colors border-t"
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="slider"
      aria-label={`Resize ${label} height. Use up/down arrow keys to adjust.`}
      aria-valuenow={currentHeight}
      aria-valuemin={minHeight}
      aria-valuemax={maxHeight}
      aria-orientation="vertical"
      title={`Drag or use arrow keys to resize ${label} height`}
    >
      <div className="w-16 h-1.5 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground/60 transition-colors" />
    </div>
  );
});
