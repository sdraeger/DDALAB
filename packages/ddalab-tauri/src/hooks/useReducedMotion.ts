/**
 * Hook to detect user's preference for reduced motion.
 * Respects the prefers-reduced-motion media query.
 */

import { useState, useEffect } from "react";

/**
 * Returns true if the user prefers reduced motion.
 * This helps disable animations for users who have motion sensitivity.
 */
export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check if we're in a browser environment
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Set initial value
    setPrefersReducedMotion(mediaQuery.matches);

    // Listen for changes
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return prefersReducedMotion;
}

/**
 * Returns animation duration based on reduced motion preference.
 * Returns 0 if user prefers reduced motion, otherwise returns the provided duration.
 */
export function useAnimationDuration(durationMs: number): number {
  const prefersReducedMotion = useReducedMotion();
  return prefersReducedMotion ? 0 : durationMs;
}

/**
 * Returns CSS class names for animations that respect reduced motion.
 * @param animationClass - The animation class to apply when motion is allowed
 * @param fallbackClass - Optional class to apply when motion is reduced
 */
export function useMotionSafeClass(
  animationClass: string,
  fallbackClass?: string,
): string {
  const prefersReducedMotion = useReducedMotion();
  return prefersReducedMotion ? (fallbackClass ?? "") : animationClass;
}
