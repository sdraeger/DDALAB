/**
 * TypeScript types for UI state persistence
 * These types match the Rust structures in main.rs
 */

export interface ApiConfig {
  url: string;
  timeout: number;
}

export interface FileManagerState {
  data_directory_path?: string;
  selected_file: string | null;
  current_path: string[];
  selected_channels: string[];
  search_query: string;
  sort_by: string;
  sort_order: string;
  show_hidden: boolean;
}

export interface PlotState {
  visible_channels: string[];
  time_range: [number, number];
  amplitude_range: [number, number];
  zoom_level: number;
  annotations: any[];
  color_scheme: string;
  plot_mode: string;
  filters: Record<string, any>;
}

export interface AnalysisResult {
  id: string;
  file_path: string;
  created_at: string;
  results: any;
  parameters: any;
  plot_data?: any;
}

export interface DDAState {
  selected_variants: string[];
  parameters: Record<string, any>;
  last_analysis_id: string | null;
  current_analysis: AnalysisResult | null;
  analysis_history: AnalysisResult[];
  analysis_parameters: Record<string, any>;
  running: boolean;
}

export interface WindowState {
  position: [number, number];
  size: [number, number];
  maximized: boolean;
  tab: string;
}

export interface AppState {
  version: string;
  file_manager: FileManagerState;
  plot: PlotState;
  dda: DDAState;
  ui: Record<string, any>;
  windows: Record<string, WindowState>;
  active_tab: string;
  sidebar_collapsed: boolean;
  panel_sizes: Record<string, number>;
}

export interface AppPreferences {
  api_config: ApiConfig;
  window_state: Record<string, any>;
  theme: string;
}

// Tauri command interfaces
export interface TauriCommands {
  get_app_state(): Promise<AppState>;
  update_file_manager_state(state: FileManagerState): Promise<void>;
  update_plot_state(state: PlotState): Promise<void>;
  update_dda_state(state: DDAState): Promise<void>;
  update_ui_state(updates: Record<string, any>): Promise<void>;
  save_analysis_result(analysis: AnalysisResult): Promise<void>;
  save_plot_data(plotData: any, analysisId?: string): Promise<void>;
  save_window_state(windowId: string, windowState: WindowState): Promise<void>;
  save_complete_state(state: any): Promise<void>;
  get_saved_state(): Promise<any>;
  force_save_state(): Promise<void>;
  clear_state(): Promise<void>;
  get_app_preferences(): Promise<AppPreferences>;
  save_app_preferences(preferences: AppPreferences): Promise<void>;
}

// State persistence utility types
export interface StatePersistenceOptions {
  autoSave: boolean;
  saveInterval?: number; // milliseconds
  includeAnalysisHistory: boolean;
  includePlotData: boolean;
  maxHistoryItems: number;
}

export interface StateSnapshot {
  timestamp: string;
  version: string;
  data: AppState;
  checksum?: string;
}

export interface StateMigration {
  fromVersion: string;
  toVersion: string;
  migrate: (oldState: any) => AppState;
}
