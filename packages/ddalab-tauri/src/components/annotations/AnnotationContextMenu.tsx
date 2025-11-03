import React, { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AnnotationContextMenuProps } from '@/types/annotations'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

export const AnnotationContextMenu: React.FC<AnnotationContextMenuProps> = ({
  x,
  y,
  plotPosition,
  onCreateAnnotation,
  onClose,
  existingAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  availablePlots,
  currentPlotId
}) => {
  const [label, setLabel] = useState(existingAnnotation?.label || '')
  const [description, setDescription] = useState(existingAnnotation?.description || '')

  // Initialize visible plots - default to current plot if new annotation
  const [visibleInPlots, setVisibleInPlots] = useState<Set<string>>(() => {
    if (existingAnnotation?.visible_in_plots) {
      return new Set(existingAnnotation.visible_in_plots)
    }
    // Default: show in all plots
    return new Set(availablePlots.map(p => p.id))
  })

  const menuRef = useRef<HTMLDivElement>(null)

  // Update state when existingAnnotation changes
  useEffect(() => {
    setLabel(existingAnnotation?.label || '')
    setDescription(existingAnnotation?.description || '')
    if (existingAnnotation?.visible_in_plots) {
      setVisibleInPlots(new Set(existingAnnotation.visible_in_plots))
    } else {
      setVisibleInPlots(new Set(availablePlots.map(p => p.id)))
    }
  }, [existingAnnotation, availablePlots])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const togglePlot = (plotId: string) => {
    setVisibleInPlots(prev => {
      const newSet = new Set(prev)
      if (newSet.has(plotId)) {
        newSet.delete(plotId)
      } else {
        newSet.add(plotId)
      }
      return newSet
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!label.trim()) return

    const plotsArray = Array.from(visibleInPlots)

    // If no plots selected, delete the annotation
    if (plotsArray.length === 0) {
      if (existingAnnotation && onDeleteAnnotation) {
        onDeleteAnnotation(existingAnnotation.id)
      }
      onClose()
      return
    }

    if (existingAnnotation && onEditAnnotation) {
      onEditAnnotation(existingAnnotation.id, label, description, plotsArray)
    } else {
      onCreateAnnotation(plotPosition, label, description, plotsArray)
    }
    onClose()
  }

  const handleDelete = () => {
    if (existingAnnotation && onDeleteAnnotation) {
      onDeleteAnnotation(existingAnnotation.id)
    }
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg p-4 z-50 min-w-[300px] max-w-[400px]"
      style={{
        left: `${x}px`,
        top: `${y}px`
      }}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
            {existingAnnotation ? 'Edit Annotation' : 'Add Annotation'}
          </label>
          <Input
            type="text"
            placeholder="Label (required)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full"
            autoFocus
          />
        </div>
        <div>
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
            className="w-full resize-none border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            rows={3}
          />
        </div>

        <div className="border-t pt-3 space-y-2">
          <Label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            Visible in Plots
          </Label>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {availablePlots.map(plot => (
              <div key={plot.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`plot-${plot.id}`}
                  checked={visibleInPlots.has(plot.id)}
                  onCheckedChange={() => togglePlot(plot.id)}
                />
                <label
                  htmlFor={`plot-${plot.id}`}
                  className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  {plot.label}
                </label>
              </div>
            ))}
          </div>
          {visibleInPlots.size === 0 && (
            <p className="text-xs text-red-500 dark:text-red-400">
              Annotation will be deleted (no plots selected)
            </p>
          )}
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400">
          Position: {plotPosition.toFixed(2)}
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!label.trim()}>
            {existingAnnotation ? 'Update' : 'Add'}
          </Button>
          {existingAnnotation && onDeleteAnnotation && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
            >
              Delete
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
