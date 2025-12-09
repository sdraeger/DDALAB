import axios, { AxiosInstance, AxiosError } from "axios";
import {
  EDFFileInfo,
  ChunkData,
  Annotation,
  DDAAnalysisRequest,
  DDAResult,
  HealthResponse,
} from "@/types/api";
import {
  ICAAnalysisRequest,
  ICAResult,
  ReconstructRequest,
  ReconstructResponse,
} from "@/types/ica";
import { getChunkCache } from "./chunkCache";

/** File entry from the API file list response */
interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size?: number;
  file_size?: number;
  last_modified?: string;
}

/** File list API response */
interface FileListResponse {
  files: FileEntry[];
}

/** Query parameters type for API calls */
type QueryParams = Record<string, string | number | boolean | undefined>;

/** Analysis history item from backend */
interface HistoryAnalysisItem {
  id: string;
  result_id?: string;
  created_at?: string;
  analysis_data?: Record<string, unknown>;
}

/** Variant result item */
interface VariantItem {
  variant_id: string;
  [key: string]: unknown;
}

/**
 * Check if an error is retryable (network issues, timeouts, 5xx errors)
 */
function isRetryableError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    // Network errors (no response)
    if (!axiosError.response) {
      return true;
    }
    // Server errors (5xx)
    const status = axiosError.response.status;
    if (status >= 500 && status < 600) {
      return true;
    }
    // Rate limiting
    if (status === 429) {
      return true;
    }
  }
  // Check error message for common retryable patterns
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused")
  );
}

/**
 * Execute a function with retry logic for network operations
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    context?: string;
  } = {},
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, context = "API call" } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if not a retryable error or last attempt
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const delay = Math.min(baseDelay * Math.pow(2, attempt), 10000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export class ApiService {
  private client: AxiosInstance;
  public baseURL: string;
  private chunkCache = getChunkCache();
  private sessionToken: string | null = null;

  constructor(baseURL: string, sessionToken?: string) {
    this.baseURL = baseURL;
    this.sessionToken = sessionToken || null;

    this.client = axios.create({
      baseURL,
      timeout: 3600000, // 1 hour for heavy DDA operations
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Add request interceptor to include session token
    this.client.interceptors.request.use((config) => {
      if (this.sessionToken) {
        config.headers.Authorization = `Bearer ${this.sessionToken}`;
      }
      return config;
    });
  }

  // Set or update the session token
  setSessionToken(token: string) {
    this.sessionToken = token;
  }

  // Get the current session token
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  // Health check
  async checkHealth(): Promise<HealthResponse> {
    return withRetry(
      async () => {
        const response = await this.client.get<HealthResponse>("/api/health");
        return response.data;
      },
      { maxRetries: 3, context: "Health check" },
    );
  }

  // File management
  async getAvailableFiles(): Promise<EDFFileInfo[]> {
    try {
      // Get files from root directory (which is mapped to data/edf by the API server)
      const rootResponse =
        await this.client.get<FileListResponse>("/api/files/list");

      if (rootResponse.data && Array.isArray(rootResponse.data.files)) {
        // Filter for EDF files only (API server already handles the directory mapping)
        const edfFiles = rootResponse.data.files
          .filter(
            (file) =>
              !file.is_directory &&
              (file.name.toLowerCase().endsWith(".edf") ||
                file.name.toLowerCase().endsWith(".ascii")),
          )
          .map((file) => ({
            file_path: file.path,
            file_name: file.name,
            file_size: file.size || 0,
            duration: 0,
            sample_rate: 256,
            channels: [],
            total_samples: 0,
            start_time: file.last_modified || new Date().toISOString(),
            end_time: file.last_modified || new Date().toISOString(),
            annotations_count: 0,
          }));

        return edfFiles;
      }

      return [];
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? `Failed to fetch file list (HTTP ${error.response?.status ?? "unknown"}): ${error.message}`
        : error instanceof Error
          ? error.message
          : "Unknown error fetching files";
      throw new Error(message);
    }
  }

  async getFileInfo(filePath: string): Promise<EDFFileInfo> {
    // Clear cache for this file when loading new file info
    this.chunkCache.clearFile(filePath);

    return withRetry(
      async () => {
        // Get EDF-specific metadata from the correct endpoint
        const edfResponse = await this.client.get(`/api/edf/info`, {
          params: {
            file_path: filePath,
          },
        });

        // Get file size from files list endpoint
        let fileSize = 0;
        try {
          const directory = filePath.substring(0, filePath.lastIndexOf("/"));
          const fileName = filePath.split("/").pop() || filePath;

          const filesResponse = await this.client.get(`/api/files/list`, {
            params: {
              path: directory,
            },
          });

          const fileEntry = filesResponse.data.files?.find(
            (f: FileEntry) => f.name === fileName,
          );
          fileSize = fileEntry?.file_size || fileEntry?.size || 0;
        } catch {
          // File size retrieval failed silently
        }

        const fileInfo: EDFFileInfo = {
          file_path: filePath,
          file_name: filePath.split("/").pop() || filePath,
          file_size: fileSize,
          duration:
            edfResponse.data.duration || edfResponse.data.total_duration || 0,
          sample_rate:
            edfResponse.data.sample_rate ||
            edfResponse.data.sampling_rate ||
            256,
          channels: edfResponse.data.channels || [],
          total_samples: edfResponse.data.total_samples || 0,
          start_time: edfResponse.data.start_time || new Date().toISOString(),
          end_time: edfResponse.data.end_time || new Date().toISOString(),
          annotations_count: 0,
        };

        return fileInfo;
      },
      { maxRetries: 2, context: "Get file info" },
    );
  }

  async listDirectory(path: string = ""): Promise<{
    files: Array<{
      name: string;
      path: string;
      is_directory: boolean;
      size?: number;
      last_modified?: string;
      /** True if file is a git-annex symlink that hasn't been downloaded */
      is_annex_placeholder?: boolean;
    }>;
  }> {
    const response = await this.client.get("/api/files/list", {
      params: { path },
    });
    return response.data;
  }

  // Get overview of entire file (downsampled for navigation)
  async getOverviewData(
    filePath: string,
    requestedChannels?: string[],
    maxPoints: number = 2000,
    signal?: AbortSignal,
  ): Promise<ChunkData> {
    try {
      // IMMER/TanStack Query FIX: Clone requestedChannels if provided (might be frozen from store)
      // Use spread operator for simple string arrays - faster than JSON parse/stringify
      const channels = requestedChannels ? [...requestedChannels] : undefined;

      const params: QueryParams = {
        file_path: filePath,
        max_points: maxPoints,
        channels:
          channels && channels.length > 0 ? channels.join(",") : undefined,
      };

      const response = await this.client.get("/api/edf/overview", {
        params,
        signal,
      });

      const responseData = structuredClone(response.data);

      const chunkData: ChunkData = {
        data: responseData.data || [],
        channels: responseData.channel_labels || responseData.channels || [],
        timestamps: responseData.timestamps || [],
        sample_rate:
          responseData.sampling_frequency || responseData.sample_rate || 256,
        chunk_start: responseData.chunk_start || 0,
        chunk_size: responseData.chunk_size || 0,
        file_path: responseData.file_path || filePath,
      };

      return chunkData;
    } catch (error) {
      throw error;
    }
  }

  async getOverviewProgress(
    filePath: string,
    requestedChannels?: string[],
    maxPoints: number = 2000,
    signal?: AbortSignal,
  ): Promise<{
    has_cache: boolean;
    completion_percentage: number;
    is_complete: boolean;
    samples_processed?: number;
    total_samples?: number;
  }> {
    try {
      // IMMER/TanStack Query FIX: Clone requestedChannels if provided (might be frozen from store)
      // Use spread operator for simple string arrays - faster than JSON parse/stringify
      const channels = requestedChannels ? [...requestedChannels] : undefined;

      const params: QueryParams = {
        file_path: filePath,
        max_points: maxPoints,
        channels:
          channels && channels.length > 0 ? channels.join(",") : undefined,
      };

      const response = await this.client.get("/api/edf/overview/progress", {
        params,
        signal,
      });

      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // EDF Data
  async getChunkData(
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    requestedChannels?: string[],
    signal?: AbortSignal,
    preprocessing?: {
      highpass?: number;
      lowpass?: number;
      notch?: number[];
    },
  ): Promise<ChunkData> {
    try {
      // IMMER/TanStack Query FIX: Clone all input parameters that might come from frozen store state
      // Use spread/structuredClone for better performance than JSON parse/stringify
      const preprocessingOptions = preprocessing
        ? {
            ...preprocessing,
            notch: preprocessing.notch ? [...preprocessing.notch] : undefined,
          }
        : undefined;
      const channelList = requestedChannels
        ? [...requestedChannels]
        : undefined;

      // Check cache first (only if no preprocessing)
      if (!preprocessingOptions) {
        const cached = this.chunkCache.get(
          filePath,
          chunkStart,
          chunkSize,
          channelList,
        );
        if (cached) {
          return structuredClone(cached);
        }
      }

      const params: QueryParams = {
        file_path: filePath,
        chunk_start: chunkStart,
        chunk_size: chunkSize,
        channels:
          channelList && channelList.length > 0
            ? channelList.join(",")
            : undefined,
        highpass: preprocessingOptions?.highpass,
        lowpass: preprocessingOptions?.lowpass,
        notch: preprocessingOptions?.notch?.join(","),
      };

      const response = await this.client.get("/api/edf/data", {
        params,
        signal,
      });

      const responseData = structuredClone(response.data);

      // Extract data structure first
      const data = responseData.data || [];
      const channels =
        responseData.channel_labels || responseData.channels || [];
      const actualChunkSize = responseData.chunk_size || chunkSize;
      const sampleRate =
        responseData.sampling_frequency || responseData.sample_rate || 256;

      // Generate timestamps if not provided
      let timestamps = responseData.timestamps || [];
      if (timestamps.length === 0 && actualChunkSize > 0) {
        timestamps = Array.from(
          { length: actualChunkSize },
          (_, i) => (chunkStart + i) / sampleRate,
        );
      }

      const chunkData: ChunkData = {
        data,
        channels,
        timestamps,
        sample_rate: sampleRate,
        chunk_start: responseData.chunk_start || chunkStart,
        chunk_size: actualChunkSize,
        file_path: responseData.file_path || filePath,
      };

      // Store in cache (only if no preprocessing applied)
      if (!preprocessingOptions) {
        this.chunkCache.set(
          filePath,
          chunkStart,
          chunkSize,
          chunkData,
          channelList,
        );
      }

      return structuredClone(chunkData);
    } catch (error) {
      throw error;
    }
  }

  // Annotations
  async getAnnotations(filePath: string): Promise<Annotation[]> {
    try {
      const response = await this.client.get(
        `/api/widget-data/annotations:${filePath}`,
      );
      if (!response.data || !response.data.annotations) {
        return [];
      }
      return response.data.annotations;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
      throw error;
    }
  }

  async createAnnotation(
    annotation: Omit<Annotation, "id" | "created_at">,
  ): Promise<Annotation> {
    const newAnnotation: Annotation = {
      ...annotation,
      id: Date.now().toString(),
      created_at: new Date().toISOString(),
    };

    const existing = await this.getAnnotations(annotation.file_path);
    const updated = [...existing, newAnnotation];

    await this.client.post("/api/widget-data", {
      key: `annotations:${annotation.file_path}`,
      data: { annotations: updated },
      widgetId: "annotations",
      metadata: { type: "annotations", file_path: annotation.file_path },
    });

    return newAnnotation;
  }

  async updateAnnotation(
    id: string,
    annotation: Partial<Annotation>,
  ): Promise<Annotation> {
    if (!annotation.file_path)
      throw new Error("file_path required for annotation update");

    const existing = await this.getAnnotations(annotation.file_path);
    const index = existing.findIndex((a) => a.id === id);
    if (index === -1) throw new Error("Annotation not found");

    const updated = { ...existing[index], ...annotation };
    existing[index] = updated;

    await this.client.post("/api/widget-data", {
      key: `annotations:${annotation.file_path}`,
      data: { annotations: existing },
      widgetId: "annotations",
      metadata: { type: "annotations", file_path: annotation.file_path },
    });

    return updated;
  }

  async deleteAnnotation(id: string, filePath: string): Promise<void> {
    const existing = await this.getAnnotations(filePath);
    const filtered = existing.filter((a) => a.id !== id);

    await this.client.post("/api/widget-data", {
      key: `annotations:${filePath}`,
      data: { annotations: filtered },
      widgetId: "annotations",
      metadata: { type: "annotations", file_path: filePath },
    });
  }

  // DDA Analysis
  private getVariantName(variantId: string): string {
    const variantNames: Record<string, string> = {
      single_timeseries: "Single Timeseries (ST)",
      cross_timeseries: "Cross Timeseries (CT)",
      cross_dynamical: "Cross Dynamical (CD)",
      dynamical_ergodicity: "Dynamical Ergodicity (DE)",
      synchronization: "Synchronization (SY)",
      delay_evolution: "Dynamical Ergodicity (DE)",
    };
    return variantNames[variantId] || variantId;
  }

  private normalizeVariantId(variantId: string): string {
    // Map old variant IDs to new standardized ones for backward compatibility
    const idMapping: Record<string, string> = {
      sy: "synchronization", // Old SY variant ID
      delay_evolution: "dynamical_ergodicity", // Normalize DE naming
      // All other IDs remain unchanged
    };
    return idMapping[variantId] || variantId;
  }

  async submitDDAAnalysis(request: DDAAnalysisRequest): Promise<DDAResult> {
    try {
      // Channels now come as string indices from frontend (0-based)
      // Convert to numbers for backend
      const channelIndices = request.channels
        .map((ch) => {
          const parsed = parseInt(ch);
          return isNaN(parsed) ? -1 : parsed;
        })
        .filter((idx) => idx !== -1);

      // Note: The backend DDARequest schema expects:
      // - algorithm_selection.enabled_variants: List of variant IDs
      // - The backend currently returns only a single Q matrix regardless of variants
      // - We handle this by creating variant-specific results in the frontend
      const ddaRequest = {
        file_path: request.file_path,
        channel_list: channelIndices,
        time_range: {
          start: request.start_time,
          end: request.end_time,
        },
        preprocessing_options: {
          highpass: request.delay_list?.[0]
            ? request.delay_list[0] * 0.1
            : null,
          lowpass: request.delay_list?.length
            ? request.delay_list[request.delay_list.length - 1] * 2
            : null,
        },
        algorithm_selection: {
          enabled_variants: request.variants || ["single_timeseries"],
        },
        window_parameters: {
          window_length: request.window_length || 64, // Default: 0.25 seconds at 256 Hz
          window_step: request.window_step || 10,
          ct_window_length: request.ct_window_length,
          ct_window_step: request.ct_window_step,
        },
        scale_parameters: {
          // Explicit list of delay values (tau) - default [7, 10] unless user specifies via expert mode
          delay_list: request.delay_list || [7, 10],
        },
        ct_channel_pairs: request.ct_channel_pairs,
        cd_channel_pairs: request.cd_channel_pairs,
        // NEW: Per-variant channel configuration
        variant_configs: request.variant_configs,
      };

      const response = await this.client.post("/api/dda", ddaRequest);
      // Use the ID from the backend response (UUID format) instead of generating our own
      const job_id = response.data.id || `dda_${Date.now()}`;

      // Create scales array from delay_list (fallback to default [7, 10] if empty)
      const delayList = request.delay_list || [7, 10];

      let scales: number[] = [...delayList];
      let dda_matrix: Record<string, number[]> = {};
      const exponents: Record<string, number> = {};
      const quality_metrics: Record<string, number> = {};

      const variants = [];
      let foundVariantData = false;

      if (
        response.data.results?.variants &&
        Array.isArray(response.data.results.variants)
      ) {
        foundVariantData = true;

        for (const variantData of response.data.results.variants) {
          if (
            response.data.results.scales &&
            Array.isArray(response.data.results.scales)
          ) {
            scales = response.data.results.scales;
          }

          variants.push({
            variant_id: variantData.variant_id,
            variant_name: variantData.variant_name,
            dda_matrix: variantData.dda_matrix || {},
            exponents: variantData.exponents || {},
            quality_metrics: variantData.quality_metrics || {},
          });
        }
      } else if (
        response.data.variants &&
        typeof response.data.variants === "object"
      ) {
        for (const variantId of request.variants) {
          if (response.data.variants[variantId]) {
            foundVariantData = true;
            const variantData = response.data.variants[variantId];

            const variantMatrix: Record<string, number[]> = {};
            const variantExponents: Record<string, number> = {};

            // Process variant-specific Q matrix
            if (variantData.Q && Array.isArray(variantData.Q)) {
              const timePoints = variantData.Q[0]?.length || 100;
              scales = Array.from({ length: timePoints }, (_, i) => i);

              request.channels.forEach((channel, idx) => {
                if (
                  idx < variantData.Q.length &&
                  Array.isArray(variantData.Q[idx])
                ) {
                  variantMatrix[channel] = variantData.Q[idx];
                  variantExponents[channel] =
                    variantData.exponents?.[channel] || 0.5;
                }
              });
            }

            variants.push({
              variant_id: variantId,
              variant_name: this.getVariantName(variantId),
              dda_matrix: variantMatrix,
              exponents: variantExponents,
              quality_metrics: variantData.quality_metrics || {},
            });
          }
        }
      } else if (!foundVariantData) {
        for (const variantId of request.variants) {
          // Check both the variant ID and common variant key patterns
          const possibleKeys = [
            variantId,
            variantId.toUpperCase(),
            variantId.toLowerCase(),
            // Map to common backend naming patterns
            variantId === "single_timeseries"
              ? "ST"
              : variantId === "cross_timeseries"
                ? "CT"
                : variantId === "cross_dynamical"
                  ? "CD"
                  : variantId === "dynamical_ergodicity"
                    ? "DE"
                    : variantId,
          ];

          let variantData = null;
          for (const key of possibleKeys) {
            if (response.data[key]) {
              variantData = response.data[key];
              break;
            }
          }

          if (variantData) {
            foundVariantData = true;
            const variantMatrix: Record<string, number[]> = {};
            const variantExponents: Record<string, number> = {};

            if (variantData.Q && Array.isArray(variantData.Q)) {
              const timePoints = variantData.Q[0]?.length || 100;
              scales = Array.from({ length: timePoints }, (_, i) => i);

              request.channels.forEach((channel, idx) => {
                if (
                  idx < variantData.Q.length &&
                  Array.isArray(variantData.Q[idx])
                ) {
                  variantMatrix[channel] = variantData.Q[idx];
                  variantExponents[channel] =
                    variantData.exponents?.[channel] || 0.5;
                }
              });
            } else if (variantData && Array.isArray(variantData)) {
              // Some backends might return Q matrix directly as the variant value
              const timePoints = variantData[0]?.length || 100;
              scales = Array.from({ length: timePoints }, (_, i) => i);

              request.channels.forEach((channel, idx) => {
                if (
                  idx < variantData.length &&
                  Array.isArray(variantData[idx])
                ) {
                  variantMatrix[channel] = variantData[idx];
                  variantExponents[channel] = 0.5; // Default value
                }
              });
            }

            variants.push({
              variant_id: variantId,
              variant_name: this.getVariantName(variantId),
              dda_matrix: variantMatrix,
              exponents: variantExponents,
              quality_metrics: {},
            });
          }
        }
      }

      if (!foundVariantData) {
        if (
          response.data.Q &&
          Array.isArray(response.data.Q) &&
          response.data.Q.length > 0
        ) {
          const timePoints = response.data.Q[0]?.length || 100;
          scales = Array.from({ length: timePoints }, (_, i) => i);

          request.channels.forEach((channel, idx) => {
            if (
              idx < response.data.Q.length &&
              Array.isArray(response.data.Q[idx])
            ) {
              dda_matrix[channel] = response.data.Q[idx];
              const validValues = response.data.Q[idx].filter(
                (v: number) => !isNaN(v) && isFinite(v),
              );
              if (validValues.length > 1) {
                exponents[channel] = 0.5;
              }
            }
          });

          // Create identical results for each requested variant
          // Note: This means the backend doesn't actually compute different variants
          for (const variantId of request.variants) {
            variants.push({
              variant_id: variantId,
              variant_name: this.getVariantName(variantId),
              dda_matrix: { ...dda_matrix }, // Clone the matrix
              exponents: { ...exponents }, // Clone the exponents
              quality_metrics: response.data.quality_metrics || {},
            });
          }
        } else {
          throw new Error(
            "Backend returned no DDA results (no Q matrix found)",
          );
        }
      }
      const result: DDAResult = {
        id: job_id,
        file_path: request.file_path,
        channels: request.channels,
        parameters: request,
        results: {
          scales,
          variants:
            variants.length > 0
              ? variants
              : [
                  {
                    variant_id: "single_timeseries",
                    variant_name: this.getVariantName("single_timeseries"),
                    dda_matrix,
                    exponents,
                    quality_metrics,
                  },
                ],
          // Legacy fields for backward compatibility (use first variant)
          dda_matrix: variants.length > 0 ? variants[0].dda_matrix : dda_matrix,
          exponents: variants.length > 0 ? variants[0].exponents : exponents,
          quality_metrics:
            variants.length > 0 ? variants[0].quality_metrics : quality_metrics,
        },
        status: "completed",
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      };

      return result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        let errorMessage = "Failed to submit DDA analysis";
        if (error.response) {
          errorMessage += ` (HTTP ${error.response.status})`;
          if (error.response.data) {
            if (typeof error.response.data === "string") {
              errorMessage += `: ${error.response.data}`;
            } else if (error.response.data.message) {
              errorMessage += `: ${error.response.data.message}`;
            } else if (error.response.data.error) {
              errorMessage += `: ${error.response.data.error}`;
            }
          }
        } else if (error.message) {
          errorMessage += `: ${error.message}`;
        }
        throw new Error(errorMessage);
      }

      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async getDDAResults(jobId?: string, filePath?: string): Promise<DDAResult[]> {
    try {
      const params: QueryParams = {
        job_id: jobId,
        file_path: filePath,
      };

      const response = await this.client.get("/api/dda/results", { params });
      return response.data.results || [];
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? `Failed to fetch DDA results (HTTP ${error.response?.status ?? "unknown"}): ${error.message}`
        : error instanceof Error
          ? error.message
          : "Unknown error fetching DDA results";
      throw new Error(message);
    }
  }

  async getDDAResult(jobId: string): Promise<DDAResult> {
    try {
      const response = await this.client.get(`/api/dda/results/${jobId}`);
      return response.data;
    } catch {
      throw new Error(`DDA result ${jobId} not found`);
    }
  }

  async getDDAStatus(
    jobId: string,
  ): Promise<{ status: string; progress?: number; message?: string }> {
    try {
      const response = await this.client.get(`/api/dda/status/${jobId}`);
      return response.data;
    } catch {
      return { status: "unknown", message: "Failed to get status" };
    }
  }

  async cancelDDAAnalysis(): Promise<{
    success: boolean;
    message: string;
    cancelled_analysis_id?: string;
  }> {
    try {
      const response = await this.client.post("/api/dda/cancel");
      return response.data;
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to cancel analysis",
      };
    }
  }

  async saveAnalysisToHistory(result: DDAResult): Promise<boolean> {
    try {
      const response = await this.client.post("/api/dda/history/save", {
        result_id: result.id,
        analysis_data: result,
      });

      return (
        response.data.success === true || response.data.status === "success"
      );
    } catch {
      return false;
    }
  }

  async getAnalysisHistory(): Promise<DDAResult[]> {
    try {
      const response = await this.client.get("/api/dda/history");

      let analyses = [];
      if (Array.isArray(response.data)) {
        analyses = response.data;
      } else {
        analyses = response.data.analyses || [];
      }

      const processed = analyses.map((item: HistoryAnalysisItem) => {
        if (item.analysis_data && typeof item.analysis_data === "object") {
          return {
            ...item.analysis_data,
            id: item.id,
            analysis_id: item.analysis_data.id,
            result_id: item.result_id,
            storage_created_at: item.created_at,
          };
        }
        return item;
      });

      return processed;
    } catch {
      return [];
    }
  }

  async getAnalysisFromHistory(resultId: string): Promise<DDAResult | null> {
    try {
      const response = await this.client.get(`/api/dda/history/${resultId}`);
      const analysisWrapper = response.data.analysis;

      if (!analysisWrapper) return null;

      if (
        analysisWrapper.analysis_data &&
        typeof analysisWrapper.analysis_data === "object"
      ) {
        const result = {
          ...analysisWrapper.analysis_data,
          id: analysisWrapper.id,
          analysis_id: analysisWrapper.analysis_data.id,
          result_id: analysisWrapper.result_id,
          storage_created_at: analysisWrapper.created_at,
        };

        if (result.results?.variants) {
          result.results.variants = result.results.variants.map(
            (v: VariantItem) => ({
              ...v,
              variant_id: this.normalizeVariantId(v.variant_id),
            }),
          );
        }

        return result;
      }

      return analysisWrapper;
    } catch {
      return null;
    }
  }

  async deleteAnalysisFromHistory(resultId: string): Promise<boolean> {
    try {
      const response = await this.client.delete(`/api/dda/history/${resultId}`);
      return response.data.success || false;
    } catch (error) {
      const axiosErr = axios.isAxiosError(error) ? error : null;
      const errorMsg =
        axiosErr?.response?.data?.error ||
        axiosErr?.response?.data?.message ||
        axiosErr?.message ||
        (error instanceof Error ? error.message : "Unknown error");
      throw new Error(`Failed to delete analysis: ${errorMsg}`);
    }
  }

  async renameAnalysisInHistory(
    resultId: string,
    newName: string,
  ): Promise<boolean> {
    try {
      const response = await this.client.put(
        `/api/dda/history/${resultId}/rename`,
        { name: newName },
      );
      return response.data.success || false;
    } catch (error) {
      const axiosErr = axios.isAxiosError(error) ? error : null;
      const errorMsg =
        axiosErr?.response?.data?.error ||
        axiosErr?.response?.data?.message ||
        axiosErr?.message ||
        (error instanceof Error ? error.message : "Unknown error");
      throw new Error(`Failed to rename analysis: ${errorMsg}`);
    }
  }

  async submitICAAnalysis(
    request: ICAAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<ICAResult> {
    const response = await this.client.post<ICAResult>("/api/ica", request, {
      signal,
    });
    return response.data;
  }

  async getICAResults(): Promise<ICAResult[]> {
    const response = await this.client.get<ICAResult[]>("/api/ica/results");
    return response.data;
  }

  async getICAResult(analysisId: string): Promise<ICAResult> {
    const response = await this.client.get<ICAResult>(
      `/api/ica/results/${analysisId}`,
    );
    return response.data;
  }

  async deleteICAResult(analysisId: string): Promise<void> {
    await this.client.delete(`/api/ica/results/${analysisId}`);
  }

  async reconstructWithoutComponents(
    request: ReconstructRequest,
  ): Promise<ReconstructResponse> {
    const response = await this.client.post<ReconstructResponse>(
      "/api/ica/reconstruct",
      request,
    );
    return response.data;
  }
}
