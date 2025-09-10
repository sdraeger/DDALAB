"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  ZoomIn, 
  ZoomOut, 
  Settings, 
  Download,
  Maximize2,
  Grid,
  Eye,
  EyeOff,
  Ruler,
  Crosshair
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { apiService, ChunkData, EDFFileInfo, Annotation } from '@/services/apiService';
import { cn } from '@/lib/utils';
import UPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface EEGVisualizationProps {
  file: EDFFileInfo;
  selectedChannels: string[];
  annotations: Annotation[];
  onAnnotationCreate: (annotation: Omit<Annotation, 'id' | 'created_at'>) => void;
  onAnnotationUpdate: (id: string, annotation: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string, filePath: string) => void;
  className?: string;
}

interface VisualizationSettings {
  amplitude: number;
  timeScale: number;
  showGrid: boolean;
  showRuler: boolean;
  colorScheme: 'default' | 'dark' | 'clinical';
  channelSpacing: number;
  filterSettings: {
    highpass?: number;
    lowpass?: number;
    notch?: number[];
  };
}

const DEFAULT_SETTINGS: VisualizationSettings = {
  amplitude: 100,
  timeScale: 30,
  showGrid: true,
  showRuler: true,
  colorScheme: 'clinical',
  channelSpacing: 80,
  filterSettings: {}
};

export function EEGVisualization({
  file,
  selectedChannels,
  annotations,
  onAnnotationCreate,
  onAnnotationUpdate,
  onAnnotationDelete,
  className
}: EEGVisualizationProps) {
  const plotContainerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<UPlot | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [chunkData, setChunkData] = useState<ChunkData | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [chunkSize, setChunkSize] = useState(30); // seconds
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [settings, setSettings] = useState<VisualizationSettings>(DEFAULT_SETTINGS);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);

  const plotWidth = 1200;
  const plotHeight = Math.max(400, selectedChannels.length * settings.channelSpacing + 100);

  const loadChunkData = useCallback(async (startTime: number, size: number) => {
    if (!file || selectedChannels.length === 0) return;

    try {
      setLoading(true);
      const startSample = Math.floor(startTime * file.sample_rate);
      const sampleSize = Math.floor(size * file.sample_rate);

      const data = await apiService.getChunkData(
        file.file_path,
        startSample,
        sampleSize,
        selectedChannels,
        settings.filterSettings
      );

      setChunkData(data);
    } catch (error) {
      console.error('Failed to load chunk data:', error);
    } finally {
      setLoading(false);
    }
  }, [file, selectedChannels, settings.filterSettings]);

  useEffect(() => {
    loadChunkData(currentTime, chunkSize);
  }, [loadChunkData, currentTime, chunkSize]);

  // Create uPlot EEG visualization
  const createEEGPlot = useCallback(() => {
    if (!plotContainerRef.current || !chunkData || !chunkData.data || !chunkData.channels) {
      console.warn('EEG plot: Missing requirements', {
        container: !!plotContainerRef.current,
        chunkData: !!chunkData,
        data: !!chunkData?.data,
        channels: !!chunkData?.channels
      });
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
      return;
    }

    // Safety checks for chunk data structure
    if (!Array.isArray(chunkData.data) || chunkData.data.length === 0) {
      console.warn('Invalid chunk data: missing or empty data array');
      return;
    }
    
    if (!Array.isArray(chunkData.channels) || chunkData.channels.length === 0) {
      console.warn('Invalid chunk data: missing or empty channels array');
      return;
    }

    // Destroy existing chart
    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    // Filter data for selected channels
    const filteredChannelIndices: number[] = [];
    const filteredChannelNames: string[] = [];
    
    selectedChannels.forEach(channelName => {
      const index = chunkData.channels.indexOf(channelName);
      if (index >= 0 && index < chunkData.data.length) {
        filteredChannelIndices.push(index);
        filteredChannelNames.push(channelName);
      }
    });

    if (filteredChannelIndices.length === 0) {
      console.warn('No valid channels found for plotting');
      return;
    }

    // Prepare time series data
    const dataLength = chunkData.data[0]?.length || 0;
    if (dataLength === 0) {
      console.warn('No data samples available');
      return;
    }

    // Create time axis (in seconds)
    const timeStep = 1 / (file.sample_rate || 250); // Default to 250Hz if not available
    const timeData = new Float64Array(dataLength);
    for (let i = 0; i < dataLength; i++) {
      timeData[i] = currentTime + (i * timeStep);
    }

    // Prepare stacked channel data with vertical separation
    const separation = settings.channelSpacing;
    // Use amplitude setting more effectively - make it more visible
    const amplitudeScale = settings.amplitude * 0.4; // Scale factor for signal amplitude
    
    const plotData: (Float64Array)[] = [timeData];
    
    console.log('EEG Plot scaling:', { 
      separation, 
      amplitudeScale, 
      settingsAmplitude: settings.amplitude,
      numChannels: filteredChannelIndices.length 
    });
    
    filteredChannelIndices.forEach((channelIndex, plotIndex) => {
      const channelData = chunkData.data[channelIndex];
      if (!Array.isArray(channelData) || channelData.length === 0) {
        // Fill with zeros if no data
        plotData.push(new Float64Array(dataLength).fill(-plotIndex * separation));
        return;
      }

      // Find min/max for normalization
      let min = channelData[0], max = channelData[0];
      for (let i = 1; i < channelData.length; i++) {
        if (channelData[i] < min) min = channelData[i];
        if (channelData[i] > max) max = channelData[i];
      }
      
      const mid = (min + max) / 2;
      const range = Math.max(1e-6, max - min);
      
      console.log(`Channel ${filteredChannelNames[plotIndex]}:`, { 
        min: min.toFixed(2), 
        max: max.toFixed(2), 
        range: range.toFixed(2),
        dataLength: channelData.length 
      });
      
      // Create scaled and offset data with more visible amplitude
      const scaledData = new Float64Array(dataLength);
      for (let i = 0; i < dataLength; i++) {
        const centered = channelData[i] - mid;
        const normalized = (centered / (range / 2)) * amplitudeScale;
        scaledData[i] = normalized - plotIndex * separation;
      }
      
      plotData.push(scaledData);
    });

    // Debug the final plot data ranges
    if (plotData.length > 1) {
      plotData.slice(1).forEach((series, i) => {
        const min = Math.min(...series);
        const max = Math.max(...series);
        const variation = max - min;
        console.log(`Final series ${i} (${filteredChannelNames[i]}):`, { 
          min: min.toFixed(2), 
          max: max.toFixed(2), 
          variation: variation.toFixed(2),
          center: ((min + max) / 2).toFixed(2)
        });
      });
    }

    // Create uPlot options
    const opts: UPlot.Options = {
      width: Math.max(800, plotWidth),
      height: Math.max(400, plotHeight),
      padding: [15, 15, 40, 80],
      scales: {
        x: { time: false },
        y: { 
          auto: false, 
          range: [
            -(filteredChannelNames.length * separation) - separation/2, 
            separation * 1.5
          ] 
        }
      },
      axes: [
        {
          label: "Time (seconds)",
          stroke: "#555",
          grid: { stroke: settings.showGrid ? "#e0e0e0" : "transparent", width: 1 }
        },
        {
          show: true,
          side: 3,
          stroke: "#555",
          size: 80,
          grid: { show: false },
          splits: () => filteredChannelNames.map((_, i) => -i * separation),
          values: () => filteredChannelNames,
        }
      ],
      series: [
        { label: "Time" },
        ...filteredChannelNames.map((name, i) => ({
          label: name,
          stroke: getChannelColor(i),
          width: 1, // Appropriate thickness for EEG data
          points: { show: false }
        }))
      ],
      cursor: {
        drag: { x: true, y: false, setScale: true },
        sync: { key: "eeg-sync" }
      },
      hooks: {
        drawAxes: [
          (u: UPlot) => {
            // Draw annotations if enabled
            if (annotations && annotations.length > 0) {
              const ctx = (u as any).ctx as CanvasRenderingContext2D;
              const { left, top, width, height } = u.bbox;
              
              annotations
                .filter(ann => {
                  const annStart = ann.start_time;
                  const annEnd = ann.end_time || ann.start_time;
                  const chunkStart = currentTime;
                  const chunkEnd = currentTime + chunkSize;
                  
                  return !(annEnd < chunkStart || annStart > chunkEnd);
                })
                .forEach(annotation => {
                  const startTime = annotation.start_time;
                  const endTime = annotation.end_time || annotation.start_time;
                  
                  // Convert time to pixel coordinates
                  const startX = u.valToPos(startTime, 'x');
                  const endX = u.valToPos(endTime, 'x');
                  
                  if (startX >= left && startX <= left + width) {
                    // Draw annotation background
                    ctx.fillStyle = getAnnotationColor(annotation.annotation_type, 0.2);
                    ctx.fillRect(startX, top, Math.max(2, endX - startX), height);
                    
                    // Draw annotation border
                    ctx.strokeStyle = getAnnotationColor(annotation.annotation_type, 1);
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(startX, top);
                    ctx.lineTo(startX, top + height);
                    if (endTime > startTime && endX > startX + 2) {
                      ctx.moveTo(endX, top);
                      ctx.lineTo(endX, top + height);
                    }
                    ctx.stroke();
                    
                    // Draw annotation label
                    ctx.fillStyle = '#333';
                    ctx.font = '10px Arial';
                    ctx.fillText(annotation.label, startX + 2, top + 15);
                  }
                });
            }
          }
        ]
      }
    };

    try {
      // Create uPlot instance
      uplotRef.current = new UPlot(opts, plotData, plotContainerRef.current);
      console.log('EEG uPlot created successfully');
    } catch (error) {
      console.error('Failed to create EEG uPlot:', error);
      uplotRef.current = null;
    }

  }, [chunkData, selectedChannels, settings, currentTime, chunkSize, file.sample_rate, annotations, plotWidth, plotHeight]);

  useEffect(() => {
    createEEGPlot();
  }, [createEEGPlot]);

  const getChannelColor = (index: number): string => {
    const colors = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#c2410c'];
    return colors[index % colors.length];
  };

  const getAnnotationColor = (type: string, opacity: number): string => {
    const colors = {
      seizure: `rgba(239, 68, 68, ${opacity})`,
      artifact: `rgba(249, 115, 22, ${opacity})`,
      marker: `rgba(34, 197, 94, ${opacity})`,
      clinical: `rgba(59, 130, 246, ${opacity})`,
      custom: `rgba(168, 85, 247, ${opacity})`
    };
    return colors[type as keyof typeof colors] || colors.custom;
  };

  const formatTimeLabel = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, []);

  const handleTimeJump = useCallback((seconds: number) => {
    const newTime = Math.max(0, Math.min(file.duration - chunkSize, currentTime + seconds));
    setCurrentTime(newTime);
  }, [currentTime, file.duration, chunkSize]);

  // Auto-play functionality
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentTime(prev => {
        const newTime = prev + (0.1 * playbackSpeed);
        if (newTime >= file.duration - chunkSize) {
          setIsPlaying(false);
          return file.duration - chunkSize;
        }
        return newTime;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, file.duration, chunkSize]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header Controls */}
      <div className="flex-shrink-0 p-4 border-b space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {file.file_name}
            </Badge>
            <Badge variant="secondary">
              {selectedChannels.length} channels
            </Badge>
            {loading && (
              <Badge variant="outline">
                <div className="animate-spin rounded-full h-3 w-3 border-b border-current mr-1" />
                Loading...
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant={annotationMode ? "default" : "outline"}
              size="sm"
              onClick={() => setAnnotationMode(!annotationMode)}
            >
              <Crosshair className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm">
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleTimeJump(-chunkSize)}
            disabled={currentTime <= 0}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleTimeJump(chunkSize)}
            disabled={currentTime >= file.duration - chunkSize}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          
          <Separator orientation="vertical" className="h-6" />
          
          <div className="flex items-center gap-2">
            <Label className="text-sm">Speed:</Label>
            <Select value={playbackSpeed.toString()} onValueChange={(value) => setPlaybackSpeed(parseFloat(value))}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.25">0.25x</SelectItem>
                <SelectItem value="0.5">0.5x</SelectItem>
                <SelectItem value="1">1x</SelectItem>
                <SelectItem value="2">2x</SelectItem>
                <SelectItem value="4">4x</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Time Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>{formatTimeLabel(currentTime)}</span>
            <span className="text-muted-foreground">
              Chunk: {chunkSize}s
            </span>
            <span>{formatTimeLabel(file.duration)}</span>
          </div>
          <Slider
            value={[currentTime]}
            onValueChange={([value]) => setCurrentTime(value)}
            max={file.duration - chunkSize}
            step={0.1}
            className="w-full"
          />
        </div>

        {/* Visualization Controls */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Amplitude:</Label>
            <Slider
              value={[settings.amplitude]}
              onValueChange={([value]) => setSettings(s => ({ ...s, amplitude: value }))}
              min={10}
              max={500}
              step={10}
              className="w-24"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Label className="text-sm">Window:</Label>
            <Select value={chunkSize.toString()} onValueChange={(value) => setChunkSize(parseInt(value))}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10s</SelectItem>
                <SelectItem value="30">30s</SelectItem>
                <SelectItem value="60">60s</SelectItem>
                <SelectItem value="120">120s</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch
              id="show-grid"
              checked={settings.showGrid}
              onCheckedChange={(checked) => setSettings(s => ({ ...s, showGrid: checked }))}
            />
            <Label htmlFor="show-grid" className="text-sm">Grid</Label>
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch
              id="show-ruler"
              checked={settings.showRuler}
              onCheckedChange={(checked) => setSettings(s => ({ ...s, showRuler: checked }))}
            />
            <Label htmlFor="show-ruler" className="text-sm">Ruler</Label>
          </div>
        </div>
      </div>

      {/* EEG Plot Container */}
      <div className="flex-1 p-4 overflow-auto" ref={containerRef}>
        <div
          ref={plotContainerRef}
          className="border rounded-lg bg-white cursor-crosshair w-full h-full min-h-96"
        />
      </div>

      {/* Status Bar */}
      <div className="flex-shrink-0 p-2 border-t bg-muted/20 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span>Sample Rate: {file.sample_rate} Hz</span>
            <span>Resolution: {(1000 / file.sample_rate).toFixed(1)} ms/sample</span>
            {mousePosition && (
              <span>
                Time: {formatTimeLabel(currentTime + (mousePosition.x / plotWidth) * chunkSize)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {annotationMode && (
              <Badge variant="outline" className="text-xs">
                Annotation Mode Active
              </Badge>
            )}
            <span>{annotations.length} annotations</span>
          </div>
        </div>
      </div>
    </div>
  );
}