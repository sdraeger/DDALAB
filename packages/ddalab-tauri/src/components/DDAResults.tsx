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
import { ChannelSelector } from '@/components/ChannelSelector'
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
import { useDDAAnnotations } from '@/hooks/useAnnotations'
import { AnnotationContextMenu } from '@/components/annotations/AnnotationContextMenu'
import { AnnotationMarker } from '@/components/annotations/AnnotationMarker'
import { PlotAnnotation, PlotInfo } from '@/types/annotations'

interface DDAResultsProps {
  result: DDAResult
}

type ColorScheme = 'viridis' | 'plasma' | 'inferno' | 'jet' | 'cool' | 'hot'
type ViewMode = 'heatmap' | 'lineplot' | 'both'

export function DDAResults({ result }: DDAResultsProps) {
  console.log('[DDARESULTS] Component rendered with result:', {
    id: result.id,
    hasResults: !!result.results,
    hasScales: !!result.results?.scales,
    scalesLength: result.results?.scales?.length,
    variantsCount: result.results?.variants?.length,
    firstVariantId: result.results?.variants?.[0]?.variant_id,
    hasMatrixData: !!result.results?.variants?.[0]?.dda_matrix,
    matrixChannels: result.results?.variants?.[0]?.dda_matrix
      ? Object.keys(result.results.variants[0].dda_matrix).length
      : 0,
    matrixFirstChannelLength: result.results?.variants?.[0]?.dda_matrix
      ? Object.values(result.results.variants[0].dda_matrix)[0]?.length
      : 0
  })

  const { createWindow, broadcastToType } = usePopoutWindows()
  const fileManager = useAppStore(state => state.fileManager)
  const heatmapRef = useRef<HTMLDivElement>(null)
  const linePlotRef = useRef<HTMLDivElement>(null)
  const uplotHeatmapRef = useRef<uPlot | null>(null)
  const uplotLinePlotRef = useRef<uPlot | null>(null)
  const lastRenderedResultId = useRef<string | null>(null)
  const renderTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>('both')
  const [colorScheme, setColorScheme] = useState<ColorScheme>('viridis')

  // Get available channels from the actual dda_matrix (source of truth)
  const availableChannels = useMemo(() => {
    const firstVariant = result.results.variants[0]
    if (firstVariant && firstVariant.dda_matrix) {
      return Object.keys(firstVariant.dda_matrix)
    }
    return result.channels
  }, [result.results.variants, result.channels])

  // Initialize selectedChannels from actual dda_matrix keys, not result.channels
  // This ensures we only select channels that actually have data
  const [selectedChannels, setSelectedChannels] = useState<string[]>(() => {
    const firstVariant = result.results.variants[0]
    if (firstVariant && firstVariant.dda_matrix) {
      const channels = Object.keys(firstVariant.dda_matrix)
      console.log('[DDARESULTS] Initializing selectedChannels:', {
        resultChannels: result.channels,
        availableChannels: channels,
        willUse: channels
      })
      // Use ALL channels from dda_matrix since those are the ones that were actually analyzed
      // result.channels might be outdated or incomplete from persistence
      return channels
    }
    console.log('[DDARESULTS] No dda_matrix, using result.channels:', result.channels)
    return result.channels
  })

  const [selectedVariant, setSelectedVariant] = useState<number>(0)
  const [heatmapData, setHeatmapData] = useState<number[][]>([])
  const [colorRange, setColorRange] = useState<[number, number]>([0, 1])
  const [autoScale, setAutoScale] = useState(true)
  const [isProcessingData, setIsProcessingData] = useState(true)
  const [isRenderingHeatmap, setIsRenderingHeatmap] = useState(false)
  const [isRenderingLinePlot, setIsRenderingLinePlot] = useState(false)

  // Update selected channels when variant changes
  useEffect(() => {
    const currentVariant = result.results.variants[selectedVariant]
    if (currentVariant && currentVariant.dda_matrix) {
      const availableChannels = Object.keys(currentVariant.dda_matrix)
      console.log('[DDARESULTS] Variant changed, updating selectedChannels:', {
        variantId: currentVariant.variant_id,
        availableChannels
      })
      // Only update if channels actually changed to prevent excessive re-renders
      setSelectedChannels(prev => {
        if (JSON.stringify(prev) === JSON.stringify(availableChannels)) {
          return prev  // Return same reference if content unchanged
        }
        return availableChannels
      })
    }
  }, [selectedVariant, result.id])

  // Annotation support for line plot
  const currentVariantId = result.results.variants[selectedVariant]?.variant_id || 'default'

  // Debug: Log the annotation key being used
  useEffect(() => {
    console.log('[ANNOTATION] Using key for line plot:', {
      resultId: result.id,
      variantId: currentVariantId,
      plotType: 'line',
      fullKey: `${result.id}_${currentVariantId}_line`
    })
  }, [result.id, currentVariantId])

  const sampleRate = fileManager.selectedFile?.sample_rate || 256

  const linePlotAnnotations = useDDAAnnotations({
    resultId: result.id,
    variantId: currentVariantId,
    plotType: 'line',
    ddaResult: result,
    sampleRate
  })

  // Annotation support for heatmap
  const heatmapAnnotations = useDDAAnnotations({
    resultId: result.id,
    variantId: currentVariantId,
    plotType: 'heatmap',
    ddaResult: result,
    sampleRate
  })

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
    // Removed verbose logging

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

  // Generate available plots for annotation visibility
  const availablePlots = useMemo<PlotInfo[]>(() => {
    const plots: PlotInfo[] = [
      { id: 'timeseries', label: 'Data Visualization' }
    ]

    // Add all DDA variant plots
    availableVariants.forEach(variant => {
      plots.push({
        id: `dda:${variant.variant_id}:heatmap`,
        label: `${variant.variant_name} - Heatmap`
      })
      plots.push({
        id: `dda:${variant.variant_id}:lineplot`,
        label: `${variant.variant_name} - Line Plot`
      })
    })

    return plots
  }, [availableVariants])

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
        // No variant data available
        setIsProcessingData(false)
        return
      }

      const dda_matrix = currentVariant.dda_matrix

      const data: number[][] = []
      const allValues: number[] = []

      // Create 2D array: [channel][time_point] = dda_matrix value
      channels.forEach(channel => {
        if (dda_matrix[channel]) {
          const channelData = dda_matrix[channel].map(val => {
            // Log transform for better visualization
            const logVal = Math.log10(Math.max(0.001, val))
            allValues.push(logVal)
            return logVal
          })
          data.push(channelData)
        }
      })

      // Calculate median and standard deviation for colorscale limits
      let minVal = Infinity
      let maxVal = -Infinity

      if (allValues.length > 0) {
        // Calculate median
        const sortedValues = [...allValues].sort((a, b) => a - b)
        const median = sortedValues.length % 2 === 0
          ? (sortedValues[sortedValues.length / 2 - 1] + sortedValues[sortedValues.length / 2]) / 2
          : sortedValues[Math.floor(sortedValues.length / 2)]

        // Calculate standard deviation
        const mean = allValues.reduce((sum, val) => sum + val, 0) / allValues.length
        const variance = allValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / allValues.length
        const std = Math.sqrt(variance)

        // Set colorscale limits to median ± 3 * std
        minVal = median - 3 * std
        maxVal = median + 3 * std

        // Removed verbose logging
      }

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
    if (!heatmapRef.current || heatmapData.length === 0) {
      setIsRenderingHeatmap(false)
      return
    }

    // Don't render if still using default colorRange [0, 1] - wait for data processing
    if (autoScale && colorRange[0] === 0 && colorRange[1] === 1) {
      return
    }

    // Set loading state immediately for instant feedback
    setIsRenderingHeatmap(true)

    // Clean up existing plot
    if (uplotHeatmapRef.current) {
      uplotHeatmapRef.current.destroy()
      uplotHeatmapRef.current = null
    }

    // Clear the container to remove any stale DOM elements
    if (heatmapRef.current) {
      heatmapRef.current.innerHTML = ''
    }

    // Defer heavy rendering using requestIdleCallback for non-blocking execution
    // This allows both heatmap and line plot to render in parallel without blocking UI
    const deferredRender = () => {
      try {
        // Double-check ref is still available
        if (!heatmapRef.current) {
          return
        }

        const width = heatmapRef.current.clientWidth || 800
        const height = Math.max(300, selectedChannels.length * 30 + 100)

        // Prepare data for uPlot
        const plotData: uPlot.AlignedData = [
          result.results.scales,
          new Array(result.results.scales.length).fill(0)
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
              splits: (u, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace) => {
                // Generate splits at integer positions (0, 1, 2, ..., n-1) for channel centers
                const splits = []
                for (let i = 0; i < selectedChannels.length; i++) {
                  splits.push(i)
                }
                return splits
              },
              values: (u, ticks) => ticks.map(tick => {
                // Ticks are already at integer positions from splits
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

                if (u.select.width >= 10) {
                  u.setScale('x', {
                    min: u.posToVal(min, 'x'),
                    max: u.posToVal(max, 'x')
                  })
                }

                u.setSelect({left: 0, top: 0, width: 0, height: 0}, false)
              }
            ],
            draw: [
              u => {
                const ctx = u.ctx
                const { left, top, width: plotWidth, height: plotHeight } = u.bbox

                if (plotWidth <= 0 || plotHeight <= 0) return

                ctx.save()
                ctx.beginPath()
                ctx.rect(left, top, plotWidth, plotHeight)
                ctx.clip()

                const cellWidth = plotWidth / result.results.scales.length
                const cellHeight = plotHeight / selectedChannels.length

                for (let y = 0; y < selectedChannels.length; y++) {
                  for (let x = 0; x < result.results.scales.length; x++) {
                    const value = heatmapData[y]?.[x] || 0
                    const normalized = (value - colorRange[0]) / (colorRange[1] - colorRange[0])
                    const clamped = Math.max(0, Math.min(1, normalized))

                    ctx.fillStyle = colorSchemes[colorScheme](clamped)
                    ctx.fillRect(
                      left + x * cellWidth,
                      top + y * cellHeight,
                      cellWidth + 1,
                      cellHeight + 1
                    )
                  }
                }

                ctx.restore()
              }
            ]
          }
        }

        if (!heatmapRef.current) return

        uplotHeatmapRef.current = new uPlot(opts, plotData, heatmapRef.current)

        const resizeObserver = new ResizeObserver(() => {
          if (uplotHeatmapRef.current && heatmapRef.current) {
            const newWidth = heatmapRef.current.clientWidth || 800
            const newHeight = Math.max(300, selectedChannels.length * 30 + 100)
            uplotHeatmapRef.current.setSize({ width: newWidth, height: newHeight })
            uplotHeatmapRef.current.redraw()
          }
        })

        if (heatmapRef.current) {
          resizeObserver.observe(heatmapRef.current)
        }

        // Clear loading state after plot is created
        setTimeout(() => {
          setIsRenderingHeatmap(false)
        }, 50)

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
    }

    // Schedule deferred render - use requestIdleCallback for parallel non-blocking execution
    if ('requestIdleCallback' in window) {
      requestIdleCallback(deferredRender, { timeout: 100 })
    } else {
      // Fallback to requestAnimationFrame for browsers without requestIdleCallback
      requestAnimationFrame(deferredRender)
    }
  }, [heatmapData, selectedChannels, result.results.scales.length, colorRange[0], colorRange[1], colorScheme])

  const renderLinePlot = useCallback(() => {
    if (!linePlotRef.current) {
      setIsRenderingLinePlot(false)
      return
    }

    const currentVariant = availableVariants[selectedVariant] || availableVariants[0]

    if (!currentVariant || !currentVariant.dda_matrix) {
      // No variant data available
      setIsRenderingLinePlot(false)
      return
    }

    // Set loading state immediately for instant feedback
    setIsRenderingLinePlot(true)

    // Defer heavy rendering to prevent blocking UI during tab switch
    // Use requestIdleCallback if available, otherwise setTimeout
    const deferredRender = () => {
      try {
      // Clean up existing plot
      if (uplotLinePlotRef.current) {
        uplotLinePlotRef.current.destroy()
        uplotLinePlotRef.current = null
      }

      // Clear the container to remove any stale DOM elements
      if (linePlotRef.current) {
        linePlotRef.current.innerHTML = ''
      }

      // Removed verbose logging

      // Prepare data for line plot
      const scales = result.results.scales

      // Defensive check for scales data
      if (!scales || !Array.isArray(scales) || scales.length === 0) {
        console.error('[LINE PLOT] Invalid scales data for line plot:', scales);
        console.error('[LINE PLOT] Result structure:', {
          hasResults: !!result.results,
          resultsKeys: result.results ? Object.keys(result.results) : [],
          scales: result.results?.scales,
          variants: result.results?.variants?.length || 0
        });
        setIsRenderingLinePlot(false)
        return
      }

      console.log('[LINE PLOT] Rendering with', scales.length, 'time points for', selectedChannels.length, 'channels')
      console.log('[LINE PLOT] Current variant data structure:', {
        variantId: currentVariant.variant_id,
        hasMatrix: !!currentVariant.dda_matrix,
        matrixChannels: currentVariant.dda_matrix ? Object.keys(currentVariant.dda_matrix) : [],
        selectedChannels,
        scalesLength: scales.length
      })

      const data: uPlot.AlignedData = [scales]
      const validChannels: string[] = []

      // Add DDA matrix data for selected channels - only include channels with valid data
      for (const channel of selectedChannels) {
        const channelData = currentVariant.dda_matrix[channel]
        console.log('[LINE PLOT] Processing channel:', {
          channel,
          hasData: !!channelData,
          isArray: Array.isArray(channelData),
          dataLength: channelData?.length,
          firstFewValues: channelData?.slice(0, 5)
        })
        if (channelData && Array.isArray(channelData) && channelData.length > 0) {
          data.push(channelData)
          validChannels.push(channel)
        }
      }

      // Check we have at least one data series besides x-axis
      if (data.length < 2 || validChannels.length === 0) {
        console.error('[LINE PLOT] No valid channel data for line plot', {
          dataLength: data.length,
          validChannelsCount: validChannels.length
        })
        setIsRenderingLinePlot(false)
        return
      }

      console.log('[LINE PLOT] Prepared data for uPlot:', {
        seriesCount: data.length,
        validChannels,
        scalesLength: data[0].length,
        firstChannelDataLength: data[1]?.length,
        firstChannelFirstValues: Array.isArray(data[1]) ? data[1].slice(0, 5) : 'not an array'
      })

      // Create series configuration - IMPORTANT: must match data array length
      const series: uPlot.Series[] = [
        {}, // x-axis
        ...validChannels.map((channel, index) => ({
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

      console.log('[LINE PLOT] Successfully created uPlot:', {
        channelCount: validChannels.length,
        channels: validChannels,
        uplotInstance: !!uplotLinePlotRef.current,
        width: opts.width,
        height: opts.height,
        dataArrayLength: data.length,
        seriesArrayLength: series.length,
        plotDataFirstChannel: uplotLinePlotRef.current?.data?.[1]?.slice(0, 5)
      })

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
    }

    // Schedule deferred render - use requestIdleCallback for better performance
    if ('requestIdleCallback' in window) {
      requestIdleCallback(deferredRender, { timeout: 100 })
    } else {
      setTimeout(deferredRender, 0)
    }
  }, [result.id, selectedChannels, selectedVariant, availableVariants.length, result.results.scales.length])

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
      result,
      uiState: {
        selectedVariant,
        colorScheme,
        viewMode,
        selectedChannels,
        colorRange,
        autoScale
      }
    }

    try {
      const windowId = await createWindow('dda-results', result.id, ddaResultsData)
      console.log('Created DDA results popout window:', windowId)
    } catch (error) {
      console.error('Failed to create popout window:', error)
    }
  }, [result, selectedVariant, colorScheme, viewMode, selectedChannels, colorRange, autoScale, createWindow])

  const exportPlot = (format: 'png' | 'svg') => {
    // Implementation would depend on which plot is active
    console.log(`Exporting ${viewMode} as ${format}`)
  }

  // Re-render plots when dependencies change - using IntersectionObserver to detect visibility
  useEffect(() => {
    if ((viewMode === 'heatmap' || viewMode === 'both') && heatmapData.length > 0 && heatmapRef.current) {
      // Skip if using default colorRange and autoScale is on (wait for data processing)
      if (autoScale && colorRange[0] === 0 && colorRange[1] === 1) {
        return
      }

      let hasRendered = false

      // Use IntersectionObserver to detect when the element becomes visible
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.target === heatmapRef.current && !hasRendered) {
              // Element is visible, render the heatmap
              hasRendered = true
              renderHeatmap()
              // Disconnect after first render to prevent re-triggering
              observer.disconnect()
            }
          })
        },
        { threshold: 0.1 } // Trigger when at least 10% is visible
      )

      observer.observe(heatmapRef.current)

      return () => observer.disconnect()
    }
  }, [renderHeatmap, viewMode, heatmapData, colorRange, autoScale])

  useEffect(() => {
    const renderKey = `${result.id}_${selectedVariant}`

    console.log('[LINE PLOT] useEffect triggered:', {
      viewMode,
      availableVariantsCount: availableVariants.length,
      hasLinePlotRef: !!linePlotRef.current,
      selectedVariant,
      resultId: result.id,
      renderKey,
      lastRendered: lastRenderedResultId.current,
      hasTimer: !!renderTimerRef.current
    })

    // Skip if we've already rendered this exact result+variant combination
    if (lastRenderedResultId.current === renderKey) {
      console.log('[LINE PLOT] Already rendered, skipping')
      return
    }

    if ((viewMode === 'lineplot' || viewMode === 'both') && availableVariants.length > 0 && linePlotRef.current) {
      // Clear any existing timer for a different result
      if (renderTimerRef.current) {
        console.log('[LINE PLOT] Clearing previous timer')
        clearTimeout(renderTimerRef.current)
        renderTimerRef.current = null
      }

      console.log('[LINE PLOT] Scheduling render for:', renderKey)

      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        if (linePlotRef.current) {
          console.log('[LINE PLOT] Timer fired, calling renderLinePlot() for:', renderKey)
          renderLinePlot()
          // Mark as rendered ONLY after successful render
          lastRenderedResultId.current = renderKey
          renderTimerRef.current = null
          console.log('[LINE PLOT] Marked as rendered:', renderKey)
        } else {
          console.warn('[LINE PLOT] linePlotRef became null before timer fired')
          renderTimerRef.current = null
        }
      }, 50)

      renderTimerRef.current = timer

      return () => {
        console.log('[LINE PLOT] Cleanup called for:', renderKey)
        if (renderTimerRef.current === timer) {
          console.log('[LINE PLOT] Clearing timer')
          clearTimeout(timer)
          renderTimerRef.current = null
        }
      }
    }
  }, [viewMode, selectedVariant, result.id, renderLinePlot])

  // Update popout windows when DDA results change
  useEffect(() => {
    // Only broadcast if there are actually pop-out windows of this type
    // This prevents unnecessary work when no windows are listening
    const ddaResultsData = {
      result,
      uiState: {
        selectedVariant,
        colorScheme,
        viewMode,
        selectedChannels,
        colorRange,
        autoScale
      }
    }

    // Fire and forget - don't block on broadcast
    broadcastToType('dda-results', 'data-update', ddaResultsData).catch(console.error)
  }, [result.id, selectedVariant, colorScheme, viewMode, selectedChannels, colorRange, autoScale, broadcastToType])

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Controls */}
      <Card className="flex-shrink-0">
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
          <ChannelSelector
            channels={availableChannels}
            selectedChannels={selectedChannels}
            onSelectionChange={setSelectedChannels}
            label="Channels"
            description="Select channels to display in results"
            variant="compact"
            maxHeight="max-h-32"
          />

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
        <Tabs value={selectedVariant.toString()} onValueChange={(v) => setSelectedVariant(parseInt(v))} className="mt-4 flex-1 flex flex-col gap-0">
          <TabsList className="mb-0" style={{ marginBottom: 0 }}>
            {availableVariants.map((variant, index) => (
              <TabsTrigger key={variant.variant_id} value={index.toString()}>
                {variant.variant_name}
              </TabsTrigger>
            ))}
          </TabsList>

          {availableVariants.map((variant, index) => (
            <TabsContent key={variant.variant_id} value={index.toString()} className="flex flex-col" style={{ marginTop: 0, paddingTop: 0 }}>
              <div className="space-y-4">
                {/* Heatmap */}
                {(viewMode === 'heatmap' || viewMode === 'both') && (
                      <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          DDA Matrix Heatmap - {variant.variant_name}
                        </CardTitle>
                        <CardDescription>
                          Log-transformed DDA matrix values across time points and channels
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="w-full min-h-[300px] relative">
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
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          DDA Time Series - {variant.variant_name}
                        </CardTitle>
                        <CardDescription>
                          DDA output time series - one line per channel (each row of the DDA matrix)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="w-full h-[400px] relative">
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
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className="flex flex-col space-y-4">
          {/* Single variant view */}
          {/* Heatmap */}
          {(viewMode === 'heatmap' || viewMode === 'both') && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  DDA Matrix Heatmap - {getCurrentVariantData()?.variant_name || 'Unknown'}
                </CardTitle>
                <CardDescription>
                  Log-transformed DDA matrix values across time points and channels
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="w-full min-h-[300px] relative"
                  onContextMenu={(e) => {
                    console.log('[ANNOTATION] Right-click detected on heatmap', {
                      hasPlot: !!uplotHeatmapRef.current,
                      hasScales: !!result.results.scales,
                      scalesLength: result.results.scales?.length
                    })

                    e.preventDefault()
                    e.stopPropagation()

                    if (!uplotHeatmapRef.current) {
                      console.warn('[ANNOTATION] Heatmap ref not available yet')
                      return
                    }

                    const rect = e.currentTarget.getBoundingClientRect()
                    const plotX = e.clientX - rect.left

                    // Use uPlot's posToVal to convert pixel position to scale value
                    const scaleValue = uplotHeatmapRef.current.posToVal(plotX, 'x')

                    console.log('[ANNOTATION] Opening heatmap context menu at scale:', scaleValue)
                    heatmapAnnotations.openContextMenu(e.clientX, e.clientY, scaleValue)
                  }}
                >
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

                  {/* Annotation overlay */}
                  {uplotHeatmapRef.current && heatmapAnnotations.annotations.length > 0 && (
                    <svg
                      className="absolute top-0 left-0"
                      style={{
                        width: heatmapRef.current?.clientWidth || 0,
                        height: heatmapRef.current?.clientHeight || 0,
                        pointerEvents: 'none'
                      }}
                    >
                      {heatmapAnnotations.annotations.map((annotation) => {
                        const scales = result.results.scales
                        if (!scales || scales.length === 0) return null
                        if (!uplotHeatmapRef.current) return null

                        // Get uPlot bbox for accurate dimensions and offsets
                        const bbox = uplotHeatmapRef.current.bbox
                        if (!bbox) return null

                        // Use uPlot's valToPos to convert scale value to pixel position (relative to canvas)
                        const canvasX = uplotHeatmapRef.current.valToPos(annotation.position, 'x')
                        if (canvasX === null || canvasX === undefined) return null

                        // Add bbox offsets since SVG is positioned at (0,0) but canvas starts at (bbox.left, bbox.top)
                        const xPosition = canvasX + bbox.left
                        const yOffset = bbox.top
                        const plotHeight = bbox.height

                        return (
                          <AnnotationMarker
                            key={annotation.id}
                            annotation={annotation}
                            plotHeight={plotHeight}
                            xPosition={xPosition}
                            yOffset={yOffset}
                            onRightClick={(e, ann) => {
                              e.preventDefault()
                              heatmapAnnotations.openContextMenu(
                                e.clientX,
                                e.clientY,
                                ann.position,
                                ann
                              )
                            }}
                            onClick={(ann) => {
                              const rect = heatmapRef.current?.getBoundingClientRect()
                              if (rect) {
                                heatmapAnnotations.handleAnnotationClick(ann, rect.left + xPosition, rect.top + 50)
                              }
                            }}
                          />
                        )
                      })}
                    </svg>
                  )}
                </div>

                {/* Annotation context menu */}
                {heatmapAnnotations.contextMenu && (
                  <AnnotationContextMenu
                    x={heatmapAnnotations.contextMenu.x}
                    y={heatmapAnnotations.contextMenu.y}
                    plotPosition={heatmapAnnotations.contextMenu.plotPosition}
                    existingAnnotation={heatmapAnnotations.contextMenu.annotation}
                    onCreateAnnotation={heatmapAnnotations.handleCreateAnnotation}
                    onEditAnnotation={heatmapAnnotations.handleUpdateAnnotation}
                    onDeleteAnnotation={heatmapAnnotations.handleDeleteAnnotation}
                    onClose={heatmapAnnotations.closeContextMenu}
                    availablePlots={availablePlots}
                    currentPlotId={`dda:${getCurrentVariantData()?.variant_id}:heatmap`}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Line Plot */}
          {(viewMode === 'lineplot' || viewMode === 'both') && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  DDA Time Series - {getCurrentVariantData()?.variant_name || 'Unknown'}
                </CardTitle>
                <CardDescription>
                  DDA output time series - one line per channel (each row of the DDA matrix)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="w-full h-[400px] relative"
                  onContextMenu={(e) => {
                    console.log('[ANNOTATION] Right-click detected on line plot', {
                      hasPlot: !!uplotLinePlotRef.current,
                      hasScales: !!result.results.scales,
                      scalesLength: result.results.scales?.length
                    })

                    e.preventDefault()
                    e.stopPropagation()

                    if (!uplotLinePlotRef.current) {
                      console.warn('[ANNOTATION] Plot ref not available yet')
                      return
                    }

                    const rect = e.currentTarget.getBoundingClientRect()
                    const plotX = e.clientX - rect.left

                    // Use uPlot's posToVal to convert pixel position to scale value
                    const scaleValue = uplotLinePlotRef.current.posToVal(plotX, 'x')

                    console.log('[ANNOTATION] Opening line plot context menu at scale:', scaleValue)
                    linePlotAnnotations.openContextMenu(e.clientX, e.clientY, scaleValue)
                  }}
                >
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

                  {/* Annotation overlay */}
                  {uplotLinePlotRef.current && linePlotAnnotations.annotations.length > 0 && (
                    <svg
                      className="absolute top-0 left-0"
                      style={{
                        width: linePlotRef.current?.clientWidth || 0,
                        height: linePlotRef.current?.clientHeight || 0,
                        pointerEvents: 'none'
                      }}
                    >
                      {linePlotAnnotations.annotations.map((annotation) => {
                        const scales = result.results.scales
                        if (!scales || scales.length === 0) return null
                        if (!uplotLinePlotRef.current) return null

                        // Get uPlot bbox for accurate dimensions and offsets
                        const bbox = uplotLinePlotRef.current.bbox
                        if (!bbox) return null

                        // Use uPlot's valToPos to convert scale value to pixel position (relative to canvas)
                        const canvasX = uplotLinePlotRef.current.valToPos(annotation.position, 'x')
                        if (canvasX === null || canvasX === undefined) return null

                        // Add bbox offsets since SVG is positioned at (0,0) but canvas starts at (bbox.left, bbox.top)
                        const xPosition = canvasX + bbox.left
                        const yOffset = bbox.top
                        const plotHeight = bbox.height

                        return (
                          <AnnotationMarker
                            key={annotation.id}
                            annotation={annotation}
                            plotHeight={plotHeight}
                            xPosition={xPosition}
                            yOffset={yOffset}
                            onRightClick={(e, ann) => {
                              e.preventDefault()
                              linePlotAnnotations.openContextMenu(
                                e.clientX,
                                e.clientY,
                                ann.position,
                                ann
                              )
                            }}
                            onClick={(ann) => {
                              const rect = linePlotRef.current?.getBoundingClientRect()
                              if (rect) {
                                linePlotAnnotations.handleAnnotationClick(ann, rect.left + xPosition, rect.top + 50)
                              }
                            }}
                          />
                        )
                      })}
                    </svg>
                  )}
                </div>

                {/* Annotation context menu */}
                {linePlotAnnotations.contextMenu && (
                  <AnnotationContextMenu
                    x={linePlotAnnotations.contextMenu.x}
                    y={linePlotAnnotations.contextMenu.y}
                    plotPosition={linePlotAnnotations.contextMenu.plotPosition}
                    existingAnnotation={linePlotAnnotations.contextMenu.annotation}
                    onCreateAnnotation={linePlotAnnotations.handleCreateAnnotation}
                    onEditAnnotation={linePlotAnnotations.handleUpdateAnnotation}
                    onDeleteAnnotation={linePlotAnnotations.handleDeleteAnnotation}
                    onClose={linePlotAnnotations.closeContextMenu}
                    availablePlots={availablePlots}
                    currentPlotId={`dda:${getCurrentVariantData()?.variant_id}:lineplot`}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

    </div>
  )
}
