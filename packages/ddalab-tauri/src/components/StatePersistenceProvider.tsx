'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/appStore'
import { listen } from '@tauri-apps/api/event'
import { TauriService } from '@/services/tauriService'

interface StatePersistenceProviderProps {
  children: React.ReactNode
}

/**
 * Provides state persistence functionality throughout the app lifecycle
 */
export function StatePersistenceProvider({ children }: StatePersistenceProviderProps) {
  const { initializeFromTauri, forceSave, saveCurrentState, isInitialized } = useAppStore()
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isInitializedRef = useRef(false)

  useEffect(() => {
    // Initialize state persistence when component mounts
    const initialize = async () => {
      if (!isInitializedRef.current && !isInitialized) {
        try {
          console.log('Initializing state persistence...')
          await initializeFromTauri()
          isInitializedRef.current = true
          console.log('State persistence initialized successfully')
        } catch (error) {
          console.error('Failed to initialize state persistence:', error)
        }
      }
    }

    initialize()
  }, [initializeFromTauri, isInitialized])

  useEffect(() => {
    if (!TauriService.isTauri() || !isInitialized) return

    let isCleaningUp = false

    // Set up window close handler
    const setupWindowCloseHandler = async () => {
      try {
        // Listen for window close events
        const unlistenClose = await listen('tauri://close-requested', async (event) => {
          console.log('Window close requested, saving state...')
          try {
            await saveCurrentState()
            await forceSave()
            console.log('State saved successfully before close')
          } catch (error) {
            console.error('Failed to save state before close:', error)
          }
        })

        // Listen for app focus/blur events to trigger saves
        const unlistenFocus = await listen('tauri://focus', () => {
          console.debug('App gained focus')
        })

        const unlistenBlur = await listen('tauri://blur', async () => {
          console.debug('App lost focus, saving state...')
          try {
            await saveCurrentState()
          } catch (error) {
            console.error('Failed to save state on blur:', error)
          }
        })

        return () => {
          if (!isCleaningUp) {
            unlistenClose()
            unlistenFocus()
            unlistenBlur()
          }
        }
      } catch (error) {
        console.error('Failed to set up window event listeners:', error)
        return () => {}
      }
    }

    // Set up periodic auto-save (as backup to the service's auto-save)
    const setupAutoSave = () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current)
      }

      saveIntervalRef.current = setInterval(async () => {
        try {
          await saveCurrentState()
          console.debug('Periodic state save completed')
        } catch (error) {
          console.error('Periodic state save failed:', error)
        }
      }, 60000) // Save every minute as backup

      return () => {
        if (saveIntervalRef.current) {
          clearInterval(saveIntervalRef.current)
          saveIntervalRef.current = null
        }
      }
    }

    // Set up visibility change handler (for browser-like behavior)
    const setupVisibilityHandler = () => {
      const handleVisibilityChange = async () => {
        if (document.visibilityState === 'hidden') {
          console.debug('App became hidden, saving state...')
          try {
            await saveCurrentState()
          } catch (error) {
            console.error('Failed to save state on visibility change:', error)
          }
        }
      }

      document.addEventListener('visibilitychange', handleVisibilityChange)
      
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }

    // Set up beforeunload handler (for web version compatibility)
    const setupBeforeUnloadHandler = () => {
      const handleBeforeUnload = async (event: BeforeUnloadEvent) => {
        console.log('Before unload, saving state...')
        try {
          // Note: This is synchronous in browsers, but we try async anyway
          await saveCurrentState()
          await forceSave()
        } catch (error) {
          console.error('Failed to save state before unload:', error)
        }
      }

      window.addEventListener('beforeunload', handleBeforeUnload)
      
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload)
      }
    }

    // Initialize all handlers
    const cleanupTasks: (() => void)[] = []
    
    setupWindowCloseHandler().then(cleanup => {
      if (cleanup) cleanupTasks.push(cleanup)
    })
    
    cleanupTasks.push(setupAutoSave())
    cleanupTasks.push(setupVisibilityHandler())
    cleanupTasks.push(setupBeforeUnloadHandler())

    // Cleanup function
    return () => {
      isCleaningUp = true
      cleanupTasks.forEach(cleanup => {
        try {
          cleanup()
        } catch (error) {
          console.error('Error during cleanup:', error)
        }
      })
    }
  }, [isInitialized, saveCurrentState, forceSave])

  // Handle unhandled errors - save state before potential crash
  useEffect(() => {
    const handleError = async (event: ErrorEvent) => {
      console.error('Unhandled error occurred, saving state:', event.error)
      try {
        await saveCurrentState()
        await forceSave()
      } catch (saveError) {
        console.error('Failed to save state after error:', saveError)
      }
    }

    const handlePromiseRejection = async (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection, saving state:', event.reason)
      try {
        await saveCurrentState()
        await forceSave()
      } catch (saveError) {
        console.error('Failed to save state after promise rejection:', saveError)
      }
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handlePromiseRejection)

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handlePromiseRejection)
    }
  }, [saveCurrentState, forceSave])

  return <>{children}</>
}

/**
 * Hook to manually trigger state saves
 */
export function useStatePersistence() {
  const store = useAppStore()
  
  return {
    saveNow: store.saveCurrentState,
    forceSave: store.forceSave,
    clearState: store.clearPersistedState,
    getState: store.getPersistedState,
    createSnapshot: store.createStateSnapshot,
    isInitialized: store.isInitialized
  }
}

/**
 * Hook to save specific data types
 */
export function useDataPersistence() {
  const store = useAppStore()
  
  return {
    savePlotData: store.savePlotData,
    saveAnalysis: store.saveAnalysisResult,
    saveState: store.saveCurrentState
  }
}