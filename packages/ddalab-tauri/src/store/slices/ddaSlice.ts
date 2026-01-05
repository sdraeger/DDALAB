/**
 * DDA Analysis state slice
 */

import { TauriService } from "@/services/tauriService";
import { getInitializedFileStateManager } from "@/services/fileStateInitializer";
import { getStatePersistenceService } from "@/services/statePersistenceService";
import { debouncedUpdate } from "@/utils/debounce";
import { handleError } from "@/utils/errorHandler";
import { createWorkflowAction } from "@/store/middleware/workflowRecordingMiddleware";
import type {
  DDAState as PersistedDDAState,
  AnalysisResult,
} from "@/types/persistence";
import type { FileDDAState } from "@/types/fileCentricState";
import type {
  DDASlice,
  DDAState,
  DelayPreset,
  ImmerStateCreator,
} from "./types";

/**
 * Creates a PersistedDDAState object from the current DDA state.
 * Extracted to eliminate duplication across persistence operations.
 */
function createPersistedDDAState(
  dda: DDAState,
  overrides?: Partial<PersistedDDAState>,
): PersistedDDAState {
  return {
    selected_variants: dda.analysisParameters.variants,
    parameters: {
      windowLength: dda.analysisParameters.windowLength,
      windowStep: dda.analysisParameters.windowStep,
      delays: dda.analysisParameters.delays,
    },
    last_analysis_id: dda.currentAnalysis?.id || null,
    current_analysis: dda.currentAnalysis,
    analysis_history: dda.analysisHistory,
    analysis_parameters: dda.analysisParameters,
    running: dda.isRunning,
    custom_delay_presets: dda.customDelayPresets,
    ...overrides,
  };
}

/**
 * Persists DDA state to Tauri backend and file state manager.
 * Handles all persistence operations in parallel for better performance.
 */
async function persistDDAState(
  ddaState: PersistedDDAState,
  options?: {
    selectedFilePath?: string;
    analysisHistory?: { id: string }[];
    analysisParameters?: DDAState["analysisParameters"];
    currentAnalysisId?: string | null;
  },
): Promise<void> {
  const persistenceService = getStatePersistenceService();

  const persistencePromises: Promise<void>[] = [
    TauriService.updateDDAState(ddaState).catch((error) =>
      handleError(error, {
        source: "DDA State Persistence",
        severity: "silent",
      }),
    ),
  ];

  if (persistenceService) {
    persistencePromises.push(
      persistenceService.saveDDAState(ddaState).catch((error) =>
        handleError(error, {
          source: "DDA State Persistence",
          severity: "silent",
        }),
      ),
    );
  }

  if (options?.selectedFilePath && options.analysisParameters) {
    // Capture values before async closure for TypeScript narrowing
    const filePath = options.selectedFilePath;
    const params = options.analysisParameters;
    const history = options.analysisHistory;
    const analysisId = options.currentAnalysisId;

    persistencePromises.push(
      (async () => {
        const fileStateManager = getInitializedFileStateManager();
        const fileDDAState: FileDDAState = {
          currentAnalysisId: analysisId ?? null,
          analysisHistory: history?.map((a) => a.id) ?? [],
          lastParameters: params,
          selectedVariants: params.variants,
          lastUpdated: new Date().toISOString(),
        };
        await fileStateManager.updateModuleState(filePath, "dda", fileDDAState);
      })().catch(() => {}),
    );
  }

  await Promise.all(persistencePromises);
}

export const defaultDDAState: DDAState = {
  currentAnalysis: null,
  previousAnalysis: null,
  analysisHistory: [],
  analysisParameters: {
    variants: ["single_timeseries"],
    windowLength: 64,
    windowStep: 10,
    delays: [7, 10], // Default EEG delays
  },
  customDelayPresets: [],
  isRunning: false,
  pendingAnalysisId: null,
};

export const createDDASlice: ImmerStateCreator<DDASlice> = (set, get) => ({
  dda: defaultDDAState,

  setCurrentAnalysis: (analysis) => {
    set((state) => {
      state.dda.currentAnalysis = analysis;
      if (analysis?.source === "nsg") {
        state.dda.previousAnalysis = state.dda.currentAnalysis;
      }
    });

    if (TauriService.isTauri()) {
      // Capture state immediately to avoid race condition
      const { dda, fileManager } = get();
      const ddaState = createPersistedDDAState(dda, {
        last_analysis_id: analysis?.id || null,
        current_analysis: analysis,
      });
      const selectedFilePath = fileManager.selectedFile?.file_path;

      setTimeout(() => {
        persistDDAState(ddaState, {
          selectedFilePath: analysis ? selectedFilePath : undefined,
          analysisHistory: dda.analysisHistory,
          analysisParameters: dda.analysisParameters,
          currentAnalysisId: analysis?.id,
        });
      }, 0);
    }
  },

  restorePreviousAnalysis: () => {
    const { dda } = get();
    if (dda.previousAnalysis) {
      set((state) => {
        state.dda.currentAnalysis = state.dda.previousAnalysis;
        state.dda.previousAnalysis = null;
      });
    }
  },

  addAnalysisToHistory: (analysis) => {
    set((state) => {
      state.dda.analysisHistory = [
        analysis,
        ...state.dda.analysisHistory.slice(0, 9),
      ];
    });

    if (TauriService.isTauri()) {
      setTimeout(() => {
        const { dda, fileManager } = get();
        const ddaState = createPersistedDDAState(dda);
        const selectedFilePath = fileManager.selectedFile?.file_path;

        persistDDAState(ddaState, {
          selectedFilePath,
          analysisHistory: dda.analysisHistory,
          analysisParameters: dda.analysisParameters,
          currentAnalysisId: dda.currentAnalysis?.id,
        });
      }, 0);
    }
  },

  setAnalysisHistory: (analyses) => {
    set((state) => {
      state.dda.analysisHistory = analyses;
    });
  },

  updateAnalysisParameters: (parameters) => {
    const filePath = get().fileManager.selectedFile?.file_path;

    set((state) => {
      state.dda.analysisParameters = {
        ...state.dda.analysisParameters,
        ...parameters,
      };
    });

    // Record parameter changes for workflow (silently no-ops if recording disabled)
    if (parameters.variants) {
      createWorkflowAction.selectDDAVariants(parameters.variants, filePath);
    }
    if (
      parameters.windowLength !== undefined ||
      parameters.windowStep !== undefined
    ) {
      const { dda } = get();
      createWorkflowAction.setDDAParameters(
        {
          windowLength: dda.analysisParameters.windowLength,
          windowStep: dda.analysisParameters.windowStep,
        },
        filePath,
      );
    }

    if (TauriService.isTauri()) {
      debouncedUpdate(
        "dda:parameters",
        () => {
          const { dda } = get();
          const ddaState = createPersistedDDAState(dda);
          TauriService.updateDDAState(ddaState).catch((error) =>
            handleError(error, {
              source: "DDA State Persistence",
              severity: "silent",
            }),
          );
        },
        300,
      );
    }
  },

  setDDARunning: (running) => {
    set((state) => {
      state.dda.isRunning = running;
    });
  },

  addDelayPreset: (preset) => {
    set((state) => {
      const newPreset: DelayPreset = {
        ...preset,
        id: `custom-${Date.now()}`,
        isBuiltIn: false,
      };
      state.dda.customDelayPresets.push(newPreset);
    });

    if (TauriService.isTauri()) {
      const { dda } = get();
      const ddaState = createPersistedDDAState(dda);
      TauriService.updateDDAState(ddaState).catch((error) =>
        handleError(error, {
          source: "DDA State Persistence",
          severity: "silent",
        }),
      );
    }
  },

  updateDelayPreset: (id, updates) => {
    set((state) => {
      const index = state.dda.customDelayPresets.findIndex((p) => p.id === id);
      if (index !== -1) {
        state.dda.customDelayPresets[index] = {
          ...state.dda.customDelayPresets[index],
          ...updates,
        };
      }
    });

    if (TauriService.isTauri()) {
      const { dda } = get();
      const ddaState = createPersistedDDAState(dda);
      TauriService.updateDDAState(ddaState).catch((error) =>
        handleError(error, {
          source: "DDA State Persistence",
          severity: "silent",
        }),
      );
    }
  },

  deleteDelayPreset: (id) => {
    set((state) => {
      state.dda.customDelayPresets = state.dda.customDelayPresets.filter(
        (p) => p.id !== id,
      );
    });

    if (TauriService.isTauri()) {
      const { dda } = get();
      const ddaState = createPersistedDDAState(dda);
      TauriService.updateDDAState(ddaState).catch((error) =>
        handleError(error, {
          source: "DDA State Persistence",
          severity: "silent",
        }),
      );
    }
  },

  saveAnalysisResult: async (analysis) => {
    const service = getStatePersistenceService();
    if (service) {
      const persistedAnalysis: AnalysisResult = {
        id: analysis.id,
        file_path: analysis.file_path,
        channels: analysis.channels,
        created_at: analysis.created_at || new Date().toISOString(),
        results: analysis.results,
        parameters: analysis.parameters,
        status: analysis.status || "completed",
        plot_data: null,
      };
      await service.saveAnalysisResult(persistedAnalysis);
    }
  },

  setPendingAnalysisId: (id) => {
    set((state) => {
      state.dda.pendingAnalysisId = id;
    });
  },
});
