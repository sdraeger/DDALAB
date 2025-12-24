// TypeScript types matching Rust structs in src-tauri/src/recording/

/**
 * File types supported for workflow actions
 */
export type FileType = "EDF" | "ASCII" | "CSV";

/**
 * Export formats for results
 */
export type ExportFormat = "CSV" | "JSON" | "MAT";

/**
 * Plot types that can be generated
 */
export type PlotType = "Heatmap" | "TimeSeries" | "StatisticalSummary";

/**
 * Options for plot generation
 */
export interface PlotOptions {
  title?: string;
  colormap?: string;
  normalize: boolean;
}

/**
 * Rereferencing schemes for preprocessing
 */
export type ReferencingScheme =
  | { type: "AverageReference" }
  | { type: "LinkedMastoid" }
  | { type: "Laplacian" }
  | { type: "Custom"; reference_channels: number[] };

/**
 * Preprocessing configuration
 */
export interface PreprocessingConfig {
  highpass?: number;
  lowpass?: number;
  notch?: number[];
  rereferencing?: ReferencingScheme;
}

/**
 * Data transformation types
 */
export type TransformType =
  | { type: "Normalize" }
  | { type: "BandpassFilter"; low_freq: number; high_freq: number }
  | { type: "Decimate"; factor: number }
  | { type: "Resample"; target_rate: number }
  | { type: "BaselineCorrection"; start: number; end: number };

/**
 * Annotation types
 */
export type AnnotationType =
  | "TimeSeriesMarker"
  | "Region"
  | "Event"
  | "ArtifactMarker";

/**
 * Annotation details
 */
export interface AnnotationDetails {
  time?: number;
  start_time?: number;
  end_time?: number;
  label: string;
  description?: string;
  channel?: string;
}

/**
 * Workflow actions that can be recorded
 * Matches Rust enum WorkflowAction with serde tag/content
 */
export type WorkflowAction =
  // Data Loading & Management
  | {
      type: "LoadFile";
      data: {
        path: string;
        file_type: FileType;
      };
    }
  | {
      type: "CloseFile";
      data: {
        file_id: string;
      };
    }
  | {
      type: "SwitchActiveFile";
      data: {
        file_id: string;
      };
    }
  // Channel Operations
  | {
      type: "SelectChannels";
      data: {
        channel_indices: number[];
      };
    }
  | {
      type: "DeselectChannels";
      data: {
        channel_indices: number[];
      };
    }
  | {
      type: "SelectAllChannels";
    }
  | {
      type: "ClearChannelSelection";
    }
  | {
      type: "FilterChannels";
      data: {
        input_id: string;
        channel_indices: number[];
      };
    }
  // Time Window Operations
  | {
      type: "SetTimeWindow";
      data: {
        start: number;
        end: number;
      };
    }
  | {
      type: "SetChunkWindow";
      data: {
        chunk_start: number;
        chunk_size: number;
      };
    }
  // Preprocessing
  | {
      type: "ApplyPreprocessing";
      data: {
        input_id: string;
        preprocessing: PreprocessingConfig;
      };
    }
  // DDA Configuration & Execution (CORRECTED PARAMETERS)
  | {
      type: "SetDDAParameters";
      data: {
        window_length: number;
        window_step: number;
        ct_window_length?: number;
        ct_window_step?: number;
      };
    }
  | {
      type: "SelectDDAVariants";
      data: {
        variants: string[];
      };
    }
  | {
      type: "SetDelayList";
      data: {
        delays: number[];
      };
    }
  | {
      type: "SetModelParameters";
      data: {
        dm: number;
        order: number;
        nr_tau: number;
        encoding: number[];
      };
    }
  | {
      type: "RunDDAAnalysis";
      data: {
        input_id: string;
        channel_selection: number[];
        ct_channel_pairs?: [number, number][];
        cd_channel_pairs?: [number, number][];
      };
    }
  // Annotations
  | {
      type: "AddAnnotation";
      data: {
        annotation_type: AnnotationType;
        details: AnnotationDetails;
      };
    }
  | {
      type: "RemoveAnnotation";
      data: {
        annotation_id: string;
      };
    }
  // Data Transformations
  | {
      type: "TransformData";
      data: {
        input_id: string;
        transform_type: TransformType;
      };
    }
  // Visualization & Export
  | {
      type: "GeneratePlot";
      data: {
        result_id: string;
        plot_type: PlotType;
        options: PlotOptions;
      };
    }
  | {
      type: "ExportResults";
      data: {
        result_id: string;
        format: ExportFormat;
        path: string;
      };
    }
  | {
      type: "ExportPlot";
      data: {
        plot_type: PlotType;
        format: string;
        path: string;
      };
    }
  // Analysis Results Management
  | {
      type: "SaveAnalysisResult";
      data: {
        result_id: string;
        name: string;
      };
    }
  | {
      type: "LoadAnalysisFromHistory";
      data: {
        result_id: string;
      };
    }
  | {
      type: "CompareAnalyses";
      data: {
        result_ids: string[];
      };
    };

/**
 * Metadata for a workflow node
 */
export interface NodeMetadata {
  description?: string;
  tags: string[];
  user_notes?: string;
}

/**
 * A node in the workflow graph
 */
export interface WorkflowNode {
  id: string;
  action: WorkflowAction;
  timestamp: string; // ISO 8601 datetime string
  metadata: NodeMetadata;
}

/**
 * Dependency types between workflow nodes
 */
export type DependencyType =
  | "DataDependency"
  | "ParameterDependency"
  | "OrderDependency";

/**
 * An edge in the workflow graph connecting two nodes
 */
export interface WorkflowEdge {
  source: string;
  target: string;
  dependency_type: DependencyType;
}

/**
 * Metadata for the entire workflow
 */
export interface WorkflowMetadata {
  name: string;
  description?: string;
  created_at: string; // ISO 8601 datetime string
  modified_at: string; // ISO 8601 datetime string
  version: string;
}

/**
 * Information about a workflow graph
 */
export interface WorkflowInfo {
  node_count: number;
  edge_count: number;
  metadata: WorkflowMetadata;
}

/**
 * Detailed information about a specific node including its dependencies
 */
export interface NodeInfo {
  id: string;
  action: WorkflowAction;
  timestamp: string; // ISO 8601 datetime string
  dependencies: string[]; // Node IDs that this node depends on
  dependents: string[]; // Node IDs that depend on this node
}

/**
 * Workflow export/import format
 */
export interface WorkflowExport {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata: WorkflowMetadata;
}

/**
 * Buffered action with recording context
 */
export interface BufferedAction {
  action: WorkflowAction;
  timestamp: string; // ISO 8601 datetime string
  active_file_id?: string;
  auto_generated: boolean;
}

/**
 * Helper functions to create workflow actions
 */

// Data Loading & Management
export const createLoadFileAction = (
  path: string,
  file_type: FileType,
): WorkflowAction => ({
  type: "LoadFile",
  data: { path, file_type },
});

export const createCloseFileAction = (file_id: string): WorkflowAction => ({
  type: "CloseFile",
  data: { file_id },
});

export const createSwitchActiveFileAction = (
  file_id: string,
): WorkflowAction => ({
  type: "SwitchActiveFile",
  data: { file_id },
});

// Channel Operations
export const createSelectChannelsAction = (
  channel_indices: number[],
): WorkflowAction => ({
  type: "SelectChannels",
  data: { channel_indices },
});

export const createDeselectChannelsAction = (
  channel_indices: number[],
): WorkflowAction => ({
  type: "DeselectChannels",
  data: { channel_indices },
});

export const createSelectAllChannelsAction = (): WorkflowAction => ({
  type: "SelectAllChannels",
});

export const createClearChannelSelectionAction = (): WorkflowAction => ({
  type: "ClearChannelSelection",
});

export const createFilterChannelsAction = (
  input_id: string,
  channel_indices: number[],
): WorkflowAction => ({
  type: "FilterChannels",
  data: { input_id, channel_indices },
});

// Time Window Operations
export const createSetTimeWindowAction = (
  start: number,
  end: number,
): WorkflowAction => ({
  type: "SetTimeWindow",
  data: { start, end },
});

export const createSetChunkWindowAction = (
  chunk_start: number,
  chunk_size: number,
): WorkflowAction => ({
  type: "SetChunkWindow",
  data: { chunk_start, chunk_size },
});

// Preprocessing
export const createApplyPreprocessingAction = (
  input_id: string,
  preprocessing: PreprocessingConfig,
): WorkflowAction => ({
  type: "ApplyPreprocessing",
  data: { input_id, preprocessing },
});

// DDA Configuration & Execution (CORRECTED)
export const createSetDDAParametersAction = (
  window_length: number,
  window_step: number,
  ct_window_length?: number,
  ct_window_step?: number,
): WorkflowAction => ({
  type: "SetDDAParameters",
  data: { window_length, window_step, ct_window_length, ct_window_step },
});

export const createSelectDDAVariantsAction = (
  variants: string[],
): WorkflowAction => ({
  type: "SelectDDAVariants",
  data: { variants },
});

export const createSetDelayListAction = (delays: number[]): WorkflowAction => ({
  type: "SetDelayList",
  data: { delays },
});

export const createSetModelParametersAction = (
  dm: number,
  order: number,
  nr_tau: number,
  encoding: number[],
): WorkflowAction => ({
  type: "SetModelParameters",
  data: { dm, order, nr_tau, encoding },
});

export const createRunDDAAnalysisAction = (
  input_id: string,
  channel_selection: number[],
  ct_channel_pairs?: [number, number][],
  cd_channel_pairs?: [number, number][],
): WorkflowAction => ({
  type: "RunDDAAnalysis",
  data: { input_id, channel_selection, ct_channel_pairs, cd_channel_pairs },
});

// Annotations
export const createAddAnnotationAction = (
  annotation_type: AnnotationType,
  details: AnnotationDetails,
): WorkflowAction => ({
  type: "AddAnnotation",
  data: { annotation_type, details },
});

export const createRemoveAnnotationAction = (
  annotation_id: string,
): WorkflowAction => ({
  type: "RemoveAnnotation",
  data: { annotation_id },
});

// Data Transformations
export const createTransformDataAction = (
  input_id: string,
  transform_type: TransformType,
): WorkflowAction => ({
  type: "TransformData",
  data: { input_id, transform_type },
});

// Visualization & Export
export const createGeneratePlotAction = (
  result_id: string,
  plot_type: PlotType,
  options: PlotOptions,
): WorkflowAction => ({
  type: "GeneratePlot",
  data: { result_id, plot_type, options },
});

export const createExportResultsAction = (
  result_id: string,
  format: ExportFormat,
  path: string,
): WorkflowAction => ({
  type: "ExportResults",
  data: { result_id, format, path },
});

export const createExportPlotAction = (
  plot_type: PlotType,
  format: string,
  path: string,
): WorkflowAction => ({
  type: "ExportPlot",
  data: { plot_type, format, path },
});

// Analysis Results Management
export const createSaveAnalysisResultAction = (
  result_id: string,
  name: string,
): WorkflowAction => ({
  type: "SaveAnalysisResult",
  data: { result_id, name },
});

export const createLoadAnalysisFromHistoryAction = (
  result_id: string,
): WorkflowAction => ({
  type: "LoadAnalysisFromHistory",
  data: { result_id },
});

export const createCompareAnalysesAction = (
  result_ids: string[],
): WorkflowAction => ({
  type: "CompareAnalyses",
  data: { result_ids },
});

/**
 * Helper to create a workflow node with default metadata
 */
export const createWorkflowNode = (
  id: string,
  action: WorkflowAction,
  metadata?: Partial<NodeMetadata>,
): WorkflowNode => ({
  id,
  action,
  timestamp: new Date().toISOString(),
  metadata: {
    description: metadata?.description,
    tags: metadata?.tags || [],
    user_notes: metadata?.user_notes,
  },
});

/**
 * Helper to create a workflow edge
 */
export const createWorkflowEdge = (
  source: string,
  target: string,
  dependency_type: DependencyType,
): WorkflowEdge => ({
  source,
  target,
  dependency_type,
});
