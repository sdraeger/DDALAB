"use client";

/**
 * Batch Analysis Hook
 *
 * Manages batch DDA analysis lifecycle:
 * - Listens for `batch-progress` Tauri events
 * - Dispatches progress updates to batchSlice
 * - Provides submitBatch and cancelCurrentBatch actions
 */

import { useEffect, useCallback, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/store/appStore";
import { tauriBackendService } from "@/services/tauriBackendService";
import type {
  BatchJob,
  BatchSharedParameters,
  ChannelSelection,
} from "@/store/slices/batchSlice";

// ============================================================================
// Types matching Rust BatchProgressEvent / BatchAnalysisResult
// ============================================================================

interface BatchProgressEvent {
  batchId: string;
  fileIndex: number;
  totalFiles: number;
  filePath: string;
  fileStatus: string;
  overallProgress: number;
  message: string;
}

interface BatchFileResultPayload {
  filePath: string;
  status: string;
  analysisId?: string;
  error?: string;
}

interface BatchAnalysisResultPayload {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  results: BatchFileResultPayload[];
  elapsedMs: number;
  groupId?: string;
}

// Rust-side request types
interface BatchAnalysisIPCRequest {
  batchId: string;
  requests: DDAAnalysisIPCRequest[];
  continueOnError: boolean;
}

interface DDAAnalysisIPCRequest {
  filePath: string;
  channels: number[] | null;
  timeRange: { start: number; end: number };
  preprocessingOptions: { highpass: number | null; lowpass: number | null };
  algorithmSelection: {
    enabledVariants: string[];
    selectMask: string | null;
  };
  windowParameters: {
    windowLength: number;
    windowStep: number;
    ctWindowLength: number | null;
    ctWindowStep: number | null;
  };
  scaleParameters: { delayList: number[] };
  ctChannelPairs: [number, number][] | null;
  cdChannelPairs: [number, number][] | null;
  modelParameters: { dm: number; order: number; nrTau: number } | null;
  variantConfigs: Record<string, unknown> | null;
}

/**
 * Resolves a ChannelSelection into per-file numeric channel indices.
 * - "all"     → null for each file (backend uses all channels)
 * - "pattern" → loads file info, matches regex against labels, returns indices
 * - "names"   → loads file info, finds indices of named channels
 */
async function resolveChannelsPerFile(
  filePaths: string[],
  selection: ChannelSelection,
): Promise<(number[] | null)[]> {
  if (selection.mode === "all") {
    return filePaths.map(() => null);
  }

  // For pattern and names modes, we need channel labels from each file
  const results: (number[] | null)[] = [];

  for (const fp of filePaths) {
    try {
      const info = await tauriBackendService.getEdfInfo(fp);
      const labels = info.channels;

      if (selection.mode === "pattern") {
        if (!selection.pattern.trim()) {
          // Empty pattern = all channels
          results.push(null);
        } else {
          const re = new RegExp(selection.pattern, "i");
          const indices = labels
            .map((label, idx) => (re.test(label) ? idx : -1))
            .filter((idx) => idx !== -1);
          results.push(indices.length > 0 ? indices : null);
        }
      } else {
        // "names" mode
        const nameSet = new Set(selection.names);
        const indices = labels
          .map((label, idx) => (nameSet.has(label) ? idx : -1))
          .filter((idx) => idx !== -1);
        results.push(indices.length > 0 ? indices : null);
      }
    } catch {
      // If we can't read the file, fall back to all channels
      results.push(null);
    }
  }

  return results;
}

// Module-level listener guard
let batchListenerInitialized = false;

export function useBatchAnalysis() {
  const {
    currentBatch,
    batchHistory,
    createBatch,
    updateBatchProgress,
    completeBatchFile,
    failBatchFile,
    completeBatch,
    cancelBatch,
    clearBatch,
  } = useAppStore(
    useShallow((s) => ({
      currentBatch: s.batch.currentBatch,
      batchHistory: s.batch.batchHistory,
      createBatch: s.createBatch,
      updateBatchProgress: s.updateBatchProgress,
      completeBatchFile: s.completeBatchFile,
      failBatchFile: s.failBatchFile,
      completeBatch: s.completeBatch,
      cancelBatch: s.cancelBatch,
      clearBatch: s.clearBatch,
    })),
  );

  const isSubmitting = useRef(false);

  // Set up batch-progress event listener
  useEffect(() => {
    if (batchListenerInitialized) return;
    batchListenerInitialized = true;

    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<BatchProgressEvent>("batch-progress", (event) => {
        const payload = event.payload;
        const store = useAppStore.getState();
        const batch = store.batch.currentBatch;

        if (!batch || batch.id !== payload.batchId) return;

        if (payload.fileStatus === "running") {
          store.updateBatchProgress(
            payload.fileIndex,
            "running",
            payload.overallProgress,
          );
        } else if (payload.fileStatus === "completed") {
          // completeBatchFile will be called from the result processing
          store.updateBatchProgress(
            payload.fileIndex,
            "completed",
            payload.overallProgress,
          );
        } else if (payload.fileStatus === "error") {
          store.updateBatchProgress(
            payload.fileIndex,
            "error",
            payload.overallProgress,
          );
        }
      });
    };

    setup();

    return () => {
      batchListenerInitialized = false;
      unlisten?.();
    };
  }, []);

  const submitBatch = useCallback(
    async (
      filePaths: string[],
      channelSelection: ChannelSelection,
      sharedParams: BatchSharedParameters,
      continueOnError: boolean,
    ) => {
      if (isSubmitting.current) return;
      isSubmitting.current = true;

      const batchId = crypto.randomUUID();

      // Create batch in store
      const files = filePaths.map((fp) => ({
        filePath: fp,
        fileName: fp.split("/").pop() || fp,
      }));
      createBatch(batchId, files, sharedParams, continueOnError);

      // Resolve channel selection → per-file numeric indices
      const resolvedChannels = await resolveChannelsPerFile(
        filePaths,
        channelSelection,
      );

      // Build IPC requests
      const requests: DDAAnalysisIPCRequest[] = filePaths.map((fp, i) => ({
        filePath: fp,
        channels: resolvedChannels[i],
        timeRange: { start: 0, end: Number.MAX_SAFE_INTEGER },
        preprocessingOptions: { highpass: null, lowpass: null },
        algorithmSelection: {
          enabledVariants: sharedParams.variants,
          selectMask: null,
        },
        windowParameters: {
          windowLength: sharedParams.windowLength,
          windowStep: sharedParams.windowStep,
          ctWindowLength: null,
          ctWindowStep: null,
        },
        scaleParameters: { delayList: sharedParams.delays },
        ctChannelPairs: null,
        cdChannelPairs: null,
        modelParameters: { dm: 4, order: 4, nrTau: 2 },
        variantConfigs: null,
      }));

      const ipcRequest: BatchAnalysisIPCRequest = {
        batchId,
        requests,
        continueOnError,
      };

      try {
        const result = await invoke<BatchAnalysisResultPayload>(
          "submit_batch_analysis",
          { request: ipcRequest },
        );

        // Process final results
        const store = useAppStore.getState();
        for (const fileResult of result.results) {
          const fileIndex = filePaths.indexOf(fileResult.filePath);
          if (fileIndex === -1) continue;

          if (fileResult.status === "completed" && fileResult.analysisId) {
            store.completeBatchFile(fileIndex, fileResult.analysisId);
          } else if (fileResult.status === "error") {
            store.failBatchFile(fileIndex, fileResult.error || "Unknown error");
          }
        }

        store.completeBatch(result.elapsedMs);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[useBatchAnalysis] Batch failed:", errorMsg);

        // If the whole invocation failed, cancel the batch
        const store = useAppStore.getState();
        store.cancelBatch();
      } finally {
        isSubmitting.current = false;
      }
    },
    [createBatch],
  );

  const cancelCurrentBatch = useCallback(async () => {
    try {
      await invoke("cancel_batch_analysis");
      cancelBatch();
    } catch (err) {
      console.error("[useBatchAnalysis] Cancel failed:", err);
    }
  }, [cancelBatch]);

  return {
    currentBatch,
    batchHistory,
    isRunning: currentBatch?.status === "running",
    submitBatch,
    cancelCurrentBatch,
    clearBatch,
  };
}
