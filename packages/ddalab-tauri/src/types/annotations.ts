// Types for plot annotations

export const ANNOTATION_CATEGORIES = {
  general: { label: "General", color: "#6b7280" },
  artifact: { label: "Artifact", color: "#ef4444" },
  event: { label: "Event", color: "#3b82f6" },
  seizure_onset: { label: "Seizure Onset", color: "#f97316" },
  seizure_offset: { label: "Seizure Offset", color: "#eab308" },
  sleep_stage: { label: "Sleep Stage", color: "#8b5cf6" },
  stimulus: { label: "Stimulus", color: "#10b981" },
  movement: { label: "Movement", color: "#ec4899" },
  custom: { label: "Custom", color: "#6366f1" },
} as const;

export type AnnotationCategoryId = keyof typeof ANNOTATION_CATEGORIES;

export interface PlotAnnotation {
  id: string;
  position: number;
  label: string;
  description?: string;
  color?: string;
  category?: AnnotationCategoryId;
  createdAt: string;
  updatedAt?: string;
  visible_in_plots?: string[];
}

// Tauri backend returns annotations with snake_case field names
export interface TauriAnnotation {
  id: string;
  position: number;
  label: string;
  description?: string;
  color?: string;
  created_at?: string;
  updated_at?: string;
  visible_in_plots?: string[];
}

// Response from Tauri get_file_annotations command
export interface TauriFileAnnotationsResponse {
  global_annotations?: TauriAnnotation[];
  channel_annotations?: Record<string, TauriAnnotation[]>;
}

export interface TimeSeriesAnnotations {
  // File path this annotation set belongs to
  filePath: string;
  // Channel-specific annotations (optional)
  channelAnnotations?: Record<string, PlotAnnotation[]>;
  // Global annotations (visible on all channels)
  globalAnnotations: PlotAnnotation[];
}

export interface DDAResultAnnotations {
  // DDA result ID this annotation set belongs to
  resultId: string;
  // Variant ID (e.g., 'single_timeseries', 'multi_timeseries')
  variantId: string;
  // Type of plot (heatmap or line)
  plotType: "heatmap" | "line";
  // Annotations on the plot
  annotations: PlotAnnotation[];
}

export interface AnnotationStore {
  // Annotations for time series plots, keyed by file path
  timeSeries: Record<string, TimeSeriesAnnotations>;
  // Annotations for DDA result plots, keyed by result ID + variant ID + plot type
  ddaResults: Record<string, DDAResultAnnotations>;
}

export interface PlotInfo {
  id: string; // e.g., "timeseries", "dda:variant1:heatmap"
  label: string; // e.g., "Data Visualization", "Single Timeseries - Heatmap"
}

export interface AnnotationContextMenuProps {
  x: number;
  y: number;
  plotPosition: number;
  onCreateAnnotation: (
    position: number,
    label: string,
    description?: string,
    visibleInPlots?: string[],
    category?: AnnotationCategoryId,
  ) => void;
  onClose: () => void;
  existingAnnotation?: PlotAnnotation;
  onEditAnnotation?: (
    id: string,
    label: string,
    description?: string,
    visibleInPlots?: string[],
    category?: AnnotationCategoryId,
  ) => void;
  onDeleteAnnotation?: (id: string) => void;
  // Available plots to show checkboxes for
  availablePlots: PlotInfo[];
  // Current plot where context menu was opened
  currentPlotId: string;
}
