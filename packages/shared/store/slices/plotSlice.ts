import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import { GET_EDF_DATA } from "../../lib/graphql/queries"; // Assuming this path is correct
import { apolloClient } from "../../lib/apollo-client"; // Corrected path
import { apiRequest, ApiRequestOptions } from "../../lib/utils/request"; // Assuming this path
import { EdfFileInfo } from "../../lib/schemas/edf"; // Assuming this path
import { Annotation } from "../../types/annotation"; // Assuming this path
import { EEGData } from "../../types/eeg"; // Assuming this path
import logger from "../../lib/utils/logger"; // Assuming this path

// Helper types
interface PlotData {
  series: { name: string; data: number[] }[];
  time: number[];
}

interface PlotMetadata extends EdfFileInfo {
  availableChannels?: string[];
}

// Define the state structure for a single plot instance
export interface PlotState {
  isLoading: boolean;
  isMetadataLoading: boolean;
  isHeatmapProcessing: boolean;
  error: string | null | undefined;
  metadata: PlotMetadata | null;

  // Chunking and data
  chunkSizeSeconds: number;
  currentChunkNumber: number;
  totalChunks: number;
  chunkStart: number; // in seconds from start of file
  edfData: EEGData | null; // Raw data for the current chunk

  // Display settings
  selectedChannels: string[];
  timeWindow: [number, number]; // [start, end] in seconds, relative to chunkStart
  absoluteTimeWindow: [number, number]; // [start, end] in seconds, from start of file
  zoomLevel: number;

  // Heatmap
  showHeatmap: boolean;
  ddaHeatmapData: any[] | null; // Define a more specific type if possible

  // Annotations
  annotations: Annotation[] | null;

  // UI State
  showSettingsDialog: boolean;
  showZoomSettingsDialog: boolean;
  // Add other UI states as needed, e.g., for annotation editing

  // Preprocessing
  preprocessingOptions: any | null; // Define a more specific type
}

// Define the state structure for all plots (keyed by filePath)
export interface PlotsState {
  [filePath: string]: PlotState | undefined;
}

const initialPlotState: PlotState = {
  isLoading: false,
  isMetadataLoading: false,
  isHeatmapProcessing: false,
  error: null,
  metadata: null,
  chunkSizeSeconds: 100, // Default, can be updated from metadata or settings
  currentChunkNumber: 1,
  totalChunks: 1,
  chunkStart: 0,
  edfData: null,
  selectedChannels: [],
  timeWindow: [0, 100],
  absoluteTimeWindow: [0, 100],
  zoomLevel: 1,
  showHeatmap: false,
  ddaHeatmapData: null,
  annotations: null,
  showSettingsDialog: false,
  showZoomSettingsDialog: false,
  preprocessingOptions: null,
};

// Async Thunks
// Thunk to initialize plot metadata
export const initializePlot = createAsyncThunk(
  "plots/initialize",
  async (
    { filePath, token }: { filePath: string; token: string | undefined },
    { rejectWithValue, dispatch }
  ) => {
    if (!token) {
      return rejectWithValue("No token provided for fetching plot info.");
    }
    logger.info(`[Thunk] Initializing plot for: ${filePath}`);
    const infoRequestOptions: ApiRequestOptions & { responseType: "json" } = {
      url: `/api/edf/info?file_path=${encodeURIComponent(filePath)}`,
      method: "GET",
      token,
      responseType: "json",
      contentType: "application/json",
    };
    try {
      const fileInfo = await apiRequest<EdfFileInfo>(infoRequestOptions);
      if (!fileInfo) {
        return rejectWithValue(
          "Failed to fetch file info (response was null/undefined)"
        );
      }
      // Potentially dispatch action to load first chunk here or let component do it
      // dispatch(loadChunk({ filePath, chunkNumber: 1, token /*, preprocessingOptions */ }));
      return { filePath, fileInfo };
    } catch (error: any) {
      logger.error("[Thunk] Error initializing plot:", error);
      return rejectWithValue(error.message || "Could not load file metadata.");
    }
  }
);

// Thunk to load EDF data for a chunk
export const loadChunk = createAsyncThunk(
  "plots/loadChunk",
  async (
    {
      filePath,
      chunkNumber,
      chunkSizeSeconds,
      token,
      preprocessingOptions,
      qValue,
    }: {
      filePath: string;
      chunkNumber: number;
      chunkSizeSeconds: number;
      token: string | undefined;
      preprocessingOptions?: any;
      qValue?: any;
    },
    { getState, rejectWithValue }
  ) => {
    const state = getState() as { plots: PlotsState };
    const plot = state.plots[filePath];
    if (!plot || !plot.metadata) {
      return rejectWithValue("Plot or metadata not initialized.");
    }
    if (!token) {
      return rejectWithValue("No token provided for fetching chunk data.");
    }

    const chunkStartSample =
      (chunkNumber - 1) * chunkSizeSeconds * plot.metadata.sampling_rate;
    const chunkEndSample =
      chunkStartSample + chunkSizeSeconds * plot.metadata.sampling_rate - 1;

    logger.info(
      `[Thunk] Loading chunk ${chunkNumber} for ${filePath}. Samples: ${chunkStartSample}-${chunkEndSample}`
    );

    try {
      // This is where you'd use Apollo Client if GET_EDF_DATA is a GraphQL query
      // For simplicity, let's assume an API endpoint for now or adapt to GraphQL
      // const response = await apolloClient.query({ ... });
      // Or, if it's a REST API call similar to fileInfo:
      const dataRequestOptions: ApiRequestOptions & { responseType: "json" } = {
        // Modify this URL and body as per your actual API for fetching chunk data
        url: `/api/edf/data`,
        method: "POST", // Or GET, depending on your API
        token,
        body: {
          file_path: filePath,
          chunk_number: chunkNumber,
          chunk_size_seconds: chunkSizeSeconds,
          // preprocessing_options: preprocessingOptions, // Send if needed
          // q_value: qValue, // Send if needed
          start_sample: chunkStartSample,
          end_sample: chunkEndSample,
          selected_channels: plot.selectedChannels, // Send selected channels if backend filters by them
        },
        responseType: "json",
        contentType: "application/json",
      };
      const eegData = await apiRequest<EEGData>(dataRequestOptions); // Adjust EEGData type as needed

      // If using GraphQL:
      // const { data: eegData, error, networkStatus } = await apolloClient.query({
      //   query: GET_EDF_DATA,
      //   variables: {
      //     filePath,
      //     startSample: chunkStartSample,
      //     endSample: chunkEndSample,
      //     // Pass other variables like selectedChannels, preprocessingOptions if your query supports them
      //   },
      //   fetchPolicy: 'network-only', // Ensure fresh data
      // });
      // if (error) throw error;
      // if (!eegData || !eegData.getEdfData) throw new Error("No data returned from getEdfData query");

      return {
        filePath,
        chunkNumber,
        chunkStart: (chunkNumber - 1) * chunkSizeSeconds,
        eegData /*: eegData.getEdfData*/,
      };
    } catch (error: any) {
      logger.error(
        `[Thunk] Error loading chunk ${chunkNumber} for ${filePath}:`,
        error
      );
      return rejectWithValue(
        error.message || "Could not load EDF data for chunk."
      );
    }
  }
);

// Thunk for heatmap data
export const fetchDdaHeatmapData = createAsyncThunk(
  "plots/fetchDdaHeatmapData",
  async (
    {
      filePath,
      token /* other params like taskId, Q, etc. */,
    }: { filePath: string; token: string | undefined /* add other params */ },
    { rejectWithValue }
  ) => {
    if (!token) {
      return rejectWithValue("No token provided for fetching heatmap data.");
    }
    logger.info(`[Thunk] Fetching DDA heatmap data for: ${filePath}`);
    // Example using apiRequest, adjust as needed
    const heatmapRequestOptions: ApiRequestOptions & { responseType: "json" } =
      {
        url: `/api/dda/heatmap?file_path=${encodeURIComponent(filePath)}`, // Example URL
        method: "GET", // or POST with body
        token,
        responseType: "json",
        // body: { taskId, Q_value, ... } // if POST
      };
    try {
      const heatmapData = await apiRequest<any[]>(heatmapRequestOptions); // Define a specific type for heatmapData
      if (!heatmapData) {
        return rejectWithValue(
          "Failed to fetch DDA heatmap data (response was null/undefined)"
        );
      }
      return { filePath, heatmapData };
    } catch (error: any) {
      logger.error("[Thunk] Error fetching DDA heatmap data:", error);
      return rejectWithValue(
        error.message || "Could not load DDA heatmap data."
      );
    }
  }
);

const plotsSlice = createSlice({
  name: "plots",
  initialState: {} as PlotsState, // Start with an empty object for multiple plots
  reducers: {
    // Ensures a plot state exists for a given filePath
    ensurePlotState: (state, action: PayloadAction<string>) => {
      const filePath = action.payload;
      if (!state[filePath]) {
        state[filePath] = {
          ...initialPlotState,
          // Potentially override some defaults based on global settings if needed
        };
      }
    },
    setCurrentChunkNumber: (
      state,
      action: PayloadAction<{ filePath: string; chunkNumber: number }>
    ) => {
      const { filePath, chunkNumber } = action.payload;
      const plot = state[filePath];
      if (plot) {
        plot.currentChunkNumber = chunkNumber;
        plot.chunkStart = (chunkNumber - 1) * plot.chunkSizeSeconds;
        // Reset relative time window when chunk changes, absolute stays
        plot.timeWindow = [0, plot.chunkSizeSeconds];
        // Update absolute time window
        plot.absoluteTimeWindow = [
          plot.chunkStart,
          plot.chunkStart + plot.chunkSizeSeconds,
        ];
      }
    },
    setSelectedChannels: (
      state,
      action: PayloadAction<{ filePath: string; channels: string[] }>
    ) => {
      const { filePath, channels } = action.payload;
      const plot = state[filePath];
      if (plot) {
        plot.selectedChannels = channels;
      }
    },
    setTimeWindow: (
      state,
      action: PayloadAction<{ filePath: string; timeWindow: [number, number] }>
    ) => {
      const { filePath, timeWindow } = action.payload;
      const plot = state[filePath];
      if (plot) {
        plot.timeWindow = timeWindow;
        // Update absolute time window based on current chunkStart and new relative timeWindow
        plot.absoluteTimeWindow = [
          plot.chunkStart + timeWindow[0],
          plot.chunkStart + timeWindow[1],
        ];
      }
    },
    setZoomLevel: (
      state,
      action: PayloadAction<{ filePath: string; zoomLevel: number }>
    ) => {
      const { filePath, zoomLevel } = action.payload;
      const plot = state[filePath];
      if (plot) {
        plot.zoomLevel = zoomLevel;
      }
    },
    toggleShowHeatmap: (state, action: PayloadAction<{ filePath: string }>) => {
      const { filePath } = action.payload;
      const plot = state[filePath];
      if (plot) {
        plot.showHeatmap = !plot.showHeatmap;
        if (plot.showHeatmap && !plot.ddaHeatmapData) {
          // Implies we might want to trigger a fetch here or let the component do it
          // This reducer should only set showHeatmap, thunk should fetch.
        }
      }
    },
    setAnnotationsList: (
      state,
      action: PayloadAction<{ filePath: string; annotations: Annotation[] }>
    ) => {
      const { filePath, annotations } = action.payload;
      const plot = state[filePath];
      if (plot) {
        plot.annotations = annotations;
      }
    },
    addPlotAnnotation: (
      state,
      action: PayloadAction<{ filePath: string; annotation: Annotation }>
    ) => {
      const { filePath, annotation } = action.payload;
      const plot = state[filePath];
      if (plot) {
        if (!plot.annotations) plot.annotations = [];
        plot.annotations.push(annotation);
      }
    },
    updatePlotAnnotation: (
      state,
      action: PayloadAction<{ filePath: string; annotation: Annotation }>
    ) => {
      const { filePath, annotation } = action.payload;
      const plot = state[filePath];
      if (plot && plot.annotations) {
        const index = plot.annotations.findIndex((a) => a.id === annotation.id);
        if (index !== -1) {
          plot.annotations[index] = annotation;
        }
      }
    },
    deletePlotAnnotation: (
      state,
      action: PayloadAction<{ filePath: string; annotationId: string }>
    ) => {
      const { filePath, annotationId } = action.payload;
      const plot = state[filePath];
      if (plot && plot.annotations) {
        plot.annotations = plot.annotations.filter(
          (a) => a.id !== Number(annotationId)
        );
      }
    },
    setPlotPreprocessingOptions: (
      state,
      action: PayloadAction<{ filePath: string; options: any }>
    ) => {
      const { filePath, options } = action.payload;
      const plot = state[filePath];
      if (plot) {
        plot.preprocessingOptions = options;
      }
    },
    // UI State Reducers
    setShowSettingsDialog: (
      state,
      action: PayloadAction<{ filePath: string; show: boolean }>
    ) => {
      const { filePath, show } = action.payload;
      const plot = state[filePath];
      if (plot) {
        plot.showSettingsDialog = show;
      }
    },
    // Add other simple reducers here
    cleanupPlotState: (state, action: PayloadAction<string>) => {
      const filePath = action.payload;
      delete state[filePath];
    },
  },
  extraReducers: (builder) => {
    // Initialize Plot
    builder
      .addCase(initializePlot.pending, (state, action) => {
        const { filePath } = action.meta.arg;
        if (!state[filePath]) state[filePath] = { ...initialPlotState };
        const plot = state[filePath]!;
        plot.isMetadataLoading = true;
        plot.error = null;
      })
      .addCase(initializePlot.fulfilled, (state, action) => {
        const { filePath, fileInfo } = action.payload;
        const plot = state[filePath]!;
        plot.isMetadataLoading = false;
        plot.metadata = {
          ...fileInfo,
          // availableChannels will be populated by loadChunk
        };
        plot.totalChunks = parseInt(String(fileInfo.num_chunks), 10);

        const numChunks = parseInt(String(fileInfo.num_chunks), 10);
        const totalDuration = parseFloat(String(fileInfo.total_duration));

        if (numChunks > 0 && totalDuration > 0) {
          plot.chunkSizeSeconds = totalDuration / numChunks;
        } else {
          plot.chunkSizeSeconds = initialPlotState.chunkSizeSeconds; // Fallback to default
        }

        // Reset relevant fields based on new metadata
        plot.currentChunkNumber = 1;
        plot.chunkStart = 0;
        plot.timeWindow = [0, plot.chunkSizeSeconds];
        plot.absoluteTimeWindow = [0, plot.chunkSizeSeconds];
        // selectedChannels will be populated by the first loadChunk
        plot.selectedChannels = [];
      })
      .addCase(initializePlot.rejected, (state, action) => {
        const { filePath } = action.meta.arg;
        const plot = state[filePath]!;
        plot.isMetadataLoading = false;
        plot.error = action.payload as string;
      });

    // Load Chunk
    builder
      .addCase(loadChunk.pending, (state, action) => {
        const { filePath } = action.meta.arg;
        const plot = state[filePath];
        if (plot) {
          plot.isLoading = true;
          plot.error = null;
        }
      })
      .addCase(loadChunk.fulfilled, (state, action) => {
        const { filePath, chunkNumber, chunkStart, eegData } = action.payload;
        const plot = state[filePath];
        if (plot && eegData) {
          // Ensure eegData is not null
          plot.isLoading = false;
          plot.edfData = eegData;
          plot.currentChunkNumber = chunkNumber;
          plot.chunkStart = chunkStart;

          // Populate available channels from the first loaded chunk's data
          if (
            plot.metadata &&
            (!plot.metadata.availableChannels ||
              plot.metadata.availableChannels.length === 0)
          ) {
            plot.metadata.availableChannels = eegData.channels;
          }
          // Set initial selected channels if not already set (e.g. by user interaction before data load)
          if (
            plot.selectedChannels.length === 0 &&
            eegData.channels &&
            eegData.channels.length > 0
          ) {
            plot.selectedChannels = eegData.channels.slice(
              0,
              Math.min(8, eegData.channels.length)
            );
          }

          // Adjust time windows if necessary
          plot.timeWindow = [0, plot.chunkSizeSeconds];
          plot.absoluteTimeWindow = [
            chunkStart,
            chunkStart + plot.chunkSizeSeconds,
          ];
        }
      })
      .addCase(loadChunk.rejected, (state, action) => {
        const { filePath } = action.meta.arg;
        const plot = state[filePath];
        if (plot) {
          plot.isLoading = false;
          plot.error = action.payload as string;
        }
      });

    // Fetch DDA Heatmap Data
    builder
      .addCase(fetchDdaHeatmapData.pending, (state, action) => {
        const { filePath } = action.meta.arg;
        const plot = state[filePath];
        if (plot) {
          plot.isHeatmapProcessing = true;
          plot.error = null; // Clear previous errors specific to heatmap if any
        }
      })
      .addCase(fetchDdaHeatmapData.fulfilled, (state, action) => {
        const { filePath, heatmapData } = action.payload;
        const plot = state[filePath];
        if (plot) {
          plot.isHeatmapProcessing = false;
          plot.ddaHeatmapData = heatmapData;
          plot.showHeatmap = true; // Or manage this separately if needed
        }
      })
      .addCase(fetchDdaHeatmapData.rejected, (state, action) => {
        const { filePath } = action.meta.arg;
        const plot = state[filePath];
        if (plot) {
          plot.isHeatmapProcessing = false;
          plot.error = action.payload as string; // Or a specific heatmapError field
          plot.showHeatmap = false; // Turn off heatmap on error
        }
      });
  },
});

export const {
  ensurePlotState,
  setCurrentChunkNumber,
  setSelectedChannels,
  setTimeWindow,
  setZoomLevel,
  toggleShowHeatmap,
  setAnnotationsList,
  addPlotAnnotation,
  updatePlotAnnotation,
  deletePlotAnnotation,
  setPlotPreprocessingOptions,
  setShowSettingsDialog,
  cleanupPlotState,
} = plotsSlice.actions;

export default plotsSlice.reducer;

// Selectors
export const selectPlotStateByPath = (
  state: { plots: PlotsState },
  filePath: string
): PlotState | undefined => state.plots[filePath];

// Add more specific selectors as needed, e.g.:
export const selectPlotMetadata = (
  state: { plots: PlotsState },
  filePath: string
) => state.plots[filePath]?.metadata;
export const selectPlotEdfData = (
  state: { plots: PlotsState },
  filePath: string
) => state.plots[filePath]?.edfData;
export const selectPlotSelectedChannels = (
  state: { plots: PlotsState },
  filePath: string
) => state.plots[filePath]?.selectedChannels;
// ... and so on for other parts of the plot state.
