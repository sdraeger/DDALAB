import { useState, useEffect, useCallback } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { windowManager, WindowType } from '@/utils/windowManager'

interface UsePopoutWindowsResult {
  openedWindows: string[]
  createWindow: (type: WindowType, id: string, data: any) => Promise<string>
  closeWindow: (windowId: string) => Promise<void>
  updateWindowData: (windowId: string, data: any) => Promise<void>
  toggleWindowLock: (windowId: string) => void
  isWindowLocked: (windowId: string) => boolean
  broadcastToType: (type: WindowType, eventName: string, data: any) => Promise<void>
}

export function usePopoutWindows(): UsePopoutWindowsResult {
  const [openedWindows, setOpenedWindows] = useState<string[]>([])

  useEffect(() => {
    // Sync with window manager state
    const updateOpenedWindows = () => {
      setOpenedWindows(windowManager.getAllWindows())
    }

    // Initial sync
    updateOpenedWindows()

    // Set up interval to sync periodically (windows might be closed externally)
    const interval = setInterval(updateOpenedWindows, 1000)

    return () => {
      clearInterval(interval)
    }
  }, [])

  const createWindow = useCallback(async (type: WindowType, id: string, data: any): Promise<string> => {
    try {
      const windowId = await windowManager.createPopoutWindow(type, id, data)
      setOpenedWindows(prev => [...prev, windowId])
      return windowId
    } catch (error) {
      console.error('Failed to create window:', error)
      throw error
    }
  }, [])

  const closeWindow = useCallback(async (windowId: string): Promise<void> => {
    try {
      await windowManager.closePopoutWindow(windowId)
      setOpenedWindows(prev => prev.filter(id => id !== windowId))
    } catch (error) {
      console.error('Failed to close window:', error)
      throw error
    }
  }, [])

  const updateWindowData = useCallback(async (windowId: string, data: any): Promise<void> => {
    await windowManager.sendDataToWindow(windowId, data)
  }, [])

  const toggleWindowLock = useCallback((windowId: string): void => {
    const state = windowManager.getWindowState(windowId)
    if (state) {
      windowManager.setWindowLock(windowId, !state.isLocked)
    }
  }, [])

  const isWindowLocked = useCallback((windowId: string): boolean => {
    const state = windowManager.getWindowState(windowId)
    return state?.isLocked ?? false
  }, [])

  const broadcastToType = useCallback(async (type: WindowType, eventName: string, data: any): Promise<void> => {
    await windowManager.broadcastToType(type, eventName, data)
  }, [])

  return {
    openedWindows,
    createWindow,
    closeWindow,
    updateWindowData,
    toggleWindowLock,
    isWindowLocked,
    broadcastToType
  }
}

interface UsePopoutListenerResult {
  data: any
  isLocked: boolean
  windowId: string | null
}

export function usePopoutListener(expectedWindowId?: string): UsePopoutListenerResult {
  const [data, setData] = useState<any>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [windowId, setWindowId] = useState<string | null>(null)

  useEffect(() => {
    // Get window ID from URL params if not provided
    let currentWindowId = expectedWindowId
    if (!currentWindowId && typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      currentWindowId = urlParams.get('id') || undefined
    }

    if (!currentWindowId) return

    setWindowId(currentWindowId)

    const listeners: UnlistenFn[] = []

    // Listen for data updates
    const setupDataListener = async () => {
      console.log(`Setting up data listener for window: ${currentWindowId}`)
      const unlisten = await listen(`data-update-${currentWindowId}`, (event: any) => {
        console.log(`Received data update for window: ${currentWindowId}`, event.payload)
        if (!isLocked) {
          setData(event.payload.data)
          console.log(`Updated data for window: ${currentWindowId}`)
        } else {
          console.log(`Window ${currentWindowId} is locked, ignoring data update`)
        }
      })
      listeners.push(unlisten)
    }

    // Listen for lock state changes
    const setupLockListener = async () => {
      const unlisten = await listen(`lock-state-${currentWindowId}`, (event: any) => {
        setIsLocked(event.payload.locked)
      })
      listeners.push(unlisten)
    }

    setupDataListener()
    setupLockListener()

    return () => {
      listeners.forEach(unlisten => unlisten())
    }
  }, [expectedWindowId, isLocked])

  return {
    data,
    isLocked,
    windowId
  }
}