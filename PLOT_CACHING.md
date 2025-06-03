# Enhanced Plot Caching System

This document describes the improved plot caching system that prevents unnecessary API refetches when users navigate between plots and settings.

## Overview

The enhanced caching system provides intelligent caching of:

- **EEG plot data** (5-minute cache)
- **DDA heatmap data** (10-minute cache)
- **Annotation data** (10-minute cache)

When users have plots open and navigate to settings, the plots are efficiently loaded from cache instead of being refetched from the API server.

## Architecture

### Components

1. **Apollo Client Enhancement** (`packages/shared/lib/utils/apollo-client.ts`)

   - Updated from `no-cache` to `cache-first` policy
   - Smart cache key generation based on file path, chunk parameters, and preprocessing options
   - Automatic cache invalidation

2. **Plot Cache Manager** (`packages/shared/lib/utils/plotCache.ts`)

   - Singleton class managing localStorage and Apollo cache
   - Time-based cache expiration (TTL)
   - Automatic cleanup of expired entries
   - Cache statistics and management

3. **Enhanced Hooks**

   - `useDDAPlot`: Checks cache before API requests
   - `usePlotCache`: Manages cache lifecycle
   - Automatic cache population after successful API calls

4. **Cache Status Component** (`packages/shared/components/ui/cache-status.tsx`)
   - Visual cache statistics
   - Manual cache management tools
   - Real-time cache monitoring

## Cache Strategy

### Cache Keys

Plot data uses composite keys including:

- File path
- Chunk start position
- Chunk size
- Preprocessing options (hashing for efficiency)

### Cache Layers

1. **Apollo Cache** (in-memory)

   - Fastest access
   - Automatic GraphQL query caching
   - Lost on page refresh

2. **Local Storage Cache** (persistent)
   - Survives page refreshes
   - Time-based expiration
   - Larger storage capacity

### Cache Invalidation

- **Time-based**: Automatic expiration (5-10 minutes)
- **Manual**: User-triggered cache clearing
- **Automatic cleanup**: Every 60 seconds
- **File-specific**: Clear cache for individual files

## Usage

### For Users

1. **Automatic Caching**: Plots are automatically cached when loaded
2. **Navigation**: Navigate to settings and back without refetching
3. **Cache Status**: View cache statistics in Settings > Performance
4. **Manual Management**: Clear expired or all cache entries if needed

### For Developers

#### Using the Cache Manager

```typescript
import { plotCacheManager } from "shared/lib/utils/plotCache";

// Check for cached data
const cachedData = plotCacheManager.getCachedPlotData({
  filePath: "path/to/file.edf",
  chunkStart: 0,
  chunkSize: 1000,
  preprocessingOptions: {
    /* options */
  },
});

// Cache new data
plotCacheManager.cachePlotData(cacheKey, plotData);

// Clear cache for a file
plotCacheManager.clearFileCache("path/to/file.edf");
```

#### Using the Cache Hook

```typescript
import { usePlotCache } from "shared/hooks/usePlotCache";

function MyComponent() {
  const { clearCache, getCacheStats } = usePlotCache();

  // Get cache statistics
  const stats = getCacheStats();

  // Clear cache for specific file
  clearCache("path/to/file.edf");
}
```

## Configuration

### Cache Durations

- **Plot Data**: 5 minutes (configurable in `plotCache.ts`)
- **Annotations**: 10 minutes
- **Heatmap Data**: 10 minutes

### Storage Limits

The system uses localStorage with fallback handling:

- Automatic cleanup when storage is full
- Graceful degradation if localStorage is unavailable
- Error handling for quota exceeded scenarios

## Performance Benefits

1. **Faster Navigation**: Instant plot loading when returning from settings
2. **Reduced Server Load**: Fewer API requests for recently viewed data
3. **Better UX**: No loading spinners for cached content
4. **Bandwidth Savings**: Avoid re-downloading large plot datasets

## Monitoring

### Cache Statistics

Available in Settings > Performance:

- Number of cached plot data entries
- Number of cached heatmap entries
- Number of cached annotation entries
- Total cache usage

### Developer Tools

Console logging shows:

- Cache hits/misses
- Cache operations (store/retrieve/expire)
- Performance metrics

## Best Practices

1. **Cache Invalidation**: Always clear cache when data changes on server
2. **Memory Management**: Monitor localStorage usage in long-running sessions
3. **Error Handling**: Graceful fallback to API when cache fails
4. **User Control**: Allow users to manually clear cache if needed

## Troubleshooting

### Common Issues

1. **Stale Data**: Clear cache manually or wait for expiration
2. **Storage Full**: Automatic cleanup or manual cache clearing
3. **Inconsistent State**: Refresh page to reset cache state

### Debug Mode

Enable detailed logging:

```typescript
// In browser console
localStorage.setItem("debug", "plot-cache");
```

## Future Enhancements

1. **Smart Prefetching**: Preload adjacent chunks
2. **Compression**: Compress cached data to save space
3. **IndexedDB**: Migrate to IndexedDB for larger datasets
4. **Server-side Caching**: Coordinate with server-side caching
5. **Cache Warmup**: Preload frequently accessed data
