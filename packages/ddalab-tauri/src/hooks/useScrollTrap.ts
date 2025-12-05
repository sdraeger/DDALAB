/**
 * Scroll trap prevention utilities
 *
 * Prevents accidental scroll capture by nested scrollable containers.
 * Users often intend to scroll the outer container but get "trapped"
 * in an inner scrollable element.
 */

import React, { useCallback, useRef, useEffect, useState } from "react";

export interface UseScrollTrapOptions {
  /**
   * Delay in ms before enabling inner scroll after mouse enters
   * @default 150
   */
  activationDelay?: number;

  /**
   * Whether to require a modifier key (Ctrl/Cmd) to scroll inner container
   * @default false
   */
  requireModifier?: boolean;

  /**
   * Whether to pass through scroll when inner container can't scroll further
   * @default true
   */
  passThrough?: boolean;
}

/**
 * Hook to prevent scroll trapping in nested containers.
 *
 * By default, requires a brief hover (150ms) before enabling inner scroll,
 * preventing accidental scroll capture when quickly moving through the UI.
 *
 * @example
 * ```tsx
 * function ChannelList() {
 *   const { containerProps, isScrollEnabled } = useScrollTrap();
 *
 *   return (
 *     <div
 *       {...containerProps}
 *       className={cn(
 *         "h-64",
 *         isScrollEnabled ? "overflow-auto" : "overflow-hidden"
 *       )}
 *     >
 *       {channels.map(ch => <ChannelItem key={ch} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useScrollTrap(options: UseScrollTrapOptions = {}) {
  const {
    activationDelay = 150,
    requireModifier = false,
    passThrough = true,
  } = options;

  const [isScrollEnabled, setIsScrollEnabled] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (requireModifier) {
      // When modifier required, enable immediately (modifier check happens in wheel)
      setIsScrollEnabled(true);
      return;
    }

    // Delay before enabling scroll to prevent accidental capture
    timeoutRef.current = setTimeout(() => {
      setIsScrollEnabled(true);
    }, activationDelay);
  }, [activationDelay, requireModifier]);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsScrollEnabled(false);
  }, []);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const container = containerRef.current;
      if (!container) return;

      // If modifier required, check it
      if (requireModifier && !e.ctrlKey && !e.metaKey) {
        // Let parent handle scroll
        return;
      }

      // If scroll not enabled yet, let it pass through
      if (!isScrollEnabled) {
        return;
      }

      // Check if container can scroll in the wheel direction
      const canScrollDown =
        container.scrollTop < container.scrollHeight - container.clientHeight;
      const canScrollUp = container.scrollTop > 0;

      const isScrollingDown = e.deltaY > 0;
      const isScrollingUp = e.deltaY < 0;

      // Only capture scroll if container can scroll in that direction
      const shouldCapture =
        (isScrollingDown && canScrollDown) || (isScrollingUp && canScrollUp);

      if (shouldCapture) {
        e.stopPropagation();
      } else if (passThrough) {
        // At scroll boundary - let parent handle
        return;
      }
    },
    [isScrollEnabled, requireModifier, passThrough],
  );

  // Attach wheel listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const setRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
  }, []);

  return {
    /** Whether scroll is currently enabled for this container */
    isScrollEnabled,

    /** Ref to attach to the scrollable container */
    ref: setRef,

    /** Props to spread on the container element */
    containerProps: {
      ref: setRef,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      style: {
        overscrollBehavior: "contain" as const,
      },
    },

    /** Manually enable scroll (useful for focus events) */
    enableScroll: () => setIsScrollEnabled(true),

    /** Manually disable scroll */
    disableScroll: () => setIsScrollEnabled(false),
  };
}

/**
 * CSS class utility for scroll trap prevention.
 * Use when you need a simpler CSS-only solution.
 *
 * @example
 * ```tsx
 * <div className={scrollTrapClasses.container}>
 *   <div className={scrollTrapClasses.inner}>
 *     Scrollable content
 *   </div>
 * </div>
 * ```
 */
export const scrollTrapClasses = {
  /** Apply to outer container */
  container: "overflow-auto",

  /** Apply to inner scrollable elements - contains scroll and prevents chaining */
  inner: "overflow-auto overscroll-contain",

  /**
   * Apply to inner elements that should only scroll on hover
   * Requires Tailwind's group/hover pattern
   */
  innerOnHover: "overflow-hidden hover:overflow-auto overscroll-contain",
} as const;

/**
 * Props for creating a scroll trap container wrapper.
 * Use with useScrollTrap hook in your component.
 *
 * @example
 * ```tsx
 * function MyScrollableList({ children }: { children: React.ReactNode }) {
 *   const { containerProps, isScrollEnabled } = useScrollTrap();
 *
 *   return (
 *     <div
 *       {...containerProps}
 *       className={cn(
 *         "h-64",
 *         isScrollEnabled ? "overflow-auto" : "overflow-hidden"
 *       )}
 *     >
 *       {children}
 *     </div>
 *   );
 * }
 * ```
 */
export interface ScrollTrapContainerProps {
  children: React.ReactNode;
  /** Options for scroll trap behavior */
  options?: UseScrollTrapOptions;
  /** Additional className when scroll is enabled */
  enabledClassName?: string;
  /** Additional className when scroll is disabled */
  disabledClassName?: string;
}
