// packages/ddalab-tauri/src/types/bidsExport.ts

/**
 * BIDS Export Types
 * Defines the data structures for exporting files to BIDS format
 */

export type BIDSOutputFormat = "edf" | "brainvision";

export interface BIDSFileAssignment {
  /** Full path to source file */
  sourcePath: string;
  /** Subject ID without "sub-" prefix, e.g., "01", "patient001" */
  subjectId: string;
  /** Session ID without "ses-" prefix, e.g., "01", "baseline" (optional) */
  sessionId?: string;
  /** Task name, e.g., "rest", "eyesclosed" */
  task: string;
  /** Run number, e.g., 1, 2, 3 (optional) */
  run?: number;
  /** File info for display */
  fileName: string;
  /** Duration in seconds (for display) */
  duration?: number;
  /** Number of channels (for display) */
  channelCount?: number;
}

export interface BIDSDatasetMetadata {
  /** Dataset name (required) */
  name: string;
  /** Dataset description */
  description?: string;
  /** Authors list */
  authors: string[];
  /** License, e.g., "CC0", "CC-BY-4.0" */
  license: string;
  /** Funding sources */
  funding?: string;
}

export interface BIDSExportOptions {
  /** Output format for EEG data files */
  outputFormat: BIDSOutputFormat;
  /** Power line frequency: 50 or 60 Hz */
  powerLineFrequency: number;
  /** EEG reference electrode */
  eegReference?: string;
}

export interface BIDSExportRequest {
  /** File assignments */
  files: BIDSFileAssignment[];
  /** Dataset metadata */
  dataset: BIDSDatasetMetadata;
  /** Export options */
  options: BIDSExportOptions;
  /** Output directory path */
  outputPath: string;
}

export interface BIDSExportProgress {
  /** Current file being processed (1-indexed) */
  currentFile: number;
  /** Total number of files */
  totalFiles: number;
  /** Current file name */
  currentFileName: string;
  /** Current step: "reading" | "converting" | "writing_sidecars" */
  step: "reading" | "converting" | "writing_sidecars";
  /** Overall progress percentage (0-100) */
  percentage: number;
}

export interface BIDSExportResult {
  /** Whether export succeeded */
  success: boolean;
  /** Path to created dataset */
  datasetPath: string;
  /** Number of files exported */
  filesExported: number;
  /** Any warnings during export */
  warnings: string[];
  /** Error message if failed */
  error?: string;
}

/** Wizard step identifiers */
export type BIDSWizardStep =
  | "files"
  | "assignment"
  | "metadata"
  | "options"
  | "review";

/** License options for BIDS datasets */
export const BIDS_LICENSES = [
  { value: "CC0", label: "CC0 (Public Domain)" },
  { value: "CC-BY-4.0", label: "CC BY 4.0 (Attribution)" },
  { value: "CC-BY-SA-4.0", label: "CC BY-SA 4.0 (Attribution-ShareAlike)" },
  { value: "CC-BY-NC-4.0", label: "CC BY-NC 4.0 (Attribution-NonCommercial)" },
  { value: "PDDL", label: "PDDL (Open Data Commons)" },
  { value: "other", label: "Other" },
] as const;
