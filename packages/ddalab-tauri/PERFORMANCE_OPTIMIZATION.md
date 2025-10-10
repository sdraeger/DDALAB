# Data Loading Performance Optimization Plan

## Problem Statement

Large time window selections (e.g., 60+ seconds) cause loading times up to 60s and timeout errors. The application becomes unresponsive when selecting/deselecting channels or changing time windows.

## Current Architecture Issues

### 1. **Full Reload on Every Change**
**Location**: `TimeSeriesPlot.tsx:683-691`
```typescript
// Loads ALL channels every time
const allChannels = fileManager.selectedFile.channels;
const chunkData = await apiService.getChunkData(
  fileManager.selectedFile.file_path,
  chunkStart,
  chunkSize,
  allChannels // Reloads all data
);
```

**Problem**: Even when toggling channel visibility, the entire dataset is re-fetched from the backend.

### 2. **No Client-Side Caching**
**Location**: Frontend has no chunk cache
**Problem**:
- Same data is fetched multiple times
- No progressive loading
- Network/disk I/O on every interaction

### 3. **Backend Cache Limitations**
**Location**: `embedded_api.rs:1202-1208`
```rust
// Simple cache with no eviction policy
let chunk_cache = state.chunks_cache.read();
if let Some(chunk) = chunk_cache.get(&chunk_key) {
    return Ok(Json(chunk.clone()));
}
```

**Problem**:
- Memory grows unbounded
- No LRU eviction
- Cache key includes channels, causing misses when toggling visibility

### 4. **Multiple Redundant Triggers**
**Locations**:
- `TimeSeriesPlot.tsx:845` - File/channel load effect
- `TimeSeriesPlot.tsx:901` - Time window effect
- `TimeSeriesPlot.tsx:976` - Preprocessing effect

**Problem**: Changes can trigger multiple loads for the same data

### 5. **Synchronous Blocking**
**Problem**: UI freezes during large data loads

## Optimization Strategy

### Phase 1: Client-Side Data Caching (High Priority)

**Objective**: Eliminate redundant network requests

**Implementation**:
1. Create `ChunkCache` service in `src/services/chunkCache.ts`
   - LRU cache with size limits (e.g., 100MB max)
   - Key structure: `${filePath}:${chunkStart}:${chunkSize}` (exclude channels)
   - Store full channel data, filter on retrieval

2. Modify `TimeSeriesPlot.tsx` to check cache before API call
   ```typescript
   // Check cache first
   const cached = chunkCache.get(cacheKey);
   if (cached) {
     const filtered = filterChannels(cached, selectedChannels);
     renderPlot(filtered);
     return;
   }

   // Only fetch if cache miss
   const fresh = await apiService.getChunkData(...);
   chunkCache.set(cacheKey, fresh);
   ```

3. Implement cache eviction on file change

**Expected Improvement**: 90%+ reduction in API calls for channel toggling

### Phase 2: Chunked Window Loading (High Priority)

**Objective**: Break large windows into smaller, progressive chunks

**Implementation**:
1. Create `ProgressiveLoader` service
   - Split large time windows (>30s) into 10-30s chunks
   - Load chunks in parallel with Promise.all()
   - Update UI progressively as chunks arrive

2. Add loading progress indicator
   ```typescript
   const chunks = splitIntoChunks(timeWindow, maxChunkSize);
   const promises = chunks.map(chunk => loadChunk(chunk));

   // Show progress
   for (let i = 0; i < promises.length; i++) {
     const chunk = await promises[i];
     updateProgress((i + 1) / promises.length * 100);
     renderChunk(chunk);
   }
   ```

**Expected Improvement**:
- No more timeouts
- Visible progress for users
- Interruptible loads

### Phase 3: Smart Channel Management (Medium Priority)

**Objective**: Avoid reloading data when only visibility changes

**Current**: Lines 784-816 in TimeSeriesPlot.tsx already load all channels
**Problem**: Still triggers full reload on channel selection change

**Implementation**:
1. Separate "loaded channels" from "visible channels"
   ```typescript
   const [loadedData, setLoadedData] = useState<ChunkData>(null);
   const [visibleChannels, setVisibleChannels] = useState<string[]>([]);
   ```

2. Modify `handleChannelToggle` to only update visibility
   ```typescript
   const handleChannelToggle = (channel: string, checked: boolean) => {
     // Don't reload data - just update visibility
     setVisibleChannels(prev =>
       checked ? [...prev, channel] : prev.filter(c => c !== channel)
     );

     // uPlot already handles visibility toggling
     updatePlotVisibility(channel, checked);
   };
   ```

3. Remove channel dependency from load effect

**Expected Improvement**: Instant channel toggling (no network calls)

### Phase 4: Backend Optimization (Medium Priority)

**Objective**: Faster file reading for large chunks

**Implementation**:
1. Add parallel channel reading in `embedded_api.rs`
   ```rust
   // Read channels in parallel using rayon
   let channel_data: Vec<Vec<f64>> = channels_to_read
       .par_iter()
       .map(|&ch| read_channel_data(reader, ch, start, end))
       .collect();
   ```

2. Implement smarter cache key (without channels parameter)
   ```rust
   let chunk_key = format!("{}:{}:{}", file_path, chunk_start, chunk_size);
   ```

3. Add LRU eviction policy
   ```rust
   if chunk_cache.len() > MAX_CACHE_SIZE {
       chunk_cache.pop_lru();
   }
   ```

**Expected Improvement**: 30-50% faster file reads

### Phase 5: Preprocessing Optimization (Low Priority)

**Objective**: Cache preprocessed data separately

**Implementation**:
1. Move preprocessing to backend when possible
2. Cache preprocessed chunks separately
   ```typescript
   const cacheKey = `${baseKey}:${JSON.stringify(preprocessing)}`;
   ```

**Expected Improvement**: Faster filter changes

## Implementation Priority

1. **Week 1**: Client-side caching (Phase 1)
   - Biggest impact with least code change
   - ~2-3 days implementation

2. **Week 2**: Chunked loading (Phase 2)
   - Solves timeout issues
   - ~3-4 days implementation

3. **Week 3**: Smart channel management (Phase 3)
   - Polish user experience
   - ~2-3 days implementation

4. **Week 4**: Backend optimization (Phase 4)
   - Incremental improvements
   - ~3-4 days implementation

## Success Metrics

- **Loading time for 60s window**: < 5 seconds (down from 60s)
- **Channel toggle time**: < 100ms (instant feel)
- **Memory usage**: < 500MB for typical session
- **Cache hit rate**: > 80% for channel toggles
- **No timeouts**: 0 timeout errors in normal usage

## Testing Plan

1. Create test dataset: 24-hour EDF file, 32 channels, 256 Hz
2. Test scenarios:
   - Load 10s, 30s, 60s, 120s windows
   - Toggle channels rapidly
   - Change preprocessing filters
   - Navigate timeline quickly

3. Measure:
   - Time to first render
   - Time to interactive
   - Network requests count
   - Memory consumption

## Backward Compatibility

All changes maintain API compatibility:
- Existing `getChunkData()` calls work unchanged
- Cache is transparent to components
- Progressive loading falls back to single load if needed

## Rollout Strategy

1. Implement behind feature flag: `ENABLE_PROGRESSIVE_LOADING`
2. Beta test with power users
3. Gradual rollout to all users
4. Monitor performance metrics
