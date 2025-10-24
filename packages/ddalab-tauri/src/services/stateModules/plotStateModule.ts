/**
 * Plot State Module
 *
 * Manages plot visualization state for each file.
 * This includes chunk position, selected channels, amplitude, preprocessing, etc.
 */

import { invoke } from '@tauri-apps/api/core'
import { FileStateModule, FilePlotState } from '@/types/fileCentricState'

export class PlotStateModule implements FileStateModule<FilePlotState> {
  readonly moduleId = 'plot'

  async loadState(filePath: string): Promise<FilePlotState | null> {
    try {
      const state = await invoke<FilePlotState>('get_file_plot_state', {
        filePath,
      })
      return state
    } catch (error) {
      console.log('[PlotStateModule] No saved state for file:', filePath)
      return null
    }
  }

  async saveState(filePath: string, state: FilePlotState): Promise<void> {
    try {
      await invoke('save_file_plot_state', {
        filePath,
        state,
      })
    } catch (error) {
      console.error('[PlotStateModule] Failed to save state:', error)
      throw error
    }
  }

  async clearState(filePath: string): Promise<void> {
    try {
      await invoke('clear_file_plot_state', {
        filePath,
      })
    } catch (error) {
      console.error('[PlotStateModule] Failed to clear state:', error)
    }
  }

  getDefaultState(): FilePlotState {
    return {
      chunkStart: 0,
      chunkSize: 8192,
      selectedChannels: [],
      amplitude: 1.0,
      showAnnotations: true,
      lastUpdated: new Date().toISOString(),
    }
  }

  validateState(state: any): state is FilePlotState {
    return (
      typeof state === 'object' &&
      typeof state.chunkStart === 'number' &&
      typeof state.chunkSize === 'number' &&
      Array.isArray(state.selectedChannels) &&
      typeof state.amplitude === 'number' &&
      typeof state.showAnnotations === 'boolean'
    )
  }
}
