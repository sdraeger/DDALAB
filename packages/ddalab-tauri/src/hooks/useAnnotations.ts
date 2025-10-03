import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { PlotAnnotation } from '@/types/annotations'

interface UseTimeSeriesAnnotationsOptions {
  filePath: string
  channel?: string
}

interface UseDDAAnnotationsOptions {
  resultId: string
  variantId: string
  plotType: 'heatmap' | 'line'
}

export const useTimeSeriesAnnotations = ({ filePath, channel }: UseTimeSeriesAnnotationsOptions) => {
  const addTimeSeriesAnnotation = useAppStore(state => state.addTimeSeriesAnnotation)
  const updateTimeSeriesAnnotation = useAppStore(state => state.updateTimeSeriesAnnotation)
  const deleteTimeSeriesAnnotation = useAppStore(state => state.deleteTimeSeriesAnnotation)

  const annotations = useAppStore(state => {
    const fileAnnotations = state.annotations.timeSeries[filePath]
    if (!fileAnnotations) return []

    if (channel && fileAnnotations.channelAnnotations?.[channel]) {
      return [...fileAnnotations.globalAnnotations, ...fileAnnotations.channelAnnotations[channel]]
    }
    return fileAnnotations.globalAnnotations
  })

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    plotPosition: number
    annotation?: PlotAnnotation
  } | null>(null)

  const handleCreateAnnotation = useCallback(
    (position: number, label: string, description?: string) => {
      const annotation: PlotAnnotation = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        position,
        label,
        description,
        createdAt: new Date().toISOString()
      }
      addTimeSeriesAnnotation(filePath, annotation, channel)
    },
    [filePath, channel, addTimeSeriesAnnotation]
  )

  const handleUpdateAnnotation = useCallback(
    (id: string, label: string, description?: string) => {
      updateTimeSeriesAnnotation(filePath, id, { label, description }, channel)
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

export const useDDAAnnotations = ({ resultId, variantId, plotType }: UseDDAAnnotationsOptions) => {
  const addDDAAnnotation = useAppStore(state => state.addDDAAnnotation)
  const updateDDAAnnotation = useAppStore(state => state.updateDDAAnnotation)
  const deleteDDAAnnotation = useAppStore(state => state.deleteDDAAnnotation)

  const annotations = useAppStore(state => {
    const key = `${resultId}_${variantId}_${plotType}`
    return state.annotations.ddaResults[key]?.annotations || []
  })

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    plotPosition: number
    annotation?: PlotAnnotation
  } | null>(null)

  const handleCreateAnnotation = useCallback(
    (position: number, label: string, description?: string) => {
      const annotation: PlotAnnotation = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        position,
        label,
        description,
        createdAt: new Date().toISOString()
      }
      addDDAAnnotation(resultId, variantId, plotType, annotation)
    },
    [resultId, variantId, plotType, addDDAAnnotation]
  )

  const handleUpdateAnnotation = useCallback(
    (id: string, label: string, description?: string) => {
      updateDDAAnnotation(resultId, variantId, plotType, id, { label, description })
    },
    [resultId, variantId, plotType, updateDDAAnnotation]
  )

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      deleteDDAAnnotation(resultId, variantId, plotType, id)
    },
    [resultId, variantId, plotType, deleteDDAAnnotation]
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
