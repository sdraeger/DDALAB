"use client";

import * as React from "react";
import { createContext, useContext, useState, useCallback } from "react";

/**
 * Context for announcing status updates to screen readers.
 * Uses aria-live regions to make dynamic content accessible.
 */

interface StatusAnnouncerContextType {
  /** Announce a message to screen readers (polite - waits for idle) */
  announce: (message: string) => void;
  /** Announce an urgent message to screen readers (assertive - interrupts) */
  announceUrgent: (message: string) => void;
}

const StatusAnnouncerContext = createContext<StatusAnnouncerContextType | null>(
  null,
);

export function useStatusAnnouncer() {
  const context = useContext(StatusAnnouncerContext);
  if (!context) {
    // Return no-op functions if provider not found (graceful degradation)
    return {
      announce: () => {},
      announceUrgent: () => {},
    };
  }
  return context;
}

interface StatusAnnouncerProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that renders hidden aria-live regions.
 * Wrap your app with this to enable status announcements.
 *
 * @example
 * ```tsx
 * // In your layout
 * <StatusAnnouncerProvider>
 *   <App />
 * </StatusAnnouncerProvider>
 *
 * // In any component
 * const { announce } = useStatusAnnouncer();
 * announce("File loaded successfully");
 * ```
 */
export function StatusAnnouncerProvider({
  children,
}: StatusAnnouncerProviderProps) {
  const [politeMessage, setPoliteMessage] = useState("");
  const [assertiveMessage, setAssertiveMessage] = useState("");

  const announce = useCallback((message: string) => {
    // Clear first to ensure re-announcement of same message
    setPoliteMessage("");
    // Use requestAnimationFrame to ensure the clear is processed first
    requestAnimationFrame(() => {
      setPoliteMessage(message);
    });
  }, []);

  const announceUrgent = useCallback((message: string) => {
    setAssertiveMessage("");
    requestAnimationFrame(() => {
      setAssertiveMessage(message);
    });
  }, []);

  return (
    <StatusAnnouncerContext.Provider value={{ announce, announceUrgent }}>
      {children}
      {/* Hidden live regions for screen readers */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {politeMessage}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertiveMessage}
      </div>
    </StatusAnnouncerContext.Provider>
  );
}

/**
 * Inline component for announcing loading states.
 * Automatically announces when loading starts/ends.
 *
 * @example
 * ```tsx
 * <LoadingAnnouncer
 *   isLoading={isLoading}
 *   loadingMessage="Loading files..."
 *   completeMessage="Files loaded"
 * />
 * ```
 */
interface LoadingAnnouncerProps {
  isLoading: boolean;
  loadingMessage?: string;
  completeMessage?: string;
}

export function LoadingAnnouncer({
  isLoading,
  loadingMessage = "Loading...",
  completeMessage = "Complete",
}: LoadingAnnouncerProps) {
  const [previousLoading, setPreviousLoading] = React.useState(isLoading);
  const { announce } = useStatusAnnouncer();

  React.useEffect(() => {
    if (isLoading && !previousLoading) {
      announce(loadingMessage);
    } else if (!isLoading && previousLoading) {
      announce(completeMessage);
    }
    setPreviousLoading(isLoading);
  }, [isLoading, previousLoading, loadingMessage, completeMessage, announce]);

  return null;
}

/**
 * Hook for announcing loading state changes.
 *
 * @example
 * ```tsx
 * useLoadingAnnouncement(isLoading, "Analyzing data...", "Analysis complete");
 * ```
 */
export function useLoadingAnnouncement(
  isLoading: boolean,
  loadingMessage: string = "Loading...",
  completeMessage: string = "Complete",
) {
  const previousLoadingRef = React.useRef(isLoading);
  const { announce } = useStatusAnnouncer();

  React.useEffect(() => {
    if (isLoading && !previousLoadingRef.current) {
      announce(loadingMessage);
    } else if (!isLoading && previousLoadingRef.current) {
      announce(completeMessage);
    }
    previousLoadingRef.current = isLoading;
  }, [isLoading, loadingMessage, completeMessage, announce]);
}
