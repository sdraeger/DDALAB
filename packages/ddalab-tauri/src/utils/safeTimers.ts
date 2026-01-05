/**
 * Safe Timer Management Utility
 *
 * Provides utilities for managing setTimeout and requestAnimationFrame
 * with proper cleanup to prevent memory leaks and stale callbacks
 * after component unmount.
 */

import { useRef, useEffect, useCallback } from "react";

/**
 * A collection of timer IDs for cleanup
 */
export class TimerManager {
  private timeouts: Set<ReturnType<typeof setTimeout>> = new Set();
  private intervals: Set<ReturnType<typeof setInterval>> = new Set();
  private rafs: Set<number> = new Set();

  /**
   * Create a managed setTimeout that will be automatically cleaned up
   */
  setTimeout(
    callback: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.timeouts.delete(id);
      callback();
    }, delay);
    this.timeouts.add(id);
    return id;
  }

  /**
   * Clear a specific timeout
   */
  clearTimeout(id: ReturnType<typeof setTimeout>): void {
    clearTimeout(id);
    this.timeouts.delete(id);
  }

  /**
   * Create a managed setInterval that will be automatically cleaned up
   */
  setInterval(
    callback: () => void,
    delay: number,
  ): ReturnType<typeof setInterval> {
    const id = setInterval(callback, delay);
    this.intervals.add(id);
    return id;
  }

  /**
   * Clear a specific interval
   */
  clearInterval(id: ReturnType<typeof setInterval>): void {
    clearInterval(id);
    this.intervals.delete(id);
  }

  /**
   * Create a managed requestAnimationFrame that will be automatically cleaned up
   */
  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = requestAnimationFrame((time) => {
      this.rafs.delete(id);
      callback(time);
    });
    this.rafs.add(id);
    return id;
  }

  /**
   * Cancel a specific animation frame
   */
  cancelAnimationFrame(id: number): void {
    cancelAnimationFrame(id);
    this.rafs.delete(id);
  }

  /**
   * Clear all managed timers
   */
  clearAll(): void {
    this.timeouts.forEach((id) => clearTimeout(id));
    this.timeouts.clear();

    this.intervals.forEach((id) => clearInterval(id));
    this.intervals.clear();

    this.rafs.forEach((id) => cancelAnimationFrame(id));
    this.rafs.clear();
  }

  /**
   * Get count of active timers (useful for debugging)
   */
  getActiveCount(): { timeouts: number; intervals: number; rafs: number } {
    return {
      timeouts: this.timeouts.size,
      intervals: this.intervals.size,
      rafs: this.rafs.size,
    };
  }
}

/**
 * React hook for safe timer management
 *
 * All timers created through this hook will be automatically
 * cleaned up when the component unmounts.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const timers = useSafeTimers();
 *
 *   const handleClick = () => {
 *     timers.setTimeout(() => {
 *       console.log("This won't fire if component unmounts");
 *     }, 1000);
 *   };
 *
 *   return <button onClick={handleClick}>Click me</button>;
 * }
 * ```
 */
export function useSafeTimers(): TimerManager {
  const managerRef = useRef<TimerManager | null>(null);

  // Lazy initialization
  if (!managerRef.current) {
    managerRef.current = new TimerManager();
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      managerRef.current?.clearAll();
    };
  }, []);

  return managerRef.current;
}

/**
 * React hook for a safe setTimeout that cleans up on unmount
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const safeSetTimeout = useSafeTimeout();
 *
 *   useEffect(() => {
 *     safeSetTimeout(() => {
 *       console.log("Safe!");
 *     }, 1000);
 *   }, []);
 * }
 * ```
 */
export function useSafeTimeout(): (
  callback: () => void,
  delay: number,
) => void {
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((id) => clearTimeout(id));
      timeoutsRef.current.clear();
    };
  }, []);

  return useCallback((callback: () => void, delay: number) => {
    const id = setTimeout(() => {
      timeoutsRef.current.delete(id);
      callback();
    }, delay);
    timeoutsRef.current.add(id);
  }, []);
}

/**
 * React hook for a safe setInterval that cleans up on unmount
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { setInterval, clearInterval } = useSafeInterval();
 *
 *   useEffect(() => {
 *     const id = setInterval(() => {
 *       console.log("Tick");
 *     }, 1000);
 *
 *     return () => clearInterval(id);
 *   }, []);
 * }
 * ```
 */
export function useSafeInterval(): {
  setInterval: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
} {
  const intervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());

  useEffect(() => {
    return () => {
      intervalsRef.current.forEach((id) => clearInterval(id));
      intervalsRef.current.clear();
    };
  }, []);

  const safeSetInterval = useCallback((callback: () => void, delay: number) => {
    const id = setInterval(callback, delay);
    intervalsRef.current.add(id);
    return id;
  }, []);

  const safeClearInterval = useCallback(
    (id: ReturnType<typeof setInterval>) => {
      clearInterval(id);
      intervalsRef.current.delete(id);
    },
    [],
  );

  return { setInterval: safeSetInterval, clearInterval: safeClearInterval };
}

/**
 * React hook for safe requestAnimationFrame that cleans up on unmount
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { requestAnimationFrame, cancelAnimationFrame } = useSafeRAF();
 *
 *   useEffect(() => {
 *     const animate = () => {
 *       // Animation logic
 *       requestAnimationFrame(animate);
 *     };
 *     requestAnimationFrame(animate);
 *   }, []);
 * }
 * ```
 */
export function useSafeRAF(): {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
} {
  const rafsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    return () => {
      rafsRef.current.forEach((id) => cancelAnimationFrame(id));
      rafsRef.current.clear();
    };
  }, []);

  const safeRAF = useCallback((callback: FrameRequestCallback) => {
    const id = requestAnimationFrame((time) => {
      rafsRef.current.delete(id);
      callback(time);
    });
    rafsRef.current.add(id);
    return id;
  }, []);

  const safeCancelRAF = useCallback((id: number) => {
    cancelAnimationFrame(id);
    rafsRef.current.delete(id);
  }, []);

  return {
    requestAnimationFrame: safeRAF,
    cancelAnimationFrame: safeCancelRAF,
  };
}

/**
 * Debounced callback with cleanup
 *
 * @example
 * ```tsx
 * function SearchComponent() {
 *   const debouncedSearch = useDebouncedCallback((query: string) => {
 *     fetch(`/search?q=${query}`);
 *   }, 300);
 *
 *   return <input onChange={(e) => debouncedSearch(e.target.value)} />;
 * }
 * ```
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => void>(
  callback: T,
  delay: number,
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);

  // Update callback ref on each render
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback(
    ((...args: unknown[]) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    }) as T,
    [delay],
  );
}
