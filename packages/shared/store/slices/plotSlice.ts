import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import { get, put } from "../../lib/utils/request";
import { EdfFileInfo } from "../../lib/schemas/edf";
import { Annotation } from "../../types/annotation";
import { EEGData } from "../../types/EEGData";
import logger from "../../lib/utils/logger";
import { apolloClient } from "../../lib/utils/apollo-client";
import { GET_EDF_DATA } from "../../lib/graphql/queries";
import { startLoading, stopLoading, updateProgress } from "./loadingSlice";
import { plotStorage, PlotData } from "../../lib/utils/indexedDB/plotStorage";
import {
  DEFAULT_CHUNK_SIZE_SECONDS,
  DEFAULT_TIME_WINDOW,
  DEFAULT_ABSOLUTE_TIME_WINDOW,
  DEFAULT_ZOOM_LEVEL,
  DEFAULT_SHOW_HEATMAP,
  DEFAULT_SELECTED_CHANNELS,
  DEFAULT_CURRENT_CHUNK_NUMBER,
  DEFAULT_TOTAL_CHUNKS,
  DEFAULT_CHUNK_START,
  DEFAULT_EDF_DATA,
  DEFAULT_METADATA,
  DEFAULT_DDA_HEATMAP_DATA,
  DEFAULT_DDA_RESULTS,
  DEFAULT_ANNOTATIONS,
  DEFAULT_SHOW_SETTINGS_DIALOG,
  DEFAULT_SHOW_ZOOM_SETTINGS_DIALOG,
  DEFAULT_PREPROCESSING_OPTIONS,
  DEFAULT_ERROR,
  DEFAULT_IS_LOADING,
  DEFAULT_IS_METADATA_LOADING,
  DEFAULT_IS_HEATMAP_PROCESSING,
} from "../../lib/utils/plotDefaults";

export interface PlotMetadata extends EdfFileInfo {
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

  // DDA Results
  ddaResults: {
    Q: (number | null)[][] | null;
    metadata?: any;
    artifact_id?: string;
    file_path?: string;
  } | null;

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
  byFilePath: Record<string, PlotState>;
  currentFilePath: string | null;
}

const initialPlotState: PlotState = {
  isLoading: DEFAULT_IS_LOADING,
  isMetadataLoading: DEFAULT_IS_METADATA_LOADING,
  isHeatmapProcessing: DEFAULT_IS_HEATMAP_PROCESSING,
  error: DEFAULT_ERROR,
  metadata: DEFAULT_METADATA,
  chunkSizeSeconds: DEFAULT_CHUNK_SIZE_SECONDS,
  currentChunkNumber: DEFAULT_CURRENT_CHUNK_NUMBER,
  totalChunks: DEFAULT_TOTAL_CHUNKS,
  chunkStart: DEFAULT_CHUNK_START,
  edfData: DEFAULT_EDF_DATA,
  selectedChannels: DEFAULT_SELECTED_CHANNELS,
  timeWindow: DEFAULT_TIME_WINDOW,
  absoluteTimeWindow: DEFAULT_ABSOLUTE_TIME_WINDOW,
  zoomLevel: DEFAULT_ZOOM_LEVEL,
  showHeatmap: DEFAULT_SHOW_HEATMAP,
  ddaHeatmapData: DEFAULT_DDA_HEATMAP_DATA,
  ddaResults: DEFAULT_DDA_RESULTS,
  annotations: DEFAULT_ANNOTATIONS,
  showSettingsDialog: DEFAULT_SHOW_SETTINGS_DIALOG,
  showZoomSettingsDialog: DEFAULT_SHOW_ZOOM_SETTINGS_DIALOG,
  preprocessingOptions: DEFAULT_PREPROCESSING_OPTIONS,
};

const initialPlotsState: PlotsState = {
  byFilePath: {},
  currentFilePath: null,
};

// Helper function to normalize file paths
const normalizeFilePath = (filePath: string): string => {
  // For absolute paths, keep them as is
  if (filePath.startsWith("/")) {
    return filePath;
  }
  // For relative paths, ensure they start with /
  return `/${filePath}`;
};

// Async Thunks
// Thunk to initialize plot metadata
export const initializePlot = createAsyncThunk(
  "plots/initialize",
  async (
    { filePath, token }: { filePath: string; token: string | undefined },
    { rejectWithValue, dispatch }
  ) => {
    const loadingId = `initialize-${filePath}`;

    // Start loading
    dispatch(
      startLoading({
        id: loadingId,
        type: "file-load",
        message: `Loading metadata for ${filePath.split("/").pop()}...`,
        showGlobalOverlay: false,
      })
    );

    try {
      if (!token) {
        throw new Error("No token provided for fetching plot info.");
      }

      logger.info(`[Thunk] Initializing plot for: ${filePath}`);
      const fileInfo = await get<EdfFileInfo>(
        `/api/edf/info?file_path=${encodeURIComponent(filePath)}`
      );
      if (!fileInfo) {
        throw new Error(
          "Failed to fetch file info (response was null/undefined)"
        );
      }

      return { filePath, fileInfo };
    } catch (error: any) {
      logger.error("[Thunk] Error initializing plot:", error);
      return rejectWithValue(error.message || "Could not load file metadata.");
    } finally {
      // Stop loading
      dispatch(stopLoading(loadingId));
    }
  }
);

// Thunk to load EDF data for a chunk using GraphQL
export const loadChunk = createAsyncThunk(
  "plots/loadChunk",
  async (
    {
      filePath,
      chunkNumber,
      chunkSizeSeconds,
      token,
      preprocessingOptions,
    }: {
      filePath: string;
      chunkNumber: number;
      chunkSizeSeconds: number;
      token: string | undefined;
      preprocessingOptions?: any;
    },
    { getState, rejectWithValue, dispatch }
  ) => {
    // Defensive: ensure plot state exists
    let state = getState() as { plots: PlotsState };
    let plot = state.plots.byFilePath[filePath];
    if (!plot) {
      logger.warn(
        `[loadChunk] Plot state for ${filePath} not found. Dispatching ensurePlotState.`
      );
      dispatch(ensurePlotState(filePath));
      // Re-fetch state after dispatch
      state = getState() as { plots: PlotsState };
      plot = state.plots.byFilePath[filePath];
    }
    if (!plot) {
      logger.error(
        `[loadChunk] Plot state for ${filePath} is still undefined after ensurePlotState.`
      );
      return rejectWithValue(
        "Plot state not initialized for filePath: " + filePath
      );
    }
    if (!plot.metadata) {
      logger.error(
        `[loadChunk] Plot metadata for ${filePath} is not initialized.`
      );
      return rejectWithValue(
        "Plot metadata not initialized for filePath: " + filePath
      );
    }

    if (!token) {
      console.error("[loadChunk] No token provided");
      return rejectWithValue("No token provided for fetching chunk data.");
    }

    const loadingId = `load-chunk-${filePath}-${chunkNumber}`;
    const chunkStartSample =
      (chunkNumber - 1) * chunkSizeSeconds * plot.metadata.sampling_rate;
    const chunkSizeInSamples = chunkSizeSeconds * plot.metadata.sampling_rate;

    // Start loading
    dispatch(
      startLoading({
        id: loadingId,
        type: "file-load",
        message: `Loading chunk ${chunkNumber} of ${filePath
          .split("/")
          .pop()}...`,
        showGlobalOverlay: false,
        metadata: {
          filePath,
          chunkNumber,
          chunkStartSample,
          chunkSizeInSamples,
        },
      })
    );

    try {
      logger.info(
        `[Thunk] Loading chunk ${chunkNumber} for ${filePath}. Samples: ${chunkStartSample}-${
          chunkStartSample + chunkSizeInSamples - 1
        }`
      );

      // Use REST API to fetch EDF data, pass preprocessing options when provided
      const preprocessingQuery = preprocessingOptions
        ? `&preprocessing_options=${encodeURIComponent(
            JSON.stringify(preprocessingOptions)
          )}`
        : "";
      const rawEdfData = await get<any>(
        `/api/edf/data?file_path=${encodeURIComponent(
          filePath
        )}&chunk_start=${chunkStartSample}&chunk_size=${chunkSizeInSamples}${preprocessingQuery}`
      );

      if (!rawEdfData) {
        throw new Error("No data returned from REST API");
      }

      logger.info(`[Thunk] Raw EDF data received from REST API:`, {
        hasData: !!rawEdfData.data,
        hasChannelLabels: !!rawEdfData.channel_labels,
        hasSamplingFrequency: !!rawEdfData.sampling_frequency,
        dataStructure: typeof rawEdfData.data,
        channelCount: rawEdfData.channel_labels?.length,
        sampleCount: rawEdfData.data?.[0]?.length,
      });

      // Update progress as we process the data
      dispatch(
        updateProgress({
          id: loadingId,
          progress: 80,
          message: `Processing data for chunk ${chunkNumber}...`,
        })
      );

      // Transform REST API response to EEGData format
      const eegData: EEGData = {
        channels: rawEdfData.channel_labels || rawEdfData.channelLabels || [],
        sampleRate:
          rawEdfData.sampling_frequency || rawEdfData.samplingFrequency || 256,
        data: rawEdfData.data || [],
        startTime: new Date().toISOString(), // Convert to ISO string for Redux serialization
        duration: rawEdfData.chunk_size
          ? rawEdfData.chunk_size /
            (rawEdfData.sampling_frequency ||
              rawEdfData.samplingFrequency ||
              256)
          : chunkSizeSeconds,
        samplesPerChannel: rawEdfData.data?.[0]?.length || 0,
        totalSamples: rawEdfData.total_samples || rawEdfData.totalSamples || 0,
        chunkSize:
          rawEdfData.chunk_size || rawEdfData.chunkSize || chunkSizeInSamples,
        chunkStart:
          rawEdfData.chunk_start || rawEdfData.chunkStart || chunkStartSample,
        absoluteStartTime: 0,
        annotations: [],
      };

      // Add comprehensive debugging to understand the data structure
      logger.info(`[Thunk] Raw EDF data structure:`, {
        hasChannelLabels: !!(
          rawEdfData.channel_labels || rawEdfData.channelLabels
        ),
        channelLabelsLength: (
          rawEdfData.channel_labels || rawEdfData.channelLabels
        )?.length,
        hasData: !!rawEdfData.data,
        dataLength: rawEdfData.data?.length,
        firstChannelDataLength: rawEdfData.data?.[0]?.length,
        samplingFrequency:
          rawEdfData.sampling_frequency || rawEdfData.samplingFrequency,
        chunkSize: rawEdfData.chunk_size || rawEdfData.chunkSize,
        totalSamples: rawEdfData.total_samples || rawEdfData.totalSamples,
        // Add more detailed data inspection
        dataType: typeof rawEdfData.data,
        isArray: Array.isArray(rawEdfData.data),
        firstChannelType: typeof rawEdfData.data?.[0],
        firstChannelIsArray: Array.isArray(rawEdfData.data?.[0]),
        // Add raw data inspection
        rawDataKeys: rawEdfData ? Object.keys(rawEdfData) : null,
        rawDataSample: rawEdfData.data ? rawEdfData.data.slice(0, 2) : null, // Show first 2 channels
      });

      // Add debugging for the transformed data
      logger.info(`[Thunk] Transformed EEG data:`, {
        channelsLength: eegData.channels.length,
        dataLength: eegData.data.length,
        samplesPerChannel: eegData.samplesPerChannel,
        duration: eegData.duration,
        // Add more detailed inspection
        dataType: typeof eegData.data,
        isArray: Array.isArray(eegData.data),
        firstChannelType: typeof eegData.data?.[0],
        firstChannelIsArray: Array.isArray(eegData.data?.[0]),
        firstChannelLength: eegData.data?.[0]?.length,
        // Add transformed data inspection
        transformedDataSample: eegData.data ? eegData.data.slice(0, 2) : null, // Show first 2 channels
      });

      // After successfully loading data, save to IndexedDB
      if (eegData) {
        try {
          const plotData: PlotData = {
            filePath,
            metadata: plot.metadata,
            edfData: eegData,
            selectedChannels: plot.selectedChannels,
            timeWindow: plot.timeWindow,
            absoluteTimeWindow: plot.absoluteTimeWindow,
            zoomLevel: plot.zoomLevel,
            chunkSizeSeconds: plot.chunkSizeSeconds,
            currentChunkNumber: chunkNumber,
            totalChunks: plot.totalChunks,
            chunkStart: (chunkNumber - 1) * chunkSizeSeconds,
            showHeatmap: plot.showHeatmap,
            ddaResults: plot.ddaResults,
            annotations: plot.annotations || [],
            showSettingsDialog: plot.showSettingsDialog,
            showZoomSettingsDialog: plot.showZoomSettingsDialog,
            preprocessingOptions: plot.preprocessingOptions,
            lastAccessed: Date.now(),
            size: 0,
          };

          await plotStorage.savePlot(plotData);
        } catch (error) {
          console.warn("Failed to save plot to IndexedDB:", error);
        }
      }

      return {
        filePath,
        chunkNumber,
        chunkStart: (chunkNumber - 1) * chunkSizeSeconds,
        eegData,
      };
    } catch (error: any) {
      logger.error(
        `[Thunk] Error loading chunk ${chunkNumber} for ${filePath}:`,
        error
      );
      return rejectWithValue(error.message || "Could not load chunk data.");
    } finally {
      // Stop loading
      dispatch(stopLoading(loadingId));
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
    const heatmapData = await get<any[]>(
      `/api/dda/heatmap?file_path=${encodeURIComponent(filePath)}`
    ); // Define a specific type for heatmapData
    if (!heatmapData) {
      return rejectWithValue(
        "Failed to fetch DDA heatmap data (response was null/undefined)"
      );
    }
    return { filePath, heatmapData };
  }
);

const plotsSlice = createSlice({
  name: "plots",
  initialState: initialPlotsState,
  reducers: {
    // Ensures a plot state exists for a given filePath
    ensurePlotState: (state, action: PayloadAction<string>) => {
      const filePath = normalizeFilePath(action.payload);
      if (!state.byFilePath[filePath]) {
        state.byFilePath[filePath] = {
          ...initialPlotState,
          // Potentially override some defaults based on global settings if needed
        };
      }
    },
    setCurrentFilePath: (state, action: PayloadAction<string | null>) => {
      state.currentFilePath = action.payload
        ? normalizeFilePath(action.payload)
        : null;
    },
    setCurrentChunkNumber: (
      state,
      action: PayloadAction<{ filePath: string; chunkNumber: number }>
    ) => {
      const { filePath, chunkNumber } = action.payload;
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
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
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
      if (plot) {
        plot.selectedChannels = channels;
        console.log(
          "[plotSlice] setSelectedChannels:",
          normalizedFilePath,
          channels
        );
      }
    },
    setTimeWindow: (
      state,
      action: PayloadAction<{ filePath: string; timeWindow: [number, number] }>
    ) => {
      const { filePath, timeWindow } = action.payload;
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
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
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
      if (plot) {
        plot.zoomLevel = zoomLevel;
      }
    },
    toggleShowHeatmap: (state, action: PayloadAction<{ filePath: string }>) => {
      const { filePath } = action.payload;
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
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
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
      if (plot) {
        plot.annotations = annotations;
      }
    },
    addPlotAnnotation: (
      state,
      action: PayloadAction<{ filePath: string; annotation: Annotation }>
    ) => {
      const { filePath, annotation } = action.payload;
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
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
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
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
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
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
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
      if (plot) {
        plot.preprocessingOptions = options;
      }
    },
    setDDAResults: (
      state,
      action: PayloadAction<{
        filePath: string;
        results: {
          Q: (number | null)[][];
          metadata?: any;
          artifact_id?: string;
          file_path?: string;
        };
      }>
    ) => {
      const { filePath, results } = action.payload;
      const normalizedFilePath = normalizeFilePath(filePath);
      console.log("[Redux] setDDAResults called:", {
        filePath,
        normalizedFilePath,
        resultsQLength: results.Q?.length,
        resultsQFirstRowLength: results.Q?.[0]?.length,
        plotExists: !!state.byFilePath[normalizedFilePath],
        availablePlotPaths: Object.keys(state.byFilePath),
        currentFilePath: state.currentFilePath,
        pathMatch: normalizedFilePath === state.currentFilePath,
        stateKeys: Object.keys(state),
      });
      const plot = state.byFilePath[normalizedFilePath];
      if (plot) {
        plot.ddaResults = results;
        console.log("[Redux] DDA results stored successfully");
      } else {
        console.warn(
          "[Redux] No plot state found for filePath:",
          normalizedFilePath
        );
      }
    },
    // UI State Reducers
    setShowSettingsDialog: (
      state,
      action: PayloadAction<{ filePath: string; show: boolean }>
    ) => {
      const { filePath, show } = action.payload;
      const normalizedFilePath = normalizeFilePath(filePath);
      const plot = state.byFilePath[normalizedFilePath];
      if (plot) {
        plot.showSettingsDialog = show;
      }
    },
    // Add other simple reducers here
    cleanupPlotState: (state, action: PayloadAction<string>) => {
      const filePath = normalizeFilePath(action.payload);
      delete state.byFilePath[filePath];
    },
    clearAllPlots: (state) => {
      state.byFilePath = {};
      state.currentFilePath = null;
    },
    // Restore plot state from popout data transfer
    restorePlotState: (
      state,
      action: PayloadAction<{ filePath: string; plotState: PlotState }>
    ) => {
      const { filePath, plotState } = action.payload;
      const normalizedFilePath = normalizeFilePath(filePath);

      // Ensure plot state exists
      if (!state.byFilePath[normalizedFilePath]) {
        state.byFilePath[normalizedFilePath] = { ...initialPlotState };
      }

      // Restore the plot state
      state.byFilePath[normalizedFilePath] = {
        ...state.byFilePath[normalizedFilePath],
        ...plotState,
      };

      console.log("[plotSlice] Restored plot state for:", normalizedFilePath);
    },
    // Sync reducer for popout window synchronization
    syncFromRemote: (state, action: PayloadAction<PlotsState>) => {
      const incomingState = action.payload;

      // Validate incoming state structure
      if (!incomingState || typeof incomingState.byFilePath !== "object") {
        console.warn("[PlotSync] Invalid plots state received, ignoring sync");
        return;
      }

      // Selective merge strategy - only update specific fields to avoid overwriting local UI state
      state.currentFilePath = incomingState.currentFilePath;

      // Merge plot states selectively
      Object.entries(incomingState.byFilePath).forEach(
        ([filePath, incomingPlot]) => {
          const existingPlot = state.byFilePath[filePath];

          if (!existingPlot) {
            // New plot - add it completely
            state.byFilePath[filePath] = incomingPlot;
            console.debug(`[PlotSync] Added new plot state for: ${filePath}`);
          } else {
            // Existing plot - merge selectively
            const updatedPlot = {
              ...existingPlot,
              // Sync data-related fields
              metadata: incomingPlot.metadata,
              edfData: incomingPlot.edfData,
              ddaResults: incomingPlot.ddaResults,
              ddaHeatmapData: incomingPlot.ddaHeatmapData,
              annotations: incomingPlot.annotations,
              preprocessingOptions: incomingPlot.preprocessingOptions,

              // Sync display settings
              selectedChannels: incomingPlot.selectedChannels,
              timeWindow: incomingPlot.timeWindow,
              absoluteTimeWindow: incomingPlot.absoluteTimeWindow,
              zoomLevel: incomingPlot.zoomLevel,
              showHeatmap: incomingPlot.showHeatmap,

              // Sync chunking state
              chunkSizeSeconds: incomingPlot.chunkSizeSeconds,
              currentChunkNumber: incomingPlot.currentChunkNumber,
              totalChunks: incomingPlot.totalChunks,
              chunkStart: incomingPlot.chunkStart,

              // Keep local UI state (don't sync these)
              showSettingsDialog: existingPlot.showSettingsDialog,
              showZoomSettingsDialog: existingPlot.showZoomSettingsDialog,

              // Sync loading states but be careful about race conditions
              isLoading: incomingPlot.isLoading,
              isMetadataLoading: incomingPlot.isMetadataLoading,
              isHeatmapProcessing: incomingPlot.isHeatmapProcessing,
              error: incomingPlot.error,
            };

            state.byFilePath[filePath] = updatedPlot;
            console.debug(`[PlotSync] Updated plot state for: ${filePath}`);
          }
        }
      );
    },
  },
  extraReducers: (builder) => {
    // Initialize Plot
    builder
      .addCase(initializePlot.pending, (state, action) => {
        const { filePath } = action.meta.arg;
        if (!state.byFilePath[filePath])
          state.byFilePath[filePath] = { ...initialPlotState };
        const plot = state.byFilePath[filePath]!;
        plot.isMetadataLoading = true;
        plot.error = null;
      })
      .addCase(initializePlot.fulfilled, (state, action) => {
        const { filePath, fileInfo } = action.payload;
        const plot = state.byFilePath[filePath]!;
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
        // Set timeWindow to a safe default that will be updated when actual data loads
        plot.timeWindow = [0, Math.min(plot.chunkSizeSeconds, 10)];
        plot.absoluteTimeWindow = [0, Math.min(plot.chunkSizeSeconds, 10)];
        // selectedChannels will be populated by the first loadChunk
        plot.selectedChannels = [];
      })
      .addCase(initializePlot.rejected, (state, action) => {
        const { filePath } = action.meta.arg;
        const plot = state.byFilePath[filePath]!;
        plot.isMetadataLoading = false;
        plot.error = action.payload as string;
      });

    // Load Chunk
    builder
      .addCase(loadChunk.pending, (state, action) => {
        const { filePath } = action.meta.arg;
        const plot = state.byFilePath[filePath];
        if (plot) {
          plot.isLoading = true;
          plot.error = null;
        }
      })
      .addCase(loadChunk.fulfilled, (state, action) => {
        const { filePath, chunkNumber, chunkStart, eegData } = action.payload;
        const plot = state.byFilePath[filePath];
        if (plot && eegData) {
          // Add debugging to see what's being stored
          logger.info(`[Redux] Storing EEG data in Redux:`, {
            filePath,
            chunkNumber,
            hasEegData: !!eegData,
            channelsLength: eegData.channels?.length,
            dataLength: eegData.data?.length,
            firstChannelLength: eegData.data?.[0]?.length,
            dataType: typeof eegData.data,
            isArray: Array.isArray(eegData.data),
          });

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

          // Calculate actual chunk duration from the loaded data
          const actualChunkDuration = eegData.duration || plot.chunkSizeSeconds;

          // Update chunkSizeSeconds to match actual data if this is the first load
          if (chunkNumber === 1 && eegData.duration) {
            plot.chunkSizeSeconds = eegData.duration;
          }

          // Adjust time windows based on actual chunk duration
          plot.timeWindow = [0, actualChunkDuration];
          plot.absoluteTimeWindow = [
            chunkStart,
            chunkStart + actualChunkDuration,
          ];

          // Add debugging after storage
          logger.info(`[Redux] EEG data stored successfully:`, {
            filePath,
            storedDataLength: plot.edfData?.data?.length,
            storedChannelsLength: plot.edfData?.channels?.length,
            selectedChannelsLength: plot.selectedChannels.length,
          });
        }
      })
      .addCase(loadChunk.rejected, (state, action) => {
        const { filePath } = action.meta.arg;
        const plot = state.byFilePath[filePath];
        if (plot) {
          plot.isLoading = false;
          plot.error = action.payload as string;
        }
      });

    // Fetch DDA Heatmap Data
    builder
      .addCase(fetchDdaHeatmapData.pending, (state, action) => {
        const { filePath } = action.meta.arg;
        const plot = state.byFilePath[filePath];
        if (plot) {
          plot.isHeatmapProcessing = true;
          plot.error = null; // Clear previous errors specific to heatmap if any
        }
      })
      .addCase(fetchDdaHeatmapData.fulfilled, (state, action) => {
        const { filePath, heatmapData } = action.payload;
        const plot = state.byFilePath[filePath];
        if (plot) {
          plot.isHeatmapProcessing = false;
          plot.ddaHeatmapData = heatmapData;
          plot.showHeatmap = true; // Or manage this separately if needed
        }
      })
      .addCase(fetchDdaHeatmapData.rejected, (state, action) => {
        const { filePath } = action.meta.arg;
        const plot = state.byFilePath[filePath];
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
  setCurrentFilePath,
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
  setDDAResults,
  setShowSettingsDialog,
  cleanupPlotState,
  clearAllPlots,
  restorePlotState,
} = plotsSlice.actions;

export default plotsSlice.reducer;

// Selectors
export const selectPlotStateByPath = (
  state: { plots: PlotsState },
  filePath: string
): PlotState | undefined => {
  const normalizedFilePath = normalizeFilePath(filePath);
  return state.plots.byFilePath[normalizedFilePath];
};

export const selectCurrentFilePath = (state: { plots: PlotsState }) =>
  state.plots.currentFilePath;

export const selectCurrentPlotState = (state: { plots: PlotsState }) => {
  const currentFilePath = state.plots.currentFilePath;
  return currentFilePath ? state.plots.byFilePath[currentFilePath] : undefined;
};

export const selectCurrentEdfData = (state: { plots: PlotsState }) => {
  const currentFilePath = state.plots.currentFilePath;
  return currentFilePath
    ? state.plots.byFilePath[currentFilePath]?.edfData
    : undefined;
};

export const selectCurrentChunkMetadata = (state: { plots: PlotsState }) => {
  const currentFilePath = state.plots.currentFilePath;
  return currentFilePath
    ? state.plots.byFilePath[currentFilePath]?.metadata
    : undefined;
};

export const selectPlotMetadata = (
  state: { plots: PlotsState },
  filePath: string
) => {
  const normalizedFilePath = normalizeFilePath(filePath);
  return state.plots.byFilePath[normalizedFilePath]?.metadata;
};

export const selectPlotEdfData = (
  state: { plots: PlotsState },
  filePath: string
) => {
  const normalizedFilePath = normalizeFilePath(filePath);
  return state.plots.byFilePath[normalizedFilePath]?.edfData;
};

export const selectPlotSelectedChannels = (
  state: { plots: PlotsState },
  filePath: string
) => {
  const normalizedFilePath = normalizeFilePath(filePath);
  return state.plots.byFilePath[normalizedFilePath]?.selectedChannels;
};
