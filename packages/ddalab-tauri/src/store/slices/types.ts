/**
 * Shared types for store slices
 */

import type { StateCreator } from "zustand";
import type { EDFFileInfo, ChunkData, DDAResult } from "@/types/api";
import type { StatePersistenceService } from "@/services/statePersistenceService";
import type {
  PreprocessingOptions,
  DDAPlotData,
  AppState as PersistedAppState,
  StateSnapshot,
} from "@/types/persistence";
import type {
  PlotAnnotation,
  TimeSeriesAnnotations,
  DDAResultAnnotations,
} from "@/types/annotations";
import type { PrimaryNavTab, SecondaryNavTab } from "@/types/navigation";
import type {
  StreamSession,
  StreamPlotData,
  StreamUIState,
  StreamSourceConfig,
  StreamingDDAConfig,
  DataChunk,
  StreamingDDAResult,
  StreamEvent,
} from "@/types/streaming";
import type { PreprocessingSlice } from "./preprocessingSlice";

// ============================================================================
// State Interfaces
// ============================================================================

export interface FileManagerState {
  dataDirectoryPath: string;
  currentPath: string[];
  selectedFile: EDFFileInfo | null;
  selectedChannels: string[];
  timeWindow: {
    start: number;
    end: number;
  };
  searchQuery: string;
  sortBy: "name" | "size" | "date";
  sortOrder: "asc" | "desc";
  showHidden: boolean;
  pendingFileSelection: string | null;
  highlightedFilePath: string | null;
}

export interface PlotState {
  currentChunk: ChunkData | null;
  chunkSize: number;
  chunkStart: number;
  isPlaying: boolean;
  playbackSpeed: number;
  amplitude: number;
  showAnnotations: boolean;
  selectedChannelColors: Record<string, string>;
  preprocessing?: PreprocessingOptions;
  /** Height of the time series chart in pixels (user-adjustable) */
  chartHeight: number;
}

export interface DelayPreset {
  id: string;
  name: string;
  description: string;
  delays: number[];
  isBuiltIn: boolean;
}

export interface DDAState {
  currentAnalysis: DDAResult | null;
  previousAnalysis: DDAResult | null;
  analysisHistory: DDAResult[];
  analysisParameters: {
    variants: string[];
    windowLength: number;
    windowStep: number;
    delays: number[];
  };
  customDelayPresets: DelayPreset[];
  isRunning: boolean;
  /** Analysis ID to load from history (set by global search, cleared after loading) */
  pendingAnalysisId: string | null;
}

export interface HealthState {
  apiStatus: "healthy" | "unhealthy" | "checking";
  lastCheck: number;
  responseTime: number;
  websocketConnected: boolean;
  errors: string[];
}

export interface SyncState {
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  lastStatusCheck: number;
}

export interface ICAState {
  selectedChannels: number[];
  nComponents: number | undefined;
  maxIterations: number;
  tolerance: number;
  centering: boolean;
  whitening: boolean;
  showChannelSelector: boolean;
  selectedResultId: string | null;
  isSubmitting: boolean;
}

export interface UIState {
  activeTab: string;
  primaryNav: PrimaryNavTab;
  secondaryNav: SecondaryNavTab | null;
  lastSecondaryNav: Record<PrimaryNavTab, SecondaryNavTab | null>;
  sidebarOpen: boolean;
  sidebarWidth: number;
  panelSizes: number[];
  layout: "default" | "analysis" | "plots";
  theme: "light" | "dark" | "auto";
  isServerReady: boolean;
  zoom: number;
  expertMode: boolean;
  /** Tracks which panels are collapsed by their ID */
  collapsedPanels: Record<string, boolean>;
  /** Active tab within DDA analysis (persists across file changes) */
  ddaActiveTab: "configure" | "results";
  /** Encryption key for HTTP fallback mode (in-memory only) */
  encryptionKey: CryptoKey | null;
  /** Whether using HTTP + encryption fallback */
  isEncryptedMode: boolean;
}

export interface AnnotationState {
  timeSeries: Record<string, TimeSeriesAnnotations>;
  ddaResults: Record<string, DDAResultAnnotations>;
}

export interface WorkflowRecordingState {
  isRecording: boolean;
  currentSessionName: string | null;
  actionCount: number;
  lastActionTimestamp: number | null;
}

export interface StreamingState {
  sessions: Record<string, StreamSession>;
  plotData: Record<string, StreamPlotData>;
  ui: StreamUIState;
}

// ============================================================================
// Slice Action Interfaces
// ============================================================================

export interface FileManagerActions {
  setDataDirectoryPath: (path: string) => void;
  setCurrentPath: (path: string[]) => void;
  resetCurrentPathSync: () => Promise<void>;
  setSelectedFile: (file: EDFFileInfo | null) => void;
  setSelectedChannels: (channels: string[]) => void;
  setTimeWindow: (window: { start: number; end: number }) => void;
  updateFileManagerState: (updates: Partial<FileManagerState>) => void;
  clearPendingFileSelection: () => void;
  navigateToFile: (filePath: string) => void;
  clearHighlightedFile: () => void;
  /** Clear selected file and reset all file-dependent state (called when all tabs are closed) */
  clearSelectedFile: () => void;
}

export interface PlotActions {
  setCurrentChunk: (chunk: ChunkData | null) => void;
  updatePlotState: (updates: Partial<PlotState>) => void;
  savePlotData: (plotData: DDAPlotData, analysisId?: string) => Promise<void>;
}

export interface DDAActions {
  setCurrentAnalysis: (analysis: DDAResult | null) => void;
  restorePreviousAnalysis: () => void;
  addAnalysisToHistory: (analysis: DDAResult) => void;
  setAnalysisHistory: (analyses: DDAResult[]) => void;
  updateAnalysisParameters: (
    parameters: Partial<DDAState["analysisParameters"]>,
  ) => void;
  setDDARunning: (running: boolean) => void;
  saveAnalysisResult: (analysis: DDAResult) => Promise<void>;
  addDelayPreset: (preset: Omit<DelayPreset, "id" | "isBuiltIn">) => void;
  updateDelayPreset: (id: string, updates: Partial<DelayPreset>) => void;
  deleteDelayPreset: (id: string) => void;
  /** Set a pending analysis ID to be loaded (used by global search) */
  setPendingAnalysisId: (id: string | null) => void;
}

export interface HealthActions {
  updateHealthStatus: (
    status:
      | Partial<HealthState>
      | ((current: HealthState) => Partial<HealthState>),
  ) => void;
}

export interface SyncActions {
  updateSyncStatus: (status: Partial<SyncState>) => void;
}

export interface ICAActions {
  updateICAState: (updates: Partial<ICAState>) => void;
  resetICAChannels: (channels: number[]) => void;
}

export interface UIActions {
  setActiveTab: (tab: string) => void;
  setPrimaryNav: (tab: PrimaryNavTab) => void;
  setSecondaryNav: (tab: SecondaryNavTab | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setZoom: (zoom: number) => void;
  increaseZoom: () => void;
  decreaseZoom: () => void;
  resetZoom: () => void;
  setPanelSizes: (sizes: number[]) => void;
  setLayout: (layout: UIState["layout"]) => void;
  setTheme: (theme: UIState["theme"]) => void;
  setServerReady: (ready: boolean) => void;
  setExpertMode: (enabled: boolean) => void;
  setPanelCollapsed: (panelId: string, collapsed: boolean) => void;
  togglePanelCollapsed: (panelId: string) => void;
  isPanelCollapsed: (panelId: string) => boolean;
  setDDAActiveTab: (tab: UIState["ddaActiveTab"]) => void;
  setEncryptionKey: (key: CryptoKey | null) => void;
  setEncryptedMode: (enabled: boolean) => void;
}

export interface AnnotationActions {
  addTimeSeriesAnnotation: (
    filePath: string,
    annotation: PlotAnnotation,
    channel?: string,
  ) => void;
  updateTimeSeriesAnnotation: (
    filePath: string,
    annotationId: string,
    updates: Partial<PlotAnnotation>,
    channel?: string,
  ) => void;
  deleteTimeSeriesAnnotation: (
    filePath: string,
    annotationId: string,
    channel?: string,
  ) => void;
  getTimeSeriesAnnotations: (
    filePath: string,
    channel?: string,
  ) => PlotAnnotation[];
  loadAllFileAnnotations: () => Promise<void>;
  addDDAAnnotation: (
    resultId: string,
    variantId: string,
    plotType: "heatmap" | "line",
    annotation: PlotAnnotation,
  ) => void;
  updateDDAAnnotation: (
    resultId: string,
    variantId: string,
    plotType: "heatmap" | "line",
    annotationId: string,
    updates: Partial<PlotAnnotation>,
  ) => void;
  deleteDDAAnnotation: (
    resultId: string,
    variantId: string,
    plotType: "heatmap" | "line",
    annotationId: string,
  ) => void;
  getDDAAnnotations: (
    resultId: string,
    variantId: string,
    plotType: "heatmap" | "line",
  ) => PlotAnnotation[];
}

export interface WorkflowActions {
  startWorkflowRecording: (sessionName?: string) => void;
  stopWorkflowRecording: () => void;
  incrementActionCount: () => void;
  getRecordingStatus: () => WorkflowRecordingState;
}

export interface StreamingActions {
  createStreamSession: (
    sourceConfig: StreamSourceConfig,
    ddaConfig: StreamingDDAConfig,
  ) => Promise<string>;
  stopStreamSession: (streamId: string) => Promise<void>;
  pauseStreamSession: (streamId: string) => Promise<void>;
  resumeStreamSession: (streamId: string) => Promise<void>;
  updateStreamSession: (
    streamId: string,
    updates: Partial<StreamSession>,
  ) => void;
  removeStreamSession: (streamId: string) => void;
  addStreamData: (streamId: string, chunk: DataChunk) => void;
  addStreamResult: (streamId: string, result: StreamingDDAResult) => void;
  clearStreamPlotData: (streamId: string) => void;
  updateStreamUI: (updates: Partial<StreamUIState>) => void;
  handleStreamEvent: (event: StreamEvent) => void;
  addToStreamHistory: (
    sourceConfig: StreamSourceConfig,
    ddaConfig: StreamingDDAConfig,
  ) => void;
  createStreamFromHistory: (historyId: string) => Promise<string>;
  removeFromStreamHistory: (historyId: string) => void;
}

export interface PersistenceActions {
  saveCurrentState: () => Promise<void>;
  forceSave: () => Promise<void>;
  clearPersistedState: () => Promise<void>;
  getPersistedState: () => Promise<PersistedAppState | null>;
  createStateSnapshot: () => Promise<StateSnapshot | null>;
}

export interface InitActions {
  initializeFromTauri: () => Promise<void>;
  initializePersistence: () => Promise<void>;
}

// ============================================================================
// Combined Slice Types
// ============================================================================

export interface FileManagerSlice extends FileManagerActions {
  fileManager: FileManagerState;
}

export interface PlotSlice extends PlotActions {
  plot: PlotState;
}

export interface DDASlice extends DDAActions {
  dda: DDAState;
}

export interface HealthSlice extends HealthActions {
  health: HealthState;
}

export interface SyncSlice extends SyncActions {
  sync: SyncState;
}

export interface ICASlice extends ICAActions {
  ica: ICAState;
}

export interface UISlice extends UIActions {
  ui: UIState;
}

export interface AnnotationSlice extends AnnotationActions {
  annotations: AnnotationState;
}

export interface WorkflowSlice extends WorkflowActions {
  workflowRecording: WorkflowRecordingState;
}

export interface StreamingSlice extends StreamingActions {
  streaming: StreamingState;
}

export interface PersistenceSlice extends PersistenceActions {
  isInitialized: boolean;
  isPersistenceRestored: boolean;
  // Note: persistenceService is NOT stored in state (Immer freezes it).
  // Access via getStatePersistenceService() singleton instead.
}

export interface InitSlice extends InitActions {}

// ============================================================================
// Full App State (combination of all slices)
// ============================================================================

export type AppState = FileManagerSlice &
  PlotSlice &
  DDASlice &
  HealthSlice &
  SyncSlice &
  ICASlice &
  UISlice &
  AnnotationSlice &
  WorkflowSlice &
  StreamingSlice &
  PreprocessingSlice &
  PersistenceSlice &
  InitSlice;

// ============================================================================
// Slice Creator Type (for use with Immer middleware)
// ============================================================================

export type ImmerStateCreator<T> = StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  T
>;
