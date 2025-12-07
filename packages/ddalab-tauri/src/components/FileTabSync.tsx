"use client";

import { useEffect, useRef } from "react";
import { useActiveFilePath } from "@/store/openFilesStore";
import { useAppStore } from "@/store/appStore";
import { useApiService } from "@/contexts/ApiServiceContext";
import { createLogger } from "@/lib/logger";

const logger = createLogger("FileTabSync");

/**
 * Component that syncs the active file tab with the main app store.
 * When a tab is clicked, this ensures the file info is loaded and
 * the main appStore.fileManager.selectedFile is updated.
 */
export function FileTabSync() {
  const activeFilePath = useActiveFilePath();
  const { apiService, isReady: isApiReady } = useApiService();
  const currentSelectedFile = useAppStore(
    (state) => state.fileManager.selectedFile,
  );
  const setSelectedFile = useAppStore((state) => state.setSelectedFile);
  const isServerReady = useAppStore((state) => state.ui.isServerReady);

  // Track the previous active file path to detect changes
  const prevActivePathRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    // Skip if no active file or if it's the same as before
    if (!activeFilePath) {
      prevActivePathRef.current = null;
      return;
    }

    // Skip if this is the same file
    if (activeFilePath === prevActivePathRef.current) {
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

    prevActivePathRef.current = activeFilePath;

    // Load file info and update main store
    const loadFileInfo = async () => {
      if (!isServerReady || !isApiReady) {
        logger.debug("Server or API not ready, skipping file load");
        return;
      }

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
