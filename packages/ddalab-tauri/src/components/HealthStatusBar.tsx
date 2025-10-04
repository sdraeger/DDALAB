'use client'

import { useEffect, useCallback } from 'react'
import { useAppStore } from '@/store/appStore'
import { ApiService } from '@/services/apiService'
import { TauriService } from '@/services/tauriService'
import { useSync } from '@/hooks/useSync'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Wifi,
  WifiOff,
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Server,
  Cloud,
  CloudOff
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

interface HealthStatusBarProps {
  apiService: ApiService
}

export function HealthStatusBar({ apiService }: HealthStatusBarProps) {
  const { health, ui, updateHealthStatus } = useAppStore()
  const { isConnected: syncConnected, isLoading: syncLoading } = useSync()

  const checkApiHealth = useCallback(async () => {
    const startTime = Date.now()

    try {
      updateHealthStatus({ apiStatus: 'checking' })

      // For embedded mode in Tauri, use the Tauri command instead of axios
      // This avoids CORS and connection issues during startup
      if (ui.apiMode === 'embedded' && TauriService.isTauri()) {
        const isConnected = await TauriService.checkApiConnection(apiService.baseURL)
        const responseTime = Date.now() - startTime

        if (isConnected) {
          updateHealthStatus({
            apiStatus: 'healthy',
            lastCheck: Date.now(),
            responseTime,
            errors: []
          })
        } else {
          throw new Error('Embedded API server not responding')
        }
      } else {
        // For external mode, use regular HTTP request
        await apiService.checkHealth()
        const responseTime = Date.now() - startTime

        updateHealthStatus({
          apiStatus: 'healthy',
          lastCheck: Date.now(),
          responseTime,
          errors: []
        })
      }
    } catch (error) {
      const responseTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Get current errors from the store to avoid stale closure
      updateHealthStatus((currentHealth) => ({
        apiStatus: 'unhealthy',
        lastCheck: Date.now(),
        responseTime,
        errors: [errorMessage, ...currentHealth.errors.slice(0, 4)] // Keep last 5 errors
      }))
    }
  }, [apiService, ui.apiMode, updateHealthStatus])

  const setupWebSocket = useCallback(() => {
    // WebSocket endpoint not yet implemented in API
    // Keeping infrastructure ready for future implementation
    console.log('WebSocket health monitoring not yet available')
    updateHealthStatus({ websocketConnected: false })
    return null
  }, [updateHealthStatus])

  // Initial health check and setup periodic checks
  // Wait for server to be ready before starting health checks
  useEffect(() => {
    // Don't start health checks until server is ready
    if (!ui.isServerReady) {
      console.log('[HEALTH] Waiting for server to be ready before health checks')
      return
    }

    console.log('[HEALTH] Server ready, starting health checks')

    // Start health check immediately
    checkApiHealth()

    // Setup periodic health checks
    const interval = setInterval(checkApiHealth, 120000) // Check every 2 minutes

    return () => {
      clearInterval(interval)
    }
  }, [ui.isServerReady, checkApiHealth])

  // Setup WebSocket connection
  useEffect(() => {
    // WebSocket setup disabled for now as endpoint not implemented
    // Will enable when backend supports WebSocket health monitoring
  }, [health.apiStatus])

  const getStatusColor = () => {
    switch (health.apiStatus) {
      case 'healthy':
        return 'text-green-600'
      case 'unhealthy':
        return 'text-red-600'
      case 'checking':
        return 'text-yellow-600'
      default:
        return 'text-gray-600'
    }
  }

  const getStatusIcon = () => {
    switch (health.apiStatus) {
      case 'healthy':
        return <CheckCircle className="h-4 w-4" />
      case 'unhealthy':
        return <AlertCircle className="h-4 w-4" />
      case 'checking':
        return <RefreshCw className="h-4 w-4 animate-spin" />
      default:
        return <Server className="h-4 w-4" />
    }
  }

  const formatResponseTime = (time: number) => {
    if (time < 1000) {
      return `${time}ms`
    }
    return `${(time / 1000).toFixed(1)}s`
  }

  return (
    <div className="border-t bg-background p-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center space-x-4">
          {/* API Status */}
          <div className="flex items-center space-x-2">
            <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
              {getStatusIcon()}
              <span className="font-medium">
                API: {health.apiStatus}
              </span>
            </div>

            {health.responseTime > 0 && (
              <Badge variant="outline" className="text-xs">
                {formatResponseTime(health.responseTime)}
              </Badge>
            )}
          </div>

          {/* Sync Broker Status */}
          <div className="flex items-center space-x-1">
            {syncLoading ? (
              <RefreshCw className="h-4 w-4 text-yellow-600 animate-spin" />
            ) : syncConnected ? (
              <Cloud className="h-4 w-4 text-green-600" />
            ) : (
              <CloudOff className="h-4 w-4 text-gray-400" />
            )}
            <span className={syncConnected ? 'text-green-600' : 'text-muted-foreground'}>
              Sync: {syncLoading ? 'connecting...' : syncConnected ? 'connected' : 'offline'}
            </span>
          </div>

          {/* Last Check Time */}
          <div className="flex items-center space-x-1 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              Last: {formatDateTime(new Date(health.lastCheck).toISOString())}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Error Count */}
          {health.errors.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {health.errors.length} error{health.errors.length > 1 ? 's' : ''}
            </Badge>
          )}

          {/* Manual Refresh */}
          <Button
            variant="ghost"
            size="sm"
            onClick={checkApiHealth}
            disabled={health.apiStatus === 'checking'}
            className="h-6 px-2"
          >
            <RefreshCw className={`h-3 w-3 ${health.apiStatus === 'checking' ? 'animate-spin' : ''}`} />
          </Button>

          {/* Activity Indicator */}
          <div className="flex items-center space-x-1">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div className="flex space-x-1">
              {/* API Status Dot */}
              <div className={`w-2 h-2 rounded-full ${
                health.apiStatus === 'healthy' ? 'bg-green-500 animate-pulse' :
                health.apiStatus === 'checking' ? 'bg-yellow-500 animate-pulse' :
                'bg-red-500'
              }`} />
              {/* Sync Broker Status Dot */}
              <div className={`w-2 h-2 rounded-full ${
                syncConnected ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'
              }`} />
            </div>
          </div>
        </div>
      </div>

      {/* Error Messages */}
      {health.errors.length > 0 && (
        <div className="mt-2 text-xs text-red-600">
          <div className="flex items-center space-x-1">
            <AlertCircle className="h-3 w-3" />
            <span>Latest error: {health.errors[0]}</span>
          </div>
        </div>
      )}
    </div>
  )
}
