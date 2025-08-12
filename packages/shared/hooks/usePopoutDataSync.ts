"use client";

import { useEffect, useState } from "react";
import { useAppDispatch } from "../store";
import {
  restorePlotState,
  setCurrentFilePath,
  type PlotState,
} from "../store/slices/plotSlice";
import logger from "../lib/utils/logger";

interface PopoutDataSyncOptions {
  widgetId: string;
  isPopout?: boolean;
  onDataRestored?: () => void;
  onError?: (error: string) => void;
}

/**
 * Hook to handle data synchronization for popout windows
 * Restores Redux state and handles ongoing data updates
 */
export function usePopoutDataSync({
  widgetId,
  isPopout = false,
  onDataRestored,
  onError,
}: PopoutDataSyncOptions) {
  const dispatch = useAppDispatch();
  const [isDataRestored, setIsDataRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPopout) {
      setIsDataRestored(true);
      return;
    }

    const restoreData = async () => {
      try {
        logger.info("[usePopoutDataSync] Starting data restoration", {
          widgetId,
        });

        // Get stored data from localStorage
        const storageKey = `popped-widget-${widgetId}`;
        const storedData = localStorage.getItem(storageKey);

        if (!storedData) {
          throw new Error("No popout data found in localStorage");
        }

        const parsedData = JSON.parse(storedData);

        // Decompress data if needed
        const decompressedData = await decompressData(parsedData);

        // Restore Redux state
        if (decompressedData.plotsState) {
          // Restore current file path
          if (decompressedData.currentFilePath) {
            dispatch(setCurrentFilePath(decompressedData.currentFilePath));
          }

          // Restore plot states
          Object.entries(decompressedData.plotsState.byFilePath).forEach(
            ([filePath, plotState]) => {
              if (plotState && typeof plotState === "object") {
                dispatch(
                  restorePlotState({
                    filePath,
                    plotState: plotState as PlotState,
                  })
                );
              }
            }
          );

          logger.info("[usePopoutDataSync] Redux state restored", {
            plotCount: Object.keys(decompressedData.plotsState.byFilePath)
              .length,
            currentFilePath: decompressedData.currentFilePath,
          });
        }

        // Restore session data and authentication context
        if (decompressedData.sessionData) {
          // Restore NextAuth session data
          if (decompressedData.sessionData.nextAuth) {
            sessionStorage.setItem(
              "next-auth.session",
              JSON.stringify(decompressedData.sessionData.nextAuth)
            );
          }

          // Restore local session data
          if (decompressedData.sessionData.localSession) {
            localStorage.setItem(
              "dda-local-session",
              JSON.stringify(decompressedData.sessionData.localSession)
            );
          }

          // Restore auth mode context
          if (decompressedData.sessionData.authMode) {
            sessionStorage.setItem(
              "auth-mode-context",
              JSON.stringify(decompressedData.sessionData.authMode)
            );
          }

          // Restore user preferences
          if (decompressedData.sessionData.userPreferences) {
            localStorage.setItem(
              "dda-user-preferences",
              JSON.stringify(decompressedData.sessionData.userPreferences)
            );
          }

          // Restore other session storage items
          Object.keys(decompressedData.sessionData).forEach((key) => {
            if (
              key.startsWith("dda-") ||
              key.startsWith("next-auth") ||
              key.includes("session")
            ) {
              const value = decompressedData.sessionData[key];
              if (typeof value === "string") {
                sessionStorage.setItem(key, value);
              } else {
                sessionStorage.setItem(key, JSON.stringify(value));
              }
            }
          });

          // Store consolidated session data for popout reference
          sessionStorage.setItem(
            "popout-session",
            JSON.stringify(decompressedData.sessionData)
          );

          logger.info(
            "[usePopoutDataSync] Session data and authentication context restored"
          );
        }

        // Restore authentication token if provided
        if (decompressedData.authToken) {
          // Store auth token for API requests
          sessionStorage.setItem(
            "popout-auth-token",
            decompressedData.authToken
          );
          logger.info("[usePopoutDataSync] Authentication token restored");
        }

        setIsDataRestored(true);
        onDataRestored?.();

        logger.info(
          "[usePopoutDataSync] Data restoration completed successfully"
        );
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        logger.error("[usePopoutDataSync] Data restoration failed", {
          error: errorMessage,
          widgetId,
        });

        setError(errorMessage);
        onError?.(errorMessage);
      }
    };

    restoreData();
  }, [widgetId, isPopout, dispatch, onDataRestored, onError]);

  // Listen for data updates from parent window
  useEffect(() => {
    if (!isPopout) return;

    const handleStorageChange = (e: StorageEvent) => {
      const storageKey = `popped-widget-${widgetId}`;

      if (e.key === storageKey && e.newValue) {
        try {
          const updatedData = JSON.parse(e.newValue);
          logger.info("[usePopoutDataSync] Received data update from parent");

          // Update Redux state with new data
          if (updatedData.plotsState) {
            Object.entries(updatedData.plotsState.byFilePath).forEach(
              ([filePath, plotState]) => {
                if (plotState && typeof plotState === "object") {
                  dispatch(
                    restorePlotState({
                      filePath,
                      plotState: plotState as PlotState,
                    })
                  );
                }
              }
            );
          }
        } catch (err) {
          logger.error("[usePopoutDataSync] Failed to process data update", {
            error: err instanceof Error ? err.message : err,
          });
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [widgetId, isPopout, dispatch]);

  return {
    isDataRestored,
    error,
    isPopout,
  };
}

// Data decompression utility
async function decompressData(compressedData: any): Promise<any> {
  try {
    if (!compressedData._compressed) {
      return compressedData;
    }

    logger.info("[usePopoutDataSync] Decompressing data");

    const decompressed = {
      ...compressedData,
      _decompressed: true,
    };

    // Handle EDF data decompression
    if (decompressed.plotsState?.byFilePath) {
      Object.entries(decompressed.plotsState.byFilePath).forEach(
        ([filePath, plotState]: [string, any]) => {
          if (plotState.edfData?._compressed) {
            // Mark as needing full data fetch
            plotState.edfData._needsFullData = true;

            // Use sample data for immediate display
            if (plotState.edfData._sampleData) {
              plotState.edfData.data = plotState.edfData._sampleData;
              logger.info(
                "[usePopoutDataSync] Using sample data for immediate display",
                {
                  filePath,
                  sampleSize: plotState.edfData._sampleData.length,
                }
              );
            }
          }
        }
      );
    }

    return decompressed;
  } catch (error) {
    logger.error("[usePopoutDataSync] Error decompressing data", { error });
    return compressedData;
  }
}
