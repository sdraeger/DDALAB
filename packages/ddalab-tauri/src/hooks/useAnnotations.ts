import { useState, useCallback, useEffect, useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import { PlotAnnotation, AnnotationSource } from '@/types/annotations'
import { DDAResult } from '@/types/api'
import { timeSeriesAnnotationToDDA } from '@/utils/annotationSync'

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

  const annotations = useAppStore(state => {
    const fileAnnotations = state.annotations.timeSeries[filePath]
    if (!fileAnnotations) return []

    let allAnnotations: PlotAnnotation[] = []
    if (channel && fileAnnotations.channelAnnotations?.[channel]) {
      allAnnotations = [...fileAnnotations.globalAnnotations, ...fileAnnotations.channelAnnotations[channel]]
    } else {
      allAnnotations = fileAnnotations.globalAnnotations
    }

    // Filter annotations based on sync settings
    return allAnnotations.filter(ann => {
      // If sync is enabled or undefined (default), show annotation
      if (ann.sync_enabled === undefined || ann.sync_enabled === true) return true
      // If sync is disabled, only show if annotation was created in timeseries plot
      return ann.created_in?.plot_type === 'timeseries'
    })
  })

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    plotPosition: number
    annotation?: PlotAnnotation
  } | null>(null)

  const handleCreateAnnotation = useCallback(
    (position: number, label: string, description?: string, syncEnabled?: boolean) => {
      const annotation: PlotAnnotation = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        position,
        label,
        description,
        sync_enabled: syncEnabled ?? true,
        created_in: { plot_type: 'timeseries' },
        createdAt: new Date().toISOString()
      }
      addTimeSeriesAnnotation(filePath, annotation, channel)
    },
    [filePath, channel, addTimeSeriesAnnotation]
  )

  const handleUpdateAnnotation = useCallback(
    (id: string, label: string, description?: string, syncEnabled?: boolean) => {
      updateTimeSeriesAnnotation(filePath, id, { label, description, sync_enabled: syncEnabled }, channel)
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
    handleAnnotationClick
  }
}

export const useDDAAnnotations = ({ resultId, variantId, plotType, ddaResult, sampleRate }: UseDDAAnnotationsOptions) => {
  const addDDAAnnotation = useAppStore(state => state.addDDAAnnotation)
  const updateDDAAnnotation = useAppStore(state => state.updateDDAAnnotation)
  const deleteDDAAnnotation = useAppStore(state => state.deleteDDAAnnotation)
  const addTimeSeriesAnnotation = useAppStore(state => state.addTimeSeriesAnnotation)

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
    const transformed = timeSeriesAnnotations
      .filter(ann => {
        // Only include annotations within the DDA result's time range
        const startTime = ddaResult.parameters.start_time || 0
        const endTime = ddaResult.parameters.end_time || Infinity
        return ann.position >= startTime && ann.position <= endTime
      })
      .filter(ann => {
        // Filter based on sync settings
        if (ann.sync_enabled === undefined || ann.sync_enabled === true) return true
        // If sync is disabled, only show if annotation was created in this specific DDA plot
        return ann.created_in?.plot_type === 'dda' &&
               ann.created_in?.variant_id === variantId &&
               ann.created_in?.dda_plot_type === (plotType === 'heatmap' ? 'heatmap' : 'lineplot')
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

    // Add DDA-specific (overrides transformed if same ID) and filter by sync settings
    ddaAnnotations
      .filter(ann => {
        if (ann.sync_enabled === undefined || ann.sync_enabled === true) return true
        // If sync is disabled, only show if annotation was created in this specific DDA plot
        return ann.created_in?.plot_type === 'dda' &&
               ann.created_in?.variant_id === variantId &&
               ann.created_in?.dda_plot_type === (plotType === 'heatmap' ? 'heatmap' : 'lineplot')
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
    (position: number, label: string, description?: string, syncEnabled?: boolean) => {
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

      console.log('[DDA ANNOTATION] Creating annotation:', {
        scaleValue: position,
        nearestScale: scales[windowIndex],
        windowIndex,
        timeSeconds
      })

      const annotation: PlotAnnotation = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        position: timeSeconds, // Store in seconds, not scale value
        label,
        description,
        sync_enabled: syncEnabled ?? true,
        created_in: {
          plot_type: 'dda',
          variant_id: variantId,
          dda_plot_type: plotType === 'heatmap' ? 'heatmap' : 'lineplot'
        },
        createdAt: new Date().toISOString()
      }

      // Save to timeseries annotations (not DDA-specific)
      // This allows the annotation to show up in all views
      addTimeSeriesAnnotation(ddaResult.file_path, annotation)
    },
    [ddaResult, sampleRate, addTimeSeriesAnnotation, variantId, plotType]
  )

  const handleUpdateAnnotation = useCallback(
    (id: string, label: string, description?: string, syncEnabled?: boolean) => {
      // Check if this is a transformed timeseries annotation
      if (id.endsWith('_dda')) {
        // Update the original timeseries annotation
        const originalId = id.replace('_dda', '')
        const updateTimeSeriesAnnotation = useAppStore.getState().updateTimeSeriesAnnotation
        updateTimeSeriesAnnotation(ddaResult.file_path, originalId, { label, description, sync_enabled: syncEnabled })
      } else {
        // Update DDA-specific annotation
        updateDDAAnnotation(resultId, variantId, plotType, id, { label, description, sync_enabled: syncEnabled })
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

  return {
    annotations,
    contextMenu,
    handleCreateAnnotation,
    handleUpdateAnnotation,
    handleDeleteAnnotation,
    openContextMenu,
    closeContextMenu,
    handleAnnotationClick
  }
}
