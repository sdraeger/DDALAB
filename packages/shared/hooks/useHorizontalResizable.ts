import { useState, useCallback, useEffect, useRef } from "react";

interface UseHorizontalResizableOptions {
  storageKey?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  onWidthChange?: (width: number) => void;
}

interface UseHorizontalResizableReturn {
  width: number;
  isResizing: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
  resizeHandleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    className: string;
  };
}

export function useHorizontalResizable({
  storageKey,
  defaultWidth = 300,
  minWidth = 200,
  maxWidth = 600,
  onWidthChange,
}: UseHorizontalResizableOptions = {}): UseHorizontalResizableReturn {
  const [width, setWidth] = useState(() => {
    if (!storageKey || typeof window === "undefined") return defaultWidth;

    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsedWidth = parseInt(stored, 10);
      if (
        !isNaN(parsedWidth) &&
        parsedWidth >= minWidth &&
        parsedWidth <= maxWidth
      ) {
        return parsedWidth;
      }
    }
    return defaultWidth;
  });

  const [isResizing, setIsResizing] = useState(false);
  const initialMouseX = useRef(0);
  const initialWidth = useRef(0);

  // Save width to localStorage whenever it changes
  useEffect(() => {
    if (storageKey && typeof window !== "undefined") {
      localStorage.setItem(storageKey, width.toString());
    }
    onWidthChange?.(width);
  }, [width, storageKey, onWidthChange]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const deltaX = e.clientX - initialMouseX.current;
      const newWidth = Math.max(
        minWidth,
        Math.min(maxWidth, initialWidth.current + deltaX)
      );

      setWidth(newWidth);
    },
    [isResizing, minWidth, maxWidth]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Attach global mouse events for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      initialMouseX.current = e.clientX;
      initialWidth.current = width;
      setIsResizing(true);
    },
    [width]
  );

  const resizeHandleProps = {
    onMouseDown: handleMouseDown,
    className: `
      absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize
      bg-transparent hover:bg-primary/10 transition-all duration-200
      flex items-center justify-center group
      border-l border-border/30 hover:border-primary/50
    `
      .replace(/\s+/g, " ")
      .trim(),
  };

  return {
    width,
    isResizing,
    handleMouseDown,
    resizeHandleProps,
  };
}
