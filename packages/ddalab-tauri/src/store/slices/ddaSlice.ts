/**
 * DDA Analysis state slice
 */

import { TauriService } from "@/services/tauriService";
import { getInitializedFileStateManager } from "@/services/fileStateInitializer";
import { getStatePersistenceService } from "@/services/statePersistenceService";
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

// Module-level debounce timer (replaces window object pattern)
let ddaStateUpdateTimeout: NodeJS.Timeout | undefined;

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
    console.log("[STORE] setCurrentAnalysis called:", {
      hasAnalysis: !!analysis,
      analysisId: analysis?.id,
      isNSGResult: analysis?.source === "nsg",
    });
    set((state) => {
      state.dda.currentAnalysis = analysis;
      if (analysis?.source === "nsg") {
        state.dda.previousAnalysis = state.dda.currentAnalysis;
      }
    });

    if (TauriService.isTauri()) {
      // Capture state immediately to avoid race condition (don't read with get() in setTimeout)
      const { dda, fileManager } = get();
      const persistenceService = getStatePersistenceService();
      const ddaState: PersistedDDAState = {
        selected_variants: dda.analysisParameters.variants,
        parameters: {
          windowLength: dda.analysisParameters.windowLength,
          windowStep: dda.analysisParameters.windowStep,
          delays: dda.analysisParameters.delays,
        },
        last_analysis_id: analysis?.id || null,
        current_analysis: analysis,
        analysis_history: dda.analysisHistory,
        analysis_parameters: dda.analysisParameters,
        running: dda.isRunning,
      };
      const selectedFilePath = fileManager.selectedFile?.file_path;
      const analysisHistory = dda.analysisHistory;
      const analysisParameters = dda.analysisParameters;

      // Defer persistence to avoid blocking UI, but use captured state
      setTimeout(async () => {
        try {
          await TauriService.updateDDAState(ddaState);
        } catch (err) {
          console.error("[STORE] Failed to update Tauri DDA state:", err);
        }

        if (persistenceService) {
          try {
            await persistenceService.saveDDAState(ddaState);
          } catch (err) {
            console.error("[STORE] Failed to persist DDA state:", err);
          }
        }

        if (selectedFilePath && analysis) {
          try {
            const fileStateManager = getInitializedFileStateManager();
            const fileDDAState: FileDDAState = {
              currentAnalysisId: analysis.id,
              analysisHistory: analysisHistory.map((a) => a.id),
              lastParameters: analysisParameters,
              selectedVariants: analysisParameters.variants,
              lastUpdated: new Date().toISOString(),
            };

            await fileStateManager.updateModuleState(
              selectedFilePath,
              "dda",
              fileDDAState,
            );

            console.log("[STORE] Saved file-centric DDA state:", {
              filePath: selectedFilePath,
              currentAnalysisId: analysis.id,
            });
          } catch (err) {
            console.error(
              "[STORE] Failed to save file-centric DDA state:",
              err,
            );
          }
        }
      }, 0);
    }
  },

  restorePreviousAnalysis: () => {
    const { dda } = get();
    if (dda.previousAnalysis) {
      console.log("[STORE] Restoring previous analysis:", {
        previousId: dda.previousAnalysis.id,
        currentId: dda.currentAnalysis?.id,
      });
      set((state) => {
        state.dda.currentAnalysis = state.dda.previousAnalysis;
        state.dda.previousAnalysis = null;
      });
    } else {
      console.warn("[STORE] No previous analysis to restore");
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
        const persistenceService = getStatePersistenceService();
        const ddaState: PersistedDDAState = {
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
        };
        TauriService.updateDDAState(ddaState).catch(console.error);

        if (persistenceService) {
          persistenceService.saveDDAState(ddaState).catch(console.error);
        }

        const selectedFilePath = fileManager.selectedFile?.file_path;
        if (selectedFilePath) {
          (async () => {
            try {
              const fileStateManager = getInitializedFileStateManager();
              const fileDDAState: FileDDAState = {
                currentAnalysisId: dda.currentAnalysis?.id || null,
                analysisHistory: dda.analysisHistory.map((a) => a.id),
                lastParameters: dda.analysisParameters,
                selectedVariants: dda.analysisParameters.variants,
                lastUpdated: new Date().toISOString(),
              };

              await fileStateManager.updateModuleState(
                selectedFilePath,
                "dda",
                fileDDAState,
              );

              console.log(
                "[STORE] Saved file-centric DDA state (history updated):",
                {
                  filePath: selectedFilePath,
                  historyCount: dda.analysisHistory.length,
                },
              );
            } catch (err) {
              console.error(
                "[STORE] Failed to save file-centric DDA state:",
                err,
              );
            }
          })();
        }
      }, 0);
    }
  },

  setAnalysisHistory: (analyses) => {
    set((state) => {
      state.dda.analysisHistory = analyses;
    });
  },

  updateAnalysisParameters: (parameters) => {
    set((state) => {
      Object.assign(state.dda.analysisParameters, parameters);
    });

    if (ddaStateUpdateTimeout) {
      clearTimeout(ddaStateUpdateTimeout);
    }

    ddaStateUpdateTimeout = setTimeout(() => {
      if (TauriService.isTauri()) {
        const { dda } = get();
        const ddaState: PersistedDDAState = {
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
        };
        TauriService.updateDDAState(ddaState).catch(console.error);
      }
    }, 300);
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
      const ddaState: PersistedDDAState = {
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
      };
      TauriService.updateDDAState(ddaState).catch(console.error);
    }
  },

  updateDelayPreset: (id, updates) => {
    set((state) => {
      const preset = state.dda.customDelayPresets.find((p) => p.id === id);
      if (preset) {
        Object.assign(preset, updates);
      }
    });

    if (TauriService.isTauri()) {
      const { dda } = get();
      const ddaState: PersistedDDAState = {
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
      };
      TauriService.updateDDAState(ddaState).catch(console.error);
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
      const ddaState: PersistedDDAState = {
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
      };
      TauriService.updateDDAState(ddaState).catch(console.error);
    }
  },

  saveAnalysisResult: async (analysis) => {
    const service = getStatePersistenceService();
    if (service) {
      const persistedAnalysis: AnalysisResult = {
        id: analysis.id,
        file_path: analysis.file_path,
        created_at: analysis.created_at || new Date().toISOString(),
        results: analysis.results,
        parameters: analysis.parameters,
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
