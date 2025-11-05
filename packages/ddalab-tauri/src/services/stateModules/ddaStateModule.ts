/**
 * DDA State Module
 *
 * Manages DDA analysis state for each file.
 * This includes analysis history, parameters, and current analysis.
 */

import { invoke } from "@tauri-apps/api/core";
import { FileStateModule, FileDDAState } from "@/types/fileCentricState";

export class DDAStateModule implements FileStateModule<FileDDAState> {
  readonly moduleId = "dda";

  async loadState(filePath: string): Promise<FileDDAState | null> {
    try {
      const state = await invoke<FileDDAState>("get_file_dda_state", {
        filePath,
      });
      return state;
    } catch (error) {
      console.log("[DDAStateModule] No saved state for file:", filePath);
      return null;
    }
  }

  async saveState(filePath: string, state: FileDDAState): Promise<void> {
    try {
      await invoke("save_file_dda_state", {
        filePath,
        state,
      });
    } catch (error) {
      console.error("[DDAStateModule] Failed to save state:", error);
      throw error;
    }
  }

  async clearState(filePath: string): Promise<void> {
    try {
      await invoke("clear_file_dda_state", {
        filePath,
      });
    } catch (error) {
      console.error("[DDAStateModule] Failed to clear state:", error);
    }
  }

  getDefaultState(): FileDDAState {
    return {
      currentAnalysisId: null,
      analysisHistory: [],
      lastParameters: {
        variants: ["single_timeseries"],
        windowLength: 64,
        windowStep: 10,
        scaleMin: 1,
        scaleMax: 20,
        scaleNum: 20,
      },
      selectedVariants: ["single_timeseries"],
      lastUpdated: new Date().toISOString(),
    };
  }

  validateState(state: any): state is FileDDAState {
    return (
      typeof state === "object" &&
      (state.currentAnalysisId === null ||
        typeof state.currentAnalysisId === "string") &&
      Array.isArray(state.analysisHistory) &&
      typeof state.lastParameters === "object" &&
      Array.isArray(state.selectedVariants)
    );
  }
}
