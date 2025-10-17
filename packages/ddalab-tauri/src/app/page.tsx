'use client'

import { useState, useEffect } from 'react'
import { TauriService } from '@/services/tauriService'
import { DashboardLayout } from '@/components/DashboardLayout'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { StatePersistenceProvider } from '@/components/StatePersistenceProvider'
import { useAppStore } from '@/store/appStore'

export default function Home() {
  // Detect Tauri immediately - don't use state to avoid initial false value
  const isTauri = TauriService.isTauri()

  const [isApiConnected, setIsApiConnected] = useState<boolean | null>(null)
  const [apiUrl, setApiUrl] = useState('https://localhost:8765') // Embedded API with HTTPS
  const [sessionToken, setSessionToken] = useState<string>('')
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false)

  // Use selectors to prevent unnecessary re-renders
  const isInitialized = useAppStore((state) => state.isInitialized)
  const setServerReady = useAppStore((state) => state.setServerReady)

  // Removed excessive render logging

  useEffect(() => {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
    const tauriDetected = TauriService.isTauri()

    console.log('[MAIN_WINDOW] page.tsx useEffect running', {
      pathname,
      isTauri: tauriDetected,
      isInitialized,
      timestamp: new Date().toISOString()
    })

    // CRITICAL: Only run on the main window, not popouts
    if (pathname !== '/') {
      console.log('[MAIN_WINDOW] Skipping initialization - not on main route:', pathname)
      return
    }

    console.log('DEBUG: Tauri detection:', {
      isTauri: tauriDetected,
      hasWindow: typeof window !== 'undefined',
      hasTauriGlobal: typeof window !== 'undefined' && '__TAURI__' in window,
      windowTauri: typeof window !== 'undefined' ? (window as any).__TAURI__ : undefined,
      windowKeys: typeof window !== 'undefined' ? Object.keys(window).filter(k => k.includes('TAURI') || k.includes('tauri')) : [],
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined
    })

    // NOTE: Persistence initialization is handled by StatePersistenceProvider
    // Don't duplicate the call here to avoid double initialization

    loadPreferences()
  }, [isInitialized])

  useEffect(() => {
    // Skip API health check in Tauri - embedded API is always available
    if (isTauri) {
      setIsApiConnected(true)
      return
    }

    if (apiUrl) {
      checkApiConnection()
    }
  }, [apiUrl, isTauri])

  const loadPreferences = async () => {
    // IMPORTANT: Only load preferences on the main window, NOT on pop-outs
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      console.log('Skipping preference loading - not on main window. Path:', window.location.pathname)
      return
    }

    // CRITICAL: Don't reload preferences if already loaded in this session
    if (hasLoadedPreferences) {
      console.log('[MAIN_WINDOW] Preferences already loaded this session, skipping')
      return
    }

    console.log('Loading preferences, isTauri:', TauriService.isTauri())
    if (TauriService.isTauri()) {
      try {
        console.log('Loading Tauri preferences...')
        const preferences = await TauriService.getAppPreferences()
        console.log('Loaded preferences:', preferences)

        // Mark as loaded
        setHasLoadedPreferences(true)

        // Always use embedded API URL with HTTPS (port 8765)
        const url = 'https://localhost:8765'
        console.log('Using embedded API URL:', url)
        setApiUrl(url)

        // Check if API server is already running (for dev workflow)
        try {
          console.log('Checking if API server is already running...')
          const alreadyRunning = await TauriService.checkApiConnection(url)

          if (alreadyRunning) {
            console.log('✅ API server already running, skipping startup')
            setIsApiConnected(true)
            setServerReady(true)
            return
          }
        } catch (error) {
          // Server not running yet, will start it below
          console.log('API server not running, will start it now')
        }

        // Start embedded API server
        try {
          console.log('🚀 Starting embedded API server...')
          const token = await TauriService.startEmbeddedApiServer()

          if (token) {
            console.log('✅ Received session token from server')
            setSessionToken(token)
          } else {
            console.warn('⚠️ No session token received from server')
          }

          // Wait for server to be ready with exponential backoff
          // Start with immediate check (0ms), then use exponential backoff
          let retries = 0
          let connected = false
          const maxRetries = 15

          while (retries < maxRetries && !connected) {
            // Only delay after first attempt
            if (retries > 0) {
              await new Promise(resolve => setTimeout(resolve, Math.min(200 * Math.pow(1.5, retries - 1), 2000)))
            }

            try {
              connected = await TauriService.checkApiConnection(url)
              if (connected) {
                console.log(`Embedded API server ready after ${retries + 1} attempts`)
                break
              }
            } catch (error) {
              // Server not ready yet, continue retrying
            }

            retries++
          }

          if (connected) {
            console.log('Embedded API server started successfully')
            setIsApiConnected(true)

            // CRITICAL: Add a delay to allow React to process the sessionToken state update
            // and for DashboardLayout's useEffect to run and update the API service with the token.
            // This is necessary because React batches state updates and useEffects run asynchronously.
            // The 250ms delay is sufficient for the token to propagate even with Fast Refresh.
            console.log('[SERVER_INIT] Waiting for token to propagate to API service...')
            await new Promise(resolve => setTimeout(resolve, 250))

            console.log('[SERVER_INIT] Token propagation complete, setting server ready')
            setServerReady(true)  // Signal that server is ready for requests
          } else {
            console.error('Embedded API server failed to respond after', maxRetries, 'retries')
            setIsApiConnected(false)
            setServerReady(false)
          }
        } catch (error) {
          console.error('Failed to start embedded API:', error)
          setIsApiConnected(false)
          setServerReady(false)
        }
      } catch (error) {
        console.error('Failed to load preferences:', error)
        setIsApiConnected(false)
        setServerReady(false)
      }
    } else {
      console.log('Not in Tauri, using default API URL')
    }
  }

  const checkApiConnection = async () => {
    try {
      console.log('Checking API connection to:', apiUrl)
      let connected = false

      if (isTauri) {
        console.log('Using Tauri native API check')
        connected = await TauriService.checkApiConnection(apiUrl)
        console.log('Tauri API check result:', connected)
      } else {
        console.log('Using web fetch API check')
        const response = await fetch(`${apiUrl}/api/health`)
        connected = response.ok
        console.log('Web API check result:', connected, 'Status:', response.status)
      }

      setIsApiConnected(connected)
      console.log('API connection state set to:', connected)

      if (connected && isTauri) {
        await TauriService.setWindowTitle('DDALAB - Connected')
        await TauriService.showNotification('DDALAB', 'Successfully connected to API server')
      } else if (isTauri) {
        await TauriService.setWindowTitle('DDALAB - Disconnected')
      }
    } catch (error) {
      console.error('Failed to connect to API:', error)
      setIsApiConnected(false)

      if (isTauri) {
        await TauriService.setWindowTitle('DDALAB - Disconnected')
      }
    }
  }

  const handleApiUrlChange = async (newUrl: string) => {
    setApiUrl(newUrl)

    if (isTauri) {
      try {
        const preferences = await TauriService.getAppPreferences()
        preferences.api_config.url = newUrl
        await TauriService.saveAppPreferences(preferences)
      } catch (error) {
        console.error('Failed to save API URL:', error)
      }
    }
  }

  // Show loading screen while initializing (same message for both web and Tauri to avoid hydration mismatch)
  if (isApiConnected === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Starting DDALAB...</p>
        </div>
      </div>
    )
  }

  // In web mode, show welcome screen if not connected
  if (!isTauri && !isApiConnected) {
    return (
      <WelcomeScreen
        onApiUrlChange={handleApiUrlChange}
        onRetryConnection={checkApiConnection}
      />
    )
  }

  return (
    <StatePersistenceProvider>
      <DashboardLayout apiUrl={apiUrl} sessionToken={sessionToken} />
    </StatePersistenceProvider>
  )
}
