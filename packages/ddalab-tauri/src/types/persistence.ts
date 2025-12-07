/**
 * TypeScript types for UI state persistence
 * These types match the Rust structures in main.rs
 */

import type {
  DDAAnalysisRequest,
  DDAVariantResult,
  Annotation,
  DDAResult,
  DDAPlotData,
} from "./api";
import type {
  TimeSeriesAnnotations,
  DDAResultAnnotations,
} from "./annotations";

/** Re-export DDAResult as AnalysisResult for persistence compatibility */
export type AnalysisResult = DDAResult;

/** Re-export DDAPlotData for backward compatibility */
export type { DDAPlotData } from "./api";

export interface ApiConfig {
  url: string;
  timeout: number;
}

/** Plot filter settings for time series visualization */
export interface PlotFilters {
  chunkSize?: number;
  chunkStart?: number;
  amplitude?: number;
  showAnnotations?: boolean;
  chartHeight?: number;
}

/** Frontend state nested in UI state (from Tauri persistence) */
export interface FrontendState {
  sidebarOpen?: boolean;
  sidebarWidth?: number;
  zoom?: number;
  panelSizes?: number[];
  layout?: string;
  theme?: string;
  expertMode?: boolean;
  /** Annotations stored in frontend state */
  annotations?: {
    timeSeries?: Record<string, TimeSeriesAnnotations>;
    ddaResults?: Record<string, DDAResultAnnotations>;
  };
}

/** Position and size of a popout window */
export interface PersistedWindowPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** State of a popout window for persistence */
export interface PersistedPopoutWindowState {
  id: string;
  type: "timeseries" | "dda-results" | "eeg-visualization";
  isLocked: boolean;
  data: any;
  position: PersistedWindowPosition;
}

/** UI state stored for persistence */
export interface UIStateSettings {
  activeTab?: string;
  primaryNav?: string;
  secondaryNav?: string;
  sidebarOpen?: boolean;
  sidebarWidth?: number;
  zoom?: number;
  panelSizes?: number[];
  layout?: string;
  theme?: string;
  expertMode?: boolean;
  /** Tracks which panels are collapsed by their ID */
  collapsedPanels?: Record<string, boolean>;
  /** Nested frontend state from Tauri */
  frontend_state?: FrontendState;
  /** Open popout windows to restore on next startup */
  popoutWindows?: PersistedPopoutWindowState[];
}

/** DDA analysis results structure */
export interface DDAResultData {
  scales: number[];
  variants: DDAVariantResult[];
  dda_matrix?: Record<string, number[]>;
  exponents?: Record<string, number>;
  quality_metrics?: Record<string, number>;
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

export interface PreprocessingOptions {
  // Filters
  highpass?: number; // Hz, e.g., 0.5 (removes DC drift)
  lowpass?: number; // Hz, e.g., 70 (anti-aliasing)
  notch?: number[]; // Hz, e.g., [50, 60] (line noise)

  // Signal enhancement
  smoothing?: {
    enabled: boolean;
    method: "moving_average" | "savitzky_golay";
    windowSize: number; // samples
    polynomialOrder?: number; // for Savitzky-Golay
  };
  baselineCorrection?: "none" | "mean" | "median";

  // Artifact removal
  outlierRemoval?: {
    enabled: boolean;
    method: "clip" | "remove" | "interpolate";
    threshold: number; // in standard deviations
  };
  spikeRemoval?: {
    enabled: boolean;
    threshold: number; // in standard deviations
    windowSize: number; // samples for detection
  };

  // Normalization
  normalization?: "none" | "zscore" | "minmax";
  normalizationRange?: [number, number]; // for minmax, e.g., [-1, 1]
}

export interface PlotState {
  visible_channels: string[];
  time_range: [number, number];
  amplitude_range: [number, number];
  zoom_level: number;
  annotations: Annotation[];
  color_scheme: string;
  plot_mode: string;
  filters: PlotFilters;
  preprocessing?: PreprocessingOptions;
}

export interface DelayPreset {
  id: string;
  name: string;
  description: string;
  delays: number[];
  isBuiltIn: boolean;
}

/** Frontend DDA analysis parameters (camelCase for frontend use) */
export interface FrontendDDAParameters {
  windowLength?: number;
  windowStep?: number;
  delays?: number[];
  variants?: string[];
}

export interface DDAState {
  selected_variants: string[];
  parameters: FrontendDDAParameters;
  last_analysis_id: string | null;
  current_analysis: AnalysisResult | null;
  analysis_history: AnalysisResult[];
  analysis_parameters: FrontendDDAParameters;
  running: boolean;
  custom_delay_presets?: DelayPreset[];
}

export interface WindowState {
  position: [number, number];
  size: [number, number];
  maximized: boolean;
  tab: string;
}

export interface AnnotationState {
  // Annotations for time series plots, keyed by file path
  timeSeries: Record<string, TimeSeriesAnnotations>;
  // Annotations for DDA result plots, keyed by composite key (resultId_variantId_plotType)
  ddaResults: Record<string, DDAResultAnnotations>;
}

export interface AppState {
  version: string;
  file_manager: FileManagerState;
  plot: PlotState;
  dda: DDAState;
  annotations?: AnnotationState;
  ui: UIStateSettings;
  windows: Record<string, WindowState>;
  active_tab: string;
  sidebar_collapsed: boolean;
  panel_sizes: Record<string, number>;
}

export interface AppPreferences {
  api_config: ApiConfig;
  window_state: Record<string, WindowState>;
  theme: string;
  updates_last_checked?: string; // ISO date string of last update check
}

// Tauri command interfaces
export interface TauriCommands {
  get_app_state(): Promise<AppState>;
  update_file_manager_state(state: FileManagerState): Promise<void>;
  update_plot_state(state: PlotState): Promise<void>;
  update_dda_state(state: DDAState): Promise<void>;
  update_ui_state(updates: Partial<UIStateSettings>): Promise<void>;
  save_analysis_result(analysis: AnalysisResult): Promise<void>;
  save_plot_data(plotData: DDAPlotData, analysisId?: string): Promise<void>;
  save_window_state(windowId: string, windowState: WindowState): Promise<void>;
  save_complete_state(state: AppState): Promise<void>;
  get_saved_state(): Promise<AppState | null>;
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
  migrate: (oldState: Partial<AppState>) => AppState;
}
