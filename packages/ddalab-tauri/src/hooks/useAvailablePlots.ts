import { useMemo, useRef } from "react";
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

  // Keep a stable reference to previous plots to avoid recreating array if content is identical
  const previousPlotsRef = useRef<PlotInfo[]>([]);

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

    // Compare with previous plots to avoid returning new array reference if content is identical
    const previousPlots = previousPlotsRef.current;
    const plotIdsChanged =
      plots.length !== previousPlots.length ||
      plots.some((plot, idx) => plot.id !== previousPlots[idx]?.id);

    if (plotIdsChanged) {
      // Content changed, update ref and return new array
      previousPlotsRef.current = plots;
      return plots;
    }

    // Content identical, return stable reference
    return previousPlots;
  }, [currentFilePath, analysisHistory]);
};
