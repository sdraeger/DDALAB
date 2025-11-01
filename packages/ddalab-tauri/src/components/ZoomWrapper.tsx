'use client'

import { useAppStore } from '@/store/appStore'

export function ZoomWrapper({ children }: { children: React.ReactNode }) {
  const zoom = useAppStore((state) => state.ui.zoom)

  return (
    <div
      style={{
        zoom: zoom,
      }}
    >
      {children}
    </div>
  )
}
