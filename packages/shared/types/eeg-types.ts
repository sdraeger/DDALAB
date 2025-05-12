import type { EEGData as BaseEEGData } from "../components/eeg-dashboard"; // Assuming EEGData is a base

// Represents a chunk of EEG data, potentially a subset of the full data
export interface EEGDataChunk extends BaseEEGData {
  chunkStartTime?: number; // Optional: Start time of this chunk relative to the full recording
  chunkDuration?: number; // Optional: Duration of this chunk
  isLastChunk?: boolean; // Optional: Flag if this is the last chunk
}

// Represents EEG data that has undergone some form of processing
// This might include added metadata or transformed data arrays
export interface ProcessedEEGData extends BaseEEGData {
  processingSteps?: string[]; // e.g., ['filtered', 'downsampled']
  // Add other fields relevant to processed data, e.g.:
  // qualityMetrics?: Record<string, number>;
  // events?: any[]; // Detected events after processing
}

// If EEGData itself is defined here, it would look something like this:
/*
export interface EEGData {
  channels: string[];
  samplesPerChannel: number;
  sampleRate: number;
  data: number[][]; // [channelIndex][sampleIndex]
  startTime: Date; // Or a number representing start time
  duration: number; // In seconds
  absoluteStartTime?: number;
  annotations?: any[];
}
*/

// You might also want more specific types for annotations if not already defined
// export interface Annotation {
//   id: string | number;
//   startTime: number;
//   endTime: number;
//   text: string;
//   channel?: string; // Optional: if annotation is channel-specific
// }
