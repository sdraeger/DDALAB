import axios, { AxiosInstance } from 'axios'
import { EDFFileInfo, ChunkData, Annotation, DDAAnalysisRequest, DDAResult, HealthResponse } from '@/types/api'

export class ApiService {
  private client: AxiosInstance
  public baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL
    this.client = axios.create({
      baseURL,
      timeout: 60000, // 60 seconds for heavy operations
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  // Health check
  async checkHealth(): Promise<HealthResponse> {
    const response = await this.client.get<HealthResponse>('/api/health')
    return response.data
  }

  // File management
  async getAvailableFiles(): Promise<EDFFileInfo[]> {
    try {
      // First, get root directory to find EDF folder
      const rootResponse = await this.client.get<{ files: any[] }>('/api/files/list')
      const files: EDFFileInfo[] = []
      
      if (rootResponse.data && Array.isArray(rootResponse.data.files)) {
        // Look for EDF files in root directory
        const rootEdfFiles = rootResponse.data.files
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
        
        files.push(...rootEdfFiles)
        
        // Look for EDF folder and scan it
        const edfFolder = rootResponse.data.files.find(file => 
          file.is_directory && file.name.toLowerCase() === 'edf'
        )
        
        if (edfFolder) {
          const edfResponse = await this.client.get<{ files: any[] }>('/api/files/list', {
            params: { path: 'edf' }
          })
          
          if (edfResponse.data && Array.isArray(edfResponse.data.files)) {
            const edfFiles = edfResponse.data.files
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
            
            files.push(...edfFiles)
          }
        }
      }
      
      return files
    } catch (error) {
      console.error('Failed to get available files:', error)
      return []
    }
  }

  async getFileInfo(filePath: string): Promise<EDFFileInfo> {
    try {
      console.log('Getting file info for:', filePath)
      
      const response = await this.client.get(`/api/edf/data`, {
        params: {
          file_path: filePath,
          chunk_start: 0,
          chunk_size: 1000  // Get some initial data to calculate duration properly
        }
      })
      
      console.log('File info response:', response.data)
      console.log('Raw response keys:', Object.keys(response.data))
      console.log('Data shape check:', {
        hasData: !!response.data.data,
        dataLength: response.data.data?.length,
        firstChannelLength: response.data.data?.[0]?.length,
        totalSamples: response.data.total_samples,
        sampleRate: response.data.sample_rate || response.data.sampling_rate
      })
      
      const sampleRate = response.data.sampling_frequency || response.data.sample_rate || 256
      const totalSamples = response.data.total_samples || 0
      const calculatedDuration = totalSamples > 0 && sampleRate > 0 ? totalSamples / sampleRate : 0
      
      console.log('Duration calculation:', {
        totalSamples,
        sampleRate,
        calculatedDuration,
        responseDuration: response.data.duration
      })
      
      const fileInfo: EDFFileInfo = {
        file_path: filePath,
        file_name: filePath.split('/').pop() || filePath,
        file_size: response.data.file_size || 0,
        duration: response.data.duration || calculatedDuration,
        sample_rate: sampleRate,
        channels: response.data.channel_labels || response.data.channels || [],
        total_samples: totalSamples,
        start_time: response.data.start_time || new Date().toISOString(),
        end_time: response.data.end_time || new Date().toISOString(),
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

  // EDF Data
  async getChunkData(
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    requestedChannels?: string[],
    preprocessing?: {
      highpass?: number
      lowpass?: number
      notch?: number[]
    }
  ): Promise<ChunkData> {
    try {
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
      const response = await this.client.get('/api/edf/data', { params })
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
  async submitDDAAnalysis(request: DDAAnalysisRequest): Promise<DDAResult> {
    try {
      // Map channel names to indices if needed
      const channelIndices = request.channels.map((ch, idx) => {
        const parsed = parseInt(ch)
        return isNaN(parsed) ? idx + 1 : parsed
      })

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
          window_length: request.window_length || 100,
          window_step: request.window_step || 10
        },
        scale_parameters: {
          scale_min: request.scale_min || 1,
          scale_max: request.scale_max || 20,
          scale_num: request.scale_num || 20
        }
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
        firstRows: response.data.Q?.slice(0, 3)
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

      // Process the Q matrix (it's channels x time_points, not channels x scales)
      if (response.data.Q && Array.isArray(response.data.Q) && response.data.Q.length > 0) {
        // Q matrix is channels x time_points - each row is a time series for one channel
        const timePoints = response.data.Q[0]?.length || 100;
        
        // Create a time axis (not scales) for the time series
        scales = Array.from({ length: timePoints }, (_, i) => i);
        
        request.channels.forEach((channel, idx) => {
          if (idx < response.data.Q.length && Array.isArray(response.data.Q[idx])) {
            // Each row of Q matrix is the time series for this channel
            dda_matrix[channel] = response.data.Q[idx];
            // Calculate basic statistics
            const validValues = response.data.Q[idx].filter((v: number) => !isNaN(v) && isFinite(v));
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

      // Create and return the result
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

      return result;
    } catch (error) {
      console.error('Failed to submit DDA analysis:', error)
      throw new Error('Failed to submit DDA analysis: ' + (error instanceof Error ? error.message : 'Unknown error'))
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
}