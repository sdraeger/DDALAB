import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../store";
import { plotStorage, PlotData } from "../lib/utils/indexedDB/plotStorage";

export function usePlotStorage() {
  const dispatch = useAppDispatch();
  const plots = useAppSelector((state) => state.plots);

  // Save plot to IndexedDB when it changes
  const savePlot = useCallback(
    async (filePath: string) => {
      const plot = plots[filePath];
      if (!plot) return;

      try {
        const plotData: PlotData = {
          filePath,
          metadata: plot.metadata,
          edfData: plot.edfData,
          selectedChannels: plot.selectedChannels,
          timeWindow: plot.timeWindow,
          absoluteTimeWindow: plot.absoluteTimeWindow,
          zoomLevel: plot.zoomLevel,
          chunkSizeSeconds: plot.chunkSizeSeconds,
          currentChunkNumber: plot.currentChunkNumber,
          totalChunks: plot.totalChunks,
          chunkStart: plot.chunkStart,
          showHeatmap: plot.showHeatmap,
          ddaResults: plot.ddaResults,
          annotations: plot.annotations || [],
          showSettingsDialog: plot.showSettingsDialog,
          showZoomSettingsDialog: plot.showZoomSettingsDialog,
          preprocessingOptions: plot.preprocessingOptions,
          lastAccessed: Date.now(),
          size: 0, // Will be calculated by storage
        };

        await plotStorage.savePlot(plotData);
        console.log(`Plot saved to IndexedDB: ${filePath}`);
      } catch (error) {
        console.error("Error saving plot to IndexedDB:", error);
      }
    },
    [plots]
  );

  // Load plot from IndexedDB
  const loadPlot = useCallback(async (filePath: string) => {
    try {
      const plotData = await plotStorage.getPlot(filePath);
      if (plotData) {
        // Restore plot state from IndexedDB
        // Note: This would need to be integrated with your Redux actions
        console.log(`Plot loaded from IndexedDB: ${filePath}`);
        return plotData;
      }
    } catch (error) {
      console.error("Error loading plot from IndexedDB:", error);
    }
    return null;
  }, []);

  // Get storage information
  const getStorageInfo = useCallback(async () => {
    return await plotStorage.getStorageInfo();
  }, []);

  // Clean up old plots
  const cleanupStorage = useCallback(async () => {
    try {
      const plots = await plotStorage.getAllPlots();
      const { totalSize, plotCount } = await plotStorage.getStorageInfo();

      console.log(
        `Storage info: ${plotCount} plots, ${Math.round(
          totalSize / 1024 / 1024
        )}MB`
      );

      // You can implement custom cleanup logic here
      return { totalSize, plotCount };
    } catch (error) {
      console.error("Error getting storage info:", error);
      return { totalSize: 0, plotCount: 0 };
    }
  }, []);

  return {
    savePlot,
    loadPlot,
    getStorageInfo,
    cleanupStorage,
  };
}
