'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Play, Square, RefreshCw, Download, Cloud, Link2, Activity, Search, Lock, Shield, FileText, FolderOpen, Bug } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { TauriService } from '@/services/tauriService'
import { useSync } from '@/hooks/useSync'
import { SessionRecorder } from '@/components/SessionRecorder'
import type { DiscoveredBroker } from '@/types/sync'

export function SettingsPanel() {
  const { isConnected, isLoading: syncLoading, error: syncError, connect, disconnect, discoverBrokers, verifyPassword } = useSync()

  // Sync configuration state
  const [syncConfig, setSyncConfig] = useState({
    brokerUrl: '',
    userId: '',
    localEndpoint: 'http://localhost:8765',
    password: ''
  })
  const [showSyncConfig, setShowSyncConfig] = useState(false)

  // Discovery state
  const [discoveredBrokers, setDiscoveredBrokers] = useState<DiscoveredBroker[]>([])
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [selectedBroker, setSelectedBroker] = useState<DiscoveredBroker | null>(null)

  const [embeddedApiStatus, setEmbeddedApiStatus] = useState<{
    running: boolean
    port: number
    url?: string
  }>({ running: false, port: 8765 })
  const [embeddedApiHealth, setEmbeddedApiHealth] = useState<{
    status: string
    healthy: boolean
    health?: any
    error?: string
  }>({ status: 'unknown', healthy: false })
  const [isLoading, setIsLoading] = useState(false)
  const [appVersion, setAppVersion] = useState<string>('0.1.0')
  const [updateInfo, setUpdateInfo] = useState<{
    available: boolean
    current_version: string
    latest_version?: string
    release_notes?: string
    release_date?: string
    download_url?: string
  } | null>(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [logsPath, setLogsPath] = useState<string>('')

  // NSG (Neuroscience Gateway) state
  const [nsgCredentials, setNsgCredentials] = useState({
    username: '',
    password: '',
    appKey: ''
  })
  const [hasNsgCredentials, setHasNsgCredentials] = useState(false)
  const [nsgConnectionStatus, setNsgConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [nsgError, setNsgError] = useState<string | null>(null)
  const [showNsgPassword, setShowNsgPassword] = useState(false)

  // Fetch app version and logs path on mount
  useEffect(() => {
    const fetchVersion = async () => {
      if (!TauriService.isTauri()) return
      try {
        const version = await TauriService.getAppVersion()
        setAppVersion(version)
      } catch (error) {
        console.error('Failed to fetch app version:', error)
      }
    }

    const fetchLogsPath = async () => {
      if (!TauriService.isTauri()) return
      try {
        const path = await TauriService.getLogsPath()
        setLogsPath(path)
      } catch (error) {
        console.error('Failed to fetch logs path:', error)
      }
    }

    fetchVersion()
    fetchLogsPath()
  }, [])

  // Load NSG credentials on mount
  useEffect(() => {
    const loadNsgCredentials = async () => {
      if (!TauriService.isTauri()) return
      try {
        const hasCredentials = await TauriService.hasNSGCredentials()
        setHasNsgCredentials(hasCredentials)

        if (hasCredentials) {
          const creds = await TauriService.getNSGCredentials()
          if (creds) {
            setNsgCredentials({
              username: creds.username,
              password: creds.password,
              appKey: creds.app_key
            })
          }
        }
      } catch (error) {
        console.error('Failed to load NSG credentials:', error)
      }
    }

    loadNsgCredentials()
  }, [])

  const checkForUpdates = async () => {
    if (!TauriService.isTauri()) return

    console.log('[UPDATE] ========================================')
    console.log('[UPDATE] Starting update check...')
    console.log('[UPDATE] ========================================')

    setIsCheckingUpdate(true)
    setUpdateError(null)

    try {
      console.log('[UPDATE] About to call TauriService.checkNativeUpdate()...')
      const result = await TauriService.checkNativeUpdate()
      console.log('[UPDATE] ========================================')
      console.log('[UPDATE] Successfully received result from checkNativeUpdate')
      console.log('[UPDATE] Raw result from checkNativeUpdate:', result)
      console.log('[UPDATE] Current version:', result.current_version)
      console.log('[UPDATE] Latest version:', result.latest_version)
      console.log('[UPDATE] Update available:', result.available)
      console.log('[UPDATE] ========================================')
      setUpdateInfo(result)
    } catch (error) {
      console.log('[UPDATE] ========================================')
      console.error('[UPDATE] CAUGHT ERROR in checkForUpdates')
      console.error('[UPDATE] Error object:', error)
      console.error('[UPDATE] Error message:', error instanceof Error ? error.message : 'Unknown error')
      console.error('[UPDATE] Error stack:', error instanceof Error ? error.stack : 'No stack')
      console.log('[UPDATE] ========================================')
      setUpdateError(error instanceof Error ? error.message : 'Failed to check for updates')
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  const handleDownloadUpdate = async () => {
    if (!TauriService.isTauri()) return

    setIsDownloading(true)
    setUpdateError(null)

    try {
      await TauriService.downloadAndInstallUpdate()
      // Update installed successfully - prompt to restart
      alert('Update downloaded and installed successfully! Please restart the application to apply the update.')
    } catch (error) {
      console.error('Failed to download update:', error)
      setUpdateError(error instanceof Error ? error.message : 'Failed to download update')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleOpenLogs = async () => {
    if (!TauriService.isTauri()) return

    try {
      await TauriService.openLogsFolder()
    } catch (error) {
      console.error('Failed to open logs folder:', error)
    }
  }

  const handleReportIssue = async () => {
    console.log('[REPORT_ISSUE] Button clicked')

    if (!TauriService.isTauri()) {
      console.log('[REPORT_ISSUE] Not running in Tauri, exiting')
      return
    }

    try {
      console.log('[REPORT_ISSUE] Reading log content...')
      const logsContent = await TauriService.readLogsContent()
      console.log('[REPORT_ISSUE] Log content length:', logsContent.length)

      // Truncate logs if too long (GitHub URL limit is ~8KB)
      const maxLogLength = 5000
      const truncatedLogs = logsContent.length > maxLogLength
        ? logsContent.slice(-maxLogLength) + '\n\n[Note: Log truncated to last 5000 characters]'
        : logsContent

      const issueTitle = encodeURIComponent('Bug Report')
      const issueBody = encodeURIComponent(
        `## Description\n` +
        `<!-- Please describe the issue you encountered -->\n\n` +
        `## Steps to Reproduce\n` +
        `1. \n` +
        `2. \n` +
        `3. \n\n` +
        `## Expected Behavior\n` +
        `<!-- What did you expect to happen? -->\n\n` +
        `## Actual Behavior\n` +
        `<!-- What actually happened? -->\n\n` +
        `## System Information\n` +
        `- OS: ${navigator.platform}\n` +
        `- Version: ${appVersion || 'Unknown'}\n\n` +
        `## Application Logs\n` +
        `<details>\n` +
        `<summary>Click to expand logs</summary>\n\n` +
        `\`\`\`\n` +
        `${truncatedLogs}\n` +
        `\`\`\`\n` +
        `</details>`
      )

      const githubUrl = `https://github.com/sdraeger/DDALAB/issues/new?title=${issueTitle}&body=${issueBody}`
      console.log('[REPORT_ISSUE] GitHub URL length:', githubUrl.length)
      console.log('[REPORT_ISSUE] Opening GitHub issue...')

      // Use Tauri shell plugin to open URL in browser
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(githubUrl)
      console.log('[REPORT_ISSUE] URL opened successfully via Tauri shell')
    } catch (error) {
      console.error('[REPORT_ISSUE] Failed to create GitHub issue:', error)
    }
  }

  const refreshEmbeddedApiStatus = async () => {
    if (!TauriService.isTauri()) return

    try {
      const apiStatus = await TauriService.getApiStatus()
      const apiUrl = apiStatus?.url || 'http://localhost:8765'
      const connected = await TauriService.checkApiConnection(apiUrl)

      const results = [apiStatus, connected] as const

      // Map the API status to the component state format
      if (apiStatus) {
        setEmbeddedApiStatus({
          running: apiStatus.is_local_server_running || false,
          port: apiStatus.port || 8765,
          url: apiStatus.url
        })
      } else {
        setEmbeddedApiStatus({ running: false, port: 8765 })
      }

      // Update health based on connection status
      if (connected) {
        setEmbeddedApiHealth({
          status: 'healthy',
          healthy: true,
          error: undefined
        })
      } else {
        setEmbeddedApiHealth({
          status: 'error',
          healthy: false,
          error: 'API not reachable'
        })
      }
    } catch (error) {
      console.error('Failed to refresh embedded API status:', error)
      // Set error state if the refresh itself fails
      setEmbeddedApiHealth({
        status: 'error',
        healthy: false,
        error: error instanceof Error ? error.message : 'Failed to check health'
      })
    }
  }

  // Auto-discovery effect
  useEffect(() => {
    if (!TauriService.isTauri()) return

    // Don't run auto-discovery if already connected
    if (isConnected) return

    // Initial discovery
    const performAutoDiscovery = async () => {
      try {
        const brokers = await discoverBrokers(3)
        if (brokers.length > 0) {
          setDiscoveredBrokers(brokers)
        }
      } catch (error) {
        console.error('Auto-discovery failed:', error)
      }
    }

    performAutoDiscovery()

    // Periodic auto-discovery every 60 seconds (reduced frequency)
    const discoveryInterval = setInterval(performAutoDiscovery, 60000)

    return () => clearInterval(discoveryInterval)
  }, [discoverBrokers, isConnected])

  useEffect(() => {
    // Initial status check
    refreshEmbeddedApiStatus()

    // Auto-start embedded API on component mount if not running
    const autoStartEmbedded = async () => {
      // Re-check status to get latest state
      try {
        const status = await TauriService.getApiStatus()
        if (!status && TauriService.isTauri()) {
          await TauriService.startLocalApiServer()
          await new Promise(resolve => setTimeout(resolve, 1000))
          await refreshEmbeddedApiStatus()
        }
      } catch (error) {
        console.error('Failed to auto-start embedded API:', error)
      }
    }

    // Delay auto-start to ensure state is properly initialized
    setTimeout(autoStartEmbedded, 500)

    // Periodic health check every 10 seconds to keep status fresh
    const healthCheckInterval = setInterval(refreshEmbeddedApiStatus, 10000)

    return () => {
      clearInterval(healthCheckInterval)
    }
  }, []) // Run only once on mount

  const handleStartEmbeddedApi = async () => {
    if (!TauriService.isTauri()) return

    try {
      setIsLoading(true)
      await TauriService.startLocalApiServer()
      await new Promise(resolve => setTimeout(resolve, 1000))
      await refreshEmbeddedApiStatus()
    } catch (error) {
      console.error('Failed to start local API:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleStopEmbeddedApi = async () => {
    if (!TauriService.isTauri()) return

    try {
      setIsLoading(true)
      await TauriService.stopLocalApiServer()
      await refreshEmbeddedApiStatus()
    } catch (error) {
      console.error('Failed to stop local API:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDiscoverBrokers = async () => {
    setIsDiscovering(true)
    try {
      // Reduced timeout - discovery now returns early when brokers found
      const brokers = await discoverBrokers(3) // 3 second max, usually ~500ms
      setDiscoveredBrokers(brokers)
      if (brokers.length > 0) {
        setShowSyncConfig(true)
      }
    } catch (error) {
      console.error('Failed to discover brokers:', error)
    } finally {
      setIsDiscovering(false)
    }
  }

  const handleSelectBroker = (broker: DiscoveredBroker) => {
    console.log('Selected broker:', broker)
    console.log('Auth required:', broker.auth_required)
    setSelectedBroker(broker)
    setSyncConfig({
      ...syncConfig,
      brokerUrl: broker.url
    })
    // Show the sync config form so password field appears
    setShowSyncConfig(true)
  }

  const handleSyncConnect = async () => {
    if (!syncConfig.brokerUrl || !syncConfig.userId) {
      return
    }

    // If broker requires auth, verify password first
    if (selectedBroker?.auth_required && syncConfig.password) {
      const isValid = await verifyPassword(syncConfig.password, selectedBroker.auth_hash)
      if (!isValid) {
        console.error('Invalid password for broker')
        return
      }
    }

    try {
      await connect({
        broker_url: syncConfig.brokerUrl,
        user_id: syncConfig.userId,
        local_endpoint: syncConfig.localEndpoint,
        password: syncConfig.password
      })
      setShowSyncConfig(false)
      setDiscoveredBrokers([])
      setSelectedBroker(null)
    } catch (error) {
      console.error('Failed to connect to sync broker:', error)
    }
  }

  const handleSyncDisconnect = async () => {
    try {
      await disconnect()
    } catch (error) {
      console.error('Failed to disconnect from sync broker:', error)
    }
  }

  // NSG handlers
  const handleSaveNsgCredentials = async () => {
    if (!TauriService.isTauri()) return

    if (!nsgCredentials.username || !nsgCredentials.password || !nsgCredentials.appKey) {
      setNsgError('All fields are required')
      return
    }

    try {
      setNsgConnectionStatus('testing')
      setNsgError(null)

      await TauriService.saveNSGCredentials(
        nsgCredentials.username,
        nsgCredentials.password,
        nsgCredentials.appKey
      )

      setHasNsgCredentials(true)
      setNsgConnectionStatus('success')

      setTimeout(() => {
        setNsgConnectionStatus('idle')
      }, 2000)
    } catch (error) {
      setNsgConnectionStatus('error')
      setNsgError(error instanceof Error ? error.message : 'Failed to save credentials')
    }
  }

  const handleTestNsgConnection = async () => {
    if (!TauriService.isTauri()) return

    try {
      setNsgConnectionStatus('testing')
      setNsgError(null)

      const success = await TauriService.testNSGConnection()

      if (success) {
        setNsgConnectionStatus('success')
        setTimeout(() => {
          setNsgConnectionStatus('idle')
        }, 2000)
      } else {
        setNsgConnectionStatus('error')
        setNsgError('Connection test failed')
      }
    } catch (error) {
      setNsgConnectionStatus('error')
      setNsgError(error instanceof Error ? error.message : 'Connection test failed')
    }
  }

  const handleDeleteNsgCredentials = async () => {
    if (!TauriService.isTauri()) return

    try {
      await TauriService.deleteNSGCredentials()
      setHasNsgCredentials(false)
      setNsgCredentials({
        username: '',
        password: '',
        appKey: ''
      })
      setNsgConnectionStatus('idle')
      setNsgError(null)
    } catch (error) {
      setNsgError(error instanceof Error ? error.message : 'Failed to delete credentials')
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">Settings</h2>
        <p className="text-muted-foreground">Configure DDALAB application preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Analysis Engine Status
          </CardTitle>
          <CardDescription>
            Built-in Rust analysis engine - auto-starts when needed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-muted rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Engine Information</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={refreshEmbeddedApiStatus}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>API Endpoint:</span>
                <span className="font-mono text-xs">
                  {embeddedApiStatus.url || 'http://localhost:8765'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Status:</span>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    embeddedApiHealth.healthy ? 'bg-green-500' : 'bg-red-500'
                  }`} />
                  <span className="text-xs">
                    {embeddedApiStatus.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {embeddedApiHealth.error && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Engine Error:</strong> {embeddedApiHealth.error}
              </AlertDescription>
            </Alert>
          )}

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-3">
              Emergency controls (normally not needed):
            </p>
            <div className="flex gap-2">
              <Button
                variant={embeddedApiStatus.running ? "outline" : "default"}
                size="sm"
                onClick={handleStartEmbeddedApi}
                disabled={isLoading || embeddedApiStatus.running}
              >
                <Play className="h-4 w-4 mr-1" />
                Start
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleStopEmbeddedApi}
                disabled={isLoading || !embeddedApiStatus.running}
              >
                <Square className="h-4 w-4 mr-1" />
                Stop
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session Recording */}
      <SessionRecorder />

      {/* Sync Configuration */}
      {TauriService.isTauri() && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="w-5 h-5" />
              Institutional Sync
            </CardTitle>
            <CardDescription>
              Connect to an institutional broker to share analysis results with collaborators
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    isConnected ? 'bg-green-500' : 'bg-gray-300'
                  }`} />
                  <span className="text-sm font-medium">
                    {isConnected ? 'Connected' : 'Not Connected'}
                  </span>
                </div>
                {!isConnected ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={handleDiscoverBrokers}
                      variant="outline"
                      size="sm"
                      disabled={isDiscovering}
                    >
                      <Search className="mr-2 h-4 w-4" />
                      {isDiscovering ? 'Searching...' : 'Discover'}
                    </Button>
                    <Button
                      onClick={() => setShowSyncConfig(!showSyncConfig)}
                      variant="outline"
                      size="sm"
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      Manual
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={handleSyncDisconnect}
                    variant="outline"
                    size="sm"
                    disabled={syncLoading}
                  >
                    Disconnect
                  </Button>
                )}
              </div>

              {/* Discovered Brokers List */}
              {discoveredBrokers.length > 0 && !isConnected && (
                <div className="space-y-2 pt-2 border-t">
                  <h4 className="text-sm font-medium">Discovered Brokers ({discoveredBrokers.length})</h4>
                  {discoveredBrokers.map((broker) => (
                    <div
                      key={broker.url}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedBroker?.url === broker.url
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted'
                      }`}
                      onClick={() => handleSelectBroker(broker)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{broker.institution}</span>
                            {broker.uses_tls && (
                              <span title="Secure (TLS)">
                                <Shield className="h-3 w-3 text-green-600" />
                              </span>
                            )}
                            {broker.auth_required && (
                              <span title="Authentication Required">
                                <Lock className="h-3 w-3 text-amber-600" />
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {broker.url}
                          </div>
                        </div>
                        {selectedBroker?.url === broker.url && (
                          <div className="w-2 h-2 rounded-full bg-primary" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showSyncConfig && (
                <div className="space-y-3 pt-2 border-t">
                  <div className="space-y-2">
                    <Label htmlFor="broker-url">Broker URL</Label>
                    <Input
                      id="broker-url"
                      placeholder="wss://broker.institution.edu"
                      value={syncConfig.brokerUrl}
                      onChange={(e) => setSyncConfig({ ...syncConfig, brokerUrl: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="user-id">User ID</Label>
                    <Input
                      id="user-id"
                      placeholder="your.email@institution.edu"
                      value={syncConfig.userId}
                      onChange={(e) => setSyncConfig({ ...syncConfig, userId: e.target.value })}
                    />
                  </div>
                  {selectedBroker?.auth_required && (
                    <div className="space-y-2">
                      <Label htmlFor="broker-password" className="flex items-center gap-2">
                        <Lock className="h-3 w-3" />
                        Broker Password
                      </Label>
                      <Input
                        id="broker-password"
                        type="password"
                        placeholder="Enter broker password"
                        value={syncConfig.password}
                        onChange={(e) => setSyncConfig({ ...syncConfig, password: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        This broker requires authentication
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="local-endpoint">Local Endpoint</Label>
                    <Input
                      id="local-endpoint"
                      placeholder="http://localhost:8765"
                      value={syncConfig.localEndpoint}
                      onChange={(e) => setSyncConfig({ ...syncConfig, localEndpoint: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Your local API endpoint for peer-to-peer transfers
                    </p>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={handleSyncConnect}
                      disabled={syncLoading || !syncConfig.brokerUrl || !syncConfig.userId}
                    >
                      {syncLoading ? 'Connecting...' : 'Connect'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setShowSyncConfig(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {syncError && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{syncError}</AlertDescription>
                </Alert>
              )}

              {isConnected && (
                <Alert>
                  <AlertDescription>
                    <div className="flex items-center gap-2">
                      <Cloud className="h-4 w-4" />
                      <span>
                        Connected as <strong>{syncConfig.userId}</strong>
                      </span>
                    </div>
                    <p className="text-xs mt-2 text-muted-foreground">
                      You can now share and access analysis results with your collaborators
                    </p>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Update Checker */}
      {TauriService.isTauri() && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              Software Updates
            </CardTitle>
            <CardDescription>Check for updates to DDALAB</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Current Version</p>
                  <p className="text-sm text-muted-foreground">
                    {appVersion}
                  </p>
                </div>
                <Button
                  onClick={checkForUpdates}
                  disabled={isCheckingUpdate}
                  variant="outline"
                >
                  {isCheckingUpdate ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Check for Updates
                    </>
                  )}
                </Button>
              </div>

              {updateError && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{updateError}</AlertDescription>
                </Alert>
              )}

              {updateInfo && !updateInfo.available && (
                <Alert>
                  <AlertDescription>
                    <strong>You're up to date!</strong> You have the latest version of DDALAB.
                  </AlertDescription>
                </Alert>
              )}

              {updateInfo && updateInfo.available && (
                <Alert>
                  <AlertDescription>
                    <div className="space-y-2">
                      <p className="font-medium">
                        <strong>Update Available:</strong> Version {updateInfo.latest_version}
                      </p>
                      {updateInfo.release_date && (
                        <p className="text-sm">
                          Released: {new Date(updateInfo.release_date).toLocaleDateString()}
                        </p>
                      )}
                      {updateInfo.release_notes && (
                        <div className="mt-2 text-sm">
                          <p className="font-medium">Release Notes:</p>
                          <div className="mt-1 max-h-32 overflow-y-auto rounded bg-muted p-2">
                            <pre className="whitespace-pre-wrap text-xs">
                              {updateInfo.release_notes.slice(0, 300)}
                              {updateInfo.release_notes.length > 300 && '...'}
                            </pre>
                          </div>
                        </div>
                      )}
                      <Button
                        onClick={handleDownloadUpdate}
                        disabled={isDownloading}
                        className="mt-2"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        {isDownloading ? 'Downloading...' : 'Download and Install Update'}
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* NSG Configuration */}
      {TauriService.isTauri() && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5" />
              Neuroscience Gateway (NSG)
            </CardTitle>
            <CardDescription>
              Configure credentials for submitting DDA jobs to HPC clusters via NSG
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nsg-username">NSG Username</Label>
                <Input
                  id="nsg-username"
                  type="text"
                  placeholder="your.email@institution.edu"
                  value={nsgCredentials.username}
                  onChange={(e) => setNsgCredentials({ ...nsgCredentials, username: e.target.value })}
                  disabled={hasNsgCredentials}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nsg-password">NSG Password</Label>
                <div className="relative">
                  <Input
                    id="nsg-password"
                    type={showNsgPassword ? 'text' : 'password'}
                    placeholder="Enter your NSG password"
                    value={nsgCredentials.password}
                    onChange={(e) => setNsgCredentials({ ...nsgCredentials, password: e.target.value })}
                    disabled={hasNsgCredentials}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowNsgPassword(!showNsgPassword)}
                    disabled={hasNsgCredentials}
                  >
                    {showNsgPassword ? (
                      <Lock className="h-4 w-4" />
                    ) : (
                      <Shield className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="nsg-appkey">NSG Application Key</Label>
                <Input
                  id="nsg-appkey"
                  type="text"
                  placeholder="Enter your NSG app key"
                  value={nsgCredentials.appKey}
                  onChange={(e) => setNsgCredentials({ ...nsgCredentials, appKey: e.target.value })}
                  disabled={hasNsgCredentials}
                />
              </div>

              {nsgError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{nsgError}</AlertDescription>
                </Alert>
              )}

              {nsgConnectionStatus === 'success' && (
                <Alert className="bg-green-50 border-green-200">
                  <AlertDescription className="text-green-800">
                    {hasNsgCredentials ? 'Connection successful!' : 'Credentials saved successfully!'}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                {!hasNsgCredentials ? (
                  <Button
                    onClick={handleSaveNsgCredentials}
                    disabled={nsgConnectionStatus === 'testing' || !nsgCredentials.username || !nsgCredentials.password || !nsgCredentials.appKey}
                  >
                    {nsgConnectionStatus === 'testing' ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Credentials'
                    )}
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={handleTestNsgConnection}
                      variant="outline"
                      disabled={nsgConnectionStatus === 'testing'}
                    >
                      {nsgConnectionStatus === 'testing' ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Link2 className="mr-2 h-4 w-4" />
                          Test Connection
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleDeleteNsgCredentials}
                      variant="destructive"
                      disabled={nsgConnectionStatus === 'testing'}
                    >
                      Delete Credentials
                    </Button>
                  </>
                )}
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  NSG credentials are encrypted and stored securely in your system keyring.
                </p>
                <p>
                  To get NSG credentials, visit{' '}
                  <a
                    href="https://www.nsgportal.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    nsgportal.org
                  </a>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Debug Information */}
      {TauriService.isTauri() && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Debug Information
            </CardTitle>
            <CardDescription>
              View application logs and debug information
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Logs Location</Label>
                <div className="p-3 bg-muted rounded-lg">
                  <code className="text-xs break-all">{logsPath || 'Loading...'}</code>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={handleOpenLogs}
                  variant="outline"
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  View Logs
                </Button>
                <Button
                  onClick={handleReportIssue}
                  variant="outline"
                >
                  <Bug className="mr-2 h-4 w-4" />
                  Report Issue
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
