/**
 * Frontend types for real-time data streaming and DDA processing
 *
 * These types mirror the Rust backend streaming types and provide
 * TypeScript interfaces for the streaming feature.
 */

// ====================================================================
// Stream Sources
// ====================================================================

export type StreamSourceType = "websocket" | "tcp" | "udp" | "serial" | "file";

export interface WebSocketSourceConfig {
  type: "websocket";
  url: string;
  headers?: Record<string, string>;
  reconnect: boolean;
}

export interface TcpSourceConfig {
  type: "tcp";
  host: string;
  port: number;
}

export interface UdpSourceConfig {
  type: "udp";
  bind_address: string;
  port: number;
}

export interface SerialSourceConfig {
  type: "serial";
  port: string;
  baud_rate: number;
}

export interface FileSourceConfig {
  type: "file";
  path: string;
  chunk_size: number;
  rate_limit_ms?: number;
  loop_playback: boolean;
}

export type StreamSourceConfig =
  | WebSocketSourceConfig
  | TcpSourceConfig
  | UdpSourceConfig
  | SerialSourceConfig
  | FileSourceConfig;

// ====================================================================
// Stream State
// ====================================================================

export type StreamState =
  | { type: "Idle" }
  | { type: "Connecting" }
  | {
      type: "Running";
      data: {
        started_at: number;
        chunks_received: number;
        results_generated: number;
      };
    }
  | { type: "Paused"; data: { paused_at: number } }
  | { type: "Error"; data: { message: string } }
  | { type: "Stopped" };

// ====================================================================
// DDA Configuration
// ====================================================================

export interface WindowParameters {
  window_length: number;
  window_step: number;
  ct_window_length?: number;
  ct_window_step?: number;
}

export interface ScaleParameters {
  scale_min: number;
  scale_max: number;
  scale_num: number;
  delay_list?: number[];
}

export interface AlgorithmSelection {
  enabled_variants: string[];
  select_mask?: string;
}

export interface ModelParameters {
  // Expert mode model parameters
  [key: string]: any;
}

export interface StreamingDDAConfig {
  window_size: number;
  window_overlap: number;
  window_parameters: WindowParameters;
  scale_parameters: ScaleParameters;
  algorithm_selection: AlgorithmSelection;
  model_parameters?: ModelParameters;
  include_q_matrices: boolean;
  selected_channels?: number[];
}

// ====================================================================
// Data Chunks
// ====================================================================

export interface DataChunk {
  samples: number[][]; // [channels][samples]
  timestamp: number;
  sample_rate: number;
  channel_names: string[];
  sequence?: number;
}

// ====================================================================
// DDA Results
// ====================================================================

export interface VariantSummary {
  variant_id: string;
  variant_name: string;
  mean: number;
  std_dev: number;
  min: number;
  max: number;
  num_channels: number;
  num_timepoints: number;
}

export interface StreamingDDAResult {
  id: string;
  timestamp: number;
  window_start: number;
  window_end: number;
  num_samples: number;
  variant_summaries: Record<string, VariantSummary>;
  q_matrices?: Record<string, number[][]>;
  processing_time_ms: number;
}

// ====================================================================
// Stream Statistics
// ====================================================================

export interface StreamStats {
  chunks_received: number;
  chunks_processed: number;
  results_generated: number;
  data_buffer_size: number;
  result_buffer_size: number;
  total_samples_received: number;
  avg_processing_time_ms: number;
  uptime_seconds: number;
}

// ====================================================================
// Stream Events
// ====================================================================

export type StreamEvent =
  | {
      type: "state_changed";
      stream_id: string;
      state: StreamState;
    }
  | {
      type: "data_received";
      stream_id: string;
      chunks_count: number;
    }
  | {
      type: "results_ready";
      stream_id: string;
      results_count: number;
    }
  | {
      type: "error";
      stream_id: string;
      error: string;
    }
  | {
      type: "stats_update";
      stream_id: string;
      stats: StreamStats;
    };

// ====================================================================
// Stream Session
// ====================================================================

export interface StreamSession {
  id: string;
  source_config: StreamSourceConfig;
  dda_config: StreamingDDAConfig;
  state: StreamState;
  stats: StreamStats;
  created_at: number;
  updated_at: number;
}

// ====================================================================
// Request/Response Types
// ====================================================================

export interface StartStreamRequest {
  source_config: StreamSourceConfig;
  dda_config: StreamingDDAConfig;
  data_buffer_capacity?: number;
  result_buffer_capacity?: number;
  processing_batch_size?: number;
  processing_interval_ms?: number;
}

export interface StreamIdResponse {
  stream_id: string;
}

// ====================================================================
// UI State Types
// ====================================================================

export interface StreamPlotData {
  /**
   * Ring buffer of recent data chunks for live plotting
   * Only keeps last N chunks to prevent memory growth
   */
  dataChunks: DataChunk[];

  /**
   * Ring buffer of recent DDA results for heatmap plotting
   * Only keeps last N results to prevent memory growth
   */
  ddaResults: StreamingDDAResult[];

  /**
   * Max number of items to keep in each buffer
   */
  maxBufferSize: number;
}

/**
 * History entry for recent streaming sources
 */
export interface StreamSourceHistory {
  id: string;
  sourceConfig: StreamSourceConfig;
  ddaConfig: StreamingDDAConfig;
  timestamp: number;
  displayName: string; // User-friendly name for the source
}

export interface StreamUIState {
  /**
   * Whether the stream configuration dialog is open
   */
  isConfigDialogOpen: boolean;

  /**
   * Currently selected stream (for viewing details)
   */
  selectedStreamId: string | null;

  /**
   * Auto-scroll to latest data in plots
   */
  autoScroll: boolean;

  /**
   * Show DDA heatmap alongside time series
   */
  showHeatmap: boolean;

  /**
   * Selected channels to display (null = all)
   */
  visibleChannels: string[] | null;

  /**
   * Time window for display (seconds)
   */
  displayWindowSeconds: number;

  /**
   * History of recent streaming sources (max 10)
   */
  recentSources: StreamSourceHistory[];
}
