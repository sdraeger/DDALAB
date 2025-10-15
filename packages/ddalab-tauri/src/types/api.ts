// Types for DDALAB API responses and requests

export interface EDFFileInfo {
  file_path: string
  file_name: string
  file_size: number
  duration: number
  sample_rate: number
  channels: string[]
  total_samples: number
  start_time: string
  end_time: string
  annotations_count?: number
}

export interface ChunkData {
  data: number[][]
  channels: string[]
  timestamps: number[]
  sample_rate: number
  chunk_start: number
  chunk_size: number
  file_path: string
}

export interface Annotation {
  id?: string
  file_path: string
  channel?: string
  start_time: number
  end_time?: number
  label: string
  description?: string
  annotation_type: 'seizure' | 'artifact' | 'marker' | 'clinical' | 'custom'
  created_at?: string
  created_by?: string
}

export interface DDAAnalysisRequest {
  file_path: string
  channels: string[]
  start_time: number
  end_time: number
  variants: string[]
  window_length?: number
  window_step?: number
  detrending?: 'linear' | 'polynomial' | 'none'
  scale_min?: number
  scale_max?: number
  scale_num?: number
}

export interface DDAVariantResult {
  variant_id: string
  variant_name: string
  dda_matrix: Record<string, number[]>
  exponents: Record<string, number>
  quality_metrics: Record<string, number>
}

export interface DDAResult {
  id: string
  name?: string
  file_path: string
  channels: string[]
  parameters: DDAAnalysisRequest
  results: {
    scales: number[]
    variants: DDAVariantResult[]
    // Legacy fields for backward compatibility
    dda_matrix?: Record<string, number[]>
    exponents?: Record<string, number>
    quality_metrics?: Record<string, number>
  }
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  completed_at?: string
  error_message?: string
}

export interface HealthResponse {
  status: string
  version: string
  timestamp: string
}

// DDA Progress Event Types
export type DDAProgressPhase =
  | 'initializing'
  | 'loading_data'
  | 'preprocessing'
  | 'computing'
  | 'completed'
  | 'error'

export interface DDAProgressEvent {
  analysis_id: string
  phase: DDAProgressPhase
  progress_percent: number
  current_step?: string
  estimated_time_remaining_seconds?: number
  error_message?: string
}
