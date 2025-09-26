// TODO: Update for Tauri v2 API structure
// Dynamic imports to avoid SSR issues
const getTauriAPI = async () => {
  if (typeof window === 'undefined') return null
  const { invoke } = await import('@tauri-apps/api/core')  // TODO: Changed from 'tauri' to 'core' in v2
  // TODO: Update dialog import - now from plugins
  // const { open } = await import('@tauri-apps/plugin-dialog')
  // For now, fall back to invoke command until plugin is properly integrated
  const open = null  // TODO: Replace with plugin API
  // TODO: Update notification import - now from plugins  
  // const { sendNotification } = await import('@tauri-apps/plugin-notification')
  // For now, fall back to invoke command until plugin is properly integrated
  const sendNotification = null  // TODO: Replace with plugin API
  const { getCurrentWindow } = await import('@tauri-apps/api/window')  // TODO: Updated from appWindow to getCurrentWindow
  return { invoke, open, sendNotification, appWindow: getCurrentWindow() }
}

export interface FileManagerState {
  selected_file: string | null
  current_path: string[]
  selected_channels: string[]
  search_query: string
  sort_by: string
  sort_order: string
  show_hidden: boolean
}

export interface PlotState {
  visible_channels: string[]
  time_range: [number, number]
  amplitude_range: [number, number]
  zoom_level: number
}

export interface DDAState {
  selected_variants: string[]
  parameters: Record<string, any>
  last_analysis_id: string | null
}

export interface AppState {
  file_manager: FileManagerState
  plot: PlotState
  dda: DDAState
  ui: Record<string, any>
}

export interface AppPreferences {
  api_config: {
    url: string
    timeout: number
  }
  window_state: Record<string, any>
  theme: string
}

export class TauriService {
  private static instance: TauriService
  
  static getInstance(): TauriService {
    if (!TauriService.instance) {
      TauriService.instance = new TauriService()
    }
    return TauriService.instance
  }

  async openAnalysisPreviewWindow(analysis: any): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) return
      
      // Use Tauri's window API to create a new window
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      
      // Create window with analysis data
      const windowLabel = `analysis-preview-${analysis.id}`
      
      const previewWindow = new WebviewWindow(windowLabel, {
        url: `/analysis-preview?analysisId=${analysis.id}`,
        title: `Analysis Preview - ${analysis.file_path ? analysis.file_path.split('/').pop() : analysis.id}`,
        width: 1200,
        height: 800,
        resizable: true,
        minimizable: true,
        maximizable: true,
        center: true,
        focus: true,
        decorations: true
      })

      // Pass the analysis data to the window once it's loaded
      previewWindow.once('tauri://created', async () => {
        // Store the analysis data temporarily so the preview window can access it
        await api.invoke('store_analysis_preview_data', { 
          windowId: windowLabel,
          analysisData: analysis 
        })
      })

      previewWindow.once('tauri://error', (e) => {
        console.error('Failed to create analysis preview window:', e)
      })

    } catch (error) {
      console.error('Failed to open analysis preview window:', error)
    }
  }

  static async getAppState(): Promise<AppState> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')
      return await api.invoke('get_app_state')
    } catch (error) {
      console.error('Failed to get app state:', error)
      // Return default state
      return {
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
          zoom_level: 1.0
        },
        dda: {
          selected_variants: ['single_timeseries'],
          parameters: {},
          last_analysis_id: null
        },
        ui: {}
      }
    }
  }

  static async updateFileManagerState(state: FileManagerState): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) return
      await api.invoke('update_file_manager_state', { fileManagerState: state })
    } catch (error) {
      console.error('Failed to update file manager state:', error)
    }
  }

  static async updatePlotState(state: PlotState): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) return
      await api.invoke('update_plot_state', { plotState: state })
    } catch (error) {
      console.error('Failed to update plot state:', error)
    }
  }

  static async updateDDAState(state: DDAState): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) return
      await api.invoke('update_dda_state', { ddaState: state })
    } catch (error) {
      console.error('Failed to update DDA state:', error)
    }
  }

  static async updateUIState(updates: Record<string, any>): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) return
      await api.invoke('update_ui_state', { uiUpdates: updates })
    } catch (error) {
      console.error('Failed to update UI state:', error)
    }
  }

  static async checkApiConnection(url: string): Promise<boolean> {
    try {
      const api = await getTauriAPI()
      if (!api) return false
      return await api.invoke('check_api_connection', { url })
    } catch (error) {
      console.error('Failed to check API connection:', error)
      return false
    }
  }

  static async getAppPreferences(): Promise<AppPreferences> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')
      return await api.invoke('get_app_preferences')
    } catch (error) {
      console.error('Failed to get app preferences:', error)
      return {
        api_config: {
          url: 'http://localhost:8000',
          timeout: 30
        },
        window_state: {},
        theme: 'auto'
      }
    }
  }

  static async saveAppPreferences(preferences: AppPreferences): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')
      await api.invoke('save_app_preferences', { preferences })
    } catch (error) {
      console.error('Failed to save app preferences:', error)
      throw error
    }
  }

  static async openFileDialog(): Promise<string | null> {
    try {
      const api = await getTauriAPI()
      if (!api) return null
      
      // TODO: Replace with tauri-plugin-dialog v2 API once properly integrated
      // For now, use the Rust command fallback
      const result = await api.invoke<string | null>('open_file_dialog')
      return result
    } catch (error) {
      console.error('Failed to open file dialog:', error)
      return null
    }
  }

  static async showNotification(title: string, body: string): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) return
      
      // TODO: Replace with tauri-plugin-notification v2 API once properly integrated
      // For now, use the Rust command fallback
      await api.invoke('show_notification', { title, body })
    } catch (error) {
      console.error('Failed to show notification:', error)
    }
  }

  static async minimizeWindow(): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) return
      await api.appWindow.minimize()
    } catch (error) {
      console.error('Failed to minimize window:', error)
    }
  }

  static async maximizeWindow(): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) return
      await api.appWindow.toggleMaximize()
    } catch (error) {
      console.error('Failed to maximize window:', error)
    }
  }

  static async closeWindow(): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) return
      await api.appWindow.close()
    } catch (error) {
      console.error('Failed to close window:', error)
    }
  }

  static async setWindowTitle(title: string): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) return
      await api.appWindow.setTitle(title)
    } catch (error) {
      console.error('Failed to set window title:', error)
    }
  }

  static isTauri(): boolean {
    if (typeof window === 'undefined') return false
    
    // Check multiple possible Tauri indicators
    return (
      '__TAURI__' in window ||
      '__TAURI_METADATA__' in window ||
      window.location.protocol === 'tauri:' ||
      (window.navigator.userAgent && window.navigator.userAgent.includes('Tauri')) ||
      // Force Tauri mode in development for testing
      (process.env.NODE_ENV === 'development' && window.location.port === '3003')
    )
  }
}