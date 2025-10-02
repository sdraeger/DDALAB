'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Zap, Container, Play, Square, RefreshCw, Download } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { TauriService } from '@/services/tauriService'

export function SettingsPanel() {
  const { ui, setApiMode } = useAppStore()
  console.log('🎨 SettingsPanel rendered, current apiMode:', ui.apiMode)
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

    // Auto-start embedded API if it's the selected mode but not running
    const autoStartEmbedded = async () => {
      if (ui.apiMode === 'embedded' && !embeddedApiStatus.running && TauriService.isTauri()) {
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
  }, [ui.apiMode, embeddedApiStatus.running])

  const handleApiModeChange = async (newMode: 'external' | 'embedded') => {
    console.log('🐛 DEBUG: TauriService.isTauri():', TauriService.isTauri())
    console.log('🐛 DEBUG: window location:', window.location.protocol, window.location.port)
    console.log('🐛 DEBUG: NODE_ENV:', process.env.NODE_ENV)

    if (!TauriService.isTauri()) {
      console.log('🐛 DEBUG: Not in Tauri, setting mode without server management')
      setApiMode(newMode)
      return
    }

    try {
      setIsLoading(true)

      if (newMode === 'embedded') {
        console.log('🐛 DEBUG: Switching to embedded mode, starting server...')
        try {
          console.log('🐛 DEBUG: About to call TauriService.startEmbeddedApiServer()')
          const result = await TauriService.startEmbeddedApiServer()
          console.log('🐛 DEBUG: Server start result:', result)
        } catch (error) {
          console.error('🐛 DEBUG: Start server error:', error)
        }
        await new Promise(resolve => setTimeout(resolve, 2000)) // Wait longer for server to start
        await refreshEmbeddedApiStatus()
      } else if (newMode === 'external' && embeddedApiStatus.running) {
        console.log('Switching to external mode, stopping embedded server...')
        await TauriService.stopEmbeddedApiServer()
        await refreshEmbeddedApiStatus()
      }

      // Save preference
      const preferences = await TauriService.getAppPreferences()
      preferences.api_config.mode = newMode
      await TauriService.saveAppPreferences(preferences)

      setApiMode(newMode)
      console.log('API mode switched to:', newMode)
    } catch (error) {
      console.error('Failed to switch API mode:', error)
    } finally {
      setIsLoading(false)
    }
  }

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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">Settings</h2>
        <p className="text-muted-foreground">Configure DDALAB application preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            API Backend Mode
          </CardTitle>
          <CardDescription>
            Choose how DDALAB connects to the analysis backend
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={ui.apiMode}
            onValueChange={(value) => {
              console.log('🔴 RadioGroup onValueChange triggered with:', value)
              handleApiModeChange(value as 'external' | 'embedded')
            }}
            className="space-y-4"
            disabled={isLoading}
          >
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="embedded" id="embedded" />
                <Label htmlFor="embedded" className="flex items-center gap-2 cursor-pointer">
                  <Zap className="h-4 w-4" />
                  Embedded Engine
                  <Badge variant="secondary">Recommended</Badge>
                </Label>
              </div>
              <p className="text-sm text-muted-foreground ml-6">
                Built-in Rust analysis engine. Fast local processing, data never leaves your computer.
                No setup required.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="external" id="external" />
                <Label htmlFor="external" className="flex items-center gap-2 cursor-pointer">
                  <Container className="h-4 w-4" />
                  External Server
                  <Badge variant="outline">Advanced</Badge>
                </Label>
              </div>
              <p className="text-sm text-muted-foreground ml-6">
                Connect to an external FastAPI backend server.
                Useful for shared team analyses or custom deployments.
              </p>
            </div>
          </RadioGroup>

          <div className="mt-4 p-4 bg-muted rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Current Configuration</h4>
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
                <span>Backend Mode:</span>
                <span className="font-medium capitalize">{ui.apiMode === 'embedded' ? 'Embedded Engine' : 'External Server'}</span>
              </div>
              <div className="flex justify-between">
                <span>API Endpoint:</span>
                <span className="font-mono text-xs">
                  {ui.apiMode === 'embedded'
                    ? embeddedApiStatus.url || 'http://localhost:8765'
                    : 'http://localhost:8000'}
                </span>
              </div>
              {ui.apiMode === 'embedded' && (
                <div className="flex justify-between">
                  <span>Server Status:</span>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      embeddedApiHealth.healthy ? 'bg-green-500' : 'bg-red-500'
                    }`} />
                    <span className="text-xs">
                      {embeddedApiStatus.running ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backend Status</CardTitle>
          <CardDescription>Current status of the selected backend</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {ui.apiMode === 'external' && (
              <div className="text-sm">
                <p className="text-muted-foreground">
                  To start the external backend, run:
                </p>
                <code className="block mt-2 p-2 bg-muted rounded text-xs">
                  ./scripts/start-api-only.sh
                </code>
              </div>
            )}
            {ui.apiMode === 'embedded' && (
              <div className="space-y-3">
                <div className="text-sm">
                  <p className="text-muted-foreground">
                    Manage the embedded API server directly from the application.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={embeddedApiStatus.running ? "secondary" : "default"}
                    size="sm"
                    onClick={async () => {
                      if (!TauriService.isTauri()) return;
                      try {
                        await TauriService.startEmbeddedApiServer();
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await refreshEmbeddedApiStatus();
                      } catch (error) {
                        console.error('Failed to start server:', error);
                      }
                    }}
                    disabled={isLoading}
                  >
                    <Play className="h-4 w-4 mr-1" />
                    Start Server
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStopEmbeddedApi}
                    disabled={isLoading || !embeddedApiStatus.running}
                  >
                    <Square className="h-4 w-4 mr-1" />
                    Stop Server
                  </Button>
                </div>

                {embeddedApiHealth.error && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Server Error:</strong> {embeddedApiHealth.error}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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
