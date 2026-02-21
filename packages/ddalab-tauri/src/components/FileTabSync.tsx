"use client";

import { useEffect, useRef } from "react";
import { useActiveFilePath } from "@/store/openFilesStore";
import { useAppStore } from "@/store/appStore";
import { tauriBackendService } from "@/services/tauriBackendService";
import { getFileStateManager } from "@/services/fileStateManager";
import { windowManager } from "@/utils/windowManager";
import { createLogger } from "@/lib/logger";

const logger = createLogger("FileTabSync");
const ACTIVE_TAB_RESTORE_MAX_ATTEMPTS = 10;
const ACTIVE_TAB_RESTORE_RETRY_BASE_DELAY_MS = 300;
const ACTIVE_TAB_RESTORE_ATTEMPT_TIMEOUT_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Component that syncs the active file tab with the main app store.
 * When a tab is clicked, this ensures the file info is loaded and
 * the main appStore.fileManager.selectedFile is updated.
 * When all tabs are closed, this clears the selected file and resets state.
 */
export function FileTabSync() {
  const activeFilePath = useActiveFilePath();
  const currentSelectedFile = useAppStore(
    (state) => state.fileManager.selectedFile,
  );
  const setSelectedFile = useAppStore((state) => state.setSelectedFile);
  const clearSelectedFile = useAppStore((state) => state.clearSelectedFile);

  // Track the previous active file path to detect changes
  const prevActivePathRef = useRef<string | null>(null);
  const currentSelectedFilePathRef = useRef<string | null>(
    currentSelectedFile?.file_path ?? null,
  );
  const isLoadingRef = useRef(false);

  useEffect(() => {
    currentSelectedFilePathRef.current = currentSelectedFile?.file_path ?? null;
  }, [currentSelectedFile?.file_path]);

  useEffect(() => {
    // Handle empty state - all tabs closed
    if (!activeFilePath) {
      // Only clear if we had a file before (transition to empty state)
      if (
        prevActivePathRef.current !== null ||
        currentSelectedFilePathRef.current !== null
      ) {
        logger.debug("All tabs closed, clearing selected file");
        clearSelectedFile();

        // Clear active file in FileStateManager
        try {
          const fileStateManager = getFileStateManager();
          fileStateManager.clearActiveFile();
        } catch {
          // FileStateManager may not be initialized yet
        }

        // Broadcast empty state to all popout windows
        windowManager.broadcastEmptyState().catch(() => {
          // Broadcast may fail if no windows are open
        });
      }
      prevActivePathRef.current = null;
      return;
    }

    // Skip if this is the same file AND already loaded
    if (
      activeFilePath === prevActivePathRef.current &&
      currentSelectedFilePathRef.current === activeFilePath
    ) {
      return;
    }

    // Skip if already selected in main store
    if (currentSelectedFilePathRef.current === activeFilePath) {
      prevActivePathRef.current = activeFilePath;
      return;
    }

    // Prevent multiple concurrent loads
    if (isLoadingRef.current) {
      return;
    }

    // Load file info and update main store
    let cancelled = false;
    const loadFileInfo = async () => {
      isLoadingRef.current = true;
      let lastError: unknown = null;

      try {
        for (
          let attempt = 1;
          attempt <= ACTIVE_TAB_RESTORE_MAX_ATTEMPTS;
          attempt++
        ) {
          if (cancelled) return;
          logger.debug("Loading file info for tab switch", {
            activeFilePath,
            attempt,
            maxAttempts: ACTIVE_TAB_RESTORE_MAX_ATTEMPTS,
          });

          try {
            // Get file info from backend via Tauri IPC
            const fileInfo = await withTimeout(
              tauriBackendService.getEdfInfo(activeFilePath),
              ACTIVE_TAB_RESTORE_ATTEMPT_TIMEOUT_MS,
              `Timed out loading active tab file after ${ACTIVE_TAB_RESTORE_ATTEMPT_TIMEOUT_MS}ms`,
            );
            if (cancelled) return;

            if (!fileInfo) {
              lastError = new Error("Backend returned empty file metadata");
            } else {
              logger.debug("Setting selected file from tab", {
                fileName: fileInfo.file_name,
                attempt,
              });
              setSelectedFile(fileInfo);
              // Only mark as processed after successful load
              prevActivePathRef.current = activeFilePath;
              return;
            }
          } catch (error) {
            lastError = error;
          }

          const hasMoreAttempts = attempt < ACTIVE_TAB_RESTORE_MAX_ATTEMPTS;
          logger.warn("Tab file restore attempt failed", {
            activeFilePath,
            attempt,
            hasMoreAttempts,
            error: lastError,
          });
          if (hasMoreAttempts) {
            await sleep(ACTIVE_TAB_RESTORE_RETRY_BASE_DELAY_MS * attempt);
          }
        }

        if (!cancelled) {
          logger.error("Failed to restore active tab file after retries", {
            activeFilePath,
            attempts: ACTIVE_TAB_RESTORE_MAX_ATTEMPTS,
            error: lastError,
          });
        }
      } catch (error) {
        logger.error("Error loading file info for tab", {
          activeFilePath,
          error,
        });
      } finally {
        isLoadingRef.current = false;
      }
    };

    void loadFileInfo();

    return () => {
      cancelled = true;
    };
  }, [activeFilePath, setSelectedFile, clearSelectedFile]);

  // This component doesn't render anything
  return null;
}
