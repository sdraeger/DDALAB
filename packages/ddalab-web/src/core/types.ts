// The JSON the wasm ABI (packages/ddalab-wasm/src/lib.rs) takes and returns, as the Rust serde types write it.
// Field names stay snake_case. A field the Rust side skips when `None` is optional here.

export interface VariantInfo {
  abbreviation: string;
  name: string;
  position: number;
  output_suffix: string;
  stride: number;
  reserved: boolean;
  channel_format: "individual" | "pairs" | "directed_pairs";
  output_columns: { coefficients: number; has_error: boolean };
  documentation: string;
}

export interface EngineVersion {
  engine_version: string;
  git_commit: string | null;
  variants: VariantInfo[];
}

export interface OpenRequest {
  primary: string;
  files: { name: string; file_id: number; len: number }[];
  sample_rate_hz?: number;
}

export type RawType = "I16" | "I24" | "I32" | "F32" | "F64";
export type ChannelKind = "Signal" | "Annotation" | "Status" | "Other";

/** Physical value = `raw * gain + offset`, in SI units. */
export interface ChannelInfo {
  label: string;
  unit: string;
  sample_rate_hz: number;
  gain: number;
  offset: number;
  kind: ChannelKind;
  bids_status: string | null;
  bids_type: string | null;
}

export interface Annotation {
  onset_s: number;
  duration_s: number;
  label: string;
  source: string;
}

export interface RecordingInfo {
  format: string;
  channels: ChannelInfo[];
  sample_rate_hz: number;
  /** Samples per channel at `sample_rate_hz`. */
  sample_count: number;
  duration_s: number;
  raw_type: RawType;
  annotations: Annotation[];
  warnings: string[];
  input_files: string[];
}

export interface Opened {
  handle: number;
  info: RecordingInfo;
  /** Indices into `info.channels` of the display channels; request channel indices count in this list. */
  analysis_channels: number[];
}

export type CcdConditioningStrategy =
  | "all_selected"
  | "auto_target_sparse"
  | "auto_shared_parents"
  | "auto_group_omp";

export interface VariantChannelConfig {
  selected_channels?: number[];
  ct_channel_pairs?: [number, number][];
  cd_channel_pairs?: [number, number][];
  conditioning_channels?: number[];
  conditioning_strategy?: CcdConditioningStrategy;
  surrogate_shifts?: number[];
  temporal_lambda?: number;
  max_active_sources?: number;
}

export interface DDARequest {
  file_path: string;
  /** Indices into the display channels. */
  channels?: number[] | null;
  time_range: { start: number; end: number };
  preprocessing_options: { highpass: number | null; lowpass: number | null };
  algorithm_selection: {
    enabled_variants: string[];
    /** "ST CT CD RESERVED DE SY" as six 0/1 digits separated by spaces. */
    select_mask?: string;
  };
  window_parameters: {
    window_length: number;
    window_step: number;
    ct_window_length?: number;
    ct_window_step?: number;
  };
  delay_parameters: { delays: number[] };
  ct_channel_pairs?: [number, number][];
  cd_channel_pairs?: [number, number][];
  model_parameters?: { dm: number; order: number; nr_tau: number };
  model_terms?: number[];
  variant_configs?: Record<string, VariantChannelConfig>;
  sampling_rate?: number;
}

/** Windows `w0..w1` of a request and the recording rows `row0..row1` they read. */
export interface Block {
  w0: number;
  w1: number;
  row0: number;
  row1: number;
}

export interface BundleLayout {
  arrays: { path: string; shape: number[]; header: number[] }[];
}

export interface Plan {
  blocks: Block[];
  layout: BundleLayout;
  windows: number;
}

/** The block's bytes of each bundle array (`array` indexes `layout.arrays`), at their file `offset`s. */
export interface BlockChunks {
  chunks: { array: number; offset: number; bytes: ArrayBuffer }[];
}

export interface Reproduction {
  expert_mode: boolean;
  compute_device: string;
  variant_ids: string[];
  selected_channel_indices: number[];
  selected_channel_names: string[];
  variant_channel_indices: Record<string, number[]>;
  variant_channel_names: Record<string, string[]>;
  variant_pair_indices: Record<string, [number, number][]>;
  variant_pair_names: Record<string, string[]>;
  window_length_samples: number;
  window_step_samples: number;
  delays: number[];
  model_terms: number[];
  model_dimension: number;
  polynomial_order: number;
  nr_tau: number;
  start_time_seconds: number;
  end_time_seconds: number;
  ddalab_version: string;
  input_sha256: Record<string, string>;
  engine_version: string;
  git_commit: string | null;
  request: DDARequest;
}

export interface VariantDocument {
  id: string;
  label: string;
  row_labels: string[];
  /** `[row][window]`; a non-finite value is `null`. */
  matrix: (number | null)[][];
  min_value: number | null;
  max_value: number | null;
  row_mean_absolute: number[] | null;
  row_peak_absolute: number[] | null;
  coefficient_matrices: (number | null)[][][] | null;
  fit_error_matrix: (number | null)[][] | null;
  /** The bundle files holding this variant's arrays. */
  arrays?: string[];
}

export interface ResultDocument {
  schema: string;
  id: string;
  file_name: string;
  created_at_iso: string;
  diagnostics: string[];
  window_centers_seconds: number[];
  variants: VariantDocument[];
  reproduction: Reproduction;
}

export interface ManifestExtras {
  id: string;
  created_at_iso: string;
  input_sha256: Record<string, string>;
  windows: number;
}

/** A progress report of the engine, within one block. */
export interface Progress {
  stage_id: string;
  stage_label: string;
  step_index: number;
  total_steps: number;
  window_index: number;
  total_windows: number;
  item_index: number;
  total_items: number;
  item_kind: string;
  item_label: string;
}
