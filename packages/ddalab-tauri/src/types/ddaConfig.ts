/**
 * .ddalab file format specification
 * Version 1.0.0
 */

export interface DDALabFileFormat {
  // Format metadata
  version: string; // Semantic version (e.g., "1.0.0")
  created_at: string; // ISO 8601 timestamp
  application_version: string; // DDALAB version that created this file

  // Analysis metadata
  analysis_name: string;
  description?: string;

  // Source file information
  source_file: {
    file_path: string; // Original file path (for reference)
    file_name: string;
    file_hash: string; // BLAKE3 hash for file verification
    duration: number; // seconds
    sample_rate: number; // Hz
    total_samples: number;
  };

  // Complete DDA parameters
  parameters: {
    // Selected DDA variants
    variants: string[];

    // Window parameters (in samples)
    window_length: number;
    window_step: number;

    // Delay configuration
    delay_config: {
      mode: "range" | "list";
      min?: number; // samples
      max?: number; // samples
      num?: number;
      list?: number[]; // samples
    };

    // Channel configuration by variant type
    st_channels?: string[]; // For single_timeseries variant
    ct_channel_pairs?: Array<{
      // For cross_timeseries variant
      source: string;
      target: string;
    }>;
    cd_channel_pairs?: Array<{
      // For cross_dynamical variant
      source: string;
      target: string;
    }>;

    // CT-specific parameters (in samples)
    ct_parameters?: {
      ct_delay_min: number;
      ct_delay_max: number;
      ct_delay_step: number;
      ct_window_min: number;
      ct_window_max: number;
      ct_window_step: number;
    };

    // Additional parameters
    additional_parameters?: Record<string, any>;
  };

  // Optional: Include results for comparison/validation
  results?: {
    analysis_id: string;
    execution_time_ms: number;
    results_summary: any; // Compact summary of results
  };
}

export interface DDAConfigValidation {
  valid: boolean;
  warnings: string[];
  errors: string[];
  compatibility: {
    file_match: boolean; // Same file as original
    duration_compatible: boolean;
    channels_compatible: boolean;
    sample_rate_match: boolean;
  };
}

export interface DDAConfigImportResult {
  config: DDALabFileFormat;
  validation: DDAConfigValidation;
}
