'use client'

import { useAppStore } from '@/store/appStore'

export function ZoomWrapper({ children }: { children: React.ReactNode }) {
  const zoom = useAppStore((state) => state.ui.zoom)

  return (
    <div
      style={{
        transform: `scale(${zoom})`,
        transformOrigin: 'top left',
        width: `${100 / zoom}%`,
        height: `${100 / zoom}%`,
      }}
    >
      {children}
    </div>
  )
}
