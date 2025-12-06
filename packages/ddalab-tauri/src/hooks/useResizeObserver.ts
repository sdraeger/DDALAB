import { useEffect, useRef, useCallback, useState } from "react";

interface Size {
  width: number;
  height: number;
}

interface UseResizeObserverOptions {
  /** Minimum change in pixels to trigger a resize callback (default: 5) */
  threshold?: number;
  /** Initial width if container not yet mounted */
  defaultWidth?: number;
  /** Initial height if container not yet mounted */
  defaultHeight?: number;
}

/**
 * Hook for observing element resize with debouncing to prevent infinite loops.
 * Useful for chart libraries that need to resize with their container.
 */
export function useResizeObserver<T extends HTMLElement = HTMLDivElement>(
  options: UseResizeObserverOptions = {},
): {
  ref: React.RefObject<T | null>;
  size: Size;
} {
  const { threshold = 5, defaultWidth = 800, defaultHeight = 300 } = options;

  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({
    width: defaultWidth,
    height: defaultHeight,
  });
  const lastSizeRef = useRef<Size>({
    width: defaultWidth,
    height: defaultHeight,
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Initialize with current size
    const initialWidth = element.clientWidth || defaultWidth;
    const initialHeight = element.clientHeight || defaultHeight;
    setSize({ width: initialWidth, height: initialHeight });
    lastSizeRef.current = { width: initialWidth, height: initialHeight };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = Math.floor(entry.contentRect.width);
        const newHeight = Math.floor(entry.contentRect.height);

        // Only update if dimensions changed significantly
        if (
          newWidth > 0 &&
          newHeight > 0 &&
          (Math.abs(newWidth - lastSizeRef.current.width) > threshold ||
            Math.abs(newHeight - lastSizeRef.current.height) > threshold)
        ) {
          lastSizeRef.current = { width: newWidth, height: newHeight };
          setSize({ width: newWidth, height: newHeight });
        }
      }
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [threshold, defaultWidth, defaultHeight]);

  return { ref, size };
}

/**
 * Hook for managing uPlot instance lifecycle with automatic resize handling.
 * Returns a callback ref and handles cleanup.
 */
export function useChartResize(
  onResize: (width: number, height: number) => void,
  options: UseResizeObserverOptions = {},
): React.RefObject<HTMLDivElement | null> {
  const { threshold = 5 } = options;
  const ref = useRef<HTMLDivElement | null>(null);
  const lastSizeRef = useRef<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = Math.floor(entry.contentRect.width);
        const newHeight = Math.floor(entry.contentRect.height);

        if (
          newWidth > 0 &&
          newHeight > 0 &&
          (Math.abs(newWidth - lastSizeRef.current.width) > threshold ||
            Math.abs(newHeight - lastSizeRef.current.height) > threshold)
        ) {
          lastSizeRef.current = { width: newWidth, height: newHeight };
          onResize(newWidth, newHeight);
        }
      }
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [onResize, threshold]);

  return ref;
}
