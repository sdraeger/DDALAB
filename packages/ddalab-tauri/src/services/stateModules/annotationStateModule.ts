/**
 * Annotation State Module
 *
 * Manages annotation state for each file.
 * This includes both time series and DDA result annotations.
 */

import { invoke } from "@tauri-apps/api/core";
import { FileStateModule, FileAnnotationState } from "@/types/fileCentricState";

export class AnnotationStateModule
  implements FileStateModule<FileAnnotationState>
{
  readonly moduleId = "annotations";

  async loadState(filePath: string): Promise<FileAnnotationState | null> {
    try {
      const state = await invoke<FileAnnotationState>(
        "get_file_annotation_state",
        {
          filePath,
        },
      );
      return state;
    } catch (error) {
      console.log("[AnnotationStateModule] No saved state for file:", filePath);
      return null;
    }
  }

  async saveState(filePath: string, state: FileAnnotationState): Promise<void> {
    try {
      await invoke("save_file_annotation_state", {
        filePath,
        state,
      });
    } catch (error) {
      console.error("[AnnotationStateModule] Failed to save state:", error);
      throw error;
    }
  }

  async clearState(filePath: string): Promise<void> {
    try {
      await invoke("clear_file_annotation_state", {
        filePath,
      });
    } catch (error) {
      console.error("[AnnotationStateModule] Failed to clear state:", error);
    }
  }

  getDefaultState(): FileAnnotationState {
    return {
      timeSeries: {
        global: [],
        channels: {},
      },
      ddaResults: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  validateState(state: any): state is FileAnnotationState {
    return (
      typeof state === "object" &&
      typeof state.timeSeries === "object" &&
      Array.isArray(state.timeSeries.global) &&
      typeof state.timeSeries.channels === "object" &&
      typeof state.ddaResults === "object"
    );
  }
}
