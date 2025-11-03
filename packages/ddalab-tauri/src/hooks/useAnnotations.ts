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

  // Get file annotations object from store
  const fileAnnotations = useAppStore(state => state.annotations.timeSeries[filePath])

  // Memoize combined and filtered annotations
  const annotations = useMemo(() => {
    if (!fileAnnotations) return []

    let allAnnotations: PlotAnnotation[] = []
    if (channel && fileAnnotations.channelAnnotations?.[channel]) {
      allAnnotations = [...fileAnnotations.globalAnnotations, ...fileAnnotations.channelAnnotations[channel]]
    } else {
      allAnnotations = fileAnnotations.globalAnnotations || []
    }

    // Filter annotations based on plot visibility
    return allAnnotations.filter(ann => {
      // If no visibility settings, show by default (backwards compatibility)
      if (!ann.visible_in_plots || ann.visible_in_plots.length === 0) return true
      // Check if timeseries plot is in the visibility list
      return ann.visible_in_plots.includes('timeseries')
    })
  }, [fileAnnotations, channel])

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

  // Extract primitive values from ddaResult for stable dependencies
  const startTime = ddaResult.parameters.start_time || 0
  const endTime = ddaResult.parameters.end_time || Infinity
  const filePath = ddaResult.file_path

  // Get DDA-specific annotation object from store (stable reference)
  const key = `${resultId}_${variantId}_${plotType}`
  const ddaAnnotationObj = useAppStore(state => state.annotations.ddaResults[key])

  // Get file annotations object from store (stable reference)
  const fileAnnotations = useAppStore(state => state.annotations.timeSeries[filePath])

  // Memoize the raw annotation arrays
  const ddaAnnotations = useMemo(() => {
    return ddaAnnotationObj?.annotations || []
  }, [ddaAnnotationObj])

  const timeSeriesAnnotations = useMemo(() => {
    return fileAnnotations?.globalAnnotations || []
  }, [fileAnnotations])

  // Merge both annotation sets with coordinate transformation
  const annotations = useMemo(() => {
    const currentPlotId = `dda:${variantId}:${plotType === 'heatmap' ? 'heatmap' : 'lineplot'}`

    // Filter by time range
    const inTimeRange = timeSeriesAnnotations.filter(ann =>
      ann.position >= startTime && ann.position <= endTime
    )

    // Filter by visibility
    const visibleAnnotations = inTimeRange.filter(ann => {
      if (!ann.visible_in_plots || ann.visible_in_plots.length === 0) return true
      return ann.visible_in_plots.includes(currentPlotId)
    })

    // Transform to DDA coordinates
    const transformed = visibleAnnotations
      .map(ann => timeSeriesAnnotationToDDA(ann, ddaResult, sampleRate))
      .filter(ann => ann.position >= 0)

    // Combine DDA-specific and transformed timeseries annotations
    const annotationMap = new Map<string, PlotAnnotation>()

    // Add transformed timeseries first
    transformed.forEach(ann => annotationMap.set(ann.id, ann))

    // Add DDA-specific (overrides transformed if same ID) and filter by plot visibility
    const filteredDDA = ddaAnnotations.filter(ann => {
      if (!ann.visible_in_plots || ann.visible_in_plots.length === 0) return true
      return ann.visible_in_plots.includes(currentPlotId)
    })

    filteredDDA.forEach(ann => annotationMap.set(ann.id, ann))

    return Array.from(annotationMap.values()).sort((a, b) => a.position - b.position)
  }, [
    timeSeriesAnnotations,
    ddaAnnotations,
    startTime,
    endTime,
    resultId,  // Use resultId as proxy for ddaResult changes
    sampleRate,
    variantId,
    plotType,
    ddaResult
  ])

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
      addTimeSeriesAnnotation(filePath, annotation)
    },
    [filePath, sampleRate, addTimeSeriesAnnotation, variantId, plotType, availablePlots, ddaResult]
  )

  const handleUpdateAnnotation = useCallback(
    (id: string, label: string, description?: string, visibleInPlots?: string[]) => {
      // Check if this is a transformed timeseries annotation
      if (id.endsWith('_dda')) {
        // Update the original timeseries annotation
        const originalId = id.replace('_dda', '')
        const updateTimeSeriesAnnotation = useAppStore.getState().updateTimeSeriesAnnotation
        updateTimeSeriesAnnotation(filePath, originalId, { label, description, visible_in_plots: visibleInPlots })
      } else {
        // Update DDA-specific annotation
        updateDDAAnnotation(resultId, variantId, plotType, id, { label, description, visible_in_plots: visibleInPlots })
      }
    },
    [filePath, resultId, variantId, plotType, updateDDAAnnotation]
  )

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      // Check if this is a transformed timeseries annotation
      if (id.endsWith('_dda')) {
        // Delete the original timeseries annotation
        const originalId = id.replace('_dda', '')
        const deleteTimeSeriesAnnotation = useAppStore.getState().deleteTimeSeriesAnnotation
        deleteTimeSeriesAnnotation(filePath, originalId)
      } else {
        // Delete DDA-specific annotation
        deleteDDAAnnotation(resultId, variantId, plotType, id)
      }
    },
    [filePath, resultId, variantId, plotType, deleteDDAAnnotation]
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

  // Debug logging to track annotation retrieval
  useEffect(() => {
    if (annotations.length > 0) {
      console.log('[useDDAAnnotations] Retrieved annotations:', {
        plotType,
        resultId,
        variantId,
        count: annotations.length,
        annotations: annotations.map(a => ({ id: a.id, label: a.label, position: a.position }))
      })
    }
  }, [annotations, plotType, resultId, variantId])

  // Memoize the return object to prevent creating new references on every render
  return useMemo(() => ({
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
  }), [annotations, contextMenu, handleCreateAnnotation, handleUpdateAnnotation, handleDeleteAnnotation, openContextMenu, closeContextMenu, handleAnnotationClick, availablePlots, currentPlotId])
}
