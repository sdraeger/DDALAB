"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useState,
  ReactNode,
} from "react";
import {
  useOpenFilesStore,
  useActiveFilePath,
  OpenFile,
} from "@/store/openFilesStore";
import { getFileStateManager } from "@/services/fileStateManager";
import {
  FileSpecificState,
  FilePlotState,
  FileDDAState,
  FileAnnotationState,
  FileNavigationState,
} from "@/types/fileCentricState";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ActiveFileContext");

/**
 * Context value for the active file
 */
interface ActiveFileContextValue {
  /** Full path to the active file (null if no file open) */
  filePath: string | null;
  /** Display name of the active file */
  fileName: string | null;
  /** Complete file state */
  fileState: FileSpecificState | null;
  /** Whether the file state is currently loading */
  isLoading: boolean;
  /** The open file metadata (from openFilesStore) */
  openFile: OpenFile | null;

  /** Plot state for the active file */
  plotState: FilePlotState | null;
  /** DDA analysis state for the active file */
  ddaState: FileDDAState | null;
  /** Annotation state for the active file */
  annotationState: FileAnnotationState | null;
  /** Navigation state for the active file */
  navigationState: FileNavigationState | null;

  /** Update the plot state for the active file */
  updatePlotState: (updates: Partial<FilePlotState>) => void;
  /** Update the DDA state for the active file */
  updateDdaState: (updates: Partial<FileDDAState>) => void;
  /** Update the annotation state for the active file */
  updateAnnotationState: (updates: Partial<FileAnnotationState>) => void;
  /** Update the navigation state for the active file */
  updateNavigationState: (updates: Partial<FileNavigationState>) => void;
}

const ActiveFileContext = createContext<ActiveFileContextValue | null>(null);

interface ActiveFileProviderProps {
  children: ReactNode;
}

/**
 * Provider component that manages active file state
 */
export function ActiveFileProvider({ children }: ActiveFileProviderProps) {
  const activeFilePath = useActiveFilePath();
  const openFile = useOpenFilesStore((state) => {
    if (!state.activeFilePath) return null;
    return state.files.find((f) => f.filePath === state.activeFilePath) || null;
  });
  const isStoreLoading = useOpenFilesStore((state) => state.isLoading);

  const [fileState, setFileState] = useState<FileSpecificState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Load file state when active file changes
  useEffect(() => {
    if (!activeFilePath) {
      setFileState(null);
      return;
    }

    let cancelled = false;

    const loadState = async () => {
      setIsLoading(true);
      try {
        const manager = getFileStateManager();
        const state = await manager.loadFileState(activeFilePath);
        if (!cancelled) {
          setFileState(state);
        }
      } catch (error) {
        logger.error("Failed to load file state", { activeFilePath, error });
        if (!cancelled) {
          setFileState(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadState();

    return () => {
      cancelled = true;
    };
  }, [activeFilePath]);

  // Subscribe to file state changes
  useEffect(() => {
    if (!activeFilePath) return;

    const manager = getFileStateManager();
    const unsubscribe = manager.onStateChange((event) => {
      if (event.filePath === activeFilePath) {
        // Update the specific module state
        setFileState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            [event.moduleId]: event.newState,
          };
        });
      }
    });

    return unsubscribe;
  }, [activeFilePath]);

  // Update functions
  const updatePlotState = useCallback(
    (updates: Partial<FilePlotState>) => {
      if (!activeFilePath || !fileState) return;

      const manager = getFileStateManager();
      const currentPlotState = fileState.plot || {
        chunkStart: 0,
        chunkSize: 8192,
        selectedChannels: [],
        amplitude: 1.0,
        showAnnotations: true,
        lastUpdated: new Date().toISOString(),
      };

      const newState: FilePlotState = {
        ...currentPlotState,
        ...updates,
        lastUpdated: new Date().toISOString(),
      };

      manager.updateModuleState(activeFilePath, "plot", newState);
    },
    [activeFilePath, fileState],
  );

  const updateDdaState = useCallback(
    (updates: Partial<FileDDAState>) => {
      if (!activeFilePath || !fileState) return;

      const manager = getFileStateManager();
      const currentDdaState = fileState.dda || {
        currentAnalysisId: null,
        analysisHistory: [],
        lastParameters: {
          variants: ["single_timeseries"],
          windowLength: 64,
          windowStep: 10,
          delays: [7, 10],
        },
        selectedVariants: ["single_timeseries"],
        lastUpdated: new Date().toISOString(),
      };

      const newState: FileDDAState = {
        ...currentDdaState,
        ...updates,
        lastUpdated: new Date().toISOString(),
      };

      manager.updateModuleState(activeFilePath, "dda", newState);
    },
    [activeFilePath, fileState],
  );

  const updateAnnotationState = useCallback(
    (updates: Partial<FileAnnotationState>) => {
      if (!activeFilePath || !fileState) return;

      const manager = getFileStateManager();
      const currentAnnotationState = fileState.annotations || {
        timeSeries: { global: [], channels: {} },
        ddaResults: {},
        lastUpdated: new Date().toISOString(),
      };

      const newState: FileAnnotationState = {
        ...currentAnnotationState,
        ...updates,
        lastUpdated: new Date().toISOString(),
      };

      manager.updateModuleState(activeFilePath, "annotations", newState);
    },
    [activeFilePath, fileState],
  );

  const updateNavigationState = useCallback(
    (updates: Partial<FileNavigationState>) => {
      if (!activeFilePath || !fileState) return;

      const manager = getFileStateManager();
      const currentNavigationState = fileState.navigation || {
        primaryNav: "explore",
        secondaryNav: "timeseries",
        sidebarSection: null,
        lastUpdated: new Date().toISOString(),
      };

      const newState: FileNavigationState = {
        ...currentNavigationState,
        ...updates,
        lastUpdated: new Date().toISOString(),
      };

      manager.updateModuleState(activeFilePath, "navigation", newState);
    },
    [activeFilePath, fileState],
  );

  const contextValue = useMemo<ActiveFileContextValue>(
    () => ({
      filePath: activeFilePath,
      fileName: openFile?.fileName || null,
      fileState,
      isLoading: isLoading || isStoreLoading,
      openFile,

      plotState: fileState?.plot || null,
      ddaState: fileState?.dda || null,
      annotationState: fileState?.annotations || null,
      navigationState: fileState?.navigation || null,

      updatePlotState,
      updateDdaState,
      updateAnnotationState,
      updateNavigationState,
    }),
    [
      activeFilePath,
      openFile,
      fileState,
      isLoading,
      isStoreLoading,
      updatePlotState,
      updateDdaState,
      updateAnnotationState,
      updateNavigationState,
    ],
  );

  return (
    <ActiveFileContext.Provider value={contextValue}>
      {children}
    </ActiveFileContext.Provider>
  );
}

/**
 * Hook to access the complete active file context
 * @throws Error if used outside of ActiveFileProvider
 */
export function useActiveFileContext(): ActiveFileContextValue {
  const context = useContext(ActiveFileContext);

  if (!context) {
    throw new Error(
      "useActiveFileContext must be used within an ActiveFileProvider. " +
        "Wrap your component tree with <ActiveFileProvider>.",
    );
  }

  return context;
}

/**
 * Hook to check if there's an active file
 */
export function useHasActiveFile(): boolean {
  const context = useContext(ActiveFileContext);
  return context?.filePath !== null;
}

/**
 * Hook to get just the plot state (with null fallback)
 */
export function useActiveFilePlotState(): FilePlotState | null {
  const context = useContext(ActiveFileContext);
  return context?.plotState || null;
}

/**
 * Hook to get just the DDA state (with null fallback)
 */
export function useActiveFileDdaState(): FileDDAState | null {
  const context = useContext(ActiveFileContext);
  return context?.ddaState || null;
}

/**
 * Hook to get just the annotation state (with null fallback)
 */
export function useActiveFileAnnotationState(): FileAnnotationState | null {
  const context = useContext(ActiveFileContext);
  return context?.annotationState || null;
}

/**
 * Hook to get just the navigation state (with null fallback)
 */
export function useActiveFileNavigationState(): FileNavigationState | null {
  const context = useContext(ActiveFileContext);
  return context?.navigationState || null;
}

/**
 * Hook to update plot state for the active file
 */
export function useUpdatePlotState(): (
  updates: Partial<FilePlotState>,
) => void {
  const context = useContext(ActiveFileContext);
  return context?.updatePlotState || (() => {});
}

/**
 * Hook to update DDA state for the active file
 */
export function useUpdateDdaState(): (updates: Partial<FileDDAState>) => void {
  const context = useContext(ActiveFileContext);
  return context?.updateDdaState || (() => {});
}
