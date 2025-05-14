export interface Annotation {
  id: number;
  userId: number;
  filePath: string;
  startTime: number;
  endTime?: number | null;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationInput {
  filePath: string;
  startTime: number;
  endTime?: number | null;
  text: string;
}

export interface AnnotationEditorProps {
  filePath?: string;
  eegData?: any;
  currentSample: number;
  sampleRate?: number;
  onAnnotationSelect?: (annotation: Annotation) => void;
  initialAnnotations?: Annotation[];
  onAnnotationsChange?: (annotations: Annotation[]) => void;
  onAnnotationUpdate?: (id: number, annotation: Partial<Annotation>) => void;
}

export interface UseAnnotationManagementProps {
  filePath: string;
  initialAnnotationsFromPlotState?: Annotation[];
  onAnnotationsChangeForPlotState: (annotations: Annotation[]) => void;
}
