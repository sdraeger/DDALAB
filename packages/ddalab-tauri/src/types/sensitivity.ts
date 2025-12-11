/**
 * Parameter Sensitivity Analysis Types
 *
 * Allows users to run DDA with multiple explicit parameter configurations
 * to understand how results change with different settings.
 */

/** DDA model parameters for sensitivity analysis */
export interface DDAModelParams {
  /** Window length in samples */
  window_length: number;
  /** Window step in samples */
  window_step: number;
  /** Explicit list of delay values (tau) */
  delays: number[];
  /** Model dimension (dm parameter) */
  model_dimension?: number;
  /** Polynomial order */
  polynomial_order?: number;
  /** Number of tau values (nr_tau) */
  nr_tau?: number;
}

/** A single parameter configuration set to test */
export interface ParameterSet {
  /** Unique identifier for this parameter set */
  id: string;
  /** Human-readable name/description */
  name: string;
  /** The DDA parameters to use */
  params: DDAModelParams;
}

/** Base configuration for sensitivity analysis (file, channels, time range) */
export interface SensitivityBaseConfig {
  file_path: string;
  channels: string[];
  start_time: number;
  end_time: number;
  variants: string[];
}

/** Configuration for running sensitivity analysis */
export interface SensitivityConfig {
  /** Base configuration (file, channels, time range, variants) */
  baseConfig: SensitivityBaseConfig;
  /** Parameter sets to evaluate */
  parameterSets: ParameterSet[];
  /** Maximum concurrent analyses */
  maxConcurrent?: number;
}

/** Result statistics for a single variant */
export interface VariantResultStats {
  variant_id: string;
  variant_name: string;
  /** Mean Q value across all channels */
  mean_q: number;
  /** Standard deviation of Q values */
  std_q: number;
  /** Min Q value */
  min_q: number;
  /** Max Q value */
  max_q: number;
  /** Per-channel mean Q values */
  channel_means: Record<string, number>;
}

/** Result of running a single parameter set */
export interface SensitivityResult {
  /** Parameter set ID */
  parameter_set_id: string;
  /** Parameter set name */
  parameter_set_name: string;
  /** Parameters used */
  params: DDAModelParams;
  /** Results for each variant */
  variantResults: VariantResultStats[];
  /** Analysis duration in ms */
  duration_ms: number;
  /** Any errors encountered */
  error?: string;
}

/** Overall sensitivity analysis state */
export interface SensitivityAnalysis {
  id: string;
  config: SensitivityConfig;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  results: SensitivityResult[];
  created_at: string;
  completed_at?: string;
  error?: string;
}

/** Comparison of parameter sets for a specific metric */
export interface ParameterComparison {
  parameter_set_id: string;
  parameter_set_name: string;
  params: DDAModelParams;
  mean_q: number;
  std_q: number;
}

/** Sensitivity analysis report */
export interface SensitivityReport {
  analysis_id: string;
  /** Comparison across all parameter sets */
  comparisons: ParameterComparison[];
  /** Best performing parameter set */
  best_params: ParameterSet | null;
  /** Summary statistics */
  summary: {
    /** Mean Q across all parameter sets */
    overall_mean_q: number;
    /** Variance in Q across parameter sets */
    variance_across_sets: number;
    /** Is performance stable across parameter sets? */
    is_stable: boolean;
  };
}

/** Predefined parameter set templates */
export const PARAMETER_SET_TEMPLATES: Record<string, DDAModelParams> = {
  default: {
    window_length: 100,
    window_step: 10,
    delays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    model_dimension: 4,
    polynomial_order: 4,
    nr_tau: 2,
  },
  short_window: {
    window_length: 50,
    window_step: 5,
    delays: [1, 2, 3, 4, 5],
    model_dimension: 4,
    polynomial_order: 4,
    nr_tau: 2,
  },
  long_window: {
    window_length: 200,
    window_step: 20,
    delays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20],
    model_dimension: 4,
    polynomial_order: 4,
    nr_tau: 2,
  },
  fine_delays: {
    window_length: 100,
    window_step: 10,
    delays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    model_dimension: 4,
    polynomial_order: 4,
    nr_tau: 2,
  },
  coarse_delays: {
    window_length: 100,
    window_step: 10,
    delays: [2, 5, 10, 15, 20],
    model_dimension: 4,
    polynomial_order: 4,
    nr_tau: 2,
  },
};

// ============================================================================
// Legacy types for backward compatibility
// ============================================================================

export type SweepParameter =
  | "window_length"
  | "window_step"
  | "delay_min"
  | "delay_max"
  | "delay_num";

export interface ParameterRange {
  parameter: SweepParameter;
  min: number;
  max: number;
  steps: number;
}

export interface SensitivitySummary {
  parameter: SweepParameter;
  sensitivity_score: number;
  correlation: number;
  optimal_value: number;
  result_variance: number;
}

export const SENSITIVITY_PRESETS = {
  quick: {
    name: "Quick Scan",
    description: "Fast analysis with fewer parameter variations",
    steps: 3,
  },
  standard: {
    name: "Standard",
    description: "Balanced analysis with moderate parameter variations",
    steps: 5,
  },
  thorough: {
    name: "Thorough",
    description: "Comprehensive analysis with many parameter variations",
    steps: 10,
  },
} as const;

export const DEFAULT_PARAMETER_RANGES: Record<
  SweepParameter,
  { min: number; max: number; description: string }
> = {
  window_length: {
    min: 32,
    max: 256,
    description: "Window length in samples",
  },
  window_step: {
    min: 5,
    max: 50,
    description: "Step between windows",
  },
  delay_min: {
    min: 1,
    max: 5,
    description: "Minimum delay parameter (tau)",
  },
  delay_max: {
    min: 10,
    max: 50,
    description: "Maximum delay parameter (tau)",
  },
  delay_num: {
    min: 10,
    max: 40,
    description: "Number of delays",
  },
};
