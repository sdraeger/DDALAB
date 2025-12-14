/**
 * State Persistence Service
 * Handles saving and loading of UI state using Tauri backend
 */

import { invoke } from "@tauri-apps/api/core";
import {
  AppState,
  StatePersistenceOptions,
  StateSnapshot,
  AnalysisResult,
  PlotState,
  DDAState,
  FileManagerState,
  WindowState,
} from "@/types/persistence";
import { loggers } from "@/lib/logger";
import { useNotificationStore } from "@/store/notificationStore";

// Helper function to notify about persistence errors
function notifyPersistenceError(operation: string, error: unknown) {
  const store = useNotificationStore.getState();
  const errorMessage = error instanceof Error ? error.message : String(error);
  store.notify.error(
    "State Save Failed",
    `Failed to ${operation}. Your changes may not be saved.`,
    "system",
  );
  console.error(`Persistence error (${operation}):`, errorMessage);
}

export class StatePersistenceService {
  private saveTimer: NodeJS.Timeout | null = null;
  private throttleTimer: NodeJS.Timeout | null = null;
  private pendingSave: any = null;
  private lastSaveTime: number = 0;
  private readonly THROTTLE_MS = 500; // Throttle saves to max once per 500ms
  private options: StatePersistenceOptions = {
    autoSave: true,
    saveInterval: 30000, // 30 seconds
    includeAnalysisHistory: true,
    includePlotData: true,
    maxHistoryItems: 50,
  };

  constructor(options?: Partial<StatePersistenceOptions>) {
    if (options) {
      this.options = { ...this.options, ...options };
    }
  }

  /**
   * Initialize the persistence service
   */
  async initialize(): Promise<AppState> {
    try {
      const savedState = await invoke<AppState>("get_saved_state");

      if (this.options.autoSave) {
        this.startAutoSave();
      }

      return savedState;
    } catch (error) {
      notifyPersistenceError("load saved state", error);
      return this.getDefaultState();
    }
  }

  /**
   * Save the complete application state with throttling to prevent excessive saves
   */
  async saveCompleteState(state: any): Promise<void> {
    // Store the pending save
    this.pendingSave = state;

    // Check if we should throttle
    const now = Date.now();
    const timeSinceLastSave = now - this.lastSaveTime;

    if (timeSinceLastSave < this.THROTTLE_MS) {
      // Throttle - schedule for later if not already scheduled
      if (!this.throttleTimer) {
        const delay = this.THROTTLE_MS - timeSinceLastSave;
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          if (this.pendingSave) {
            this.executeSave(this.pendingSave);
          }
        }, delay);
      }
      return;
    }

    // Execute immediately
    await this.executeSave(state);
  }

  /**
   * Internal method to execute the actual save
   */
  private async executeSave(state: any): Promise<void> {
    try {
      this.lastSaveTime = Date.now();
      this.pendingSave = null;
      await invoke("save_complete_state", { completeState: state });
    } catch (error) {
      notifyPersistenceError("save application state", error);
      throw error;
    }
  }

  /**
   * Save file manager state
   */
  async saveFileManagerState(
    fileManagerState: FileManagerState,
  ): Promise<void> {
    try {
      await invoke("update_file_manager_state", { fileManagerState });
    } catch (error) {
      console.error("Failed to save file manager state:", error);
    }
  }

  /**
   * Save plot state
   */
  async savePlotState(plotState: PlotState): Promise<void> {
    try {
      await invoke("update_plot_state", { plotState });
    } catch (error) {
      console.error("Failed to save plot state:", error);
    }
  }

  /**
   * Save DDA state
   */
  async saveDDAState(ddaState: DDAState): Promise<void> {
    try {
      await invoke("update_dda_state", { ddaState });
    } catch (error) {
      console.error("Failed to save DDA state:", error);
    }
  }

  /**
   * Save analysis result with plot data
   */
  async saveAnalysisResult(analysis: AnalysisResult): Promise<void> {
    try {
      await invoke("save_analysis_result", { analysis });
    } catch (error) {
      console.error("Failed to save analysis result:", error);
    }
  }

  /**
   * Save plot data separately (for performance)
   */
  async savePlotData(plotData: any, analysisId?: string): Promise<void> {
    try {
      if (this.options.includePlotData) {
        await invoke("save_plot_data", { plotData, analysisId });
      }
    } catch (error) {
      console.error("Failed to save plot data:", error);
    }
  }

  /**
   * Save window state (for popout windows)
   */
  async saveWindowState(
    windowId: string,
    windowState: WindowState,
  ): Promise<void> {
    try {
      await invoke("save_window_state", { windowId, windowState });
    } catch (error) {
      console.error("Failed to save window state:", error);
    }
  }

  /**
   * Save UI state updates
   */
  async saveUIState(updates: Record<string, any>): Promise<void> {
    try {
      await invoke("update_ui_state", { uiUpdates: updates });
    } catch (error) {
      console.error("Failed to save UI state updates:", error);
    }
  }

  /**
   * Force immediate state save
   * This will first flush any pending throttled save, then call force_save_state
   */
  async forceSave(): Promise<void> {
    try {
      // Cancel any pending throttled save and execute immediately
      if (this.throttleTimer) {
        clearTimeout(this.throttleTimer);
        this.throttleTimer = null;
      }

      // If there's a pending save, execute it immediately
      if (this.pendingSave) {
        loggers.persistence.debug("Flushing pending save before force save");
        await this.executeSave(this.pendingSave);
      }

      await invoke("force_save_state");
    } catch (error) {
      notifyPersistenceError("force save state", error);
      throw error;
    }
  }

  /**
   * Clear all saved state
   */
  async clearState(): Promise<void> {
    try {
      await invoke("clear_state");
    } catch (error) {
      console.error("Failed to clear state:", error);
      throw error;
    }
  }

  /**
   * Get current saved state
   */
  async getSavedState(): Promise<AppState> {
    try {
      return await invoke<AppState>("get_saved_state");
    } catch (error) {
      console.error("Failed to get saved state:", error);
      return this.getDefaultState();
    }
  }

  /**
   * Start automatic state saving
   */
  private startAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }

    this.saveTimer = setInterval(async () => {
      try {
        const currentStatePromise = this.getCurrentAppState();
        if (
          currentStatePromise &&
          typeof currentStatePromise?.then === "function"
        ) {
          await currentStatePromise;
        }
      } catch (error) {
        notifyPersistenceError("auto-save state", error);
      }
    }, this.options.saveInterval);
  }

  /**
   * Stop automatic state saving
   */
  stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * Create a state snapshot
   */
  async createSnapshot(): Promise<StateSnapshot> {
    const state = await this.getSavedState();
    return {
      timestamp: new Date().toISOString(),
      version: state.version,
      data: state,
    };
  }

  /**
   * Restore from snapshot
   */
  async restoreFromSnapshot(snapshot: StateSnapshot): Promise<void> {
    await this.saveCompleteState(snapshot.data);
  }

  /**
   * Get default state structure
   */
  private getDefaultState(): AppState {
    return {
      version: "1.0.0",
      file_manager: {
        selected_file: null,
        current_path: [],
        selected_channels: [],
        search_query: "",
        sort_by: "name",
        sort_order: "asc",
        show_hidden: false,
      },
      plot: {
        visible_channels: [],
        time_range: [0, 30],
        amplitude_range: [-100, 100],
        zoom_level: 1.0,
        annotations: [],
        color_scheme: "default",
        plot_mode: "raw",
        filters: {},
      },
      dda: {
        selected_variants: ["single_timeseries"],
        parameters: {},
        last_analysis_id: null,
        current_analysis: null,
        analysis_history: [],
        analysis_parameters: {},
        running: false,
      },
      ui: {},
      windows: {},
      active_tab: "files",
      sidebar_collapsed: false,
      panel_sizes: {
        sidebar: 0.25,
        main: 0.75,
        "plot-height": 0.6,
      },
    };
  }

  /**
   * Get current app state from store
   * This should be implemented to integrate with your specific state management
   */
  private getCurrentAppState(): any {
    try {
      return (this as any).__getCurrentState?.();
    } catch {
      return null;
    }
  }

  /**
   * Set the current state getter (called by the store)
   */
  setCurrentStateGetter(getter: () => any): void {
    (this as any).__getCurrentState = getter;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopAutoSave();
  }
}

// Singleton instance
let persistenceService: StatePersistenceService | null = null;

export function getStatePersistenceService(
  options?: Partial<StatePersistenceOptions>,
): StatePersistenceService {
  if (!persistenceService) {
    persistenceService = new StatePersistenceService(options);
  }
  return persistenceService;
}

export function destroyStatePersistenceService(): void {
  if (persistenceService) {
    persistenceService.destroy();
    persistenceService = null;
  }
}

// React hook for using persistence service
import { useEffect, useRef } from "react";

export function useStatePersistence(
  options?: Partial<StatePersistenceOptions>,
) {
  const serviceRef = useRef<StatePersistenceService | null>(null);

  useEffect(() => {
    serviceRef.current = getStatePersistenceService(options);
    return () => {
      // Don't destroy on unmount as it's a singleton, only on app exit
    };
  }, []);

  return serviceRef.current;
}
