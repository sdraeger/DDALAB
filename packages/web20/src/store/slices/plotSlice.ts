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
    // Set current file path
    setCurrentFilePath: (state, action) => {
      state.currentFilePath = action.payload;
    },
    
    // Add or update file data
    setFileData: (state, action) => {
      const { filePath, plotData } = action.payload;
      state.byFilePath[filePath] = plotData;
      
      // Set as current if no current file
      if (!state.currentFilePath) {
        state.currentFilePath = filePath;
      }
    },
    
    // Remove a file completely
    removeFile: (state, action) => {
      const filePathToRemove = action.payload;
      delete state.byFilePath[filePathToRemove];
      
      // If we're removing the current file, switch to another or null
      if (state.currentFilePath === filePathToRemove) {
        const remainingPaths = Object.keys(state.byFilePath);
        state.currentFilePath = remainingPaths.length > 0 ? remainingPaths[0] : null;
      }
    },
    
    // Update selected channels for a specific file
    updateSelectedChannels: (state, action) => {
      const { filePath, selectedChannels } = action.payload;
      if (state.byFilePath[filePath]) {
        state.byFilePath[filePath].selectedChannels = selectedChannels;
      }
    },
    
    // Clear all files
    clearAllFiles: (state) => {
      state.byFilePath = {};
      state.currentFilePath = null;
    }
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

export const selectAllLoadedFiles = (state: { plots: PlotsState }): string[] =>
  Object.keys(state.plots.byFilePath);

export const selectLoadedFilesCount = (state: { plots: PlotsState }): number =>
  Object.keys(state.plots.byFilePath).length;

export const selectFileData = (filePath: string) => (state: { plots: PlotsState }): PlotState | undefined =>
  state.plots.byFilePath[filePath];

// Action creators
export const { 
  setCurrentFilePath, 
  setFileData, 
  removeFile, 
  updateSelectedChannels, 
  clearAllFiles 
} = plotsSlice.actions;

export default plotsSlice.reducer;