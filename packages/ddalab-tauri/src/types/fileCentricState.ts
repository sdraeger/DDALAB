/**
 * File-Centric State Management Types
 *
 * This system ensures that all application state is associated with specific files.
 * When a file is selected, all related state (plot settings, analysis results, annotations, etc.)
 * is loaded automatically. This provides a cohesive, file-based workflow.
 */

import { PreprocessingOptions } from './persistence'
import { PlotAnnotation } from './annotations'

/**
 * State module interface - implement this to create a new state module
 * Each module is responsible for one aspect of file-specific state
 */
export interface FileStateModule<T = any> {
  /** Unique identifier for this module (e.g., 'plot', 'dda', 'annotations') */
  readonly moduleId: string

  /** Load state for a specific file */
  loadState(filePath: string): Promise<T | null>

  /** Save state for a specific file */
  saveState(filePath: string, state: T): Promise<void>

  /** Clear state for a specific file */
  clearState(filePath: string): Promise<void>

  /** Get default state when no saved state exists */
  getDefaultState(): T

  /** Optional: Validate loaded state */
  validateState?(state: any): state is T
}

/**
 * Plot state for a specific file
 */
export interface FilePlotState {
  /** Current chunk position (in seconds) */
  chunkStart: number

  /** Chunk size (in samples) */
  chunkSize: number

  /** Selected channels for visualization */
  selectedChannels: string[]

  /** Amplitude scale factor */
  amplitude: number

  /** Whether annotations are visible */
  showAnnotations: boolean

  /** Preprocessing options applied to this file */
  preprocessing?: PreprocessingOptions

  /** Custom channel colors */
  channelColors?: Record<string, string>

  /** Time window range */
  timeWindow?: {
    start: number
    end: number
  }

  /** Last update timestamp */
  lastUpdated: string
}

/**
 * DDA analysis state for a specific file
 */
export interface FileDDAState {
  /** Current active analysis result */
  currentAnalysisId: string | null

  /** All analysis results for this file */
  analysisHistory: string[]  // Array of analysis IDs

  /** Analysis parameters last used for this file */
  lastParameters: {
    variants: string[]
    windowLength: number
    windowStep: number
    detrending: 'linear' | 'polynomial' | 'none'
    scaleMin: number
    scaleMax: number
    scaleNum: number
  }

  /** Selected variants for visualization */
  selectedVariants: string[]

  /** Last update timestamp */
  lastUpdated: string
}

/**
 * Annotation state for a specific file
 */
export interface FileAnnotationState {
  /** Time series annotations (global and per-channel) */
  timeSeries: {
    global: PlotAnnotation[]
    channels: Record<string, PlotAnnotation[]>
  }

  /** DDA result annotations, keyed by resultId_variantId_plotType */
  ddaResults: Record<string, PlotAnnotation[]>

  /** Last update timestamp */
  lastUpdated: string
}

/**
 * Complete file-specific state
 * This is the state saved/loaded for each file
 */
export interface FileSpecificState {
  /** File path (identifier) */
  filePath: string

  /** Plot visualization state */
  plot?: FilePlotState

  /** DDA analysis state */
  dda?: FileDDAState

  /** Annotations state */
  annotations?: FileAnnotationState

  /** Extensible - allows future modules to add their state */
  [moduleId: string]: any

  /** Metadata */
  metadata: {
    /** First time this file was opened */
    firstOpened: string

    /** Last time this file was accessed */
    lastAccessed: string

    /** Number of times this file has been opened */
    accessCount: number

    /** Version of the state format */
    version: string
  }
}

/**
 * Registry of all file states
 * Maps file paths to their complete state
 */
export interface FileStateRegistry {
  /** All file states, keyed by file path */
  files: Record<string, FileSpecificState>

  /** Currently active file */
  activeFilePath: string | null

  /** Last active file (for quick restoration) */
  lastActiveFilePath: string | null

  /** Registry metadata */
  metadata: {
    version: string
    lastUpdated: string
  }
}

/**
 * Options for file state manager
 */
export interface FileStateManagerOptions {
  /** Auto-save state when changes occur */
  autoSave: boolean

  /** Interval for auto-save (ms) */
  saveInterval: number

  /** Max number of file states to keep in memory */
  maxCachedFiles: number

  /** Whether to persist to backend */
  persistToBackend: boolean
}

/**
 * Module registration descriptor
 */
export interface ModuleDescriptor<T = any> {
  module: FileStateModule<T>
  priority?: number  // Load order priority (lower = first)
}

/**
 * File state change event
 */
export interface FileStateChangeEvent {
  filePath: string
  moduleId: string
  oldState: any
  newState: any
  timestamp: string
}

/**
 * State migration interface for version upgrades
 */
export interface FileStateMigration {
  fromVersion: string
  toVersion: string
  migrate: (oldState: any) => FileSpecificState
}
