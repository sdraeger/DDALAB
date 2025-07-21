import logger from "./logger";

export interface PlotParams {
  chunk_start: number;
  chunk_size: number;
  preprocessing_options?: Record<string, any>;
  selected_channels?: string[];
  time_window?: [number, number];
  zoom_level?: number;
}

export interface CachePlotRequest {
  file_path: string;
  plot_params: PlotParams;
  plot_data: Record<string, any>;
  ttl?: number;
}

export interface CachePlotResponse {
  success: boolean;
  message: string;
  cache_key?: string;
}

export interface GetCachedPlotRequest {
  file_path: string;
  plot_params: PlotParams;
}

export interface GetCachedPlotResponse {
  success: boolean;
  message: string;
  plot_data?: Record<string, any>;
  cached_at?: string;
}

export interface CachedPlotMetadata {
  cache_key: string;
  file_path: string;
  plot_params: PlotParams;
  cached_at: string;
  ttl: number;
}

export interface UserCachedPlotsResponse {
  success: boolean;
  message: string;
  plots: CachedPlotMetadata[];
  total_count: number;
}

export interface DeleteCachedPlotRequest {
  file_path: string;
  plot_params: PlotParams;
}

export interface DeleteCachedPlotResponse {
  success: boolean;
  message: string;
  deleted: boolean;
}

export interface DeleteFilePlotsRequest {
  file_path: string;
}

export interface DeleteFilePlotsResponse {
  success: boolean;
  message: string;
  deleted_count: number;
}

export interface DeleteUserPlotsResponse {
  success: boolean;
  message: string;
  deleted_count: number;
}

export interface CleanupResponse {
  success: boolean;
  message: string;
  cleaned_count: number;
}

class PlotCacheService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = "/api/plot-cache";
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      logger.error(`PlotCacheService error for ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Cache a plot for the current user
   */
  async cachePlot(request: CachePlotRequest): Promise<CachePlotResponse> {
    logger.info(
      `[PlotCacheService] Caching plot for file: ${request.file_path}`
    );
    logger.debug(`[PlotCacheService] Cache request details:`, {
      file_path: request.file_path,
      plot_params: request.plot_params,
      ttl: request.ttl,
      plot_data_keys: Object.keys(request.plot_data || {}),
    });

    try {
      const response = await this.makeRequest<CachePlotResponse>("/cache", {
        method: "POST",
        body: JSON.stringify(request),
      });

      logger.info(
        `[PlotCacheService] Cache response: ${
          response.success ? "SUCCESS" : "FAILED"
        } - ${response.message}`
      );
      return response;
    } catch (error) {
      logger.error(`[PlotCacheService] Cache request failed:`, error);
      throw error;
    }
  }

  /**
   * Retrieve a cached plot for the current user
   */
  async getCachedPlot(
    request: GetCachedPlotRequest
  ): Promise<GetCachedPlotResponse> {
    logger.info(
      `[PlotCacheService] Getting cached plot for file: ${request.file_path}`
    );
    logger.debug(`[PlotCacheService] Get request details:`, {
      file_path: request.file_path,
      plot_params: request.plot_params,
    });

    try {
      const response = await this.makeRequest<GetCachedPlotResponse>("/get", {
        method: "POST",
        body: JSON.stringify(request),
      });

      logger.info(
        `[PlotCacheService] Get response: ${
          response.success ? "FOUND" : "NOT_FOUND"
        } - ${response.message}`
      );
      if (response.success && response.plot_data) {
        logger.debug(
          `[PlotCacheService] Retrieved plot data keys:`,
          Object.keys(response.plot_data)
        );
      }
      return response;
    } catch (error) {
      logger.error(`[PlotCacheService] Get request failed:`, error);
      throw error;
    }
  }

  /**
   * Get all cached plots for the current user
   */
  async getUserCachedPlots(): Promise<UserCachedPlotsResponse> {
    logger.info(`[PlotCacheService] Getting all cached plots for user`);

    try {
      const response = await this.makeRequest<UserCachedPlotsResponse>(
        "/user",
        {
          method: "GET",
        }
      );

      logger.info(
        `[PlotCacheService] User plots response: ${
          response.success ? "SUCCESS" : "FAILED"
        } - ${response.total_count} plots`
      );
      if (response.success && response.plots) {
        response.plots.forEach((plot) => {
          logger.debug(
            `[PlotCacheService] User plot: ${plot.file_path} - ${plot.cached_at}`
          );
        });
      }
      return response;
    } catch (error) {
      logger.error(`[PlotCacheService] Get user plots request failed:`, error);
      throw error;
    }
  }

  /**
   * Delete a specific cached plot for the current user
   */
  async deleteCachedPlot(
    request: DeleteCachedPlotRequest
  ): Promise<DeleteCachedPlotResponse> {
    return this.makeRequest<DeleteCachedPlotResponse>("/delete", {
      method: "DELETE",
      body: JSON.stringify(request),
    });
  }

  /**
   * Delete all cached plots for a specific file for the current user
   */
  async deleteFilePlots(
    request: DeleteFilePlotsRequest
  ): Promise<DeleteFilePlotsResponse> {
    return this.makeRequest<DeleteFilePlotsResponse>("/delete-file", {
      method: "DELETE",
      body: JSON.stringify(request),
    });
  }

  /**
   * Delete all cached plots for the current user
   */
  async deleteUserPlots(): Promise<DeleteUserPlotsResponse> {
    return this.makeRequest<DeleteUserPlotsResponse>("/delete-user", {
      method: "DELETE",
    });
  }

  /**
   * Clean up expired plots for all users (admin operation)
   */
  async cleanupExpiredPlots(): Promise<CleanupResponse> {
    return this.makeRequest<CleanupResponse>("/cleanup", {
      method: "POST",
    });
  }

  /**
   * Check if a cached plot exists for the given parameters
   */
  async hasCachedPlot(
    filePath: string,
    plotParams: PlotParams
  ): Promise<boolean> {
    try {
      const response = await this.getCachedPlot({
        file_path: filePath,
        plot_params: plotParams,
      });
      return response.success && response.plot_data !== undefined;
    } catch (error) {
      logger.error("Error checking for cached plot:", error);
      return false;
    }
  }

  /**
   * Load cached plots for a user and return them in a format compatible with the Redux store
   */
  async loadUserCachedPlots(): Promise<Record<string, any>> {
    logger.info(`[PlotCacheService] Starting loadUserCachedPlots`);

    try {
      const response = await this.getUserCachedPlots();
      if (!response.success) {
        logger.warn(
          `[PlotCacheService] Failed to load user cached plots: ${response.message}`
        );
        return {};
      }

      logger.info(
        `[PlotCacheService] Found ${response.plots.length} cached plots to restore`
      );

      // Convert cached plots to Redux store format
      const plots: Record<string, any> = {};

      for (const plotMetadata of response.plots) {
        logger.debug(
          `[PlotCacheService] Processing plot: ${plotMetadata.file_path}`
        );

        const plotResponse = await this.getCachedPlot({
          file_path: plotMetadata.file_path,
          plot_params: plotMetadata.plot_params,
        });

        if (plotResponse.success && plotResponse.plot_data) {
          // Create a unique key for the plot in Redux store
          const plotKey = `${plotMetadata.file_path}_${plotMetadata.plot_params.chunk_start}_${plotMetadata.plot_params.chunk_size}`;
          logger.debug(`[PlotCacheService] Creating plot key: ${plotKey}`);

          plots[plotKey] = {
            ...plotResponse.plot_data,
            filePath: plotMetadata.file_path,
            chunkStart: plotMetadata.plot_params.chunk_start,
            chunkSizeSeconds: plotMetadata.plot_params.chunk_size,
            preprocessingOptions:
              plotMetadata.plot_params.preprocessing_options,
            selectedChannels: plotMetadata.plot_params.selected_channels,
            timeWindow: plotMetadata.plot_params.time_window,
            zoomLevel: plotMetadata.plot_params.zoom_level,
            cachedAt: plotMetadata.cached_at,
          };

          logger.debug(
            `[PlotCacheService] Restored plot: ${plotKey} with keys:`,
            Object.keys(plots[plotKey])
          );
        } else {
          logger.warn(
            `[PlotCacheService] Failed to retrieve plot data for: ${plotMetadata.file_path}`
          );
        }
      }

      logger.info(
        `[PlotCacheService] Successfully loaded ${
          Object.keys(plots).length
        } cached plots from Redis`
      );
      return plots;
    } catch (error) {
      logger.error(
        `[PlotCacheService] Error loading user cached plots:`,
        error
      );
      return {};
    }
  }
}

// Export singleton instance
export const plotCacheService = new PlotCacheService();
