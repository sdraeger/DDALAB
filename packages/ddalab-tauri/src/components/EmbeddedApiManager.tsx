import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle2, XCircle, Loader2, Play, Square, Zap } from 'lucide-react'
import { TauriService } from '@/services/tauriService'

interface EmbeddedApiManagerProps {
  onApiReady?: (apiUrl: string) => void
}

interface EmbeddedApiStatus {
  running: boolean
  port: number
  url?: string
}

interface EmbeddedApiHealth {
  status: string
  healthy: boolean
  health?: any
  error?: string
}

export const EmbeddedApiManager: React.FC<EmbeddedApiManagerProps> = ({ onApiReady }) => {
  const [status, setStatus] = useState<EmbeddedApiStatus | null>(null)
  const [health, setHealth] = useState<EmbeddedApiHealth | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load initial status and auto-start if not running
  useEffect(() => {
    const initializeServer = async () => {
      await checkStatus()

      // Get status to check if server is running
      const currentStatus = await TauriService.getApiStatus()

      // Auto-start server if not running
      if (!currentStatus) {
        console.log('Local API not running, auto-starting...')
        await startServer()
      }
    }

    initializeServer()
  }, [])

  // Auto-refresh status every 10 seconds when running
  useEffect(() => {
    if (status?.running) {
      const interval = setInterval(() => {
        checkStatus()
        checkHealth()
      }, 10000)
      return () => clearInterval(interval)
    }
  }, [status?.running])

  // Notify parent when API becomes ready
  useEffect(() => {
    if (status?.running && health?.healthy && status.url && onApiReady) {
      onApiReady(status.url)
    }
  }, [status, health, onApiReady])

  const checkStatus = async () => {
    try {
      const result = await TauriService.getApiStatus()
      if (result) {
        setStatus({ running: true, port: result.port || 8765, url: result.url })
      } else {
        setStatus({ running: false, port: 8765 })
        setHealth(null)
      }
    } catch (err) {
      console.error('Failed to check API status:', err)
    }
  }

  const checkHealth = async () => {
    try {
      const apiUrl = status?.url || 'http://localhost:8765'
      const connected = await TauriService.checkApiConnection(apiUrl)
      setHealth({
        status: connected ? 'healthy' : 'error',
        healthy: connected,
        error: connected ? undefined : 'API not reachable'
      })
    } catch (err) {
      console.error('Failed to check API health:', err)
    }
  }

  const startServer = async () => {
    try {
      setLoading(true)
      setError(null)

      await TauriService.startLocalApiServer()

      // Wait a bit for the server to start
      await new Promise(resolve => setTimeout(resolve, 2000))

      await checkStatus()
      await checkHealth()

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start local API server')
    } finally {
      setLoading(false)
    }
  }

  const stopServer = async () => {
    try {
      setLoading(true)
      setError(null)

      await TauriService.stopLocalApiServer()
      await checkStatus()
      setHealth(null)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop local API server')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = () => {
    if (!status?.running) {
      return <Badge variant="outline" className="bg-gray-100 text-gray-700">Stopped</Badge>
    }
    if (health?.healthy) {
      return <Badge variant="outline" className="bg-green-100 text-green-700">Running</Badge>
    }
    if (health?.status === 'running') {
      return <Badge variant="outline" className="bg-yellow-100 text-yellow-700">Starting...</Badge>
    }
    return <Badge variant="outline" className="bg-gray-100 text-gray-700">Unknown</Badge>
  }

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-500" />
              Embedded Rust API
              {getStatusBadge()}
            </CardTitle>
            <CardDescription>
              Lightweight built-in API server - No Docker required
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {status?.running && health?.healthy && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              <div className="font-medium">API server is running</div>
              <div className="text-sm mt-1">
                Available at: <code className="bg-green-100 dark:bg-green-900 px-1 py-0.5 rounded">{status.url}</code>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {status?.running && !health?.healthy && (
          <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
            <Loader2 className="h-4 w-4 text-yellow-600 animate-spin" />
            <AlertDescription className="text-yellow-800 dark:text-yellow-200">
              Server is starting up, please wait...
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            <ul className="space-y-1.5 ml-1">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>Fast startup - no dependencies</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>Full EDF file reading and analysis</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>Native performance</span>
              </li>
            </ul>
          </div>

          <div className="flex gap-2 pt-2">
            {!status?.running ? (
              <Button
                onClick={startServer}
                disabled={loading}
                className="flex-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start Embedded API
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={stopServer}
                disabled={loading}
                variant="destructive"
                className="flex-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Stopping...
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4 mr-2" />
                    Stop Server
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
