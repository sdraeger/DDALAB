import { createSlice } from "@reduxjs/toolkit";

// Define the state structure for a single plot instance
export interface PlotMetadata {
  availableChannels?: string[];
  sampling_rate?: number;
  [key: string]: any;
}

export interface PlotState {
  metadata: PlotMetadata | null;
  edfData: any | null;
  selectedChannels: string[];
  ddaResults: {
    Q: (number | null)[][] | null;
    metadata?: any;
    artifact_id?: string;
    file_path?: string;
  } | null;
  [key: string]: any;
}

// Define the state structure for all plots (keyed by filePath)
export interface PlotsState {
  byFilePath: Record<string, PlotState>;
  currentFilePath: string | null;
}

const initialPlotsState: PlotsState = {
  byFilePath: {},
  currentFilePath: null,
};

const plotsSlice = createSlice({
  name: "plots",
  initialState: initialPlotsState,
  reducers: {
    // We'll add reducers as needed
  },
});

// Selectors
export const selectCurrentFilePath = (state: { plots: PlotsState }): string | null =>
  state.plots.currentFilePath;

export const selectCurrentPlotState = (
  state: { plots: PlotsState }
): PlotState | undefined => {
  const currentFilePath = state.plots.currentFilePath;
  return currentFilePath ? state.plots.byFilePath[currentFilePath] : undefined;
};

export default plotsSlice.reducer;