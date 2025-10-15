import { create } from 'zustand'
import { EDFFileInfo, ChunkData, DDAResult, Annotation } from '@/types/api'
import { TauriService } from '@/services/tauriService'
import { getStatePersistenceService, StatePersistenceService } from '@/services/statePersistenceService'
import { AppState as PersistedAppState, AnalysisResult, PreprocessingOptions, DDAState as PersistedDDAState } from '@/types/persistence'
import { PlotAnnotation, TimeSeriesAnnotations, DDAResultAnnotations } from '@/types/annotations'

// Module-level flag to prevent re-initialization during Hot Module Reload
// This persists across Fast Refresh unlike Zustand store state
let isInitializingPersistence = false
let hasInitializedPersistence = false

export interface FileManagerState {
  dataDirectoryPath: string
  currentPath: string[]
  selectedFile: EDFFileInfo | null
  selectedChannels: string[]
  timeWindow: {
    start: number
    end: number
  }
  searchQuery: string
  sortBy: 'name' | 'size' | 'date'
  sortOrder: 'asc' | 'desc'
  showHidden: boolean
  // For state restoration - file path to re-select after restart
  pendingFileSelection: string | null
}

export interface PlotState {
  currentChunk: ChunkData | null
  chunkSize: number
  chunkStart: number
  isPlaying: boolean
  playbackSpeed: number
  amplitude: number
  showAnnotations: boolean
  selectedChannelColors: Record<string, string>
  preprocessing?: PreprocessingOptions
}

export interface DDAState {
  currentAnalysis: DDAResult | null
  analysisHistory: DDAResult[]
  analysisParameters: {
    variants: string[]
    windowLength: number
    windowStep: number
    detrending: 'linear' | 'polynomial' | 'none'
    scaleMin: number
    scaleMax: number
    scaleNum: number
  }
  isRunning: boolean
}

export interface HealthState {
  apiStatus: 'healthy' | 'unhealthy' | 'checking'
  lastCheck: number
  responseTime: number
  websocketConnected: boolean
  errors: string[]
}

export interface SyncState {
  isConnected: boolean
  isLoading: boolean
  error: string | null
  lastStatusCheck: number
}

export interface UIState {
  activeTab: string
  sidebarOpen: boolean
  panelSizes: number[]
  layout: 'default' | 'analysis' | 'plots'
  theme: 'light' | 'dark' | 'auto'
  isServerReady: boolean  // Tracks if API server is ready to accept requests
}

export interface AnnotationState {
  timeSeries: Record<string, TimeSeriesAnnotations>
  ddaResults: Record<string, DDAResultAnnotations>
}

export interface WorkflowRecordingState {
  isRecording: boolean
  currentSessionName: string | null
  actionCount: number
  lastActionTimestamp: number | null
}

export interface AppState {
  // Initialization
  isInitialized: boolean
  isPersistenceRestored: boolean  // True after persisted state has been loaded
  persistenceService: StatePersistenceService | null
  initializeFromTauri: () => Promise<void>
  initializePersistence: () => Promise<void>

  // File management
  fileManager: FileManagerState
  setDataDirectoryPath: (path: string) => void
  setCurrentPath: (path: string[]) => void
  resetCurrentPathSync: () => Promise<void>
  setSelectedFile: (file: EDFFileInfo | null) => void
  setSelectedChannels: (channels: string[]) => void
  setTimeWindow: (window: { start: number; end: number }) => void
  updateFileManagerState: (updates: Partial<FileManagerState>) => void
  clearPendingFileSelection: () => void

  // Plotting
  plot: PlotState
  setCurrentChunk: (chunk: ChunkData | null) => void
  updatePlotState: (updates: Partial<PlotState>) => void
  savePlotData: (plotData: any, analysisId?: string) => Promise<void>

  // DDA Analysis
  dda: DDAState
  setCurrentAnalysis: (analysis: DDAResult | null) => void
  addAnalysisToHistory: (analysis: DDAResult) => void
  setAnalysisHistory: (analyses: DDAResult[]) => void
  updateAnalysisParameters: (parameters: Partial<DDAState['analysisParameters']>) => void
  setDDARunning: (running: boolean) => void
  saveAnalysisResult: (analysis: DDAResult) => Promise<void>

  // Health monitoring
  health: HealthState
  updateHealthStatus: (status: Partial<HealthState> | ((current: HealthState) => Partial<HealthState>)) => void

  // Sync state
  sync: SyncState
  updateSyncStatus: (status: Partial<SyncState>) => void

  // UI state
  ui: UIState
  setActiveTab: (tab: string) => void
  setSidebarOpen: (open: boolean) => void
  setPanelSizes: (sizes: number[]) => void
  setLayout: (layout: UIState['layout']) => void
  setTheme: (theme: UIState['theme']) => void
  setServerReady: (ready: boolean) => void

  // Annotations
  annotations: AnnotationState
  addTimeSeriesAnnotation: (filePath: string, annotation: PlotAnnotation, channel?: string) => void
  updateTimeSeriesAnnotation: (filePath: string, annotationId: string, updates: Partial<PlotAnnotation>, channel?: string) => void
  deleteTimeSeriesAnnotation: (filePath: string, annotationId: string, channel?: string) => void
  getTimeSeriesAnnotations: (filePath: string, channel?: string) => PlotAnnotation[]
  addDDAAnnotation: (resultId: string, variantId: string, plotType: 'heatmap' | 'line', annotation: PlotAnnotation) => void
  updateDDAAnnotation: (resultId: string, variantId: string, plotType: 'heatmap' | 'line', annotationId: string, updates: Partial<PlotAnnotation>) => void
  deleteDDAAnnotation: (resultId: string, variantId: string, plotType: 'heatmap' | 'line', annotationId: string) => void
  getDDAAnnotations: (resultId: string, variantId: string, plotType: 'heatmap' | 'line') => PlotAnnotation[]

  // Workflow Recording
  workflowRecording: WorkflowRecordingState
  startWorkflowRecording: (sessionName?: string) => void
  stopWorkflowRecording: () => void
  incrementActionCount: () => void
  getRecordingStatus: () => WorkflowRecordingState

  // State persistence
  saveCurrentState: () => Promise<void>
  forceSave: () => Promise<void>
  clearPersistedState: () => Promise<void>
  getPersistedState: () => Promise<PersistedAppState | null>
  createStateSnapshot: () => Promise<any>
}

const defaultFileManagerState: FileManagerState = {
  dataDirectoryPath: '',
  currentPath: [],
  selectedFile: null,
  selectedChannels: [],
  timeWindow: { start: 0, end: 30 },
  searchQuery: '',
  sortBy: 'name',
  sortOrder: 'asc',
  showHidden: false,
  pendingFileSelection: null
}

const defaultPlotState: PlotState = {
  currentChunk: null,
  chunkSize: 8192,
  chunkStart: 0,
  isPlaying: false,
  playbackSpeed: 1.0,
  amplitude: 1.0,
  showAnnotations: true,
  selectedChannelColors: {}
}

const defaultDDAState: DDAState = {
  currentAnalysis: null,
  analysisHistory: [],
  analysisParameters: {
    variants: ['single_timeseries'],
    windowLength: 64, // Default: 0.25 seconds at 256 Hz (will be recalculated based on actual sampling rate)
    windowStep: 10,
    detrending: 'linear',
    scaleMin: 1,
    scaleMax: 20,
    scaleNum: 20
  },
  isRunning: false
}

const defaultSyncState: SyncState = {
  isConnected: false,
  isLoading: false,
  error: null,
  lastStatusCheck: Date.now(),
}

const defaultHealthState: HealthState = {
  apiStatus: 'checking',
  lastCheck: Date.now(),
  responseTime: 0,
  websocketConnected: false,
  errors: []
}

const defaultUIState: UIState = {
  activeTab: 'files',
  sidebarOpen: true,
  panelSizes: [25, 50, 25],
  layout: 'default',
  theme: 'auto',
  isServerReady: false
}

const defaultAnnotationState: AnnotationState = {
  timeSeries: {},
  ddaResults: {}
}

const defaultWorkflowRecordingState: WorkflowRecordingState = {
  isRecording: false,
  currentSessionName: null,
  actionCount: 0,
  lastActionTimestamp: null
}

export const useAppStore = create<AppState>((set, get) => ({
  isInitialized: false,
  isPersistenceRestored: false,
  persistenceService: null,

  initializePersistence: async () => {
    if (TauriService.isTauri()) {
      // Check module-level flags first - these persist across Fast Refresh unlike Zustand state
      if (hasInitializedPersistence || isInitializingPersistence) {
        console.log('[STORE] Persistence already initialized/initializing (module-level check), skipping')
        return
      }

      // Set flag to prevent concurrent initialization
      isInitializingPersistence = true

      try {
        console.log('[STORE] Initializing persistence service...')
        const service = getStatePersistenceService({
          autoSave: true,
          saveInterval: 30000,
          includeAnalysisHistory: true,
          includePlotData: true,
          maxHistoryItems: 50
        });

        const persistedState = await service.initialize();

        // Load data directory from backend (primary source of truth)
        let dataDirectoryPath = ''
        try {
          dataDirectoryPath = await TauriService.getDataDirectory()
          console.log('[STORE] Loaded data directory from backend:', dataDirectoryPath)
        } catch (error) {
          console.error('[STORE] Failed to load data directory from backend:', error)
          // Fall back to persisted state value
          dataDirectoryPath = persistedState.file_manager.data_directory_path || ''
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
          const currentAnalysis = state.dda.currentAnalysis || (persistedState.dda.current_analysis ? {
            id: persistedState.dda.current_analysis.id,
            file_path: persistedState.dda.current_analysis.file_path,
            created_at: persistedState.dda.current_analysis.created_at,
            results: persistedState.dda.current_analysis.results,
            parameters: persistedState.dda.current_analysis.parameters,
            plot_data: persistedState.dda.current_analysis.plot_data,
            channels: persistedState.file_manager.selected_channels,
            status: 'completed' as const
          } : null);

          const analysisHistory = persistedState.dda.analysis_history.map(item => ({
            id: item.id,
            file_path: item.file_path,
            created_at: item.created_at,
            results: item.results,
            parameters: item.parameters,
            plot_data: item.plot_data,
            channels: persistedState.file_manager.selected_channels,
            status: 'completed' as const
          }));

          const restoredAnnotations = {
            timeSeries: persistedState.ui?.frontend_state?.annotations?.timeSeries || persistedState.annotations?.timeSeries || {},
            ddaResults: persistedState.ui?.frontend_state?.annotations?.ddaResults || persistedState.annotations?.ddaResults || {}
          };

          console.log('[STORE] ===== RESTORING ANNOTATIONS =====')
          const annotationFileKeys = Object.keys(restoredAnnotations.timeSeries);
          if (annotationFileKeys.length > 0) {
            annotationFileKeys.forEach(filePath => {
              const fileAnnotations = restoredAnnotations.timeSeries[filePath];
              console.log('[STORE] Restoring annotations for:', filePath, {
                globalCount: fileAnnotations?.globalAnnotations?.length || 0,
                channelCount: Object.keys(fileAnnotations?.channelAnnotations || {}).length
              });
            });
          } else {
            console.log('[STORE] No annotations found in persisted state');
            console.log('[STORE] Checked paths:', {
              'ui.frontend_state.annotations.timeSeries': !!persistedState.ui?.frontend_state?.annotations?.timeSeries,
              'annotations.timeSeries': !!persistedState.annotations?.timeSeries
            });
          }
          console.log('[STORE] =====================================')

          console.log('[STORE] Full persisted state structure:', {
            hasFileManager: !!persistedState.file_manager,
            fileManagerKeys: persistedState.file_manager ? Object.keys(persistedState.file_manager) : [],
            lastSelectedFile: (persistedState as any).last_selected_file,
            persistedStateKeys: Object.keys(persistedState)
          })

          console.log('[STORE] Restoring persisted state:', {
            selected_file: persistedState.file_manager?.selected_file,
            selected_channels: persistedState.file_manager?.selected_channels,
            current_path: persistedState.file_manager?.current_path
          })

          return {
            ...state,
            isPersistenceRestored: true,
            persistenceService: service,
            fileManager: {
              ...state.fileManager,
              dataDirectoryPath,  // Use backend value as primary source
              currentPath: persistedState.file_manager?.current_path || [],
              selectedFile,
              selectedChannels: persistedState.file_manager?.selected_channels || [],
              searchQuery: persistedState.file_manager?.search_query || '',
              sortBy: (persistedState.file_manager?.sort_by as 'name' | 'size' | 'date') || 'name',
              sortOrder: (persistedState.file_manager?.sort_order as 'asc' | 'desc') || 'asc',
              showHidden: persistedState.file_manager?.show_hidden || false,
              // Try both file_manager.selected_file and last_selected_file (for new state structure)
              pendingFileSelection: persistedState.file_manager?.selected_file || (persistedState as any).last_selected_file
            },
            plot: {
              ...state.plot,
              chunkSize: persistedState.plot?.filters?.chunkSize || state.plot.chunkSize,
              chunkStart: persistedState.plot?.filters?.chunkStart || state.plot.chunkStart,
              amplitude: persistedState.plot?.filters?.amplitude || state.plot.amplitude,
              showAnnotations: Boolean(persistedState.plot?.filters?.showAnnotations ?? state.plot.showAnnotations),
              preprocessing: persistedState.plot?.preprocessing
            },
            dda: {
              ...state.dda,
              analysisParameters: {
                ...state.dda.analysisParameters,
                variants: persistedState.dda?.selected_variants || state.dda.analysisParameters.variants,
                windowLength: persistedState.dda?.parameters?.windowLength || persistedState.dda?.analysis_parameters?.windowLength || state.dda.analysisParameters.windowLength,
                windowStep: persistedState.dda?.parameters?.windowStep || persistedState.dda?.analysis_parameters?.windowStep || state.dda.analysisParameters.windowStep,
                detrending: (persistedState.dda?.parameters?.detrending || persistedState.dda?.analysis_parameters?.detrending || state.dda.analysisParameters.detrending) as 'linear' | 'polynomial' | 'none',
                scaleMin: persistedState.dda?.parameters?.scaleMin || persistedState.dda?.analysis_parameters?.scaleMin || state.dda.analysisParameters.scaleMin,
                scaleMax: persistedState.dda?.parameters?.scaleMax || persistedState.dda?.analysis_parameters?.scaleMax || state.dda.analysisParameters.scaleMax,
                scaleNum: persistedState.dda?.parameters?.scaleNum || persistedState.dda?.analysis_parameters?.scaleNum || state.dda.analysisParameters.scaleNum
              },
              currentAnalysis,
              analysisHistory
            },
            annotations: restoredAnnotations,
            ui: {
              ...state.ui,
              activeTab: persistedState.active_tab,
              sidebarOpen: !persistedState.sidebar_collapsed,
              panelSizes: [
                persistedState.panel_sizes.sidebar * 100,
                persistedState.panel_sizes.main * 100 - persistedState.panel_sizes.sidebar * 100,
                25
              ]
            }
          };
        });

        // Mark as successfully initialized at module level
        hasInitializedPersistence = true
        console.log('[STORE] Persistence service initialized successfully')
      } catch (error) {
        console.error('[STORE] Failed to initialize persistence:', (error as Error)?.message);
        set({ persistenceService: null });
      } finally {
        // Always clear the initializing flag
        isInitializingPersistence = false
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
    set((state) => ({
      fileManager: { ...state.fileManager, dataDirectoryPath: path }
    }))

    if (TauriService.isTauri()) {
      const { fileManager, persistenceService, isPersistenceRestored } = get()

      // During initialization, don't save to backend to avoid overwriting persisted state
      // Wait until persistence has been restored before allowing saves
      if (!isPersistenceRestored) {
        console.log('[STORE] Skipping save during initialization - data directory path set to:', path)
        return
      }

      const fileManagerState = {
        data_directory_path: path,
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: fileManager.currentPath,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      }

      // Fire and forget - don't block UI
      TauriService.updateFileManagerState(fileManagerState).catch(console.error)

      // Auto-save via persistence service
      if (persistenceService) {
        persistenceService.saveFileManagerState(fileManagerState).catch(console.error)
      }
    }
  },

  setCurrentPath: (path) => {
    set((state) => ({
      fileManager: { ...state.fileManager, currentPath: path }
    }))

    if (TauriService.isTauri()) {
      const { fileManager, persistenceService, isPersistenceRestored } = get()

      // During initialization, don't save to backend to avoid overwriting persisted state
      if (!isPersistenceRestored) {
        console.log('[STORE] Skipping save during initialization - current path set to:', path)
        return
      }

      const fileManagerState = {
        data_directory_path: fileManager.dataDirectoryPath,
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: path,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      }

      // Fire and forget - don't block UI
      TauriService.updateFileManagerState(fileManagerState).catch(console.error)

      // Auto-save via persistence service
      if (persistenceService) {
        persistenceService.saveFileManagerState(fileManagerState).catch(console.error)
      }
    }
  },

  // Synchronously clear currentPath and persist immediately - used when changing data directory
  resetCurrentPathSync: async () => {
    set((state) => ({
      fileManager: { ...state.fileManager, currentPath: [] }
    }))

    if (TauriService.isTauri()) {
      const { fileManager, persistenceService } = get()
      const fileManagerState = {
        data_directory_path: fileManager.dataDirectoryPath,
        selected_file: null, // Clear selected file too when changing directory
        current_path: [],
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      }

      // Note: This is a synchronous reset, so we still await to ensure persistence
      TauriService.updateFileManagerState(fileManagerState).catch(console.error)

      // Synchronously save to ensure it's persisted before any reloads
      if (persistenceService) {
        await persistenceService.saveFileManagerState(fileManagerState)
        await persistenceService.forceSave()
      }
    }
  },

  setSelectedFile: (file) => {
    console.log('[STORE] setSelectedFile called with:', file?.file_path || 'null')

    set((state) => ({
      fileManager: { ...state.fileManager, selectedFile: file }
    }))

    // Load annotations from SQLite for this file
    if (file && TauriService.isTauri()) {
      (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          const fileAnnotations: any = await invoke('get_file_annotations', { filePath: file.file_path })

          console.log('[ANNOTATION] Loaded from SQLite:', {
            filePath: file.file_path,
            globalCount: fileAnnotations.global_annotations?.length || 0,
            channelCount: Object.keys(fileAnnotations.channel_annotations || {}).length
          })

          // Update in-memory annotations
          set((state) => {
            const annotations = { ...state.annotations }
            annotations.timeSeries[file.file_path] = {
              filePath: file.file_path,
              globalAnnotations: fileAnnotations.global_annotations || [],
              channelAnnotations: fileAnnotations.channel_annotations || {}
            }
            return { annotations }
          })
        } catch (err) {
          console.error('[ANNOTATION] Failed to load from SQLite:', err)
        }
      })()
    }

    if (TauriService.isTauri()) {
      const { fileManager, isPersistenceRestored } = get()
      const selectedFilePath = file?.file_path || null

      console.log('[STORE] After set(), fileManager.selectedFile:', fileManager.selectedFile?.file_path || 'null')
      console.log('[STORE] isPersistenceRestored:', isPersistenceRestored)

      // Fire and forget - don't block UI
      TauriService.updateFileManagerState({
        selected_file: selectedFilePath,
        current_path: fileManager.currentPath,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      }).catch(console.error)

      // Only save to persistence when we have complete file info (with channels)
      // This avoids double-saving when FileManager sets the file twice (once for instant feedback, once with full metadata)
      const hasCompleteFileInfo = file && file.channels && file.channels.length > 0
      console.log('[STORE] setSelectedFile - persistence check:', {
        isPersistenceRestored,
        hasFile: !!file,
        hasChannels: file?.channels?.length || 0,
        hasCompleteFileInfo,
        willSave: isPersistenceRestored && hasCompleteFileInfo
      });

      if (isPersistenceRestored && hasCompleteFileInfo) {
        console.log('[STORE] ✓ Triggering save for file with complete metadata:', file.file_path)
        get().saveCurrentState().catch(err => console.error('[STORE] Failed to save selected file:', err))
      } else if (file && !hasCompleteFileInfo) {
        console.log('[STORE] ⏳ Skipping save - waiting for complete file metadata (has', file.channels?.length || 0, 'channels)')
      } else {
        console.log('[STORE] ✗ NOT saving - isPersistenceRestored:', isPersistenceRestored, 'file:', file?.file_path || 'null')
      }
    }
  },

  setSelectedChannels: (channels) => {
    set((state) => ({
      fileManager: { ...state.fileManager, selectedChannels: channels }
    }))

    if (TauriService.isTauri()) {
      const { fileManager, isPersistenceRestored } = get()

      // During initialization, don't save to backend to avoid overwriting persisted state
      if (!isPersistenceRestored) {
        console.log('[STORE] Skipping save during initialization - selected channels set')
        return
      }

      // Fire and forget - don't block UI
      TauriService.updateFileManagerState({
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: fileManager.currentPath,
        selected_channels: channels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      }).catch(console.error)
    }
  },

  setTimeWindow: (window) => {
    set((state) => ({
      fileManager: { ...state.fileManager, timeWindow: window }
    }))
  },

  updateFileManagerState: (updates) => {
    set((state) => ({
      fileManager: { ...state.fileManager, ...updates }
    }))

    if (TauriService.isTauri()) {
      const { fileManager } = get()
      // Fire and forget - don't block UI
      TauriService.updateFileManagerState({
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: fileManager.currentPath,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      }).catch(console.error)
    }
  },

  clearPendingFileSelection: () => {
    set((state) => ({
      fileManager: { ...state.fileManager, pendingFileSelection: null }
    }))
  },

  // Plotting
  plot: defaultPlotState,

  setCurrentChunk: (chunk) => {
    set((state) => ({ plot: { ...state.plot, currentChunk: chunk } }))
  },

  updatePlotState: (updates) => {
    set((state) => ({ plot: { ...state.plot, ...updates } }))

    if (TauriService.isTauri()) {
      const { plot, persistenceService, isPersistenceRestored } = get()

      // During initialization, don't save to backend to avoid overwriting persisted state
      if (!isPersistenceRestored) {
        console.log('[STORE] Skipping save during initialization - plot state updated')
        return
      }

      const plotState = {
        visible_channels: plot.selectedChannelColors ? Object.keys(plot.selectedChannelColors) : [],
        time_range: [plot.chunkStart, plot.chunkStart + plot.chunkSize] as [number, number],
        amplitude_range: [-100 * plot.amplitude, 100 * plot.amplitude] as [number, number],
        zoom_level: 1.0,
        preprocessing: plot.preprocessing,
        annotations: [],
        color_scheme: 'default',
        plot_mode: 'timeseries' as const,
        filters: {
          chunkSize: plot.chunkSize,
          chunkStart: plot.chunkStart,
          amplitude: plot.amplitude,
          showAnnotations: plot.showAnnotations
        }
      }

      console.log('[STORE] Persisting plot state with chunkStart:', plot.chunkStart)

      // Fire and forget - don't block UI
      TauriService.updatePlotState(plotState).catch(console.error)

      // Auto-save via persistence service
      if (persistenceService) {
        persistenceService.savePlotState(plotState).catch(console.error)
      }
    }
  },

  // DDA Analysis
  dda: defaultDDAState,

  setCurrentAnalysis: (analysis) => {
    console.log('[STORE] setCurrentAnalysis called:', {
      hasAnalysis: !!analysis,
      analysisId: analysis?.id,
      stack: new Error().stack
    })
    set((state) => ({ dda: { ...state.dda, currentAnalysis: analysis } }))

    // Persist the current analysis change asynchronously to avoid blocking UI
    if (TauriService.isTauri()) {
      // Use setTimeout to defer persistence to next tick, keeping UI responsive
      setTimeout(() => {
        const { dda, persistenceService } = get()
        const ddaState: PersistedDDAState = {
          selected_variants: dda.analysisParameters.variants,
          parameters: {
            windowLength: dda.analysisParameters.windowLength,
            windowStep: dda.analysisParameters.windowStep,
            detrending: dda.analysisParameters.detrending,
            scaleMin: dda.analysisParameters.scaleMin,
            scaleMax: dda.analysisParameters.scaleMax,
            scaleNum: dda.analysisParameters.scaleNum
          },
          last_analysis_id: analysis?.id || null,
          current_analysis: analysis,
          analysis_history: dda.analysisHistory,
          analysis_parameters: dda.analysisParameters,
          running: dda.isRunning
        }
        // Fire and forget - don't block UI
        TauriService.updateDDAState(ddaState).catch(console.error)

        // Also save via persistence service
        if (persistenceService) {
          persistenceService.saveDDAState(ddaState).catch(console.error)
        }
      }, 0)
    }
  },

  addAnalysisToHistory: (analysis) => {
    set((state) => ({
      dda: {
        ...state.dda,
        analysisHistory: [analysis, ...state.dda.analysisHistory.slice(0, 9)]
      }
    }))

    // Persist the analysis history change asynchronously to avoid blocking UI
    if (TauriService.isTauri()) {
      // Use setTimeout to defer persistence to next tick, keeping UI responsive
      setTimeout(() => {
        const { dda, persistenceService } = get()
        const ddaState: PersistedDDAState = {
          selected_variants: dda.analysisParameters.variants,
          parameters: {
            windowLength: dda.analysisParameters.windowLength,
            windowStep: dda.analysisParameters.windowStep,
            detrending: dda.analysisParameters.detrending,
            scaleMin: dda.analysisParameters.scaleMin,
            scaleMax: dda.analysisParameters.scaleMax,
            scaleNum: dda.analysisParameters.scaleNum
          },
          last_analysis_id: dda.currentAnalysis?.id || null,
          current_analysis: dda.currentAnalysis,
          analysis_history: dda.analysisHistory,
          analysis_parameters: dda.analysisParameters,
          running: dda.isRunning
        }
        // Fire and forget - don't block UI
        TauriService.updateDDAState(ddaState).catch(console.error)

        // Also save via persistence service
        if (persistenceService) {
          persistenceService.saveDDAState(ddaState).catch(console.error)
        }
      }, 0)
    }
  },

  setAnalysisHistory: (analyses) => {
    set((state) => ({ dda: { ...state.dda, analysisHistory: analyses } }))
  },

  updateAnalysisParameters: (parameters) => {
    set((state) => ({
      dda: {
        ...state.dda,
        analysisParameters: { ...state.dda.analysisParameters, ...parameters }
      }
    }))

    // Debounce Tauri state updates to prevent lag during UI interactions
    // Clear existing timeout and schedule new one
    if (typeof (window as any).__ddaStateUpdateTimeout !== 'undefined') {
      clearTimeout((window as any).__ddaStateUpdateTimeout)
    }

    (window as any).__ddaStateUpdateTimeout = setTimeout(() => {
      if (TauriService.isTauri()) {
        const { dda } = get()
        const ddaState: PersistedDDAState = {
          selected_variants: dda.analysisParameters.variants,
          parameters: {
            windowLength: dda.analysisParameters.windowLength,
            windowStep: dda.analysisParameters.windowStep,
            detrending: dda.analysisParameters.detrending,
            scaleMin: dda.analysisParameters.scaleMin,
            scaleMax: dda.analysisParameters.scaleMax,
            scaleNum: dda.analysisParameters.scaleNum
          },
          last_analysis_id: dda.currentAnalysis?.id || null,
          current_analysis: dda.currentAnalysis,
          analysis_history: dda.analysisHistory,
          analysis_parameters: dda.analysisParameters,
          running: dda.isRunning
        }
        // Fire and forget - don't block UI
        TauriService.updateDDAState(ddaState).catch(console.error)
      }
    }, 300) // Wait 300ms after last change before saving
  },

  setDDARunning: (running) => {
    set((state) => ({ dda: { ...state.dda, isRunning: running } }))
  },

  // Health monitoring
  health: defaultHealthState,

  updateHealthStatus: (status) => {
    if (typeof status === 'function') {
      set((state) => ({ health: { ...state.health, ...status(state.health) } }))
    } else {
      set((state) => ({ health: { ...state.health, ...status } }))
    }
  },

  // Sync state
  sync: defaultSyncState,

  updateSyncStatus: (status) => {
    set((state) => ({ sync: { ...state.sync, ...status, lastStatusCheck: Date.now() } }))
  },

  // UI state
  ui: defaultUIState,

  setActiveTab: (tab) => {
    set((state) => ({ ui: { ...state.ui, activeTab: tab } }))

    if (TauriService.isTauri()) {
      // Fire and forget - don't block UI
      TauriService.updateUIState({ activeTab: tab }).catch(console.error)
    }
  },

  setSidebarOpen: (open) => {
    set((state) => ({ ui: { ...state.ui, sidebarOpen: open } }))

    if (TauriService.isTauri()) {
      // Fire and forget - don't block UI
      TauriService.updateUIState({ sidebarOpen: open }).catch(console.error)
    }
  },

  setPanelSizes: (sizes) => {
    set((state) => ({ ui: { ...state.ui, panelSizes: sizes } }))

    // Debounce Tauri state updates - panel resizing triggers many rapid updates
    if (typeof (window as any).__panelSizesUpdateTimeout !== 'undefined') {
      clearTimeout((window as any).__panelSizesUpdateTimeout)
    }

    (window as any).__panelSizesUpdateTimeout = setTimeout(() => {
      if (TauriService.isTauri()) {
        // Fire and forget - don't block UI
        TauriService.updateUIState({ panelSizes: sizes }).catch(console.error)
      }
    }, 150) // Wait 150ms after last resize before saving
  },

  setLayout: (layout) => {
    set((state) => ({ ui: { ...state.ui, layout } }))

    if (TauriService.isTauri()) {
      // Fire and forget - don't block UI
      TauriService.updateUIState({ layout }).catch(console.error)
    }
  },

  setTheme: (theme) => {
    set((state) => ({ ui: { ...state.ui, theme } }))

    if (TauriService.isTauri()) {
      // Fire and forget - don't block UI
      TauriService.updateUIState({ theme }).catch(console.error)
    }
  },


  setServerReady: (ready) => {
    console.log('[SERVER_READY] Setting server ready state:', ready)
    set((state) => ({ ui: { ...state.ui, isServerReady: ready } }))
  },

  // Annotations
  annotations: defaultAnnotationState,

  addTimeSeriesAnnotation: (filePath, annotation, channel) => {
    set((state) => {
      const annotations = { ...state.annotations }

      if (!annotations.timeSeries[filePath]) {
        annotations.timeSeries[filePath] = {
          filePath,
          globalAnnotations: [],
          channelAnnotations: {}
        }
      }

      // IMPORTANT: Create new arrays instead of mutating to ensure Zustand detects changes
      if (channel) {
        if (!annotations.timeSeries[filePath].channelAnnotations) {
          annotations.timeSeries[filePath].channelAnnotations = {}
        }
        const existingChannelAnnotations = annotations.timeSeries[filePath].channelAnnotations![channel] || []
        annotations.timeSeries[filePath].channelAnnotations![channel] = [...existingChannelAnnotations, annotation]
      } else {
        annotations.timeSeries[filePath].globalAnnotations = [
          ...annotations.timeSeries[filePath].globalAnnotations,
          annotation
        ]
      }

      console.log('[ANNOTATION] After adding annotation, state:', {
        filePath,
        globalAnnotationsCount: annotations.timeSeries[filePath].globalAnnotations.length,
        globalAnnotations: annotations.timeSeries[filePath].globalAnnotations,
        annotation
      })

      return { annotations }
    })

    // Save annotation to SQLite database
    setTimeout(async () => {
      if (TauriService.isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('save_annotation', {
            filePath,
            channel: channel || null,
            annotation: {
              id: annotation.id,
              position: annotation.position,
              label: annotation.label,
              color: annotation.color,
              description: annotation.description
            }
          })
          console.log('[ANNOTATION] Saved to SQLite:', annotation.id)
        } catch (err) {
          console.error('[ANNOTATION] Failed to save to SQLite:', err)
        }
      }
    }, 100)
  },

  updateTimeSeriesAnnotation: (filePath, annotationId, updates, channel) => {
    set((state) => {
      const annotations = { ...state.annotations }
      const fileAnnotations = annotations.timeSeries[filePath]

      if (!fileAnnotations) return state

      const updateAnnotationInArray = (arr: PlotAnnotation[]) =>
        arr.map(a => a.id === annotationId ? { ...a, ...updates, updatedAt: new Date().toISOString() } : a)

      if (channel && fileAnnotations.channelAnnotations?.[channel]) {
        fileAnnotations.channelAnnotations[channel] = updateAnnotationInArray(fileAnnotations.channelAnnotations[channel])
      } else {
        fileAnnotations.globalAnnotations = updateAnnotationInArray(fileAnnotations.globalAnnotations)
      }

      return { annotations }
    })

    // Save updated annotation to SQLite database
    setTimeout(async () => {
      if (TauriService.isTauri()) {
        try {
          const state = get();
          const fileAnnotations = state.annotations.timeSeries[filePath];
          if (!fileAnnotations) return;

          // Find the updated annotation
          let updatedAnnotation: PlotAnnotation | undefined;
          if (channel && fileAnnotations.channelAnnotations?.[channel]) {
            updatedAnnotation = fileAnnotations.channelAnnotations[channel].find(a => a.id === annotationId);
          } else {
            updatedAnnotation = fileAnnotations.globalAnnotations.find(a => a.id === annotationId);
          }

          if (updatedAnnotation) {
            const { invoke } = await import('@tauri-apps/api/core')
            await invoke('save_annotation', {
              filePath,
              channel: channel || null,
              annotation: {
                id: updatedAnnotation.id,
                position: updatedAnnotation.position,
                label: updatedAnnotation.label,
                color: updatedAnnotation.color,
                description: updatedAnnotation.description
              }
            })
            console.log('[ANNOTATION] Updated in SQLite:', annotationId)
          }
        } catch (err) {
          console.error('[ANNOTATION] Failed to update in SQLite:', err)
        }
      }
    }, 100)
  },

  deleteTimeSeriesAnnotation: (filePath, annotationId, channel) => {
    set((state) => {
      const annotations = { ...state.annotations }
      const fileAnnotations = annotations.timeSeries[filePath]

      if (!fileAnnotations) return state

      if (channel && fileAnnotations.channelAnnotations?.[channel]) {
        fileAnnotations.channelAnnotations[channel] = fileAnnotations.channelAnnotations[channel].filter(a => a.id !== annotationId)
      } else {
        fileAnnotations.globalAnnotations = fileAnnotations.globalAnnotations.filter(a => a.id !== annotationId)
      }

      return { annotations }
    })

    // Delete annotation from SQLite database
    setTimeout(async () => {
      if (TauriService.isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('delete_annotation', { annotationId })
          console.log('[ANNOTATION] Deleted from SQLite:', annotationId)
        } catch (err) {
          console.error('[ANNOTATION] Failed to delete from SQLite:', err)
        }
      }
    }, 100)
  },

  getTimeSeriesAnnotations: (filePath, channel) => {
    const state = get()
    const fileAnnotations = state.annotations.timeSeries[filePath]

    if (!fileAnnotations) return []

    if (channel && fileAnnotations.channelAnnotations?.[channel]) {
      return [...fileAnnotations.globalAnnotations, ...fileAnnotations.channelAnnotations[channel]]
    }
    return fileAnnotations.globalAnnotations
  },

  addDDAAnnotation: (resultId, variantId, plotType, annotation) => {
    set((state) => {
      const annotations = { ...state.annotations }
      const key = `${resultId}_${variantId}_${plotType}`

      if (!annotations.ddaResults[key]) {
        annotations.ddaResults[key] = {
          resultId,
          variantId,
          plotType,
          annotations: []
        }
      }

      annotations.ddaResults[key].annotations.push(annotation)
      return { annotations }
    })

    // Defer save to avoid blocking UI
    setTimeout(() => {
      get().saveCurrentState().catch(err => console.error('[ANNOTATION] Failed to save:', err))
    }, 100)
  },

  updateDDAAnnotation: (resultId, variantId, plotType, annotationId, updates) => {
    set((state) => {
      const annotations = { ...state.annotations }
      const key = `${resultId}_${variantId}_${plotType}`
      const plotAnnotations = annotations.ddaResults[key]

      if (!plotAnnotations) return state

      plotAnnotations.annotations = plotAnnotations.annotations.map(a =>
        a.id === annotationId ? { ...a, ...updates, updatedAt: new Date().toISOString() } : a
      )

      return { annotations }
    })

    setTimeout(() => {
      get().saveCurrentState().catch(err => console.error('[ANNOTATION] Failed to save:', err))
    }, 100)
  },

  deleteDDAAnnotation: (resultId, variantId, plotType, annotationId) => {
    set((state) => {
      const annotations = { ...state.annotations }
      const key = `${resultId}_${variantId}_${plotType}`
      const plotAnnotations = annotations.ddaResults[key]

      if (!plotAnnotations) return state

      plotAnnotations.annotations = plotAnnotations.annotations.filter(a => a.id !== annotationId)
      return { annotations }
    })

    setTimeout(() => {
      get().saveCurrentState().catch(err => console.error('[ANNOTATION] Failed to save:', err))
    }, 100)
  },

  getDDAAnnotations: (resultId, variantId, plotType) => {
    const state = get()
    const key = `${resultId}_${variantId}_${plotType}`
    return state.annotations.ddaResults[key]?.annotations || []
  },

  // Workflow Recording
  workflowRecording: defaultWorkflowRecordingState,

  startWorkflowRecording: (sessionName) => {
    const name = sessionName || `session_${new Date().toISOString().split('T')[0]}_${Date.now()}`
    set({
      workflowRecording: {
        isRecording: true,
        currentSessionName: name,
        actionCount: 0,
        lastActionTimestamp: Date.now()
      }
    })
    console.log('[WORKFLOW] Recording started:', name)
  },

  stopWorkflowRecording: () => {
    set((state) => ({
      workflowRecording: {
        ...state.workflowRecording,
        isRecording: false
      }
    }))
    console.log('[WORKFLOW] Recording stopped')
  },

  incrementActionCount: () => {
    set((state) => ({
      workflowRecording: {
        ...state.workflowRecording,
        actionCount: state.workflowRecording.actionCount + 1,
        lastActionTimestamp: Date.now()
      }
    }))
  },

  getRecordingStatus: () => {
    return get().workflowRecording
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
        plot_data: null // Will be saved separately if needed
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

      console.log('[SAVE] Current state before save:', {
        selectedFile: currentState.fileManager.selectedFile?.file_path || null,
        selectedChannels: currentState.fileManager.selectedChannels,
        chunkSize: currentState.plot.chunkSize,
        chunkStart: currentState.plot.chunkStart
      });

      // NEW LIGHTWEIGHT STATE - Only UI preferences (no annotations, no analysis history)
      // Annotations → SQLite (save_annotation command)
      // Analysis history → Python API (not persisted in Rust)
      const stateToSave = {
        version: '2.0.0', // Version bump indicates SQLite-backed architecture
        file_manager: {
          selected_file: currentState.fileManager.selectedFile?.file_path || null,
          current_path: currentState.fileManager.currentPath,
          selected_channels: currentState.fileManager.selectedChannels,
          search_query: currentState.fileManager.searchQuery,
          sort_by: currentState.fileManager.sortBy,
          sort_order: currentState.fileManager.sortOrder,
          show_hidden: currentState.fileManager.showHidden
        },
        plot: {
          filters: {
            chunkSize: currentState.plot.chunkSize,
            chunkStart: currentState.plot.chunkStart,
            amplitude: currentState.plot.amplitude,
            showAnnotations: currentState.plot.showAnnotations
          },
          preprocessing: currentState.plot.preprocessing
        },
        dda: {
          selected_variants: currentState.dda.analysisParameters.variants,
          parameters: currentState.dda.analysisParameters,
          analysis_parameters: currentState.dda.analysisParameters,
          running: false // Don't persist running state
        },
        ui: {
          activeTab: currentState.ui.activeTab,
          sidebarOpen: currentState.ui.sidebarOpen,
          panelSizes: currentState.ui.panelSizes,
          layout: currentState.ui.layout,
          theme: currentState.ui.theme
        },
        active_tab: currentState.ui.activeTab,
        sidebar_collapsed: !currentState.ui.sidebarOpen,
        panel_sizes: {
          sidebar: (currentState.ui.panelSizes[0] || 25) / 100,
          main: (currentState.ui.panelSizes[1] || 50) / 100,
          'plot-height': 0.6
        }
      };

      console.log('[SAVE] Saving lightweight UI state (no annotations, no analysis history)');
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
  }
}))
