'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store/appStore'

export function ZoomKeyboardShortcuts() {
  const increaseZoom = useAppStore((state) => state.increaseZoom)
  const decreaseZoom = useAppStore((state) => state.decreaseZoom)
  const resetZoom = useAppStore((state) => state.resetZoom)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCmdOrCtrl = event.metaKey || event.ctrlKey

      if (!isCmdOrCtrl) return

      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        increaseZoom()
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        decreaseZoom()
      } else if (event.key === '0') {
        event.preventDefault()
        resetZoom()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [increaseZoom, decreaseZoom, resetZoom])

  return null
}
