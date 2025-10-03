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
  const {
    getTimeSeriesAnnotations,
    addTimeSeriesAnnotation,
    updateTimeSeriesAnnotation,
    deleteTimeSeriesAnnotation
  } = useAppStore()

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    plotPosition: number
    annotation?: PlotAnnotation
  } | null>(null)

  const annotations = getTimeSeriesAnnotations(filePath, channel)

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

  return {
    annotations,
    contextMenu,
    handleCreateAnnotation,
    handleUpdateAnnotation,
    handleDeleteAnnotation,
    openContextMenu,
    closeContextMenu
  }
}

export const useDDAAnnotations = ({ resultId, variantId, plotType }: UseDDAAnnotationsOptions) => {
  const {
    getDDAAnnotations,
    addDDAAnnotation,
    updateDDAAnnotation,
    deleteDDAAnnotation
  } = useAppStore()

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    plotPosition: number
    annotation?: PlotAnnotation
  } | null>(null)

  const annotations = getDDAAnnotations(resultId, variantId, plotType)

  // Debug: Log loaded annotations
  useEffect(() => {
    const key = `${resultId}_${variantId}_${plotType}`
    console.log('[ANNOTATION] Loaded annotations:', {
      key,
      count: annotations.length,
      annotations
    })
  }, [resultId, variantId, plotType, annotations])

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

  return {
    annotations,
    contextMenu,
    handleCreateAnnotation,
    handleUpdateAnnotation,
    handleDeleteAnnotation,
    openContextMenu,
    closeContextMenu
  }
}
