"use client";

import { useEffect, useRef } from "react";
import { useActiveFilePath } from "@/store/openFilesStore";
import { useAppStore } from "@/store/appStore";
import { useApiService } from "@/contexts/ApiServiceContext";
import { getFileStateManager } from "@/services/fileStateManager";
import { windowManager } from "@/utils/windowManager";
import { createLogger } from "@/lib/logger";

const logger = createLogger("FileTabSync");

/**
 * Component that syncs the active file tab with the main app store.
 * When a tab is clicked, this ensures the file info is loaded and
 * the main appStore.fileManager.selectedFile is updated.
 * When all tabs are closed, this clears the selected file and resets state.
 */
export function FileTabSync() {
  const activeFilePath = useActiveFilePath();
  const { apiService, isReady: isApiReady } = useApiService();
  const currentSelectedFile = useAppStore(
    (state) => state.fileManager.selectedFile,
  );
  const setSelectedFile = useAppStore((state) => state.setSelectedFile);
  const clearSelectedFile = useAppStore((state) => state.clearSelectedFile);
  const isServerReady = useAppStore((state) => state.ui.isServerReady);

  // Track the previous active file path to detect changes
  const prevActivePathRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    // Handle empty state - all tabs closed
    if (!activeFilePath) {
      // Only clear if we had a file before (transition to empty state)
      if (prevActivePathRef.current !== null || currentSelectedFile !== null) {
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

    // Wait for server and API to be ready before processing
    if (!isServerReady || !isApiReady) {
      logger.debug("Server or API not ready, waiting...");
      return;
    }

    // Skip if this is the same file AND already loaded
    if (
      activeFilePath === prevActivePathRef.current &&
      currentSelectedFile?.file_path === activeFilePath
    ) {
      return;
    }

    // Skip if already selected in main store
    if (currentSelectedFile?.file_path === activeFilePath) {
      prevActivePathRef.current = activeFilePath;
      return;
    }

    // Prevent multiple concurrent loads
    if (isLoadingRef.current) {
      return;
    }

    // Load file info and update main store
    const loadFileInfo = async () => {
      isLoadingRef.current = true;

      try {
        logger.debug("Loading file info for tab switch", { activeFilePath });

        // Get file info from backend
        const fileInfo = await apiService.getFileInfo(activeFilePath);

        if (fileInfo) {
          logger.debug("Setting selected file from tab", {
            fileName: fileInfo.file_name,
          });
          setSelectedFile(fileInfo);
          // Only mark as processed after successful load
          prevActivePathRef.current = activeFilePath;
        } else {
          logger.warn("Failed to get file info", { activeFilePath });
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

    loadFileInfo();
  }, [
    activeFilePath,
    currentSelectedFile?.file_path,
    isServerReady,
    isApiReady,
    apiService,
    setSelectedFile,
  ]);

  // This component doesn't render anything
  return null;
}
