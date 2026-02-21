import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

interface ResizeHandleProps {
  onResize: (width: number) => void;
  currentWidth: number;
  minWidth?: number;
  maxWidth?: number;
}

export function ResizeHandle({
  onResize,
  currentWidth,
  minWidth = 200,
  maxWidth = 600,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartXRef.current;
      const newWidth = dragStartWidthRef.current + deltaX;

      // Clamp width to min/max
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

      onResize(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Change cursor for entire document while dragging
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, onResize, minWidth, maxWidth]);

  const handleMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = currentWidth;
    setIsDragging(true);
  };

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.shiftKey ? 40 : 10;
    const delta = e.key === "ArrowLeft" ? -step : step;
    const nextWidth = Math.max(
      minWidth,
      Math.min(maxWidth, currentWidth + delta),
    );
    onResize(nextWidth);
  };

  return (
    <div
      ref={containerRef}
      className={`
        w-1
        bg-border
        hover:bg-primary
        transition-colors
        duration-200
        cursor-ew-resize
        relative
        flex-shrink-0
        focus-visible:outline-none
        focus-visible:ring-2
        focus-visible:ring-ring
        ${isDragging ? "bg-primary" : ""}
      `}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="slider"
      aria-label="Resize file manager panel"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(currentWidth)}
      aria-orientation="horizontal"
      title="Drag or use arrow keys to resize file manager"
    >
      {/* Visual indicator on hover */}
      <div className="absolute inset-y-0 -left-1 -right-1 hover:bg-primary/10 transition-colors duration-200" />
    </div>
  );
}
