import { getCurrentWindow } from '@tauri-apps/api/window'
import { emit, listen, UnlistenFn } from '@tauri-apps/api/event'

export type WindowType = 'timeseries' | 'dda-results' | 'eeg-visualization'

export interface WindowConfig {
  label: string
  title: string
  url: string
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  resizable?: boolean
  decorations?: boolean
  alwaysOnTop?: boolean
}

export interface PopoutWindowState {
  id: string
  type: WindowType
  isLocked: boolean
  data: any
  lastUpdate: number
}

class WindowManager {
  private windows: Map<string, Window> = new Map()
  private windowStates: Map<string, PopoutWindowState> = new Map()
  private listeners: Map<string, UnlistenFn> = new Map()

  private getWindowConfig(type: WindowType, id: string): WindowConfig {
    const baseConfigs: Record<WindowType, WindowConfig> = {
      timeseries: {
        label: `timeseries-${id}`,
        title: 'Time Series Plot',
        url: `/popout/minimal?type=timeseries&id=${id}`,
        width: 800,
        height: 600,
        minWidth: 400,
        minHeight: 300,
        resizable: true,
        decorations: true,
        alwaysOnTop: false
      },
      'dda-results': {
        label: `dda-results-${id}`,
        title: 'DDA Analysis Results',
        url: `/popout/minimal?type=dda-results&id=${id}`,
        width: 1000,
        height: 700,
        minWidth: 600,
        minHeight: 400,
        resizable: true,
        decorations: true,
        alwaysOnTop: false
      },
      'eeg-visualization': {
        label: `eeg-viz-${id}`,
        title: 'EEG Visualization',
        url: `/popout/minimal?type=eeg-visualization&id=${id}`,
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 500,
        resizable: true,
        decorations: true,
        alwaysOnTop: false
      }
    }

    return baseConfigs[type]
  }

  async createPopoutWindow(type: WindowType, id: string, data: any): Promise<string> {
    console.log(`[WINDOW_MANAGER] createPopoutWindow called with:`, { type, id, data })
    const config = this.getWindowConfig(type, id)
    const windowId = `${type}-${id}-${Date.now()}`

    try {
      // Import Tauri invoke function
      const { invoke } = await import('@tauri-apps/api/core')
      
      // Update the URL to include the generated windowId instead of the original id
      const updatedUrl = config.url.replace(`id=${id}`, `id=${windowId}`)
      
      console.log(`[WINDOW_MANAGER] Creating window with ID: ${windowId}, URL: ${updatedUrl}`)
      
      // Call the Rust command to create the window
      const windowLabel = await invoke('create_popout_window', {
        windowType: type,
        windowId: id,
        title: config.title,
        url: updatedUrl,
        width: config.width,
        height: config.height
      })

      console.log(`[WINDOW_MANAGER] Created popout window: ${windowLabel}`)

      // Initialize window state
      const state: PopoutWindowState = {
        id: windowId,
        type,
        isLocked: false,
        data,
        lastUpdate: Date.now()
      }
      this.windowStates.set(windowId, state)

      // Send initial data to the window after a short delay to ensure window is ready
      console.log(`[WINDOW_MANAGER] Scheduling initial data send for window: ${windowId}`, {
        dataKeys: data ? Object.keys(data) : 'null',
        delay: 1000
      })
      
      
      setTimeout(() => {
        console.log(`[WINDOW_MANAGER] Timeout triggered - attempting to send initial data to window: ${windowId}`)
        this.sendDataToWindow(windowId, data)
      }, 1000)

      return windowId
    } catch (error) {
      console.error('Failed to create popout window:', error)
      throw error
    }
  }

  async closePopoutWindow(windowId: string): Promise<void> {
    const window = this.windows.get(windowId)
    if (window) {
      try {
        await window.close()
        this.cleanup(windowId)
      } catch (error) {
        console.error('Failed to close window:', error)
      }
    }
  }

  private async setupWindowListeners(windowId: string, window: Window): Promise<void> {
    // Listen for window close event
    const closeListener = await window.onCloseRequested(() => {
      this.cleanup(windowId)
    })

    // Listen for lock/unlock requests from the window
    const lockListener = await listen(`lock-window-${windowId}`, () => {
      this.setWindowLock(windowId, true)
    })

    const unlockListener = await listen(`unlock-window-${windowId}`, () => {
      this.setWindowLock(windowId, false)
    })

    // Store listeners for cleanup
    this.listeners.set(`${windowId}-close`, closeListener)
    this.listeners.set(`${windowId}-lock`, lockListener)
    this.listeners.set(`${windowId}-unlock`, unlockListener)
  }

  private cleanup(windowId: string): void {
    // Remove window reference
    this.windows.delete(windowId)

    // Remove state
    this.windowStates.delete(windowId)

    // Cleanup listeners
    const closeListener = this.listeners.get(`${windowId}-close`)
    const lockListener = this.listeners.get(`${windowId}-lock`)
    const unlockListener = this.listeners.get(`${windowId}-unlock`)

    if (closeListener) {
      closeListener()
      this.listeners.delete(`${windowId}-close`)
    }
    if (lockListener) {
      lockListener()
      this.listeners.delete(`${windowId}-lock`)
    }
    if (unlockListener) {
      unlockListener()
      this.listeners.delete(`${windowId}-unlock`)
    }

    console.log(`Cleaned up window: ${windowId}`)
  }

  async sendDataToWindow(windowId: string, data: any): Promise<void> {
    const state = this.windowStates.get(windowId)
    if (!state || state.isLocked) {
      console.log(`[WINDOW_MANAGER] Not sending data to window ${windowId}: ${!state ? 'no state' : 'locked'}`)
      return
    }

    console.log(`[WINDOW_MANAGER] Sending data to window ${windowId}:`, {
      eventName: `data-update-${windowId}`,
      dataKeys: data ? Object.keys(data) : 'null',
      timestamp: Date.now()
    })

    try {
      await emit(`data-update-${windowId}`, {
        windowId,
        data,
        timestamp: Date.now()
      })

      console.log(`[WINDOW_MANAGER] Successfully emitted data-update-${windowId} event`)

      // Update state
      state.data = data
      state.lastUpdate = Date.now()
      this.windowStates.set(windowId, state)
    } catch (error) {
      console.error(`[WINDOW_MANAGER] Failed to send data to window ${windowId}:`, error)
    }
  }

  setWindowLock(windowId: string, locked: boolean): void {
    const state = this.windowStates.get(windowId)
    if (state) {
      state.isLocked = locked
      this.windowStates.set(windowId, state)

      // Emit lock state change to the window
      emit(`lock-state-${windowId}`, { locked })
      console.log(`Window ${windowId} ${locked ? 'locked' : 'unlocked'}`)
    }
  }

  getWindowState(windowId: string): PopoutWindowState | undefined {
    return this.windowStates.get(windowId)
  }

  getAllWindows(): string[] {
    return Array.from(this.windows.keys())
  }

  getWindowsByType(type: WindowType): string[] {
    return Array.from(this.windowStates.entries())
      .filter(([, state]) => state.type === type)
      .map(([windowId]) => windowId)
  }

  async broadcastToAllWindows(eventName: string, data: any): Promise<void> {
    for (const windowId of this.windows.keys()) {
      try {
        await emit(`${eventName}-${windowId}`, data)
      } catch (error) {
        console.error(`Failed to broadcast to window ${windowId}:`, error)
      }
    }
  }

  async broadcastToType(type: WindowType, eventName: string, data: any): Promise<void> {
    const windowIds = this.getWindowsByType(type)
    for (const windowId of windowIds) {
      const state = this.windowStates.get(windowId)
      if (state && !state.isLocked) {
        try {
          await emit(`${eventName}-${windowId}`, data)
        } catch (error) {
          console.error(`Failed to broadcast to window ${windowId}:`, error)
        }
      }
    }
  }

  isWindowOpen(windowId: string): boolean {
    return this.windows.has(windowId)
  }

  async focusWindow(windowId: string): Promise<void> {
    const window = this.windows.get(windowId)
    if (window) {
      try {
        await window.setFocus()
      } catch (error) {
        console.error(`Failed to focus window ${windowId}:`, error)
      }
    }
  }
}

export const windowManager = new WindowManager()
export default windowManager