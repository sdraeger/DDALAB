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
      return await invoke<FileDDAState>("get_file_dda_state", { filePath });
    } catch {
      return null;
    }
  }

  async saveState(filePath: string, state: FileDDAState): Promise<void> {
    await invoke("save_file_dda_state", { filePath, state });
  }

  async clearState(filePath: string): Promise<void> {
    try {
      await invoke("clear_file_dda_state", { filePath });
    } catch {
      // State may not exist, ignore
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
        delays: [7, 10], // Default EEG delays
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
