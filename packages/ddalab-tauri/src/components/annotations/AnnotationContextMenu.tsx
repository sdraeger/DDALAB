import React, { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AnnotationContextMenuProps } from '@/types/annotations'

export const AnnotationContextMenu: React.FC<AnnotationContextMenuProps> = ({
  x,
  y,
  plotPosition,
  onCreateAnnotation,
  onClose,
  existingAnnotation,
  onEditAnnotation,
  onDeleteAnnotation
}) => {
  const [label, setLabel] = useState(existingAnnotation?.label || '')
  const [description, setDescription] = useState(existingAnnotation?.description || '')
  const menuRef = useRef<HTMLDivElement>(null)

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!label.trim()) return

    if (existingAnnotation && onEditAnnotation) {
      onEditAnnotation(existingAnnotation.id, label, description)
    } else {
      onCreateAnnotation(plotPosition, label, description)
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
      className="fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg p-4 z-50 min-w-[300px]"
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
