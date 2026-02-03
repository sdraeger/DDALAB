# Progressive DDA Loading Design

**Date:** 2026-02-02
**Status:** Approved
**Problem:** UI blocks for ~700ms during structured clone when transferring 45MB DDA results from worker to main thread

## Solution Overview

Split data transfer into metadata (instant) and channel data (on-demand):

1. Worker decodes full result but sends only **metadata** immediately (~1KB)
2. Worker **caches full result** in memory, keyed by analysisId
3. Components request specific channel data on-demand via new message type
4. Each chunk is small (~50-200KB per channel), transfers without blocking

## Data Split

| Sent Immediately (Metadata) | Sent On-Demand (Large Data) |
|----------------------------|----------------------------|
| id, name, file_path | dda_matrix (per channel) |
| channels list | network_motifs |
| status, created_at | error_values |
| variant names/ids | |
| exponents, quality_metrics | |
| parameters | |

## Worker API

### Message Types

```typescript
// Request types
type DDADecodeRequest = {
  id: string;
  type: "decode";
  compressedData: ArrayBuffer;
  analysisId: string;
};

type DDAGetDataRequest = {
  id: string;
  type: "getData";
  analysisId: string;
  variantId: string;
  channels: string[];
};

type DDAClearCacheRequest = {
  id: string;
  type: "clearCache";
  analysisId?: string;
};

// Response types
type DDAMetadataResponse = {
  id: string;
  type: "metadata";
  metadata: DDAResultMetadata;
};

type DDADataResponse = {
  id: string;
  type: "data";
  variantId: string;
  ddaMatrix: Record<string, number[]>;
};
```

### Worker Memory Management

- Worker maintains `Map<analysisId, DDAResult>` cache
- LRU eviction with max 3 results to bound memory
- Clear on: component unmount, new file loaded, or explicit request

## New Types

```typescript
interface DDAResultMetadata {
  id: string;
  name?: string;
  file_path: string;
  channels: string[];
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  parameters: DDAAnalysisRequest;
  variants: Array<{
    variant_id: string;
    variant_name: string;
    exponents: Record<string, number>;
    quality_metrics: Record<string, number>;
  }>;
}
```

## Service Layer

```typescript
// Returns immediately with metadata only
async getDDAFromHistory(analysisId: string): Promise<DDAResultMetadata>

// Requests specific channel data from worker cache
async getDDAChannelData(
  analysisId: string,
  variantId: string,
  channels: string[]
): Promise<Record<string, number[]>>
```

## React Hook

```typescript
function useDDAChannelData(
  analysisId: string | undefined,
  variantId: string | undefined,
  channels: string[]
): {
  data: Record<string, number[]> | undefined;
  isLoading: boolean;
}
```

## Files to Modify

1. `src/workers/ddaDecodeWorker.ts` - Add cache, getData handler
2. `src/services/tauriBackendService.ts` - Add getDDAChannelData method
3. `src/types/api.ts` - Add DDAResultMetadata type
4. `src/hooks/useDDAAnalysis.ts` - Add useDDAChannelData hook
5. `src/components/DDAResults.tsx` - Use metadata type
6. `src/components/dda/DDAHeatmapPlot.tsx` - Add channel data hook
7. `src/components/dda/DDALinePlot.tsx` - Add channel data hook

## Expected Performance

- Initial load: ~200ms (backend + decode + metadata transfer)
- Channel data request: ~50-100ms per 8-channel view
- **UI stays responsive throughout** - no single blocking operation > 100ms

## Risk Mitigation

- Worker cache has LRU eviction to bound memory
- Fallback: If worker cache miss, re-fetch from backend
- Components already have loading states for graceful degradation
