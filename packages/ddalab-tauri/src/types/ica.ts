// Types for ICA (Independent Component Analysis) API

export interface ICAParametersRequest {
  n_components?: number;
  algorithm?: string;
  g_function?: string;
  max_iterations?: number;
  tolerance?: number;
  centering?: boolean;
  whitening?: boolean;
}

export interface ICAAnalysisRequest {
  file_path: string;
  channels?: number[];
  time_range?: {
    start: number;
    end: number;
  };
  parameters: ICAParametersRequest;
}

export interface PowerSpectrum {
  frequencies: number[];
  power: number[];
}

export interface ICAComponent {
  component_id: number;
  spatial_map: number[];
  time_series: number[];
  kurtosis: number;
  non_gaussianity: number;
  variance_explained: number;
  power_spectrum?: PowerSpectrum;
}

export interface ICAAnalysisResult {
  components: ICAComponent[];
  mixing_matrix: number[][];
  unmixing_matrix: number[][];
  channel_names: string[];
  sample_rate: number;
  n_samples: number;
  parameters: {
    n_components?: number;
    algorithm: string;
    g_function: string;
    max_iterations: number;
    tolerance: number;
    preprocessing: {
      centering: boolean;
      whitening: boolean;
    };
    random_seed?: number;
  };
  total_variance: number;
}

export interface ICAResult {
  id: string;
  name?: string;
  file_path: string;
  channels: string[];
  created_at: string;
  status: string;
  results: ICAAnalysisResult;
}

export interface ReconstructRequest {
  analysis_id: string;
  components_to_remove: number[];
}

export interface ReconstructedChannel {
  name: string;
  samples: number[];
}

export interface ReconstructResponse {
  channels: ReconstructedChannel[];
}

// Component classification for artifact detection
export type ArtifactType =
  | "eye_movement"
  | "muscle"
  | "line_noise"
  | "cardiac"
  | "electrode_noise"
  | "unknown";

export interface ComponentClassification {
  component_id: number;
  artifact_type?: ArtifactType;
  is_artifact: boolean;
  confidence: number;
}
