'use client'

import { useEffect, useRef } from 'react'
import { initializeFileStateSystem, isFileStateSystemInitialized } from '@/services/fileStateInitializer'

interface PopoutInitializerProps {
  children: React.ReactNode
}

/**
 * Initializes the FileStateSystem for popout windows
 * This is a lightweight version of StatePersistenceProvider that only handles
 * the FileStateSystem initialization without persistence features.
 */
export function PopoutInitializer({ children }: PopoutInitializerProps) {
  const isInitializedRef = useRef(false)

  useEffect(() => {
    const initialize = async () => {
      // Check if already initialized (may be shared across popouts in same process)
      if (isInitializedRef.current || isFileStateSystemInitialized()) {
        console.log('[PopoutInitializer] FileStateSystem already initialized')
        return
      }

      try {
        console.log('[PopoutInitializer] Initializing FileStateSystem for popout window...')
        await initializeFileStateSystem()
        isInitializedRef.current = true
        console.log('[PopoutInitializer] FileStateSystem initialized successfully')
      } catch (error) {
        console.error('[PopoutInitializer] Failed to initialize FileStateSystem:', error)
      }
    }

    initialize()
  }, [])

  return <>{children}</>
}
