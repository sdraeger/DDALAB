import { useState, useCallback, useEffect, useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import { PlotAnnotation } from '@/types/annotations'
import { DDAResult } from '@/types/api'
import { timeSeriesAnnotationToDDA } from '@/utils/annotationSync'
import { useAvailablePlots } from './useAvailablePlots'

interface UseTimeSeriesAnnotationsOptions {
  filePath: string
  channel?: string
}

interface UseDDAAnnotationsOptions {
  resultId: string
  variantId: string
  plotType: 'heatmap' | 'line'
  ddaResult: DDAResult
  sampleRate: number
}

export const useTimeSeriesAnnotations = ({ filePath, channel }: UseTimeSeriesAnnotationsOptions) => {
  const addTimeSeriesAnnotation = useAppStore(state => state.addTimeSeriesAnnotation)
  const updateTimeSeriesAnnotation = useAppStore(state => state.updateTimeSeriesAnnotation)
  const deleteTimeSeriesAnnotation = useAppStore(state => state.deleteTimeSeriesAnnotation)
  const availablePlots = useAvailablePlots()

  const annotations = useAppStore(state => {
    const fileAnnotations = state.annotations.timeSeries[filePath]
    if (!fileAnnotations) return []

    let allAnnotations: PlotAnnotation[] = []
    if (channel && fileAnnotations.channelAnnotations?.[channel]) {
      allAnnotations = [...fileAnnotations.globalAnnotations, ...fileAnnotations.channelAnnotations[channel]]
    } else {
      allAnnotations = fileAnnotations.globalAnnotations
    }

    // Filter annotations based on plot visibility
    return allAnnotations.filter(ann => {
      // If no visibility settings, show by default (backwards compatibility)
      if (!ann.visible_in_plots || ann.visible_in_plots.length === 0) return true
      // Check if timeseries plot is in the visibility list
      return ann.visible_in_plots.includes('timeseries')
    })
  })

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    plotPosition: number
    annotation?: PlotAnnotation
  } | null>(null)

  const handleCreateAnnotation = useCallback(
    (position: number, label: string, description?: string, visibleInPlots?: string[]) => {
      const annotation: PlotAnnotation = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        position,
        label,
        description,
        // Default to all plots if not specified
        visible_in_plots: visibleInPlots || availablePlots.map(p => p.id),
        createdAt: new Date().toISOString()
      }
      addTimeSeriesAnnotation(filePath, annotation, channel)
    },
    [filePath, channel, addTimeSeriesAnnotation, availablePlots]
  )

  const handleUpdateAnnotation = useCallback(
    (id: string, label: string, description?: string, visibleInPlots?: string[]) => {
      updateTimeSeriesAnnotation(filePath, id, { label, description, visible_in_plots: visibleInPlots }, channel)
    },
    [filePath, channel, updateTimeSeriesAnnotation]
  )

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      deleteTimeSeriesAnnotation(filePath, id, channel)
    },
    [filePath, channel, deleteTimeSeriesAnnotation]
  )

  const openContextMenu = useCallback(
    (x: number, y: number, plotPosition: number, annotation?: PlotAnnotation) => {
      setContextMenu({ x, y, plotPosition, annotation })
    },
    []
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleAnnotationClick = useCallback(
    (annotation: PlotAnnotation, x: number, y: number) => {
      setContextMenu({ x, y, plotPosition: annotation.position, annotation })
    },
    []
  )

  return {
    annotations,
    contextMenu,
    handleCreateAnnotation,
    handleUpdateAnnotation,
    handleDeleteAnnotation,
    openContextMenu,
    closeContextMenu,
    handleAnnotationClick,
    availablePlots,
    currentPlotId: 'timeseries'
  }
}

export const useDDAAnnotations = ({ resultId, variantId, plotType, ddaResult, sampleRate }: UseDDAAnnotationsOptions) => {
  const addDDAAnnotation = useAppStore(state => state.addDDAAnnotation)
  const updateDDAAnnotation = useAppStore(state => state.updateDDAAnnotation)
  const deleteDDAAnnotation = useAppStore(state => state.deleteDDAAnnotation)
  const addTimeSeriesAnnotation = useAppStore(state => state.addTimeSeriesAnnotation)
  const availablePlots = useAvailablePlots()

  // Get DDA-specific annotations
  const ddaAnnotations = useAppStore(state => {
    const key = `${resultId}_${variantId}_${plotType}`
    return state.annotations.ddaResults[key]?.annotations || []
  })

  // Get timeseries annotations and transform them to DDA coordinates
  const timeSeriesAnnotations = useAppStore(state => {
    const fileAnnotations = state.annotations.timeSeries[ddaResult.file_path]
    return fileAnnotations?.globalAnnotations || []
  })

  // Merge both annotation sets with coordinate transformation
  const annotations = useMemo(() => {
    const currentPlotId = `dda:${variantId}:${plotType === 'heatmap' ? 'heatmap' : 'lineplot'}`

    const transformed = timeSeriesAnnotations
      .filter(ann => {
        // Only include annotations within the DDA result's time range
        const startTime = ddaResult.parameters.start_time || 0
        const endTime = ddaResult.parameters.end_time || Infinity
        return ann.position >= startTime && ann.position <= endTime
      })
      .filter(ann => {
        // Filter based on plot visibility
        if (!ann.visible_in_plots || ann.visible_in_plots.length === 0) return true
        // Check if current DDA plot is in the visibility list
        return ann.visible_in_plots.includes(currentPlotId)
      })
      .map(ann => timeSeriesAnnotationToDDA(ann, ddaResult, sampleRate))
      .filter(ann => {
        // Filter out invalid transformations (position = -1)
        return ann.position >= 0
      })

    // Combine DDA-specific and transformed timeseries annotations
    // Use Map to deduplicate by ID (DDA-specific takes precedence)
    const annotationMap = new Map<string, PlotAnnotation>()

    // Add transformed timeseries first
    transformed.forEach(ann => annotationMap.set(ann.id, ann))

    // Add DDA-specific (overrides transformed if same ID) and filter by plot visibility
    ddaAnnotations
      .filter(ann => {
        if (!ann.visible_in_plots || ann.visible_in_plots.length === 0) return true
        return ann.visible_in_plots.includes(currentPlotId)
      })
      .forEach(ann => annotationMap.set(ann.id, ann))

    return Array.from(annotationMap.values()).sort((a, b) => a.position - b.position)
  }, [timeSeriesAnnotations, ddaAnnotations, ddaResult, sampleRate, variantId, plotType])

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    plotPosition: number
    annotation?: PlotAnnotation
  } | null>(null)

  const handleCreateAnnotation = useCallback(
    (position: number, label: string, description?: string, visibleInPlots?: string[]) => {
      // Convert DDA position (scale value) to timeseries position (seconds)
      // Find the nearest window index for this scale value
      const scales = ddaResult.results.scales || []

      // Find the index of the closest scale value
      let windowIndex = 0
      let minDistance = Math.abs(scales[0] - position)

      for (let i = 1; i < scales.length; i++) {
        const distance = Math.abs(scales[i] - position)
        if (distance < minDistance) {
          minDistance = distance
          windowIndex = i
        }
      }

      const windowStep = ddaResult.parameters.window_step || 1
      const sampleIndex = windowIndex * windowStep
      const timeSeconds = sampleIndex / sampleRate

      const currentPlotId = `dda:${variantId}:${plotType === 'heatmap' ? 'heatmap' : 'lineplot'}`

      console.log('[DDA ANNOTATION] Creating annotation:', {
        scaleValue: position,
        nearestScale: scales[windowIndex],
        windowIndex,
        timeSeconds,
        visibleInPlots
      })

      const annotation: PlotAnnotation = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        position: timeSeconds, // Store in seconds, not scale value
        label,
        description,
        // Default to all plots if not specified
        visible_in_plots: visibleInPlots || availablePlots.map(p => p.id),
        createdAt: new Date().toISOString()
      }

      // Save to timeseries annotations (not DDA-specific)
      // This allows the annotation to show up in all views
      addTimeSeriesAnnotation(ddaResult.file_path, annotation)
    },
    [ddaResult, sampleRate, addTimeSeriesAnnotation, variantId, plotType, availablePlots]
  )

  const handleUpdateAnnotation = useCallback(
    (id: string, label: string, description?: string, visibleInPlots?: string[]) => {
      // Check if this is a transformed timeseries annotation
      if (id.endsWith('_dda')) {
        // Update the original timeseries annotation
        const originalId = id.replace('_dda', '')
        const updateTimeSeriesAnnotation = useAppStore.getState().updateTimeSeriesAnnotation
        updateTimeSeriesAnnotation(ddaResult.file_path, originalId, { label, description, visible_in_plots: visibleInPlots })
      } else {
        // Update DDA-specific annotation
        updateDDAAnnotation(resultId, variantId, plotType, id, { label, description, visible_in_plots: visibleInPlots })
      }
    },
    [ddaResult, resultId, variantId, plotType, updateDDAAnnotation]
  )

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      // Check if this is a transformed timeseries annotation
      if (id.endsWith('_dda')) {
        // Delete the original timeseries annotation
        const originalId = id.replace('_dda', '')
        const deleteTimeSeriesAnnotation = useAppStore.getState().deleteTimeSeriesAnnotation
        deleteTimeSeriesAnnotation(ddaResult.file_path, originalId)
      } else {
        // Delete DDA-specific annotation
        deleteDDAAnnotation(resultId, variantId, plotType, id)
      }
    },
    [ddaResult, resultId, variantId, plotType, deleteDDAAnnotation]
  )

  const openContextMenu = useCallback(
    (x: number, y: number, plotPosition: number, annotation?: PlotAnnotation) => {
      setContextMenu({ x, y, plotPosition, annotation })
    },
    []
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleAnnotationClick = useCallback(
    (annotation: PlotAnnotation, x: number, y: number) => {
      setContextMenu({ x, y, plotPosition: annotation.position, annotation })
    },
    []
  )

  const currentPlotId = useMemo(() => {
    return `dda:${variantId}:${plotType === 'heatmap' ? 'heatmap' : 'lineplot'}`
  }, [variantId, plotType])

  return {
    annotations,
    contextMenu,
    handleCreateAnnotation,
    handleUpdateAnnotation,
    handleDeleteAnnotation,
    openContextMenu,
    closeContextMenu,
    handleAnnotationClick,
    availablePlots,
    currentPlotId
  }
}
