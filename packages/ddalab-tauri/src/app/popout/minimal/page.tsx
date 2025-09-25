'use client'

import { useEffect, useState, Suspense, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

function PopoutContent() {
  const searchParams = useSearchParams()
  const windowType = searchParams.get('type')
  const windowId = searchParams.get('id')
  
  const [isClient, setIsClient] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const [currentData, setCurrentData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Initializing...')
  
  // Refs for plot containers
  const timeSeriesPlotRef = useRef<HTMLDivElement>(null)
  const ddaHeatmapRef = useRef<HTMLDivElement>(null)
  const ddaLinePlotRef = useRef<HTMLDivElement>(null)
  const uplotTimeSeriesRef = useRef<uPlot | null>(null)
  const uplotHeatmapRef = useRef<uPlot | null>(null)
  const uplotLinePlotRef = useRef<uPlot | null>(null)

  const titleMap: Record<string, string> = {
    'timeseries': 'Time Series Plot',
    'dda-results': 'DDA Analysis Results',
    'eeg-visualization': 'EEG Visualization'
  }

  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (!isClient || !windowId) return

    let unlistenData: (() => void) | undefined
    let unlistenLock: (() => void) | undefined

    const initializeTauri = async () => {
      try {
        console.log(`[POPOUT] Initializing Tauri for window ID: ${windowId}, type: ${windowType}`)
        setStatus('Connecting to Tauri...')
        
        // Dynamic import to avoid SSR issues
        const [
          { listen, emit },
          { getCurrentWindow }
        ] = await Promise.all([
          import('@tauri-apps/api/event'),
          import('@tauri-apps/api/window')
        ])
        
        console.log('[POPOUT] Tauri API imports successful')

        setStatus('Setting up event listeners...')

        // Listen for data updates
        const eventName = `data-update-${windowId}`
        console.log(`Setting up listener for event: ${eventName}`)
        
        unlistenData = await listen(eventName, (event: any) => {
          console.log(`[POPOUT] Received data update event: ${eventName}`, {
            eventPayload: event.payload,
            isLocked,
            windowId,
            dataKeys: event.payload?.data ? Object.keys(event.payload.data) : 'no data'
          })
          
          if (!isLocked) {
            setCurrentData(event.payload.data)
            setStatus(`Last update: ${new Date().toLocaleTimeString()}`)
            console.log('[POPOUT] Data updated in state')
          } else {
            console.log('[POPOUT] Window locked, ignoring data update')
          }
        })
        
        console.log(`[POPOUT] Successfully set up listener for ${eventName}`)

        // Listen for lock state changes
        unlistenLock = await listen(`lock-state-${windowId}`, (event: any) => {
          setIsLocked(event.payload.locked)
          setStatus(`Window ${event.payload.locked ? 'locked' : 'unlocked'}`)
        })

        setStatus(`Ready - Window ID: ${windowId}`)
        console.log(`[POPOUT] Initialization complete for window ${windowId}, waiting for data events`)

        // Setup window controls
        const setupControls = () => {
          window.addEventListener('keydown', async (e) => {
            if (e.key === 'Escape') {
              const currentWindow = getCurrentWindow()
              await currentWindow.close()
            }
          })
        }

        setupControls()

        // Make functions globally available for button clicks
        ;(window as any).closeWindow = async () => {
          const currentWindow = getCurrentWindow()
          await currentWindow.close()
        }

        ;(window as any).minimizeWindow = async () => {
          const currentWindow = getCurrentWindow()
          await currentWindow.minimize()
        }

        ;(window as any).toggleLock = async () => {
          const eventName = isLocked ? `unlock-window-${windowId}` : `lock-window-${windowId}`
          await emit(eventName)
        }

        ;(window as any).refreshContent = () => {
          if (currentData) {
            // Trigger re-render by updating state
            setCurrentData({ ...currentData })
            setStatus('Content refreshed')
          }
        }

      } catch (error) {
        console.error('Failed to initialize Tauri:', error)
        setError(`Failed to initialize Tauri: ${error}`)
        setStatus('Error: ' + error)
      }
    }

    initializeTauri()

    return () => {
      if (unlistenData) unlistenData()
      if (unlistenLock) unlistenLock()
    }
  }, [isClient, windowId, isLocked])

  // Plot rendering functions
  const renderTimeSeriesPlot = useCallback(() => {
    if (!timeSeriesPlotRef.current || !currentData || !currentData.data) return

    // Clean up existing plot
    if (uplotTimeSeriesRef.current) {
      uplotTimeSeriesRef.current.destroy()
      uplotTimeSeriesRef.current = null
    }

    try {
      const { data, timestamps, channels } = currentData
      
      // Prepare data for uPlot: [timestamps, ...channel_data]
      const plotData: uPlot.AlignedData = [timestamps || []]
      
      // Add channel data
      if (Array.isArray(data) && data.length > 0) {
        // If data is array of arrays (multiple channels)
        if (Array.isArray(data[0])) {
          data.forEach((channelData: number[]) => {
            plotData.push(new Float64Array(channelData))
          })
        } else {
          // Single channel data
          plotData.push(new Float64Array(data))
        }
      }

      // Create series configuration
      const series: uPlot.Series[] = [
        {}, // x-axis (time)
        ...channels.map((channel: string, idx: number) => ({
          label: channel,
          stroke: getChannelColor(idx),
          width: 1,
          points: { show: false }
        }))
      ]

      const opts: uPlot.Options = {
        width: timeSeriesPlotRef.current.clientWidth,
        height: 400,
        series,
        axes: [
          {
            label: 'Time (s)',
            labelSize: 30,
            size: 50
          },
          {
            label: 'Amplitude (μV)',
            labelSize: 80,
            size: 80
          }
        ],
        legend: {
          show: true,
          live: false
        },
        cursor: {
          show: true,
          x: true,
          y: true
        }
      }

      uplotTimeSeriesRef.current = new uPlot(opts, plotData, timeSeriesPlotRef.current)
      
      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        if (uplotTimeSeriesRef.current && timeSeriesPlotRef.current) {
          uplotTimeSeriesRef.current.setSize({
            width: timeSeriesPlotRef.current.clientWidth,
            height: 400
          })
        }
      })

      resizeObserver.observe(timeSeriesPlotRef.current)

      return () => {
        resizeObserver.disconnect()
        if (uplotTimeSeriesRef.current) {
          uplotTimeSeriesRef.current.destroy()
          uplotTimeSeriesRef.current = null
        }
      }
    } catch (error) {
      console.error('Error rendering time series plot:', error)
      setError(`Failed to render time series plot: ${error}`)
    }
  }, [currentData])

  const getChannelColor = (index: number): string => {
    const colors = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
      '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1'
    ]
    return colors[index % colors.length]
  }

  const renderDDALinePlot = useCallback(() => {
    if (!ddaLinePlotRef.current || !currentData || !currentData.result) return

    // Clean up existing plot
    if (uplotLinePlotRef.current) {
      uplotLinePlotRef.current.destroy()
      uplotLinePlotRef.current = null
    }

    try {
      const result = currentData.result
      const scales = result.results.scales
      const dda_matrix = result.results.dda_matrix
      
      if (!scales || !dda_matrix) return

      // Prepare data for line plot
      const plotData: uPlot.AlignedData = [scales]
      const channels = Object.keys(dda_matrix)

      // Add DDA matrix data for each channel
      channels.forEach(channel => {
        if (dda_matrix[channel]) {
          plotData.push(dda_matrix[channel])
        }
      })

      // Create series configuration
      const series: uPlot.Series[] = [
        {}, // x-axis
        ...channels.map((channel, index) => ({
          label: `${channel} (α=${result.results.exponents[channel]?.toFixed(3) || 'N/A'})`,
          stroke: getChannelColor(index),
          width: 2,
          points: { show: false }
        }))
      ]

      const opts: uPlot.Options = {
        width: ddaLinePlotRef.current.clientWidth,
        height: 300,
        series,
        scales: {
          x: {
            time: false,
          },
          y: {
          }
        },
        axes: [
          {
            label: 'Time Points',
            labelSize: 30,
            size: 50
          },
          {
            label: 'DDA Values',
            labelSize: 80,
            size: 80
          }
        ],
        legend: {
          show: true,
          live: true
        },
        cursor: {
          show: true,
          x: true,
          y: true,
          lock: true
        }
      }

      uplotLinePlotRef.current = new uPlot(opts, plotData, ddaLinePlotRef.current)

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        if (uplotLinePlotRef.current && ddaLinePlotRef.current) {
          uplotLinePlotRef.current.setSize({
            width: ddaLinePlotRef.current.clientWidth,
            height: 300
          })
        }
      })

      resizeObserver.observe(ddaLinePlotRef.current)

      return () => {
        resizeObserver.disconnect()
        if (uplotLinePlotRef.current) {
          uplotLinePlotRef.current.destroy()
          uplotLinePlotRef.current = null
        }
      }
    } catch (error) {
      console.error('Error rendering DDA line plot:', error)
      setError(`Failed to render DDA line plot: ${error}`)
    }
  }, [currentData])

  // Lock toggle function
  const toggleLock = useCallback(async () => {
    if (!windowId) return
    
    const newLockState = !isLocked
    setIsLocked(newLockState)
    
    try {
      const { emit } = await import('@tauri-apps/api/event')
      await emit(`toggle-lock-${windowId}`, { 
        windowId, 
        locked: newLockState 
      })
      console.log(`[POPOUT] Lock toggled to: ${newLockState ? 'locked' : 'unlocked'}`)
    } catch (error) {
      console.error('Failed to toggle lock:', error)
      // Revert lock state if emission failed
      setIsLocked(!newLockState)
    }
  }, [windowId, isLocked])

  // Re-render plots when data changes
  useEffect(() => {
    if (windowType === 'timeseries' && currentData && !isLocked) {
      renderTimeSeriesPlot()
    } else if (windowType === 'dda-results' && currentData && !isLocked) {
      renderDDALinePlot()
    }
  }, [currentData, windowType, isLocked, renderTimeSeriesPlot, renderDDALinePlot])

  const renderContent = () => {
    if (error) {
      return (
        <div className="text-red-600 p-4 bg-red-50 border border-red-200 rounded">
          <h3 className="font-semibold">Error</h3>
          <p>{error}</p>
        </div>
      )
    }

    if (!currentData) {
      return (
        <div className="flex items-center justify-center h-full text-gray-600">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p>Waiting for data...</p>
          </div>
        </div>
      )
    }


    if (windowType === 'timeseries') {
      return renderTimeSeriesContent()
    } else if (windowType === 'dda-results') {
      return renderDDAResultsContent()
    } else {
      return <div>Unknown window type: {windowType}</div>
    }
  }

  const renderTimeSeriesContent = () => {
    const data = currentData
    if (!data || !data.channels) {
      return <div className="p-4">No time series data available</div>
    }

    return (
      <div className="p-4 h-full flex flex-col">
        <h2 className="text-lg font-semibold mb-4">Time Series Plot</h2>
        
        {/* Metadata */}
        <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
          <div>
            <label className="block text-gray-600">Channels</label>
            <div className="font-semibold">{data.channels.length}</div>
          </div>
          <div>
            <label className="block text-gray-600">Sample Rate</label>
            <div className="font-semibold">{data.sampleRate} Hz</div>
          </div>
          <div>
            <label className="block text-gray-600">Time Window</label>
            <div className="font-semibold">{data.timeWindow}s</div>
          </div>
          <div>
            <label className="block text-gray-600">Data Points</label>
            <div className="font-semibold">{data.data ? (Array.isArray(data.data[0]) ? data.data[0].length : data.data.length) : 0}</div>
          </div>
        </div>
        
        {/* Plot Container */}
        <div className="flex-1 min-h-0">
          <div 
            ref={timeSeriesPlotRef} 
            className="w-full h-full border border-gray-200 rounded bg-white"
          />
        </div>
        
        {/* Channel List */}
        {data.channels && data.channels.length > 0 && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-600 mb-2">Channels</label>
            <div className="flex flex-wrap gap-2">
              {data.channels.map((ch: string, idx: number) => (
                <span 
                  key={ch} 
                  className="px-2 py-1 rounded text-xs font-medium"
                  style={{ 
                    backgroundColor: getChannelColor(idx) + '20',
                    borderColor: getChannelColor(idx),
                    color: getChannelColor(idx),
                    borderWidth: '1px'
                  }}
                >
                  {ch}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderDDAResultsContent = () => {
    const data = currentData
    if (!data || !data.result) {
      return <div className="p-4">No DDA results available</div>
    }

    const result = data.result
    return (
      <div className="p-4 h-full flex flex-col">
        <h2 className="text-lg font-semibold mb-4">DDA Analysis Results</h2>
        
        {/* Metadata */}
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <label className="block text-gray-600">Result ID</label>
            <div className="text-xs font-mono">{result.id}</div>
          </div>
          <div>
            <label className="block text-gray-600">Channels</label>
            <div className="font-semibold">{result.channels ? result.channels.length : 0}</div>
          </div>
        </div>
        
        {/* DDA Line Plot */}
        <div className="flex-1 min-h-0 mb-4">
          <h3 className="text-sm font-medium mb-2">DDA Time Series</h3>
          <div 
            ref={ddaLinePlotRef} 
            className="w-full h-full border border-gray-200 rounded bg-white"
          />
        </div>
        
        {/* Statistics */}
        {result.results?.exponents && (
          <div className="mb-4">
            <h3 className="text-sm font-medium mb-2">Channel Exponents</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <label className="block text-gray-600">Mean α</label>
                <div className="font-semibold">
                  {Object.values(result.results.exponents).length > 0 
                    ? ((Object.values(result.results.exponents) as number[]).reduce((a: number, b: number) => a + b, 0) / Object.values(result.results.exponents).length).toFixed(3)
                    : 'N/A'
                  }
                </div>
              </div>
              <div>
                <label className="block text-gray-600">Processing Time</label>
                <div className="font-semibold">{result.results?.quality_metrics?.processing_time || 'N/A'}s</div>
              </div>
            </div>
          </div>
        )}
        
        {/* Channel List */}
        {result.channels && result.channels.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">Channels</label>
            <div className="flex flex-wrap gap-2">
              {result.channels.map((ch: string, idx: number) => (
                <span 
                  key={ch} 
                  className="px-2 py-1 rounded text-xs font-medium"
                  style={{ 
                    backgroundColor: getChannelColor(idx) + '20',
                    borderColor: getChannelColor(idx),
                    color: getChannelColor(idx),
                    borderWidth: '1px'
                  }}
                >
                  {ch} (α={result.results?.exponents?.[ch]?.toFixed(3) || 'N/A'})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (!isClient) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-white text-black">
      {/* Custom title bar - no data-tauri-drag-region since parent layout should handle it */}
      <div className="h-10 bg-gray-100 border-b flex items-center justify-between px-3 select-none">
        <div className="text-sm font-medium text-gray-700">
          {titleMap[windowType || ''] || 'DDALAB Popout'}
        </div>
        
        <div className="flex items-center space-x-1">
          <button
            onClick={toggleLock}
            className={`w-7 h-7 rounded flex items-center justify-center text-xs transition-colors ${
              isLocked 
                ? 'bg-red-100 hover:bg-red-200 text-red-700' 
                : 'bg-green-100 hover:bg-green-200 text-green-700'
            }`}
            title={isLocked ? "Unlock window (currently not receiving updates)" : "Lock window (stop receiving updates)"}
          >
            {isLocked ? '🔒' : '🔓'}
          </button>
          
          <button
            onClick={() => (window as any).refreshContent?.()}
            className="w-7 h-7 rounded hover:bg-gray-200 flex items-center justify-center text-xs"
            title="Refresh"
          >
            ↻
          </button>
          
          <button
            onClick={() => (window as any).minimizeWindow?.()}
            className="w-7 h-7 rounded hover:bg-gray-200 flex items-center justify-center text-xs"
            title="Minimize"
          >
            −
          </button>
          
          <button
            onClick={() => (window as any).closeWindow?.()}
            className="w-7 h-7 rounded hover:bg-red-500 hover:text-white flex items-center justify-center text-xs"
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Lock status indicator */}
      {isLocked && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-3 py-2">
          <div className="flex items-center space-x-2 text-yellow-800 text-sm">
            🔒 <span>Window is locked - not receiving updates</span>
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {renderContent()}
      </div>

      {/* Status bar */}
      <div className="h-6 bg-gray-50 border-t flex items-center justify-between px-3 text-xs text-gray-500">
        <div>
          Window ID: {windowId || 'Unknown'} | Status: {isLocked ? '🔒 Locked (Not receiving updates)' : '🔓 Live (Receiving updates)'}
        </div>
        <div>
          {status}
        </div>
      </div>
    </div>
  )
}

export default function MinimalPopout() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    }>
      <PopoutContent />
    </Suspense>
  )
}