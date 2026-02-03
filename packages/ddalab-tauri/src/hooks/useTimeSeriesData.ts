import {
  useQuery,
  useQueries,
  useQueryClient,
  UseQueryResult,
  QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { tauriBackendService } from "@/services/tauriBackendService";
import { ChunkData } from "@/types/api";

/**
 * Memory-aware cache limits for time series data
 * These limits prevent unbounded memory growth from EEG chunk caching
 */
const CACHE_LIMITS = {
  /** Maximum number of chunk queries to keep in cache */
  MAX_CHUNK_QUERIES: 15,
  /** Maximum number of overview queries to keep in cache */
  MAX_OVERVIEW_QUERIES: 10,
} as const;

/**
 * Evict oldest chunk queries when cache exceeds limit
 * Uses LRU-style eviction based on query dataUpdatedAt
 */
function evictOldChunkQueries(queryClient: QueryClient, maxQueries: number) {
  const cache = queryClient.getQueryCache();
  const chunkQueries = cache
    .findAll({ queryKey: timeSeriesKeys.chunks() })
    .filter((q) => q.state.data !== undefined);

  if (chunkQueries.length <= maxQueries) return;

  // Sort by last update time (oldest first)
  const sorted = chunkQueries.sort(
    (a, b) => (a.state.dataUpdatedAt || 0) - (b.state.dataUpdatedAt || 0),
  );

  // Remove oldest queries until we're under the limit
  const toRemove = sorted.slice(0, chunkQueries.length - maxQueries);
  for (const query of toRemove) {
    queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
  }

  if (toRemove.length > 0) {
    console.debug(
      `[Cache] Evicted ${toRemove.length} old chunk queries (limit: ${maxQueries})`,
    );
  }
}

/**
 * Evict oldest overview queries when cache exceeds limit
 */
function evictOldOverviewQueries(queryClient: QueryClient, maxQueries: number) {
  const cache = queryClient.getQueryCache();
  const overviewQueries = cache
    .findAll({ queryKey: timeSeriesKeys.overviews() })
    .filter(
      (q) => q.state.data !== undefined && !q.queryKey.includes("progress"), // Don't count progress queries
    );

  if (overviewQueries.length <= maxQueries) return;

  const sorted = overviewQueries.sort(
    (a, b) => (a.state.dataUpdatedAt || 0) - (b.state.dataUpdatedAt || 0),
  );

  const toRemove = sorted.slice(0, overviewQueries.length - maxQueries);
  for (const query of toRemove) {
    queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
  }

  if (toRemove.length > 0) {
    console.debug(
      `[Cache] Evicted ${toRemove.length} old overview queries (limit: ${maxQueries})`,
    );
  }
}

/**
 * Query key factory for time series data
 * Provides consistent cache keys for chunk and overview data
 */
export const timeSeriesKeys = {
  all: ["timeSeries"] as const,
  chunks: () => [...timeSeriesKeys.all, "chunks"] as const,
  chunk: (
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    channels?: string[],
    preprocessing?: {
      highpass?: number;
      lowpass?: number;
      notch?: number[];
    },
  ) =>
    [
      ...timeSeriesKeys.chunks(),
      filePath,
      chunkStart,
      chunkSize,
      channels,
      preprocessing,
    ] as const,
  overviews: () => [...timeSeriesKeys.all, "overviews"] as const,
  overview: (filePath: string, channels?: string[], maxPoints?: number) =>
    [...timeSeriesKeys.overviews(), filePath, channels, maxPoints] as const,
  overviewProgress: (
    filePath: string,
    channels?: string[],
    maxPoints?: number,
  ) =>
    [
      ...timeSeriesKeys.overview(filePath, channels, maxPoints),
      "progress",
    ] as const,
};

/**
 * Hook to fetch chunk data with automatic caching
 *
 * @param filePath - Path to the EDF/CSV file
 * @param chunkStart - Starting sample index
 * @param chunkSize - Number of samples to fetch
 * @param requestedChannels - Channels to load (optional)
 * @param preprocessing - Preprocessing options (optional)
 * @param enabled - Whether to enable the query (default: true)
 *
 * @returns Query result with chunk data
 *
 * @example
 * const { data, isLoading, error } = useChunkData(
 *   '/path/to/file.edf',
 *   0,
 *   1000,
 *   ['Channel 1', 'Channel 2'],
 *   undefined,
 *   true
 * );
 */
export function useChunkData(
  filePath: string,
  chunkStart: number,
  chunkSize: number,
  requestedChannels?: string[],
  preprocessing?: {
    highpass?: number;
    lowpass?: number;
    notch?: number[];
  },
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: timeSeriesKeys.chunk(
      filePath,
      chunkStart,
      chunkSize,
      requestedChannels,
      preprocessing,
    ),
    queryFn: async () => {
      return tauriBackendService.getEdfChunk(
        filePath,
        chunkStart,
        chunkSize,
        requestedChannels,
        preprocessing,
      );
    },
    enabled: enabled && !!filePath && chunkSize > 0,
    staleTime: 2 * 60 * 1000, // 2 minutes - chunk data is immutable but memory-heavy
    gcTime: 5 * 60 * 1000, // 5 minutes - aggressive GC to prevent memory bloat (was 60 min)
    retry: 2,
    refetchOnWindowFocus: false,
  });
  // Note: Cache eviction is handled globally by useTimeSeriesCacheMonitor
}

/**
 * Hook to fetch overview data (downsampled view of entire file)
 *
 * @param filePath - Path to the EDF/CSV file
 * @param requestedChannels - Channels to load (optional)
 * @param maxPoints - Maximum number of points per channel (default: 2000)
 * @param enabled - Whether to enable the query (default: true)
 *
 * @returns Query result with overview data
 *
 * @example
 * const { data, isLoading, error, refetch } = useOverviewData(
 *   '/path/to/file.edf',
 *   ['Channel 1', 'Channel 2'],
 *   2000,
 *   true
 * );
 */
export function useOverviewData(
  filePath: string,
  requestedChannels?: string[],
  maxPoints: number = 2000,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: timeSeriesKeys.overview(filePath, requestedChannels, maxPoints),
    queryFn: async () => {
      return tauriBackendService.getEdfOverview(
        filePath,
        requestedChannels,
        maxPoints,
      );
    },
    enabled: enabled && !!filePath,
    staleTime: 5 * 60 * 1000, // 5 minutes - overview data is immutable
    gcTime: 10 * 60 * 1000, // 10 minutes - moderate GC (was 60 min)
    retry: 1, // Reduced from 2 - fail faster for large files that timeout
    retryDelay: 1000, // Short retry delay (1 second)
    refetchOnWindowFocus: false,
  });
  // Note: Cache eviction is handled globally by useTimeSeriesCacheMonitor
}

export function useOverviewProgress(
  filePath: string,
  requestedChannels?: string[],
  maxPoints: number = 2000,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: timeSeriesKeys.overviewProgress(
      filePath,
      requestedChannels,
      maxPoints,
    ),
    queryFn: async () => {
      return tauriBackendService.getEdfOverviewProgress(
        filePath,
        requestedChannels,
        maxPoints,
      );
    },
    enabled: enabled && !!filePath,
    refetchInterval: (query) => {
      // Poll every 500ms while overview is being generated
      const data = query.state.data;
      if (!data || !data.hasCache || !data.isComplete) {
        return 500;
      }
      // Stop polling once complete
      return false;
    },
    staleTime: 0, // Always fresh
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry on error
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch multiple overviews in parallel (e.g., for multiple channel combinations)
 *
 * @param filePath - Path to the EDF/CSV file
 * @param channelLists - Array of channel combinations to fetch
 * @param maxPoints - Maximum number of points per channel (default: 2000)
 * @param enabled - Whether to enable the queries (default: true)
 *
 * @returns Array of query results
 *
 * @example
 * const overviewQueries = useMultipleOverviews(
 *   '/path/to/file.edf',
 *   [
 *     ['Channel 1'],
 *     ['Channel 2'],
 *     ['Channel 1', 'Channel 2']
 *   ],
 *   2000,
 *   true
 * );
 *
 * // Check if all loaded
 * const allLoaded = overviewQueries.every(q => q.isSuccess);
 */
export function useMultipleOverviews(
  filePath: string,
  channelLists: string[][],
  maxPoints: number = 2000,
  enabled: boolean = true,
): UseQueryResult<ChunkData, Error>[] {
  return useQueries({
    queries: channelLists.map((channels) => ({
      queryKey: timeSeriesKeys.overview(filePath, channels, maxPoints),
      queryFn: async () => {
        return tauriBackendService.getEdfOverview(
          filePath,
          channels,
          maxPoints,
        );
      },
      enabled: enabled && !!filePath,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000, // 10 minutes (was 60 min)
      retry: 2,
      refetchOnWindowFocus: false,
    })),
  });
}

/**
 * Hook to fetch multiple chunks in parallel (e.g., for progressive loading)
 *
 * @param filePath - Path to the EDF/CSV file
 * @param chunkRequests - Array of chunk requests (start, size, channels)
 * @param enabled - Whether to enable the queries (default: true)
 *
 * @returns Array of query results
 *
 * @example
 * const chunkQueries = useMultipleChunks(
 *   '/path/to/file.edf',
 *   [
 *     { start: 0, size: 1000, channels: ['Channel 1'] },
 *     { start: 1000, size: 1000, channels: ['Channel 1'] },
 *     { start: 2000, size: 1000, channels: ['Channel 1'] }
 *   ],
 *   true
 * );
 */
export function useMultipleChunks(
  filePath: string,
  chunkRequests: Array<{
    start: number;
    size: number;
    channels?: string[];
    preprocessing?: {
      highpass?: number;
      lowpass?: number;
      notch?: number[];
    };
  }>,
  enabled: boolean = true,
): UseQueryResult<ChunkData, Error>[] {
  return useQueries({
    queries: chunkRequests.map((request) => ({
      queryKey: timeSeriesKeys.chunk(
        filePath,
        request.start,
        request.size,
        request.channels,
        request.preprocessing,
      ),
      queryFn: async () => {
        return tauriBackendService.getEdfChunk(
          filePath,
          request.start,
          request.size,
          request.channels,
          request.preprocessing,
        );
      },
      enabled: enabled && !!filePath && request.size > 0,
      staleTime: 2 * 60 * 1000,
      gcTime: 5 * 60 * 1000, // 5 minutes (was 60 min)
      retry: 2,
      refetchOnWindowFocus: false,
    })),
  });
}

/**
 * Utility hook to invalidate time series cache
 * Useful when file changes or preprocessing options change
 *
 * @returns Object with cache invalidation functions
 *
 * @example
 * const { invalidateFile, invalidateAllChunks } = useInvalidateTimeSeriesCache();
 *
 * // When file is reloaded
 * invalidateFile('/path/to/file.edf');
 *
 * // When switching files
 * invalidateAllChunks();
 */
export function useInvalidateTimeSeriesCache() {
  const queryClient = useQueryClient();

  return {
    /**
     * Invalidate all time series data for a specific file
     */
    invalidateFile: (filePath: string) => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            Array.isArray(key) &&
            key[0] === "timeSeries" &&
            key.includes(filePath)
          );
        },
      });
    },

    /**
     * Invalidate all chunk data (keep overviews)
     */
    invalidateAllChunks: () => {
      queryClient.invalidateQueries({
        queryKey: timeSeriesKeys.chunks(),
      });
    },

    /**
     * Invalidate all overview data (keep chunks)
     */
    invalidateAllOverviews: () => {
      queryClient.invalidateQueries({
        queryKey: timeSeriesKeys.overviews(),
      });
    },

    /**
     * Clear all time series cache
     */
    clearAll: () => {
      queryClient.removeQueries({
        queryKey: timeSeriesKeys.all,
      });
    },

    /**
     * Force cache eviction to enforce memory limits
     */
    enforceMemoryLimits: () => {
      evictOldChunkQueries(queryClient, CACHE_LIMITS.MAX_CHUNK_QUERIES);
      evictOldOverviewQueries(queryClient, CACHE_LIMITS.MAX_OVERVIEW_QUERIES);
    },
  };
}

/**
 * Hook to monitor and enforce time series cache memory limits
 * Use this at the app level to periodically clean up the cache
 *
 * @param intervalMs - How often to check cache limits (default: 60 seconds)
 *
 * @example
 * // In your app root component
 * useTimeSeriesCacheMonitor();
 */
export function useTimeSeriesCacheMonitor(intervalMs: number = 60_000) {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Run immediately on mount
    evictOldChunkQueries(queryClient, CACHE_LIMITS.MAX_CHUNK_QUERIES);
    evictOldOverviewQueries(queryClient, CACHE_LIMITS.MAX_OVERVIEW_QUERIES);

    // Set up periodic check
    const interval = setInterval(() => {
      evictOldChunkQueries(queryClient, CACHE_LIMITS.MAX_CHUNK_QUERIES);
      evictOldOverviewQueries(queryClient, CACHE_LIMITS.MAX_OVERVIEW_QUERIES);
    }, intervalMs);

    // Also clean up when window becomes hidden (user switches away)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Aggressive cleanup when app is backgrounded
        evictOldChunkQueries(
          queryClient,
          Math.floor(CACHE_LIMITS.MAX_CHUNK_QUERIES / 2),
        );
        evictOldOverviewQueries(
          queryClient,
          Math.floor(CACHE_LIMITS.MAX_OVERVIEW_QUERIES / 2),
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [queryClient, intervalMs]);
}

/**
 * Hook to prefetch chunk data ahead of time
 * Useful for progressive loading or anticipating user navigation
 *
 * @returns Prefetch function
 *
 * @example
 * const prefetchChunk = usePrefetchChunkData();
 *
 * // Prefetch next chunk when user scrolls
 * useEffect(() => {
 *   if (userNearEndOfView) {
 *     prefetchChunk('/path/to/file.edf', nextChunkStart, chunkSize, channels);
 *   }
 * }, [userNearEndOfView]);
 */
export function usePrefetchChunkData() {
  const queryClient = useQueryClient();

  return (
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    requestedChannels?: string[],
    preprocessing?: {
      highpass?: number;
      lowpass?: number;
      notch?: number[];
    },
  ) => {
    queryClient.prefetchQuery({
      queryKey: timeSeriesKeys.chunk(
        filePath,
        chunkStart,
        chunkSize,
        requestedChannels,
        preprocessing,
      ),
      queryFn: async () => {
        return tauriBackendService.getEdfChunk(
          filePath,
          chunkStart,
          chunkSize,
          requestedChannels,
          preprocessing,
        );
      },
      staleTime: 2 * 60 * 1000, // 2 minutes (was 30 min)
    });
  };
}
