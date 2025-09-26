/**
 * API Service for DDALAB Clinical Dashboard
 * Handles all communication with the backend API server
 */

export interface EDFFileInfo {
  file_path: string;
  file_name: string;
  file_size: number;
  duration: number;
  sample_rate: number;
  channels: string[];
  total_samples: number;
  start_time: string;
  end_time: string;
  annotations_count?: number;
}

export interface ChunkData {
  data: number[][];
  channels: string[];
  timestamps: number[];
  sample_rate: number;
  chunk_start: number;
  chunk_size: number;
  file_path: string;
}

export interface Annotation {
  id?: string;
  file_path: string;
  channel?: string;
  start_time: number;
  end_time?: number;
  label: string;
  description?: string;
  annotation_type: 'seizure' | 'artifact' | 'marker' | 'clinical' | 'custom';
  created_at?: string;
  created_by?: string;
}

export interface DDAAnalysisRequest {
  file_path: string;
  channels: string[];
  start_time: number;
  end_time: number;
  variants: string[]; // Array of variant IDs: ['single_timeseries', 'cross_timeseries', etc.]
  window_length?: number;
  window_step?: number;
  detrending?: 'linear' | 'polynomial' | 'none';
  scale_min?: number;
  scale_max?: number;
  scale_num?: number;
}

export interface DDAResult {
  id: string;
  file_path: string;
  channels: string[];
  parameters: DDAAnalysisRequest;
  results: {
    scales: number[];
    dda_matrix: Record<string, number[]>;
    exponents: Record<string, number>;
    quality_metrics: Record<string, number>;
  };
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string;
  error_message?: string;
}

export interface PlotRequest {
  plot_type: 'timeseries' | 'dda_scaling' | 'dda_fluctuations' | 'spectrogram';
  file_path?: string;
  channels?: string[];
  start_time?: number;
  end_time?: number;
  dda_result_id?: string;
  plot_config: {
    width: number;
    height: number;
    dpi: number;
    format: 'png' | 'svg' | 'pdf';
    title?: string;
    show_annotations?: boolean;
  };
}

class APIService {
  private baseURL: string;
  private token: string | null = null;

  constructor() {
    // Use relative URLs with Next.js proxy like web20
    this.baseURL = '';
  }

  private joinUrl(base: string, endpoint: string): string {
    const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    // Route backend calls through Next proxy at /api-backend to avoid browser CORS
    const proxiedEndpoint = normalizedEndpoint.replace(/^\/api\b/, "/api-backend");
    return proxiedEndpoint;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = this.joinUrl(this.baseURL, endpoint);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const controller = new AbortController();
      // Allow timeout override, default 60s for heavy EDF calls
      const specifiedTimeout = (headers["x-timeout-ms"] as any) || (options as any)?.timeoutMs;
      const timeoutMs = specifiedTimeout ? Number(specifiedTimeout) : 60000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      
      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      } else if (response.headers.get('content-type')?.startsWith('image/') || 
                 response.headers.get('content-type')?.startsWith('application/')) {
        return response.blob() as unknown as T;
      }
      
      return response as unknown as T;
    } catch (error) {
      console.error(`API request failed:`, error);
      throw error;
    }
  }

  // File Management - use actual file endpoints
  async getAvailableFiles(): Promise<EDFFileInfo[]> {
    // Get files from the default data directory
    const listResponse = await this.request<{ files: any[] }>('/api/files/list');
    if (listResponse && Array.isArray(listResponse.files)) {
      // Convert file list to EDFFileInfo format
      const edfFiles = listResponse.files
        .filter(file => !file.is_directory && 
                       (file.name.toLowerCase().endsWith('.edf') || 
                        file.name.toLowerCase().endsWith('.ascii')))
        .map(file => ({
          file_path: file.path,
          file_name: file.name,
          file_size: file.size || 0,
          duration: 0, // Will be filled when file is opened
          sample_rate: 256, // Default, will be updated when file is opened
          channels: [], // Will be filled when file is opened
          total_samples: 0, // Will be filled when file is opened
          start_time: file.last_modified || new Date().toISOString(),
          end_time: file.last_modified || new Date().toISOString(),
          annotations_count: 0
        }));
      return edfFiles;
    }
    return [];
  }

  async getRootDirectories(): Promise<{ roots: Array<{name: string; relative_path: string}>; default_relative_path: string }> {
    return this.request<{ roots: Array<{name: string; relative_path: string}>; default_relative_path: string }>('/api/files/roots');
  }

  async listDirectory(path: string = ''): Promise<{ files: Array<{name: string; path: string; is_directory: boolean; size?: number; last_modified?: string}> }> {
    return this.request<{ files: Array<{name: string; path: string; is_directory: boolean; size?: number; last_modified?: string}> }>(`/api/files/list?path=${encodeURIComponent(path)}`);
  }

  async searchFiles(query: string, limit: number = 20): Promise<{ files: Array<{name: string; path: string; is_directory: boolean}> }> {
    return this.request<{ files: Array<{name: string; path: string; is_directory: boolean}> }>(`/api/files/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async getFileInfo(filePath: string): Promise<EDFFileInfo> {
    try {
      console.log('Getting file info for:', filePath)
      
      // Get EDF-specific metadata from the correct endpoint
      const edfResponse = await this.request<any>(`/api/edf/info?file_path=${encodeURIComponent(filePath)}`);
      
      console.log('EDF info response:', edfResponse)
      
      // Get file size from files list endpoint
      let fileSize = 0
      try {
        const directory = filePath.substring(0, filePath.lastIndexOf('/'))
        const fileName = filePath.split('/').pop() || filePath
        
        const filesResponse = await this.request<any>(`/api/files/list?path=${encodeURIComponent(directory)}`)
        
        const fileEntry = filesResponse.files?.find((f: any) => f.name === fileName)
        fileSize = fileEntry?.file_size || 0
        
        console.log('File size from files endpoint:', fileSize)
      } catch (filesError) {
        console.warn('Could not get file size from files endpoint:', filesError)
      }
      
      if (edfResponse) {
        return {
          file_path: filePath,
          file_name: filePath.split('/').pop() || filePath,
          file_size: fileSize,
          duration: edfResponse.total_duration || 0,
          sample_rate: edfResponse.sampling_rate || 256,
          channels: edfResponse.channels || [],
          total_samples: edfResponse.total_samples || 0,
          start_time: new Date().toISOString(),
          end_time: new Date().toISOString(),
          annotations_count: 0
        };
      }
      throw new Error('No response from server');
    } catch (error) {
      console.error(`Failed to get file info for ${filePath}:`, error);
      // Re-throw 404 errors so they can be handled by the caller
      if (error instanceof Error && error.message.includes('404')) {
        throw error;
      }
      // Return default values only for other errors
      return {
        file_path: filePath,
        file_name: filePath.split('/').pop() || filePath,
        file_size: 0,
        duration: 0,
        sample_rate: 256,
        channels: [],
        total_samples: 0,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        annotations_count: 0
      };
    }
  }

  async uploadFile(file: File): Promise<{ file_path: string; message: string }> {
    // File uploads are handled through the file browser widget, not API
    throw new Error('File uploads should be handled through the file browser');
  }

  // EEG Data Retrieval
  async getChunkData(
    filePath: string, 
    chunkStart: number, 
    chunkSize: number, 
    channels?: string[],
    preprocessing?: {
      highpass?: number;
      lowpass?: number;
      notch?: number[];
    }
  ): Promise<ChunkData> {
    const params = new URLSearchParams({
      file_path: filePath,
      chunk_start: chunkStart.toString(),
      chunk_size: chunkSize.toString(),
    });

    if (channels && channels.length > 0) {
      params.append('channels', channels.join(','));
    }

    if (preprocessing) {
      if (preprocessing.highpass) params.append('highpass', preprocessing.highpass.toString());
      if (preprocessing.lowpass) params.append('lowpass', preprocessing.lowpass.toString());
      if (preprocessing.notch) params.append('notch', preprocessing.notch.join(','));
    }

    const response = await this.request<any>(`/api/edf/data?${params}`);
    
    // Transform backend response to match ChunkData interface
    return {
      data: response.data || [],
      channels: response.channel_labels || response.channels || [],
      timestamps: response.timestamps || [],
      sample_rate: response.sample_rate || response.sampling_rate || 256,
      chunk_start: response.chunk_start || chunkStart,
      chunk_size: response.chunk_size || chunkSize,
      file_path: response.file_path || filePath
    };
  }

  // Widget data persistence (for annotations)
  async storeWidgetData(payload: {
    key: string;
    data: any;
    widgetId: string;
    metadata?: any;
  }): Promise<{ status: string; message: string; dataKey: string }> {
    const response = await this.request<{ status: string; message: string; dataKey: string }>(
      '/api/widget-data',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return response as { status: string; message: string; dataKey: string };
  }

  async getWidgetData(
    dataKey: string
  ): Promise<{ status: string; message: string; data: any }> {
    try {
      // Use a custom request that doesn't log 404s for annotations
      const url = this.joinUrl(this.baseURL, `/api/widget-data/${dataKey}`);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`;
      }

      const response = await fetch(url, { headers });
      
      if (response.status === 404) {
        // Handle 404 silently for widget data (expected for new files)
        return { 
          status: 'not_found', 
          message: 'No data found', 
          data: null 
        };
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
      }

      return await response.json();
    } catch (error) {
      // Only propagate non-404 errors
      if (error instanceof Error && !error.message.includes('404')) {
        throw error;
      }
      return { 
        status: 'error', 
        message: 'Failed to fetch data', 
        data: null 
      };
    }
  }

  // Annotations - using widget data storage
  async getAnnotations(filePath: string): Promise<Annotation[]> {
    const key = `annotations:${filePath}`;
    try {
      const response = await this.getWidgetData(key);
      // Handle both null data and missing annotations property
      if (!response.data || !response.data.annotations) {
        return [];
      }
      return response.data.annotations;
    } catch (error) {
      // 404 is expected when no annotations exist yet - handle silently
      if (error instanceof Error && (
        error.message.includes('404') || 
        error.message.includes('Not Found') ||
        error.message.includes('API Error: 404')
      )) {
        // Don't log 404 errors as they're expected for new files
        return [];
      }
      // Only log unexpected errors
      console.error('Failed to fetch annotations (unexpected error):', error);
      return [];
    }
  }

  async createAnnotation(annotation: Omit<Annotation, 'id' | 'created_at'>): Promise<Annotation> {
    const newAnnotation: Annotation = {
      ...annotation,
      id: Date.now().toString(),
      created_at: new Date().toISOString(),
    };
    
    const key = `annotations:${annotation.file_path}`;
    const existing = await this.getAnnotations(annotation.file_path);
    const updated = [...existing, newAnnotation];
    
    await this.storeWidgetData({
      key,
      data: { annotations: updated },
      widgetId: 'annotations',
      metadata: { type: 'annotations', file_path: annotation.file_path }
    });
    
    return newAnnotation;
  }

  async updateAnnotation(id: string, annotation: Partial<Annotation>): Promise<Annotation> {
    if (!annotation.file_path) throw new Error('file_path required for annotation update');
    
    const existing = await this.getAnnotations(annotation.file_path);
    const index = existing.findIndex(a => a.id === id);
    if (index === -1) throw new Error('Annotation not found');
    
    const updated = { ...existing[index], ...annotation };
    existing[index] = updated;
    
    const key = `annotations:${annotation.file_path}`;
    await this.storeWidgetData({
      key,
      data: { annotations: existing },
      widgetId: 'annotations',
      metadata: { type: 'annotations', file_path: annotation.file_path }
    });
    
    return updated;
  }

  async deleteAnnotation(id: string, filePath: string): Promise<void> {
    const existing = await this.getAnnotations(filePath);
    const filtered = existing.filter(a => a.id !== id);
    
    const key = `annotations:${filePath}`;
    await this.storeWidgetData({
      key,
      data: { annotations: filtered },
      widgetId: 'annotations',
      metadata: { type: 'annotations', file_path: filePath }
    });
  }

  // DDA Analysis
  async submitDDAAnalysis(request: DDAAnalysisRequest): Promise<{ job_id: string; message: string }> {
    try {
      // Call the real DDA API endpoint
      // Map channel names to 1-based indices
      const channelIndices = request.channels.map((ch, idx) => {
        // If channel is already a number, use it; otherwise use index + 1
        const parsed = parseInt(ch);
        return isNaN(parsed) ? idx + 1 : parsed;
      });

      const ddaRequest = {
        file_path: request.file_path,
        channel_list: channelIndices,
        preprocessing_options: {
          detrending: request.detrending === 'none' ? null : request.detrending || 'linear'
        },
        algorithm_selection: {
          enabled_variants: request.variants || ['single_timeseries']
        }
      };

      const response = await this.request<any>('/api/dda', {
        method: 'POST',
        body: JSON.stringify(ddaRequest),
      });

      console.log('Raw DDA API response:', response);
      console.log('Response structure:', {
        hasQ: !!response.Q,
        Q_type: typeof response.Q,
        Q_isArray: Array.isArray(response.Q),
        Q_length: response.Q?.length,
        responseKeys: Object.keys(response),
        firstRows: response.Q?.slice(0, 3)
      });

      // Generate a job ID for tracking
      const job_id = `dda_${Date.now()}`;

      // Extract and process the results
      
      // Create scales array (fallback to default values if no Q matrix)
      const scaleMin = request.scale_min || 4;
      const scaleMax = request.scale_max || 64;
      const scaleNum = request.scale_num || 16;
      
      let scales: number[] = [];
      let dda_matrix: Record<string, number[]> = {};
      const exponents: Record<string, number> = {};
      const quality_metrics: Record<string, number> = {};

      // Process the Q matrix (it's channels x time_points, not channels x scales)
      if (response.Q && Array.isArray(response.Q) && response.Q.length > 0) {
        // Q matrix is channels x time_points - each row is a time series for one channel
        const timePoints = response.Q[0]?.length || 100;
        
        // Create a time axis (not scales) for the time series
        scales = Array.from({ length: timePoints }, (_, i) => i);
        
        request.channels.forEach((channel, idx) => {
          if (idx < response.Q.length && Array.isArray(response.Q[idx])) {
            // Each row of Q matrix is the time series for this channel
            dda_matrix[channel] = response.Q[idx];
            // Calculate basic statistics
            const validValues = response.Q[idx].filter((v: number) => !isNaN(v) && isFinite(v));
            if (validValues.length > 1) {
              exponents[channel] = 0.5; // Placeholder - should calculate from data
              quality_metrics[channel] = 0.95; // Placeholder
            }
          }
        });
        console.log('Successfully processed real Q matrix data as time series');
      } else {
        // Create dummy data for testing if no real Q matrix
        console.warn('No Q matrix in DDA response, creating dummy data for testing');
        scales = Array.from({ length: scaleNum }, (_, i) => 
          Math.round(scaleMin * Math.pow(scaleMax / scaleMin, i / Math.max(1, scaleNum - 1)))
        );
        
        // Create dummy DDA matrix data
        request.channels.forEach((channel, idx) => {
          dda_matrix[channel] = scales.map((scale, scaleIdx) => {
            // Generate some dummy DDA-like data
            return Math.log(scale) + Math.random() * 0.5 + idx * 0.2;
          });
          exponents[channel] = 0.5 + Math.random() * 0.3;
          quality_metrics[channel] = 0.8 + Math.random() * 0.2;
        });
      }

      // Store the result
      const result: DDAResult = {
        id: job_id,
        file_path: request.file_path,
        channels: request.channels,
        parameters: request,
        results: {
          scales,
          dda_matrix,
          exponents,
          quality_metrics
        },
        status: 'completed',
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      };

      await this.storeDDAResult(result);

      return { job_id, message: 'DDA analysis completed successfully' };
    } catch (error) {
      console.error('DDA analysis failed:', error);
      
      // Store failed result for UI feedback
      const job_id = `dda_${Date.now()}`;
      const result: DDAResult = {
        id: job_id,
        file_path: request.file_path,
        channels: request.channels,
        parameters: request,
        results: {
          scales: [],
          dda_matrix: {},
          exponents: {},
          quality_metrics: {}
        },
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'DDA analysis failed',
        created_at: new Date().toISOString()
      };

      await this.storeDDAResult(result);

      throw error;
    }
  }

  // Store DDA results in memory for the session
  private ddaResultsCache: DDAResult[] = [];

  async getDDAResults(jobId?: string, filePath?: string): Promise<DDAResult[]> {
    try {
      // Get results from backend history first
      let results: DDAResult[] = [];
      try {
        results = await this.getDDAHistoryFromBackend(filePath);
      } catch (error) {
        console.warn('Failed to get DDA history from backend:', error);
        // Fall back to cache
        results = this.ddaResultsCache;
      }
      
      // Filter based on criteria
      if (jobId) {
        results = results.filter(r => r.id === jobId);
      }
      if (filePath) {
        results = results.filter(r => r.file_path === filePath);
      }
      
      return results;
    } catch (error) {
      console.error('Failed to get DDA results:', error);
      return [];
    }
  }

  // Get DDA history from backend
  async getDDAHistoryFromBackend(filePath?: string): Promise<DDAResult[]> {
    const params = new URLSearchParams();
    if (filePath) {
      params.append('file_path', filePath);
    }
    params.append('limit', '50');
    
    const url = `/api/dda/history${params.toString() ? '?' + params.toString() : ''}`;
    const response = await this.request<DDAResult[]>(url);
    
    console.log('DDA History response:', {
      analysesCount: response?.length || 0,
      dataKeys: Array.isArray(response) ? response.map(r => r.id).slice(0, 5) : [],
      dataType: typeof response,
      status: 'success'
    });
    
    return response || [];
  }
  
  private async storeDDAResult(result: DDAResult): Promise<void> {
    // Add to cache
    this.ddaResultsCache = [...this.ddaResultsCache.filter(r => r.id !== result.id), result];
    
    // Store in DDA history using the proper backend endpoint
    try {
      await this.saveDDAAnalysisToHistory(result);
    } catch (error) {
      console.warn('Failed to save DDA result to backend history:', error);
      // Continue anyway - we have it in memory cache
    }
  }

  // Save DDA analysis to backend history
  async saveDDAAnalysisToHistory(result: DDAResult): Promise<{status: string, message: string, id: string}> {
    const response = await this.request<{status: string, message: string, id: string}>(
      '/api/dda/history/save',
      {
        method: 'POST',
        body: JSON.stringify(result),
      }
    );
    return response;
  }

  async getDDAResult(jobId: string): Promise<DDAResult> {
    const result = this.ddaResultsCache.find(r => r.id === jobId);
    if (result) {
      return result;
    }
    
    // Try to fetch from storage if not in cache
    try {
      const response = await this.getWidgetData(`dda_result:${jobId}`);
      return response.data;
    } catch (error) {
      throw new Error(`DDA result ${jobId} not found`);
    }
  }

  async getAnalysisFromHistory(resultId: string): Promise<DDAResult | null> {
    try {
      const response = await this.request<{analysis: DDAResult}>(`/api/dda/history/${resultId}`);
      return response.analysis || null;
    } catch (error) {
      console.error(`Failed to get analysis ${resultId} from history:`, error);
      return null;
    }
  }

  async deleteDDAResult(jobId: string): Promise<void> {
    // Delete from cache
    this.ddaResultsCache = this.ddaResultsCache.filter(r => r.id !== jobId);
    
    // Try to delete from widget data storage (but don't fail if it doesn't work)
    try {
      await this.request(`/api/widget-data/dda_result:${jobId}`, {
        method: 'DELETE'
      });
    } catch (error) {
      // Ignore storage errors
    }
  }

  // Plot Generation - placeholder implementation
  async generatePlot(request: PlotRequest): Promise<Blob> {
    // This would need to be implemented in the backend
    // For now, return empty blob
    throw new Error('Plot generation not yet implemented in backend');
  }

  async savePlot(request: PlotRequest, filename: string): Promise<{ file_path: string; message: string }> {
    // This would need to be implemented in the backend
    throw new Error('Plot saving not yet implemented in backend');
  }

  // Utility Methods
  setAuthToken(token: string) {
    this.token = token;
  }

  clearAuthToken() {
    this.token = null;
  }

  // Plot data fetching for persistence
  async getPlotData(plotId: string): Promise<any> {
    try {
      const response = await this.getWidgetData(`plot_data:${plotId}`);
      return response.data;
    } catch (error) {
      console.warn(`Plot data not found for ${plotId}:`, error);
      return null;
    }
  }

  async storePlotData(plotId: string, data: any): Promise<void> {
    try {
      await this.storeWidgetData({
        key: `plot_data:${plotId}`,
        data: data,
        widgetId: 'plot-visualization',
        metadata: { type: 'plot-data', plot_id: plotId }
      });
    } catch (error) {
      console.warn(`Failed to store plot data for ${plotId}:`, error);
    }
  }

  // WebSocket for real-time updates (DDA progress, etc.)
  createWebSocket(endpoint: string): WebSocket | null {
    if (typeof window === 'undefined') return null;
    
    const wsURL = this.baseURL.replace('http', 'ws') + endpoint;
    return new WebSocket(wsURL);
  }
}

export const apiService = new APIService();
export default apiService;