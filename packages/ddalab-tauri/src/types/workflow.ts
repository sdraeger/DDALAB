// TypeScript types matching Rust structs in src-tauri/src/recording/

/**
 * File types supported for workflow actions
 */
export type FileType = 'EDF' | 'ASCII' | 'CSV'

/**
 * Export formats for results
 */
export type ExportFormat = 'CSV' | 'JSON' | 'MAT'

/**
 * Plot types that can be generated
 */
export type PlotType = 'Heatmap' | 'TimeSeries' | 'StatisticalSummary'

/**
 * Options for plot generation
 */
export interface PlotOptions {
  title?: string
  colormap?: string
  normalize: boolean
}

/**
 * Data transformation types
 */
export type TransformType =
  | { type: 'Normalize' }
  | { type: 'BandpassFilter'; low_freq: number; high_freq: number }

/**
 * Workflow actions that can be recorded
 * Matches Rust enum WorkflowAction with serde tag/content
 */
export type WorkflowAction =
  | {
      type: 'LoadFile'
      data: {
        path: string
        file_type: FileType
      }
    }
  | {
      type: 'SetDDAParameters'
      data: {
        lag: number
        dimension: number
        window_size: number
        window_offset: number
      }
    }
  | {
      type: 'RunDDAAnalysis'
      data: {
        input_id: string
        channel_selection: number[]
      }
    }
  | {
      type: 'ExportResults'
      data: {
        result_id: string
        format: ExportFormat
        path: string
      }
    }
  | {
      type: 'GeneratePlot'
      data: {
        result_id: string
        plot_type: PlotType
        options: PlotOptions
      }
    }
  | {
      type: 'FilterChannels'
      data: {
        input_id: string
        channel_indices: number[]
      }
    }
  | {
      type: 'TransformData'
      data: {
        input_id: string
        transform_type: TransformType
      }
    }

/**
 * Metadata for a workflow node
 */
export interface NodeMetadata {
  description?: string
  tags: string[]
  user_notes?: string
}

/**
 * A node in the workflow graph
 */
export interface WorkflowNode {
  id: string
  action: WorkflowAction
  timestamp: string // ISO 8601 datetime string
  metadata: NodeMetadata
}

/**
 * Dependency types between workflow nodes
 */
export type DependencyType = 'DataDependency' | 'ParameterDependency' | 'OrderDependency'

/**
 * An edge in the workflow graph connecting two nodes
 */
export interface WorkflowEdge {
  source: string
  target: string
  dependency_type: DependencyType
}

/**
 * Metadata for the entire workflow
 */
export interface WorkflowMetadata {
  name: string
  description?: string
  created_at: string // ISO 8601 datetime string
  modified_at: string // ISO 8601 datetime string
  version: string
}

/**
 * Information about a workflow graph
 */
export interface WorkflowInfo {
  node_count: number
  edge_count: number
  metadata: WorkflowMetadata
}

/**
 * Detailed information about a specific node including its dependencies
 */
export interface NodeInfo {
  id: string
  action: WorkflowAction
  timestamp: string // ISO 8601 datetime string
  dependencies: string[] // Node IDs that this node depends on
  dependents: string[] // Node IDs that depend on this node
}

/**
 * Workflow export/import format
 */
export interface WorkflowExport {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  metadata: WorkflowMetadata
}

/**
 * Helper functions to create workflow actions
 */
export const createLoadFileAction = (path: string, file_type: FileType): WorkflowAction => ({
  type: 'LoadFile',
  data: { path, file_type }
})

export const createSetDDAParametersAction = (
  lag: number,
  dimension: number,
  window_size: number,
  window_offset: number
): WorkflowAction => ({
  type: 'SetDDAParameters',
  data: { lag, dimension, window_size, window_offset }
})

export const createRunDDAAnalysisAction = (
  input_id: string,
  channel_selection: number[]
): WorkflowAction => ({
  type: 'RunDDAAnalysis',
  data: { input_id, channel_selection }
})

export const createExportResultsAction = (
  result_id: string,
  format: ExportFormat,
  path: string
): WorkflowAction => ({
  type: 'ExportResults',
  data: { result_id, format, path }
})

export const createGeneratePlotAction = (
  result_id: string,
  plot_type: PlotType,
  options: PlotOptions
): WorkflowAction => ({
  type: 'GeneratePlot',
  data: { result_id, plot_type, options }
})

export const createFilterChannelsAction = (
  input_id: string,
  channel_indices: number[]
): WorkflowAction => ({
  type: 'FilterChannels',
  data: { input_id, channel_indices }
})

export const createTransformDataAction = (
  input_id: string,
  transform_type: TransformType
): WorkflowAction => ({
  type: 'TransformData',
  data: { input_id, transform_type }
})

/**
 * Helper to create a workflow node with default metadata
 */
export const createWorkflowNode = (
  id: string,
  action: WorkflowAction,
  metadata?: Partial<NodeMetadata>
): WorkflowNode => ({
  id,
  action,
  timestamp: new Date().toISOString(),
  metadata: {
    description: metadata?.description,
    tags: metadata?.tags || [],
    user_notes: metadata?.user_notes
  }
})

/**
 * Helper to create a workflow edge
 */
export const createWorkflowEdge = (
  source: string,
  target: string,
  dependency_type: DependencyType
): WorkflowEdge => ({
  source,
  target,
  dependency_type
})
