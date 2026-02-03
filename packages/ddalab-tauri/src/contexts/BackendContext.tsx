"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import {
  tauriBackendService,
  type PreprocessingParams,
  type DirectoryListing,
  type DDAHistoryEntry,
  type CancelDDAResponse,
  type ICAHistoryEntry,
} from "@/services/tauriBackendService";
import { TauriService } from "@/services/tauriService";
import type {
  EDFFileInfo,
  ChunkData,
  DDAAnalysisRequest,
  DDAResult,
} from "@/types/api";
import type { ICAAnalysisRequest, ICAResult } from "@/types/ica";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BackendContext");

interface BackendContextValue {
  /** The TauriBackendService singleton instance */
  backend: typeof tauriBackendService;
  /** Whether the backend is ready for use */
  isReady: boolean;
  /** Whether running in Tauri environment */
  isTauri: boolean;

  // Convenience methods bound to service instance for common operations

  /** Get EDF/neurophysiology file information */
  getEdfInfo: (filePath: string) => Promise<EDFFileInfo>;
  /** Get chunk data for visualization */
  getEdfChunk: (
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    channels?: string[],
    preprocessing?: PreprocessingParams,
  ) => Promise<ChunkData>;
  /** Get downsampled overview data for minimap */
  getEdfOverview: (
    filePath: string,
    channels?: string[],
    maxPoints?: number,
  ) => Promise<ChunkData>;

  /** List contents of a directory */
  listDirectory: (path?: string) => Promise<DirectoryListing>;
  /** List supported data files in a directory */
  listDataFiles: (path?: string) => Promise<DirectoryListing>;

  /** Submit a DDA analysis */
  submitDDAAnalysis: (request: DDAAnalysisRequest) => Promise<DDAResult>;
  /** Cancel the current DDA analysis */
  cancelDDA: () => Promise<CancelDDAResponse>;
  /** Get a DDA result by ID */
  getDDAResult: (analysisId: string) => Promise<DDAResult | null>;
  /** List DDA history entries */
  listDDAHistory: (limit?: number) => Promise<DDAHistoryEntry[]>;

  /** Submit an ICA analysis */
  submitICAAnalysis: (request: ICAAnalysisRequest) => Promise<ICAResult>;
  /** Get all ICA results */
  getICAResults: () => Promise<ICAHistoryEntry[]>;
}

const BackendContext = createContext<BackendContextValue | null>(null);

interface BackendProviderProps {
  children: ReactNode;
}

/**
 * Provider component that provides access to the Tauri backend service.
 * This replaces HTTP-based communication with pure IPC for hospital environments
 * where enterprise security tools may intercept localhost traffic.
 */
export function BackendProvider({ children }: BackendProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const isTauri = TauriService.isTauri();

  useEffect(() => {
    if (isTauri) {
      logger.info("Tauri environment detected, backend is ready");
      setIsReady(true);
    } else {
      logger.warn(
        "Not running in Tauri environment, backend features may be limited",
      );
    }
  }, [isTauri]);

  // Bound convenience methods
  const getEdfInfo = useCallback(
    (filePath: string) => tauriBackendService.getEdfInfo(filePath),
    [],
  );

  const getEdfChunk = useCallback(
    (
      filePath: string,
      chunkStart: number,
      chunkSize: number,
      channels?: string[],
      preprocessing?: PreprocessingParams,
    ) =>
      tauriBackendService.getEdfChunk(
        filePath,
        chunkStart,
        chunkSize,
        channels,
        preprocessing,
      ),
    [],
  );

  const getEdfOverview = useCallback(
    (filePath: string, channels?: string[], maxPoints?: number) =>
      tauriBackendService.getEdfOverview(filePath, channels, maxPoints),
    [],
  );

  const listDirectory = useCallback(
    (path?: string) => tauriBackendService.listDirectory(path),
    [],
  );

  const listDataFiles = useCallback(
    (path?: string) => tauriBackendService.listDataFiles(path),
    [],
  );

  const submitDDAAnalysis = useCallback(
    (request: DDAAnalysisRequest) =>
      tauriBackendService.submitDDAAnalysis(request),
    [],
  );

  const cancelDDA = useCallback(() => tauriBackendService.cancelDDA(), []);

  const getDDAResult = useCallback(
    (analysisId: string) => tauriBackendService.getDDAResult(analysisId),
    [],
  );

  const listDDAHistory = useCallback(
    (limit?: number) => tauriBackendService.listDDAHistory(limit),
    [],
  );

  const submitICAAnalysis = useCallback(
    (request: ICAAnalysisRequest) =>
      tauriBackendService.submitICAAnalysis(request),
    [],
  );

  const getICAResults = useCallback(
    () => tauriBackendService.getICAResults(),
    [],
  );

  const contextValue = useMemo<BackendContextValue>(
    () => ({
      backend: tauriBackendService,
      isReady,
      isTauri,
      getEdfInfo,
      getEdfChunk,
      getEdfOverview,
      listDirectory,
      listDataFiles,
      submitDDAAnalysis,
      cancelDDA,
      getDDAResult,
      listDDAHistory,
      submitICAAnalysis,
      getICAResults,
    }),
    [
      isReady,
      isTauri,
      getEdfInfo,
      getEdfChunk,
      getEdfOverview,
      listDirectory,
      listDataFiles,
      submitDDAAnalysis,
      cancelDDA,
      getDDAResult,
      listDDAHistory,
      submitICAAnalysis,
      getICAResults,
    ],
  );

  return (
    <BackendContext.Provider value={contextValue}>
      {children}
    </BackendContext.Provider>
  );
}

/**
 * Hook to access the backend context.
 * @throws Error if used outside of BackendProvider
 */
export function useBackend(): BackendContextValue {
  const context = useContext(BackendContext);

  if (!context) {
    throw new Error(
      "useBackend must be used within a BackendProvider. " +
        "Wrap your component tree with <BackendProvider>.",
    );
  }

  return context;
}

/**
 * Hook to access the backend context without throwing.
 * Useful for gradual migration where component may or may not have provider.
 */
export function useBackendOptional(): BackendContextValue | null {
  return useContext(BackendContext);
}

/**
 * Hook to check if the backend is ready.
 * Returns false if used outside of BackendProvider.
 */
export function useBackendReady(): boolean {
  const context = useContext(BackendContext);
  return context?.isReady ?? false;
}

/**
 * Hook to get just the backend service instance.
 * @throws Error if used outside of BackendProvider
 */
export function useBackendService(): typeof tauriBackendService {
  const { backend } = useBackend();
  return backend;
}
