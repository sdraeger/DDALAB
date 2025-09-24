import React, { useEffect, useRef, useState } from 'react'
import { PopoutLayout } from './PopoutLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

interface TimeSeriesData {
  channels: string[]
  data: number[][]
  timestamps: number[]
  sampleRate: number
  chunkStart: number
  timeWindow: number
  currentTime: number
  filters?: {
    highpass?: number
    lowpass?: number
    notch?: number[]
  }
}

interface TimeSeriesPopoutContentProps {
  data?: TimeSeriesData
  isLocked?: boolean
  windowId?: string
}

function TimeSeriesPopoutContent({ data, isLocked }: TimeSeriesPopoutContentProps) {
  const plotRef = useRef<HTMLDivElement>(null)
  const uplotRef = useRef<uPlot | null>(null)
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])
  const [amplitude, setAmplitude] = useState([1])
  const [timeBase, setTimeBase] = useState([10])

  // Initialize selected channels when data loads
  useEffect(() => {
    if (data?.channels && selectedChannels.length === 0) {
      setSelectedChannels(data.channels.slice(0, Math.min(8, data.channels.length)))
    }
  }, [data?.channels, selectedChannels.length])

  // Update plot when data changes (only if not locked)
  useEffect(() => {
    if (!data || isLocked) return

    renderPlot()
  }, [data, selectedChannels, amplitude, timeBase, isLocked])

  const renderPlot = () => {
    if (!plotRef.current || !data || selectedChannels.length === 0) return

    // Clean up existing plot
    if (uplotRef.current) {
      uplotRef.current.destroy()
      uplotRef.current = null
    }

    const { channels, data: channelData, timestamps, sampleRate } = data

    // Filter data for selected channels
    const selectedIndices = selectedChannels.map(ch => channels.indexOf(ch)).filter(idx => idx !== -1)
    const filteredData = selectedIndices.map(idx => channelData[idx] || [])
    const filteredLabels = selectedIndices.map(idx => channels[idx])

    if (filteredData.length === 0 || filteredData[0].length === 0) return

    // Prepare data for uPlot
    const plotData: uPlot.AlignedData = [timestamps, ...filteredData]

    // Create series configuration
    const series: uPlot.Series[] = [
      {}, // x-axis
      ...filteredLabels.map((label, index) => ({
        label,
        stroke: getChannelColor(index),
        width: 1,
        points: { show: false },
        scale: 'y'
      }))
    ]

    const opts: uPlot.Options = {
      width: plotRef.current.clientWidth,
      height: plotRef.current.clientHeight - 100,
      series,
      axes: [
        {
          label: 'Time (s)',
          labelSize: 30,
          size: 50,
        },
        {
          label: 'Amplitude (μV)',
          labelSize: 80,
          size: 80,
          scale: 'y'
        }
      ],
      scales: {
        x: {
          time: false,
        },
        y: {
          auto: false,
          range: [-amplitude[0] * 100, amplitude[0] * 100]
        }
      },
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

    uplotRef.current = new uPlot(opts, plotData, plotRef.current)

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (uplotRef.current && plotRef.current) {
        uplotRef.current.setSize({
          width: plotRef.current.clientWidth,
          height: plotRef.current.clientHeight - 100
        })
      }
    })

    resizeObserver.observe(plotRef.current)

    return () => {
      resizeObserver.disconnect()
      if (uplotRef.current) {
        uplotRef.current.destroy()
        uplotRef.current = null
      }
    }
  }

  const getChannelColor = (index: number): string => {
    const colors = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
      '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1'
    ]
    return colors[index % colors.length]
  }

  const toggleChannel = (channel: string) => {
    setSelectedChannels(prev =>
      prev.includes(channel)
        ? prev.filter(ch => ch !== channel)
        : [...prev, channel]
    )
  }

  const handleRefresh = () => {
    if (!isLocked) {
      renderPlot()
    }
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-medium text-muted-foreground">No Data</div>
          <div className="text-sm text-muted-foreground">Waiting for time series data...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Time Series Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">Amplitude Scale</Label>
              <Slider
                value={amplitude}
                onValueChange={setAmplitude}
                max={10}
                min={0.1}
                step={0.1}
                className="w-full"
              />
              <div className="text-xs text-muted-foreground mt-1">
                ±{amplitude[0] * 100}μV
              </div>
            </div>
            
            <div>
              <Label className="text-sm">Time Base</Label>
              <Slider
                value={timeBase}
                onValueChange={setTimeBase}
                max={30}
                min={1}
                step={1}
                className="w-full"
              />
              <div className="text-xs text-muted-foreground mt-1">
                {timeBase[0]}s window
              </div>
            </div>
          </div>

          {/* Channel Selection */}
          <div>
            <Label className="text-sm mb-2 block">
              Channels ({selectedChannels.length} of {data.channels.length} selected)
            </Label>
            <div className="flex flex-wrap gap-2 max-h-20 overflow-y-auto">
              {data.channels.map((channel, index) => (
                <Badge
                  key={channel}
                  variant={selectedChannels.includes(channel) ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => toggleChannel(channel)}
                  style={{
                    backgroundColor: selectedChannels.includes(channel) 
                      ? getChannelColor(selectedChannels.indexOf(channel))
                      : undefined
                  }}
                >
                  {channel}
                </Badge>
              ))}
            </div>
          </div>

          {/* Data info */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <Label className="text-muted-foreground">Sample Rate</Label>
              <div className="font-medium">{data.sampleRate} Hz</div>
            </div>
            <div>
              <Label className="text-muted-foreground">Current Time</Label>
              <div className="font-medium">{data.currentTime?.toFixed(1) || 0}s</div>
            </div>
            <div>
              <Label className="text-muted-foreground">Data Points</Label>
              <div className="font-medium">{data.data?.[0]?.length || 0}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plot Area */}
      <Card className="flex-1">
        <CardContent className="h-full p-0">
          <div ref={plotRef} className="w-full h-full" />
        </CardContent>
      </Card>
    </div>
  )
}

export default function TimeSeriesPopout() {
  return (
    <PopoutLayout
      title="Time Series Plot"
      showRefresh={true}
    >
      <TimeSeriesPopoutContent />
    </PopoutLayout>
  )
}