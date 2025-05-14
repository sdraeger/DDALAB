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
