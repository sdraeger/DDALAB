'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Zap, Container, Play, Square, RefreshCw } from 'lucide-react'
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

  const handleApiModeChange = async (newMode: 'docker' | 'embedded') => {
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
      } else if (newMode === 'docker' && embeddedApiStatus.running) {
        console.log('Switching to docker mode, stopping embedded server...')
        await TauriService.stopEmbeddedApiServer()
        await refreshEmbeddedApiStatus()
      }

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
              handleApiModeChange(value as 'docker' | 'embedded')
            }}
            className="space-y-4"
            disabled={isLoading}
          >
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="docker" id="docker" />
                <Label htmlFor="docker" className="flex items-center gap-2 cursor-pointer">
                  <Container className="h-4 w-4" />
                  Docker Backend
                  <Badge variant="secondary">Current</Badge>
                </Label>
              </div>
              <p className="text-sm text-muted-foreground ml-6">
                Uses the Python FastAPI server running in Docker containers.
                Requires Docker to be installed and running.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="embedded" id="embedded" />
                <Label htmlFor="embedded" className="flex items-center gap-2 cursor-pointer">
                  <Zap className="h-4 w-4" />
                  Embedded Backend
                  <Badge variant="outline">Experimental</Badge>
                </Label>
              </div>
              <p className="text-sm text-muted-foreground ml-6">
                Uses the built-in Rust API server. No Docker required,
                faster performance, but feature set may be limited.
              </p>
            </div>
          </RadioGroup>

          {ui.apiMode === 'embedded' && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Experimental Feature:</strong> The embedded backend is still in development.
                Some features may not work as expected. Switch back to Docker mode if you encounter issues.
              </AlertDescription>
            </Alert>
          )}

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
                <span className="font-medium capitalize">{ui.apiMode}</span>
              </div>
              <div className="flex justify-between">
                <span>API Endpoint:</span>
                <span className="font-mono text-xs">
                  {ui.apiMode === 'docker'
                    ? 'http://localhost:8000'
                    : embeddedApiStatus.url || 'http://localhost:8765'}
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
            {ui.apiMode === 'docker' && (
              <div className="text-sm">
                <p className="text-muted-foreground">
                  To start the Docker backend, run:
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
    </div>
  )
}
