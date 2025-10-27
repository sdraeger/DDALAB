import axios, { AxiosInstance } from 'axios'
import { EDFFileInfo, ChunkData, Annotation, DDAAnalysisRequest, DDAResult, HealthResponse } from '@/types/api'
import { getChunkCache } from './chunkCache'

export class ApiService {
  private client: AxiosInstance
  public baseURL: string
  private chunkCache = getChunkCache()
  private sessionToken: string | null = null

  constructor(baseURL: string, sessionToken?: string) {
    this.baseURL = baseURL
    this.sessionToken = sessionToken || null

    console.log('[API SERVICE] Constructor called with baseURL:', baseURL, 'hasToken:', !!sessionToken)
    console.log('[API SERVICE] Stack trace:', new Error().stack)

    this.client = axios.create({
      baseURL,
      timeout: 3600000, // 1 hour for heavy DDA operations
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Add request interceptor to include session token
    this.client.interceptors.request.use((config) => {
      const fullUrl = `${this.baseURL}${config.url}`
      console.log(`[API] Making request to FULL URL: ${fullUrl}`)

      if (this.sessionToken) {
        config.headers.Authorization = `Bearer ${this.sessionToken}`
        console.log(`[API] Request to ${config.url} with token: ${this.sessionToken.substring(0, 8)}...`)
      } else {
        console.warn(`[API] Request to ${config.url} WITHOUT TOKEN - will likely fail with 401/403`)
      }
      return config
    })
  }

  // Set or update the session token
  setSessionToken(token: string) {
    this.sessionToken = token
    console.log('[API] Session token updated:', token.substring(0, 16) + '...')
  }

  // Get the current session token
  getSessionToken(): string | null {
    return this.sessionToken
  }

  // Health check
  async checkHealth(): Promise<HealthResponse> {
    const response = await this.client.get<HealthResponse>('/api/health')
    return response.data
  }

  // File management
  async getAvailableFiles(): Promise<EDFFileInfo[]> {
    try {
      // Get files from root directory (which is mapped to data/edf by the API server)
      const rootResponse = await this.client.get<{ files: any[] }>('/api/files/list')

      if (rootResponse.data && Array.isArray(rootResponse.data.files)) {
        // Filter for EDF files only (API server already handles the directory mapping)
        const edfFiles = rootResponse.data.files
          .filter(file => !file.is_directory &&
                         (file.name.toLowerCase().endsWith('.edf') ||
                          file.name.toLowerCase().endsWith('.ascii')))
          .map(file => ({
            file_path: file.path,
            file_name: file.name,
            file_size: file.size || 0,
            duration: 0,
            sample_rate: 256,
            channels: [],
            total_samples: 0,
            start_time: file.last_modified || new Date().toISOString(),
            end_time: file.last_modified || new Date().toISOString(),
            annotations_count: 0
          }))

        return edfFiles
      }

      return []
    } catch (error) {
      console.error('Failed to get available files:', error)
      return []
    }
  }

  async getFileInfo(filePath: string): Promise<EDFFileInfo> {
    try {
      // Clear cache for this file when loading new file info
      this.chunkCache.clearFile(filePath)

      // Get EDF-specific metadata from the correct endpoint
      const edfResponse = await this.client.get(`/api/edf/info`, {
        params: {
          file_path: filePath
        }
      })

      console.log('Raw EDF response:', edfResponse.data)

      // Get file size from files list endpoint
      let fileSize = 0
      try {
        const directory = filePath.substring(0, filePath.lastIndexOf('/'))
        const fileName = filePath.split('/').pop() || filePath

        const filesResponse = await this.client.get(`/api/files/list`, {
          params: {
            path: directory
          }
        })

        const fileEntry = filesResponse.data.files?.find((f: any) => f.name === fileName)
        fileSize = fileEntry?.file_size || fileEntry?.size || 0
      } catch (filesError) {
        console.warn('Could not get file size from files endpoint:', filesError)
      }

      const fileInfo: EDFFileInfo = {
        file_path: filePath,
        file_name: filePath.split('/').pop() || filePath,
        file_size: fileSize,
        duration: edfResponse.data.duration || edfResponse.data.total_duration || 0,
        sample_rate: edfResponse.data.sample_rate || edfResponse.data.sampling_rate || 256,
        channels: edfResponse.data.channels || [],
        total_samples: edfResponse.data.total_samples || 0,
        start_time: edfResponse.data.start_time || new Date().toISOString(),
        end_time: edfResponse.data.end_time || new Date().toISOString(),
        annotations_count: 0
      }

      console.log('Processed file info:', fileInfo)
      return fileInfo
    } catch (error) {
      console.error('Failed to get file info:', error)
      throw error
    }
  }

  async listDirectory(path: string = ''): Promise<{ files: Array<{name: string; path: string; is_directory: boolean; size?: number; last_modified?: string}> }> {
    const response = await this.client.get('/api/files/list', {
      params: { path }
    })
    return response.data
  }

  // Get overview of entire file (downsampled for navigation)
  async getOverviewData(
    filePath: string,
    requestedChannels?: string[],
    maxPoints: number = 2000,
    signal?: AbortSignal
  ): Promise<ChunkData> {
    try {
      const params: any = {
        file_path: filePath,
        max_points: maxPoints,
      }

      if (requestedChannels && requestedChannels.length > 0) {
        params.channels = requestedChannels.join(',')
      }

      console.log('[ApiService] Fetching overview data:', params)
      const response = await this.client.get('/api/edf/overview', {
        params,
        signal
      })

      console.log('[ApiService] Received overview data:', {
        dataLength: response.data.data?.length,
        pointsPerChannel: response.data.data?.[0]?.length,
        channels: response.data.channel_labels?.length,
      })

      const chunkData: ChunkData = {
        data: response.data.data || [],
        channels: response.data.channel_labels || response.data.channels || [],
        timestamps: response.data.timestamps || [],
        sample_rate: response.data.sampling_frequency || response.data.sample_rate || 256,
        chunk_start: response.data.chunk_start || 0,
        chunk_size: response.data.chunk_size || 0,
        file_path: response.data.file_path || filePath
      }

      return chunkData
    } catch (error) {
      console.error('Failed to get overview data:', error)
      throw error
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
      highpass?: number
      lowpass?: number
      notch?: number[]
    }
  ): Promise<ChunkData> {
    try {
      // Check cache first (only if no preprocessing)
      if (!preprocessing) {
        const cached = this.chunkCache.get(filePath, chunkStart, chunkSize, requestedChannels)
        if (cached) {
          console.log('[ApiService] Cache HIT - using cached chunk data')
          return cached
        }
      }

      console.log('[ApiService] Cache MISS - fetching from backend')

      const params: any = {
        file_path: filePath,
        chunk_start: chunkStart,
        chunk_size: chunkSize,
      }

      if (requestedChannels && requestedChannels.length > 0) {
        params.channels = requestedChannels.join(',')
      }

      if (preprocessing) {
        if (preprocessing.highpass) params.highpass = preprocessing.highpass
        if (preprocessing.lowpass) params.lowpass = preprocessing.lowpass
        if (preprocessing.notch) params.notch = preprocessing.notch.join(',')
      }

      console.log('Making chunk data request with params:', params)
      const response = await this.client.get('/api/edf/data', {
        params,
        signal // Pass abort signal to axios
      })
      console.log('Raw chunk data response:', response.data)

      // Extract data structure first
      const data = response.data.data || []
      const channels = response.data.channel_labels || response.data.channels || []
      const actualChunkSize = response.data.chunk_size || chunkSize
      const sampleRate = response.data.sampling_frequency || response.data.sample_rate || 256

      // Generate timestamps if not provided
      let timestamps = response.data.timestamps || []
      if (timestamps.length === 0 && actualChunkSize > 0) {
        timestamps = Array.from({ length: actualChunkSize }, (_, i) => (chunkStart + i) / sampleRate)
      }

      console.log('Data validation check:', {
        hasData: Array.isArray(data),
        dataLength: data.length,
        hasChannels: Array.isArray(channels),
        channelsLength: channels.length,
        dataIsArrayOfArrays: data.every((item: any) => Array.isArray(item)),
        firstChannelLength: data[0]?.length,
        sampleDataTypes: data.slice(0, 2).map((channel: any) =>
          channel?.slice(0, 3).map((val: any) => typeof val)
        )
      })

      const chunkData: ChunkData = {
        data: data,
        channels: channels,
        timestamps: timestamps,
        sample_rate: sampleRate,
        chunk_start: response.data.chunk_start || chunkStart,
        chunk_size: actualChunkSize,
        file_path: response.data.file_path || filePath
      }

      console.log('Processed chunk data:', chunkData)

      // Store in cache (only if no preprocessing applied)
      if (!preprocessing) {
        this.chunkCache.set(filePath, chunkStart, chunkSize, chunkData, requestedChannels)
      }

      return chunkData
    } catch (error) {
      console.error('Failed to get chunk data:', error)
      throw error
    }
  }

  // Annotations
  async getAnnotations(filePath: string): Promise<Annotation[]> {
    try {
      const response = await this.client.get(`/api/widget-data/annotations:${filePath}`)
      if (!response.data || !response.data.annotations) {
        return []
      }
      return response.data.annotations
    } catch (error: any) {
      if (error.response?.status === 404) {
        return []
      }
      throw error
    }
  }

  async createAnnotation(annotation: Omit<Annotation, 'id' | 'created_at'>): Promise<Annotation> {
    const newAnnotation: Annotation = {
      ...annotation,
      id: Date.now().toString(),
      created_at: new Date().toISOString(),
    }

    const existing = await this.getAnnotations(annotation.file_path)
    const updated = [...existing, newAnnotation]

    await this.client.post('/api/widget-data', {
      key: `annotations:${annotation.file_path}`,
      data: { annotations: updated },
      widgetId: 'annotations',
      metadata: { type: 'annotations', file_path: annotation.file_path }
    })

    return newAnnotation
  }

  async updateAnnotation(id: string, annotation: Partial<Annotation>): Promise<Annotation> {
    if (!annotation.file_path) throw new Error('file_path required for annotation update')

    const existing = await this.getAnnotations(annotation.file_path)
    const index = existing.findIndex(a => a.id === id)
    if (index === -1) throw new Error('Annotation not found')

    const updated = { ...existing[index], ...annotation }
    existing[index] = updated

    await this.client.post('/api/widget-data', {
      key: `annotations:${annotation.file_path}`,
      data: { annotations: existing },
      widgetId: 'annotations',
      metadata: { type: 'annotations', file_path: annotation.file_path }
    })

    return updated
  }

  async deleteAnnotation(id: string, filePath: string): Promise<void> {
    const existing = await this.getAnnotations(filePath)
    const filtered = existing.filter(a => a.id !== id)

    await this.client.post('/api/widget-data', {
      key: `annotations:${filePath}`,
      data: { annotations: filtered },
      widgetId: 'annotations',
      metadata: { type: 'annotations', file_path: filePath }
    })
  }

  // DDA Analysis
  private getVariantName(variantId: string): string {
    const variantNames: Record<string, string> = {
      'single_timeseries': 'Single Timeseries (ST)',
      'cross_timeseries': 'Cross Timeseries (CT)',
      'cross_dynamical': 'Cross Dynamical (CD)',
      'dynamical_ergodicity': 'Dynamical Ergodicity (DE)'
    }
    return variantNames[variantId] || variantId
  }

  async submitDDAAnalysis(request: DDAAnalysisRequest): Promise<DDAResult> {
    try {
      // Map channel names to indices if needed
      const channelIndices = request.channels.map((ch, idx) => {
        const parsed = parseInt(ch)
        return isNaN(parsed) ? idx + 1 : parsed
      })

      // Note: The backend DDARequest schema expects:
      // - algorithm_selection.enabled_variants: List of variant IDs
      // - The backend currently returns only a single Q matrix regardless of variants
      // - We handle this by creating variant-specific results in the frontend
      const ddaRequest = {
        file_path: request.file_path,
        channel_list: channelIndices,
        time_range: {
          start: request.start_time,
          end: request.end_time
        },
        preprocessing_options: {
          detrending: request.detrending === 'none' ? null : request.detrending || 'linear',
          highpass: request.scale_min ? request.scale_min * 0.1 : null,
          lowpass: request.scale_max ? request.scale_max * 2 : null
        },
        algorithm_selection: {
          enabled_variants: request.variants || ['single_timeseries']
        },
        window_parameters: {
          window_length: request.window_length || 64, // Default: 0.25 seconds at 256 Hz
          window_step: request.window_step || 10,
          ct_window_length: request.ct_window_length,
          ct_window_step: request.ct_window_step
        },
        scale_parameters: {
          scale_min: request.scale_min || 1,
          scale_max: request.scale_max || 20,
          scale_num: request.scale_num || 20
        },
        ct_channel_pairs: request.ct_channel_pairs
      }

      console.log('Submitting DDA request:', ddaRequest)
      const response = await this.client.post('/api/dda', ddaRequest)

      console.log('Raw DDA API response:', response.data);
      console.log('Response structure:', {
        hasQ: !!response.data.Q,
        Q_type: typeof response.data.Q,
        Q_isArray: Array.isArray(response.data.Q),
        Q_length: response.data.Q?.length,
        responseKeys: Object.keys(response.data),
        firstRows: response.data.Q?.slice(0, 3),
        // Check for variant-specific results
        hasVariants: !!response.data.variants,
        variantKeys: response.data.variants ? Object.keys(response.data.variants) : null,
        hasST: !!response.data.single_timeseries,
        hasCT: !!response.data.cross_timeseries,
        hasCD: !!response.data.cross_dynamical,
        hasDE: !!response.data.dynamical_ergodicity
      });

      // Process the real API response
      const job_id = `dda_${Date.now()}`;

      // Create scales array (fallback to default values if no Q matrix)
      const scaleMin = request.scale_min || 1;
      const scaleMax = request.scale_max || 20;
      const scaleNum = request.scale_num || 20;

      let scales: number[] = [];
      let dda_matrix: Record<string, number[]> = {};
      const exponents: Record<string, number> = {};
      const quality_metrics: Record<string, number> = {};

      // Check if response contains variant-specific results
      const variants = [];

      // First, let's check what the backend actually returned
      console.log('Checking backend response structure for variants...');
      console.log('Response data keys:', Object.keys(response.data));
      console.log('Response results keys:', response.data.results ? Object.keys(response.data.results) : 'no results key');
      console.log('Request variants:', request.variants);

      // Look for variant-specific results in different possible formats
      let foundVariantData = false;

      // Option 1: Check if variants are nested under response.data.results.variants (Rust backend format)
      if (response.data.results?.variants && Array.isArray(response.data.results.variants)) {
        console.log('Found variants array in response.results.variants:', response.data.results.variants.length);
        foundVariantData = true;

        for (const variantData of response.data.results.variants) {
          console.log(`Processing variant from results.variants array:`, {
            variant_id: variantData.variant_id,
            variant_name: variantData.variant_name,
            has_dda_matrix: !!variantData.dda_matrix,
            dda_matrix_keys: variantData.dda_matrix ? Object.keys(variantData.dda_matrix) : []
          });

          // Extract scales from response.data.results.scales
          if (response.data.results.scales && Array.isArray(response.data.results.scales)) {
            scales = response.data.results.scales;
          }

          variants.push({
            variant_id: variantData.variant_id,
            variant_name: variantData.variant_name,
            dda_matrix: variantData.dda_matrix || {},
            exponents: variantData.exponents || {},
            quality_metrics: variantData.quality_metrics || {}
          });
        }
      }
      // Option 2: Check if variants are nested under a 'variants' key in root (legacy format)
      else if (response.data.variants && typeof response.data.variants === 'object') {
        console.log('Found variants object in response:', Object.keys(response.data.variants));
        for (const variantId of request.variants) {
          if (response.data.variants[variantId]) {
            foundVariantData = true;
            const variantData = response.data.variants[variantId];
            console.log(`Processing variant ${variantId} from variants object`);

            const variantMatrix: Record<string, number[]> = {};
            const variantExponents: Record<string, number> = {};

            // Process variant-specific Q matrix
            if (variantData.Q && Array.isArray(variantData.Q)) {
              const timePoints = variantData.Q[0]?.length || 100;
              scales = Array.from({ length: timePoints }, (_, i) => i);

              request.channels.forEach((channel, idx) => {
                if (idx < variantData.Q.length && Array.isArray(variantData.Q[idx])) {
                  variantMatrix[channel] = variantData.Q[idx];
                  variantExponents[channel] = variantData.exponents?.[channel] || 0.5;
                }
              });
            }

            variants.push({
              variant_id: variantId,
              variant_name: this.getVariantName(variantId),
              dda_matrix: variantMatrix,
              exponents: variantExponents,
              quality_metrics: variantData.quality_metrics || {}
            });
          } else {
            console.log(`Variant ${variantId} not found in variants object`);
          }
        }
      }

      // Option 3: Check for individual variant keys in the root response
      else if (!foundVariantData) {
        console.log('Looking for individual variant keys in response root...');
        for (const variantId of request.variants) {
          // Check both the variant ID and common variant key patterns
          const possibleKeys = [
            variantId,
            variantId.toUpperCase(),
            variantId.toLowerCase(),
            // Map to common backend naming patterns
            variantId === 'single_timeseries' ? 'ST' :
            variantId === 'cross_timeseries' ? 'CT' :
            variantId === 'cross_dynamical' ? 'CD' :
            variantId === 'dynamical_ergodicity' ? 'DE' : variantId
          ];

          let variantData = null;
          for (const key of possibleKeys) {
            if (response.data[key]) {
              variantData = response.data[key];
              console.log(`Found variant data for ${variantId} under key '${key}'`);
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
                if (idx < variantData.Q.length && Array.isArray(variantData.Q[idx])) {
                  variantMatrix[channel] = variantData.Q[idx];
                  variantExponents[channel] = variantData.exponents?.[channel] || 0.5;
                }
              });
            } else if (variantData && Array.isArray(variantData)) {
              // Some backends might return Q matrix directly as the variant value
              const timePoints = variantData[0]?.length || 100;
              scales = Array.from({ length: timePoints }, (_, i) => i);

              request.channels.forEach((channel, idx) => {
                if (idx < variantData.length && Array.isArray(variantData[idx])) {
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
              quality_metrics: {}
            });
          } else {
            console.log(`No data found for variant ${variantId}`);
          }
        }
      }

      // Option 3: If still no variant-specific data found, check if there's a single Q matrix to replicate
      if (!foundVariantData) {
        console.warn('No variant-specific data found in backend response');
        console.log('Available response keys:', Object.keys(response.data));

        if (response.data.Q && Array.isArray(response.data.Q) && response.data.Q.length > 0) {
          console.log('Using single Q matrix for all variants (backend does not support multiple variants)');

          // Process the single Q matrix
          const timePoints = response.data.Q[0]?.length || 100;
          scales = Array.from({ length: timePoints }, (_, i) => i);

          request.channels.forEach((channel, idx) => {
            if (idx < response.data.Q.length && Array.isArray(response.data.Q[idx])) {
              dda_matrix[channel] = response.data.Q[idx];
              const validValues = response.data.Q[idx].filter((v: number) => !isNaN(v) && isFinite(v));
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
              exponents: { ...exponents },   // Clone the exponents
              quality_metrics: response.data.quality_metrics || {}
            });
          }

          console.warn(`Created ${variants.length} identical variant results - backend may not support multiple variants`);
        } else {
          console.error('No Q matrix found in backend response');
          // This is an error condition - no data to work with
          throw new Error('Backend returned no DDA results (no Q matrix found)');
        }
      }

      console.log('Final variants array:', variants.map(v => ({ id: v.variant_id, name: v.variant_name })));

      // Create and return the result
      const result: DDAResult = {
        id: job_id,
        file_path: request.file_path,
        channels: request.channels,
        parameters: request,
        results: {
          scales,
          variants: variants.length > 0 ? variants : [{
            variant_id: 'single_timeseries',
            variant_name: this.getVariantName('single_timeseries'),
            dda_matrix,
            exponents,
            quality_metrics
          }],
          // Legacy fields for backward compatibility (use first variant)
          dda_matrix: variants.length > 0 ? variants[0].dda_matrix : dda_matrix,
          exponents: variants.length > 0 ? variants[0].exponents : exponents,
          quality_metrics: variants.length > 0 ? variants[0].quality_metrics : quality_metrics
        },
        status: 'completed',
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      };

      console.log('Result contains', result.results.variants.length, 'variants');
      return result;
    } catch (error: any) {
      console.error('❌ Failed to submit DDA analysis:', error)

      // Log detailed error information
      if (error.response) {
        console.error('📤 Backend response status:', error.response.status)
        console.error('📤 Backend response data:', error.response.data)
        console.error('📤 Backend response headers:', error.response.headers)
      } else if (error.request) {
        console.error('📤 Request was made but no response:', error.request)
      } else {
        console.error('📤 Error setting up request:', error.message)
      }
      console.error('📤 Full error config:', error.config)

      // Create detailed error message
      let errorMessage = 'Failed to submit DDA analysis';
      if (error.response) {
        errorMessage += ` (HTTP ${error.response.status})`;
        if (error.response.data) {
          if (typeof error.response.data === 'string') {
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

      throw new Error(errorMessage)
    }
  }

  async getDDAResults(jobId?: string, filePath?: string): Promise<DDAResult[]> {
    try {
      const params: any = {}
      if (jobId) params.job_id = jobId
      if (filePath) params.file_path = filePath

      const response = await this.client.get('/api/dda/results', { params })
      return response.data.results || []
    } catch (error) {
      console.error('Failed to get DDA results:', error)
      return []
    }
  }

  async getDDAResult(jobId: string): Promise<DDAResult> {
    try {
      const response = await this.client.get(`/api/dda/results/${jobId}`)
      return response.data
    } catch (error) {
      console.error(`Failed to get DDA result ${jobId}:`, error)
      throw new Error(`DDA result ${jobId} not found`)
    }
  }

  async getDDAStatus(jobId: string): Promise<{ status: string; progress?: number; message?: string }> {
    try {
      const response = await this.client.get(`/api/dda/status/${jobId}`)
      return response.data
    } catch (error) {
      console.error(`Failed to get DDA status ${jobId}:`, error)
      return { status: 'unknown', message: 'Failed to get status' }
    }
  }

  // Analysis History Management
  async saveAnalysisToHistory(result: DDAResult): Promise<boolean> {
    try {
      console.log('Sending analysis to save:', {
        result_id: result.id,
        file_path: result.file_path,
        channels_count: result.channels.length
      })

      const response = await this.client.post('/api/dda/history/save', {
        result_id: result.id,
        analysis_data: result
      })

      console.log('Save response:', response.data)

      // Check for both success formats
      return response.data.success === true || response.data.status === 'success'
    } catch (error) {
      console.error('Failed to save analysis to history:', error)
      if (error instanceof Error) {
        console.error('Error details:', error.message)
      }
      return false
    }
  }

  async getAnalysisHistory(): Promise<DDAResult[]> {
    try {
      console.log('Fetching analysis history from backend...')
      const response = await this.client.get('/api/dda/history')
      console.log('Analysis history response:', {
        status: response.status,
        dataType: typeof response.data,
        dataKeys: response.data ? Object.keys(response.data) : 'null',
        analysesCount: response.data.analyses?.length || response.data?.length || 0
      })

      // Handle both array and object responses
      let analyses = []
      if (Array.isArray(response.data)) {
        analyses = response.data
      } else {
        analyses = response.data.analyses || []
      }

      // Flatten analysis data structure if needed
      return analyses.map((item: any) => {
        // If the item has analysis_data nested inside, flatten it
        if (item.analysis_data && typeof item.analysis_data === 'object') {
          return {
            ...item.analysis_data,
            // Use the backend storage ID as the primary ID for lookups
            id: item.id,
            // Preserve the original analysis ID and other metadata
            analysis_id: item.analysis_data.id,
            result_id: item.result_id,
            storage_created_at: item.created_at
          }
        }
        return item
      })
    } catch (error) {
      console.error('Failed to get analysis history:', error)
      if (error instanceof Error) {
        console.error('Error details:', error.message)
      }
      return []
    }
  }

  async getAnalysisFromHistory(resultId: string): Promise<DDAResult | null> {
    try {
      const response = await this.client.get(`/api/dda/history/${resultId}`)
      const analysisWrapper = response.data.analysis

      console.log('[DEBUG] getAnalysisFromHistory raw response keys:', Object.keys(response.data))
      console.log('[DEBUG] analysisWrapper keys:', analysisWrapper ? Object.keys(analysisWrapper) : 'null')

      if (!analysisWrapper) return null

      // Flatten analysis data structure if needed
      if (analysisWrapper.analysis_data && typeof analysisWrapper.analysis_data === 'object') {
        console.log('[DEBUG] analysis_data keys:', Object.keys(analysisWrapper.analysis_data))
        console.log('[DEBUG] analysis_data.channels:', analysisWrapper.analysis_data.channels)
        console.log('[DEBUG] analysis_data.Q present:', 'Q' in analysisWrapper.analysis_data)
        console.log('[DEBUG] analysis_data.plot_data present:', !!analysisWrapper.analysis_data.plot_data)

        const result = {
          ...analysisWrapper.analysis_data,
          // Use the backend storage ID as the primary ID
          id: analysisWrapper.id,
          // Preserve the original analysis ID and other metadata
          analysis_id: analysisWrapper.analysis_data.id,
          result_id: analysisWrapper.result_id,
          storage_created_at: analysisWrapper.created_at
        }

        console.log('[DEBUG] Final result channels:', result.channels)
        console.log('[DEBUG] Final result Q present:', 'Q' in result)
        console.log('[DEBUG] Final result plot_data present:', !!result.plot_data)

        return result
      }

      return analysisWrapper
    } catch (error) {
      console.error(`Failed to get analysis ${resultId} from history:`, error)
      return null
    }
  }

  async deleteAnalysisFromHistory(resultId: string): Promise<boolean> {
    console.log(`[API] Deleting analysis: ${resultId}`)
    try {
      const response = await this.client.delete(`/api/dda/history/${resultId}`)
      console.log('[API] Delete response:', response.data)
      return response.data.success || false
    } catch (error: any) {
      console.error(`[API] Failed to delete analysis ${resultId}:`, {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      })
      // Throw with more detailed error message
      const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error'
      throw new Error(`Failed to delete analysis: ${errorMsg}`)
    }
  }

  async renameAnalysisInHistory(resultId: string, newName: string): Promise<boolean> {
    console.log(`[API] Renaming analysis: ${resultId} to "${newName}"`)
    try {
      const response = await this.client.put(`/api/dda/history/${resultId}/rename`, {
        name: newName
      })
      console.log('[API] Rename response:', response.data)
      return response.data.success || false
    } catch (error: any) {
      console.error(`[API] Failed to rename analysis ${resultId}:`, {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      })
      // Throw with more detailed error message
      const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error'
      throw new Error(`Failed to rename analysis: ${errorMsg}`)
    }
  }
}
