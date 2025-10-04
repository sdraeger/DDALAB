'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Play, Square, RefreshCw, Download, Cloud, Link2, Activity } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { TauriService } from '@/services/tauriService'
import { useSync } from '@/hooks/useSync'

export function SettingsPanel() {
  const { isConnected, isLoading: syncLoading, error: syncError, connect, disconnect } = useSync()

  // Sync configuration state
  const [syncConfig, setSyncConfig] = useState({
    brokerUrl: '',
    userId: '',
    localEndpoint: 'http://localhost:8765'
  })
  const [showSyncConfig, setShowSyncConfig] = useState(false)

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

  const checkForUpdates = async () => {
    if (!TauriService.isTauri()) return

    setIsCheckingUpdate(true)
    setUpdateError(null)

    try {
      const result = await TauriService.checkForUpdates()
      setUpdateInfo(result)
    } catch (error) {
      console.error('Failed to check for updates:', error)
      setUpdateError(error instanceof Error ? error.message : 'Failed to check for updates')
    } finally {
      setIsCheckingUpdate(false)
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

  const handleSyncConnect = async () => {
    if (!syncConfig.brokerUrl || !syncConfig.userId) {
      return
    }

    try {
      await connect({
        broker_url: syncConfig.brokerUrl,
        user_id: syncConfig.userId,
        local_endpoint: syncConfig.localEndpoint
      })
      setShowSyncConfig(false)
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
    <div className="p-6 space-y-6">
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
                  <Button
                    onClick={() => setShowSyncConfig(!showSyncConfig)}
                    variant="outline"
                    size="sm"
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    Configure
                  </Button>
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
                    {updateInfo?.current_version || '0.1.0'}
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
                      {updateInfo.download_url && (
                        <Button
                          onClick={() => window.open(updateInfo.download_url, '_blank')}
                          className="mt-2"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download Update
                        </Button>
                      )}
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
