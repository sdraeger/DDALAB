/**
 * Batch Processing Slice
 *
 * Manages batch DDA analysis state: multi-file job tracking,
 * per-file progress, and batch history.
 */

import type { ImmerStateCreator } from "./types";

// ============================================================================
// Types
// ============================================================================

export type BatchJobStatus =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

export type BatchFileStatus =
  | "queued"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

export interface BatchFileEntry {
  filePath: string;
  fileName: string;
  status: BatchFileStatus;
  progress: number;
  analysisId?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export type ChannelSelectionMode = "all" | "pattern" | "names";

export interface ChannelSelection {
  mode: ChannelSelectionMode;
  /** Regex pattern when mode is "pattern" */
  pattern: string;
  /** Explicit channel names when mode is "names" */
  names: string[];
}

export const DEFAULT_CHANNEL_SELECTION: ChannelSelection = {
  mode: "all",
  pattern: "",
  names: [],
};

export interface BatchSharedParameters {
  variants: string[];
  windowLength: number;
  windowStep: number;
  delays: number[];
}

export interface BatchJob {
  id: string;
  status: BatchJobStatus;
  files: BatchFileEntry[];
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  currentFileIndex: number;
  overallProgress: number;
  continueOnError: boolean;
  startedAt: number;
  completedAt?: number;
  elapsedMs?: number;
  sharedParameters: BatchSharedParameters;
}

export interface BatchState {
  currentBatch: BatchJob | null;
  batchHistory: BatchJob[];
}

const MAX_BATCH_HISTORY = 20;

// ============================================================================
// Actions
// ============================================================================

export interface BatchActions {
  createBatch: (
    id: string,
    files: Array<{ filePath: string; fileName: string }>,
    sharedParameters: BatchSharedParameters,
    continueOnError: boolean,
  ) => void;
  updateBatchProgress: (
    fileIndex: number,
    fileStatus: BatchFileStatus,
    overallProgress: number,
  ) => void;
  completeBatchFile: (fileIndex: number, analysisId: string) => void;
  failBatchFile: (fileIndex: number, error: string) => void;
  completeBatch: (elapsedMs: number) => void;
  cancelBatch: () => void;
  clearBatch: () => void;
}

// ============================================================================
// Slice
// ============================================================================

export interface BatchSlice extends BatchActions {
  batch: BatchState;
}

export const defaultBatchState: BatchState = {
  currentBatch: null,
  batchHistory: [],
};

export const createBatchSlice: ImmerStateCreator<BatchSlice> = (set) => ({
  batch: { ...defaultBatchState },

  createBatch: (id, files, sharedParameters, continueOnError) => {
    set((state) => {
      state.batch.currentBatch = {
        id,
        status: "running",
        files: files.map((f) => ({
          filePath: f.filePath,
          fileName: f.fileName,
          status: "queued",
          progress: 0,
        })),
        totalFiles: files.length,
        completedFiles: 0,
        failedFiles: 0,
        currentFileIndex: 0,
        overallProgress: 0,
        continueOnError,
        startedAt: Date.now(),
        sharedParameters,
      };
    });
  },

  updateBatchProgress: (fileIndex, fileStatus, overallProgress) => {
    set((state) => {
      const batch = state.batch.currentBatch;
      if (!batch) return;

      batch.currentFileIndex = fileIndex;
      batch.overallProgress = overallProgress;

      if (fileIndex < batch.files.length) {
        batch.files[fileIndex].status = fileStatus;
        if (fileStatus === "running" && !batch.files[fileIndex].startedAt) {
          batch.files[fileIndex].startedAt = Date.now();
        }
      }
    });
  },

  completeBatchFile: (fileIndex, analysisId) => {
    set((state) => {
      const batch = state.batch.currentBatch;
      if (!batch || fileIndex >= batch.files.length) return;

      batch.files[fileIndex].status = "completed";
      batch.files[fileIndex].analysisId = analysisId;
      batch.files[fileIndex].completedAt = Date.now();
      batch.completedFiles += 1;
    });
  },

  failBatchFile: (fileIndex, error) => {
    set((state) => {
      const batch = state.batch.currentBatch;
      if (!batch || fileIndex >= batch.files.length) return;

      batch.files[fileIndex].status = "error";
      batch.files[fileIndex].error = error;
      batch.files[fileIndex].completedAt = Date.now();
      batch.failedFiles += 1;
    });
  },

  completeBatch: (elapsedMs) => {
    set((state) => {
      const batch = state.batch.currentBatch;
      if (!batch) return;

      batch.completedAt = Date.now();
      batch.elapsedMs = elapsedMs;
      batch.overallProgress = 100;

      if (batch.failedFiles === 0) {
        batch.status = "completed";
      } else if (batch.completedFiles > 0) {
        batch.status = "completed";
      } else {
        batch.status = "error";
      }

      // Add to history (most recent first, cap at MAX_BATCH_HISTORY)
      state.batch.batchHistory = [
        { ...batch },
        ...state.batch.batchHistory,
      ].slice(0, MAX_BATCH_HISTORY);
    });
  },

  cancelBatch: () => {
    set((state) => {
      const batch = state.batch.currentBatch;
      if (!batch) return;

      batch.status = "cancelled";
      batch.completedAt = Date.now();

      // Mark remaining queued files as cancelled
      for (const file of batch.files) {
        if (file.status === "queued") {
          file.status = "cancelled";
        }
      }

      // Add to history
      state.batch.batchHistory = [
        { ...batch },
        ...state.batch.batchHistory,
      ].slice(0, MAX_BATCH_HISTORY);
    });
  },

  clearBatch: () => {
    set((state) => {
      state.batch.currentBatch = null;
    });
  },
});
