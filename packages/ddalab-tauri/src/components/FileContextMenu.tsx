import React, { useEffect, useRef } from 'react'
import { EDFFileInfo } from '@/types/api'
import { Scissors, ExternalLink, Info } from 'lucide-react'

interface FileContextMenuProps {
  x: number
  y: number
  file: EDFFileInfo
  onClose: () => void
  onSegmentFile: (file: EDFFileInfo) => void
  onOpenInSystemViewer?: (file: EDFFileInfo) => void
  onShowFileInfo?: (file: EDFFileInfo) => void
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  x,
  y,
  file,
  onClose,
  onSegmentFile,
  onOpenInSystemViewer,
  onShowFileInfo,
}) => {
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

  const handleMenuItemClick = (action: () => void) => {
    action()
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1 min-w-[200px]"
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
    >
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">
          {file.file_name}
        </div>
      </div>

      <button
        onClick={() => handleMenuItemClick(() => onSegmentFile(file))}
        className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
      >
        <Scissors className="h-4 w-4" />
        Cut/Extract File
      </button>

      {onOpenInSystemViewer && (
        <button
          onClick={() => handleMenuItemClick(() => onOpenInSystemViewer(file))}
          className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Open in System Viewer
        </button>
      )}

      {onShowFileInfo && (
        <button
          onClick={() => handleMenuItemClick(() => onShowFileInfo(file))}
          className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
        >
          <Info className="h-4 w-4" />
          File Info
        </button>
      )}
    </div>
  )
}
