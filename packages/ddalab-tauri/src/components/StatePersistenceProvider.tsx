"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TauriService } from "@/services/tauriService";
import { windowManager } from "@/utils/windowManager";

interface StatePersistenceProviderProps {
  children: React.ReactNode;
}

/**
 * Provides state persistence functionality throughout the app lifecycle
 */
export function StatePersistenceProvider({
  children,
}: StatePersistenceProviderProps) {
  const initializeFromTauri = useAppStore((state) => state.initializeFromTauri);
  const forceSave = useAppStore((state) => state.forceSave);
  const saveCurrentState = useAppStore((state) => state.saveCurrentState);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    // Initialize state persistence when component mounts
    const initialize = async () => {
      if (!isInitializedRef.current && !isInitialized) {
        try {
          console.log("Initializing state persistence...");
          await initializeFromTauri();
          isInitializedRef.current = true;
          console.log("State persistence initialized successfully");
        } catch (error) {
          console.error("Failed to initialize state persistence:", error);
        }
      }
    };

    initialize();
  }, [initializeFromTauri, isInitialized]);

  useEffect(() => {
    if (!TauriService.isTauri() || !isInitialized) return;

    let isCleaningUp = false;

    // Set up window close handler
    const setupWindowCloseHandler = async () => {
      try {
        // Initialize windowManager listeners for popout window cleanup events
        await windowManager.initializeListeners();

        // Only handle close events for the main window
        // Popout windows have their own close handling in PopoutDashboard
        const currentWindow = getCurrentWindow();
        const isMainWindow = currentWindow.label === "main";

        if (!isMainWindow) {
          console.log(
            "[StatePersistenceProvider] Skipping close handler for non-main window:",
            currentWindow.label,
          );
          return () => {};
        }

        // Listen for window close events (main window only)
        const unlistenClose = await listen(
          "tauri://close-requested",
          async (event) => {
            console.log(
              "[StatePersistenceProvider] Main window close requested, saving state...",
            );
            console.log("[StatePersistenceProvider] Event details:", event);

            // Mark app as closing BEFORE saving - this prevents popout windows
            // from cleaning up their state before we can persist it
            windowManager.setAppClosing(true);

            try {
              console.log(
                "[StatePersistenceProvider] Calling saveCurrentState...",
              );
              await saveCurrentState();
              console.log(
                "[StatePersistenceProvider] saveCurrentState complete, calling forceSave...",
              );
              await forceSave();
              console.log(
                "[StatePersistenceProvider] State saved successfully before close",
              );
            } catch (error) {
              console.error(
                "[StatePersistenceProvider] Failed to save state before close:",
                error,
              );
            }

            // Safety: If close was cancelled and we're still here after a delay,
            // reset the closing flag to allow window creation again
            setTimeout(() => {
              // If we're still running after 2 seconds, the close was likely cancelled
              windowManager.setAppClosing(false);
            }, 2000);
          },
        );

        // Listen for app focus/blur events to trigger saves
        const unlistenFocus = await listen("tauri://focus", () => {
          console.debug("App gained focus");
        });

        const unlistenBlur = await listen("tauri://blur", async () => {
          console.debug("App lost focus, saving state...");
          try {
            await saveCurrentState();
          } catch (error) {
            console.error("Failed to save state on blur:", error);
          }
        });

        return () => {
          if (!isCleaningUp) {
            unlistenClose();
            unlistenFocus();
            unlistenBlur();
          }
        };
      } catch (error) {
        console.error("Failed to set up window event listeners:", error);
        return () => {};
      }
    };

    // Set up periodic auto-save (as backup to the service's auto-save)
    const setupAutoSave = () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }

      saveIntervalRef.current = setInterval(async () => {
        try {
          await saveCurrentState();
          console.debug("Periodic state save completed");
        } catch (error) {
          console.error("Periodic state save failed:", error);
        }
      }, 60000); // Save every minute as backup

      return () => {
        if (saveIntervalRef.current) {
          clearInterval(saveIntervalRef.current);
          saveIntervalRef.current = null;
        }
      };
    };

    // Set up visibility change handler (for browser-like behavior)
    // Debounced to prevent excessive saves when quickly switching tabs
    const setupVisibilityHandler = () => {
      let visibilityTimeout: NodeJS.Timeout | null = null;

      const handleVisibilityChange = async () => {
        if (document.visibilityState === "hidden") {
          // Debounce: only save if hidden for at least 500ms
          if (visibilityTimeout) clearTimeout(visibilityTimeout);

          visibilityTimeout = setTimeout(async () => {
            console.debug("App became hidden, saving state...");
            try {
              await saveCurrentState();
            } catch (error) {
              console.error(
                "Failed to save state on visibility change:",
                error,
              );
            }
          }, 500);
        } else {
          // Cancel save if app becomes visible again quickly
          if (visibilityTimeout) {
            clearTimeout(visibilityTimeout);
            visibilityTimeout = null;
          }
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);

      return () => {
        if (visibilityTimeout) clearTimeout(visibilityTimeout);
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      };
    };

    // Set up beforeunload handler (for web version compatibility)
    const setupBeforeUnloadHandler = () => {
      const handleBeforeUnload = async () => {
        console.log(
          "[StatePersistenceProvider] Before unload, saving state...",
        );

        // NOTE: We intentionally do NOT call setAppClosing(true) here.
        // The beforeunload event can fire for navigation, refresh, etc.
        // and may not indicate an actual app close. Setting this flag
        // would permanently block window creation if the close is cancelled.
        // The tauri://close-requested handler is the primary close mechanism.

        try {
          // Note: This is async but browsers may not wait for it
          // The tauri://close-requested handler is the primary save mechanism
          await saveCurrentState();
          await forceSave();
        } catch (error) {
          console.error(
            "[StatePersistenceProvider] Failed to save state before unload:",
            error,
          );
        }
      };

      window.addEventListener("beforeunload", handleBeforeUnload);

      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    };

    // Initialize all handlers
    const cleanupTasks: (() => void)[] = [];

    setupWindowCloseHandler().then((cleanup) => {
      if (cleanup) cleanupTasks.push(cleanup);
    });

    cleanupTasks.push(setupAutoSave());
    cleanupTasks.push(setupVisibilityHandler());
    cleanupTasks.push(setupBeforeUnloadHandler());

    // Cleanup function
    return () => {
      isCleaningUp = true;
      cleanupTasks.forEach((cleanup) => {
        try {
          cleanup();
        } catch (error) {
          console.error("Error during cleanup:", error);
        }
      });
    };
  }, [isInitialized, saveCurrentState, forceSave]);

  // Handle unhandled errors - save state before potential crash
  useEffect(() => {
    const handleError = async (event: ErrorEvent) => {
      // Ignore ResizeObserver errors - they're harmless and frequent
      const errorMessage = event.message || event.error?.message || "";
      if (event.error === null || errorMessage.includes("ResizeObserver")) {
        return;
      }

      console.error("Unhandled error occurred, saving state:", event.error);
      try {
        await saveCurrentState();
        await forceSave();
      } catch (saveError) {
        console.error("Failed to save state after error:", saveError);
      }
    };

    const handlePromiseRejection = async (event: PromiseRejectionEvent) => {
      console.error("Unhandled promise rejection, saving state:", event.reason);
      try {
        await saveCurrentState();
        await forceSave();
      } catch (saveError) {
        console.error(
          "Failed to save state after promise rejection:",
          saveError,
        );
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handlePromiseRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handlePromiseRejection);
    };
  }, [saveCurrentState, forceSave]);

  return <>{children}</>;
}

/**
 * Hook to manually trigger state saves
 */
export function useStatePersistence() {
  const saveNow = useAppStore((state) => state.saveCurrentState);
  const forceSave = useAppStore((state) => state.forceSave);
  const clearState = useAppStore((state) => state.clearPersistedState);
  const getState = useAppStore((state) => state.getPersistedState);
  const createSnapshot = useAppStore((state) => state.createStateSnapshot);
  const isInitialized = useAppStore((state) => state.isInitialized);

  return {
    saveNow,
    forceSave,
    clearState,
    getState,
    createSnapshot,
    isInitialized,
  };
}

/**
 * Hook to save specific data types
 */
export function useDataPersistence() {
  const savePlotData = useAppStore((state) => state.savePlotData);
  const saveAnalysis = useAppStore((state) => state.saveAnalysisResult);
  const saveState = useAppStore((state) => state.saveCurrentState);

  return { savePlotData, saveAnalysis, saveState };
}
