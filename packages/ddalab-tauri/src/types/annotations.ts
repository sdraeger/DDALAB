// Types for plot annotations

export interface PlotAnnotation {
  id: string
  // Position on the plot (x-axis value - could be time, scale, etc.)
  position: number
  // Label shown on the annotation
  label: string
  // Optional detailed description
  description?: string
  // Color of the annotation line
  color?: string
  // Timestamp when annotation was created
  createdAt: string
  // Last modified timestamp
  updatedAt?: string
}

export interface TimeSeriesAnnotations {
  // File path this annotation set belongs to
  filePath: string
  // Channel-specific annotations (optional)
  channelAnnotations?: Record<string, PlotAnnotation[]>
  // Global annotations (visible on all channels)
  globalAnnotations: PlotAnnotation[]
}

export interface DDAResultAnnotations {
  // DDA result ID this annotation set belongs to
  resultId: string
  // Variant ID (e.g., 'single_timeseries', 'multi_timeseries')
  variantId: string
  // Type of plot (heatmap or line)
  plotType: 'heatmap' | 'line'
  // Annotations on the plot
  annotations: PlotAnnotation[]
}

export interface AnnotationStore {
  // Annotations for time series plots, keyed by file path
  timeSeries: Record<string, TimeSeriesAnnotations>
  // Annotations for DDA result plots, keyed by result ID + variant ID + plot type
  ddaResults: Record<string, DDAResultAnnotations>
}

export interface AnnotationContextMenuProps {
  x: number
  y: number
  plotPosition: number
  onCreateAnnotation: (position: number, label: string, description?: string) => void
  onClose: () => void
  existingAnnotation?: PlotAnnotation
  onEditAnnotation?: (id: string, label: string, description?: string) => void
  onDeleteAnnotation?: (id: string) => void
}
