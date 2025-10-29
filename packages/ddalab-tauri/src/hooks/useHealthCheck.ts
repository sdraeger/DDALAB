import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiService } from '@/services/apiService'
import { TauriService } from '@/services/tauriService'

export interface HealthCheckResult {
  isHealthy: boolean
  responseTime: number
  timestamp: number
  error?: string
}

// Query keys factory for health checks
export const healthKeys = {
  all: ['health'] as const,
  check: (baseURL: string) => [...healthKeys.all, 'check', baseURL] as const,
}

// Health check hook with automatic polling
export function useHealthCheck(
  apiService: ApiService,
  options?: {
    enabled?: boolean
    refetchInterval?: number
    onHealthChange?: (isHealthy: boolean) => void
  }
) {
  return useQuery({
    queryKey: healthKeys.check(apiService.baseURL),
    queryFn: async (): Promise<HealthCheckResult> => {
      const startTime = Date.now()

      try {
        // In Tauri, use the Tauri command instead of axios
        // This avoids CORS and connection issues during startup
        if (TauriService.isTauri()) {
          const isConnected = await TauriService.checkApiConnection(apiService.baseURL)
          const responseTime = Date.now() - startTime

          if (!isConnected) {
            throw new Error('Embedded API server not responding')
          }

          return {
            isHealthy: true,
            responseTime,
            timestamp: Date.now(),
          }
        } else {
          // For external mode, use regular HTTP request
          await apiService.checkHealth()
          const responseTime = Date.now() - startTime

          return {
            isHealthy: true,
            responseTime,
            timestamp: Date.now(),
          }
        }
      } catch (error) {
        const responseTime = Date.now() - startTime
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        return {
          isHealthy: false,
          responseTime,
          timestamp: Date.now(),
          error: errorMessage,
        }
      }
    },
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: options?.refetchInterval ?? 120 * 1000, // Poll every 2 minutes by default
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    enabled: options?.enabled ?? true,
    retry: 2,
    retryDelay: 1000,
  })
}

// Health check without polling (manual checks only)
export function useHealthCheckManual(apiService: ApiService) {
  return useQuery({
    queryKey: healthKeys.check(apiService.baseURL),
    queryFn: async (): Promise<HealthCheckResult> => {
      const startTime = Date.now()

      try {
        if (TauriService.isTauri()) {
          const isConnected = await TauriService.checkApiConnection(apiService.baseURL)
          const responseTime = Date.now() - startTime

          if (!isConnected) {
            throw new Error('Embedded API server not responding')
          }

          return {
            isHealthy: true,
            responseTime,
            timestamp: Date.now(),
          }
        } else {
          await apiService.checkHealth()
          const responseTime = Date.now() - startTime

          return {
            isHealthy: true,
            responseTime,
            timestamp: Date.now(),
          }
        }
      } catch (error) {
        const responseTime = Date.now() - startTime
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        return {
          isHealthy: false,
          responseTime,
          timestamp: Date.now(),
          error: errorMessage,
        }
      }
    },
    enabled: false, // Manual only - must call refetch() explicitly
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  })
}

// Cache invalidation helper
export function useInvalidateHealthCheck() {
  const queryClient = useQueryClient()

  return {
    invalidate: (baseURL: string) =>
      queryClient.invalidateQueries({ queryKey: healthKeys.check(baseURL) }),
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: healthKeys.all }),
    refetch: (baseURL: string) =>
      queryClient.refetchQueries({ queryKey: healthKeys.check(baseURL) }),
  }
}
