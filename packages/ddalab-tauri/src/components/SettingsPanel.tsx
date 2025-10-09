'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Play, Square, RefreshCw, Download, Cloud, Link2, Activity, Search, Lock, Shield } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { TauriService } from '@/services/tauriService'
import { useSync } from '@/hooks/useSync'
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

  // Fetch app version on mount
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
    fetchVersion()
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

  const refreshEmbeddedApiStatus = async () => {
    if (!TauriService.isTauri()) return

    try {
      const [status, health] = await Promise.all([
        TauriService.getEmbeddedApiStatus(),
        TauriService.checkEmbeddedApiHealth()
      ])
      setEmbeddedApiStatus(status)
      setEmbeddedApiHealth(health)
    } catch (error) {
      console.error('Failed to refresh embedded API status:', error)
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
    refreshEmbeddedApiStatus()

    // Auto-start embedded API on component mount
    const autoStartEmbedded = async () => {
      if (!embeddedApiStatus.running && TauriService.isTauri()) {
        try {
          await TauriService.startEmbeddedApiServer()
          await new Promise(resolve => setTimeout(resolve, 1000))
          await refreshEmbeddedApiStatus()
        } catch (error) {
          console.error('Failed to auto-start embedded API:', error)
        }
      }
    }

    // Delay auto-start to ensure state is properly initialized
    setTimeout(autoStartEmbedded, 500)
  }, [embeddedApiStatus.running])

  const handleStartEmbeddedApi = async () => {
    if (!TauriService.isTauri()) return

    try {
      setIsLoading(true)
      await TauriService.startEmbeddedApiServer()
      await new Promise(resolve => setTimeout(resolve, 1000))
      await refreshEmbeddedApiStatus()
    } catch (error) {
      console.error('Failed to start embedded API:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleStopEmbeddedApi = async () => {
    if (!TauriService.isTauri()) return

    try {
      setIsLoading(true)
      await TauriService.stopEmbeddedApiServer()
      await refreshEmbeddedApiStatus()
    } catch (error) {
      console.error('Failed to stop embedded API:', error)
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
    </div>
  )
}
