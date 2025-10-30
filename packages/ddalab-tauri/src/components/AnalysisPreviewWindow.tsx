'use client'

import { useEffect, useState, useRef } from 'react'
import { DDAResult } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { BarChart3, Download, X, Maximize2 } from 'lucide-react'
import uPlot from 'uplot'

interface AnalysisPreviewWindowProps {
  analysis: DDAResult
  onClose?: () => void
}

export function AnalysisPreviewWindow({ analysis, onClose }: AnalysisPreviewWindowProps) {
  const [heatmapPlot, setHeatmapPlot] = useState<uPlot | null>(null)
  const [linePlot, setLinePlot] = useState<uPlot | null>(null)
  const heatmapRef = useRef<HTMLDivElement | null>(null)
  const linePlotRef = useRef<HTMLDivElement | null>(null)
  const plotsInitialized = useRef(false)
  const [selectedVariant, setSelectedVariant] = useState<number>(0)

  // Helper functions to handle both new and legacy data formats
  const getAvailableVariants = () => {
    console.log('[PREVIEW] analysis.results:', analysis.results)
    console.log('[PREVIEW] analysis.results?.variants:', analysis.results?.variants)
    console.log('[PREVIEW] analysis.results?.dda_matrix:', analysis.results?.dda_matrix)

    if (analysis.results?.variants && analysis.results.variants.length > 0) {
      console.log('[PREVIEW] Using variants format, count:', analysis.results.variants.length)
      return analysis.results.variants
    }
    // Fallback to legacy format
    if (analysis.results?.dda_matrix) {
      console.log('[PREVIEW] Using legacy dda_matrix format')
      return [{
        variant_id: 'legacy',
        variant_name: 'Combined Results',
        dda_matrix: analysis.results.dda_matrix,
        exponents: analysis.results.exponents || {},
        quality_metrics: analysis.results.quality_metrics || {}
      }]
    }
    console.log('[PREVIEW] No variants or dda_matrix found!')
    return []
  }

  const getCurrentVariantData = () => {
    const variants = getAvailableVariants()
    console.log('[PREVIEW] getCurrentVariantData variants:', variants)
    console.log('[PREVIEW] selectedVariant:', selectedVariant)
    const current = variants[selectedVariant] || variants[0]
    console.log('[PREVIEW] current variant:', current)
    if (current) {
      console.log('[PREVIEW] current.dda_matrix keys:', Object.keys(current.dda_matrix || {}))
    }
    return current
  }

  // Create both plots in a single useEffect to prevent duplicates
  useEffect(() => {
    // Skip if plots are already initialized
    if (plotsInitialized.current) return

    const currentVariant = getCurrentVariantData()
    if (!currentVariant || !heatmapRef.current || !linePlotRef.current) return

    const channels = Object.keys(currentVariant.dda_matrix)
    if (channels.length === 0) return

    const scales = analysis.results.scales || []

    // Clear any existing content in the containers
    if (heatmapRef.current) {
      heatmapRef.current.innerHTML = ''
    }
    if (linePlotRef.current) {
      linePlotRef.current.innerHTML = ''
    }

    // Create heatmap
    const createHeatmap = () => {
      const width = heatmapRef.current!.clientWidth
      const height = Math.max(200, channels.length * 25 + 100)

      // Get number of timepoints from first channel
      const firstChannelData = currentVariant.dda_matrix[channels[0]] || []
      const numTimepoints = firstChannelData.length

      // Create canvas for heatmap rendering
      const canvas = document.createElement('canvas')
      canvas.width = numTimepoints
      canvas.height = channels.length
      const ctx = canvas.getContext('2d')!

      console.log('[PREVIEW HEATMAP] Canvas size:', canvas.width, 'x', canvas.height)

      // Find min/max values for normalization (use log transform for better visualization)
      let minVal = Infinity
      let maxVal = -Infinity
      const heatmapData: number[][] = []

      channels.forEach(channel => {
        const channelData = (currentVariant.dda_matrix[channel] || []).map(val => {
          const logVal = Math.log10(Math.max(0.001, val))
          minVal = Math.min(minVal, logVal)
          maxVal = Math.max(maxVal, logVal)
          return logVal
        })
        heatmapData.push(channelData)
      })

      // Render heatmap pixels
      const imageData = ctx.createImageData(canvas.width, canvas.height)
      const data = imageData.data

      for (let y = 0; y < channels.length; y++) {
        for (let x = 0; x < numTimepoints; x++) {
          const value = heatmapData[y]?.[x] || 0
          const normalized = (value - minVal) / (maxVal - minVal)
          const clamped = Math.max(0, Math.min(1, normalized))

          // Viridis color scheme
          const colors = [
            [68, 1, 84], [72, 40, 120], [62, 73, 137], [49, 104, 142],
            [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89],
            [180, 222, 44], [253, 231, 37]
          ]
          const idx = Math.floor(clamped * (colors.length - 1))
          const frac = clamped * (colors.length - 1) - idx
          const c1 = colors[idx] || colors[0]
          const c2 = colors[idx + 1] || colors[colors.length - 1]
          const r = Math.round(c1[0] + frac * (c2[0] - c1[0]))
          const g = Math.round(c1[1] + frac * (c2[1] - c1[1]))
          const b = Math.round(c1[2] + frac * (c2[2] - c1[2]))

          const pixelIndex = (y * canvas.width + x) * 4
          data[pixelIndex] = r
          data[pixelIndex + 1] = g
          data[pixelIndex + 2] = b
          data[pixelIndex + 3] = 255
        }
      }

      ctx.putImageData(imageData, 0, 0)

      // Convert canvas to data URL for uPlot
      const dataURL = canvas.toDataURL()

      // Prepare data for uPlot (just coordinates for image positioning)
      const plotData: uPlot.AlignedData = [
        new Float64Array([0, numTimepoints - 1]),
        new Float64Array([0, channels.length - 1])
      ]

      const opts: uPlot.Options = {
        width,
        height,
        scales: {
          x: {
            time: false,
            range: [0, numTimepoints - 1]
          },
          y: {
            range: [-0.5, channels.length - 0.5]
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
            labelSize: 80,
            size: 100,
            values: (u, ticks) => ticks.map(tick => {
              const idx = Math.round(tick)
              return idx >= 0 && idx < channels.length ? channels[idx] : ''
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
        hooks: {
          drawClear: [
            u => {
              const ctx = u.ctx
              const plotLeft = u.bbox.left
              const plotTop = u.bbox.top
              const plotWidth = u.bbox.width
              const plotHeight = u.bbox.height

              const img = new Image()
              img.onload = () => {
                ctx.drawImage(img, plotLeft, plotTop, plotWidth, plotHeight)
              }
              img.src = dataURL
            }
          ]
        }
      }

      try {
        const plot = new uPlot(opts, plotData, heatmapRef.current!)
        setHeatmapPlot(plot)
      } catch (error) {
        console.error('Failed to create heatmap:', error)
      }
    }

    // Create line plot
    const createLinePlot = () => {
      // Get number of timepoints from first channel
      const firstChannelData = currentVariant.dda_matrix[channels[0]] || []
      const numTimepoints = firstChannelData.length

      // X-axis is timepoints (0, 1, 2, ..., numTimepoints-1)
      const timepoints = Array.from({ length: numTimepoints }, (_, i) => i)

      console.log('[PREVIEW LINE PLOT] Number of timepoints:', numTimepoints)
      console.log('[PREVIEW LINE PLOT] Number of channels:', channels.length)

      // Prepare data for uPlot - [x-values, ...y-values for each channel]
      const plotData: uPlot.AlignedData = [
        new Float64Array(timepoints),
        ...channels.map(channel => new Float64Array(currentVariant.dda_matrix[channel] || []))
      ]

      const opts: uPlot.Options = {
        title: 'DDA Results Over Time',
        width: linePlotRef.current!.clientWidth,
        height: 400,
        series: [
          {
            label: 'Time Points'
          },
          ...channels.map((channel, idx) => ({
            label: channel,
            stroke: getChannelColor(idx),
            width: 2,
            points: { show: false }
          }))
        ],
        axes: [
          {
            label: 'Time Points',
            stroke: '#64748b',
            grid: { stroke: '#e2e8f0' }
          },
          {
            label: 'DDA Value',
            stroke: '#64748b',
            grid: { stroke: '#e2e8f0' }
          }
        ],
        scales: {
          x: {
            time: false
          }
        },
        legend: {
          show: true,
          live: true
        },
        cursor: {
          sync: {
            key: 'dda-preview'
          }
        }
      }

      try {
        const plot = new uPlot(opts, plotData, linePlotRef.current!)
        setLinePlot(plot)
      } catch (error) {
        console.error('Failed to create line plot:', error)
      }
    }

    // Create both plots
    createHeatmap()
    createLinePlot()

    // Mark plots as initialized
    plotsInitialized.current = true

  }, [analysis, selectedVariant])

  // Cleanup plots on unmount
  useEffect(() => {
    return () => {
      if (heatmapPlot) {
        heatmapPlot.destroy()
        setHeatmapPlot(null)
      }
      if (linePlot) {
        linePlot.destroy()
        setLinePlot(null)
      }
      plotsInitialized.current = false
    }
  }, [])

  // Helper function for channel colors
  const getChannelColor = (index: number) => {
    const colors = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
      '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4'
    ]
    return colors[index % colors.length]
  }

  const exportAnalysis = () => {
    const dataStr = JSON.stringify(analysis, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dda-analysis-${analysis.id}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const channels = Object.keys(analysis.results?.dda_matrix || {})

  return (
    <div className="h-screen w-full bg-background p-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Analysis Preview
          </h1>
          <p className="text-muted-foreground">
            {analysis.file_path ? analysis.file_path.split('/').pop() : `Analysis ${analysis.id}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {getAvailableVariants().length > 1 && (
            <div className="flex items-center space-x-2 mr-4">
              <Label className="text-sm">Variant:</Label>
              <Select value={selectedVariant.toString()} onValueChange={(value) => setSelectedVariant(parseInt(value))}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getAvailableVariants().map((variant, index) => (
                    <SelectItem key={variant.variant_id} value={index.toString()}>
                      {variant.variant_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={exportAnalysis}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Analysis Metadata */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Analysis Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Analysis ID</p>
              <p className="font-medium">{analysis.id}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Channels</p>
              <p className="font-medium">{channels.length}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge variant={analysis.status === 'completed' ? 'default' : 'secondary'}>
                {analysis.status}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground">Created</p>
              <p className="font-medium">
                {new Date(analysis.created_at).toLocaleString()}
              </p>
            </div>
            {analysis.results?.quality_metrics && (
              <>
                <div>
                  <p className="text-muted-foreground">Processing Time</p>
                  <p className="font-medium">
                    {analysis.completed_at && analysis.created_at
                      ? `${Math.round((new Date(analysis.completed_at).getTime() - new Date(analysis.created_at).getTime()) / 1000)}s`
                      : 'N/A'
                    }
                  </p>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* DDA Analysis Visualizations */}
      {channels.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">DDA Analysis Results</CardTitle>
            <CardDescription>
              Heatmap and line plot visualization for {channels.length} channels
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Heatmap */}
            <div>
              <div className="mb-2 text-sm font-medium">Heatmap</div>
              <div
                ref={heatmapRef}
                className="w-full"
                style={{ minHeight: '300px' }}
              />
            </div>

            {/* Line Plot */}
            <div>
              <div className="mb-2 text-sm font-medium">Line Plot</div>
              <div
                ref={linePlotRef}
                className="w-full"
                style={{ minHeight: '400px' }}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-center h-48">
            <div className="text-center text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No plot data available</p>
              <p className="text-sm mt-2">This analysis may not have completed successfully</p>
            </div>
          </CardContent>
        </Card>
      )}


      {/* Parameters Summary */}
      {analysis.parameters && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Analysis Parameters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {analysis.parameters.variants && (
                <div>
                  <p className="text-muted-foreground">Variants</p>
                  <p className="font-medium">{analysis.parameters.variants.join(', ')}</p>
                </div>
              )}
              {analysis.parameters.window_length && (
                <div>
                  <p className="text-muted-foreground">Window Length</p>
                  <p className="font-medium">{analysis.parameters.window_length}</p>
                </div>
              )}
              {analysis.parameters.window_step && (
                <div>
                  <p className="text-muted-foreground">Window Step</p>
                  <p className="font-medium">{analysis.parameters.window_step}</p>
                </div>
              )}
              {analysis.parameters.scale_min && analysis.parameters.scale_max && (
                <div>
                  <p className="text-muted-foreground">Scale Range</p>
                  <p className="font-medium">{analysis.parameters.scale_min} - {analysis.parameters.scale_max}</p>
                </div>
              )}
              {analysis.parameters.start_time !== undefined && analysis.parameters.end_time !== undefined && (
                <div>
                  <p className="text-muted-foreground">Time Range</p>
                  <p className="font-medium">{analysis.parameters.start_time}s - {analysis.parameters.end_time}s</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
