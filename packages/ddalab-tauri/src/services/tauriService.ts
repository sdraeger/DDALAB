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
  annotations?: any[]
  color_scheme?: string
  plot_mode?: string
  filters?: Record<string, any>
  preprocessing?: any
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

export enum NSGJobStatus {
  Pending = 'pending',
  Submitted = 'submitted',
  Queue = 'queue',
  InputStaging = 'inputstaging',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export interface NSGJob {
  id: string
  nsg_job_id: string | null
  tool: string
  status: NSGJobStatus
  created_at: string
  submitted_at: string | null
  completed_at: string | null
  dda_params: Record<string, any>
  input_file_path: string
  output_files: string[]
  error_message: string | null
  last_polled: string | null
  progress: number | null
}

export interface NSGCredentials {
  username: string
  password: string
  app_key: string
}

export interface NSGResourceConfig {
  runtime_hours?: number
  cores?: number
  nodes?: number
}

export interface NSGJobStats {
  total: number
  pending: number
  submitted: number
  running: number
  completed: number
  failed: number
  cancelled: number
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
        console.log('[DEBUG] Storing analysis preview data for window:', windowLabel)
        console.log('[DEBUG] Analysis object keys:', Object.keys(analysis))
        console.log('[DEBUG] Analysis.channels:', analysis.channels)
        console.log('[DEBUG] Analysis.Q present:', 'Q' in analysis)
        console.log('[DEBUG] Analysis.plot_data present:', !!analysis.plot_data)

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
      console.log('[TAURI] updateFileManagerState called:', {
        selected_file: state.selected_file,
        current_path: state.current_path,
        selected_channels: state.selected_channels
      })
      const api = await getTauriAPI()
      if (!api) {
        console.warn('[TAURI] Tauri API not available, skipping file manager state update')
        return
      }
      await api.invoke('update_file_manager_state', { fileManagerState: state })
      console.log('[TAURI] updateFileManagerState succeeded')
    } catch (error) {
      console.error('[TAURI] Failed to update file manager state:', error)
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

  // API Server Management (Unified Local/Remote)
  static async startLocalApiServer(port?: number, host?: string, dataDirectory?: string): Promise<any> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')

      const result = await api.invoke('start_local_api_server', { port, host, dataDirectory })
      return result
    } catch (error) {
      console.error('Failed to start local API server:', error)
      throw error
    }
  }

  static async stopLocalApiServer(): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')
      await api.invoke('stop_local_api_server')
    } catch (error) {
      console.error('Failed to stop local API server:', error)
      throw error
    }
  }

  static async getApiStatus(): Promise<any> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')
      return await api.invoke('get_api_status')
    } catch (error) {
      console.error('Failed to get API status:', error)
      return null
    }
  }

  static async getApiConfig(): Promise<any> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')
      return await api.invoke('get_api_config')
    } catch (error) {
      console.error('Failed to get API config:', error)
      return null
    }
  }

  static async loadApiConfig(): Promise<any> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')
      return await api.invoke('load_api_config')
    } catch (error) {
      console.error('Failed to load API config:', error)
      return null
    }
  }

  static async saveApiConfig(config: any): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')
      await api.invoke('save_api_config', { config })
    } catch (error) {
      console.error('Failed to save API config:', error)
      throw error
    }
  }

  // Data directory management
  static async selectDataDirectory(): Promise<string> {
    try {
      // Use tauri-plugin-dialog for folder selection
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Data Directory'
      })

      if (!selected || typeof selected !== 'string') {
        throw new Error('No directory selected')
      }

      // Save the selected directory
      await this.setDataDirectory(selected)
      return selected
    } catch (error) {
      console.error('Failed to select data directory:', error)
      throw error
    }
  }

  static async getDataDirectory(): Promise<string> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')
      return await api.invoke('get_data_directory')
    } catch (error) {
      console.error('Failed to get data directory:', error)
      throw error
    }
  }

  static async setDataDirectory(path: string): Promise<void> {
    try {
      const api = await getTauriAPI()
      if (!api) throw new Error('Tauri API not available')
      await api.invoke('set_data_directory', { path })
    } catch (error) {
      console.error('Failed to set data directory:', error)
      throw error
    }
  }

  static isTauri(): boolean {
    if (typeof window === 'undefined') return false

    // Check for actual Tauri indicators first
    const hasTraditionalTauriIndicators = (
      '__TAURI__' in window ||
      '__TAURI_METADATA__' in window ||
      window.location.protocol === 'tauri:' ||
      (window.navigator.userAgent && window.navigator.userAgent.includes('Tauri'))
    )

    // For development mode, check if we're running in the Tauri dev environment
    // In Tauri dev, the window will have Tauri API available even on localhost
    const isInTauriDev = async () => {
      try {
        // Try to access Tauri API to confirm we're in Tauri
        const { invoke } = await import('@tauri-apps/api/core')
        // Test if we can actually call a Tauri command
        await invoke('get_app_state')
        return true
      } catch {
        return false
      }
    }

    // For immediate synchronous check, use traditional indicators or dev mode detection
    if (hasTraditionalTauriIndicators) {
      return true
    }

    // In development, if we're on port 3003, assume it's Tauri dev mode
    // This is a reasonable assumption since that's the configured dev port
    return process.env.NODE_ENV === 'development' && window.location.port === '3003'
  }

  // Update Commands
  static async checkForUpdates(): Promise<{
    available: boolean
    current_version: string
    latest_version?: string
    release_notes?: string
    release_date?: string
    download_url?: string
  }> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('check_for_updates')
  }

  // Get app version
  static async getAppVersion(): Promise<string> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('get_app_version')
  }

  // Native Update Commands (uses Tauri updater plugin)
  static async checkNativeUpdate(): Promise<{
    available: boolean
    current_version: string
    latest_version?: string
    release_notes?: string
    release_date?: string
  }> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('check_native_update')
  }

  static async downloadAndInstallUpdate(): Promise<void> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    await api.invoke('download_and_install_update')
  }

  // Open URL in default browser
  static async openUrl(url: string): Promise<void> {
    if (typeof window === 'undefined') return

    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
    } catch (error) {
      console.error('Failed to open URL:', error)
      throw error
    }
  }

  // Debug Commands
  static async openLogsFolder(): Promise<void> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    await api.invoke('open_logs_folder')
  }

  static async getLogsPath(): Promise<string> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('get_logs_path')
  }

  static async readLogsContent(): Promise<string> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('read_logs_content')
  }

  // NSG (Neuroscience Gateway) Commands

  static async saveNSGCredentials(username: string, password: string, appKey: string): Promise<void> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    await api.invoke('save_nsg_credentials', { username, password, appKey })
  }

  static async getNSGCredentials(): Promise<NSGCredentials | null> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('get_nsg_credentials')
  }

  static async hasNSGCredentials(): Promise<boolean> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('has_nsg_credentials')
  }

  static async deleteNSGCredentials(): Promise<void> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    await api.invoke('delete_nsg_credentials')
  }

  static async testNSGConnection(): Promise<boolean> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('test_nsg_connection')
  }

  static async createNSGJob(
    tool: string,
    ddaParams: Record<string, any>,
    inputFilePath: string,
    runtimeHours?: number,
    cores?: number,
    nodes?: number
  ): Promise<string> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')

    const params: Record<string, any> = {
      tool,
      ddaParams: ddaParams,
      inputFilePath: inputFilePath,
    }

    // Only add optional parameters if they're defined
    if (runtimeHours !== undefined) params.runtimeHours = runtimeHours
    if (cores !== undefined) params.cores = cores
    if (nodes !== undefined) params.nodes = nodes

    console.log('[TauriService] createNSGJob params:', params)

    return await api.invoke('create_nsg_job', params)
  }

  static async submitNSGJob(jobId: string): Promise<NSGJob> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('submit_nsg_job', { jobId })
  }

  static async getNSGJobStatus(jobId: string): Promise<NSGJob> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('get_nsg_job_status', { jobId })
  }

  static async listNSGJobs(): Promise<NSGJob[]> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('list_nsg_jobs')
  }

  static async listActiveNSGJobs(): Promise<NSGJob[]> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('list_active_nsg_jobs')
  }

  static async cancelNSGJob(jobId: string): Promise<void> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    await api.invoke('cancel_nsg_job', { jobId })
  }

  static async downloadNSGResults(jobId: string): Promise<string[]> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('download_nsg_results', { jobId })
  }

  static async extractNSGTarball(jobId: string, tarPath: string): Promise<string[]> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('extract_nsg_tarball', { jobId, tarPath })
  }

  static async readTextFile(filePath: string): Promise<string> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(filePath)
  }

  static async deleteNSGJob(jobId: string): Promise<void> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    await api.invoke('delete_nsg_job', { jobId })
  }

  static async pollNSGJobs(): Promise<void> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    await api.invoke('poll_nsg_jobs')
  }

  static async getNSGJobStats(): Promise<NSGJobStats> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('get_nsg_job_stats')
  }

  static async cleanupPendingNSGJobs(): Promise<number> {
    const api = await getTauriAPI()
    if (!api) throw new Error('Not running in Tauri environment')
    return await api.invoke('cleanup_pending_nsg_jobs')
  }
}
