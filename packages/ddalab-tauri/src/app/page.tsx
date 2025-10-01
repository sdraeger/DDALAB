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
  const { initializeFromTauri, isInitialized, setApiMode } = useAppStore()

  useEffect(() => {
    const tauriDetected = TauriService.isTauri()
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
    if (!isInitialized) {
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
    console.log('Loading preferences, isTauri:', TauriService.isTauri())
    if (TauriService.isTauri()) {
      try {
        console.log('Loading Tauri preferences...')
        const preferences = await TauriService.getAppPreferences()
        console.log('Loaded preferences:', preferences)

        // Check if user has chosen API mode on first launch
        if (!preferences.api_config.has_chosen_mode) {
          console.log('First launch detected - showing API mode setup')
          setShowApiModeSetup(true)
          return
        }

        // User has chosen mode - apply it
        const mode = preferences.api_config.mode || 'embedded'
        setApiMode(mode)
        setApiUrl(preferences.api_config.url)

        console.log('Applied saved API mode:', mode)
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

      // Update app store
      setApiMode(mode)

      // Hide setup screen and continue initialization
      setShowApiModeSetup(false)

      // For embedded mode, start the server
      if (mode === 'embedded') {
        try {
          await TauriService.startEmbeddedApiServer()
          await new Promise(resolve => setTimeout(resolve, 1000))
          setIsApiConnected(true)
        } catch (error) {
          console.error('Failed to start embedded API:', error)
          setIsApiConnected(false)
        }
      } else {
        // For external mode, check connection
        checkApiConnection()
      }
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
