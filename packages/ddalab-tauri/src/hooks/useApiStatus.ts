import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TauriService } from "@/services/tauriService";

export interface ApiStatus {
  running: boolean;
  port: number;
  url?: string;
  is_local_server_running?: boolean;
}

export interface ApiHealth {
  status: string;
  healthy: boolean;
  health?: any;
  error?: string;
}

export interface ApiConfig {
  use_https?: boolean;
  port?: number;
}

// Query keys factory for API status
export const apiStatusKeys = {
  all: ["apiStatus"] as const,
  status: () => [...apiStatusKeys.all, "status"] as const,
  health: (url: string) => [...apiStatusKeys.all, "health", url] as const,
  config: () => [...apiStatusKeys.all, "config"] as const,
};

// Get API status with automatic polling
export function useApiStatus(options?: {
  enabled?: boolean;
  refetchInterval?: number;
}) {
  return useQuery({
    queryKey: apiStatusKeys.status(),
    queryFn: async (): Promise<ApiStatus | null> => {
      if (!TauriService.isTauri()) {
        return null;
      }

      try {
        const status = await TauriService.getApiStatus();
        return status
          ? {
              running: status.is_local_server_running ?? true,
              port: status.port || 8765,
              url: status.url,
              is_local_server_running: status.is_local_server_running,
            }
          : null;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 1000, // 5 seconds
    gcTime: 30 * 1000, // 30 seconds
    refetchInterval: options?.refetchInterval ?? 10 * 1000, // Poll every 10 seconds by default
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? TauriService.isTauri(),
  });
}

// Get API health status
export function useApiHealth(
  apiUrl: string | null | undefined,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
  },
) {
  return useQuery({
    queryKey: apiUrl
      ? apiStatusKeys.health(apiUrl)
      : ["apiStatus", "health", "null"],
    queryFn: async (): Promise<ApiHealth> => {
      if (!apiUrl || !TauriService.isTauri()) {
        return {
          status: "unavailable",
          healthy: false,
          error: "API URL not available",
        };
      }

      try {
        const connected = await TauriService.checkApiConnection(apiUrl);
        return {
          status: connected ? "healthy" : "error",
          healthy: connected,
          error: connected ? undefined : "API not reachable",
        };
      } catch (error) {
        return {
          status: "error",
          healthy: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    staleTime: 5 * 1000, // 5 seconds
    gcTime: 30 * 1000, // 30 seconds
    refetchInterval: options?.refetchInterval ?? 10 * 1000, // Poll every 10 seconds
    enabled: options?.enabled ?? (!!apiUrl && TauriService.isTauri()),
  });
}

// Get API configuration
export function useApiConfig() {
  return useQuery({
    queryKey: apiStatusKeys.config(),
    queryFn: async (): Promise<ApiConfig | null> => {
      if (!TauriService.isTauri()) {
        return null;
      }

      try {
        const config = await TauriService.getApiConfig();
        return config;
      } catch {
        return null;
      }
    },
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    enabled: TauriService.isTauri(),
  });
}

// Combined hook for status and health
export function useApiStatusWithHealth(options?: {
  enabled?: boolean;
  refetchInterval?: number;
}) {
  const statusQuery = useApiStatus({
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
  });

  const healthQuery = useApiHealth(statusQuery.data?.url, {
    enabled: options?.enabled && !!statusQuery.data?.url,
    refetchInterval: options?.refetchInterval,
  });

  return {
    status: statusQuery.data,
    health: healthQuery.data,
    isLoading: statusQuery.isLoading || healthQuery.isLoading,
    isError: statusQuery.isError || healthQuery.isError,
    error: statusQuery.error || healthQuery.error,
    refetchStatus: statusQuery.refetch,
    refetchHealth: healthQuery.refetch,
    refetchAll: () => {
      statusQuery.refetch();
      healthQuery.refetch();
    },
  };
}

// Mutation to start local API server
export function useStartLocalApiServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!TauriService.isTauri()) {
        throw new Error("API server control only available in Tauri");
      }
      await TauriService.startLocalApiServer();
      // Wait a bit for server to start
      await new Promise((resolve) => setTimeout(resolve, 1000));
    },
    onSuccess: () => {
      // Invalidate and refetch status
      queryClient.invalidateQueries({ queryKey: apiStatusKeys.status() });
    },
  });
}

// Mutation to stop local API server
export function useStopLocalApiServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!TauriService.isTauri()) {
        throw new Error("API server control only available in Tauri");
      }
      await TauriService.stopLocalApiServer();
    },
    onSuccess: () => {
      // Update status immediately
      queryClient.setQueryData<ApiStatus | null>(
        apiStatusKeys.status(),
        (old) => {
          if (!old) return null;
          return {
            ...old,
            running: false,
            is_local_server_running: false,
          };
        },
      );
      // Also invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: apiStatusKeys.status() });
    },
  });
}

// Cache invalidation helper
export function useInvalidateApiStatus() {
  const queryClient = useQueryClient();

  return {
    invalidateStatus: () =>
      queryClient.invalidateQueries({ queryKey: apiStatusKeys.status() }),
    invalidateHealth: (url: string) =>
      queryClient.invalidateQueries({ queryKey: apiStatusKeys.health(url) }),
    invalidateConfig: () =>
      queryClient.invalidateQueries({ queryKey: apiStatusKeys.config() }),
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: apiStatusKeys.all }),
  };
}
