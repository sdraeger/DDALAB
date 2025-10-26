import { useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import { PlotInfo } from '@/types/annotations'

/**
 * Hook to get list of all available plots for annotation visibility control
 * Includes timeseries plot + all DDA result plots for the current file
 */
export const useAvailablePlots = (): PlotInfo[] => {
  const currentFile = useAppStore(state => state.fileManager.selectedFile)
  const analysisHistory = useAppStore(state => state.dda.analysisHistory)

  return useMemo(() => {
    const plots: PlotInfo[] = []

    // Always include timeseries plot
    plots.push({
      id: 'timeseries',
      label: 'Data Visualization'
    })

    // Include all DDA result plots for the current file
    if (currentFile) {
      const fileResults = analysisHistory.filter(r => r.file_path === currentFile.file_path)

      for (const result of fileResults) {
        // Add a plot entry for each variant x plot type combination
        for (const variant of result.results.variants) {
          // Heatmap plot
          plots.push({
            id: `dda:${variant.variant_id}:heatmap`,
            label: `${variant.variant_id} - Heatmap (${result.name || result.id.slice(0, 8)})`
          })

          // Line plot
          plots.push({
            id: `dda:${variant.variant_id}:lineplot`,
            label: `${variant.variant_id} - Line Plot (${result.name || result.id.slice(0, 8)})`
          })
        }
      }
    }

    return plots
  }, [currentFile, analysisHistory])
}
