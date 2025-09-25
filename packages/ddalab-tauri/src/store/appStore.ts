import { create } from 'zustand'
import { EDFFileInfo, ChunkData, DDAResult, Annotation } from '@/types/api'
import { TauriService } from '@/services/tauriService'

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
}

export interface AppState {
  // Initialization
  isInitialized: boolean
  initializeFromTauri: () => Promise<void>

  // File management
  fileManager: FileManagerState
  setCurrentPath: (path: string[]) => void
  setSelectedFile: (file: EDFFileInfo | null) => void
  setSelectedChannels: (channels: string[]) => void
  setTimeWindow: (window: { start: number; end: number }) => void
  updateFileManagerState: (updates: Partial<FileManagerState>) => void

  // Plotting
  plot: PlotState
  setCurrentChunk: (chunk: ChunkData | null) => void
  updatePlotState: (updates: Partial<PlotState>) => void

  // DDA Analysis
  dda: DDAState
  setCurrentAnalysis: (analysis: DDAResult | null) => void
  addAnalysisToHistory: (analysis: DDAResult) => void
  setAnalysisHistory: (analyses: DDAResult[]) => void
  updateAnalysisParameters: (parameters: Partial<DDAState['analysisParameters']>) => void
  setDDARunning: (running: boolean) => void

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
}

const defaultFileManagerState: FileManagerState = {
  currentPath: [],
  selectedFile: null,
  selectedChannels: [],
  timeWindow: { start: 0, end: 30 },
  searchQuery: '',
  sortBy: 'name',
  sortOrder: 'asc',
  showHidden: false
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
  theme: 'auto'
}

export const useAppStore = create<AppState>((set, get) => ({
  isInitialized: false,
  
  initializeFromTauri: async () => {
    if (TauriService.isTauri()) {
      try {
        const tauriState = await TauriService.getAppState()
        
        set((state) => ({
          isInitialized: true,
          fileManager: {
            ...state.fileManager,
            currentPath: tauriState.file_manager.current_path,
            selectedChannels: tauriState.file_manager.selected_channels,
            searchQuery: tauriState.file_manager.search_query,
            sortBy: tauriState.file_manager.sort_by as 'name' | 'size' | 'date',
            sortOrder: tauriState.file_manager.sort_order as 'asc' | 'desc',
            showHidden: tauriState.file_manager.show_hidden
          },
          plot: {
            ...state.plot,
            // Map Tauri state to local state
          },
          dda: {
            ...state.dda,
            analysisParameters: {
              ...state.dda.analysisParameters,
              variants: tauriState.dda.selected_variants
            }
          },
          ui: {
            ...state.ui,
            ...tauriState.ui
          }
        }))
      } catch (error) {
        console.error('Failed to initialize from Tauri state:', error)
        set({ isInitialized: true })
      }
    } else {
      set({ isInitialized: true })
    }
  },

  // File management
  fileManager: defaultFileManagerState,
  
  setCurrentPath: (path) => {
    set((state) => ({
      fileManager: { ...state.fileManager, currentPath: path }
    }))
    
    if (TauriService.isTauri()) {
      const { fileManager } = get()
      TauriService.updateFileManagerState({
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: path,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden
      })
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
  }
}))