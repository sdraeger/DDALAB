'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
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
  ExternalLink,
  Loader2
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
  const [selectedVariant, setSelectedVariant] = useState<number>(0)
  const [heatmapData, setHeatmapData] = useState<number[][]>([])
  const [colorRange, setColorRange] = useState<[number, number]>([0, 1])
  const [autoScale, setAutoScale] = useState(true)
  const [isProcessingData, setIsProcessingData] = useState(true)
  const [isRenderingHeatmap, setIsRenderingHeatmap] = useState(false)
  const [isRenderingLinePlot, setIsRenderingLinePlot] = useState(false)

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

  // Get available variants - memoized to prevent recreation
  const availableVariants = useMemo(() => {
    console.log('DDAResults - Getting available variants:', {
      hasVariants: !!result.results.variants,
      variantsLength: result.results.variants?.length,
      variants: result.results.variants?.map(v => ({ id: v.variant_id, name: v.variant_name }))
    });

    if (result.results.variants && result.results.variants.length > 0) {
      return result.results.variants
    }
    // Fallback to legacy format
    if (result.results.dda_matrix) {
      return [{
        variant_id: 'legacy',
        variant_name: 'Combined Results',
        dda_matrix: result.results.dda_matrix,
        exponents: result.results.exponents || {},
        quality_metrics: result.results.quality_metrics || {}
      }]
    }
    return []
  }, [result.results])

  const getCurrentVariantData = () => {
    const current = availableVariants[selectedVariant] || availableVariants[0]
    return current
  }

  // Generate heatmap data from dda_matrix
  useEffect(() => {
    const processData = async () => {
      setIsProcessingData(true)

      // Small delay to prevent UI blocking
      await new Promise(resolve => setTimeout(resolve, 50))

      const channels = selectedChannels
      const scales = result.results.scales
      const currentVariant = availableVariants[selectedVariant] || availableVariants[0]

      if (!currentVariant || !currentVariant.dda_matrix) {
        console.log('No variant data available for heatmap');
        setIsProcessingData(false)
        return
      }

      const dda_matrix = currentVariant.dda_matrix

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

      console.log(`Heatmap data for variant ${currentVariant.variant_id}:`, {
        channels: channels.length,
        dataRows: data.length,
        minVal,
        maxVal
      });

      setHeatmapData(data)

      if (autoScale) {
        setColorRange([minVal, maxVal])
      }

      setIsProcessingData(false)
    }

    // Use requestIdleCallback if available
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => processData())
    } else {
      processData()
    }
  }, [result, selectedChannels, selectedVariant, autoScale])

  const renderHeatmap = useCallback(() => {
    console.log('renderHeatmap called:', {
      hasRef: !!heatmapRef.current,
      heatmapDataLength: heatmapData.length,
      selectedChannelsLength: selectedChannels.length,
      resultScalesLength: result.results.scales?.length
    })

    if (!heatmapRef.current || heatmapData.length === 0) {
      console.log('Early return from renderHeatmap:', {
        hasRef: !!heatmapRef.current,
        heatmapDataLength: heatmapData.length
      })
      setIsRenderingHeatmap(false)
      return
    }

    setIsRenderingHeatmap(true)

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      try {
        console.log('Starting heatmap rendering process...')

        // Double-check ref is still available
        if (!heatmapRef.current) {
          console.log('Heatmap ref became null')
          setIsRenderingHeatmap(false)
          return
        }

        console.log('Cleaning up existing plot...')

        // Clean up existing plot
        if (uplotHeatmapRef.current) {
          uplotHeatmapRef.current.destroy()
          uplotHeatmapRef.current = null
        }

        const width = heatmapRef.current.clientWidth || 800 // Fallback width
        const height = Math.max(300, selectedChannels.length * 30 + 100)

      console.log('Canvas dimensions:', { width, height })

      // Prepare data for uPlot
      const plotData: uPlot.AlignedData = [
        result.results.scales,
        new Array(result.results.scales.length).fill(0) // Dummy data for positioning
      ]

      console.log('Heatmap plot data prepared:', {
        scalesLength: result.results.scales.length,
        channelsLength: selectedChannels.length,
        heatmapDataRows: heatmapData.length,
        heatmapDataCols: heatmapData[0]?.length || 0
      })

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
            paths: () => null,
            points: { show: false }
          }
        ],
        cursor: {
          lock: false,
          focus: {
            prox: 1e6,
          },
          drag: {
            x: true,
            y: false,
            uni: 50,
            dist: 10,
          }
        },
        hooks: {
          ready: [
            u => {
              console.log('Heatmap uPlot ready')
              // Force initial draw
              u.redraw()
            }
          ],
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
          ],
          draw: [
            u => {
              console.log('Heatmap draw hook called')
              const ctx = u.ctx
              const { left, top, width: plotWidth, height: plotHeight } = u.bbox

              // Check if we have valid dimensions
              if (plotWidth <= 0 || plotHeight <= 0) {
                console.warn('Invalid plot dimensions:', { plotWidth, plotHeight })
                return
              }

              // Save context state
              ctx.save()

              // Clip to plot area
              ctx.beginPath()
              ctx.rect(left, top, plotWidth, plotHeight)
              ctx.clip()

              const cellWidth = plotWidth / result.results.scales.length
              const cellHeight = plotHeight / selectedChannels.length

              console.log('Drawing heatmap cells:', {
                cellWidth,
                cellHeight,
                totalCells: result.results.scales.length * selectedChannels.length,
                colorRange,
                colorScheme
              })

              // Draw heatmap cells
              for (let y = 0; y < selectedChannels.length; y++) {
                for (let x = 0; x < result.results.scales.length; x++) {
                  const value = heatmapData[y]?.[x] || 0
                  const normalized = (value - colorRange[0]) / (colorRange[1] - colorRange[0])
                  const clamped = Math.max(0, Math.min(1, normalized))

                  const color = colorSchemes[colorScheme](clamped)

                  ctx.fillStyle = color
                  ctx.fillRect(
                    left + x * cellWidth,
                    top + y * cellHeight,
                    cellWidth + 1, // +1 to avoid gaps
                    cellHeight + 1
                  )
                }
              }

              // Restore context state
              ctx.restore()

              console.log('Heatmap drawing complete')
            }
          ]
        }
      }

      // Final check before creating plot
      if (!heatmapRef.current) {
        console.log('Heatmap ref became null before creating uPlot')
        setIsRenderingHeatmap(false)
        return
      }

      console.log('Creating uPlot with:', {
        optsWidth: opts.width,
        optsHeight: opts.height,
        plotDataLength: plotData.length,
        containerElement: heatmapRef.current
      })

      uplotHeatmapRef.current = new uPlot(opts, plotData, heatmapRef.current)

      console.log('uPlot created successfully for heatmap')

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        if (uplotHeatmapRef.current && heatmapRef.current) {
          const newWidth = heatmapRef.current.clientWidth || 800
          const newHeight = Math.max(300, selectedChannels.length * 30 + 100)
          console.log('Resizing heatmap:', { newWidth, newHeight })
          uplotHeatmapRef.current.setSize({
            width: newWidth,
            height: newHeight
          })
          // Force redraw after resize
          uplotHeatmapRef.current.redraw()
        }
      })

      if (heatmapRef.current) {
        resizeObserver.observe(heatmapRef.current)
      }

      // Clear loading state after a short delay to ensure initial draw is complete
      setTimeout(() => {
        setIsRenderingHeatmap(false)
      }, 100)

      return () => {
        resizeObserver.disconnect()
        if (uplotHeatmapRef.current) {
          uplotHeatmapRef.current.destroy()
          uplotHeatmapRef.current = null
        }
      }

      } catch (error) {
        console.error('Error rendering heatmap:', error)
        setIsRenderingHeatmap(false)
      }
    })
  }, [heatmapData, selectedChannels, result.results.scales, colorRange, colorScheme])

  const renderLinePlot = useCallback(() => {
    if (!linePlotRef.current) {
      setIsRenderingLinePlot(false)
      return
    }

    const currentVariant = availableVariants[selectedVariant] || availableVariants[0]

    if (!currentVariant || !currentVariant.dda_matrix) {
      console.log('No variant data available for line plot');
      setIsRenderingLinePlot(false)
      return
    }

    setIsRenderingLinePlot(true)

    try {
      // Clean up existing plot
      if (uplotLinePlotRef.current) {
        uplotLinePlotRef.current.destroy()
        uplotLinePlotRef.current = null
      }

      console.log(`Rendering line plot for variant ${currentVariant.variant_id}`);

      // Prepare data for line plot
      const scales = result.results.scales

      // Defensive check for scales data
      if (!scales || !Array.isArray(scales) || scales.length === 0) {
        console.error('Invalid scales data for line plot:', scales);
        console.log('Result structure:', result);
        setIsRenderingLinePlot(false)
        return
      }

      const data: uPlot.AlignedData = [scales]

      // Add DDA matrix data for selected channels
      selectedChannels.forEach(channel => {
        if (currentVariant.dda_matrix[channel]) {
          const channelData = currentVariant.dda_matrix[channel]
          if (Array.isArray(channelData) && channelData.length > 0) {
            data.push(channelData)
          } else {
            console.warn(`Invalid data for channel ${channel}:`, channelData)
          }
        }
      })

      // Check we have at least one data series besides x-axis
      if (data.length < 2) {
        console.error('No valid channel data for line plot');
        setIsRenderingLinePlot(false)
        return
      }

      // Create series configuration
      const series: uPlot.Series[] = [
        {}, // x-axis
        ...selectedChannels.map((channel, index) => ({
          label: `${channel}`,
          stroke: getChannelColor(index),
          width: 2,
          points: { show: false }
        }))
      ]

      // Check ref again before accessing clientWidth
      if (!linePlotRef.current) {
        console.warn('Line plot ref became null during rendering')
        return
      }

      const opts: uPlot.Options = {
        width: linePlotRef.current.clientWidth || 800, // Fallback width
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

      // Final check before creating plot
      if (!linePlotRef.current) {
        console.warn('Line plot ref became null before creating uPlot')
        return
      }

      uplotLinePlotRef.current = new uPlot(opts, data, linePlotRef.current)

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        if (uplotLinePlotRef.current && linePlotRef.current) {
          uplotLinePlotRef.current.setSize({
            width: linePlotRef.current.clientWidth || 800, // Fallback width
            height: 400
          })
        }
      })

      if (linePlotRef.current) {
        resizeObserver.observe(linePlotRef.current)
      }

      // Clear loading state after a short delay to ensure plot is rendered
      setTimeout(() => {
        setIsRenderingLinePlot(false)
      }, 100)

      return () => {
        resizeObserver.disconnect()
        if (uplotLinePlotRef.current) {
          uplotLinePlotRef.current.destroy()
          uplotLinePlotRef.current = null
        }
      }
    } catch (error) {
      console.error('Error rendering line plot:', error)
      setIsRenderingLinePlot(false)
    }
  }, [result, selectedChannels, selectedVariant, availableVariants])

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
    console.log('Heatmap render effect triggered:', {
      viewMode,
      shouldRender: viewMode === 'heatmap' || viewMode === 'both',
      heatmapDataLength: heatmapData.length,
      hasRef: !!heatmapRef.current,
      refDimensions: heatmapRef.current ? {
        width: heatmapRef.current.clientWidth,
        height: heatmapRef.current.clientHeight,
        offsetWidth: heatmapRef.current.offsetWidth,
        offsetHeight: heatmapRef.current.offsetHeight
      } : null
    })
    if ((viewMode === 'heatmap' || viewMode === 'both') && heatmapData.length > 0) {
      // Wait for DOM to be fully ready with multiple checks
      const attemptRender = (attempts = 0) => {
        if (heatmapRef.current && heatmapRef.current.clientWidth > 0) {
          console.log('DOM ready, rendering heatmap...')
          renderHeatmap()
        } else if (attempts < 10) {
          console.log(`DOM not ready, retrying... (attempt ${attempts + 1})`)
          setTimeout(() => attemptRender(attempts + 1), 100)
        } else {
          console.error('Failed to render heatmap: DOM element not ready after 10 attempts')
        }
      }
      attemptRender()
    }
  }, [renderHeatmap, viewMode, heatmapData])

  useEffect(() => {
    console.log('Line plot render effect triggered:', {
      viewMode,
      shouldRender: viewMode === 'lineplot' || viewMode === 'both',
      availableVariantsLength: availableVariants.length,
      hasRef: !!linePlotRef.current,
      refDimensions: linePlotRef.current ? {
        width: linePlotRef.current.clientWidth,
        height: linePlotRef.current.clientHeight,
        offsetWidth: linePlotRef.current.offsetWidth,
        offsetHeight: linePlotRef.current.offsetHeight
      } : null
    })
    if ((viewMode === 'lineplot' || viewMode === 'both') && availableVariants.length > 0) {
      // Wait for DOM to be fully ready with multiple checks
      const attemptRender = (attempts = 0) => {
        if (linePlotRef.current && linePlotRef.current.clientWidth > 0) {
          console.log('DOM ready, rendering line plot...')
          renderLinePlot()
        } else if (attempts < 10) {
          console.log(`Line plot DOM not ready, retrying... (attempt ${attempts + 1})`)
          setTimeout(() => attemptRender(attempts + 1), 100)
        } else {
          console.error('Failed to render line plot: DOM element not ready after 10 attempts')
        }
      }
      attemptRender()
    }
  }, [renderLinePlot, viewMode, availableVariants])

  // Update popout windows when DDA results change
  useEffect(() => {
    // Only broadcast if there are actually pop-out windows of this type
    // This prevents unnecessary work when no windows are listening
    const ddaResultsData = {
      result
    }

    // Fire and forget - don't block on broadcast
    broadcastToType('dda-results', 'data-update', ddaResultsData).catch(console.error)
  }, [result.id, broadcastToType]) // Only depend on result.id, not entire result object

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

            {/* Reset Zoom button */}
            <Button variant="outline" size="sm" onClick={() => {
              // Reset zoom for both plots
              if (uplotHeatmapRef.current) {
                uplotHeatmapRef.current.setScale('x', {
                  min: result.results.scales[0],
                  max: result.results.scales[result.results.scales.length - 1]
                })
              }
              if (uplotLinePlotRef.current) {
                uplotLinePlotRef.current.setScale('x', {
                  min: result.results.scales[0],
                  max: result.results.scales[result.results.scales.length - 1]
                })
              }
            }}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset Zoom
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
                  {channel}
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
      {availableVariants.length > 1 ? (
        <Tabs value={selectedVariant.toString()} onValueChange={(v) => setSelectedVariant(parseInt(v))} className="flex-1 flex flex-col">
          <TabsList>
            {availableVariants.map((variant, index) => (
              <TabsTrigger key={variant.variant_id} value={index.toString()}>
                {variant.variant_name}
              </TabsTrigger>
            ))}
          </TabsList>

          {availableVariants.map((variant, index) => (
            <TabsContent key={variant.variant_id} value={index.toString()} className="flex-1 flex flex-col space-y-4">
              {selectedVariant === index && (
                <>
                  {/* Heatmap */}
                  {(viewMode === 'heatmap' || viewMode === 'both') && (
                    <Card className="flex-1">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          DDA Matrix Heatmap - {variant.variant_name}
                        </CardTitle>
                        <CardDescription>
                          Log-transformed DDA matrix values across time points and channels
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="h-full">
                        <div className="w-full h-full min-h-[300px] relative">
                          {(isProcessingData || isRenderingHeatmap) && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                              <div className="flex flex-col items-center space-y-2">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">
                                  {isProcessingData ? 'Processing DDA data...' : 'Rendering heatmap...'}
                                </p>
                              </div>
                            </div>
                          )}
                          <div ref={heatmapRef} className="w-full h-full" />
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Line Plot */}
                  {(viewMode === 'lineplot' || viewMode === 'both') && (
                    <Card className="flex-1">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          DDA Time Series - {variant.variant_name}
                        </CardTitle>
                        <CardDescription>
                          DDA output time series - one line per channel (each row of the DDA matrix)
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="h-full">
                        <div className="w-full h-full min-h-[400px] relative">
                          {(isProcessingData || isRenderingLinePlot) && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                              <div className="flex flex-col items-center space-y-2">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">
                                  {isProcessingData ? 'Processing DDA data...' : 'Rendering line plot...'}
                                </p>
                              </div>
                            </div>
                          )}
                          <div ref={linePlotRef} className="w-full h-full" />
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className="flex-1 flex flex-col space-y-4">
          {/* Single variant view */}
          {/* Heatmap */}
          {(viewMode === 'heatmap' || viewMode === 'both') && (
            <Card className="flex-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  DDA Matrix Heatmap - {getCurrentVariantData()?.variant_name || 'Unknown'}
                </CardTitle>
                <CardDescription>
                  Log-transformed DDA matrix values across time points and channels
                </CardDescription>
              </CardHeader>
              <CardContent className="h-full">
                <div className="w-full h-full min-h-[300px] relative">
                  {(isProcessingData || isRenderingHeatmap) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                      <div className="flex flex-col items-center space-y-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">
                          {isProcessingData ? 'Processing DDA data...' : 'Rendering heatmap...'}
                        </p>
                      </div>
                    </div>
                  )}
                  <div ref={heatmapRef} className="w-full h-full" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Line Plot */}
          {(viewMode === 'lineplot' || viewMode === 'both') && (
            <Card className="flex-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  DDA Time Series - {getCurrentVariantData()?.variant_name || 'Unknown'}
                </CardTitle>
                <CardDescription>
                  DDA output time series - one line per channel (each row of the DDA matrix)
                </CardDescription>
              </CardHeader>
              <CardContent className="h-full">
                <div className="w-full h-full min-h-[400px] relative">
                  {(isProcessingData || isRenderingLinePlot) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                      <div className="flex flex-col items-center space-y-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">
                          {isProcessingData ? 'Processing DDA data...' : 'Rendering line plot...'}
                        </p>
                      </div>
                    </div>
                  )}
                  <div ref={linePlotRef} className="w-full h-full" />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

    </div>
  )
}
