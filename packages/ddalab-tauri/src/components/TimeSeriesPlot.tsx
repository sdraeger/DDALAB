'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '@/store/appStore'
import { ApiService } from '@/services/apiService'
import { ChunkData } from '@/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  Settings,
  Download,
  RotateCcw,
  Activity,
  AlertCircle,
  ExternalLink
} from 'lucide-react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { usePopoutWindows } from '@/hooks/usePopoutWindows'
import { useTimeSeriesAnnotations } from '@/hooks/useAnnotations'
import { AnnotationContextMenu } from '@/components/annotations/AnnotationContextMenu'
import { AnnotationMarker } from '@/components/annotations/AnnotationMarker'

interface PreprocessingOptions {
  highpass?: number
  lowpass?: number
  notch?: number[]
  detrending?: 'linear' | 'polynomial' | 'none'
}

interface TimeSeriesPlotProps {
  apiService: ApiService
}

export function TimeSeriesPlot({ apiService }: TimeSeriesPlotProps) {
  const { fileManager, plot, updatePlotState, setCurrentChunk } = useAppStore()
  const { createWindow, updateWindowData, broadcastToType } = usePopoutWindows()

  // Annotation support for time series
  const timeSeriesAnnotations = useTimeSeriesAnnotations({
    filePath: fileManager.selectedFile?.file_path || '',
    // For time series, we use global annotations (not per-channel)
  })

  // Remove debug console.log to prevent infinite re-render loop
  const plotRef = useRef<HTMLDivElement>(null)
  const uplotRef = useRef<uPlot | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loadChunkTimeout, setLoadChunkTimeout] = useState<NodeJS.Timeout | null>(null)

  // Preprocessing controls
  const [showPreprocessing, setShowPreprocessing] = useState(false)
  const [preprocessing, setPreprocessing] = useState<PreprocessingOptions>({
    highpass: 0.5,
    lowpass: 70,
    notch: [50],
    detrending: 'linear'
  })

  // Display controls
  const [timeWindow, setTimeWindow] = useState(10) // seconds - default 10s chunks
  const [amplitudeScale, setAmplitudeScale] = useState(100) // microvolts
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])
  const [channelOffset, setChannelOffset] = useState(50) // Default spacing between channels

  // Initialize refs with default values after state is declared
  const amplitudeScaleRef = useRef(amplitudeScale)
  const channelOffsetRef = useRef(channelOffset)
  const timeWindowRef = useRef(timeWindow)

  // Update refs when values change
  useEffect(() => {
    amplitudeScaleRef.current = amplitudeScale
    channelOffsetRef.current = channelOffset
    timeWindowRef.current = timeWindow
  }, [amplitudeScale, channelOffset, timeWindow])

  useEffect(() => {
    console.log('File selection changed:', {
      hasFile: !!fileManager.selectedFile,
      fileName: fileManager.selectedFile?.file_name,
      duration: fileManager.selectedFile?.duration,
      sampleRate: fileManager.selectedFile?.sample_rate,
      channelsCount: fileManager.selectedFile?.channels?.length,
      firstChannels: fileManager.selectedFile?.channels?.slice(0, 5)
    })

    if (fileManager.selectedFile && fileManager.selectedFile.channels.length > 0) {
      setDuration(fileManager.selectedFile.duration || 0)
      // Auto-select first 4 channels for better performance and visibility
      const defaultChannels = fileManager.selectedFile.channels.slice(0, Math.min(4, fileManager.selectedFile.channels.length))
      console.log('Auto-selecting channels:', defaultChannels, 'from total:', fileManager.selectedFile.channels.length)
      setSelectedChannels(defaultChannels)
    } else {
      console.log('No valid file selected or no channels available')
      setSelectedChannels([])
    }
  }, [fileManager.selectedFile])

  const renderPlot = useCallback((chunkData: ChunkData) => {

    if (!plotRef.current) {
      console.error('Plot ref is not available')
      return
    }

    if (!chunkData.data || chunkData.data.length === 0) {
      console.error('No data available for plotting:', chunkData)
      setError('No data available for plotting')
      return
    }

    console.log('Processing data for plot:', {
      chunkDataKeys: Object.keys(chunkData),
      dataShape: chunkData.data ? `${chunkData.data.length} x ${chunkData.data[0]?.length || 0}` : 'no data',
      timestampsLength: chunkData.timestamps?.length,
      sampleRate: chunkData.sample_rate,
      channels: chunkData.channels?.length
    })

    // Prepare data for uPlot
    const dataLength = chunkData.data?.[0]?.length || 0
    // Generate relative time data (0 to timeWindow) instead of absolute timestamps
    const timeData = Array.from({ length: dataLength }, (_, i) => i / chunkData.sample_rate)

    console.log('Generated time data:', {
      timeDataLength: timeData.length,
      firstFew: timeData.slice(0, 5),
      lastFew: timeData.slice(-5)
    })

    // Stack channels with offset for visibility
    const processedData = chunkData.data.map((channelData, index) => {
      if (!Array.isArray(channelData)) {
        console.error(`Channel ${index} data is not an array:`, typeof channelData, channelData)
        return Array(dataLength).fill(0)
      }

      const processed = channelData.map(value => {
        if (typeof value !== 'number') {
          console.warn(`Non-numeric value found:`, value, typeof value)
          return 0
        }

        // Apply amplitude scaling with proper normalization
        // EEG values are typically in microvolts, scale them appropriately
        let scaled = value * (amplitudeScaleRef.current / 1000) // More conservative scaling

        // Add channel offset for stacking
        scaled = scaled + (index * channelOffsetRef.current)

        return isNaN(scaled) ? 0 : scaled
      })

      console.log(`Channel ${index} (${chunkData.channels[index]}) processed:`, {
        originalLength: channelData.length,
        processedLength: processed.length,
        originalRange: [Math.min(...channelData.slice(0, 100)), Math.max(...channelData.slice(0, 100))],
        processedRange: [Math.min(...processed.slice(0, 100)), Math.max(...processed.slice(0, 100))],
        sampleValues: {
          original: channelData.slice(0, 5),
          processed: processed.slice(0, 5)
        },
        hasNaN: processed.some(v => isNaN(v))
      })
      return processed
    })

    const data: uPlot.AlignedData = [timeData, ...processedData]

    console.log('Final uPlot data:', {
      seriesCount: data.length,
      timeLength: data[0].length,
      dataLengths: data.slice(1).map(series => series.length),
      timeDataSample: data[0].slice(0, 10),
      dataSeriesSamples: data.slice(1).map((series, idx) => ({
        channel: idx,
        values: series.slice(0, 10),
        range: [Math.min(...(series as number[])), Math.max(...(series as number[]))]
      })),
      hasVariation: data.slice(1).map((series, idx) => {
        const arr = series as number[]
        const min = Math.min(...arr)
        const max = Math.max(...arr)
        return {
          channel: idx,
          min,
          max,
          range: max - min,
          hasVariation: (max - min) > 0.01
        }
      })
    })

    // Validate data integrity
    const hasValidData = data.every(series => Array.isArray(series) && series.length > 0)
    const hasNumericData = data.slice(1).every((series: any) =>
      series.every((val: any) => typeof val === 'number' && !isNaN(val))
    )

    console.log('Data validation:', {
      hasValidData,
      hasNumericData,
      allLengthsEqual: data.every(series => series.length === data[0].length)
    })

    if (!hasValidData || !hasNumericData) {
      console.error('Invalid data detected, aborting plot creation')
      setError('Invalid data format received')
      return
    }

    // Create series config
    const series: uPlot.Series[] = [
      {}, // time axis
      ...chunkData.channels.map((channel, index) => ({
        label: channel,
        stroke: getChannelColor(index),
        width: 1.5,
        points: { show: false },
        // Use default linear paths instead of custom function
        // paths: (u: uPlot, seriesIdx: number, idx0: number, idx1: number) => {
        //   return uPlot.paths?.linear?.()(u, seriesIdx, idx0, idx1) || null
        // }
      }))
    ]

    console.log('Series configuration:', {
      seriesCount: series.length,
      channelLabels: chunkData.channels,
      seriesLabels: series.slice(1).map(s => s.label)
    })

    const scales: uPlot.Scales = {
      x: {
        time: false,
        range: [0, timeWindowRef.current]
      },
      y: {
        range: (u, min, max) => {
          console.log('Y-axis range calculation:', { min, max })

          // If all data is zero or invalid, use a default range
          if (isNaN(min) || isNaN(max) || min === max) {
            console.log('Using default Y range due to invalid data')
            return [-100, 100]
          }

          const padding = Math.max(Math.abs(max - min) * 0.1, 10)
          const range = [min - padding, max + padding]
          console.log('Calculated Y range:', range)
          return range as [number, number]
        }
      }
    }

    const axes: uPlot.Axis[] = [
      {
        label: 'Time (s)',
        labelSize: 30,
        size: 50
      },
      {
        label: 'Amplitude (µV)',
        labelSize: 60,
        size: 80
      }
    ]

    const opts: uPlot.Options = {
      width: plotRef.current.clientWidth,
      height: 400,
      series,
      scales,
      axes,
      legend: {
        show: true,
        live: true
      },
      cursor: {
        show: true,
        x: true,
        y: true,
        lock: false,
        focus: {
          prox: 30,
        },
        drag: {
          x: true,
          y: false,
          uni: 50,
          dist: 10,
        }
      },
      hooks: {
        setSelect: [
          u => {
            const min = u.select.left
            const max = u.select.left + u.select.width

            if (u.select.width >= 10) { // Only zoom if selection is wide enough
              u.setScale('x', {
                min: u.posToVal(min, 'x'),
                max: u.posToVal(max, 'x')
              })
            }

            // Clear the selection box
            u.setSelect({left: 0, top: 0, width: 0, height: 0}, false)
          }
        ]
      }
    }

    console.log('Creating uPlot with options:', {
      width: opts.width,
      height: opts.height,
      dataLength: data.length,
      plotContainer: !!plotRef.current
    })

    try {
      if (uplotRef.current) {
        // Update existing plot with new data
        console.log('Updating existing uPlot with new data')
        console.log('Data being set:', {
          dataType: typeof data,
          isArray: Array.isArray(data),
          length: data.length,
          timeSeriesLength: data[0]?.length,
          firstTimeValues: data[0]?.slice(0, 5),
          firstDataSeriesValues: data[1]?.slice(0, 5),
          dataStructure: data.map((series, i) => ({
            index: i,
            type: typeof series,
            isArray: Array.isArray(series),
            length: series?.length,
            sample: series?.slice(0, 3)
          }))
        })
        // Store current zoom state before updating data
        const currentScales = uplotRef.current.scales.x
        const wasZoomed = Math.abs((currentScales.min ?? 0) - 0) > 0.01 ||
                         Math.abs((currentScales.max ?? timeWindowRef.current) - timeWindowRef.current) > 0.01

        uplotRef.current.setData(data)

        // Restore zoom if it was previously zoomed
        if (wasZoomed && currentScales.min != null && currentScales.max != null) {
          uplotRef.current.setScale('x', {
            min: currentScales.min,
            max: currentScales.max
          })
        }

        // Force a redraw to ensure the plot updates visually
        uplotRef.current.redraw()
      } else {
        // Create new plot only if none exists
        uplotRef.current = new uPlot(opts, data, plotRef.current)
        console.log('uPlot created successfully:', {
          plotCreated: !!uplotRef.current,
          series: uplotRef.current.series.map(s => ({ label: s.label, show: s.show }))
        })

        // Set up resize observer for the plot
        if (!resizeObserverRef.current && plotRef.current) {
          resizeObserverRef.current = new ResizeObserver(entries => {
            if (uplotRef.current && entries[0]) {
              const { width } = entries[0].contentRect
              uplotRef.current.setSize({ width, height: 400 })
            }
          })
          resizeObserverRef.current.observe(plotRef.current)
        }
      }
    } catch (error) {
      console.error('Failed to create/update uPlot:', error)
      setError('Failed to create plot: ' + error)
      return
    }

  }, [])

  // Clean up plot and observer on unmount
  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
        resizeObserverRef.current = null
      }
      if (uplotRef.current) {
        uplotRef.current.destroy()
        uplotRef.current = null
      }
    }
  }, [])

  const loadChunk = useCallback(async (startTime: number) => {
    console.log('=== LOAD CHUNK CALLED ===', {
      startTime,
      hasFile: !!fileManager.selectedFile,
      fileName: fileManager.selectedFile?.file_name,
      selectedChannelsCount: selectedChannels.length,
      callStack: new Error().stack?.split('\n').slice(1, 6).join('\n')
    })

    if (!fileManager.selectedFile || selectedChannels.length === 0) {
      console.log('Cannot load chunk: no file or channels selected')
      return
    }

    if (fileManager.selectedFile.duration === 0) {
      setError('File has no duration - data may not be properly loaded')
      return
    }

    try {
      setLoading(true)
      setError(null)

      console.log('Loading chunk with params:', {
        file: fileManager.selectedFile.file_name,
        startTime,
        timeWindow,
        sampleRate: fileManager.selectedFile.sample_rate,
        selectedChannels: selectedChannels.length,
        selectedChannelNames: selectedChannels,
        preprocessing
      })

      const chunkSize = Math.floor(timeWindow * fileManager.selectedFile.sample_rate)
      const chunkStart = Math.floor(startTime * fileManager.selectedFile.sample_rate)

      console.log('Calculated chunk params:', {
        chunkStart,
        chunkSize,
        timeWindowSeconds: timeWindow,
        expectedDataPoints: chunkSize,
        startTimeSamples: chunkStart
      })

      const chunkData = await apiService.getChunkData(
        fileManager.selectedFile.file_path,
        chunkStart,
        chunkSize,
        selectedChannels,
        preprocessing
      )

      console.log('Received chunk data:', {
        dataLength: chunkData.data?.length,
        timestampsLength: chunkData.timestamps?.length,
        channels: chunkData.channels?.length,
        sampleRate: chunkData.sample_rate,
        firstChannelFirstValues: chunkData.data?.[0]?.slice(0, 5),
        dataTypes: chunkData.data?.map(channel => typeof channel[0])
      })

      if (!chunkData.data || chunkData.data.length === 0) {
        setError('No data received from server')
        return
      }

      // Quick test: create dummy data to see if uPlot works
      console.log('Testing with real data first, then will try dummy data if needed')

      setCurrentChunk(chunkData)
      renderPlot(chunkData)
      setCurrentTime(startTime)

    } catch (err) {
      console.error('Failed to load chunk:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [fileManager.selectedFile, selectedChannels, timeWindow, preprocessing, apiService, setCurrentChunk])


  const getChannelColor = (index: number): string => {
    const colors = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
      '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1'
    ]
    return colors[index % colors.length]
  }


  const handleSeek = useCallback((time: number) => {
    console.log('Seek requested to:', time)
    setCurrentTime(time)

    // Debounce the chunk loading to avoid rapid API calls while dragging
    if (loadChunkTimeout) {
      clearTimeout(loadChunkTimeout)
      console.log('Clearing previous chunk load timeout')
    }

    const timeoutId = setTimeout(() => {
      console.log('Debounced seek - loading chunk at time:', time)
      loadChunk(time)
    }, 200) // 200ms debounce

    setLoadChunkTimeout(timeoutId)
  }, [loadChunk, loadChunkTimeout])

  const handleChannelToggle = (channel: string, checked: boolean) => {
    setSelectedChannels(prev =>
      checked
        ? [...prev, channel]
        : prev.filter(ch => ch !== channel)
    )
  }

  const handlePopOut = useCallback(async () => {
    if (!plot.currentChunk) return

    const timeSeriesData = {
      channels: plot.currentChunk.channels,
      data: plot.currentChunk.data,
      timestamps: plot.currentChunk.timestamps,
      sampleRate: plot.currentChunk.sample_rate,
      chunkStart: plot.currentChunk.chunk_start,
      timeWindow: timeWindow,
      currentTime: currentTime,
      filters: preprocessing
    }

    try {
      const windowId = await createWindow('timeseries', 'main', timeSeriesData)
      console.log('Created timeseries popout window:', windowId)
    } catch (error) {
      console.error('Failed to create popout window:', error)
    }
  }, [plot.currentChunk, timeWindow, currentTime, preprocessing, createWindow])

  // Load initial chunk when file or channels change
  useEffect(() => {
    console.log('File/channel change effect triggered:', {
      hasFile: !!fileManager.selectedFile,
      fileName: fileManager.selectedFile?.file_name,
      selectedChannelsCount: selectedChannels.length,
      selectedChannels: selectedChannels
    })

    if (fileManager.selectedFile && selectedChannels.length > 0) {
      console.log('Conditions met - triggering initial chunk load')
      // Destroy existing plot when file changes to ensure clean state
      if (uplotRef.current) {
        uplotRef.current.destroy()
        uplotRef.current = null
      }
      loadChunk(0) // Always load from start when file/channels change
      setCurrentTime(0) // Reset to start
    } else {
      console.log('Conditions not met for chunk loading:', {
        hasFile: !!fileManager.selectedFile,
        hasChannels: selectedChannels.length > 0
      })
    }
  }, [fileManager.selectedFile, selectedChannels, loadChunk])

  // Handle time window changes separately to avoid recreating plot
  useEffect(() => {
    if (fileManager.selectedFile && selectedChannels.length > 0 && currentTime >= 0) {
      console.log('TimeWindow useEffect triggered, reloading chunk at current time:', currentTime, {
        timeWindow,
        fileName: fileManager.selectedFile?.file_name,
        selectedChannelsCount: selectedChannels.length
      })
      // Don't reload on every currentTime change as this would reset zoom constantly
      // Only reload when timeWindow itself changes
      loadChunk(currentTime)
    }
  }, [timeWindow, loadChunk, fileManager.selectedFile, selectedChannels])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (loadChunkTimeout) {
        clearTimeout(loadChunkTimeout)
      }
    }
  }, [loadChunkTimeout])

  // Update popout windows when data changes
  useEffect(() => {
    if (plot.currentChunk) {
      const timeSeriesData = {
        channels: plot.currentChunk.channels,
        data: plot.currentChunk.data,
        timestamps: plot.currentChunk.timestamps,
        sampleRate: plot.currentChunk.sample_rate,
        chunkStart: plot.currentChunk.chunk_start,
        timeWindow: timeWindow,
        currentTime: currentTime,
        filters: preprocessing
      }

      broadcastToType('timeseries', 'data-update', timeSeriesData).catch(console.error)
    }
  }, [plot.currentChunk, currentTime, timeWindow, preprocessing, broadcastToType])

  if (!fileManager.selectedFile) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent>
          <div className="text-center">
            <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No File Selected</h3>
            <p className="text-muted-foreground">
              Select an EDF file from the file manager to start plotting
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Controls Panel */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Time Series Visualization</CardTitle>
              <CardDescription>
                {fileManager.selectedFile.file_name} • {selectedChannels.length} channels
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPreprocessing(!showPreprocessing)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Preprocessing
              </Button>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePopOut}
                disabled={!plot.currentChunk}
                title="Pop out to separate window"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Pop Out
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Navigation Controls */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSeek(Math.max(0, currentTime - timeWindow))}
                disabled={loading || currentTime <= 0}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSeek(Math.min(duration - timeWindow, currentTime + timeWindow))}
                disabled={loading || currentTime >= duration - timeWindow}
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1">
              <Label className="text-sm">Time: {currentTime.toFixed(1)}s / {duration.toFixed(1)}s</Label>
              <Slider
                value={[currentTime]}
                onValueChange={([time]) => handleSeek(time)}
                min={0}
                max={Math.max(0, duration - timeWindow)}
                step={0.1}
                className="mt-1"
              />
            </div>

          </div>

          <Separator />

          {/* Display Controls */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Label className="text-sm">Time Window (s)</Label>
              <Select value={timeWindow.toString()} onValueChange={(value) => setTimeWindow(parseInt(value))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5s</SelectItem>
                  <SelectItem value="10">10s</SelectItem>
                  <SelectItem value="15">15s</SelectItem>
                  <SelectItem value="30">30s</SelectItem>
                  <SelectItem value="60">60s</SelectItem>
                  <SelectItem value="120">120s</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm">Amplitude (µV)</Label>
              <Input
                type="number"
                value={amplitudeScale}
                onChange={(e) => setAmplitudeScale(parseInt(e.target.value) || 100)}
                min="10"
                max="1000"
                step="10"
              />
            </div>

            <div>
              <Label className="text-sm">Channel Spacing</Label>
              <Input
                type="number"
                value={channelOffset}
                onChange={(e) => setChannelOffset(parseInt(e.target.value) || 0)}
                min="0"
                max="500"
                step="10"
              />
            </div>

            <div className="flex items-end space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAmplitudeScale(100)
                  setChannelOffset(0)
                  setCurrentTime(0)
                }}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (uplotRef.current) {
                    uplotRef.current.setScale('x', {
                      min: 0,
                      max: timeWindow
                    })
                  }
                }}
                title="Reset X-axis zoom"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Preprocessing Controls */}
          {showPreprocessing && (
            <div className="border rounded-lg p-4 space-y-4">
              <h4 className="font-medium">Preprocessing Options</h4>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm">High-pass Filter (Hz)</Label>
                  <Input
                    type="number"
                    value={preprocessing.highpass || ''}
                    onChange={(e) => setPreprocessing(prev => ({
                      ...prev,
                      highpass: parseFloat(e.target.value) || undefined
                    }))}
                    placeholder="0.5"
                    step="0.1"
                    min="0"
                  />
                </div>

                <div>
                  <Label className="text-sm">Low-pass Filter (Hz)</Label>
                  <Input
                    type="number"
                    value={preprocessing.lowpass || ''}
                    onChange={(e) => setPreprocessing(prev => ({
                      ...prev,
                      lowpass: parseFloat(e.target.value) || undefined
                    }))}
                    placeholder="70"
                    step="1"
                    min="1"
                  />
                </div>
              </div>

              <div>
                <Label className="text-sm">Notch Filters (Hz)</Label>
                <div className="flex items-center space-x-2 mt-1">
                  <Checkbox
                    checked={preprocessing.notch?.includes(50) || false}
                    onCheckedChange={(checked) => {
                      setPreprocessing(prev => ({
                        ...prev,
                        notch: checked
                          ? [...(prev.notch || []), 50]
                          : (prev.notch || []).filter(f => f !== 50)
                      }))
                    }}
                  />
                  <Label className="text-sm">50Hz (EU)</Label>

                  <Checkbox
                    checked={preprocessing.notch?.includes(60) || false}
                    onCheckedChange={(checked) => {
                      setPreprocessing(prev => ({
                        ...prev,
                        notch: checked
                          ? [...(prev.notch || []), 60]
                          : (prev.notch || []).filter(f => f !== 60)
                      }))
                    }}
                  />
                  <Label className="text-sm">60Hz (US)</Label>
                </div>
              </div>

              <div>
                <Label className="text-sm">Detrending</Label>
                <Select
                  value={preprocessing.detrending || 'linear'}
                  onValueChange={(value: 'linear' | 'polynomial' | 'none') =>
                    setPreprocessing(prev => ({ ...prev, detrending: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="linear">Linear</SelectItem>
                    <SelectItem value="polynomial">Polynomial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Channel Selection */}
          <div>
            <Label className="text-sm mb-2 block">
              Channels ({selectedChannels.length} of {fileManager.selectedFile.channels.length} selected)
            </Label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {fileManager.selectedFile.channels.map(channel => (
                <Badge
                  key={channel}
                  variant={selectedChannels.includes(channel) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => handleChannelToggle(channel, !selectedChannels.includes(channel))}
                >
                  {channel}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plot Area */}
      <Card className="flex-1">
        <CardContent className="p-4 h-full">
          {error && (
            <div className="flex items-center space-x-2 text-red-600 mb-4">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">Loading data...</p>
              </div>
            </div>
          )}

          <div
            className="w-full h-full min-h-[400px] relative"
            onContextMenu={(e) => {
              console.log('[ANNOTATION] Right-click detected on time series plot', {
                hasPlot: !!uplotRef.current,
                hasChunk: !!plot.currentChunk,
                currentTime
              })

              e.preventDefault()
              e.stopPropagation()

              if (!uplotRef.current || !plot.currentChunk) {
                console.warn('[ANNOTATION] Plot or data not available yet')
                return
              }

              const rect = e.currentTarget.getBoundingClientRect()
              const plotX = e.clientX - rect.left

              // Convert pixel position to time value
              const plotWidth = rect.width
              const timeValue = currentTime + (plotX / plotWidth) * timeWindow

              console.log('[ANNOTATION] Opening time series context menu at time:', timeValue)
              timeSeriesAnnotations.openContextMenu(e.clientX, e.clientY, timeValue)
            }}
          >
            <div ref={plotRef} className="w-full h-full min-h-[400px]" />

            {/* Annotation overlay */}
            {uplotRef.current && plot.currentChunk && timeSeriesAnnotations.annotations.length > 0 && (
              <svg
                className="absolute top-0 left-0"
                style={{
                  width: plotRef.current?.clientWidth || 0,
                  height: plotRef.current?.clientHeight || 0,
                  pointerEvents: 'none'
                }}
              >
                {timeSeriesAnnotations.annotations.map((annotation) => {
                  // Only show annotations in current time window
                  if (annotation.position < currentTime || annotation.position > currentTime + timeWindow) {
                    return null
                  }

                  // Get uPlot bbox for accurate dimensions
                  const bbox = uplotRef.current?.bbox
                  const plotWidth = bbox?.width || plotRef.current?.clientWidth || 800
                  const plotHeight = bbox?.height || plotRef.current?.clientHeight || 400
                  const relativeTime = annotation.position - currentTime
                  const xPosition = (relativeTime / timeWindow) * plotWidth

                  return (
                    <AnnotationMarker
                      key={annotation.id}
                      annotation={annotation}
                      plotHeight={plotHeight}
                      xPosition={xPosition}
                      onRightClick={(e, ann) => {
                        e.preventDefault()
                        timeSeriesAnnotations.openContextMenu(
                          e.clientX,
                          e.clientY,
                          ann.position,
                          ann
                        )
                      }}
                      onClick={(ann) => {
                        const rect = plotRef.current?.getBoundingClientRect()
                        if (rect) {
                          timeSeriesAnnotations.handleAnnotationClick(ann, rect.left + xPosition, rect.top + 50)
                        }
                      }}
                    />
                  )
                })}
              </svg>
            )}
          </div>

          {/* Annotation context menu */}
          {timeSeriesAnnotations.contextMenu && (
            <AnnotationContextMenu
              x={timeSeriesAnnotations.contextMenu.x}
              y={timeSeriesAnnotations.contextMenu.y}
              plotPosition={timeSeriesAnnotations.contextMenu.plotPosition}
              existingAnnotation={timeSeriesAnnotations.contextMenu.annotation}
              onCreateAnnotation={timeSeriesAnnotations.handleCreateAnnotation}
              onEditAnnotation={timeSeriesAnnotations.handleUpdateAnnotation}
              onDeleteAnnotation={timeSeriesAnnotations.handleDeleteAnnotation}
              onClose={timeSeriesAnnotations.closeContextMenu}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
