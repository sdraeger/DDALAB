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
 * Find k oldest entries from array by dataUpdatedAt in O(n) time
 * Uses linear scan instead of O(n log n) sort
 */
function findOldestEntries<T extends { state: { dataUpdatedAt?: number } }>(
  entries: T[],
  k: number,
): T[] {
  if (k <= 0 || entries.length === 0) return [];
  if (k >= entries.length) return [...entries];

  // For small k, use k linear passes (O(k*n) which is O(n) when k is constant)
  const result: T[] = [];
  const used = new Set<number>();

  for (let i = 0; i < k; i++) {
    let oldestIdx = -1;
    let oldestTime = Infinity;

    for (let j = 0; j < entries.length; j++) {
      if (used.has(j)) continue;
      const time = entries[j].state.dataUpdatedAt || 0;
      if (time < oldestTime) {
        oldestTime = time;
        oldestIdx = j;
      }
    }

    if (oldestIdx !== -1) {
      result.push(entries[oldestIdx]);
      used.add(oldestIdx);
    }
  }

  return result;
}

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

  const numToEvict = chunkQueries.length - maxQueries;

  // Find oldest entries in O(n) instead of O(n log n) sort
  const toRemove = findOldestEntries(chunkQueries, numToEvict);

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

  const numToEvict = overviewQueries.length - maxQueries;

  // Find oldest entries in O(n) instead of O(n log n) sort
  const toRemove = findOldestEntries(overviewQueries, numToEvict);

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
 * Hook to fetch multiple chunks in a single batched IPC call
 * This is more efficient than useMultipleChunks when fetching many chunks
 * as it reduces IPC overhead by combining requests into a single call.
 *
 * @param filePath - Path to the EDF/CSV file
 * @param chunkRequests - Array of chunk requests (start, size, channels)
 * @param enabled - Whether to enable the query (default: true)
 *
 * @returns Query result with all chunk data
 *
 * @example
 * const { data: chunks, isLoading } = useBatchedChunks(
 *   '/path/to/file.edf',
 *   [
 *     { start: 0, size: 1000, channels: ['Channel 1'] },
 *     { start: 1000, size: 1000, channels: ['Channel 1'] },
 *     { start: 2000, size: 1000, channels: ['Channel 1'] }
 *   ],
 *   true
 * );
 */
export function useBatchedChunks(
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
) {
  // Create a stable query key that captures all request parameters
  const requestsKey = chunkRequests
    .map(
      (r) =>
        `${r.start}:${r.size}:${r.channels?.join(",") || ""}:${r.preprocessing?.highpass || ""}:${r.preprocessing?.lowpass || ""}:${r.preprocessing?.notch?.join(",") || ""}`,
    )
    .join("|");

  return useQuery({
    queryKey: [...timeSeriesKeys.chunks(), "batch", filePath, requestsKey],
    queryFn: async () => {
      return tauriBackendService.getEdfChunksBatch(
        filePath,
        chunkRequests.map((r) => ({
          chunkStart: r.start,
          chunkSize: r.size,
          channels: r.channels,
          preprocessing: r.preprocessing,
        })),
      );
    },
    enabled: enabled && !!filePath && chunkRequests.length > 0,
    staleTime: 2 * 60 * 1000, // 2 minutes - chunk data is immutable but memory-heavy
    gcTime: 5 * 60 * 1000, // 5 minutes - aggressive GC to prevent memory bloat
    retry: 2,
    refetchOnWindowFocus: false,
  });
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

/**
 * Hook to prefetch multiple chunks in a single batched IPC call
 * More efficient than multiple individual prefetch calls
 *
 * @returns Prefetch function
 *
 * @example
 * const prefetchBatchedChunks = usePrefetchBatchedChunks();
 *
 * // Prefetch next several chunks when user scrolls near end
 * useEffect(() => {
 *   if (userNearEndOfView) {
 *     prefetchBatchedChunks('/path/to/file.edf', [
 *       { start: nextChunkStart, size: chunkSize },
 *       { start: nextChunkStart + chunkSize, size: chunkSize },
 *       { start: nextChunkStart + chunkSize * 2, size: chunkSize }
 *     ]);
 *   }
 * }, [userNearEndOfView]);
 */
export function usePrefetchBatchedChunks() {
  const queryClient = useQueryClient();

  return (
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
  ) => {
    const requestsKey = chunkRequests
      .map(
        (r) =>
          `${r.start}:${r.size}:${r.channels?.join(",") || ""}:${r.preprocessing?.highpass || ""}:${r.preprocessing?.lowpass || ""}:${r.preprocessing?.notch?.join(",") || ""}`,
      )
      .join("|");

    queryClient.prefetchQuery({
      queryKey: [...timeSeriesKeys.chunks(), "batch", filePath, requestsKey],
      queryFn: async () => {
        return tauriBackendService.getEdfChunksBatch(
          filePath,
          chunkRequests.map((r) => ({
            chunkStart: r.start,
            chunkSize: r.size,
            channels: r.channels,
            preprocessing: r.preprocessing,
          })),
        );
      },
      staleTime: 2 * 60 * 1000, // 2 minutes
    });
  };
}
