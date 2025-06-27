import { useState, useEffect, useCallback } from "react";

const WELCOME_WIDGET_DISMISSED_KEY = "ddalab-welcome-widget-dismissed";

export interface UseWelcomeWidgetOptions {
  /**
   * Whether to show the welcome widget by default on first visit
   */
  showByDefault?: boolean;
  /**
   * Custom storage key for the dismissed state
   */
  storageKey?: string;
}

export interface UseWelcomeWidgetResult {
  /**
   * Whether the welcome widget should be shown
   */
  shouldShowWelcome: boolean;
  /**
   * Mark the welcome widget as dismissed (will not show again)
   */
  dismissWelcome: () => void;
  /**
   * Reset the welcome widget state (will show again)
   */
  resetWelcome: () => void;
  /**
   * Whether the user has previously dismissed the welcome widget
   */
  hasBeenDismissed: boolean;
}

/**
 * Hook for managing welcome widget visibility state
 *
 * The welcome widget will show by default on first visit and can be permanently
 * dismissed by the user. The dismissed state is persisted in localStorage.
 */
export function useWelcomeWidget(
  options: UseWelcomeWidgetOptions = {}
): UseWelcomeWidgetResult {
  const { showByDefault = true, storageKey = WELCOME_WIDGET_DISMISSED_KEY } =
    options;

  const [hasBeenDismissed, setHasBeenDismissed] = useState<boolean>(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize from localStorage on mount
  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(storageKey);
      if (dismissed === "true") {
        setHasBeenDismissed(true);
      }
    } catch (error) {
      console.warn(
        "Failed to read welcome widget state from localStorage:",
        error
      );
    }
    setIsInitialized(true);
  }, [storageKey]);

  const dismissWelcome = useCallback(() => {
    try {
      localStorage.setItem(storageKey, "true");
      setHasBeenDismissed(true);
    } catch (error) {
      console.warn(
        "Failed to save welcome widget state to localStorage:",
        error
      );
      // Still update the state even if localStorage fails
      setHasBeenDismissed(true);
    }
  }, [storageKey]);

  const resetWelcome = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
      setHasBeenDismissed(false);
    } catch (error) {
      console.warn(
        "Failed to reset welcome widget state in localStorage:",
        error
      );
      // Still update the state even if localStorage fails
      setHasBeenDismissed(false);
    }
  }, [storageKey]);

  // Calculate shouldShowWelcome based on initialization and dismissal state
  const shouldShowWelcome = isInitialized && showByDefault && !hasBeenDismissed;

  return {
    shouldShowWelcome,
    dismissWelcome,
    resetWelcome,
    hasBeenDismissed,
  };
}
