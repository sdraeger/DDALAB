/**
 * Web Worker for decompressing LZ4 and decoding MessagePack off the main thread.
 *
 * PROGRESSIVE LOADING: To avoid ~700ms structured clone blocking the UI:
 * 1. Decode full result but send only METADATA immediately (tiny, instant)
 * 2. Cache full result in worker memory
 * 3. Send large data (dda_matrix) on-demand when components request it
 * 4. Each chunk is small enough to transfer without noticeable blocking
 */

import { decode as msgpackDecode } from "@msgpack/msgpack";
import * as lz4 from "lz4js";

// ============================================================================
// Types
// ============================================================================

export type DDAWorkerRequest =
  | DDADecodeRequest
  | DDAGetDataRequest
  | DDAClearCacheRequest;

export interface DDADecodeRequest {
  id: string;
  type: "decode";
  compressedData: ArrayBuffer;
  analysisId: string;
}

export interface DDAGetDataRequest {
  id: string;
  type: "getData";
  analysisId: string;
  variantId: string;
  channels: string[];
}

export interface DDAClearCacheRequest {
  id: string;
  type: "clearCache";
  analysisId?: string; // If not provided, clears all
}

export type DDADecodeResponse =
  | DDAMetadataResponse
  | DDADataResponse
  | DDAClearCacheResponse
  | DDAErrorResponse;

export interface DDAMetadataResponse {
  id: string;
  type: "metadata";
  metadata: DDAResultMetadata;
  timing?: {
    decompressMs: number;
    decodeMs: number;
    totalMs: number;
    compressedSize: number;
    uncompressedSize: number;
  };
}

export interface DDADataResponse {
  id: string;
  type: "data";
  analysisId: string;
  variantId: string;
  ddaMatrix: Record<string, number[]>;
  windowIndices: number[];
}

export interface DDAClearCacheResponse {
  id: string;
  type: "cacheCleared";
  clearedIds: string[];
}

export interface DDAErrorResponse {
  id: string;
  type: "error";
  error: string;
}

/** Lightweight metadata for instant transfer (no large arrays) */
export interface DDAResultMetadata {
  id: string;
  name?: string;
  file_path: string;
  channels: string[];
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  completed_at?: string;
  error_message?: string;
  source?: "local" | "nsg";
  parameters: unknown; // DDAAnalysisRequest - keep as unknown to avoid import
  variants: Array<{
    variant_id: string;
    variant_name: string;
    exponents: Record<string, number>;
    quality_metrics: Record<string, number>;
    has_network_motifs: boolean;
  }>;
  window_indices: number[];
}

// ============================================================================
// Cache Management
// ============================================================================

interface CachedResult {
  result: DDAResultFull;
  accessedAt: number;
}

// Full result type (internal, not exported)
interface DDAResultFull {
  id: string;
  name?: string;
  file_path: string;
  channels: string[];
  status: string;
  created_at: string;
  completed_at?: string;
  error_message?: string;
  source?: string;
  parameters: unknown;
  results: {
    window_indices: number[];
    scales?: number[];
    variants: Array<{
      variant_id: string;
      variant_name: string;
      dda_matrix: Record<string, number[]>;
      exponents: Record<string, number>;
      quality_metrics: Record<string, number>;
      network_motifs?: unknown;
      error_values?: number[];
    }>;
    error_values?: number[];
    dda_matrix?: Record<string, number[]>;
    exponents?: Record<string, number>;
    quality_metrics?: Record<string, number>;
  };
}

const MAX_CACHED_RESULTS = 3;
const resultCache = new Map<string, CachedResult>();

function addToCache(analysisId: string, result: DDAResultFull): void {
  // Evict oldest if at capacity
  if (resultCache.size >= MAX_CACHED_RESULTS) {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, cached] of resultCache) {
      if (cached.accessedAt < oldestTime) {
        oldestTime = cached.accessedAt;
        oldestId = id;
      }
    }
    if (oldestId) {
      resultCache.delete(oldestId);
      console.log(`[DDADecodeWorker] Evicted ${oldestId} from cache (LRU)`);
    }
  }

  resultCache.set(analysisId, {
    result,
    accessedAt: Date.now(),
  });
  console.log(
    `[DDADecodeWorker] Cached ${analysisId}, cache size: ${resultCache.size}`,
  );
}

function getFromCache(analysisId: string): DDAResultFull | null {
  const cached = resultCache.get(analysisId);
  if (cached) {
    cached.accessedAt = Date.now();
    return cached.result;
  }
  return null;
}

// ============================================================================
// Extract Metadata (small, instant transfer)
// ============================================================================

function extractMetadata(result: DDAResultFull): DDAResultMetadata {
  const windowIndices =
    result.results.window_indices || result.results.scales || [];

  return {
    id: result.id,
    name: result.name,
    file_path: result.file_path,
    channels: result.channels,
    status: result.status as DDAResultMetadata["status"],
    created_at: result.created_at,
    completed_at: result.completed_at,
    error_message: result.error_message,
    source: result.source as DDAResultMetadata["source"],
    parameters: result.parameters,
    window_indices: windowIndices,
    variants: result.results.variants.map((v) => ({
      variant_id: v.variant_id,
      variant_name: v.variant_name,
      exponents: v.exponents,
      quality_metrics: v.quality_metrics,
      has_network_motifs: !!v.network_motifs,
    })),
  };
}

// ============================================================================
// Message Handlers
// ============================================================================

function handleDecode(request: DDADecodeRequest): void {
  const { id, compressedData, analysisId } = request;
  const startTotal = performance.now();

  try {
    const compressedBytes = new Uint8Array(compressedData);
    const compressedSize = compressedBytes.byteLength;

    // Decompress LZ4
    const startDecompress = performance.now();
    const uncompressedSize =
      compressedBytes[0] |
      (compressedBytes[1] << 8) |
      (compressedBytes[2] << 16) |
      (compressedBytes[3] << 24);

    const decompressed = new Uint8Array(uncompressedSize);
    const compressedPayload = compressedBytes.slice(4);

    lz4.decompressBlock(
      compressedPayload,
      decompressed,
      0,
      compressedPayload.length,
      0,
    );
    const decompressMs = performance.now() - startDecompress;

    // Decode MessagePack
    const startDecode = performance.now();
    const result = msgpackDecode(decompressed) as DDAResultFull;
    const decodeMs = performance.now() - startDecode;

    // Cache the full result
    addToCache(analysisId, result);

    // Extract and send metadata only (tiny, instant)
    const metadata = extractMetadata(result);
    const totalMs = performance.now() - startTotal;

    self.postMessage({
      id,
      type: "metadata",
      metadata,
      timing: {
        decompressMs,
        decodeMs,
        totalMs,
        compressedSize,
        uncompressedSize,
      },
    } as DDAMetadataResponse);
  } catch (error) {
    console.error("[DDADecodeWorker] Decode error:", error);
    self.postMessage({
      id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    } as DDAErrorResponse);
  }
}

function handleGetData(request: DDAGetDataRequest): void {
  const { id, analysisId, variantId, channels } = request;

  const result = getFromCache(analysisId);
  if (!result) {
    self.postMessage({
      id,
      type: "error",
      error: `Analysis ${analysisId} not found in cache. Please reload.`,
    } as DDAErrorResponse);
    return;
  }

  // Find the variant
  const variant = result.results.variants.find(
    (v) => v.variant_id === variantId,
  );
  if (!variant) {
    self.postMessage({
      id,
      type: "error",
      error: `Variant ${variantId} not found in analysis ${analysisId}`,
    } as DDAErrorResponse);
    return;
  }

  // Extract only requested channels' data
  const ddaMatrix: Record<string, number[]> = {};
  for (const channel of channels) {
    if (variant.dda_matrix[channel]) {
      ddaMatrix[channel] = variant.dda_matrix[channel];
    }
  }

  // FALLBACK: If no channels matched (e.g., ST channels vs CT pair channels),
  // return ALL channels from this variant's dda_matrix.
  // This handles variant switching where channel naming differs.
  if (Object.keys(ddaMatrix).length === 0 && channels.length > 0) {
    console.log(
      `[DDADecodeWorker] No matching channels for ${variantId}, returning all variant channels`,
    );
    for (const [key, value] of Object.entries(variant.dda_matrix)) {
      ddaMatrix[key] = value;
    }
  }

  const windowIndices =
    result.results.window_indices || result.results.scales || [];

  self.postMessage({
    id,
    type: "data",
    analysisId,
    variantId,
    ddaMatrix,
    windowIndices,
  } as DDADataResponse);
}

function handleClearCache(request: DDAClearCacheRequest): void {
  const { id, analysisId } = request;
  const clearedIds: string[] = [];

  if (analysisId) {
    if (resultCache.delete(analysisId)) {
      clearedIds.push(analysisId);
    }
  } else {
    clearedIds.push(...resultCache.keys());
    resultCache.clear();
  }

  console.log(`[DDADecodeWorker] Cleared cache: ${clearedIds.join(", ")}`);

  self.postMessage({
    id,
    type: "cacheCleared",
    clearedIds,
  } as DDAClearCacheResponse);
}

// ============================================================================
// Main Message Handler
// ============================================================================

self.onmessage = (event: MessageEvent<DDAWorkerRequest>) => {
  const request = event.data;

  switch (request.type) {
    case "decode":
      handleDecode(request);
      break;
    case "getData":
      handleGetData(request);
      break;
    case "clearCache":
      handleClearCache(request);
      break;
    default:
      self.postMessage({
        id: (request as { id: string }).id,
        type: "error",
        error: `Unknown request type: ${(request as { type: string }).type}`,
      } as DDAErrorResponse);
  }
};
