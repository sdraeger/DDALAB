import { create } from 'zustand'
import { EDFFileInfo, ChunkData, DDAResult, Annotation } from '@/types/api'
import { TauriService } from '@/services/tauriService'
import { getStatePersistenceService, StatePersistenceService } from '@/services/statePersistenceService'
import { AppState as PersistedAppState, AnalysisResult } from '@/types/persistence'

export interface FileManagerState {
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

export interface UIState {
  activeTab: string
  sidebarOpen: boolean
  panelSizes: number[]
  layout: 'default' | 'analysis' | 'plots'
  theme: 'light' | 'dark' | 'auto'
  apiMode: 'embedded' | 'external'
  isServerReady: boolean  // Tracks if API server is ready to accept requests
}

export interface AppState {
  // Initialization
  isInitialized: boolean
  persistenceService: StatePersistenceService | null
  initializeFromTauri: () => Promise<void>
  initializePersistence: () => Promise<void>

  // File management
  fileManager: FileManagerState
  setCurrentPath: (path: string[]) => void
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

  // UI state
  ui: UIState
  setActiveTab: (tab: string) => void
  setSidebarOpen: (open: boolean) => void
  setPanelSizes: (sizes: number[]) => void
  setLayout: (layout: UIState['layout']) => void
  setTheme: (theme: UIState['theme']) => void
  setApiMode: (mode: UIState['apiMode']) => void
  setServerReady: (ready: boolean) => void

  // State persistence
  saveCurrentState: () => Promise<void>
  forceSave: () => Promise<void>
  clearPersistedState: () => Promise<void>
  getPersistedState: () => Promise<PersistedAppState | null>
  createStateSnapshot: () => Promise<any>
}

const defaultFileManagerState: FileManagerState = {
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
    windowLength: 100,
    windowStep: 10,
    detrending: 'linear',
    scaleMin: 1,
    scaleMax: 20,
    scaleNum: 20
  },
  isRunning: false
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
  apiMode: 'embedded',
  isServerReady: false
}

export const useAppStore = create<AppState>((set, get) => ({
  isInitialized: false,
  persistenceService: null,

  initializePersistence: async () => {
    if (TauriService.isTauri()) {
      try {
        const service = getStatePersistenceService({
          autoSave: true,
          saveInterval: 30000,
          includeAnalysisHistory: true,
          includePlotData: true,
          maxHistoryItems: 50
        });

        const persistedState = await service.initialize();

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
          const currentAnalysis = persistedState.dda.current_analysis ? {
            id: persistedState.dda.current_analysis.id,
            file_path: persistedState.dda.current_analysis.file_path,
            created_at: persistedState.dda.current_analysis.created_at,
            results: persistedState.dda.current_analysis.results,
            parameters: persistedState.dda.current_analysis.parameters,
            plot_data: persistedState.dda.current_analysis.plot_data,
            channels: persistedState.file_manager.selected_channels,
            status: 'completed' as const
          } : null;

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

          return {
            ...state,
            persistenceService: service,
            fileManager: {
              ...state.fileManager,
              currentPath: persistedState.file_manager.current_path,
              selectedFile,
              selectedChannels: persistedState.file_manager.selected_channels,
              searchQuery: persistedState.file_manager.search_query,
              sortBy: persistedState.file_manager.sort_by as 'name' | 'size' | 'date',
              sortOrder: persistedState.file_manager.sort_order as 'asc' | 'desc',
              showHidden: persistedState.file_manager.show_hidden,
              pendingFileSelection: persistedState.file_manager.selected_file
            },
            plot: {
              ...state.plot,
              chunkSize: persistedState.plot.filters?.chunkSize || state.plot.chunkSize,
              amplitude: persistedState.plot.filters?.amplitude || state.plot.amplitude,
              showAnnotations: Boolean(persistedState.plot.filters?.showAnnotations ?? state.plot.showAnnotations)
            },
            dda: {
              ...state.dda,
              analysisParameters: {
                ...state.dda.analysisParameters,
                variants: persistedState.dda.selected_variants,
                windowLength: persistedState.dda.parameters?.windowLength || persistedState.dda.analysis_parameters?.windowLength || state.dda.analysisParameters.windowLength,
                windowStep: persistedState.dda.parameters?.windowStep || persistedState.dda.analysis_parameters?.windowStep || state.dda.analysisParameters.windowStep,
                detrending: (persistedState.dda.parameters?.detrending || persistedState.dda.analysis_parameters?.detrending || state.dda.analysisParameters.detrending) as 'linear' | 'polynomial' | 'none',
                scaleMin: persistedState.dda.parameters?.scaleMin || persistedState.dda.analysis_parameters?.scaleMin || state.dda.analysisParameters.scaleMin,
                scaleMax: persistedState.dda.parameters?.scaleMax || persistedState.dda.analysis_parameters?.scaleMax || state.dda.analysisParameters.scaleMax,
                scaleNum: persistedState.dda.parameters?.scaleNum || persistedState.dda.analysis_parameters?.scaleNum || state.dda.analysisParameters.scaleNum
              },
              currentAnalysis,
              analysisHistory
            },
            ui: {
              ...state.ui,
              activeTab: persistedState.active_tab,
              sidebarOpen: !persistedState.sidebar_collapsed,
              panelSizes: [
                persistedState.panel_sizes.sidebar * 100,
                persistedState.panel_sizes.main * 100 - persistedState.panel_sizes.sidebar * 100,
                25
              ],
              apiMode: persistedState.ui?.apiMode || 'embedded'
            }
          };
        });

        // State persistence initialized successfully
      } catch (error) {
        console.error('Failed to initialize persistence:', (error as Error)?.message);
        set({ persistenceService: null });
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

  setCurrentPath: (path) => {
    set((state) => ({
      fileManager: { ...state.fileManager, currentPath: path }
    }))

    if (TauriService.isTauri()) {
      const { fileManager, persistenceService } = get()
      const fileManagerState = {
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: path,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      }

      TauriService.updateFileManagerState(fileManagerState)

      // Auto-save via persistence service
      if (persistenceService) {
        persistenceService.saveFileManagerState(fileManagerState).catch(console.error)
      }
    }
  },

  setSelectedFile: (file) => {
    set((state) => ({
      fileManager: { ...state.fileManager, selectedFile: file }
    }))

    if (TauriService.isTauri()) {
      const { fileManager } = get()
      TauriService.updateFileManagerState({
        selected_file: file?.file_path || null,
        current_path: fileManager.currentPath,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      })
    }
  },

  setSelectedChannels: (channels) => {
    set((state) => ({
      fileManager: { ...state.fileManager, selectedChannels: channels }
    }))

    if (TauriService.isTauri()) {
      const { fileManager } = get()
      TauriService.updateFileManagerState({
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: fileManager.currentPath,
        selected_channels: channels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      })
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
      TauriService.updateFileManagerState({
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: fileManager.currentPath,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      })
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
      const { plot } = get()
      TauriService.updatePlotState({
        visible_channels: plot.selectedChannelColors ? Object.keys(plot.selectedChannelColors) : [],
        time_range: [plot.chunkStart, plot.chunkStart + plot.chunkSize],
        amplitude_range: [-100 * plot.amplitude, 100 * plot.amplitude],
        zoom_level: 1.0
      })
    }
  },

  // DDA Analysis
  dda: defaultDDAState,

  setCurrentAnalysis: (analysis) => {
    set((state) => ({ dda: { ...state.dda, currentAnalysis: analysis } }))
  },

  addAnalysisToHistory: (analysis) => {
    set((state) => ({
      dda: {
        ...state.dda,
        analysisHistory: [analysis, ...state.dda.analysisHistory.slice(0, 9)]
      }
    }))
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

    if (TauriService.isTauri()) {
      const { dda } = get()
      TauriService.updateDDAState({
        selected_variants: dda.analysisParameters.variants,
        parameters: {
          windowLength: dda.analysisParameters.windowLength,
          windowStep: dda.analysisParameters.windowStep,
          detrending: dda.analysisParameters.detrending,
          scaleMin: dda.analysisParameters.scaleMin,
          scaleMax: dda.analysisParameters.scaleMax,
          scaleNum: dda.analysisParameters.scaleNum
        },
        last_analysis_id: dda.currentAnalysis?.id || null
      })
    }
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

  // UI state
  ui: defaultUIState,

  setActiveTab: (tab) => {
    set((state) => ({ ui: { ...state.ui, activeTab: tab } }))

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ activeTab: tab })
    }
  },

  setSidebarOpen: (open) => {
    set((state) => ({ ui: { ...state.ui, sidebarOpen: open } }))

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ sidebarOpen: open })
    }
  },

  setPanelSizes: (sizes) => {
    set((state) => ({ ui: { ...state.ui, panelSizes: sizes } }))

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ panelSizes: sizes })
    }
  },

  setLayout: (layout) => {
    set((state) => ({ ui: { ...state.ui, layout } }))

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ layout })
    }
  },

  setTheme: (theme) => {
    set((state) => ({ ui: { ...state.ui, theme } }))

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ theme })
    }
  },

  setApiMode: (apiMode) => {
    set((state) => ({ ui: { ...state.ui, apiMode } }))

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ apiMode })
    }
  },

  setServerReady: (ready) => {
    console.log('[SERVER_READY] Setting server ready state:', ready)
    set((state) => ({ ui: { ...state.ui, isServerReady: ready } }))
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
      const stateToSave = {
        version: '1.0.0',
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
          visible_channels: currentState.fileManager.selectedChannels,
          time_range: [currentState.fileManager.timeWindow.start, currentState.fileManager.timeWindow.end],
          amplitude_range: [-100, 100], // Default
          zoom_level: 1.0,
          annotations: [],
          color_scheme: 'default',
          plot_mode: 'raw',
          filters: {
            chunkSize: currentState.plot.chunkSize,
            amplitude: currentState.plot.amplitude,
            showAnnotations: currentState.plot.showAnnotations
          }
        },
        dda: {
          selected_variants: currentState.dda.analysisParameters.variants,
          parameters: currentState.dda.analysisParameters,
          last_analysis_id: currentState.dda.currentAnalysis?.id || null,
          current_analysis: currentState.dda.currentAnalysis ? {
            id: currentState.dda.currentAnalysis.id,
            file_path: currentState.dda.currentAnalysis.file_path,
            created_at: currentState.dda.currentAnalysis.created_at || new Date().toISOString(),
            results: currentState.dda.currentAnalysis.results,
            parameters: currentState.dda.currentAnalysis.parameters,
            plot_data: null
          } : null,
          analysis_history: currentState.dda.analysisHistory.map(item => ({
            id: item.id,
            file_path: item.file_path,
            created_at: item.created_at || new Date().toISOString(),
            results: item.results,
            parameters: item.parameters,
            plot_data: null
          })),
          analysis_parameters: currentState.dda.analysisParameters,
          running: currentState.dda.isRunning
        },
        ui: {
          activeTab: currentState.ui.activeTab,
          sidebarOpen: currentState.ui.sidebarOpen,
          panelSizes: currentState.ui.panelSizes,
          layout: currentState.ui.layout,
          theme: currentState.ui.theme,
          apiMode: currentState.ui.apiMode
        },
        windows: {},
        active_tab: currentState.ui.activeTab,
        sidebar_collapsed: !currentState.ui.sidebarOpen,
        panel_sizes: {
          sidebar: (currentState.ui.panelSizes[0] || 25) / 100,
          main: (currentState.ui.panelSizes[1] || 50) / 100,
          'plot-height': 0.6
        }
      };

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
