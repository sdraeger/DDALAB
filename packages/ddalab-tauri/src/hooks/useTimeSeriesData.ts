import { useQuery, useQueries, useMutation, useQueryClient, UseQueryResult } from '@tanstack/react-query';
import { ApiService } from '@/services/apiService';
import { ChunkData } from '@/types/api';

/**
 * Query key factory for time series data
 * Provides consistent cache keys for chunk and overview data
 */
export const timeSeriesKeys = {
  all: ['timeSeries'] as const,
  chunks: () => [...timeSeriesKeys.all, 'chunks'] as const,
  chunk: (
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    channels?: string[],
    preprocessing?: {
      highpass?: number;
      lowpass?: number;
      notch?: number[];
    }
  ) => [
    ...timeSeriesKeys.chunks(),
    filePath,
    chunkStart,
    chunkSize,
    channels,
    preprocessing,
  ] as const,
  overviews: () => [...timeSeriesKeys.all, 'overviews'] as const,
  overview: (filePath: string, channels?: string[], maxPoints?: number) =>
    [...timeSeriesKeys.overviews(), filePath, channels, maxPoints] as const,
};

/**
 * Hook to fetch chunk data with automatic caching
 *
 * @param apiService - API service instance
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
 *   apiService,
 *   '/path/to/file.edf',
 *   0,
 *   1000,
 *   ['Channel 1', 'Channel 2'],
 *   undefined,
 *   true
 * );
 */
export function useChunkData(
  apiService: ApiService,
  filePath: string,
  chunkStart: number,
  chunkSize: number,
  requestedChannels?: string[],
  preprocessing?: {
    highpass?: number;
    lowpass?: number;
    notch?: number[];
  },
  enabled: boolean = true
) {
  return useQuery({
    queryKey: timeSeriesKeys.chunk(
      filePath,
      chunkStart,
      chunkSize,
      requestedChannels,
      preprocessing
    ),
    queryFn: async ({ signal }) => {
      return apiService.getChunkData(
        filePath,
        chunkStart,
        chunkSize,
        requestedChannels,
        signal,
        preprocessing
      );
    },
    enabled: enabled && !!filePath && chunkSize > 0,
    staleTime: 30 * 60 * 1000, // 30 minutes - chunk data is immutable
    gcTime: 60 * 60 * 1000, // 60 minutes - keep in cache for 1 hour
    retry: 2,
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch overview data (downsampled view of entire file)
 *
 * @param apiService - API service instance
 * @param filePath - Path to the EDF/CSV file
 * @param requestedChannels - Channels to load (optional)
 * @param maxPoints - Maximum number of points per channel (default: 2000)
 * @param enabled - Whether to enable the query (default: true)
 *
 * @returns Query result with overview data
 *
 * @example
 * const { data, isLoading, error, refetch } = useOverviewData(
 *   apiService,
 *   '/path/to/file.edf',
 *   ['Channel 1', 'Channel 2'],
 *   2000,
 *   true
 * );
 */
export function useOverviewData(
  apiService: ApiService,
  filePath: string,
  requestedChannels?: string[],
  maxPoints: number = 2000,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: timeSeriesKeys.overview(filePath, requestedChannels, maxPoints),
    queryFn: async ({ signal }) => {
      return apiService.getOverviewData(
        filePath,
        requestedChannels,
        maxPoints,
        signal
      );
    },
    enabled: enabled && !!filePath,
    staleTime: 30 * 60 * 1000, // 30 minutes - overview data is immutable
    gcTime: 60 * 60 * 1000, // 60 minutes
    retry: 1, // Reduced from 2 - fail faster for large files that timeout
    retryDelay: 1000, // Short retry delay (1 second)
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch multiple overviews in parallel (e.g., for multiple channel combinations)
 *
 * @param apiService - API service instance
 * @param filePath - Path to the EDF/CSV file
 * @param channelLists - Array of channel combinations to fetch
 * @param maxPoints - Maximum number of points per channel (default: 2000)
 * @param enabled - Whether to enable the queries (default: true)
 *
 * @returns Array of query results
 *
 * @example
 * const overviewQueries = useMultipleOverviews(
 *   apiService,
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
  apiService: ApiService,
  filePath: string,
  channelLists: string[][],
  maxPoints: number = 2000,
  enabled: boolean = true
): UseQueryResult<ChunkData, Error>[] {
  return useQueries({
    queries: channelLists.map((channels) => ({
      queryKey: timeSeriesKeys.overview(filePath, channels, maxPoints),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        return apiService.getOverviewData(filePath, channels, maxPoints, signal);
      },
      enabled: enabled && !!filePath,
      staleTime: 30 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
    })),
  });
}

/**
 * Hook to fetch multiple chunks in parallel (e.g., for progressive loading)
 *
 * @param apiService - API service instance
 * @param filePath - Path to the EDF/CSV file
 * @param chunkRequests - Array of chunk requests (start, size, channels)
 * @param enabled - Whether to enable the queries (default: true)
 *
 * @returns Array of query results
 *
 * @example
 * const chunkQueries = useMultipleChunks(
 *   apiService,
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
  apiService: ApiService,
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
  enabled: boolean = true
): UseQueryResult<ChunkData, Error>[] {
  return useQueries({
    queries: chunkRequests.map((request) => ({
      queryKey: timeSeriesKeys.chunk(
        filePath,
        request.start,
        request.size,
        request.channels,
        request.preprocessing
      ),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        return apiService.getChunkData(
          filePath,
          request.start,
          request.size,
          request.channels,
          signal,
          request.preprocessing
        );
      },
      enabled: enabled && !!filePath && request.size > 0,
      staleTime: 30 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
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
            key[0] === 'timeSeries' &&
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
  };
}

/**
 * Hook to prefetch chunk data ahead of time
 * Useful for progressive loading or anticipating user navigation
 *
 * @returns Prefetch function
 *
 * @example
 * const prefetchChunk = usePrefetchChunkData(apiService);
 *
 * // Prefetch next chunk when user scrolls
 * useEffect(() => {
 *   if (userNearEndOfView) {
 *     prefetchChunk('/path/to/file.edf', nextChunkStart, chunkSize, channels);
 *   }
 * }, [userNearEndOfView]);
 */
export function usePrefetchChunkData(apiService: ApiService) {
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
    }
  ) => {
    queryClient.prefetchQuery({
      queryKey: timeSeriesKeys.chunk(
        filePath,
        chunkStart,
        chunkSize,
        requestedChannels,
        preprocessing
      ),
      queryFn: async ({ signal }) => {
        return apiService.getChunkData(
          filePath,
          chunkStart,
          chunkSize,
          requestedChannels,
          signal,
          preprocessing
        );
      },
      staleTime: 30 * 60 * 1000,
    });
  };
}
