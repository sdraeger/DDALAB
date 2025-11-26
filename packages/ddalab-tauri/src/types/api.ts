// Types for DDALAB API responses and requests

export interface EDFFileInfo {
  file_path: string;
  file_name: string;
  file_size: number;
  duration: number;
  sample_rate: number;
  channels: string[];
  total_samples: number;
  start_time: string;
  end_time: string;
  annotations_count?: number;
  /** True if file is a git-annex placeholder that hasn't been downloaded */
  is_annex_placeholder?: boolean;
}

export interface ChunkData {
  data: number[][];
  channels: string[];
  timestamps: number[];
  sample_rate: number;
  chunk_start: number;
  chunk_size: number;
  file_path: string;
}

export interface Annotation {
  id?: string;
  file_path: string;
  channel?: string;
  start_time: number;
  end_time?: number;
  label: string;
  description?: string;
  annotation_type: "seizure" | "artifact" | "marker" | "clinical" | "custom";
  created_at?: string;
  created_by?: string;
}

export interface DDAVariantConfig {
  // For individual channel variants (ST, DE, SY)
  selectedChannels?: number[]; // Channel indices (camelCase from backend)
  // For pair-based variants (CT)
  ctChannelPairs?: [number, number][]; // Bidirectional channel pairs (camelCase from backend)
  // For directed pair variants (CD)
  cdChannelPairs?: [number, number][]; // Directed channel pairs (from -> to) (camelCase from backend)
  // Future: add any variant-specific options here (preprocessing, window params, etc.)
}

export interface DDAAnalysisRequest {
  file_path: string;
  channels: string[]; // Legacy: all channels (union of all variant channels)
  start_time: number;
  end_time: number;
  variants: string[];
  window_length?: number;
  window_step?: number;
  scale_min?: number;
  scale_max?: number;
  scale_num?: number;
  delay_list?: number[]; // Explicit list of delay values (overrides scale_min/max/num if provided)
  // CT-specific parameters (legacy - use variant_configs instead)
  ct_window_length?: number;
  ct_window_step?: number;
  ct_channel_pairs?: [number, number][]; // Array of channel index pairs (legacy)
  // CD-specific parameters (legacy - use variant_configs instead)
  cd_channel_pairs?: [number, number][]; // Array of directed channel pairs (legacy)
  // Expert mode parameters
  model_dimension?: number; // Model dimension (dm parameter, default: 4)
  polynomial_order?: number; // Polynomial order (order parameter, default: 4)
  nr_tau?: number; // Number of tau values (nr_tau parameter, default: 2)
  model_params?: number[]; // MODEL parameter encoding (selected polynomial terms)
  // NEW: Per-variant configuration (extensible for future options)
  variant_configs?: {
    [variantId: string]: DDAVariantConfig;
  };
}

// Network motif types for CD-DDA visualization
export interface NetworkEdge {
  from: number;
  to: number;
  weight: number;
}

export interface AdjacencyMatrix {
  index: number;
  delay: number;
  matrix: number[];
  edges: NetworkEdge[];
}

export interface NetworkMotifData {
  num_nodes: number;
  node_labels: string[];
  adjacency_matrices: AdjacencyMatrix[];
  delay_values: number[];
}

export interface DDAVariantResult {
  variant_id: string;
  variant_name: string;
  dda_matrix: Record<string, number[]>;
  exponents: Record<string, number>;
  quality_metrics: Record<string, number>;
  network_motifs?: NetworkMotifData; // Network motif data for CD-DDA
}

export interface DDAResult {
  id: string;
  name?: string;
  file_path: string;
  channels: string[];
  parameters: DDAAnalysisRequest;
  results: {
    scales: number[];
    variants: DDAVariantResult[];
    // Legacy fields for backward compatibility
    dda_matrix?: Record<string, number[]>;
    exponents?: Record<string, number>;
    quality_metrics?: Record<string, number>;
  };
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  completed_at?: string;
  error_message?: string;
  source?: "local" | "nsg"; // Source of the analysis results
}

export interface HealthResponse {
  status: string;
  version: string;
  timestamp: string;
}

// DDA Progress Event Types
export type DDAProgressPhase =
  | "initializing"
  | "loading_data"
  | "preprocessing"
  | "computing"
  | "completed"
  | "error";

export interface DDAProgressEvent {
  analysis_id: string;
  phase: DDAProgressPhase;
  progress_percent: number;
  current_step?: string;
  estimated_time_remaining_seconds?: number;
  error_message?: string;
}
