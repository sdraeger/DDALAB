export type SnapshotMode = "full" | "recipe_only";

export interface SourceFileInfo {
  original_path: string;
  file_name: string;
  file_hash: string;
  file_size: number;
  duration_seconds: number | null;
  sample_rate: number | null;
  channels: string[];
  format: string;
}

export interface SnapshotAnalysisEntry {
  id: string;
  name: string | null;
  created_at: string;
  variant_name: string;
  variant_display_name: string;
  parameters: Record<string, unknown>;
  results_file: string | null;
}

export interface SnapshotManifest {
  format_version: string;
  mode: SnapshotMode;
  created_at: string;
  application_version: string;
  name: string;
  description: string | null;
  source_file: SourceFileInfo;
  analyses: SnapshotAnalysisEntry[];
  has_annotations: boolean;
  has_workflow: boolean;
}

export interface SnapshotValidation {
  valid: boolean;
  format_version_compatible: boolean;
  source_file_found: boolean;
  source_file_hash_match: boolean;
  analysis_count: number;
  warnings: string[];
  errors: string[];
}

export interface SnapshotInspectResult {
  manifest: SnapshotManifest;
  file_size_bytes: number;
  validation: SnapshotValidation;
}

export interface SnapshotImportResult {
  manifest: SnapshotManifest;
  validation: SnapshotValidation;
  snapshot_path: string;
  suggested_source_path: string | null;
}

export interface SnapshotApplyResult {
  analyses_restored: number;
  annotations_restored: number;
  source_file_path: string;
}

export interface ExportSnapshotRequest {
  sourceFilePath: string;
  analysisIds: string[];
  mode: SnapshotMode;
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  sourceFileInfo: SourceFileInfo;
  workflow?: Record<string, unknown>;
}
