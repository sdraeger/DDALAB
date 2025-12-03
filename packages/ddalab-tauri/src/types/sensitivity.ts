/**
 * Parameter Sensitivity Analysis Types
 *
 * Allows users to see how DDA results change with different parameter settings
 */

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

/** Base DDA parameters for sensitivity analysis */
export interface SensitivityBaseConfig {
  file_path: string;
  channels: string[];
  start_time: number;
  end_time: number;
  variants: string[];
  window_length: number;
  window_step: number;
  delay_list: number[]; // Explicit list of delay values
}

export interface SensitivityConfig {
  /** Base DDA parameters to start from */
  baseConfig: SensitivityBaseConfig;
  /** Parameters to sweep */
  sweepParameters: ParameterRange[];
  /** Maximum concurrent analyses */
  maxConcurrent?: number;
}

export interface SensitivityResult {
  /** Parameter values used for this run (only includes varied parameters) */
  parameterValues: Partial<Record<SweepParameter, number>>;
  /** Summary statistics for each variant */
  variantResults: {
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
  }[];
  /** Analysis duration in ms */
  duration_ms: number;
  /** Any errors encountered */
  error?: string;
}

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

export interface SensitivitySummary {
  /** Parameter that was varied */
  parameter: SweepParameter;
  /** How much results changed when this parameter varied */
  sensitivity_score: number;
  /** Correlation between parameter value and mean Q */
  correlation: number;
  /** Parameter value that gave optimal results */
  optimal_value: number;
  /** Variance in results across parameter range */
  result_variance: number;
}

export interface SensitivityReport {
  analysis_id: string;
  /** Overall sensitivity rankings */
  parameter_rankings: SensitivitySummary[];
  /** Recommended parameter values */
  recommendations: {
    parameter: SweepParameter;
    recommended_value: number;
    reason: string;
  }[];
  /** Stability assessment */
  stability: {
    is_stable: boolean;
    stability_score: number;
    unstable_parameters: SweepParameter[];
  };
}

/** Predefined sensitivity presets */
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

/** Default parameter ranges for sensitivity analysis */
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
