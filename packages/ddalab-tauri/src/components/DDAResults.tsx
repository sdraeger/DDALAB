'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '@/store/appStore'
import { DDAResult } from '@/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { 
  Download,
  Palette,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  TrendingUp,
  Grid3x3,
  BarChart3,
  Eye,
  Info,
  ExternalLink
} from 'lucide-react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { usePopoutWindows } from '@/hooks/usePopoutWindows'

interface DDAResultsProps {
  result: DDAResult
}

type ColorScheme = 'viridis' | 'plasma' | 'inferno' | 'jet' | 'cool' | 'hot'
type ViewMode = 'heatmap' | 'lineplot' | 'both'

export function DDAResults({ result }: DDAResultsProps) {
  const { createWindow, broadcastToType } = usePopoutWindows()
  const heatmapRef = useRef<HTMLDivElement>(null)
  const linePlotRef = useRef<HTMLDivElement>(null)
  const uplotHeatmapRef = useRef<uPlot | null>(null)
  const uplotLinePlotRef = useRef<uPlot | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>('both')
  const [colorScheme, setColorScheme] = useState<ColorScheme>('viridis')
  const [selectedChannels, setSelectedChannels] = useState<string[]>(result.channels)
  const [heatmapData, setHeatmapData] = useState<number[][]>([])
  const [colorRange, setColorRange] = useState<[number, number]>([0, 1])
  const [autoScale, setAutoScale] = useState(true)

  // Color schemes
  const colorSchemes: Record<ColorScheme, (t: number) => string> = {
    viridis: (t: number) => {
      const colors = [
        [68, 1, 84], [72, 40, 120], [62, 73, 137], [49, 104, 142],
        [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89],
        [180, 222, 44], [253, 231, 37]
      ]
      const idx = Math.floor(t * (colors.length - 1))
      const frac = t * (colors.length - 1) - idx
      const c1 = colors[idx] || colors[0]
      const c2 = colors[idx + 1] || colors[colors.length - 1]
      const r = Math.round(c1[0] + frac * (c2[0] - c1[0]))
      const g = Math.round(c1[1] + frac * (c2[1] - c1[1]))
      const b = Math.round(c1[2] + frac * (c2[2] - c1[2]))
      return `rgb(${r},${g},${b})`
    },
    plasma: (t: number) => {
      const colors = [
        [13, 8, 135], [75, 3, 161], [125, 3, 168], [168, 34, 150],
        [203, 70, 121], [229, 107, 93], [248, 148, 65], [253, 195, 40],
        [239, 248, 33]
      ]
      const idx = Math.floor(t * (colors.length - 1))
      const frac = t * (colors.length - 1) - idx
      const c1 = colors[idx] || colors[0]
      const c2 = colors[idx + 1] || colors[colors.length - 1]
      const r = Math.round(c1[0] + frac * (c2[0] - c1[0]))
      const g = Math.round(c1[1] + frac * (c2[1] - c1[1]))
      const b = Math.round(c1[2] + frac * (c2[2] - c1[2]))
      return `rgb(${r},${g},${b})`
    },
    inferno: (t: number) => {
      const colors = [
        [0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106],
        [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50],
        [252, 255, 164]
      ]
      const idx = Math.floor(t * (colors.length - 1))
      const frac = t * (colors.length - 1) - idx
      const c1 = colors[idx] || colors[0]
      const c2 = colors[idx + 1] || colors[colors.length - 1]
      const r = Math.round(c1[0] + frac * (c2[0] - c1[0]))
      const g = Math.round(c1[1] + frac * (c2[1] - c1[1]))
      const b = Math.round(c1[2] + frac * (c2[2] - c1[2]))
      return `rgb(${r},${g},${b})`
    },
    jet: (t: number) => {
      const r = Math.max(0, Math.min(255, Math.round(255 * (1.5 - 4 * Math.abs(t - 0.75)))))
      const g = Math.max(0, Math.min(255, Math.round(255 * (1.5 - 4 * Math.abs(t - 0.5)))))
      const b = Math.max(0, Math.min(255, Math.round(255 * (1.5 - 4 * Math.abs(t - 0.25)))))
      return `rgb(${r},${g},${b})`
    },
    cool: (t: number) => {
      const r = Math.round(t * 255)
      const g = Math.round((1 - t) * 255)
      const b = 255
      return `rgb(${r},${g},${b})`
    },
    hot: (t: number) => {
      let r, g, b
      if (t < 0.4) {
        r = Math.round(255 * t / 0.4)
        g = 0
        b = 0
      } else if (t < 0.8) {
        r = 255
        g = Math.round(255 * (t - 0.4) / 0.4)
        b = 0
      } else {
        r = 255
        g = 255
        b = Math.round(255 * (t - 0.8) / 0.2)
      }
      return `rgb(${r},${g},${b})`
    }
  }

  // Generate heatmap data from dda_matrix
  useEffect(() => {
    const channels = selectedChannels
    const scales = result.results.scales
    const dda_matrix = result.results.dda_matrix

    const data: number[][] = []
    let minVal = Infinity
    let maxVal = -Infinity

    // Create 2D array: [channel][time_point] = dda_matrix value
    channels.forEach(channel => {
      if (dda_matrix[channel]) {
        const channelData = dda_matrix[channel].map(val => {
          // Log transform for better visualization
          const logVal = Math.log10(Math.max(0.001, val))
          minVal = Math.min(minVal, logVal)
          maxVal = Math.max(maxVal, logVal)
          return logVal
        })
        data.push(channelData)
      }
    })

    setHeatmapData(data)
    
    if (autoScale) {
      setColorRange([minVal, maxVal])
    }
  }, [result, selectedChannels, autoScale])

  const renderHeatmap = useCallback(() => {
    if (!heatmapRef.current || heatmapData.length === 0) return

    // Clean up existing plot
    if (uplotHeatmapRef.current) {
      uplotHeatmapRef.current.destroy()
      uplotHeatmapRef.current = null
    }

    const width = heatmapRef.current.clientWidth
    const height = Math.max(300, selectedChannels.length * 30 + 100)

    // Create canvas for heatmap rendering
    const canvas = document.createElement('canvas')
    canvas.width = result.results.scales.length
    canvas.height = selectedChannels.length
    const ctx = canvas.getContext('2d')!

    // Render heatmap pixels
    const imageData = ctx.createImageData(canvas.width, canvas.height)
    const data = imageData.data

    for (let y = 0; y < selectedChannels.length; y++) {
      for (let x = 0; x < result.results.scales.length; x++) {
        const value = heatmapData[y]?.[x] || 0
        const normalized = (value - colorRange[0]) / (colorRange[1] - colorRange[0])
        const clamped = Math.max(0, Math.min(1, normalized))
        
        const color = colorSchemes[colorScheme](clamped)
        const rgb = color.match(/\d+/g)!.map(Number)
        
        const pixelIndex = (y * canvas.width + x) * 4
        data[pixelIndex] = rgb[0]     // R
        data[pixelIndex + 1] = rgb[1] // G
        data[pixelIndex + 2] = rgb[2] // B
        data[pixelIndex + 3] = 255    // A
      }
    }

    ctx.putImageData(imageData, 0, 0)

    // Convert canvas to data URL for uPlot
    const dataURL = canvas.toDataURL()

    // Prepare data for uPlot (just coordinates for image positioning)
    const plotData: uPlot.AlignedData = [
      [0, result.results.scales[result.results.scales.length - 1]],
      [0, selectedChannels.length - 1]
    ]

    const opts: uPlot.Options = {
      width,
      height,
      scales: {
        x: {
          time: false,
          range: [result.results.scales[0], result.results.scales[result.results.scales.length - 1]]
        },
        y: {
          range: [-0.5, selectedChannels.length - 0.5]
        }
      },
      axes: [
        {
          label: 'Time Points',
          labelSize: 30,
          size: 50
        },
        {
          label: 'Channels',
          labelSize: 100,
          size: 120,
          values: (u, ticks) => ticks.map(tick => {
            const idx = Math.round(tick)
            return idx >= 0 && idx < selectedChannels.length ? selectedChannels[idx] : ''
          })
        }
      ],
      series: [
        {},
        {
          paths: () => null, // No paths, we'll draw the heatmap manually
          points: { show: false }
        }
      ],
      hooks: {
        drawClear: [
          u => {
            const ctx = u.ctx
            // Calculate the plot area
            const plotLeft = u.bbox.left
            const plotTop = u.bbox.top
            const plotWidth = u.bbox.width
            const plotHeight = u.bbox.height

            // Draw the heatmap image
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(img, plotLeft, plotTop, plotWidth, plotHeight)
            }
            img.src = dataURL
          }
        ]
      }
    }

    uplotHeatmapRef.current = new uPlot(opts, plotData, heatmapRef.current)

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (uplotHeatmapRef.current && heatmapRef.current) {
        uplotHeatmapRef.current.setSize({
          width: heatmapRef.current.clientWidth,
          height: Math.max(300, selectedChannels.length * 30 + 100)
        })
      }
    })

    resizeObserver.observe(heatmapRef.current)

    return () => {
      resizeObserver.disconnect()
      if (uplotHeatmapRef.current) {
        uplotHeatmapRef.current.destroy()
        uplotHeatmapRef.current = null
      }
    }
  }, [heatmapData, selectedChannels, result.results.scales, colorRange, colorScheme])

  const renderLinePlot = useCallback(() => {
    if (!linePlotRef.current || !result.results.dda_matrix) return

    // Clean up existing plot
    if (uplotLinePlotRef.current) {
      uplotLinePlotRef.current.destroy()
      uplotLinePlotRef.current = null
    }

    // Prepare data for line plot
    const scales = result.results.scales
    const data: uPlot.AlignedData = [scales]

    // Add DDA matrix data for selected channels
    selectedChannels.forEach(channel => {
      if (result.results.dda_matrix[channel]) {
        data.push(result.results.dda_matrix[channel])
      }
    })

    // Create series configuration
    const series: uPlot.Series[] = [
      {}, // x-axis
      ...selectedChannels.map((channel, index) => ({
        label: `${channel} (α=${result.results.exponents[channel]?.toFixed(3) || 'N/A'})`,
        stroke: getChannelColor(index),
        width: 2,
        points: { show: false }
      }))
    ]

    const opts: uPlot.Options = {
      width: linePlotRef.current.clientWidth,
      height: 400,
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

    uplotLinePlotRef.current = new uPlot(opts, data, linePlotRef.current)

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (uplotLinePlotRef.current && linePlotRef.current) {
        uplotLinePlotRef.current.setSize({
          width: linePlotRef.current.clientWidth,
          height: 400
        })
      }
    })

    resizeObserver.observe(linePlotRef.current)

    return () => {
      resizeObserver.disconnect()
      if (uplotLinePlotRef.current) {
        uplotLinePlotRef.current.destroy()
        uplotLinePlotRef.current = null
      }
    }
  }, [result, selectedChannels])

  const getChannelColor = (index: number): string => {
    const colors = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
      '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1'
    ]
    return colors[index % colors.length]
  }

  const handleChannelToggle = (channel: string) => {
    setSelectedChannels(prev => 
      prev.includes(channel)
        ? prev.filter(ch => ch !== channel)
        : [...prev, channel]
    )
  }

  const handlePopOut = useCallback(async () => {
    const ddaResultsData = {
      result
    }

    try {
      const windowId = await createWindow('dda-results', result.id, ddaResultsData)
      console.log('Created DDA results popout window:', windowId)
    } catch (error) {
      console.error('Failed to create popout window:', error)
    }
  }, [result, createWindow])

  const exportPlot = (format: 'png' | 'svg') => {
    // Implementation would depend on which plot is active
    console.log(`Exporting ${viewMode} as ${format}`)
  }

  // Re-render plots when dependencies change
  useEffect(() => {
    if (viewMode === 'heatmap' || viewMode === 'both') {
      renderHeatmap()
    }
  }, [renderHeatmap, viewMode])

  useEffect(() => {
    if (viewMode === 'lineplot' || viewMode === 'both') {
      renderLinePlot()
    }
  }, [renderLinePlot, viewMode])

  // Update popout windows when DDA results change
  useEffect(() => {
    const ddaResultsData = {
      result
    }
    
    broadcastToType('dda-results', 'data-update', ddaResultsData).catch(console.error)
  }, [result, broadcastToType])

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Controls */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">DDA Results Visualization</CardTitle>
              <CardDescription>
                Analysis from {new Date(result.created_at).toLocaleDateString()} • {result.channels.length} channels
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={() => exportPlot('png')}>
                <Download className="h-4 w-4 mr-2" />
                Export PNG
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportPlot('svg')}>
                <Download className="h-4 w-4 mr-2" />
                Export SVG
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePopOut}
                title="Pop out to separate window"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Pop Out
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            {/* View Mode */}
            <div className="flex items-center space-x-2">
              <Label className="text-sm">View:</Label>
              <Select value={viewMode} onValueChange={(value: ViewMode) => setViewMode(value)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">
                    <div className="flex items-center">
                      <Eye className="h-4 w-4 mr-2" />
                      Both
                    </div>
                  </SelectItem>
                  <SelectItem value="heatmap">
                    <div className="flex items-center">
                      <Grid3x3 className="h-4 w-4 mr-2" />
                      Heatmap
                    </div>
                  </SelectItem>
                  <SelectItem value="lineplot">
                    <div className="flex items-center">
                      <TrendingUp className="h-4 w-4 mr-2" />
                      Line Plot
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Color Scheme (for heatmap) */}
            {(viewMode === 'heatmap' || viewMode === 'both') && (
              <div className="flex items-center space-x-2">
                <Label className="text-sm">Colors:</Label>
                <Select value={colorScheme} onValueChange={(value: ColorScheme) => setColorScheme(value)}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viridis">Viridis</SelectItem>
                    <SelectItem value="plasma">Plasma</SelectItem>
                    <SelectItem value="inferno">Inferno</SelectItem>
                    <SelectItem value="jet">Jet</SelectItem>
                    <SelectItem value="cool">Cool</SelectItem>
                    <SelectItem value="hot">Hot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Reset button */}
            <Button variant="outline" size="sm" onClick={() => {
              setSelectedChannels(result.channels)
              setColorRange([0, 1])
              setAutoScale(true)
            }}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>

          {/* Channel Selection */}
          <div>
            <Label className="text-sm mb-2 block">
              Channels ({selectedChannels.length} of {result.channels.length} selected)
            </Label>
            <div className="flex flex-wrap gap-2 max-h-20 overflow-y-auto">
              {result.channels.map(channel => (
                <Badge
                  key={channel}
                  variant={selectedChannels.includes(channel) ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => handleChannelToggle(channel)}
                >
                  {channel} ({result.results.exponents[channel]?.toFixed(3) || 'N/A'})
                </Badge>
              ))}
            </div>
          </div>

          {/* Color Range Control (for heatmap) */}
          {(viewMode === 'heatmap' || viewMode === 'both') && (
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Label className="text-sm">Min:</Label>
                <input
                  type="number"
                  value={colorRange[0].toFixed(2)}
                  onChange={(e) => setColorRange([parseFloat(e.target.value), colorRange[1]])}
                  disabled={autoScale}
                  className="w-20 px-2 py-1 text-sm border rounded"
                  step="0.1"
                />
              </div>
              <div className="flex items-center space-x-2">
                <Label className="text-sm">Max:</Label>
                <input
                  type="number"
                  value={colorRange[1].toFixed(2)}
                  onChange={(e) => setColorRange([colorRange[0], parseFloat(e.target.value)])}
                  disabled={autoScale}
                  className="w-20 px-2 py-1 text-sm border rounded"
                  step="0.1"
                />
              </div>
              <label className="flex items-center space-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoScale}
                  onChange={(e) => setAutoScale(e.target.checked)}
                />
                <span>Auto Scale</span>
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Visualization Area */}
      <div className="flex-1 flex flex-col space-y-4">
        {/* Heatmap */}
        {(viewMode === 'heatmap' || viewMode === 'both') && (
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">DDA Matrix Heatmap</CardTitle>
              <CardDescription>
                Log-transformed DDA matrix values across time points and channels
              </CardDescription>
            </CardHeader>
            <CardContent className="h-full">
              <div ref={heatmapRef} className="w-full h-full min-h-[300px]" />
            </CardContent>
          </Card>
        )}

        {/* Line Plot */}
        {(viewMode === 'lineplot' || viewMode === 'both') && (
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">DDA Time Series</CardTitle>
              <CardDescription>
                DDA output time series - one line per channel (each row of the DDA matrix)
              </CardDescription>
            </CardHeader>
            <CardContent className="h-full">
              <div ref={linePlotRef} className="w-full h-full min-h-[400px]" />
            </CardContent>
          </Card>
        )}
      </div>

    </div>
  )
}