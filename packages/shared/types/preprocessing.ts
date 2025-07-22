// Shared type for preprocessing form values
export interface FormValues {
  preprocessingSteps: { id: string; label: string }[];
  removeOutliers: boolean;
  smoothing: boolean;
  smoothingWindow: number;
  normalization: string;
}
