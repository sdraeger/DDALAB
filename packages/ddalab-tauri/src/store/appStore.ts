import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { EDFFileInfo, ChunkData, DDAResult, Annotation } from "@/types/api";
import { TauriService } from "@/services/tauriService";
import {
  getStatePersistenceService,
  StatePersistenceService,
} from "@/services/statePersistenceService";
import {
  AppState as PersistedAppState,
  AnalysisResult,
  PreprocessingOptions,
  DDAState as PersistedDDAState,
} from "@/types/persistence";
import {
  PlotAnnotation,
  TimeSeriesAnnotations,
  DDAResultAnnotations,
} from "@/types/annotations";
import {
  initializeFileStateSystem,
  getInitializedFileStateManager,
  isFileStateSystemInitialized,
} from "@/services/fileStateInitializer";
import {
  FilePlotState,
  FileDDAState,
  FileAnnotationState,
} from "@/types/fileCentricState";
import { PrimaryNavTab, SecondaryNavTab } from "@/types/navigation";
import {
  StreamSession,
  StreamPlotData,
  StreamUIState,
  StreamSourceConfig,
  StreamingDDAConfig,
  DataChunk,
  StreamingDDAResult,
  StreamEvent,
  StreamSourceHistory,
} from "@/types/streaming";

// Module-level flag to prevent re-initialization during Hot Module Reload
// This persists across Fast Refresh unlike Zustand store state
let isInitializingPersistence = false;
let hasInitializedPersistence = false;

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
  // For state restoration - file path to re-select after restart
  pendingFileSelection: string | null;
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
  previousAnalysis: DDAResult | null; // Stores previous analysis before NSG results are loaded
  analysisHistory: DDAResult[];
  analysisParameters: {
    variants: string[];
    windowLength: number;
    windowStep: number;
    scaleMin: number;
    scaleMax: number;
    scaleNum: number;
  };
  customDelayPresets: DelayPreset[];
  isRunning: boolean;
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

export interface UIState {
  // Legacy activeTab for backward compatibility
  activeTab: string;
  // New navigation system
  primaryNav: PrimaryNavTab;
  secondaryNav: SecondaryNavTab | null;
  // Remember last secondary tab for each primary category
  lastSecondaryNav: Record<PrimaryNavTab, SecondaryNavTab | null>;
  sidebarOpen: boolean;
  sidebarWidth: number; // Width of file manager sidebar in pixels
  panelSizes: number[];
  layout: "default" | "analysis" | "plots";
  theme: "light" | "dark" | "auto";
  isServerReady: boolean; // Tracks if API server is ready to accept requests
  zoom: number; // Global zoom level (0.75 to 1.5, default 1.0)
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
  // Active stream sessions
  sessions: Record<string, StreamSession>;

  // Plot data for active streams (ring buffers)
  plotData: Record<string, StreamPlotData>;

  // UI state
  ui: StreamUIState;
}

export interface AppState {
  // Initialization
  isInitialized: boolean;
  isPersistenceRestored: boolean; // True after persisted state has been loaded
  persistenceService: StatePersistenceService | null;
  initializeFromTauri: () => Promise<void>;
  initializePersistence: () => Promise<void>;

  // File management
  fileManager: FileManagerState;
  setDataDirectoryPath: (path: string) => void;
  setCurrentPath: (path: string[]) => void;
  resetCurrentPathSync: () => Promise<void>;
  setSelectedFile: (file: EDFFileInfo | null) => void;
  setSelectedChannels: (channels: string[]) => void;
  setTimeWindow: (window: { start: number; end: number }) => void;
  updateFileManagerState: (updates: Partial<FileManagerState>) => void;
  clearPendingFileSelection: () => void;

  // Plotting
  plot: PlotState;
  setCurrentChunk: (chunk: ChunkData | null) => void;
  updatePlotState: (updates: Partial<PlotState>) => void;
  savePlotData: (plotData: any, analysisId?: string) => Promise<void>;

  // DDA Analysis
  dda: DDAState;
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

  // Health monitoring
  health: HealthState;
  updateHealthStatus: (
    status:
      | Partial<HealthState>
      | ((current: HealthState) => Partial<HealthState>),
  ) => void;

  // Sync state
  sync: SyncState;
  updateSyncStatus: (status: Partial<SyncState>) => void;

  // UI state
  ui: UIState;
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

  // Annotations
  annotations: AnnotationState;
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

  // Workflow Recording
  workflowRecording: WorkflowRecordingState;
  startWorkflowRecording: (sessionName?: string) => void;
  stopWorkflowRecording: () => void;
  incrementActionCount: () => void;
  getRecordingStatus: () => WorkflowRecordingState;

  // Streaming
  streaming: StreamingState;
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

  // State persistence
  saveCurrentState: () => Promise<void>;
  forceSave: () => Promise<void>;
  clearPersistedState: () => Promise<void>;
  getPersistedState: () => Promise<PersistedAppState | null>;
  createStateSnapshot: () => Promise<any>;
}

const defaultFileManagerState: FileManagerState = {
  dataDirectoryPath: "",
  currentPath: [],
  selectedFile: null,
  selectedChannels: [],
  timeWindow: { start: 0, end: 30 },
  searchQuery: "",
  sortBy: "name",
  sortOrder: "asc",
  showHidden: false,
  pendingFileSelection: null,
};

const defaultPlotState: PlotState = {
  currentChunk: null,
  chunkSize: 8192,
  chunkStart: 0,
  isPlaying: false,
  playbackSpeed: 1.0,
  amplitude: 1.0,
  showAnnotations: true,
  selectedChannelColors: {},
};

const defaultDDAState: DDAState = {
  currentAnalysis: null,
  previousAnalysis: null,
  analysisHistory: [],
  analysisParameters: {
    variants: ["single_timeseries"],
    windowLength: 64, // Default: 0.25 seconds at 256 Hz (will be recalculated based on actual sampling rate)
    windowStep: 10,
    scaleMin: 1,
    scaleMax: 20,
    scaleNum: 20,
  },
  customDelayPresets: [],
  isRunning: false,
};

const defaultSyncState: SyncState = {
  isConnected: false,
  isLoading: false,
  error: null,
  lastStatusCheck: Date.now(),
};

const defaultHealthState: HealthState = {
  apiStatus: "checking",
  lastCheck: Date.now(),
  responseTime: 0,
  websocketConnected: false,
  errors: [],
};

const defaultUIState: UIState = {
  activeTab: "files",
  primaryNav: "explore",
  secondaryNav: "timeseries",
  lastSecondaryNav: {
    overview: null,
    explore: "timeseries",
    analyze: "dda",
    manage: "settings",
    notifications: null,
  },
  sidebarOpen: true,
  sidebarWidth: 320, // Default width in pixels (equivalent to w-80 = 20rem = 320px)
  zoom: 1.0, // Default zoom level (100%)
  panelSizes: [25, 50, 25],
  layout: "default",
  theme: "auto",
  isServerReady: false,
};

const defaultAnnotationState: AnnotationState = {
  timeSeries: {},
  ddaResults: {},
};

const defaultWorkflowRecordingState: WorkflowRecordingState = {
  isRecording: false,
  currentSessionName: null,
  actionCount: 0,
  lastActionTimestamp: null,
};

const defaultStreamingState: StreamingState = {
  sessions: {},
  plotData: {},
  ui: {
    isConfigDialogOpen: false,
    selectedStreamId: null,
    autoScroll: true,
    showHeatmap: true,
    visibleChannels: null,
    displayWindowSeconds: 30,
    recentSources: [],
  },
};

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    isInitialized: false,
    isPersistenceRestored: false,
    persistenceService: null,

    initializePersistence: async () => {
      if (TauriService.isTauri()) {
        // Check module-level flags first - these persist across Fast Refresh unlike Zustand state
        if (hasInitializedPersistence || isInitializingPersistence) {
          console.log(
            "[STORE] Persistence already initialized/initializing (module-level check), skipping",
          );
          return;
        }

        // Set flag to prevent concurrent initialization
        isInitializingPersistence = true;

        try {
          console.log("[STORE] Initializing persistence service...");

          // Initialize file-centric state system first
          await initializeFileStateSystem();
          console.log("[STORE] File-centric state system initialized");

          const service = getStatePersistenceService({
            autoSave: true,
            saveInterval: 30000,
            includeAnalysisHistory: true,
            includePlotData: true,
            maxHistoryItems: 50,
          });

          const persistedState = await service.initialize();

          // Load data directory from backend (primary source of truth)
          let dataDirectoryPath = "";
          try {
            dataDirectoryPath = await TauriService.getDataDirectory();
            console.log(
              "[STORE] Loaded data directory from backend:",
              dataDirectoryPath,
            );
          } catch (error) {
            console.error(
              "[STORE] Failed to load data directory from backend:",
              error,
            );
            // Fall back to persisted state value
            dataDirectoryPath =
              persistedState.file_manager.data_directory_path || "";
          }

          // Set up the current state getter for auto-save
          service.setCurrentStateGetter(() => {
            const currentState = get();
            return currentState.saveCurrentState();
          });

          set((state) => {
            // Don't create selectedFile here - let the FileManager component
            // re-fetch the actual file metadata to ensure we have correct data
            const selectedFile = null;

            // Create properly typed DDA results with missing properties
            // IMPORTANT: Preserve existing currentAnalysis if it exists, don't overwrite with persisted state
            // This prevents losing the current analysis when Hot Reload or Fast Refresh triggers re-initialization
            const currentAnalysis =
              state.dda.currentAnalysis ||
              (persistedState.dda.current_analysis
                ? {
                    id: persistedState.dda.current_analysis.id,
                    file_path: persistedState.dda.current_analysis.file_path,
                    created_at: persistedState.dda.current_analysis.created_at,
                    results: persistedState.dda.current_analysis.results,
                    parameters: persistedState.dda.current_analysis.parameters,
                    plot_data: persistedState.dda.current_analysis.plot_data,
                    channels: persistedState.file_manager.selected_channels,
                    status: "completed" as const,
                  }
                : null);

            const analysisHistory = persistedState.dda.analysis_history.map(
              (item) => ({
                id: item.id,
                file_path: item.file_path,
                created_at: item.created_at,
                results: item.results,
                parameters: item.parameters,
                plot_data: item.plot_data,
                channels: persistedState.file_manager.selected_channels,
                status: "completed" as const,
              }),
            );

            const restoredAnnotations = {
              timeSeries:
                persistedState.ui?.frontend_state?.annotations?.timeSeries ||
                persistedState.annotations?.timeSeries ||
                {},
              ddaResults:
                persistedState.ui?.frontend_state?.annotations?.ddaResults ||
                persistedState.annotations?.ddaResults ||
                {},
            };

            console.log("[STORE] ===== RESTORING ANNOTATIONS =====");
            const annotationFileKeys = Object.keys(
              restoredAnnotations.timeSeries,
            );
            if (annotationFileKeys.length > 0) {
              annotationFileKeys.forEach((filePath) => {
                const fileAnnotations =
                  restoredAnnotations.timeSeries[filePath];
                console.log("[STORE] Restoring annotations for:", filePath, {
                  globalCount: fileAnnotations?.globalAnnotations?.length || 0,
                  channelCount: Object.keys(
                    fileAnnotations?.channelAnnotations || {},
                  ).length,
                });
              });
            } else {
              console.log("[STORE] No annotations found in persisted state");
              console.log("[STORE] Checked paths:", {
                "ui.frontend_state.annotations.timeSeries":
                  !!persistedState.ui?.frontend_state?.annotations?.timeSeries,
                "annotations.timeSeries":
                  !!persistedState.annotations?.timeSeries,
              });
            }
            console.log("[STORE] =====================================");

            console.log("[STORE] Full persisted state structure:", {
              hasFileManager: !!persistedState.file_manager,
              fileManagerKeys: persistedState.file_manager
                ? Object.keys(persistedState.file_manager)
                : [],
              lastSelectedFile: (persistedState as any).last_selected_file,
              persistedStateKeys: Object.keys(persistedState),
            });

            const pendingFile =
              persistedState.file_manager?.selected_file ||
              (persistedState as any).last_selected_file;
            console.log(
              "[STORE] 📂 Restoring file manager state:",
              "Selected file:",
              persistedState.file_manager?.selected_file || "null",
              "| Will set pending:",
              pendingFile || "NONE",
              "| Selected channels:",
              persistedState.file_manager?.selected_channels?.length || 0,
            );

            // OPTIMIZED: Using Immer direct mutations instead of spread operators
            state.isPersistenceRestored = true;
            state.persistenceService = service;

            // File manager state
            state.fileManager.dataDirectoryPath = dataDirectoryPath;
            state.fileManager.currentPath =
              persistedState.file_manager?.current_path || [];
            state.fileManager.selectedFile = selectedFile;
            state.fileManager.selectedChannels =
              persistedState.file_manager?.selected_channels || [];
            state.fileManager.searchQuery =
              persistedState.file_manager?.search_query || "";
            state.fileManager.sortBy =
              (persistedState.file_manager?.sort_by as
                | "name"
                | "size"
                | "date") || "name";
            state.fileManager.sortOrder =
              (persistedState.file_manager?.sort_order as "asc" | "desc") ||
              "asc";
            state.fileManager.showHidden =
              persistedState.file_manager?.show_hidden || false;
            state.fileManager.pendingFileSelection =
              persistedState.file_manager?.selected_file ||
              (persistedState as any).last_selected_file;

            // Plot state
            console.log(
              "[STORE] Restoring plot state (chunkStart reset to 0 - will be restored per-file):",
              {
                persistedChunkStart: persistedState.plot?.filters?.chunkStart,
                persistedChunkSize: persistedState.plot?.filters?.chunkSize,
              },
            );
            state.plot.chunkSize =
              persistedState.plot?.filters?.chunkSize || state.plot.chunkSize;
            state.plot.chunkStart = 0; // Always start at 0 - actual position loaded when file selected
            state.plot.amplitude =
              persistedState.plot?.filters?.amplitude || state.plot.amplitude;
            state.plot.showAnnotations = Boolean(
              persistedState.plot?.filters?.showAnnotations ??
                state.plot.showAnnotations,
            );
            state.plot.preprocessing = persistedState.plot?.preprocessing;

            // DDA state
            state.dda.analysisParameters.variants =
              persistedState.dda?.selected_variants ||
              state.dda.analysisParameters.variants;
            state.dda.analysisParameters.windowLength =
              persistedState.dda?.parameters?.windowLength ||
              persistedState.dda?.analysis_parameters?.windowLength ||
              state.dda.analysisParameters.windowLength;
            state.dda.analysisParameters.windowStep =
              persistedState.dda?.parameters?.windowStep ||
              persistedState.dda?.analysis_parameters?.windowStep ||
              state.dda.analysisParameters.windowStep;
            state.dda.analysisParameters.scaleMin =
              persistedState.dda?.parameters?.scaleMin ||
              persistedState.dda?.analysis_parameters?.scaleMin ||
              state.dda.analysisParameters.scaleMin;
            state.dda.analysisParameters.scaleMax =
              persistedState.dda?.parameters?.scaleMax ||
              persistedState.dda?.analysis_parameters?.scaleMax ||
              state.dda.analysisParameters.scaleMax;
            state.dda.analysisParameters.scaleNum =
              persistedState.dda?.parameters?.scaleNum ||
              persistedState.dda?.analysis_parameters?.scaleNum ||
              state.dda.analysisParameters.scaleNum;
            state.dda.customDelayPresets =
              persistedState.dda?.custom_delay_presets ||
              state.dda.customDelayPresets;
            state.dda.currentAnalysis = currentAnalysis;
            state.dda.analysisHistory = analysisHistory;

            // Annotations
            state.annotations = restoredAnnotations;

            // UI state
            state.ui.activeTab = persistedState.active_tab;
            state.ui.sidebarOpen = !persistedState.sidebar_collapsed;
            state.ui.sidebarWidth = persistedState.ui?.sidebarWidth || 320;
            state.ui.zoom = persistedState.ui?.zoom || 1.0;
            state.ui.panelSizes = [
              persistedState.panel_sizes.sidebar * 100,
              persistedState.panel_sizes.main * 100 -
                persistedState.panel_sizes.sidebar * 100,
              25,
            ];
          });

          // Mark as successfully initialized at module level
          hasInitializedPersistence = true;
          console.log("[STORE] Persistence service initialized successfully");
        } catch (error) {
          console.error(
            "[STORE] Failed to initialize persistence:",
            (error as Error)?.message,
          );
          set({ persistenceService: null });
        } finally {
          // Always clear the initializing flag
          isInitializingPersistence = false;
        }
      }
    },

    initializeFromTauri: async () => {
      if (TauriService.isTauri()) {
        await get().initializePersistence();
        set({ isInitialized: true });
      } else {
        set({ isInitialized: true });
      }
    },

    // File management
    fileManager: defaultFileManagerState,

    setDataDirectoryPath: (path) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.fileManager.dataDirectoryPath = path;
      });

      if (TauriService.isTauri()) {
        const { fileManager, persistenceService, isPersistenceRestored } =
          get();

        // During initialization, don't save to backend to avoid overwriting persisted state
        // Wait until persistence has been restored before allowing saves
        if (!isPersistenceRestored) {
          console.log(
            "[STORE] Skipping save during initialization - data directory path set to:",
            path,
          );
          return;
        }

        const fileManagerState = {
          data_directory_path: path,
          selected_file: fileManager.selectedFile?.file_path || null,
          current_path: fileManager.currentPath,
          selected_channels: fileManager.selectedChannels,
          search_query: fileManager.searchQuery,
          sort_by: fileManager.sortBy,
          sort_order: fileManager.sortOrder,
          show_hidden: fileManager.showHidden,
        };

        // Fire and forget - don't block UI
        TauriService.updateFileManagerState(fileManagerState).catch(
          console.error,
        );

        // Auto-save via persistence service
        if (persistenceService) {
          persistenceService
            .saveFileManagerState(fileManagerState)
            .catch(console.error);
        }
      }
    },

    setCurrentPath: (path) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.fileManager.currentPath = path;
      });

      if (TauriService.isTauri()) {
        const { fileManager, persistenceService, isPersistenceRestored } =
          get();

        // During initialization, don't save to backend to avoid overwriting persisted state
        if (!isPersistenceRestored) {
          console.log(
            "[STORE] Skipping save during initialization - current path set to:",
            path,
          );
          return;
        }

        const fileManagerState = {
          data_directory_path: fileManager.dataDirectoryPath,
          selected_file: fileManager.selectedFile?.file_path || null,
          current_path: path,
          selected_channels: fileManager.selectedChannels,
          search_query: fileManager.searchQuery,
          sort_by: fileManager.sortBy,
          sort_order: fileManager.sortOrder,
          show_hidden: fileManager.showHidden,
        };

        // Fire and forget - don't block UI
        TauriService.updateFileManagerState(fileManagerState).catch(
          console.error,
        );

        // Auto-save via persistence service
        if (persistenceService) {
          persistenceService
            .saveFileManagerState(fileManagerState)
            .catch(console.error);
        }
      }
    },

    // Synchronously clear currentPath and persist immediately - used when changing data directory
    resetCurrentPathSync: async () => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.fileManager.currentPath = [];
      });

      if (TauriService.isTauri()) {
        const { fileManager, persistenceService } = get();
        const fileManagerState = {
          data_directory_path: fileManager.dataDirectoryPath,
          selected_file: null, // Clear selected file too when changing directory
          current_path: [],
          selected_channels: fileManager.selectedChannels,
          search_query: fileManager.searchQuery,
          sort_by: fileManager.sortBy,
          sort_order: fileManager.sortOrder,
          show_hidden: fileManager.showHidden,
        };

        // Note: This is a synchronous reset, so we still await to ensure persistence
        TauriService.updateFileManagerState(fileManagerState).catch(
          console.error,
        );

        // Synchronously save to ensure it's persisted before any reloads
        if (persistenceService) {
          await persistenceService.saveFileManagerState(fileManagerState);
          await persistenceService.forceSave();
        }
      }
    },

    setSelectedFile: (file) => {
      console.log(
        "[STORE] setSelectedFile called with:",
        file?.file_path || "null",
      );

      // IMMEDIATELY clear DDA state, reset chunk position, and set the file synchronously
      // This prevents race conditions where components render with old chunk position and new file
      console.log(
        "[STORE] Clearing DDA state, resetting chunk position, and setting file immediately (synchronous)",
      );
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.dda.currentAnalysis = null;
        state.dda.analysisHistory = [];
        state.fileManager.selectedFile = file;
        // Reset chunk position to 0 when switching files
        // The correct position will be loaded from file-centric state if available
        state.plot.chunkStart = 0;
        state.fileManager.selectedChannels = [];
      });

      // Load file-centric state asynchronously and apply it
      // This ensures all state (plot, DDA, annotations) is loaded from persistence
      if (file && TauriService.isTauri()) {
        (async () => {
          try {
            // Load file-centric state using FileStateManager
            console.log(
              "[STORE] Loading file-centric state for:",
              file.file_path,
            );

            const fileStateManager = getInitializedFileStateManager();
            const fileState = await fileStateManager.loadFileState(
              file.file_path,
            );

            console.log("[STORE] Loaded file state:", {
              hasPlot: !!fileState.plot,
              hasDDA: !!fileState.dda,
              hasAnnotations: !!fileState.annotations,
            });

            // Apply plot state if available
            if (fileState.plot) {
              const plotState = fileState.plot as FilePlotState;

              // Validate chunkStart against file duration
              // If persisted position exceeds file duration, reset to 0
              const chunkStartTime =
                (plotState.chunkStart || 0) / file.sample_rate;
              const isOutOfBounds = chunkStartTime >= file.duration;

              if (isOutOfBounds) {
                console.log(
                  `[STORE] Persisted chunkStart (${chunkStartTime.toFixed(2)}s) exceeds file duration (${file.duration.toFixed(2)}s) - resetting to 0`,
                );
              }

              // OPTIMIZED: Using Immer - direct mutation syntax
              set((state) => {
                state.plot.chunkStart = isOutOfBounds
                  ? 0
                  : plotState.chunkStart || 0;
                state.plot.chunkSize = plotState.chunkSize || 8192;
                state.plot.amplitude = plotState.amplitude || 1.0;
                state.plot.showAnnotations = plotState.showAnnotations ?? true;
                state.plot.preprocessing = plotState.preprocessing;
                state.plot.selectedChannelColors =
                  plotState.channelColors || {};
                state.fileManager.selectedChannels =
                  plotState.selectedChannels || [];
              });
            } else {
              // Reset to defaults if no saved plot state
              // OPTIMIZED: Using Immer - direct mutation syntax
              set((state) => {
                state.plot.chunkStart = 0;
                state.plot.chunkSize = state.plot.chunkSize || 8192;
                state.fileManager.selectedChannels = [];
              });
            }

            // Apply DDA state if available
            if (fileState.dda) {
              const ddaState = fileState.dda as FileDDAState;

              console.log("[STORE] File has DDA state:", {
                currentAnalysisId: ddaState.currentAnalysisId,
                historyCount: ddaState.analysisHistory?.length || 0,
              });

              // Update DDA parameters from saved state
              // OPTIMIZED: Using Immer - direct mutation syntax
              set((state) => {
                // Directly assign individual properties instead of using spread
                if (ddaState.lastParameters) {
                  Object.assign(
                    state.dda.analysisParameters,
                    ddaState.lastParameters,
                  );
                }
                // Clear current analysis - components will load by ID if needed
                state.dda.currentAnalysis = null;
                state.dda.analysisHistory = [];
              });

              // TODO: Optionally load the actual analysis results from the database
              // using ddaState.currentAnalysisId and ddaState.analysisHistory
              // For now, components will handle loading via useDDAHistory hook
            } else {
              // No DDA state for this file - clear any existing results
              console.log(
                "[STORE] No DDA state for this file - clearing results",
              );
              // OPTIMIZED: Using Immer - direct mutation syntax
              set((state) => {
                state.dda.currentAnalysis = null;
                state.dda.analysisHistory = [];
              });
            }

            // CRITICAL: Load annotations from BOTH FileStateManager AND SQLite database, then merge
            // This ensures annotations in SQLite but not in FileStateManager are not lost
            console.log(
              "[STORE] Loading annotations for file from both sources:",
              file.file_path,
            );

            const annotationState = fileState.annotations as
              | FileAnnotationState
              | undefined;

            // Load asynchronously to merge from both sources
            (async () => {
              try {
                // 1. Start with annotations from FileStateManager (if any)
                let mergedGlobalAnnotations: PlotAnnotation[] = [];
                let mergedChannelAnnotations: Record<string, PlotAnnotation[]> =
                  {};

                if (annotationState?.timeSeries) {
                  const fsGlobal = annotationState.timeSeries.global || [];
                  const fsChannels = annotationState.timeSeries.channels || {};

                  console.log("[STORE] Loaded from FileStateManager:", {
                    globalCount: fsGlobal.length,
                    channelsCount: Object.keys(fsChannels).length,
                  });

                  mergedGlobalAnnotations = [...fsGlobal];
                  mergedChannelAnnotations = { ...fsChannels };
                }

                // 2. Load from SQLite database and merge
                const { invoke } = await import("@tauri-apps/api/core");
                const sqliteAnnotations = await invoke<any>(
                  "get_file_annotations",
                  { filePath: file.file_path },
                );

                if (sqliteAnnotations) {
                  const sqliteGlobal =
                    sqliteAnnotations.global_annotations || [];
                  const sqliteChannels =
                    sqliteAnnotations.channel_annotations || {};

                  console.log("[STORE] Loaded from SQLite database:", {
                    globalCount: sqliteGlobal.length,
                    channelsCount: Object.keys(sqliteChannels).length,
                  });

                  // Merge global annotations (deduplicate by ID)
                  const existingIds = new Set(
                    mergedGlobalAnnotations.map((a) => a.id),
                  );
                  for (const sqliteAnn of sqliteGlobal) {
                    if (!existingIds.has(sqliteAnn.id)) {
                      mergedGlobalAnnotations.push({
                        id: sqliteAnn.id,
                        position: sqliteAnn.position,
                        label: sqliteAnn.label,
                        color: sqliteAnn.color || "#ef4444",
                        description: sqliteAnn.description,
                        createdAt:
                          sqliteAnn.created_at || new Date().toISOString(),
                        updatedAt:
                          sqliteAnn.updated_at || new Date().toISOString(),
                      });
                    }
                  }

                  // Merge channel annotations
                  for (const [channel, sqliteAnns] of Object.entries(
                    sqliteChannels,
                  )) {
                    if (!mergedChannelAnnotations[channel]) {
                      mergedChannelAnnotations[channel] = [];
                    }
                    const channelExistingIds = new Set(
                      mergedChannelAnnotations[channel].map((a) => a.id),
                    );
                    for (const sqliteAnn of sqliteAnns as any[]) {
                      if (!channelExistingIds.has(sqliteAnn.id)) {
                        mergedChannelAnnotations[channel].push({
                          id: sqliteAnn.id,
                          position: sqliteAnn.position,
                          label: sqliteAnn.label,
                          color: sqliteAnn.color || "#ef4444",
                          description: sqliteAnn.description,
                          createdAt:
                            sqliteAnn.created_at || new Date().toISOString(),
                          updatedAt:
                            sqliteAnn.updated_at || new Date().toISOString(),
                        });
                      }
                    }
                  }
                }

                const totalMerged =
                  mergedGlobalAnnotations.length +
                  Object.values(mergedChannelAnnotations).reduce(
                    (sum, anns) => sum + anns.length,
                    0,
                  );

                console.log("[STORE] Merged annotations from both sources:", {
                  filePath: file.file_path,
                  totalAnnotations: totalMerged,
                  globalCount: mergedGlobalAnnotations.length,
                  channelsCount: Object.keys(mergedChannelAnnotations).length,
                });

                // Update store with merged annotations
                // OPTIMIZED: Using Immer - direct mutation syntax
                set((state) => {
                  state.annotations.timeSeries[file.file_path] = {
                    filePath: file.file_path,
                    globalAnnotations: mergedGlobalAnnotations,
                    channelAnnotations: mergedChannelAnnotations,
                  };

                  // Load DDA results annotations from FileStateManager
                  if (annotationState?.ddaResults) {
                    Object.entries(annotationState.ddaResults).forEach(
                      ([key, plotAnnotations]) => {
                        const parts = key.split("_");
                        if (parts.length >= 3) {
                          const plotType = parts[parts.length - 1] as
                            | "heatmap"
                            | "line";
                          const variantId = parts[parts.length - 2];
                          const resultId = parts
                            .slice(0, parts.length - 2)
                            .join("_");

                          state.annotations.ddaResults[key] = {
                            resultId,
                            variantId,
                            plotType,
                            annotations: plotAnnotations,
                          };
                        }
                      },
                    );
                  }
                });

                console.log(
                  "[STORE] After loading merged annotations, store state:",
                  {
                    filePath: file.file_path,
                    globalAnnotations:
                      get().annotations.timeSeries[file.file_path]
                        .globalAnnotations.length,
                  },
                );
              } catch (err) {
                console.error(
                  "[STORE] Failed to load/merge annotations for file:",
                  file.file_path,
                  err,
                );

                // Fallback: at least load from FileStateManager if available
                if (annotationState?.timeSeries) {
                  console.log(
                    "[STORE] Fallback: using FileStateManager annotations only for:",
                    file.file_path,
                  );

                  // OPTIMIZED: Using Immer - direct mutation syntax
                  set((state) => {
                    state.annotations.timeSeries[file.file_path] = {
                      filePath: file.file_path,
                      globalAnnotations:
                        annotationState.timeSeries?.global || [],
                      channelAnnotations:
                        annotationState.timeSeries?.channels || {},
                    };
                  });
                } else {
                  // Initialize empty if no annotations found
                  set((state) => {
                    state.annotations.timeSeries[file.file_path] = {
                      filePath: file.file_path,
                      globalAnnotations: [],
                      channelAnnotations: {},
                    };
                  });
                }
              }
            })();

            // File was already set synchronously above
            // Now just save state after loading file-centric state
            const { fileManager: updatedFileManager, isPersistenceRestored } =
              get();
            const selectedFilePath = file?.file_path || null;

            console.log(
              "[STORE] After set(), fileManager.selectedFile:",
              updatedFileManager.selectedFile?.file_path || "null",
            );
            console.log(
              "[STORE] isPersistenceRestored:",
              isPersistenceRestored,
            );

            // Fire and forget - don't block UI
            TauriService.updateFileManagerState({
              selected_file: selectedFilePath,
              current_path: updatedFileManager.currentPath,
              selected_channels: updatedFileManager.selectedChannels,
              search_query: updatedFileManager.searchQuery,
              sort_by: updatedFileManager.sortBy,
              sort_order: updatedFileManager.sortOrder,
              show_hidden: updatedFileManager.showHidden,
            }).catch(console.error);

            // Save file selection immediately if persistence is restored
            // We save even without complete metadata to ensure file path is persisted
            if (isPersistenceRestored && file) {
              console.log(
                "[STORE] ✓ Triggering save for selected file:",
                file.file_path,
              );
              get()
                .saveCurrentState()
                .catch((err) =>
                  console.error("[STORE] Failed to save selected file:", err),
                );
            } else if (!file && isPersistenceRestored) {
              // File was cleared, save the null state
              console.log("[STORE] ✓ Saving cleared file selection");
              get()
                .saveCurrentState()
                .catch((err) =>
                  console.error("[STORE] Failed to save cleared file:", err),
                );
            } else {
              console.log(
                "[STORE] ✗ NOT saving - isPersistenceRestored:",
                isPersistenceRestored,
              );
            }
          } catch (err) {
            console.error("[STORE] Failed to load file-centric state:", err);
            // File was already set synchronously above, so no action needed
          }
        })();
      }
      // Note: file is set synchronously above, so no else block needed
    },

    setSelectedChannels: (channels) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.fileManager.selectedChannels = channels;
      });

      if (TauriService.isTauri()) {
        const { fileManager, plot, isPersistenceRestored } = get();

        // During initialization, don't save to backend to avoid overwriting persisted state
        if (!isPersistenceRestored) {
          console.log(
            "[STORE] Skipping save during initialization - selected channels set",
          );
          return;
        }

        // Save to file-centric state
        const selectedFilePath = fileManager.selectedFile?.file_path;
        if (selectedFilePath) {
          (async () => {
            try {
              const fileStateManager = getInitializedFileStateManager();
              const filePlotState: FilePlotState = {
                chunkStart: plot.chunkStart,
                chunkSize: plot.chunkSize,
                selectedChannels: channels,
                amplitude: plot.amplitude,
                showAnnotations: plot.showAnnotations,
                preprocessing: plot.preprocessing,
                channelColors: plot.selectedChannelColors,
                lastUpdated: new Date().toISOString(),
              };

              await fileStateManager.updateModuleState(
                selectedFilePath,
                "plot",
                filePlotState,
              );
            } catch (err) {
              console.error(
                "[STORE] Failed to save file-centric state for channels:",
                err,
              );
            }
          })();
        }

        // Fire and forget - don't block UI
        TauriService.updateFileManagerState({
          selected_file: fileManager.selectedFile?.file_path || null,
          current_path: fileManager.currentPath,
          selected_channels: channels,
          search_query: fileManager.searchQuery,
          sort_by: fileManager.sortBy,
          sort_order: fileManager.sortOrder,
          show_hidden: fileManager.showHidden,
        }).catch(console.error);
      }
    },

    setTimeWindow: (window) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.fileManager.timeWindow = window;
      });
    },

    updateFileManagerState: (updates) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        Object.assign(state.fileManager, updates);
      });

      if (TauriService.isTauri()) {
        const { fileManager } = get();
        // Fire and forget - don't block UI
        TauriService.updateFileManagerState({
          selected_file: fileManager.selectedFile?.file_path || null,
          current_path: fileManager.currentPath,
          selected_channels: fileManager.selectedChannels,
          search_query: fileManager.searchQuery,
          sort_by: fileManager.sortBy,
          sort_order: fileManager.sortOrder,
          show_hidden: fileManager.showHidden,
        }).catch(console.error);
      }
    },

    clearPendingFileSelection: () => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.fileManager.pendingFileSelection = null;
      });
    },

    // Plotting
    plot: defaultPlotState,

    setCurrentChunk: (chunk) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.plot.currentChunk = chunk;
      });
    },

    updatePlotState: (updates) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        Object.assign(state.plot, updates);
      });

      if (TauriService.isTauri()) {
        const { plot, persistenceService, isPersistenceRestored } = get();

        // During initialization, don't save to backend to avoid overwriting persisted state
        if (!isPersistenceRestored) {
          console.log(
            "[STORE] Skipping save during initialization - plot state updated",
          );
          return;
        }

        const plotState = {
          visible_channels: plot.selectedChannelColors
            ? Object.keys(plot.selectedChannelColors)
            : [],
          time_range: [plot.chunkStart, plot.chunkStart + plot.chunkSize] as [
            number,
            number,
          ],
          amplitude_range: [-100 * plot.amplitude, 100 * plot.amplitude] as [
            number,
            number,
          ],
          zoom_level: 1.0,
          preprocessing: plot.preprocessing,
          annotations: [],
          color_scheme: "default",
          plot_mode: "timeseries" as const,
          filters: {
            chunkSize: plot.chunkSize,
            chunkStart: plot.chunkStart,
            amplitude: plot.amplitude,
            showAnnotations: plot.showAnnotations,
          },
        };

        console.log(
          "[STORE] Persisting plot state with chunkStart:",
          plot.chunkStart,
        );

        // Fire and forget - don't block UI
        TauriService.updatePlotState(plotState).catch(console.error);

        // Save file-centric state if we have a selected file
        const { fileManager } = get();
        if (fileManager.selectedFile?.file_path) {
          (async () => {
            try {
              const fileStateManager = getInitializedFileStateManager();
              const filePlotState: FilePlotState = {
                chunkStart: plot.chunkStart,
                chunkSize: plot.chunkSize,
                selectedChannels: fileManager.selectedChannels || [],
                amplitude: plot.amplitude,
                showAnnotations: plot.showAnnotations,
                preprocessing: plot.preprocessing,
                channelColors: plot.selectedChannelColors,
                lastUpdated: new Date().toISOString(),
              };

              await fileStateManager.updateModuleState(
                fileManager.selectedFile!.file_path,
                "plot",
                filePlotState,
              );

              console.log("[STORE] Saved file-centric plot state:", {
                filePath: fileManager.selectedFile!.file_path,
                chunkStart: plot.chunkStart,
                chunkSize: plot.chunkSize,
              });
            } catch (err) {
              console.error(
                "[STORE] Failed to save file-centric plot state:",
                err,
              );
            }
          })();
        }

        // Auto-save via persistence service
        if (persistenceService) {
          persistenceService.savePlotState(plotState).catch(console.error);
        }
      }
    },

    // DDA Analysis
    dda: defaultDDAState,

    setCurrentAnalysis: (analysis) => {
      console.log("[STORE] setCurrentAnalysis called:", {
        hasAnalysis: !!analysis,
        analysisId: analysis?.id,
        isNSGResult: analysis?.source === "nsg",
        stack: new Error().stack,
      });
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.dda.currentAnalysis = analysis;
        // Save previous analysis only when loading NSG results
        if (analysis?.source === "nsg") {
          state.dda.previousAnalysis = state.dda.currentAnalysis;
        }
      });

      // Persist the current analysis change asynchronously to avoid blocking UI
      if (TauriService.isTauri()) {
        // Use setTimeout to defer persistence to next tick, keeping UI responsive
        setTimeout(() => {
          const { dda, persistenceService, fileManager } = get();
          const ddaState: PersistedDDAState = {
            selected_variants: dda.analysisParameters.variants,
            parameters: {
              windowLength: dda.analysisParameters.windowLength,
              windowStep: dda.analysisParameters.windowStep,
              scaleMin: dda.analysisParameters.scaleMin,
              scaleMax: dda.analysisParameters.scaleMax,
              scaleNum: dda.analysisParameters.scaleNum,
            },
            last_analysis_id: analysis?.id || null,
            current_analysis: analysis,
            analysis_history: dda.analysisHistory,
            analysis_parameters: dda.analysisParameters,
            running: dda.isRunning,
          };
          // Fire and forget - don't block UI
          TauriService.updateDDAState(ddaState).catch(console.error);

          // Also save via persistence service
          if (persistenceService) {
            persistenceService.saveDDAState(ddaState).catch(console.error);
          }

          // Save to file-centric state if we have a selected file
          const selectedFilePath = fileManager.selectedFile?.file_path;
          if (selectedFilePath && analysis) {
            (async () => {
              try {
                const fileStateManager = getInitializedFileStateManager();
                const fileDDAState: FileDDAState = {
                  currentAnalysisId: analysis.id,
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
            })();
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
        // OPTIMIZED: Using Immer - direct mutation syntax
        set((state) => {
          state.dda.currentAnalysis = state.dda.previousAnalysis;
          state.dda.previousAnalysis = null; // Clear previous analysis after restoring
        });
      } else {
        console.warn("[STORE] No previous analysis to restore");
      }
    },

    addAnalysisToHistory: (analysis) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.dda.analysisHistory = [
          analysis,
          ...state.dda.analysisHistory.slice(0, 9),
        ];
      });

      // Persist the analysis history change asynchronously to avoid blocking UI
      if (TauriService.isTauri()) {
        // Use setTimeout to defer persistence to next tick, keeping UI responsive
        setTimeout(() => {
          const { dda, persistenceService, fileManager } = get();
          const ddaState: PersistedDDAState = {
            selected_variants: dda.analysisParameters.variants,
            parameters: {
              windowLength: dda.analysisParameters.windowLength,
              windowStep: dda.analysisParameters.windowStep,
              scaleMin: dda.analysisParameters.scaleMin,
              scaleMax: dda.analysisParameters.scaleMax,
              scaleNum: dda.analysisParameters.scaleNum,
            },
            last_analysis_id: dda.currentAnalysis?.id || null,
            current_analysis: dda.currentAnalysis,
            analysis_history: dda.analysisHistory,
            analysis_parameters: dda.analysisParameters,
            running: dda.isRunning,
          };
          // Fire and forget - don't block UI
          TauriService.updateDDAState(ddaState).catch(console.error);

          // Also save via persistence service
          if (persistenceService) {
            persistenceService.saveDDAState(ddaState).catch(console.error);
          }

          // Save to file-centric state if we have a selected file
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
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.dda.analysisHistory = analyses;
      });
    },

    updateAnalysisParameters: (parameters) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        Object.assign(state.dda.analysisParameters, parameters);
      });

      // Debounce Tauri state updates to prevent lag during UI interactions
      // Clear existing timeout and schedule new one
      if (typeof (window as any).__ddaStateUpdateTimeout !== "undefined") {
        clearTimeout((window as any).__ddaStateUpdateTimeout);
      }

      (window as any).__ddaStateUpdateTimeout = setTimeout(() => {
        if (TauriService.isTauri()) {
          const { dda } = get();
          const ddaState: PersistedDDAState = {
            selected_variants: dda.analysisParameters.variants,
            parameters: {
              windowLength: dda.analysisParameters.windowLength,
              windowStep: dda.analysisParameters.windowStep,
              scaleMin: dda.analysisParameters.scaleMin,
              scaleMax: dda.analysisParameters.scaleMax,
              scaleNum: dda.analysisParameters.scaleNum,
            },
            last_analysis_id: dda.currentAnalysis?.id || null,
            current_analysis: dda.currentAnalysis,
            analysis_history: dda.analysisHistory,
            analysis_parameters: dda.analysisParameters,
            running: dda.isRunning,
          };
          // Fire and forget - don't block UI
          TauriService.updateDDAState(ddaState).catch(console.error);
        }
      }, 300); // Wait 300ms after last change before saving
    },

    setDDARunning: (running) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.dda.isRunning = running;
      });
    },

    addDelayPreset: (preset) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        const newPreset: DelayPreset = {
          ...preset,
          id: `custom-${Date.now()}`,
          isBuiltIn: false,
        };
        state.dda.customDelayPresets.push(newPreset);
      });

      // Persist to backend
      if (TauriService.isTauri()) {
        const { dda } = get();
        const ddaState: PersistedDDAState = {
          selected_variants: dda.analysisParameters.variants,
          parameters: {
            windowLength: dda.analysisParameters.windowLength,
            windowStep: dda.analysisParameters.windowStep,
            scaleMin: dda.analysisParameters.scaleMin,
            scaleMax: dda.analysisParameters.scaleMax,
            scaleNum: dda.analysisParameters.scaleNum,
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
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        const preset = state.dda.customDelayPresets.find((p) => p.id === id);
        if (preset) {
          Object.assign(preset, updates);
        }
      });

      // Persist to backend
      if (TauriService.isTauri()) {
        const { dda } = get();
        const ddaState: PersistedDDAState = {
          selected_variants: dda.analysisParameters.variants,
          parameters: {
            windowLength: dda.analysisParameters.windowLength,
            windowStep: dda.analysisParameters.windowStep,
            scaleMin: dda.analysisParameters.scaleMin,
            scaleMax: dda.analysisParameters.scaleMax,
            scaleNum: dda.analysisParameters.scaleNum,
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
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.dda.customDelayPresets = state.dda.customDelayPresets.filter(
          (p) => p.id !== id,
        );
      });

      // Persist to backend
      if (TauriService.isTauri()) {
        const { dda } = get();
        const ddaState: PersistedDDAState = {
          selected_variants: dda.analysisParameters.variants,
          parameters: {
            windowLength: dda.analysisParameters.windowLength,
            windowStep: dda.analysisParameters.windowStep,
            scaleMin: dda.analysisParameters.scaleMin,
            scaleMax: dda.analysisParameters.scaleMax,
            scaleNum: dda.analysisParameters.scaleNum,
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

    // Health monitoring
    health: defaultHealthState,

    updateHealthStatus: (status) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      if (typeof status === "function") {
        set((state) => {
          Object.assign(state.health, status(state.health));
        });
      } else {
        set((state) => {
          Object.assign(state.health, status);
        });
      }
    },

    // Sync state
    sync: defaultSyncState,

    updateSyncStatus: (status) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        Object.assign(state.sync, status);
        state.sync.lastStatusCheck = Date.now();
      });
    },

    // UI state
    ui: defaultUIState,

    setActiveTab: (tab) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.ui.activeTab = tab;
      });

      if (TauriService.isTauri()) {
        // Fire and forget - don't block UI
        TauriService.updateUIState({ activeTab: tab }).catch(console.error);
      }
    },

    setPrimaryNav: (tab) => {
      const { ui } = get();
      const lastSecondary = ui.lastSecondaryNav[tab];

      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.ui.primaryNav = tab;
        state.ui.secondaryNav = lastSecondary;
      });

      if (TauriService.isTauri()) {
        TauriService.updateUIState({
          primaryNav: tab,
          secondaryNav: lastSecondary,
        }).catch(console.error);
      }
    },

    setSecondaryNav: (tab) => {
      const { ui } = get();

      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.ui.secondaryNav = tab;
        state.ui.lastSecondaryNav[ui.primaryNav] = tab;
      });

      if (TauriService.isTauri()) {
        TauriService.updateUIState({ secondaryNav: tab }).catch(console.error);
      }
    },

    setSidebarOpen: (open) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.ui.sidebarOpen = open;
      });

      if (TauriService.isTauri()) {
        // Fire and forget - don't block UI
        TauriService.updateUIState({ sidebarOpen: open }).catch(console.error);
      }
    },

    setSidebarWidth: (width) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      // Clamp width between minimum (200px) and maximum (600px) for usability
      const clampedWidth = Math.max(200, Math.min(600, width));
      set((state) => {
        state.ui.sidebarWidth = clampedWidth;
      });

      // Debounce Tauri state updates - dragging triggers many rapid updates
      if (typeof (window as any).__sidebarWidthUpdateTimeout !== "undefined") {
        clearTimeout((window as any).__sidebarWidthUpdateTimeout);
      }

      (window as any).__sidebarWidthUpdateTimeout = setTimeout(() => {
        if (TauriService.isTauri()) {
          // Fire and forget - don't block UI
          TauriService.updateUIState({ sidebarWidth: clampedWidth }).catch(
            console.error,
          );
        }
      }, 150); // Wait 150ms after last resize before saving
    },

    setZoom: (zoom) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      // Clamp zoom between 75% and 150% for usability
      const clampedZoom = Math.max(0.75, Math.min(1.5, zoom));
      set((state) => {
        state.ui.zoom = clampedZoom;
      });

      // Debounce Tauri state updates
      if (typeof (window as any).__zoomUpdateTimeout !== "undefined") {
        clearTimeout((window as any).__zoomUpdateTimeout);
      }

      (window as any).__zoomUpdateTimeout = setTimeout(() => {
        if (TauriService.isTauri()) {
          // Fire and forget - don't block UI
          TauriService.updateUIState({ zoom: clampedZoom }).catch(
            console.error,
          );
        }
      }, 150); // Wait 150ms after last change before saving
    },

    increaseZoom: () => {
      const currentZoom = get().ui.zoom;
      const newZoom = Math.min(1.5, currentZoom + 0.1);
      get().setZoom(newZoom);
    },

    decreaseZoom: () => {
      const currentZoom = get().ui.zoom;
      const newZoom = Math.max(0.75, currentZoom - 0.1);
      get().setZoom(newZoom);
    },

    resetZoom: () => {
      get().setZoom(1.0);
    },

    setPanelSizes: (sizes) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.ui.panelSizes = sizes;
      });

      // Debounce Tauri state updates - panel resizing triggers many rapid updates
      if (typeof (window as any).__panelSizesUpdateTimeout !== "undefined") {
        clearTimeout((window as any).__panelSizesUpdateTimeout);
      }

      (window as any).__panelSizesUpdateTimeout = setTimeout(() => {
        if (TauriService.isTauri()) {
          // Fire and forget - don't block UI
          TauriService.updateUIState({ panelSizes: sizes }).catch(
            console.error,
          );
        }
      }, 150); // Wait 150ms after last resize before saving
    },

    setLayout: (layout) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.ui.layout = layout;
      });

      if (TauriService.isTauri()) {
        // Fire and forget - don't block UI
        TauriService.updateUIState({ layout }).catch(console.error);
      }
    },

    setTheme: (theme) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.ui.theme = theme;
      });

      if (TauriService.isTauri()) {
        // Fire and forget - don't block UI
        TauriService.updateUIState({ theme }).catch(console.error);
      }
    },

    setServerReady: (ready) => {
      console.log("[SERVER_READY] Setting server ready state:", ready);
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.ui.isServerReady = ready;
      });
    },

    // Annotations
    annotations: defaultAnnotationState,

    addTimeSeriesAnnotation: (filePath, annotation, channel) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        if (!state.annotations.timeSeries[filePath]) {
          state.annotations.timeSeries[filePath] = {
            filePath,
            globalAnnotations: [],
            channelAnnotations: {},
          };
        }

        // With Immer, we can directly push to arrays and it handles immutability
        if (channel) {
          if (!state.annotations.timeSeries[filePath].channelAnnotations) {
            state.annotations.timeSeries[filePath].channelAnnotations = {};
          }
          if (
            !state.annotations.timeSeries[filePath].channelAnnotations![channel]
          ) {
            state.annotations.timeSeries[filePath].channelAnnotations![
              channel
            ] = [];
          }
          state.annotations.timeSeries[filePath].channelAnnotations![
            channel
          ].push(annotation);
        } else {
          state.annotations.timeSeries[filePath].globalAnnotations.push(
            annotation,
          );
        }

        console.log("[ANNOTATION] After adding annotation, state:", {
          filePath,
          globalAnnotationsCount:
            state.annotations.timeSeries[filePath].globalAnnotations.length,
          globalAnnotations:
            state.annotations.timeSeries[filePath].globalAnnotations,
          annotation,
        });
      });

      // Save annotation to file state manager
      setTimeout(async () => {
        if (TauriService.isTauri()) {
          try {
            const fileStateManager = getInitializedFileStateManager();
            const currentAnnotations = get().annotations;
            const fileAnnotations = currentAnnotations.timeSeries[filePath];

            if (fileAnnotations) {
              // Transform DDA annotations to match FileAnnotationState type
              const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
              Object.entries(currentAnnotations.ddaResults).forEach(
                ([key, value]) => {
                  ddaResultsForFile[key] = value.annotations;
                },
              );

              const fileAnnotationState: FileAnnotationState = {
                timeSeries: {
                  global: fileAnnotations.globalAnnotations,
                  channels: fileAnnotations.channelAnnotations || {},
                },
                ddaResults: ddaResultsForFile, // Preserve DDA annotations (transformed)
                lastUpdated: new Date().toISOString(),
              };

              await fileStateManager.updateModuleState(
                filePath,
                "annotations",
                fileAnnotationState,
              );
              console.log(
                "[ANNOTATION] Saved to FileStateManager:",
                annotation.id,
              );
            }
          } catch (err) {
            console.error(
              "[ANNOTATION] Failed to save to FileStateManager:",
              err,
            );
          }
        }
      }, 100);
    },

    updateTimeSeriesAnnotation: (filePath, annotationId, updates, channel) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        const fileAnnotations = state.annotations.timeSeries[filePath];
        if (!fileAnnotations) return;

        const updateAnnotationInArray = (arr: PlotAnnotation[]) => {
          const index = arr.findIndex((a) => a.id === annotationId);
          if (index !== -1) {
            Object.assign(arr[index], updates, {
              updatedAt: new Date().toISOString(),
            });
          }
        };

        if (channel && fileAnnotations.channelAnnotations?.[channel]) {
          updateAnnotationInArray(fileAnnotations.channelAnnotations[channel]);
        } else {
          updateAnnotationInArray(fileAnnotations.globalAnnotations);
        }
      });

      // Save updated annotation to file state manager
      setTimeout(async () => {
        if (TauriService.isTauri()) {
          try {
            const fileStateManager = getInitializedFileStateManager();
            const currentAnnotations = get().annotations;
            const fileAnnotations = currentAnnotations.timeSeries[filePath];

            if (fileAnnotations) {
              // Transform DDA annotations to match FileAnnotationState type
              const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
              Object.entries(currentAnnotations.ddaResults).forEach(
                ([key, value]) => {
                  ddaResultsForFile[key] = value.annotations;
                },
              );

              const fileAnnotationState: FileAnnotationState = {
                timeSeries: {
                  global: fileAnnotations.globalAnnotations,
                  channels: fileAnnotations.channelAnnotations || {},
                },
                ddaResults: ddaResultsForFile, // Preserve DDA annotations (transformed)
                lastUpdated: new Date().toISOString(),
              };

              await fileStateManager.updateModuleState(
                filePath,
                "annotations",
                fileAnnotationState,
              );
              console.log(
                "[ANNOTATION] Updated in FileStateManager:",
                annotationId,
              );
            }
          } catch (err) {
            console.error(
              "[ANNOTATION] Failed to update in FileStateManager:",
              err,
            );
          }
        }
      }, 100);
    },

    deleteTimeSeriesAnnotation: (filePath, annotationId, channel) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        const fileAnnotations = state.annotations.timeSeries[filePath];
        if (!fileAnnotations) return;

        if (channel && fileAnnotations.channelAnnotations?.[channel]) {
          const index = fileAnnotations.channelAnnotations[channel].findIndex(
            (a) => a.id === annotationId,
          );
          if (index !== -1) {
            fileAnnotations.channelAnnotations[channel].splice(index, 1);
          }
        } else {
          const index = fileAnnotations.globalAnnotations.findIndex(
            (a) => a.id === annotationId,
          );
          if (index !== -1) {
            fileAnnotations.globalAnnotations.splice(index, 1);
          }
        }
      });

      // Delete annotation from database and file state manager
      setTimeout(async () => {
        if (TauriService.isTauri()) {
          try {
            // KEY FIX: Delete from database first
            await TauriService.deleteAnnotation(annotationId);
            console.log("[ANNOTATION] Deleted from database:", annotationId);

            const fileStateManager = getInitializedFileStateManager();
            const currentAnnotations = get().annotations;
            const fileAnnotations = currentAnnotations.timeSeries[filePath];

            if (fileAnnotations) {
              // Transform DDA annotations to match FileAnnotationState type
              const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
              Object.entries(currentAnnotations.ddaResults).forEach(
                ([key, value]) => {
                  ddaResultsForFile[key] = value.annotations;
                },
              );

              const fileAnnotationState: FileAnnotationState = {
                timeSeries: {
                  global: fileAnnotations.globalAnnotations,
                  channels: fileAnnotations.channelAnnotations || {},
                },
                ddaResults: ddaResultsForFile, // Preserve DDA annotations (transformed)
                lastUpdated: new Date().toISOString(),
              };

              await fileStateManager.updateModuleState(
                filePath,
                "annotations",
                fileAnnotationState,
              );
              console.log(
                "[ANNOTATION] Deleted from FileStateManager:",
                annotationId,
              );
            }
          } catch (err) {
            console.error("[ANNOTATION] Failed to delete annotation:", err);
          }
        }
      }, 100);
    },

    getTimeSeriesAnnotations: (filePath, channel) => {
      const state = get();
      const fileAnnotations = state.annotations.timeSeries[filePath];

      if (!fileAnnotations) return [];

      if (channel && fileAnnotations.channelAnnotations?.[channel]) {
        return [
          ...fileAnnotations.globalAnnotations,
          ...fileAnnotations.channelAnnotations[channel],
        ];
      }
      return fileAnnotations.globalAnnotations;
    },

    loadAllFileAnnotations: async () => {
      if (!TauriService.isTauri()) {
        console.log(
          "[ANNOTATION] Not in Tauri environment, skipping load all annotations",
        );
        return;
      }

      try {
        console.log(
          "[ANNOTATION] Loading annotations from both SQLite database and FileStateManager...",
        );

        // Load all annotations from SQLite database (primary source)
        const sqliteAnnotations = await TauriService.getAllAnnotations();
        console.log(
          "[ANNOTATION] Found",
          Object.keys(sqliteAnnotations).length,
          "files with annotations in SQLite database",
        );

        // Also load from FileStateManager (for legacy annotations that might not be in SQLite)
        const fileStateManager = getInitializedFileStateManager();
        const trackedFiles = fileStateManager.getTrackedFiles();
        console.log(
          "[ANNOTATION] Found",
          trackedFiles.length,
          "tracked files in FileStateManager",
        );

        // Build merged annotations object outside of set() for better debugging
        const mergedAnnotations: Record<string, TimeSeriesAnnotations> = {};

        // First, load from SQLite (primary source of truth)
        for (const [filePath, fileAnnotations] of Object.entries(
          sqliteAnnotations,
        )) {
          const globalCount = fileAnnotations.global_annotations?.length || 0;
          const channelCount = Object.keys(
            fileAnnotations.channel_annotations || {},
          ).length;

          if (globalCount > 0 || channelCount > 0) {
            console.log(
              "[ANNOTATION] Loading from SQLite for file:",
              filePath,
              {
                globalCount,
                channelsCount: channelCount,
              },
            );

            // Convert SQLite annotations to PlotAnnotation format (add missing fields)
            const globalAnnotations = fileAnnotations.global_annotations.map(
              (ann) => ({
                ...ann,
                createdAt: new Date().toISOString(), // SQLite doesn't track creation time
                visible_in_plots: ann.visible_in_plots || [],
              }),
            );

            const channelAnnotations: Record<string, PlotAnnotation[]> = {};
            for (const [channel, anns] of Object.entries(
              fileAnnotations.channel_annotations || {},
            )) {
              channelAnnotations[channel] = anns.map((ann) => ({
                ...ann,
                createdAt: new Date().toISOString(),
                visible_in_plots: ann.visible_in_plots || [],
              }));
            }

            mergedAnnotations[filePath] = {
              filePath: filePath,
              globalAnnotations,
              channelAnnotations,
            };
          }
        }

        // Then, load from FileStateManager (for files not in SQLite - legacy data)
        for (const filePath of trackedFiles) {
          // Skip if already loaded from SQLite
          if (mergedAnnotations[filePath]) continue;

          try {
            const moduleState = fileStateManager.getModuleState(
              filePath,
              "annotations",
            );
            if (moduleState) {
              const annotationState = moduleState as FileAnnotationState;
              const hasAnnotations =
                annotationState &&
                ((annotationState.timeSeries?.global?.length || 0) > 0 ||
                  Object.keys(annotationState.timeSeries?.channels || {})
                    .length > 0);

              if (hasAnnotations) {
                console.log(
                  "[ANNOTATION] Loading from FileStateManager for file:",
                  filePath,
                  {
                    globalCount:
                      annotationState.timeSeries?.global?.length || 0,
                    channelsCount: Object.keys(
                      annotationState.timeSeries?.channels || {},
                    ).length,
                  },
                );

                mergedAnnotations[filePath] = {
                  filePath: filePath,
                  globalAnnotations: annotationState.timeSeries?.global || [],
                  channelAnnotations:
                    annotationState.timeSeries?.channels || {},
                };
              }
            }
          } catch (err) {
            console.error(
              "[ANNOTATION] Failed to load from FileStateManager for file:",
              filePath,
              err,
            );
          }
        }

        // OPTIMIZED: Using Immer - direct mutation syntax for efficient state updates
        set((state) => {
          state.annotations.timeSeries = mergedAnnotations;
        });

        console.log(
          "[ANNOTATION] Finished loading all annotations. Total files with annotations:",
          Object.keys(get().annotations.timeSeries).length,
        );
      } catch (err) {
        console.error("[ANNOTATION] Failed to load all file annotations:", err);
      }
    },

    addDDAAnnotation: (resultId, variantId, plotType, annotation) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        const key = `${resultId}_${variantId}_${plotType}`;

        if (!state.annotations.ddaResults[key]) {
          state.annotations.ddaResults[key] = {
            resultId,
            variantId,
            plotType,
            annotations: [],
          };
        }

        state.annotations.ddaResults[key].annotations.push(annotation);
      });

      // Save to FileStateManager
      setTimeout(async () => {
        const { fileManager } = get();
        if (TauriService.isTauri() && fileManager.selectedFile) {
          try {
            const fileStateManager = getInitializedFileStateManager();
            const currentAnnotations = get().annotations;
            const filePath = fileManager.selectedFile.file_path;
            const fileTimeSeries = currentAnnotations.timeSeries[filePath];

            // Transform DDA annotations to match FileAnnotationState type
            const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
            Object.entries(currentAnnotations.ddaResults).forEach(
              ([key, value]) => {
                ddaResultsForFile[key] = value.annotations;
              },
            );

            const fileAnnotationState: FileAnnotationState = {
              timeSeries: {
                global: fileTimeSeries?.globalAnnotations || [],
                channels: fileTimeSeries?.channelAnnotations || {},
              },
              ddaResults: ddaResultsForFile,
              lastUpdated: new Date().toISOString(),
            };

            await fileStateManager.updateModuleState(
              filePath,
              "annotations",
              fileAnnotationState,
            );
            console.log(
              "[ANNOTATION] Saved DDA annotation to FileStateManager:",
              annotation.id,
            );
          } catch (err) {
            console.error(
              "[ANNOTATION] Failed to save DDA annotation to FileStateManager:",
              err,
            );
          }
        }
      }, 100);
    },

    updateDDAAnnotation: (
      resultId,
      variantId,
      plotType,
      annotationId,
      updates,
    ) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        const key = `${resultId}_${variantId}_${plotType}`;
        const plotAnnotations = state.annotations.ddaResults[key];

        if (!plotAnnotations) return;

        const index = plotAnnotations.annotations.findIndex(
          (a) => a.id === annotationId,
        );
        if (index !== -1) {
          Object.assign(plotAnnotations.annotations[index], updates, {
            updatedAt: new Date().toISOString(),
          });
        }
      });

      // Save to FileStateManager
      setTimeout(async () => {
        const { fileManager } = get();
        if (TauriService.isTauri() && fileManager.selectedFile) {
          try {
            const fileStateManager = getInitializedFileStateManager();
            const currentAnnotations = get().annotations;
            const filePath = fileManager.selectedFile.file_path;
            const fileTimeSeries = currentAnnotations.timeSeries[filePath];

            // Transform DDA annotations to match FileAnnotationState type
            const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
            Object.entries(currentAnnotations.ddaResults).forEach(
              ([key, value]) => {
                ddaResultsForFile[key] = value.annotations;
              },
            );

            const fileAnnotationState: FileAnnotationState = {
              timeSeries: {
                global: fileTimeSeries?.globalAnnotations || [],
                channels: fileTimeSeries?.channelAnnotations || {},
              },
              ddaResults: ddaResultsForFile,
              lastUpdated: new Date().toISOString(),
            };

            await fileStateManager.updateModuleState(
              filePath,
              "annotations",
              fileAnnotationState,
            );
            console.log(
              "[ANNOTATION] Updated DDA annotation in FileStateManager:",
              annotationId,
            );
          } catch (err) {
            console.error(
              "[ANNOTATION] Failed to update DDA annotation in FileStateManager:",
              err,
            );
          }
        }
      }, 100);
    },

    deleteDDAAnnotation: (resultId, variantId, plotType, annotationId) => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        const key = `${resultId}_${variantId}_${plotType}`;
        const plotAnnotations = state.annotations.ddaResults[key];

        if (!plotAnnotations) return;

        const index = plotAnnotations.annotations.findIndex(
          (a) => a.id === annotationId,
        );
        if (index !== -1) {
          plotAnnotations.annotations.splice(index, 1);
        }
      });

      // Save to FileStateManager
      setTimeout(async () => {
        const { fileManager } = get();
        if (TauriService.isTauri() && fileManager.selectedFile) {
          try {
            const fileStateManager = getInitializedFileStateManager();
            const currentAnnotations = get().annotations;
            const filePath = fileManager.selectedFile.file_path;
            const fileTimeSeries = currentAnnotations.timeSeries[filePath];

            // Transform DDA annotations to match FileAnnotationState type
            const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
            Object.entries(currentAnnotations.ddaResults).forEach(
              ([key, value]) => {
                ddaResultsForFile[key] = value.annotations;
              },
            );

            const fileAnnotationState: FileAnnotationState = {
              timeSeries: {
                global: fileTimeSeries?.globalAnnotations || [],
                channels: fileTimeSeries?.channelAnnotations || {},
              },
              ddaResults: ddaResultsForFile,
              lastUpdated: new Date().toISOString(),
            };

            await fileStateManager.updateModuleState(
              filePath,
              "annotations",
              fileAnnotationState,
            );
            console.log(
              "[ANNOTATION] Deleted DDA annotation from FileStateManager:",
              annotationId,
            );
          } catch (err) {
            console.error(
              "[ANNOTATION] Failed to delete DDA annotation from FileStateManager:",
              err,
            );
          }
        }
      }, 100);
    },

    getDDAAnnotations: (resultId, variantId, plotType) => {
      const state = get();
      const key = `${resultId}_${variantId}_${plotType}`;
      return state.annotations.ddaResults[key]?.annotations || [];
    },

    // Workflow Recording
    workflowRecording: defaultWorkflowRecordingState,

    startWorkflowRecording: (sessionName) => {
      const name =
        sessionName ||
        `session_${new Date().toISOString().split("T")[0]}_${Date.now()}`;
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.workflowRecording.isRecording = true;
        state.workflowRecording.currentSessionName = name;
        state.workflowRecording.actionCount = 0;
        state.workflowRecording.lastActionTimestamp = Date.now();
      });
      console.log("[WORKFLOW] Recording started:", name);
    },

    stopWorkflowRecording: () => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.workflowRecording.isRecording = false;
      });
      console.log("[WORKFLOW] Recording stopped");
    },

    incrementActionCount: () => {
      // OPTIMIZED: Using Immer - direct mutation syntax
      set((state) => {
        state.workflowRecording.actionCount += 1;
        state.workflowRecording.lastActionTimestamp = Date.now();
      });
    },

    getRecordingStatus: () => {
      return get().workflowRecording;
    },

    // Streaming
    streaming: defaultStreamingState,

    createStreamSession: async (sourceConfig, ddaConfig) => {
      const { invoke } = await import("@tauri-apps/api/core");

      try {
        // Pre-create the session object BEFORE calling backend
        // This ensures it exists when events start arriving
        const now = Date.now() / 1000;
        let streamId: string | null = null;

        // Call backend to start stream
        const response = await invoke<{ stream_id: string }>("start_stream", {
          request: {
            source_config: sourceConfig,
            dda_config: ddaConfig,
          },
        });

        streamId = response.stream_id;

        // Create or update session with real config
        // (Session might have been created by events arriving during invoke)
        set((state) => {
          if (state.streaming.sessions[streamId]) {
            // Session already created by event handler, just update config
            console.log(
              "[STREAMING] Updating existing session with real config:",
              streamId,
            );
            state.streaming.sessions[streamId].source_config = sourceConfig;
            state.streaming.sessions[streamId].dda_config = ddaConfig;
            state.streaming.sessions[streamId].updated_at = Date.now() / 1000;
          } else {
            // Create new session
            console.log("[STREAMING] Creating new session:", streamId);
            state.streaming.sessions[streamId] = {
              id: streamId,
              source_config: sourceConfig,
              dda_config: ddaConfig,
              state: { type: "Connecting" },
              stats: {
                chunks_received: 0,
                chunks_processed: 0,
                results_generated: 0,
                data_buffer_size: 0,
                result_buffer_size: 0,
                total_samples_received: 0,
                avg_processing_time_ms: 0,
                uptime_seconds: 0,
              },
              created_at: now,
              updated_at: now,
            };
            state.streaming.plotData[streamId] = {
              dataChunks: [],
              ddaResults: [],
              maxBufferSize: 100,
            };
          }
        });

        // Add to history
        get().addToStreamHistory(sourceConfig, ddaConfig);

        console.log("[STREAMING] Session ready:", streamId);
        return streamId;
      } catch (error) {
        console.error("[STREAMING] Failed to create session:", error);
        throw error;
      }
    },

    stopStreamSession: async (streamId) => {
      const { invoke } = await import("@tauri-apps/api/core");

      try {
        await invoke("stop_stream", { streamId });

        set((state) => {
          const session = state.streaming.sessions[streamId];
          if (session) {
            session.state = { type: "Stopped" };
          }
        });
      } catch (error) {
        console.error("[STREAMING] Failed to stop session:", error);
        throw error;
      }
    },

    pauseStreamSession: async (streamId) => {
      const { invoke } = await import("@tauri-apps/api/core");

      try {
        await invoke("pause_stream", { streamId });
      } catch (error) {
        console.error("[STREAMING] Failed to pause session:", error);
        throw error;
      }
    },

    resumeStreamSession: async (streamId) => {
      const { invoke } = await import("@tauri-apps/api/core");

      try {
        await invoke("resume_stream", { streamId });
      } catch (error) {
        console.error("[STREAMING] Failed to resume session:", error);
        throw error;
      }
    },

    updateStreamSession: (streamId, updates) => {
      set((state) => {
        const session = state.streaming.sessions[streamId];
        if (session) {
          // Immer allows direct mutation
          if (updates.state) session.state = updates.state;
          if (updates.stats) session.stats = updates.stats;
          if (updates.source_config) session.source_config = updates.source_config;
          if (updates.dda_config) session.dda_config = updates.dda_config;
          session.updated_at = Date.now() / 1000;
        }
      });
    },

    removeStreamSession: (streamId) => {
      set((state) => {
        delete state.streaming.sessions[streamId];
        delete state.streaming.plotData[streamId];
      });
    },

    addStreamData: (streamId, chunk) => {
      set((state) => {
        const plotData = state.streaming.plotData[streamId];
        if (plotData) {
          const { dataChunks, maxBufferSize } = plotData;

          // Efficient circular buffer: just truncate from beginning if needed
          if (dataChunks.length >= maxBufferSize) {
            // Remove first 20% to avoid frequent truncations
            const removeCount = Math.floor(maxBufferSize * 0.2);
            dataChunks.splice(0, removeCount);
          }

          dataChunks.push(chunk);
        }
      });
    },

    addStreamResult: (streamId, result) => {
      set((state) => {
        const plotData = state.streaming.plotData[streamId];
        if (plotData) {
          const { ddaResults, maxBufferSize } = plotData;

          // Efficient circular buffer: just truncate from beginning if needed
          if (ddaResults.length >= maxBufferSize) {
            // Remove first 20% to avoid frequent truncations
            const removeCount = Math.floor(maxBufferSize * 0.2);
            ddaResults.splice(0, removeCount);
          }

          ddaResults.push(result);
        }
      });
    },

    clearStreamPlotData: (streamId) => {
      set((state) => {
        const plotData = state.streaming.plotData[streamId];
        if (plotData) {
          plotData.dataChunks = [];
          plotData.ddaResults = [];
        }
      });
    },

    updateStreamUI: (updates) => {
      set((state) => {
        Object.assign(state.streaming.ui, updates);
      });
    },

    handleStreamEvent: (event) => {
      switch (event.type) {
        case "state_changed":
          set((state) => {
            const session = state.streaming.sessions[event.stream_id];

            if (!session) {
              // Create session on-the-fly if it doesn't exist (handles race condition)
              const now = Date.now() / 1000;
              state.streaming.sessions[event.stream_id] = {
                id: event.stream_id,
                source_config: {
                  type: "file",
                  path: "",
                  chunk_size: 0,
                  loop_playback: false,
                },
                dda_config: {
                  window_size: 0,
                  window_overlap: 0,
                  window_parameters: { window_length: 0, window_step: 0 },
                  scale_parameters: {
                    scale_min: 0,
                    scale_max: 0,
                    scale_num: 0,
                  },
                  algorithm_selection: { enabled_variants: [] },
                  include_q_matrices: false,
                },
                state: event.state,
                stats: {
                  chunks_received: 0,
                  chunks_processed: 0,
                  results_generated: 0,
                  data_buffer_size: 0,
                  result_buffer_size: 0,
                  total_samples_received: 0,
                  avg_processing_time_ms: 0,
                  uptime_seconds: 0,
                },
                created_at: now,
                updated_at: now,
              };
              state.streaming.plotData[event.stream_id] = {
                dataChunks: [],
                ddaResults: [],
                maxBufferSize: 100,
              };
            } else {
              session.state = event.state;
              session.updated_at = Date.now() / 1000;
            }
          });
          break;

        case "stats_update":
          set((state) => {
            const session = state.streaming.sessions[event.stream_id];
            if (session) {
              session.stats = event.stats;
              session.updated_at = Date.now() / 1000;
            }
          });
          break;

        case "error":
          set((state) => {
            const session = state.streaming.sessions[event.stream_id];
            if (session) {
              session.state = {
                type: "Error",
                data: { message: event.error },
              };
            }
          });
          console.error("[STREAMING] Stream error:", event.error);
          break;

        case "data_received":
        case "results_ready":
          // These events are just notifications, data is fetched separately
          break;
      }
    },

    // Streaming history management
    addToStreamHistory: (sourceConfig, ddaConfig) => {
      set((state) => {
        // Generate display name based on source type
        let displayName = "";
        switch (sourceConfig.type) {
          case "file":
            const fileName = sourceConfig.path.split("/").pop() || "File";
            displayName = `File: ${fileName}`;
            break;
          case "websocket":
            displayName = `WebSocket: ${sourceConfig.url}`;
            break;
          case "tcp":
            displayName = `TCP: ${sourceConfig.host}:${sourceConfig.port}`;
            break;
          case "udp":
            displayName = `UDP: ${sourceConfig.bind_address}:${sourceConfig.port}`;
            break;
          case "serial":
            displayName = `Serial: ${sourceConfig.port}`;
            break;
        }

        // Create history entry
        const historyEntry = {
          id: `history-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          sourceConfig,
          ddaConfig,
          timestamp: Date.now(),
          displayName,
        };

        // Add to beginning of array
        state.streaming.ui.recentSources.unshift(historyEntry);

        // Keep only last 10 entries
        if (state.streaming.ui.recentSources.length > 10) {
          state.streaming.ui.recentSources = state.streaming.ui.recentSources.slice(0, 10);
        }
      });
    },

    createStreamFromHistory: async (historyId) => {
      const state = get();
      const historyEntry = state.streaming.ui.recentSources.find(
        (entry) => entry.id === historyId
      );

      if (!historyEntry) {
        throw new Error("History entry not found");
      }

      // Create stream using the saved config
      return state.createStreamSession(
        historyEntry.sourceConfig,
        historyEntry.ddaConfig
      );
    },

    removeFromStreamHistory: (historyId) => {
      set((state) => {
        state.streaming.ui.recentSources = state.streaming.ui.recentSources.filter(
          (entry) => entry.id !== historyId
        );
      });
    },

    // Additional persistence methods that weren't in the original implementation
    savePlotData: async (plotData, analysisId) => {
      const service = get().persistenceService;
      if (service) {
        await service.savePlotData(plotData, analysisId);
      }
    },

    saveAnalysisResult: async (analysis) => {
      const service = get().persistenceService;
      if (service) {
        const persistedAnalysis: AnalysisResult = {
          id: analysis.id,
          file_path: analysis.file_path,
          created_at: analysis.created_at || new Date().toISOString(),
          results: analysis.results,
          parameters: analysis.parameters,
          plot_data: null, // Will be saved separately if needed
        };
        await service.saveAnalysisResult(persistedAnalysis);
      }
    },

    // State persistence methods
    saveCurrentState: async () => {
      const service = get().persistenceService;
      const currentState = get();

      if (service) {
        // Defer heavy state construction to next microtask to avoid blocking UI
        await Promise.resolve();

        console.log("[SAVE] Current state before save:", {
          selectedFile:
            currentState.fileManager.selectedFile?.file_path || null,
          selectedChannels: currentState.fileManager.selectedChannels,
          chunkSize: currentState.plot.chunkSize,
          chunkStart: currentState.plot.chunkStart,
        });

        // NEW LIGHTWEIGHT STATE - Only UI preferences (no annotations, no analysis history)
        // Annotations → SQLite (save_annotation command)
        // Analysis history → Python API (not persisted in Rust)
        const stateToSave = {
          version: "2.0.0", // Version bump indicates SQLite-backed architecture
          file_manager: {
            selected_file:
              currentState.fileManager.selectedFile?.file_path || null,
            current_path: currentState.fileManager.currentPath,
            selected_channels: currentState.fileManager.selectedChannels,
            search_query: currentState.fileManager.searchQuery,
            sort_by: currentState.fileManager.sortBy,
            sort_order: currentState.fileManager.sortOrder,
            show_hidden: currentState.fileManager.showHidden,
          },
          plot: {
            filters: {
              chunkSize: currentState.plot.chunkSize,
              chunkStart: currentState.plot.chunkStart,
              amplitude: currentState.plot.amplitude,
              showAnnotations: currentState.plot.showAnnotations,
            },
            preprocessing: currentState.plot.preprocessing,
          },
          dda: {
            selected_variants: currentState.dda.analysisParameters.variants,
            parameters: currentState.dda.analysisParameters,
            analysis_parameters: currentState.dda.analysisParameters,
            running: false, // Don't persist running state
          },
          ui: {
            activeTab: currentState.ui.activeTab,
            sidebarOpen: currentState.ui.sidebarOpen,
            sidebarWidth: currentState.ui.sidebarWidth,
            panelSizes: currentState.ui.panelSizes,
            layout: currentState.ui.layout,
            theme: currentState.ui.theme,
          },
          active_tab: currentState.ui.activeTab,
          sidebar_collapsed: !currentState.ui.sidebarOpen,
          panel_sizes: {
            sidebar: (currentState.ui.panelSizes[0] || 25) / 100,
            main: (currentState.ui.panelSizes[1] || 50) / 100,
            "plot-height": 0.6,
          },
        };

        console.log(
          "[SAVE] Saving lightweight UI state (no annotations, no analysis history)",
        );
        await service.saveCompleteState(stateToSave);
      }
    },

    forceSave: async () => {
      const service = get().persistenceService;
      if (service) {
        await get().saveCurrentState();
        await service.forceSave();
      }
    },

    clearPersistedState: async () => {
      const service = get().persistenceService;
      if (service) {
        await service.clearState();
      }
    },

    getPersistedState: async () => {
      const service = get().persistenceService;
      if (service) {
        return await service.getSavedState();
      }
      return null;
    },

    createStateSnapshot: async () => {
      const service = get().persistenceService;
      if (service) {
        await get().saveCurrentState();
        return await service.createSnapshot();
      }
      return null;
    },
  })),
);
