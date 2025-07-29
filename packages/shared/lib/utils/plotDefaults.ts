// Centralized defaults for plot/dashboard/EEG state
// Use these constants everywhere to ensure consistency

export const DEFAULT_CHUNK_SIZE_SECONDS = 10; // Used for chunking EEG data
export const DEFAULT_TIME_WINDOW: [number, number] = [0, 10]; // Default time window in seconds
export const DEFAULT_ABSOLUTE_TIME_WINDOW: [number, number] = [0, 10];
export const DEFAULT_ZOOM_LEVEL = 1;

// Add more defaults as needed
export const DEFAULT_SHOW_HEATMAP = false;
export const DEFAULT_SELECTED_CHANNELS: string[] = [];
export const DEFAULT_CURRENT_CHUNK_NUMBER = 1;
export const DEFAULT_TOTAL_CHUNKS = 1;
export const DEFAULT_CHUNK_START = 0;
export const DEFAULT_EDF_DATA = null;
export const DEFAULT_METADATA = null;
export const DEFAULT_DDA_HEATMAP_DATA = null;
export const DEFAULT_DDA_RESULTS = null;
export const DEFAULT_ANNOTATIONS = null;
export const DEFAULT_SHOW_SETTINGS_DIALOG = false;
export const DEFAULT_SHOW_ZOOM_SETTINGS_DIALOG = false;
export const DEFAULT_PREPROCESSING_OPTIONS = null;
export const DEFAULT_ERROR = null;
export const DEFAULT_IS_LOADING = false;
export const DEFAULT_IS_METADATA_LOADING = false;
export const DEFAULT_IS_HEATMAP_PROCESSING = false;
export const DEFAULT_SAMPLE_RATE = 256;

export const DEFAULT_PREPROCESSING_OPTIONS_STRUCT = {
  removeOutliers: false,
  smoothing: false,
  smoothingWindow: 3,
  normalization: "none",
};
