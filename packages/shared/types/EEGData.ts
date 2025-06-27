export interface EEGData {
  channels: string[];
  samplesPerChannel: number;
  sampleRate: number;
  data: number[][];
  startTime: string;
  duration: number;
  absoluteStartTime?: number;
  annotations?: any[];
  // Chunk-related properties for plot state management
  totalSamples?: number;
  chunkSize?: number;
  chunkStart?: number;
}

export interface EEGDataChunk extends EEGData {
  chunkStartTime?: number;
  chunkDuration?: number;
  isLastChunk?: boolean;
}

export interface ProcessedEEGData extends EEGData {
  processingSteps?: string[];
}
