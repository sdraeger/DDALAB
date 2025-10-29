'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Activity, Play, Square, RefreshCw } from 'lucide-react'
import {
  useApiStatus,
  useStartLocalApiServer,
  useStopLocalApiServer,
} from '@/hooks/useApiStatus'

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
  // TanStack Query hooks
  const {
    data: embeddedApiStatus,
    isLoading: isLoadingStatus,
    refetch: refreshStatus,
  } = useApiStatus({
    refetchInterval: 10 * 1000, // Poll every 10 seconds
  })

  const startServerMutation = useStartLocalApiServer()
  const stopServerMutation = useStopLocalApiServer()

  const isLoading = startServerMutation.isPending || stopServerMutation.isPending

  // Derived state for health
  const embeddedApiHealth = {
    status: embeddedApiStatus?.running ? 'running' : 'stopped',
    healthy: embeddedApiStatus?.running || false,
  }

  const handleStartEmbeddedApi = async () => {
    try {
      await startServerMutation.mutateAsync()
    } catch (error) {
      console.error('Failed to start local API:', error)
    }
  }

  const handleStopEmbeddedApi = async () => {
    try {
      await stopServerMutation.mutateAsync()
    } catch (error) {
      console.error('Failed to stop local API:', error)
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
                onClick={() => refreshStatus()}
                disabled={isLoading || isLoadingStatus}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoading || isLoadingStatus ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>API Endpoint:</span>
                <span className="font-mono text-xs">
                  {embeddedApiStatus?.url || 'http://localhost:8765'}
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
                <span>{embeddedApiStatus?.port || 8765}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {embeddedApiStatus?.running ? (
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
