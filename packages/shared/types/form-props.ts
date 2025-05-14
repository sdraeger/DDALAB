import { EEGData } from "./eeg";

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
