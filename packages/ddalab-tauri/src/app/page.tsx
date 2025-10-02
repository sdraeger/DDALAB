'use client'

import { useState, useEffect } from 'react'
import { TauriService } from '@/services/tauriService'
import { DashboardLayout } from '@/components/DashboardLayout'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { ApiModeSetup } from '@/components/ApiModeSetup'
import { StatePersistenceProvider } from '@/components/StatePersistenceProvider'
import { useAppStore } from '@/store/appStore'

export default function Home() {
  const [isApiConnected, setIsApiConnected] = useState<boolean | null>(null)
  const [apiUrl, setApiUrl] = useState('http://localhost:8000')
  const [isTauri, setIsTauri] = useState(false)
  const [showApiModeSetup, setShowApiModeSetup] = useState(false)
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false)
  const { initializeFromTauri, isInitialized, setApiMode, setServerReady } = useAppStore()

  // Show window once page is loaded (prevents freeze during Next.js compilation)
  useEffect(() => {
    if (TauriService.isTauri()) {
      const showWindow = async () => {
        try {
          const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
          const window = getCurrentWebviewWindow()
          await window.show()
          console.log('[MAIN_WINDOW] Window shown after page load')
        } catch (error) {
          console.error('[MAIN_WINDOW] Failed to show window:', error)
        }
      }
      showWindow()
    }
  }, [])

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
    setIsTauri(tauriDetected)

    // Initialize persistence BEFORE checking API connection
    // ONLY run initialization on the main window (not pop-outs)
    if (!isInitialized && typeof window !== 'undefined' && window.location.pathname === '/') {
      console.log('DEBUG: Forcing persistence initialization for testing...')
      console.log('DEBUG: tauriDetected =', tauriDetected)
      initializeFromTauri()
    }

    loadPreferences()
  }, [isInitialized, initializeFromTauri])

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

        // Check if user has chosen API mode on first launch
        if (!preferences.api_config.has_chosen_mode) {
          console.log('First launch detected - showing API mode setup')
          setShowApiModeSetup(true)
          return
        }

        // User has chosen mode - apply it IMMEDIATELY
        const mode = preferences.api_config.mode || 'embedded'
        console.log('Setting API mode to:', mode)
        setApiMode(mode)

        // Set the correct URL based on mode
        const url = mode === 'embedded' ? 'http://localhost:8765' : preferences.api_config.url
        console.log('Setting API URL to:', url)
        setApiUrl(url)

        // Start embedded server if in embedded mode
        if (mode === 'embedded') {
          try {
            console.log('Starting embedded API server from saved preferences...')
            await TauriService.startEmbeddedApiServer()

            // Wait for server to be ready with exponential backoff
            let retries = 0
            let connected = false
            const maxRetries = 15

            while (retries < maxRetries && !connected) {
              await new Promise(resolve => setTimeout(resolve, Math.min(500 * Math.pow(1.3, retries), 2000)))

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
        }

        console.log('Applied saved API mode:', mode, 'with URL:', url)
      } catch (error) {
        console.error('Failed to load preferences:', error)
        // On error, show setup screen for Tauri
        setShowApiModeSetup(true)
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

  const handleSelectApiMode = async (mode: 'embedded' | 'external', externalUrl?: string) => {
    try {
      console.log('User selected API mode:', mode, 'URL:', externalUrl)

      // Update app store FIRST before anything else
      setApiMode(mode)

      // Save the choice to preferences
      const preferences = await TauriService.getAppPreferences()
      preferences.api_config.mode = mode
      preferences.api_config.has_chosen_mode = true

      if (mode === 'external' && externalUrl) {
        preferences.api_config.url = externalUrl
        setApiUrl(externalUrl)
      } else if (mode === 'embedded') {
        // Embedded API uses local Rust server
        preferences.api_config.url = 'http://localhost:8765'
        setApiUrl('http://localhost:8765')
      }

      await TauriService.saveAppPreferences(preferences)

      // For embedded mode, start the server before showing dashboard
      if (mode === 'embedded') {
        try {
          console.log('Starting embedded API server...')
          await TauriService.startEmbeddedApiServer()

          // Wait for server to be ready with exponential backoff
          let retries = 0
          let connected = false
          const maxRetries = 15
          const serverUrl = 'http://localhost:8765'

          while (retries < maxRetries && !connected) {
            await new Promise(resolve => setTimeout(resolve, Math.min(500 * Math.pow(1.3, retries), 2000)))

            try {
              connected = await TauriService.checkApiConnection(serverUrl)
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
      } else {
        // For external mode, check connection and set server ready
        await checkApiConnection()
        setServerReady(true)  // External API is assumed ready if connection succeeds
      }

      // Hide setup screen AFTER server is ready
      setShowApiModeSetup(false)
    } catch (error) {
      console.error('Failed to save API mode preference:', error)
    }
  }

  // Show API mode setup on first launch (Tauri only)
  if (isTauri && showApiModeSetup) {
    return <ApiModeSetup onSelectMode={handleSelectApiMode} />
  }

  if (isApiConnected === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">
            {isTauri ? 'Initializing desktop app...' : 'Connecting to DDALAB API...'}
          </p>
        </div>
      </div>
    )
  }

  if (!isApiConnected) {
    return (
      <WelcomeScreen
        apiUrl={apiUrl}
        onApiUrlChange={handleApiUrlChange}
        onRetryConnection={checkApiConnection}
      />
    )
  }

  return (
    <StatePersistenceProvider>
      <DashboardLayout apiUrl={apiUrl} />
    </StatePersistenceProvider>
  )
}
