import { useCallback, useEffect, useRef, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import {
  startLoading,
  updateProgress,
  stopLoading,
  clearAllLoading,
  setGlobalOverlay,
  selectIsLoading,
  selectLoadingOperation,
  selectIsGloballyLoading,
  selectIsDDAProcessing,
  selectIsFileLoading,
  selectIsUploading,
  type LoadingOperation,
} from "../store/slices/loadingSlice";

export interface LoadingManager {
  // State getters
  isGloballyLoading: boolean;
  isDDAProcessing: boolean;
  isFileLoading: boolean;
  isUploading: boolean;

  // Loading control
  start: (params: {
    id: string;
    type: LoadingOperation["type"];
    message: string;
    showGlobalOverlay?: boolean;
    metadata?: Record<string, any>;
  }) => void;

  updateProgress: (id: string, progress: number, message?: string) => void;
  stop: (id: string) => void;
  clear: () => void;

  // Global overlay control
  showGlobalOverlay: (message: string, progress?: number) => void;
  hideGlobalOverlay: () => void;

  // Convenience methods for common operations
  startFileLoad: (id: string, message?: string, showOverlay?: boolean) => void;
  startDDAProcessing: (id: string, message?: string) => void;
  startUpload: (id: string, message?: string, showOverlay?: boolean) => void;
  startAPIRequest: (id: string, message?: string) => void;
}

export function useLoadingManager(): LoadingManager {
  const dispatch = useAppDispatch();
  const operations = useAppSelector((state) => state.loading.operations);
  const timeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const lastCleanupRef = useRef<number>(0);

  // Auto-cleanup stuck loading operations
  useEffect(() => {
    const cleanupStuckOperations = () => {
      const now = Date.now();
      const maxDuration = 60000; // 60 seconds max duration
      let hasCleanup = false;

      Object.entries(operations).forEach(([id, operation]) => {
        const duration = now - operation.startTime;
        if (duration > maxDuration) {
          console.warn(
            `Auto-clearing stuck loading operation: ${id} (${operation.type})`
          );
          dispatch(stopLoading(id));
          hasCleanup = true;

          // Clear timeout if it exists
          const timeoutRef = timeoutRefs.current.get(id);
          if (timeoutRef) {
            clearTimeout(timeoutRef);
            timeoutRefs.current.delete(id);
          }
        }
      });

      if (hasCleanup) {
        lastCleanupRef.current = now;
      }
    };

    // Only run cleanup if we haven't cleaned up recently (avoid excessive calls)
    const now = Date.now();
    if (now - lastCleanupRef.current > 5000) {
      // Minimum 5 seconds between cleanups
      cleanupStuckOperations();
    }

    // Check for stuck operations every 30 seconds
    const interval = setInterval(cleanupStuckOperations, 30000);

    return () => {
      clearInterval(interval);
      // Clear all timeout refs on unmount
      timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
      timeoutRefs.current.clear();
    };
  }, [operations, dispatch]);

  // State selectors
  const isGloballyLoading = useAppSelector(selectIsGloballyLoading);
  const isDDAProcessing = useAppSelector(selectIsDDAProcessing);
  const isFileLoading = useAppSelector(selectIsFileLoading);
  const isUploading = useAppSelector(selectIsUploading);

  // Basic operations
  const start = useCallback(
    (params: {
      id: string;
      type: LoadingOperation["type"];
      message: string;
      showGlobalOverlay?: boolean;
      metadata?: Record<string, any>;
    }) => {
      dispatch(startLoading(params));

      // Set up auto-timeout for this operation (45 seconds)
      const timeout = setTimeout(() => {
        console.warn(
          `Auto-timeout for loading operation: ${params.id} (${params.type})`
        );
        dispatch(stopLoading(params.id));
        timeoutRefs.current.delete(params.id);
      }, 45000);

      timeoutRefs.current.set(params.id, timeout);
    },
    [dispatch]
  );

  const handleUpdateProgress = useCallback(
    (id: string, progress: number, message?: string) => {
      dispatch(updateProgress({ id, progress, message }));
    },
    [dispatch]
  );

  const stop = useCallback(
    (id: string) => {
      dispatch(stopLoading(id));

      // Clear timeout if it exists
      const timeoutRef = timeoutRefs.current.get(id);
      if (timeoutRef) {
        clearTimeout(timeoutRef);
        timeoutRefs.current.delete(id);
      }
    },
    [dispatch]
  );

  const clear = useCallback(() => {
    dispatch(clearAllLoading());

    // Clear all timeout refs
    timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
    timeoutRefs.current.clear();
  }, [dispatch]);

  // Global overlay control
  const showGlobalOverlayFn = useCallback(
    (message: string, progress?: number) => {
      dispatch(setGlobalOverlay({ show: true, message, progress }));
    },
    [dispatch]
  );

  const hideGlobalOverlay = useCallback(() => {
    dispatch(setGlobalOverlay({ show: false }));
  }, [dispatch]);

  // Convenience methods
  const startFileLoad = useCallback(
    (id: string, message = "Loading file...", showOverlay = false) => {
      start({
        id,
        type: "file-load",
        message,
        showGlobalOverlay: showOverlay,
      });
    },
    [start]
  );

  const startDDAProcessing = useCallback(
    (id: string, message = "Processing DDA request...") => {
      start({
        id,
        type: "dda-processing",
        message,
        showGlobalOverlay: true, // DDA processing usually shows global overlay
      });
    },
    [start]
  );

  const startUpload = useCallback(
    (id: string, message = "Uploading file...", showOverlay = true) => {
      start({
        id,
        type: "upload",
        message,
        showGlobalOverlay: showOverlay,
      });
    },
    [start]
  );

  const startAPIRequest = useCallback(
    (id: string, message = "Processing request...") => {
      start({
        id,
        type: "api-request",
        message,
        showGlobalOverlay: false,
      });
    },
    [start]
  );

  // Use useMemo to create a stable object reference
  const loadingManager = useMemo(
    () => ({
      // State getters
      isGloballyLoading,
      isDDAProcessing,
      isFileLoading,
      isUploading,

      // Loading control
      start,
      updateProgress: handleUpdateProgress,
      stop,
      clear,

      // Global overlay control
      showGlobalOverlay: showGlobalOverlayFn,
      hideGlobalOverlay,

      // Convenience methods
      startFileLoad,
      startDDAProcessing,
      startUpload,
      startAPIRequest,
    }),
    [
      isGloballyLoading,
      isDDAProcessing,
      isFileLoading,
      isUploading,
      start,
      handleUpdateProgress,
      stop,
      clear,
      showGlobalOverlayFn,
      hideGlobalOverlay,
      startFileLoad,
      startDDAProcessing,
      startUpload,
      startAPIRequest,
    ]
  );

  return loadingManager;
}

// Hook to check if a specific loading operation is active
export function useLoadingState(id: string) {
  const isLoading = useAppSelector((state) => selectIsLoading(state, id));
  const operation = useAppSelector((state) =>
    selectLoadingOperation(state, id)
  );

  return { isLoading, operation };
}

// Specialized hooks for specific loading types
export function useFileLoadingManager() {
  const loadingManager = useLoadingManager();

  return {
    startLoading: loadingManager.startFileLoad,
    updateProgress: loadingManager.updateProgress,
    stopLoading: loadingManager.stop,
    isLoading: loadingManager.isFileLoading,
  };
}

export function useDDAProcessingManager() {
  const loadingManager = useLoadingManager();

  return {
    startProcessing: loadingManager.startDDAProcessing,
    updateProgress: loadingManager.updateProgress,
    stopProcessing: loadingManager.stop,
    isProcessing: loadingManager.isDDAProcessing,
  };
}

export function useUploadManager() {
  const loadingManager = useLoadingManager();

  return {
    startUpload: loadingManager.startUpload,
    updateProgress: loadingManager.updateProgress,
    stopUpload: loadingManager.stop,
    isUploading: loadingManager.isUploading,
  };
}
