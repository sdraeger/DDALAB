/**
 * State Persistence Service
 * Handles saving and loading of UI state using Tauri backend
 */

import { invoke } from '@tauri-apps/api/core';
import {
  AppState,
  StatePersistenceOptions,
  StateSnapshot,
  AnalysisResult,
  PlotState,
  DDAState,
  FileManagerState,
  WindowState
} from '@/types/persistence';

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
    maxHistoryItems: 50
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
      const start = performance.now();
      console.log('DEBUG: StatePersistenceService.initialize() called');

      const savedState = await invoke<AppState>('get_saved_state');
      const elapsed = performance.now() - start;

      console.log(`DEBUG: invoke get_saved_state returned in ${elapsed.toFixed(0)}ms`);

      if (this.options.autoSave) {
        console.log('DEBUG: Starting auto-save with interval:', this.options.saveInterval);
        this.startAutoSave();
      }

      console.log('State persistence service initialized with saved state:', {
        version: savedState.version,
        activeTab: savedState.active_tab,
        hasCurrentAnalysis: !!savedState.dda.current_analysis,
        historyCount: savedState.dda.analysis_history.length
      });

      return savedState;
    } catch (error) {
      console.error('DEBUG: Failed to load saved state, using defaults:', error);
      console.error('DEBUG: Error details:', error);
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

      // Save state to Rust backend
      await invoke('save_complete_state', { completeState: state });
    } catch (error) {
      console.error('DEBUG: Failed to save complete state:', error);
      console.error('DEBUG: State that failed to save:', state);
      throw error;
    }
  }

  /**
   * Save file manager state
   */
  async saveFileManagerState(fileManagerState: FileManagerState): Promise<void> {
    try {
      await invoke('update_file_manager_state', { fileManagerState });
      console.debug('File manager state saved');
    } catch (error) {
      console.error('Failed to save file manager state:', error);
    }
  }

  /**
   * Save plot state
   */
  async savePlotState(plotState: PlotState): Promise<void> {
    try {
      await invoke('update_plot_state', { plotState });
      console.debug('Plot state saved');
    } catch (error) {
      console.error('Failed to save plot state:', error);
    }
  }

  /**
   * Save DDA state
   */
  async saveDDAState(ddaState: DDAState): Promise<void> {
    try {
      await invoke('update_dda_state', { ddaState });
      console.debug('DDA state saved');
    } catch (error) {
      console.error('Failed to save DDA state:', error);
    }
  }

  /**
   * Save analysis result with plot data
   */
  async saveAnalysisResult(analysis: AnalysisResult): Promise<void> {
    try {
      await invoke('save_analysis_result', { analysis });
      console.log('Analysis result saved:', analysis.id);
    } catch (error) {
      console.error('Failed to save analysis result:', error);
    }
  }

  /**
   * Save plot data separately (for performance)
   */
  async savePlotData(plotData: any, analysisId?: string): Promise<void> {
    try {
      if (this.options.includePlotData) {
        await invoke('save_plot_data', { plotData, analysisId });
        console.debug('Plot data saved for analysis:', analysisId);
      }
    } catch (error) {
      console.error('Failed to save plot data:', error);
    }
  }

  /**
   * Save window state (for popout windows)
   */
  async saveWindowState(windowId: string, windowState: WindowState): Promise<void> {
    try {
      await invoke('save_window_state', { windowId, windowState });
      console.debug('Window state saved for:', windowId);
    } catch (error) {
      console.error('Failed to save window state:', error);
    }
  }

  /**
   * Save UI state updates
   */
  async saveUIState(updates: Record<string, any>): Promise<void> {
    try {
      await invoke('update_ui_state', { uiUpdates: updates });
      console.debug('UI state updates saved:', Object.keys(updates));
    } catch (error) {
      console.error('Failed to save UI state updates:', error);
    }
  }

  /**
   * Force immediate state save
   */
  async forceSave(): Promise<void> {
    try {
      await invoke('force_save_state');
      console.log('State force saved successfully');
    } catch (error) {
      console.error('Failed to force save state:', error);
      throw error;
    }
  }

  /**
   * Clear all saved state
   */
  async clearState(): Promise<void> {
    try {
      await invoke('clear_state');
      console.log('State cleared successfully');
    } catch (error) {
      console.error('Failed to clear state:', error);
      throw error;
    }
  }

  /**
   * Get current saved state
   */
  async getSavedState(): Promise<AppState> {
    try {
      return await invoke<AppState>('get_saved_state');
    } catch (error) {
      console.error('Failed to get saved state:', error);
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
        // Get current app state from your app store
        const currentStatePromise = this.getCurrentAppState();
        if (currentStatePromise) {
          // If it's a promise, await it
          if (typeof currentStatePromise?.then === 'function') {
            await currentStatePromise;
          }
          console.debug('Auto-save completed');
        }
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, this.options.saveInterval);

    console.log('Auto-save started with interval:', this.options.saveInterval, 'ms');
  }

  /**
   * Stop automatic state saving
   */
  stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
      console.log('Auto-save stopped');
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
      data: state
    };
  }

  /**
   * Restore from snapshot
   */
  async restoreFromSnapshot(snapshot: StateSnapshot): Promise<void> {
    await this.saveCompleteState(snapshot.data);
    console.log('State restored from snapshot:', snapshot.timestamp);
  }

  /**
   * Get default state structure
   */
  private getDefaultState(): AppState {
    return {
      version: '1.0.0',
      file_manager: {
        selected_file: null,
        current_path: [],
        selected_channels: [],
        search_query: '',
        sort_by: 'name',
        sort_order: 'asc',
        show_hidden: false
      },
      plot: {
        visible_channels: [],
        time_range: [0, 30],
        amplitude_range: [-100, 100],
        zoom_level: 1.0,
        annotations: [],
        color_scheme: 'default',
        plot_mode: 'raw',
        filters: {}
      },
      dda: {
        selected_variants: ['single_timeseries'],
        parameters: {},
        last_analysis_id: null,
        current_analysis: null,
        analysis_history: [],
        analysis_parameters: {},
        running: false
      },
      ui: {},
      windows: {},
      active_tab: 'files',
      sidebar_collapsed: false,
      panel_sizes: {
        sidebar: 0.25,
        main: 0.75,
        'plot-height': 0.6
      }
    };
  }

  /**
   * Get current app state from store
   * This should be implemented to integrate with your specific state management
   */
  private getCurrentAppState(): any {
    // Import dynamically to avoid circular dependencies
    try {
      // This will be set by the store when it initializes
      return (this as any).__getCurrentState?.();
    } catch (error) {
      console.warn('Could not get current app state for auto-save:', error);
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
    console.log('State persistence service destroyed');
  }
}

// Singleton instance
let persistenceService: StatePersistenceService | null = null;

export function getStatePersistenceService(options?: Partial<StatePersistenceOptions>): StatePersistenceService {
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
import { useEffect, useRef } from 'react';

export function useStatePersistence(options?: Partial<StatePersistenceOptions>) {
  const serviceRef = useRef<StatePersistenceService | null>(null);

  useEffect(() => {
    serviceRef.current = getStatePersistenceService(options);
    return () => {
      // Don't destroy on unmount as it's a singleton, only on app exit
    };
  }, []);

  return serviceRef.current;
}
