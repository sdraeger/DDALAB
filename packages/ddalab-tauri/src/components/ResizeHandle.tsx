import { useEffect, useRef, useState } from "react";

interface ResizeHandleProps {
  onResize: (width: number) => void;
  initialWidth: number;
  minWidth?: number;
  maxWidth?: number;
}

export function ResizeHandle({
  onResize,
  initialWidth,
  minWidth = 200,
  maxWidth = 600,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Get the new width based on mouse X position
      const newWidth = e.clientX;

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

  return (
    <div
      ref={containerRef}
      className={`
        w-1
        bg-border
        hover:bg-primary
        transition-colors
        cursor-ew-resize
        relative
        flex-shrink-0
        ${isDragging ? "bg-primary" : ""}
      `}
      onMouseDown={() => setIsDragging(true)}
      title="Drag to resize file manager"
    >
      {/* Visual indicator on hover */}
      <div className="absolute inset-y-0 -left-1 -right-1 hover:bg-primary/10 transition-colors" />
    </div>
  );
}
