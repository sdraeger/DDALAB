import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { PlotInfo } from "@/types/annotations";
import { DDAResult } from "@/types/api";

/**
 * Hook to get list of all available plots for annotation visibility control
 * Includes timeseries plot + all DDA result plots for the current file
 */
export const useAvailablePlots = (): PlotInfo[] => {
  // Get current file path
  const currentFilePath = useAppStore(
    (state) => state.fileManager.selectedFile?.file_path,
  );

  // Get analysis history with proper typing
  const analysisHistory = useAppStore(
    (state): DDAResult[] => state.dda.analysisHistory,
  );

  return useMemo(() => {
    const plots: PlotInfo[] = [];

    // Always include timeseries plot
    plots.push({
      id: "timeseries",
      label: "Data Visualization",
    });

    // Include all DDA result plots for the current file
    if (currentFilePath) {
      const fileResults = analysisHistory.filter(
        (r) => r.file_path === currentFilePath,
      );

      for (const result of fileResults) {
        // Add a plot entry for each variant x plot type combination
        for (const variant of result.results.variants) {
          // Heatmap plot
          plots.push({
            id: `dda:${variant.variant_id}:heatmap`,
            label: `${variant.variant_id} - Heatmap (${result.name || result.id.slice(0, 8)})`,
          });

          // Line plot
          plots.push({
            id: `dda:${variant.variant_id}:lineplot`,
            label: `${variant.variant_id} - Line Plot (${result.name || result.id.slice(0, 8)})`,
          });
        }
      }
    }

    return plots;
  }, [currentFilePath, analysisHistory]);
};
