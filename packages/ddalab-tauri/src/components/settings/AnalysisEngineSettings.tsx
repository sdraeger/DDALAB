'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TauriService } from '@/services/tauriService'
import { Activity, Play, Square, RefreshCw } from 'lucide-react'

interface ApiStatus {
  running: boolean
  port: number
  url?: string
}

interface ApiHealth {
  status: string
  healthy: boolean
  health?: any
  error?: string
}

export function AnalysisEngineSettings() {
  const [embeddedApiStatus, setEmbeddedApiStatus] = useState<ApiStatus>({
    running: false,
    port: 8765,
  })
  const [embeddedApiHealth, setEmbeddedApiHealth] = useState<ApiHealth>({
    status: 'unknown',
    healthy: false,
  })
  const [isLoading, setIsLoading] = useState(false)

  const refreshEmbeddedApiStatus = async () => {
    if (!TauriService.isTauri()) return

    try {
      const status = await TauriService.getApiStatus()
      // Backend returns is_local_server_running, not running
      const running = status?.is_local_server_running || false
      setEmbeddedApiStatus({ running, port: status?.port || 8765, url: status?.url })

      if (running) {
        setEmbeddedApiHealth({ status: 'running', healthy: true })
      } else {
        setEmbeddedApiHealth({ status: 'stopped', healthy: false })
      }
    } catch (error) {
      console.error('Failed to get API status:', error)
      setEmbeddedApiHealth({
        status: 'error',
        healthy: false,
        error: String(error),
      })
    }
  }

  useEffect(() => {
    refreshEmbeddedApiStatus()

    const autoStartEmbedded = async () => {
      try {
        const status = await TauriService.getApiStatus()
        if (!status?.is_local_server_running && TauriService.isTauri()) {
          await TauriService.startLocalApiServer()
          await new Promise(resolve => setTimeout(resolve, 1000))
          await refreshEmbeddedApiStatus()
        }
      } catch (error) {
        console.error('Failed to auto-start embedded API:', error)
      }
    }

    setTimeout(autoStartEmbedded, 500)

    const healthCheckInterval = setInterval(refreshEmbeddedApiStatus, 10000)

    return () => {
      clearInterval(healthCheckInterval)
    }
  }, [])

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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold mb-2">Analysis Engine</h3>
        <p className="text-muted-foreground">
          Built-in Rust analysis engine - auto-starts when needed
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Engine Status
          </CardTitle>
          <CardDescription>
            Monitor and control the embedded analysis engine
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
                  <div
                    className={`w-2 h-2 rounded-full ${
                      embeddedApiHealth.healthy ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="capitalize">{embeddedApiHealth.status}</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span>Port:</span>
                <span>{embeddedApiStatus.port}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {embeddedApiStatus.running ? (
              <Button
                onClick={handleStopEmbeddedApi}
                disabled={isLoading}
                variant="destructive"
              >
                <Square className="h-4 w-4 mr-2" />
                Stop Engine
              </Button>
            ) : (
              <Button onClick={handleStartEmbeddedApi} disabled={isLoading}>
                <Play className="h-4 w-4 mr-2" />
                Start Engine
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
