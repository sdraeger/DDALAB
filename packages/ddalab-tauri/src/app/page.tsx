'use client'

import { useState, useEffect, useRef } from 'react'
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

  // Use ref to prevent double initialization in React StrictMode
  // This is checked synchronously before async operations, providing immediate protection
  const initializingRef = useRef(false)

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

    // CRITICAL: Synchronous check to prevent double initialization in React StrictMode
    // This ref is checked immediately, before any async operations
    if (initializingRef.current) {
      console.log('[MAIN_WINDOW] Already initializing (caught by ref), skipping duplicate call')
      return
    }
    initializingRef.current = true

    console.log('Loading preferences, isTauri:', TauriService.isTauri())
    if (TauriService.isTauri()) {
      try {
        console.log('Loading Tauri preferences...')
        const preferences = await TauriService.getAppPreferences()
        console.log('Loaded preferences:', preferences)

        // Mark as loaded
        setHasLoadedPreferences(true)

        // Get API config to determine protocol (http vs https)
        const apiConfig = await TauriService.getApiConfig()
        console.log('[INIT] Raw API config:', JSON.stringify(apiConfig, null, 2))

        // CRITICAL: Default to HTTP if use_https is not explicitly true
        // (undefined, null, or false should all result in HTTP)
        const protocol = apiConfig?.use_https === true ? 'https' : 'http'
        const port = apiConfig?.port || 8765
        const url = `${protocol}://localhost:${port}`
        console.log('[INIT] Computed protocol from use_https:', apiConfig?.use_https, '-> protocol:', protocol)
        console.log('[INIT] Final API URL that will be set:', url)
        setApiUrl(url)
        console.log('[INIT] setApiUrl() called with:', url)

        // Check if API server is already running (for dev workflow)
        try {
          console.log('Checking if API server is already running...')
          const alreadyRunning = await TauriService.checkApiConnection(url)

          if (alreadyRunning) {
            console.log('✅ API server already running, loading config...')

            // Get the current API config from state (includes session token from running server)
            const currentConfig = await TauriService.getApiConfig()
            if (currentConfig?.session_token) {
              console.log('✅ Loaded session token from running server')
              setSessionToken(currentConfig.session_token)
              setIsApiConnected(true)
              setServerReady(true)
              return
            } else {
              // Server is running but has no session token (old server from before refactoring)
              // Restart it to initialize with new architecture
              console.warn('⚠️ No session token in server config - restarting server with new architecture...')
              try {
                await TauriService.stopLocalApiServer()
                await new Promise(resolve => setTimeout(resolve, 500)) // Wait for clean shutdown
              } catch (error) {
                console.log('Note: stop server returned error (expected if old server):', error)
              }
              // Fall through to start server below
            }
          }
        } catch (error) {
          // Server not running yet, will start it below
          console.log('API server not running, will start it now')
        }

        // Start local API server
        try {
          console.log('🚀 Starting local API server...')
          const config = await TauriService.startLocalApiServer()

          if (config?.session_token) {
            console.log('✅ Received session token from server')
            setSessionToken(config.session_token)
          } else {
            console.warn('⚠️ No session token received from server')
          }

          // CRITICAL: Update URL with actual port from server (may differ from requested port)
          const actualProtocol = config?.use_https === true ? 'https' : 'http'
          const actualPort = config?.port || 8765
          const actualUrl = `${actualProtocol}://localhost:${actualPort}`
          console.log(`🔄 Server started on actual URL: ${actualUrl} (initial guess was: ${url})`)
          setApiUrl(actualUrl)

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
              connected = await TauriService.checkApiConnection(actualUrl)
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
