/**
 * Plot state slice
 */

import { TauriService } from "@/services/tauriService";
import { getInitializedFileStateManager } from "@/services/fileStateInitializer";
import { getStatePersistenceService } from "@/services/statePersistenceService";
import { handleError } from "@/utils/errorHandler";
import type { FilePlotState } from "@/types/fileCentricState";
import type { PlotSlice, PlotState, ImmerStateCreator } from "./types";

export const defaultPlotState: PlotState = {
  currentChunk: null,
  chunkSize: 8192,
  chunkStart: 0,
  isPlaying: false,
  playbackSpeed: 1.0,
  amplitude: 1.0,
  showAnnotations: true,
  selectedChannelColors: {},
  chartHeight: 400,
};

export const createPlotSlice: ImmerStateCreator<PlotSlice> = (set, get) => ({
  plot: defaultPlotState,

  setCurrentChunk: (chunk) => {
    set((state) => {
      state.plot.currentChunk = chunk;
    });
  },

  updatePlotState: (updates) => {
    set((state) => {
      // Use spread for partial updates - more idiomatic with Immer
      state.plot = { ...state.plot, ...updates };
    });

    if (TauriService.isTauri()) {
      const { plot, isPersistenceRestored } = get();

      if (!isPersistenceRestored) {
        return;
      }

      const plotState = {
        visible_channels: plot.selectedChannelColors
          ? Object.keys(plot.selectedChannelColors)
          : [],
        time_range: [plot.chunkStart, plot.chunkStart + plot.chunkSize] as [
          number,
          number,
        ],
        amplitude_range: [-100 * plot.amplitude, 100 * plot.amplitude] as [
          number,
          number,
        ],
        zoom_level: 1.0,
        preprocessing: plot.preprocessing,
        annotations: [],
        color_scheme: "default",
        plot_mode: "timeseries" as const,
        filters: {
          chunkSize: plot.chunkSize,
          chunkStart: plot.chunkStart,
          amplitude: plot.amplitude,
          showAnnotations: plot.showAnnotations,
          chartHeight: plot.chartHeight,
        },
      };

      TauriService.updatePlotState(plotState).catch((error) =>
        handleError(error, {
          source: "Plot State Persistence",
          severity: "silent",
        }),
      );

      const { fileManager } = get();
      if (fileManager.selectedFile?.file_path) {
        (async () => {
          try {
            const fileStateManager = getInitializedFileStateManager();
            const filePlotState: FilePlotState = {
              chunkStart: plot.chunkStart,
              chunkSize: plot.chunkSize,
              selectedChannels: fileManager.selectedChannels || [],
              amplitude: plot.amplitude,
              showAnnotations: plot.showAnnotations,
              preprocessing: plot.preprocessing,
              channelColors: plot.selectedChannelColors,
              lastUpdated: new Date().toISOString(),
            };

            await fileStateManager.updateModuleState(
              fileManager.selectedFile!.file_path,
              "plot",
              filePlotState,
            );
          } catch {
            // Silent fail - file state save is non-critical
          }
        })();
      }

      const persistenceService = getStatePersistenceService();
      if (persistenceService) {
        persistenceService.savePlotState(plotState).catch((error) =>
          handleError(error, {
            source: "Plot State Persistence",
            severity: "silent",
          }),
        );
      }
    }
  },

  savePlotData: async (plotData, analysisId) => {
    const service = getStatePersistenceService();
    if (service) {
      await service.savePlotData(plotData, analysisId);
    }
  },
});
