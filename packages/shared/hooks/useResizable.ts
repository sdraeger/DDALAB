import { useState, useCallback, useEffect, useRef } from "react";

interface UseResizableOptions {
  storageKey?: string;
  defaultHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  onHeightChange?: (height: number) => void;
}

interface UseResizableReturn {
  height: number;
  isResizing: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
  resizeHandleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    className: string;
  };
}

export function useResizable({
  storageKey,
  defaultHeight = 400,
  minHeight = 200,
  maxHeight = 800,
  onHeightChange,
}: UseResizableOptions = {}): UseResizableReturn {
  const [height, setHeight] = useState(() => {
    if (!storageKey || typeof window === "undefined") return defaultHeight;

    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsedHeight = parseInt(stored, 10);
      if (
        !isNaN(parsedHeight) &&
        parsedHeight >= minHeight &&
        parsedHeight <= maxHeight
      ) {
        return parsedHeight;
      }
    }
    return defaultHeight;
  });

  const [isResizing, setIsResizing] = useState(false);
  const initialMouseY = useRef(0);
  const initialHeight = useRef(0);

  // Save height to localStorage whenever it changes
  useEffect(() => {
    if (storageKey && typeof window !== "undefined") {
      localStorage.setItem(storageKey, height.toString());
    }
    onHeightChange?.(height);
  }, [height, storageKey, onHeightChange]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const deltaY = e.clientY - initialMouseY.current;
      const newHeight = Math.max(
        minHeight,
        Math.min(maxHeight, initialHeight.current + deltaY)
      );

      setHeight(newHeight);
    },
    [isResizing, minHeight, maxHeight]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Attach global mouse events for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "ns-resize";
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

      initialMouseY.current = e.clientY;
      initialHeight.current = height;
      setIsResizing(true);
    },
    [height]
  );

  const resizeHandleProps = {
    onMouseDown: handleMouseDown,
    className: `
      absolute -bottom-4 left-0 right-0 h-4 cursor-ns-resize
      bg-transparent hover:bg-primary/10 transition-all duration-200
      flex items-center justify-center group
      border-t border-border/30 hover:border-primary/50
    `
      .replace(/\s+/g, " ")
      .trim(),
  };

  return {
    height,
    isResizing,
    handleMouseDown,
    resizeHandleProps,
  };
}
