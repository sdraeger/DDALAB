/**
 * Zod schemas for runtime validation of API responses and Tauri commands
 * These schemas validate data at runtime to catch API contract violations early
 */

import { z } from "zod";

// ============================================================================
// Core Data Schemas
// ============================================================================

export const BIDSMetadataSchema = z.object({
  subject: z.string().optional(),
  session: z.string().optional(),
  task: z.string().optional(),
  run: z.string().optional(),
  modality: z.string().optional(),
});

export const EDFFileInfoSchema = z.object({
  file_path: z.string(),
  file_name: z.string(),
  file_size: z.number(),
  duration: z.number(),
  sample_rate: z.number(),
  channels: z.array(z.string()),
  total_samples: z.number(),
  start_time: z.string(),
  end_time: z.string(),
  annotations_count: z.number().optional(),
  is_annex_placeholder: z.boolean().optional(),
  bidsMetadata: BIDSMetadataSchema.optional(),
});

export const ChunkDataSchema = z.object({
  data: z.array(z.array(z.number())),
  channels: z.array(z.string()),
  timestamps: z.array(z.number()),
  sample_rate: z.number(),
  chunk_start: z.number(),
  chunk_size: z.number(),
  file_path: z.string(),
});

export const AnnotationTypeSchema = z.enum([
  "seizure",
  "artifact",
  "marker",
  "clinical",
  "custom",
]);

export const AnnotationSchema = z.object({
  id: z.string().optional(),
  file_path: z.string(),
  channel: z.string().optional(),
  start_time: z.number(),
  end_time: z.number().optional(),
  label: z.string(),
  description: z.string().optional(),
  annotation_type: AnnotationTypeSchema,
  created_at: z.string().optional(),
  created_by: z.string().optional(),
});

// ============================================================================
// DDA Analysis Schemas
// ============================================================================

export const DDAVariantConfigSchema = z.object({
  selectedChannels: z.array(z.number()).optional(),
  ctChannelPairs: z.array(z.tuple([z.number(), z.number()])).optional(),
  cdChannelPairs: z.array(z.tuple([z.number(), z.number()])).optional(),
});

export const DDAAnalysisRequestSchema = z.object({
  file_path: z.string(),
  channels: z.array(z.string()),
  start_time: z.number(),
  end_time: z.number(),
  variants: z.array(z.string()),
  window_length: z.number().optional(),
  window_step: z.number().optional(),
  delay_list: z.array(z.number()),
  ct_window_length: z.number().optional(),
  ct_window_step: z.number().optional(),
  ct_channel_pairs: z.array(z.tuple([z.number(), z.number()])).optional(),
  cd_channel_pairs: z.array(z.tuple([z.number(), z.number()])).optional(),
  model_dimension: z.number().optional(),
  polynomial_order: z.number().optional(),
  nr_tau: z.number().optional(),
  model_params: z.array(z.number()).optional(),
  variant_configs: z.record(z.string(), DDAVariantConfigSchema).optional(),
});

export const NetworkEdgeSchema = z.object({
  from: z.number(),
  to: z.number(),
  weight: z.number(),
});

export const AdjacencyMatrixSchema = z.object({
  index: z.number(),
  delay: z.number(),
  matrix: z.array(z.number()),
  edges: z.array(NetworkEdgeSchema),
});

export const NetworkMotifDataSchema = z.object({
  num_nodes: z.number(),
  node_labels: z.array(z.string()),
  adjacency_matrices: z.array(AdjacencyMatrixSchema),
  delay_values: z.array(z.number()),
});

export const DDAVariantResultSchema = z.object({
  variant_id: z.string(),
  variant_name: z.string(),
  dda_matrix: z.record(z.string(), z.array(z.number())),
  exponents: z.record(z.string(), z.number()),
  quality_metrics: z.record(z.string(), z.number()),
  network_motifs: NetworkMotifDataSchema.optional(),
});

export const DDAPlotDataSchema = z.object({
  heatmapData: z.array(z.array(z.number())).optional(),
  lineData: z.record(z.string(), z.array(z.number())).optional(),
  window_indices: z.array(z.number()).optional(),
  scales: z.array(z.number()).optional(), // deprecated, use window_indices
});

export const DDAStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);

export const DDAResultSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  file_path: z.string(),
  channels: z.array(z.string()),
  parameters: DDAAnalysisRequestSchema,
  results: z.object({
    window_indices: z.array(z.number()),
    scales: z.array(z.number()).optional(), // deprecated, use window_indices
    variants: z.array(DDAVariantResultSchema),
    dda_matrix: z.record(z.string(), z.array(z.number())).optional(),
    exponents: z.record(z.string(), z.number()).optional(),
    quality_metrics: z.record(z.string(), z.number()).optional(),
  }),
  status: DDAStatusSchema,
  created_at: z.string(),
  completed_at: z.string().optional(),
  error_message: z.string().optional(),
  source: z.enum(["local", "nsg"]).optional(),
  plot_data: DDAPlotDataSchema.nullish(),
});

export const DDAProgressPhaseSchema = z.enum([
  "initializing",
  "loading_data",
  "preprocessing",
  "computing",
  "completed",
  "error",
]);

export const DDAProgressEventSchema = z.object({
  analysis_id: z.string(),
  phase: DDAProgressPhaseSchema,
  progress_percent: z.number(),
  current_step: z.string().optional(),
  estimated_time_remaining_seconds: z.number().optional(),
  error_message: z.string().optional(),
});

export const HealthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  timestamp: z.string(),
});

// ============================================================================
// State Persistence Schemas
// ============================================================================

export const FileManagerStateSchema = z.object({
  data_directory_path: z.string().optional(),
  selected_file: z.string().nullable(),
  current_path: z.array(z.string()),
  selected_channels: z.array(z.string()),
  search_query: z.string(),
  sort_by: z.string(),
  sort_order: z.string(),
  show_hidden: z.boolean(),
});

export const PlotFiltersSchema = z.object({
  chunkSize: z.number().optional(),
  chunkStart: z.number().optional(),
  amplitude: z.number().optional(),
  showAnnotations: z.boolean().optional(),
});

export const PreprocessingOptionsSchema = z.object({
  highpass: z.number().optional(),
  lowpass: z.number().optional(),
  notch: z.array(z.number()).optional(),
  smoothing: z
    .object({
      enabled: z.boolean(),
      method: z.enum(["moving_average", "savitzky_golay"]),
      windowSize: z.number(),
      polynomialOrder: z.number().optional(),
    })
    .optional(),
  baselineCorrection: z.enum(["none", "mean", "median"]).optional(),
  outlierRemoval: z
    .object({
      enabled: z.boolean(),
      method: z.enum(["clip", "remove", "interpolate"]),
      threshold: z.number(),
    })
    .optional(),
  spikeRemoval: z
    .object({
      enabled: z.boolean(),
      threshold: z.number(),
      windowSize: z.number(),
    })
    .optional(),
  normalization: z.enum(["none", "zscore", "minmax"]).optional(),
  normalizationRange: z.tuple([z.number(), z.number()]).optional(),
});

export const PlotStateSchema = z.object({
  visible_channels: z.array(z.string()),
  time_range: z.tuple([z.number(), z.number()]),
  amplitude_range: z.tuple([z.number(), z.number()]),
  zoom_level: z.number(),
  annotations: z.array(AnnotationSchema),
  color_scheme: z.string(),
  plot_mode: z.string(),
  filters: PlotFiltersSchema,
  preprocessing: PreprocessingOptionsSchema.optional(),
});

export const FrontendDDAParametersSchema = z.object({
  windowLength: z.number().optional(),
  windowStep: z.number().optional(),
  delays: z.array(z.number()).optional(),
  variants: z.array(z.string()).optional(),
});

export const DelayPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  delays: z.array(z.number()),
  isBuiltIn: z.boolean(),
});

export const DDAStateSchema = z.object({
  selected_variants: z.array(z.string()),
  parameters: FrontendDDAParametersSchema,
  last_analysis_id: z.string().nullable(),
  current_analysis: DDAResultSchema.nullable(),
  analysis_history: z.array(DDAResultSchema),
  analysis_parameters: FrontendDDAParametersSchema,
  running: z.boolean(),
  custom_delay_presets: z.array(DelayPresetSchema).optional(),
});

export const UIStateSettingsSchema = z.object({
  activeTab: z.string().optional(),
  primaryNav: z.string().optional(),
  secondaryNav: z.string().optional(),
  sidebarOpen: z.boolean().optional(),
  sidebarWidth: z.number().optional(),
  zoom: z.number().optional(),
  panelSizes: z.array(z.number()).optional(),
  layout: z.string().optional(),
  theme: z.string().optional(),
  expertMode: z.boolean().optional(),
});

export const ApiConfigSchema = z.object({
  url: z.string(),
  timeout: z.number(),
});

export const AppPreferencesSchema = z.object({
  api_config: ApiConfigSchema,
  window_state: z.record(z.string(), z.unknown()),
  theme: z.string(),
  use_https: z.boolean().optional(),
  warn_on_close_during_analysis: z.boolean().optional(),
  updates_last_checked: z.string().optional(),
});

// ============================================================================
// NSG Job Schemas
// ============================================================================

export const NSGJobStatusSchema = z.enum([
  "pending",
  "submitted",
  "queue",
  "inputstaging",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const NSGJobSchema = z.object({
  id: z.string(),
  nsg_job_id: z.string().nullable(),
  tool: z.string(),
  status: NSGJobStatusSchema,
  created_at: z.string(),
  submitted_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  dda_params: z.record(z.string(), z.unknown()),
  input_file_path: z.string(),
  output_files: z.array(z.string()),
  error_message: z.string().nullable(),
  last_polled: z.string().nullable(),
  progress: z.number().nullable(),
});

export const NSGJobStatsSchema = z.object({
  total: z.number(),
  pending: z.number(),
  submitted: z.number(),
  running: z.number(),
  completed: z.number(),
  failed: z.number(),
  cancelled: z.number(),
});

export const NSGCredentialsSchema = z.object({
  username: z.string(),
  has_password: z.boolean(),
  has_app_key: z.boolean(),
});

// ============================================================================
// Notification Schemas
// ============================================================================

export const NotificationTypeSchema = z.enum([
  "info",
  "success",
  "warning",
  "error",
]);

export const NotificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  notification_type: NotificationTypeSchema,
  created_at: z.string(),
  read: z.boolean(),
  action_type: z.string().optional(),
  action_data: z.unknown().optional(),
});

// ============================================================================
// Update Schemas
// ============================================================================

export const UpdateCheckResponseSchema = z.object({
  available: z.boolean(),
  current_version: z.string(),
  latest_version: z.string().optional(),
  release_notes: z.string().optional(),
  release_date: z.string().optional(),
  download_url: z.string().optional(),
});

// ============================================================================
// Annotation Import/Export Schemas
// ============================================================================

export const AnnotationImportStatusSchema = z.enum([
  "new",
  "duplicate",
  "near_duplicate",
]);

export const AnnotationImportPreviewSchema = z.object({
  source_file: z.string(),
  target_file: z.string(),
  annotations: z.array(
    z.object({
      id: z.string(),
      position: z.number(),
      label: z.string(),
      description: z.string().optional(),
      color: z.string().optional(),
      channel: z.string().optional(),
      status: AnnotationImportStatusSchema,
      similarity_score: z.number(),
      closest_existing: z
        .object({
          label: z.string(),
          position: z.number(),
          time_diff: z.number(),
        })
        .optional(),
    }),
  ),
  warnings: z.array(z.string()),
  summary: z.object({
    total: z.number(),
    new: z.number(),
    duplicates: z.number(),
    near_duplicates: z.number(),
  }),
});

export const AnnotationImportResultSchema = z.object({
  total_in_file: z.number(),
  imported: z.number(),
  skipped_duplicates: z.number(),
  skipped_near_duplicates: z.number(),
  warnings: z.array(z.string()),
});

// ============================================================================
// Type exports (inferred from schemas)
// ============================================================================

export type BIDSMetadataSchemaType = z.infer<typeof BIDSMetadataSchema>;
export type EDFFileInfoSchemaType = z.infer<typeof EDFFileInfoSchema>;
export type ChunkDataSchemaType = z.infer<typeof ChunkDataSchema>;
export type AnnotationSchemaType = z.infer<typeof AnnotationSchema>;
export type DDAResultSchemaType = z.infer<typeof DDAResultSchema>;
export type DDAProgressEventSchemaType = z.infer<typeof DDAProgressEventSchema>;
export type PlotStateSchemaType = z.infer<typeof PlotStateSchema>;
export type NSGJobSchemaType = z.infer<typeof NSGJobSchema>;
export type NotificationSchemaType = z.infer<typeof NotificationSchema>;
export type AppPreferencesSchemaType = z.infer<typeof AppPreferencesSchema>;
