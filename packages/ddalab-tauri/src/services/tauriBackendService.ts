/**
 * TauriBackendService - Pure Tauri IPC communication layer
 *
 * This service provides direct IPC communication with the Rust backend,
 * replacing HTTP-based communication to avoid enterprise security tools
 * (e.g., Proofpoint URLdefense) intercepting localhost traffic in hospital environments.
 *
 * All methods use Tauri's `invoke` to call Rust commands registered in src-tauri/src/commands/
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  DDADecodeRequest,
  DDAGetDataRequest,
  DDADecodeResponse,
  DDAResultMetadata,
} from "@/workers/ddaDecodeWorker";
import type {
  EDFFileInfo,
  ChunkData,
  DDAAnalysisRequest,
  DDAResult,
  DDAVariantConfig,
  HealthResponse,
} from "@/types/api";
import type {
  ICAAnalysisRequest,
  ICAResult,
  ICAAnalysisResult,
  ReconstructRequest,
  ReconstructResponse,
} from "@/types/ica";

// ============================================================================
// EDF Command Types
// ============================================================================

/** Parameters for preprocessing filters */
export interface PreprocessingParams {
  highpass?: number;
  lowpass?: number;
  notch?: number[];
}

/** Parameters for get_edf_chunk command */
export interface GetChunkParams {
  filePath: string;
  startTime?: number;
  duration?: number;
  chunkStart?: number;
  chunkSize?: number;
  channels?: string[];
  preprocessing?: PreprocessingParams;
}

/** Parameters for get_edf_overview command */
export interface GetOverviewParams {
  filePath: string;
  maxPoints?: number;
  channels?: string[];
}

/** Parameters for get_edf_window command (lazy loading for large files) */
export interface GetWindowParams {
  filePath: string;
  startTime?: number;
  duration?: number;
  channels?: string[];
}

/** Window data response for lazy file reading (100GB+ files) */
export interface WindowData {
  data: number[][];
  channelLabels: string[];
  sampleRate: number;
  startTimeSec: number;
  durationSec: number;
  numSamples: number;
  fromCache: boolean;
}

/** Cache statistics for lazy reader */
export interface CacheStatsResponse {
  numWindows: number;
  totalSizeBytes: number;
  totalSizeMb: number;
  maxWindows: number;
  maxSizeBytes: number;
  maxSizeMb: number;
}

/** Progress response for overview computation */
export interface OverviewProgressResponse {
  hasCache: boolean;
  completionPercentage: number;
  isComplete: boolean;
}

/** Chunk data response from Rust (camelCase from serde) */
export interface ChunkDataResponse {
  data: number[][];
  channelLabels: string[];
  samplingFrequency: number;
  chunkSize: number;
  chunkStart: number;
  totalSamples?: number;
}

// ============================================================================
// File Command Types
// ============================================================================

/** File entry from directory listing */
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
  extension?: string;
  isSupported?: boolean;
  isMeg?: boolean;
  isAnnexPlaceholder?: boolean;
}

/** Directory listing response */
export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
  totalFiles: number;
  totalDirectories: number;
}

/** Data directory response */
export interface DataDirectoryResponse {
  path: string;
  isValid: boolean;
}

// ============================================================================
// DDA Command Types
// ============================================================================

/** Time range for analysis */
export interface TimeRange {
  start: number;
  end: number;
}

/** Preprocessing options for DDA */
export interface DDAPreprocessingOptions {
  highpass?: number;
  lowpass?: number;
}

/** Algorithm selection for DDA */
export interface AlgorithmSelection {
  enabledVariants: string[];
  selectMask?: string;
}

/** Window parameters for DDA */
export interface WindowParameters {
  windowLength: number;
  windowStep: number;
  ctWindowLength?: number;
  ctWindowStep?: number;
}

/** Scale parameters for DDA */
export interface ScaleParameters {
  delayList: number[];
}

/** Model parameters for DDA */
export interface ModelParameters {
  dm: number;
  order: number;
  nrTau: number;
}

/** DDA analysis request for IPC (camelCase) */
export interface DDAAnalysisIPCRequest {
  filePath: string;
  channels?: number[];
  timeRange: TimeRange;
  preprocessingOptions: DDAPreprocessingOptions;
  algorithmSelection: AlgorithmSelection;
  windowParameters: WindowParameters;
  scaleParameters: ScaleParameters;
  ctChannelPairs?: [number, number][];
  cdChannelPairs?: [number, number][];
  modelParameters?: ModelParameters;
  variantConfigs?: Record<string, DDAVariantConfig>;
}

/** DDA status response */
export interface DDAStatusResponse {
  id: string;
  status: string;
  progress: number;
  message?: string;
}

/** DDA history entry */
export interface DDAHistoryEntry {
  id: string;
  name?: string;
  filePath: string;
  createdAt: string;
  variantName: string;
  channelsCount: number;
}

/** Cancel DDA response */
export interface CancelDDAResponse {
  success: boolean;
  message: string;
  cancelledAnalysisId?: string;
}

/** Backend DDA metadata response (camelCase from serde) */
interface BackendVariantMetadata {
  variantId: string;
  variantName: string;
  exponents: Record<string, number>;
  qualityMetrics: Record<string, number>;
  hasNetworkMotifs: boolean;
}

interface BackendDDAMetadata {
  id: string;
  name?: string;
  filePath: string;
  channels: string[];
  status: string;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  source?: string;
  parameters: unknown;
  windowIndices: number[];
  variants: BackendVariantMetadata[];
}

// ============================================================================
// ICA Command Types
// ============================================================================

/** ICA time range */
export interface ICATimeRange {
  start: number;
  end: number;
}

/** ICA parameters for IPC request */
export interface ICAParametersIPCRequest {
  nComponents?: number;
  algorithm?: string;
  gFunction?: string;
  maxIterations?: number;
  tolerance?: number;
  centering?: boolean;
  whitening?: boolean;
}

/** ICA submit request for IPC */
export interface ICASubmitIPCRequest {
  filePath: string;
  channels?: number[];
  timeRange?: ICATimeRange;
  parameters: ICAParametersIPCRequest;
}

/** ICA history entry */
export interface ICAHistoryEntry {
  id: string;
  name?: string;
  filePath: string;
  channels: string[];
  createdAt: string;
  status: string;
}

/** ICA result response from Rust */
export interface ICAResultResponse {
  id: string;
  name?: string;
  filePath: string;
  channels: string[];
  createdAt: string;
  status: string;
  results: ICAAnalysisResult;
}

/** ICA reconstruct request */
export interface ICAReconstructIPCRequest {
  analysisId: string;
  componentsToRemove: number[];
}

/** Reconstructed channel */
export interface ReconstructedChannel {
  name: string;
  samples: number[];
}

/** ICA reconstruct response */
export interface ICAReconstructIPCResponse {
  channels: ReconstructedChannel[];
}

// ============================================================================
// TauriBackendService Implementation
// ============================================================================

class TauriBackendServiceImpl {
  // ==========================================================================
  // Health Check
  // ==========================================================================

  /**
   * Check if the backend is healthy by invoking get_app_state.
   * Returns a health response if successful.
   */
  async checkHealth(): Promise<HealthResponse> {
    try {
      await invoke("get_app_state");
      return {
        status: "healthy",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(
        `Backend health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ==========================================================================
  // EDF Operations
  // ==========================================================================

  /**
   * Get EDF/neurophysiology file information (channels, duration, sample rate)
   */
  async getEdfInfo(filePath: string): Promise<EDFFileInfo> {
    return invoke<EDFFileInfo>("get_edf_info", { filePath });
  }

  /**
   * Get chunk data for visualization with optional preprocessing
   */
  async getEdfChunk(
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    channels?: string[],
    preprocessing?: PreprocessingParams,
  ): Promise<ChunkData> {
    const params: GetChunkParams = {
      filePath,
      chunkStart,
      chunkSize,
      channels,
      preprocessing,
    };

    const response = await invoke<ChunkDataResponse>("get_edf_chunk", {
      params,
    });

    // Map Rust response (camelCase from serde) to frontend ChunkData format
    return {
      data: response.data,
      channels: response.channelLabels,
      timestamps: [],
      sample_rate: response.samplingFrequency,
      chunk_start: response.chunkStart,
      chunk_size: response.chunkSize,
      file_path: filePath,
    };
  }

  /**
   * Get downsampled overview data for file visualization (minimap)
   */
  async getEdfOverview(
    filePath: string,
    channels?: string[],
    maxPoints?: number,
  ): Promise<ChunkData> {
    const params: GetOverviewParams = {
      filePath,
      channels,
      maxPoints: maxPoints ?? 2000,
    };

    const response = await invoke<ChunkDataResponse>("get_edf_overview", {
      params,
    });

    return {
      data: response.data,
      channels: response.channelLabels,
      timestamps: [],
      sample_rate: response.samplingFrequency,
      chunk_start: response.chunkStart,
      chunk_size: response.chunkSize,
      file_path: filePath,
    };
  }

  /**
   * Get overview computation progress
   */
  async getEdfOverviewProgress(
    filePath: string,
    channels?: string[],
    maxPoints?: number,
  ): Promise<OverviewProgressResponse> {
    return invoke<OverviewProgressResponse>("get_edf_overview_progress", {
      filePath,
      maxPoints: maxPoints ?? 2000,
      channels,
    });
  }

  /**
   * Get data window using lazy loading (optimized for large files 100GB+)
   */
  async getEdfWindow(
    filePath: string,
    startTime: number = 0,
    duration: number = 30,
    channels?: string[],
  ): Promise<WindowData> {
    const params: GetWindowParams = {
      filePath,
      startTime,
      duration,
      channels,
    };

    return invoke<WindowData>("get_edf_window", { params });
  }

  /**
   * Get cache statistics for the lazy file reader
   */
  async getEdfCacheStats(): Promise<CacheStatsResponse> {
    return invoke<CacheStatsResponse>("get_edf_cache_stats");
  }

  /**
   * Clear the lazy file reader cache
   */
  async clearEdfCache(): Promise<{ status: string; message: string }> {
    return invoke<{ status: string; message: string }>("clear_edf_cache");
  }

  // ==========================================================================
  // File Operations
  // ==========================================================================

  /**
   * List contents of a directory
   */
  async listDirectory(path?: string): Promise<DirectoryListing> {
    return invoke<DirectoryListing>("list_directory", { path });
  }

  /**
   * List supported data files (EDF, BrainVision, etc.) in a directory
   */
  async listDataFiles(path?: string): Promise<DirectoryListing> {
    return invoke<DirectoryListing>("list_data_files", { path });
  }

  /**
   * Update the working data directory
   */
  async updateDataDirectory(path: string): Promise<DataDirectoryResponse> {
    return invoke<DataDirectoryResponse>("update_data_directory", { path });
  }

  /**
   * Get the current data directory
   */
  async getDataDirectory(): Promise<DataDirectoryResponse> {
    return invoke<DataDirectoryResponse>("get_current_data_directory");
  }

  // ==========================================================================
  // DDA Operations
  // ==========================================================================

  /**
   * Convert frontend DDAAnalysisRequest to IPC format
   */
  private convertToDDAIPCRequest(
    request: DDAAnalysisRequest,
  ): DDAAnalysisIPCRequest {
    // Convert channel strings to indices (channels are 0-based index strings)
    const channelIndices = request.channels
      .map((ch) => parseInt(ch, 10))
      .filter((idx) => !isNaN(idx) && idx >= 0);

    return {
      filePath: request.file_path,
      channels: channelIndices.length > 0 ? channelIndices : undefined,
      timeRange: {
        start: request.start_time,
        end: request.end_time,
      },
      preprocessingOptions: {
        highpass: request.delay_list?.[0]
          ? request.delay_list[0] * 0.1
          : undefined,
        lowpass: request.delay_list?.length
          ? request.delay_list[request.delay_list.length - 1] * 2
          : undefined,
      },
      algorithmSelection: {
        enabledVariants: request.variants || ["single_timeseries"],
      },
      windowParameters: {
        windowLength: request.window_length ?? 64,
        windowStep: request.window_step ?? 10,
        ctWindowLength: request.ct_window_length,
        ctWindowStep: request.ct_window_step,
      },
      scaleParameters: {
        delayList: request.delay_list || [7, 10],
      },
      ctChannelPairs: request.ct_channel_pairs,
      cdChannelPairs: request.cd_channel_pairs,
      modelParameters:
        request.model_dimension && request.polynomial_order && request.nr_tau
          ? {
              dm: request.model_dimension,
              order: request.polynomial_order,
              nrTau: request.nr_tau,
            }
          : undefined,
      variantConfigs: request.variant_configs,
    };
  }

  /**
   * Submit a DDA analysis job
   */
  async submitDDAAnalysis(request: DDAAnalysisRequest): Promise<DDAResult> {
    const ipcRequest = this.convertToDDAIPCRequest(request);
    return invoke<DDAResult>("submit_dda_analysis", { request: ipcRequest });
  }

  /**
   * Get the status of a DDA analysis
   */
  async getDDAStatus(analysisId: string): Promise<DDAStatusResponse> {
    return invoke<DDAStatusResponse>("get_dda_status", { analysisId });
  }

  /**
   * Cancel a running DDA analysis
   */
  async cancelDDA(): Promise<CancelDDAResponse> {
    return invoke<CancelDDAResponse>("cancel_dda");
  }

  /**
   * Get a DDA result by its ID
   */
  async getDDAResult(analysisId: string): Promise<DDAResult | null> {
    return invoke<DDAResult | null>("get_dda_result_by_id", { analysisId });
  }

  /**
   * Get all DDA results for a specific file
   */
  async getDDAResultsForFile(
    filePath: string,
    limit?: number,
  ): Promise<DDAHistoryEntry[]> {
    return invoke<DDAHistoryEntry[]>("get_dda_results_for_file", {
      filePath,
      limit,
    });
  }

  /**
   * List all DDA history entries
   */
  async listDDAHistory(limit?: number): Promise<DDAHistoryEntry[]> {
    return invoke<DDAHistoryEntry[]>("list_dda_history", { limit });
  }

  /**
   * Save a DDA result to history
   */
  async saveDDAToHistory(result: DDAResult): Promise<void> {
    return invoke<void>("save_dda_to_history", { result });
  }

  // Lazy-initialized decode worker
  private decodeWorker: Worker | null = null;
  private decodeRequestCounter = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  private getDecodeWorker(): Worker {
    if (!this.decodeWorker) {
      this.decodeWorker = new Worker(
        new URL("../workers/ddaDecodeWorker.ts", import.meta.url),
        { type: "module" },
      );

      this.decodeWorker.onmessage = (
        event: MessageEvent<DDADecodeResponse>,
      ) => {
        const response = event.data;
        const pending = this.pendingRequests.get(response.id);

        if (!pending) {
          console.warn(
            "[DDA] Received response for unknown request:",
            response.id,
          );
          return;
        }

        this.pendingRequests.delete(response.id);

        if (response.type === "error") {
          pending.reject(new Error(response.error ?? "Unknown worker error"));
        } else if (response.type === "metadata") {
          // Log worker timing
          if (response.timing) {
            console.log(
              `[DDA PERF] Worker: decompress=${response.timing.decompressMs.toFixed(1)}ms, decode=${response.timing.decodeMs.toFixed(1)}ms, total=${response.timing.totalMs.toFixed(1)}ms`,
            );
            console.log(
              `[DDA PERF] Worker data: compressed=${(response.timing.compressedSize / 1024 / 1024).toFixed(1)}MB → uncompressed=${(response.timing.uncompressedSize / 1024 / 1024).toFixed(1)}MB`,
            );
          }
          pending.resolve(response.metadata);
        } else if (response.type === "data") {
          pending.resolve({
            ddaMatrix: response.ddaMatrix,
            windowIndices: response.windowIndices,
          });
        } else if (response.type === "cacheCleared") {
          pending.resolve(response.clearedIds);
        } else {
          console.warn(
            "[DDA] Unexpected response type:",
            (response as { type: string }).type,
          );
          pending.resolve(null);
        }
      };

      this.decodeWorker.onerror = (error) => {
        console.error("[DDA] Decode worker error:", error);
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error(`Worker error: ${error.message}`));
          this.pendingRequests.delete(id);
        }
      };
    }

    return this.decodeWorker;
  }

  /**
   * Backend metadata response type (camelCase from serde)
   */
  private convertBackendMetadata(
    backend: BackendDDAMetadata,
  ): DDAResultMetadata {
    return {
      id: backend.id,
      name: backend.name,
      file_path: backend.filePath,
      channels: backend.channels,
      status: backend.status as DDAResultMetadata["status"],
      created_at: backend.createdAt,
      completed_at: backend.completedAt,
      error_message: backend.errorMessage,
      source: backend.source as DDAResultMetadata["source"],
      parameters: backend.parameters,
      window_indices: backend.windowIndices,
      variants: backend.variants.map((v) => ({
        variant_id: v.variantId,
        variant_name: v.variantName,
        exponents: v.exponents,
        quality_metrics: v.qualityMetrics,
        has_network_motifs: v.hasNetworkMotifs,
      })),
    };
  }

  /**
   * Get DDA metadata from history by ID (fast, no large data transfer).
   *
   * PROGRESSIVE LOADING: Returns only metadata immediately (~10-50ms).
   * Full dda_matrix data is fetched on-demand via getDDAChannelData().
   *
   * This uses a direct IPC call that returns small JSON metadata,
   * avoiding the 600ms worker decode overhead for initial display.
   */
  async getDDAFromHistory(
    analysisId: string,
  ): Promise<DDAResultMetadata | null> {
    const t0 = performance.now();
    try {
      // Fast path: get metadata directly from Rust (small JSON, no file/decode)
      const backendMetadata = await invoke<BackendDDAMetadata | null>(
        "get_dda_metadata_from_history",
        { analysisId },
      );
      const t1 = performance.now();
      console.log(`[DDA PERF] Metadata IPC: ${(t1 - t0).toFixed(1)}ms`);

      if (!backendMetadata) {
        console.warn("[DDA] No metadata found for:", analysisId);
        return null;
      }

      const metadata = this.convertBackendMetadata(backendMetadata);
      console.log(
        `[DDA PERF] Total getDDAFromHistory: ${(performance.now() - t0).toFixed(1)}ms`,
      );

      return metadata;
    } catch (error) {
      console.error("[DDA] getDDAFromHistory error:", error);
      throw error;
    }
  }

  /**
   * Ensure the full DDA result is loaded in the worker cache.
   * Called lazily when channel data is actually needed.
   */
  private async ensureDataInWorkerCache(analysisId: string): Promise<void> {
    const t0 = performance.now();

    // Get temp file path from Rust
    const tempFilePath = await invoke<string>("get_dda_from_history_msgpack", {
      analysisId,
    });
    const t1 = performance.now();
    console.log(`[DDA PERF] Data blob IPC: ${(t1 - t0).toFixed(1)}ms`);

    if (!tempFilePath) {
      throw new Error("Failed to get data file path");
    }

    // Read file using Tauri's fs plugin
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const compressedData = await readFile(tempFilePath);
    const t2 = performance.now();
    console.log(
      `[DDA PERF] Data file read (${(compressedData.byteLength / 1024 / 1024).toFixed(1)}MB): ${(t2 - t1).toFixed(1)}ms`,
    );

    if (compressedData.byteLength === 0) {
      throw new Error("Empty data file");
    }

    // Decode in worker and cache (we don't need the metadata response here)
    await this.decodeAndCacheInWorker(compressedData.buffer, analysisId);
    const t3 = performance.now();
    console.log(`[DDA PERF] Worker decode + cache: ${(t3 - t2).toFixed(1)}ms`);
  }

  /**
   * Get specific channel data from a cached DDA result.
   *
   * PROGRESSIVE LOADING: Fetches only the requested channels' dda_matrix.
   * If the data is not in the worker cache, it will be loaded on-demand.
   */
  async getDDAChannelData(
    analysisId: string,
    variantId: string,
    channels: string[],
  ): Promise<{ ddaMatrix: Record<string, number[]>; windowIndices: number[] }> {
    const t0 = performance.now();

    try {
      // Try to get from worker cache first
      const result = await this.getDataFromWorkerCache(
        analysisId,
        variantId,
        channels,
      );

      const t1 = performance.now();
      const channelCount = Object.keys(result.ddaMatrix).length;
      const dataSize = Object.values(result.ddaMatrix).reduce(
        (sum, arr) => sum + arr.length * 8,
        0,
      );
      console.log(
        `[DDA PERF] Channel data (cache hit): ${(t1 - t0).toFixed(1)}ms (${channelCount} channels, ${(dataSize / 1024).toFixed(1)}KB)`,
      );

      return result;
    } catch (error) {
      // Cache miss - load the data blob on-demand
      console.log(`[DDA PERF] Cache miss for ${analysisId}, loading data...`);
      const t1 = performance.now();

      await this.ensureDataInWorkerCache(analysisId);
      const t2 = performance.now();
      console.log(
        `[DDA PERF] Data loaded in ${(t2 - t1).toFixed(1)}ms, retrying...`,
      );

      // Retry from cache
      const result = await this.getDataFromWorkerCache(
        analysisId,
        variantId,
        channels,
      );

      const t3 = performance.now();
      const channelCount = Object.keys(result.ddaMatrix).length;
      const dataSize = Object.values(result.ddaMatrix).reduce(
        (sum, arr) => sum + arr.length * 8,
        0,
      );
      console.log(
        `[DDA PERF] Channel data (after load): ${(t3 - t0).toFixed(1)}ms total (${channelCount} channels, ${(dataSize / 1024).toFixed(1)}KB)`,
      );

      return result;
    }
  }

  private decodeAndCacheInWorker(
    compressedData: ArrayBuffer,
    analysisId: string,
  ): Promise<DDAResultMetadata | null> {
    return new Promise((resolve, reject) => {
      const id = `decode-${++this.decodeRequestCounter}`;
      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
      });

      const request: DDADecodeRequest = {
        id,
        type: "decode",
        compressedData,
        analysisId,
      };

      // Transfer the ArrayBuffer to the worker (zero-copy)
      this.getDecodeWorker().postMessage(request, [compressedData]);
    });
  }

  private getDataFromWorkerCache(
    analysisId: string,
    variantId: string,
    channels: string[],
  ): Promise<{ ddaMatrix: Record<string, number[]>; windowIndices: number[] }> {
    return new Promise((resolve, reject) => {
      const id = `getData-${++this.decodeRequestCounter}`;
      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
      });

      const request: DDAGetDataRequest = {
        id,
        type: "getData",
        analysisId,
        variantId,
        channels,
      };

      this.getDecodeWorker().postMessage(request);
    });
  }

  /**
   * Get full DDA result including all channel data.
   *
   * WARNING: This transfers ~45MB and blocks UI for ~700ms.
   * Use getDDAFromHistory + getDDAChannelData for progressive loading instead.
   * This method is only for cases where you need all data at once (e.g., export, preview window).
   */
  async getDDAFromHistoryFull(analysisId: string): Promise<DDAResult | null> {
    // First get metadata
    const metadata = await this.getDDAFromHistory(analysisId);
    if (!metadata) return null;

    // Then fetch all channel data for all variants
    const variantsWithData = await Promise.all(
      metadata.variants.map(async (variant) => {
        const { ddaMatrix } = await this.getDDAChannelData(
          analysisId,
          variant.variant_id,
          metadata.channels, // All channels
        );
        return {
          variant_id: variant.variant_id,
          variant_name: variant.variant_name,
          dda_matrix: ddaMatrix,
          exponents: variant.exponents,
          quality_metrics: variant.quality_metrics,
        };
      }),
    );

    return {
      id: metadata.id,
      name: metadata.name,
      file_path: metadata.file_path,
      channels: metadata.channels,
      parameters: metadata.parameters as DDAAnalysisRequest,
      results: {
        window_indices: metadata.window_indices,
        variants: variantsWithData,
      },
      status: metadata.status,
      created_at: metadata.created_at,
      completed_at: metadata.completed_at,
      error_message: metadata.error_message,
      source: metadata.source,
    };
  }

  /**
   * Delete a DDA result from history
   */
  async deleteDDAFromHistory(analysisId: string): Promise<void> {
    return invoke<void>("delete_dda_from_history", { analysisId });
  }

  /**
   * Rename a DDA result in history
   */
  async renameDDAInHistory(analysisId: string, newName: string): Promise<void> {
    return invoke<void>("rename_dda_in_history", { analysisId, newName });
  }

  // ==========================================================================
  // ICA Operations
  // ==========================================================================

  /**
   * Convert frontend ICAAnalysisRequest to IPC format
   */
  private convertToICAIPCRequest(
    request: ICAAnalysisRequest,
  ): ICASubmitIPCRequest {
    return {
      filePath: request.file_path,
      channels: request.channels,
      timeRange: request.time_range
        ? {
            start: request.time_range.start,
            end: request.time_range.end,
          }
        : undefined,
      parameters: {
        nComponents: request.parameters.n_components,
        algorithm: request.parameters.algorithm,
        gFunction: request.parameters.g_function,
        maxIterations: request.parameters.max_iterations,
        tolerance: request.parameters.tolerance,
        centering: request.parameters.centering,
        whitening: request.parameters.whitening,
      },
    };
  }

  /**
   * Convert ICA result response to frontend ICAResult format
   */
  private convertToICAResult(response: ICAResultResponse): ICAResult {
    return {
      id: response.id,
      name: response.name,
      file_path: response.filePath,
      channels: response.channels,
      created_at: response.createdAt,
      status: response.status,
      results: response.results,
    };
  }

  /**
   * Submit an ICA analysis job
   */
  async submitICAAnalysis(request: ICAAnalysisRequest): Promise<ICAResult> {
    const ipcRequest = this.convertToICAIPCRequest(request);
    const response = await invoke<ICAResultResponse>("submit_ica_analysis", {
      request: ipcRequest,
    });
    return this.convertToICAResult(response);
  }

  /**
   * Get all ICA analysis results (history entries)
   */
  async getICAResults(): Promise<ICAHistoryEntry[]> {
    return invoke<ICAHistoryEntry[]>("get_ica_results");
  }

  /**
   * Get a specific ICA result by ID
   */
  async getICAResult(analysisId: string): Promise<ICAResult | null> {
    const response = await invoke<ICAResultResponse | null>(
      "get_ica_result_by_id",
      { analysisId },
    );
    return response ? this.convertToICAResult(response) : null;
  }

  /**
   * Delete an ICA result
   */
  async deleteICAResult(analysisId: string): Promise<boolean> {
    return invoke<boolean>("delete_ica_result", { analysisId });
  }

  /**
   * Reconstruct data with specified components removed (for artifact rejection)
   */
  async icaReconstructWithoutComponents(
    analysisId: string,
    componentsToRemove: number[],
  ): Promise<ReconstructResponse> {
    const request: ICAReconstructIPCRequest = {
      analysisId,
      componentsToRemove,
    };
    const response = await invoke<ICAReconstructIPCResponse>(
      "ica_reconstruct_without_components",
      { request },
    );
    return { channels: response.channels };
  }
}

// Export singleton instance
export const tauriBackendService = new TauriBackendServiceImpl();
export default tauriBackendService;
