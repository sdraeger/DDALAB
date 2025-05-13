export interface EEGData {
  channels: string[];
  samplesPerChannel: number;
  sampleRate: number;
  data: number[][];
  startTime: Date;
  duration: number;
  absoluteStartTime?: number;
  annotations?: any[];
}

export interface EEGDataChunk extends EEGData {
  chunkStartTime?: number;
  chunkDuration?: number;
  isLastChunk?: boolean;
}

export interface ProcessedEEGData extends EEGData {
  processingSteps?: string[];
}

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

export interface ResultsFormProps {
  edfData: EEGData;
  filePath: string;
  taskId?: string;
  sharedByUser: string;
  snapshotTimestamp: string;
  selectedChannels?: string[];
  preprocessingOptions?: {
    removeOutliers: boolean;
    smoothing: boolean;
    smoothingWindow: number;
    normalization: string;
  };
}

export interface UseAnnotationManagementProps {
  filePath: string;
  initialAnnotationsFromPlotState?: Annotation[];
  onAnnotationsChangeForPlotState: (annotations: Annotation[]) => void;
}
