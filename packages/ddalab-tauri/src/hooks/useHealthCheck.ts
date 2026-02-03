import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriBackendService } from "@/services/tauriBackendService";
import { TauriService } from "@/services/tauriService";

export interface HealthCheckResult {
  isHealthy: boolean;
  responseTime: number;
  timestamp: number;
  error?: string;
}

// Query keys factory for health checks
export const healthKeys = {
  all: ["health"] as const,
  check: () => [...healthKeys.all, "check"] as const,
};

// Health check hook with automatic polling
export function useHealthCheck(options?: {
  enabled?: boolean;
  refetchInterval?: number;
  onHealthChange?: (isHealthy: boolean) => void;
}) {
  return useQuery({
    queryKey: healthKeys.check(),
    queryFn: async (): Promise<HealthCheckResult> => {
      const startTime = Date.now();

      try {
        if (TauriService.isTauri()) {
          // In Tauri mode, always healthy (no HTTP server needed)
          // Optionally verify backend is responsive via IPC
          await tauriBackendService.checkHealth();
          const responseTime = Date.now() - startTime;

          return {
            isHealthy: true,
            responseTime,
            timestamp: Date.now(),
          };
        } else {
          // Non-Tauri mode (web browser) - backend service handles health check
          await tauriBackendService.checkHealth();
          const responseTime = Date.now() - startTime;

          return {
            isHealthy: true,
            responseTime,
            timestamp: Date.now(),
          };
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        return {
          isHealthy: false,
          responseTime,
          timestamp: Date.now(),
          error: errorMessage,
        };
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
  });
}

// Health check without polling (manual checks only)
export function useHealthCheckManual() {
  return useQuery({
    queryKey: healthKeys.check(),
    queryFn: async (): Promise<HealthCheckResult> => {
      const startTime = Date.now();

      try {
        if (TauriService.isTauri()) {
          // In Tauri mode, verify backend is responsive via IPC
          await tauriBackendService.checkHealth();
          const responseTime = Date.now() - startTime;

          return {
            isHealthy: true,
            responseTime,
            timestamp: Date.now(),
          };
        } else {
          await tauriBackendService.checkHealth();
          const responseTime = Date.now() - startTime;

          return {
            isHealthy: true,
            responseTime,
            timestamp: Date.now(),
          };
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        return {
          isHealthy: false,
          responseTime,
          timestamp: Date.now(),
          error: errorMessage,
        };
      }
    },
    enabled: false, // Manual only - must call refetch() explicitly
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
}

// Cache invalidation helper
export function useInvalidateHealthCheck() {
  const queryClient = useQueryClient();

  return {
    invalidate: () =>
      queryClient.invalidateQueries({ queryKey: healthKeys.check() }),
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: healthKeys.all }),
    refetch: () => queryClient.refetchQueries({ queryKey: healthKeys.check() }),
  };
}
