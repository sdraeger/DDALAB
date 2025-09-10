"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { 
  Download, 
  Maximize2, 
  Settings, 
  Palette, 
  Grid, 
  Ruler,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Save,
  Share,
  Printer,
  BarChart3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { apiService, DDAResult, EDFFileInfo, PlotRequest } from '@/services/apiService';
import { cn } from '@/lib/utils';
import UPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface PlotVisualizationProps {
  file?: EDFFileInfo;
  ddaResult?: DDAResult;
  plotType: 'timeseries' | 'dda_scaling' | 'dda_fluctuations' | 'spectrogram';
  selectedChannels?: string[];
  timeWindow?: { start: number; end: number };
  className?: string;
}

type ViewType = 'line' | 'heatmap' | 'both';

interface PlotConfig {
  width: number;
  height: number;
  dpi: number;
  format: 'png' | 'svg' | 'pdf';
  title?: string;
  show_annotations?: boolean;
  color_scheme: 'default' | 'clinical' | 'publication' | 'high_contrast';
  show_grid: boolean;
  show_legend: boolean;
  line_width: number;
  font_size: number;
  background: 'white' | 'transparent';
}

const DEFAULT_PLOT_CONFIG: PlotConfig = {
  width: 1200,
  height: 800,
  dpi: 300,
  format: 'png',
  show_annotations: true,
  color_scheme: 'clinical',
  show_grid: true,
  show_legend: true,
  line_width: 1.5,
  font_size: 12,
  background: 'white'
};

const COLOR_SCHEMES = {
  default: 'Standard colors',
  clinical: 'Clinical publication style',
  publication: 'High-contrast publication',
  high_contrast: 'Accessibility optimized'
};

const PLOT_FORMATS = {
  png: { label: 'PNG (Raster)', ext: '.png', description: 'Good for web display' },
  svg: { label: 'SVG (Vector)', ext: '.svg', description: 'Scalable, ideal for presentations' },
  pdf: { label: 'PDF (Vector)', ext: '.pdf', description: 'Publication quality' }
};

const PRESET_SIZES = {
  web: { width: 800, height: 600, label: 'Web Display' },
  presentation: { width: 1920, height: 1080, label: 'Presentation (HD)' },
  publication: { width: 3600, height: 2400, label: 'Publication Quality' },
  poster: { width: 4800, height: 3200, label: 'Poster/Banner' }
};

// uPlot React wrapper with proper zoom/pan support
function UPlotWrapper({ options, data, onCreate }: { 
  options: UPlot.Options | null; 
  data: UPlot.AlignedData | null; 
  onCreate?: (chart: UPlot) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<UPlot | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Track container size for responsive updates
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({
          width: Math.max(320, rect.width || 400),
          height: Math.max(220, rect.height || 300)
        });
      }
    });

    resizeObserver.observe(containerRef.current);
    
    // Initial size
    const rect = containerRef.current.getBoundingClientRect();
    setContainerSize({
      width: Math.max(320, rect.width || 400),
      height: Math.max(220, rect.height || 300)
    });

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current || !options || !data || containerSize.width === 0) return;

    // Destroy previous instance
    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    // Update options with current container size and merge cursor options
    const updatedOptions: UPlot.Options = {
      ...options,
      width: containerSize.width,
      height: containerSize.height,
      cursor: {
        show: true,
        drag: { 
          x: true, 
          y: true, 
          setScale: true // Enable zoom/pan
        },
        ...options.cursor // Preserve existing cursor options
      }
    };

    // Create new instance
    try {
      const chart = new UPlot(updatedOptions, data, containerRef.current);
      uplotRef.current = chart;
      if (onCreate) onCreate(chart);
    } catch (error) {
      console.error('Failed to create uPlot:', error);
    }

    // Cleanup on unmount
    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [options, data, containerSize, onCreate]);

  return <div ref={containerRef} className="w-full h-full" />;
}

export function PlotVisualization({
  file,
  ddaResult,
  plotType,
  selectedChannels = [],
  timeWindow,
  className
}: PlotVisualizationProps) {
  const uplotRef = useRef<UPlot | null>(null);
  const [plotConfig, setPlotConfig] = useState<PlotConfig>(DEFAULT_PLOT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFilename, setExportFilename] = useState('');
  const [viewType, setViewType] = useState<ViewType>('line');
  const [colormap, setColormap] = useState<'viridis' | 'plasma' | 'jet' | 'cool'>('viridis');

  // Create DDA plot data and options
  const createDDAPlot = useCallback((
    ddaResult: DDAResult,
    plotType: string,
    config: PlotConfig
  ) => {
    const Q = ddaResult.results.fluctuations;
    const scales = ddaResult.results.scales;
    
    if (!Q || Object.keys(Q).length === 0 || !scales || scales.length === 0) {
      return { data: null, options: null };
    }

    const channels = Object.keys(Q);
    const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#84cc16'];
    
    // Prepare data for uPlot [x, y1, y2, y3, ...]
    const uplotData: UPlot.AlignedData = [scales]; // X-axis (scales)
    
    channels.forEach(channel => {
      uplotData.push(Q[channel]);
    });

    // Create series configuration
    const series: UPlot.Series[] = [
      { label: 'Scale' } // X-axis
    ];
    
    channels.forEach((channel, idx) => {
      series.push({
        label: channel,
        stroke: colors[idx % colors.length],
        width: config.line_width,
        points: { show: false },
        paths: UPlot.paths?.linear?.() || undefined,
      });
    });

    const dpr = (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
    
    const options: UPlot.Options = {
      title: plotType === 'dda_scaling' ? `DDA Scaling Analysis - ${ddaResult.id}` : `DDA Fluctuation Analysis - ${ddaResult.id}`,
      width: config.width,
      height: config.height,
      series,
      axes: [
        {
          label: 'Scales',
          scale: 'x',
          stroke: '#555',
          grid: { stroke: '#e0e0e0', width: 1 }
        },
        {
          label: plotType === 'dda_scaling' ? 'Amplitude' : 'Fluctuation',
          scale: 'y',
          side: 3,
          stroke: '#555',
          grid: { stroke: '#e0e0e0', width: 1 }
        }
      ],
      scales: {
        x: { time: false },
        y: { auto: true }
      },
      legend: {
        show: config.show_legend,
      }
    };

    return { data: uplotData, options };
  }, []);

  // Create timeseries plot data with async loading support
  const createTimeseriesPlot = useCallback((
    file: EDFFileInfo,
    channels: string[],
    timeWindow: any,
    config: PlotConfig
  ) => {
    if (channels.length === 0) {
      return { data: null, options: null };
    }

    // For now, use enhanced placeholder data that simulates realistic EEG patterns
    const sampleRate = 256;
    const duration = (timeWindow?.end - timeWindow?.start) || 4; // 4 seconds default
    const numPoints = Math.min(sampleRate * duration, 2000); // Limit for performance
    const timePoints = Array.from({ length: numPoints }, (_, i) => (timeWindow?.start || 0) + i / sampleRate);
    const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#84cc16'];
    
    const uplotData: UPlot.AlignedData = [timePoints];
    
    // Add realistic EEG-like data for each channel
    channels.slice(0, 8).forEach((channel, idx) => {
      const channelData = timePoints.map((t, timeIdx) => {
        // Simulate different EEG frequency bands
        const alpha = Math.sin(t * 2 * Math.PI * 10 + idx) * 20; // 10 Hz alpha waves
        const beta = Math.sin(t * 2 * Math.PI * 20 + idx * 0.5) * 10; // 20 Hz beta waves  
        const theta = Math.sin(t * 2 * Math.PI * 6 + idx * 1.5) * 15; // 6 Hz theta waves
        const noise = (Math.random() - 0.5) * 5; // Random noise
        const baseline = 50 + idx * 10; // Different baseline for each channel
        
        // Occasionally add artifacts or spikes
        const spike = (timeIdx % 500 === 0) ? Math.random() * 100 : 0;
        
        return baseline + alpha + beta + theta + noise + spike;
      });
      uplotData.push(channelData);
    });

    const series: UPlot.Series[] = [
      { label: 'Time (s)' }
    ];
    
    const dpr = (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
    
    channels.slice(0, 8).forEach((channel, idx) => {
      series.push({
        label: channel,
        stroke: colors[idx % colors.length],
        width: Math.max(1, config.line_width / dpr), // Crisp lines
        points: { show: false },
        paths: UPlot.paths?.linear?.() || undefined,
      });
    });

    const options: UPlot.Options = {
      title: `EEG Time Series - ${file.file_name}`,
      width: config.width,
      height: config.height,
      series,
      axes: [
        {
          label: 'Time (s)',
          scale: 'x',
          side: 2,
          stroke: '#555',
          grid: { stroke: '#e0e0e0', width: 1 }
        },
        {
          label: 'Amplitude (µV)',
          scale: 'y',
          side: 3,
          stroke: '#555',
          grid: { stroke: '#e0e0e0', width: 1 }
        }
      ],
      scales: {
        x: { 
          time: false,
          auto: false,
          range: [timePoints[0], timePoints[timePoints.length - 1]]
        },
        y: { 
          auto: true,
          range: (u, min, max) => {
            // Add some padding to the Y-axis
            const range = max - min;
            return [min - range * 0.1, max + range * 0.1];
          }
        }
      },
      legend: {
        show: config.show_legend,
      },
      hooks: {
        ready: [
          (u) => {
            // Add custom styling when plot is ready
            u.root.style.border = 'none';
          }
        ]
      }
    };

    return { data: uplotData, options };
  }, []);

  // Colormap functions
  const getColormapColor = useCallback((value: number, colormap: string) => {
    // Clamp value between 0 and 1
    const t = Math.max(0, Math.min(1, value));
    
    switch (colormap) {
      case 'viridis':
        // Enhanced Viridis colormap with more vibrant colors
        const r = Math.round(255 * (0.267004 + t * (0.993248 - 0.267004)));
        const g = Math.round(255 * (0.004874 + t * (0.906157 - 0.004874)));  
        const b = Math.round(255 * (0.329415 + t * (0.143936 - 0.329415)));
        return `rgb(${r}, ${g}, ${b})`;
      
      case 'plasma':
        // Enhanced Plasma colormap with more vibrant colors
        const pr = Math.round(255 * (0.050383 + t * (0.940015 - 0.050383)));
        const pg = Math.round(255 * (0.029803 + t * (0.975158 - 0.029803)));
        const pb = Math.round(255 * (0.527975 + t * (0.131326 - 0.527975)));
        return `rgb(${pr}, ${pg}, ${pb})`;
      
      case 'jet':
        // Enhanced Jet colormap with more vibrant colors
        let jr, jg, jb;
        if (t < 0.125) {
          jr = 0; jg = 0; jb = 0.5 + t * 4;
        } else if (t < 0.375) {
          jr = 0; jg = (t - 0.125) * 4; jb = 1;
        } else if (t < 0.625) {
          jr = (t - 0.375) * 4; jg = 1; jb = 1 - (t - 0.375) * 4;
        } else if (t < 0.875) {
          jr = 1; jg = 1 - (t - 0.625) * 4; jb = 0;
        } else {
          jr = 1 - (t - 0.875) * 4; jg = 0; jb = 0;
        }
        return `rgb(${Math.round(jr * 255)}, ${Math.round(jg * 255)}, ${Math.round(jb * 255)})`;
      
      case 'cool':
        // Enhanced Cool colormap (cyan to magenta) with more vibrancy
        return `rgb(${Math.round(t * 255)}, ${Math.round((1 - t) * 255)}, 255)`;
      
      default:
        return `hsl(${(1 - t) * 240}, 100%, 50%)`; // Enhanced default with 100% saturation
    }
  }, []);

  // Create DDA heatmap plot using a proper 2D representation
  const createDDAHeatmap = useCallback((
    ddaResult: DDAResult,
    config: PlotConfig
  ) => {
    const Q = ddaResult.results.fluctuations;
    const scales = ddaResult.results.scales;
    
    if (!Q || Object.keys(Q).length === 0 || !scales || scales.length === 0) {
      return { data: null, options: null };
    }

    const channels = Object.keys(Q);
    
    // Find min/max for color scaling
    const allValues = Object.values(Q).flat();
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    
    // Create a true heatmap by drawing rectangles for each data point
    // We'll use a custom draw hook to render the heatmap
    const series: UPlot.Series[] = [
      { label: 'Scales' },
      { 
        label: 'Heatmap',
        stroke: 'transparent',
        fill: 'transparent',
        points: { show: false },
        paths: () => null, // No line drawing
      }
    ];

    // Create minimal data structure (just for axes)
    const uplotData: UPlot.AlignedData = [
      scales,
      new Array(scales.length).fill(0) // Dummy data for second series
    ];

    const options: UPlot.Options = {
      title: `DDA Heatmap (${colormap}) - ${ddaResult.id}`,
      width: config.width,
      height: config.height,
      series,
      axes: [
        {
          label: 'Scales',
          scale: 'x',
          stroke: '#555',
          grid: { stroke: '#e0e0e0', width: 1 }
        },
        {
          label: 'Channels',
          scale: 'y',
          side: 3,
          stroke: '#555',
          grid: { stroke: '#e0e0e0', width: 1 },
          splits: () => channels.map((_, idx) => idx),
          values: () => channels
        }
      ],
      scales: {
        x: { time: false },
        y: { 
          range: [-0.5, channels.length - 0.5] 
        }
      },
      legend: {
        show: false, // Hide legend for heatmap
      },
      hooks: {
        draw: [
          (u) => {
            const { ctx } = u;
            if (!ctx) return;

            // Draw the heatmap
            const plotLeft = u.bbox.left;
            const plotTop = u.bbox.top;
            const plotWidth = u.bbox.width;
            const plotHeight = u.bbox.height;
            
            const cellWidth = plotWidth / scales.length;
            const cellHeight = plotHeight / channels.length;

            channels.forEach((channel, channelIdx) => {
              const channelData = Q[channel];
              channelData.forEach((value, scaleIdx) => {
                const normalizedValue = (value - minVal) / (maxVal - minVal);
                const color = getColormapColor(normalizedValue, colormap);
                
                const x = plotLeft + scaleIdx * cellWidth;
                const y = plotTop + channelIdx * cellHeight;
                
                ctx.fillStyle = color;
                ctx.fillRect(x, y, cellWidth, cellHeight);
              });
            });
          }
        ]
      }
    };

    return { data: uplotData, options };
  }, [colormap, getColormapColor]);

  // Generate uPlot data and options based on view type
  const { data, options, heatmapData, heatmapOptions } = useMemo(() => {
    if (ddaResult && (plotType === 'dda_scaling' || plotType === 'dda_fluctuations')) {
      if (viewType === 'heatmap') {
        const heatmap = createDDAHeatmap(ddaResult, plotConfig);
        return { data: heatmap.data, options: heatmap.options, heatmapData: null, heatmapOptions: null };
      } else if (viewType === 'both') {
        const lineplot = createDDAPlot(ddaResult, plotType, plotConfig);
        const heatmap = createDDAHeatmap(ddaResult, { ...plotConfig, height: plotConfig.height / 2 });
        return { 
          data: lineplot.data, 
          options: lineplot.options, 
          heatmapData: heatmap.data, 
          heatmapOptions: heatmap.options 
        };
      } else {
        const lineplot = createDDAPlot(ddaResult, plotType, plotConfig);
        return { data: lineplot.data, options: lineplot.options, heatmapData: null, heatmapOptions: null };
      }
    } else if (file && plotType === 'timeseries') {
      const timeseries = createTimeseriesPlot(file, selectedChannels, timeWindow, plotConfig);
      return { data: timeseries.data, options: timeseries.options, heatmapData: null, heatmapOptions: null };
    }
    return { data: null, options: null, heatmapData: null, heatmapOptions: null };
  }, [ddaResult?.id, file?.file_path, plotType, selectedChannels, timeWindow, plotConfig, viewType, createDDAPlot, createTimeseriesPlot, createDDAHeatmap]);

  // Enable automatic plot generation
  useEffect(() => {
    if (data && options) {
      setLoading(false);
    }
  }, [data, options]);

  // Handle uPlot instance reference
  const handleUPlotRef = useCallback((chart: UPlot | null) => {
    uplotRef.current = chart;
  }, []);

  // Export functions
  const handleDownload = useCallback(async () => {
    if (!uplotRef.current) return;

    // Get the canvas from uPlot and export it
    const canvas = uplotRef.current.root.querySelector('canvas');
    if (canvas) {
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = exportFilename || `plot_${Date.now()}.${plotConfig.format}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      });
    }
  }, [exportFilename, plotConfig.format]);

  const handleSave = useCallback(async () => {
    // This would save to server storage
    throw new Error('Save to server not yet implemented');
  }, []);

  const resetView = useCallback(() => {
    // TODO: Implement reset view functionality
    console.log('Reset view not implemented');
  }, []);

  const getPlotTitle = () => {
    switch (plotType) {
      case 'timeseries':
        return `EEG Time Series - ${file?.file_name || 'Unknown'}`;
      case 'dda_scaling':
        return `DDA Scaling Analysis - ${ddaResult?.id || 'Unknown'}`;
      case 'dda_fluctuations':
        return `DDA Fluctuation Functions - ${ddaResult?.id || 'Unknown'}`;
      case 'spectrogram':
        return `EEG Spectrogram - ${file?.file_name || 'Unknown'}`;
      default:
        return 'EEG Analysis Plot';
    }
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">{getPlotTitle()}</h3>
            <Badge variant="outline">{plotType.replace('_', ' ')}</Badge>
            {selectedChannels.length > 0 && (
              <Badge variant="secondary">{selectedChannels.length} channels</Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* View Type Selector - only show for DDA plots */}
            {ddaResult && (plotType === 'dda_scaling' || plotType === 'dda_fluctuations') && (
              <>
                <Select value={viewType} onValueChange={(value: ViewType) => setViewType(value)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="line">Line Plot</SelectItem>
                    <SelectItem value="heatmap">Heatmap</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
                
                {/* Colormap selector - only show for heatmap views */}
                {(viewType === 'heatmap' || viewType === 'both') && (
                  <Select value={colormap} onValueChange={(value: any) => setColormap(value)}>
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viridis">Viridis</SelectItem>
                      <SelectItem value="plasma">Plasma</SelectItem>
                      <SelectItem value="jet">Jet</SelectItem>
                      <SelectItem value="cool">Cool</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                
                <Separator orientation="vertical" className="h-6" />
              </>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={resetView}
              disabled={!data || !options}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            
            <Separator orientation="vertical" className="h-6" />
            
            <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Export Plot</DialogTitle>
                </DialogHeader>
                
                <Tabs defaultValue="settings" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                    <TabsTrigger value="advanced">Advanced</TabsTrigger>
                  </TabsList>

                  <TabsContent value="settings" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Filename</Label>
                        <Input
                          value={exportFilename}
                          onChange={(e) => setExportFilename(e.target.value)}
                          placeholder="plot_filename"
                        />
                      </div>
                      <div>
                        <Label>Format</Label>
                        <Select 
                          value={plotConfig.format} 
                          onValueChange={(value: any) => setPlotConfig(prev => ({ ...prev, format: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(PLOT_FORMATS).map(([key, format]) => (
                              <SelectItem key={key} value={key}>
                                <div>
                                  <div className="font-medium">{format.label}</div>
                                  <div className="text-xs text-muted-foreground">{format.description}</div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label>Size Preset</Label>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {Object.entries(PRESET_SIZES).map(([key, preset]) => (
                          <Button
                            key={key}
                            variant="outline"
                            size="sm"
                            onClick={() => setPlotConfig(prev => ({
                              ...prev,
                              width: preset.width,
                              height: preset.height
                            }))}
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Width (px)</Label>
                        <Input
                          type="number"
                          value={plotConfig.width}
                          onChange={(e) => setPlotConfig(prev => ({
                            ...prev,
                            width: parseInt(e.target.value) || 800
                          }))}
                        />
                      </div>
                      <div>
                        <Label>Height (px)</Label>
                        <Input
                          type="number"
                          value={plotConfig.height}
                          onChange={(e) => setPlotConfig(prev => ({
                            ...prev,
                            height: parseInt(e.target.value) || 600
                          }))}
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Color Scheme</Label>
                      <Select 
                        value={plotConfig.color_scheme} 
                        onValueChange={(value: any) => setPlotConfig(prev => ({ ...prev, color_scheme: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(COLOR_SCHEMES).map(([key, label]) => (
                            <SelectItem key={key} value={key}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TabsContent>

                  <TabsContent value="advanced" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>DPI</Label>
                        <Select 
                          value={plotConfig.dpi.toString()} 
                          onValueChange={(value) => setPlotConfig(prev => ({ ...prev, dpi: parseInt(value) }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="72">72 DPI (Web)</SelectItem>
                            <SelectItem value="150">150 DPI (Standard)</SelectItem>
                            <SelectItem value="300">300 DPI (Print)</SelectItem>
                            <SelectItem value="600">600 DPI (High Quality)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Background</Label>
                        <Select 
                          value={plotConfig.background} 
                          onValueChange={(value: any) => setPlotConfig(prev => ({ ...prev, background: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="white">White</SelectItem>
                            <SelectItem value="transparent">Transparent</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label>Line Width: {plotConfig.line_width}</Label>
                      <Slider
                        value={[plotConfig.line_width]}
                        onValueChange={([value]) => setPlotConfig(prev => ({ ...prev, line_width: value }))}
                        min={0.5}
                        max={5}
                        step={0.1}
                        className="mt-2"
                      />
                    </div>

                    <div>
                      <Label>Font Size: {plotConfig.font_size}pt</Label>
                      <Slider
                        value={[plotConfig.font_size]}
                        onValueChange={([value]) => setPlotConfig(prev => ({ ...prev, font_size: value }))}
                        min={8}
                        max={24}
                        step={1}
                        className="mt-2"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="show-grid"
                          checked={plotConfig.show_grid}
                          onCheckedChange={(checked) => setPlotConfig(prev => ({ ...prev, show_grid: checked }))}
                        />
                        <Label htmlFor="show-grid">Show Grid</Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          id="show-legend"
                          checked={plotConfig.show_legend}
                          onCheckedChange={(checked) => setPlotConfig(prev => ({ ...prev, show_legend: checked }))}
                        />
                        <Label htmlFor="show-legend">Show Legend</Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          id="show-annotations"
                          checked={plotConfig.show_annotations}
                          onCheckedChange={(checked) => setPlotConfig(prev => ({ ...prev, show_annotations: checked }))}
                        />
                        <Label htmlFor="show-annotations">Show Annotations</Label>
                      </div>
                    </div>

                    <div>
                      <Label>Custom Title</Label>
                      <Input
                        value={plotConfig.title || ''}
                        onChange={(e) => setPlotConfig(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="Leave empty for auto-generated title"
                      />
                    </div>
                  </TabsContent>
                </Tabs>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowExportDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleDownload} disabled={!data}>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                  <Button onClick={handleSave} disabled={!data}>
                    <Save className="h-4 w-4 mr-2" />
                    Save to Server
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            
            <Button variant="outline" size="sm">
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Plot Display */}
      <div className="flex-1 p-4 overflow-auto bg-gray-50">
        <div className="flex items-center justify-center h-full">
          {loading && (
            <div className="absolute z-10 bg-white/80 rounded-lg p-4">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p>Generating plot...</p>
              </div>
            </div>
          )}
          
          {data && options ? (
            viewType === 'both' && heatmapData && heatmapOptions ? (
              <div className="w-full h-full flex flex-col gap-2">
                {/* Line Plot */}
                <div className="flex-1 min-h-48 rounded-lg border bg-white shadow-lg p-4">
                  <div className="text-sm font-medium text-muted-foreground mb-2">Line Plot</div>
                  <UPlotWrapper
                    options={options}
                    data={data}
                    onCreate={handleUPlotRef}
                  />
                </div>
                {/* Heatmap */}
                <div className="flex-1 min-h-48 rounded-lg border bg-white shadow-lg p-4">
                  <div className="text-sm font-medium text-muted-foreground mb-2">Heatmap</div>
                  <UPlotWrapper
                    options={heatmapOptions}
                    data={heatmapData}
                  />
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-full h-full min-h-96 rounded-lg border bg-white shadow-lg p-4">
                  <UPlotWrapper
                    options={options}
                    data={data}
                    onCreate={handleUPlotRef}
                  />
                </div>
              </div>
            )
          ) : !loading && (
            <div className="text-center space-y-4">
              <div className="mx-auto w-16 h-16 bg-muted rounded-lg flex items-center justify-center">
                <BarChart3 className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Plot Visualization</h3>
                <p className="text-muted-foreground">
                  {ddaResult ? 'Preparing DDA plot...' : file ? 'Preparing timeseries plot...' : 'No data available for plotting'}
                </p>
              </div>
              <Button 
                onClick={() => setLoading(true)} 
                disabled={loading}
                variant="outline"
              >
                Generate Plot
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex-shrink-0 p-2 border-t bg-muted/20 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span>Size: {plotConfig.width} × {plotConfig.height}px</span>
            <span>Format: {plotConfig.format.toUpperCase()}</span>
            <span>DPI: {plotConfig.dpi}</span>
            {data && options && (
              <span>Series: {options.series?.length ? options.series.length - 1 : 0}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span>Interactive uPlot • Drag to zoom • Double-click to reset</span>
          </div>
        </div>
      </div>
    </div>
  );
}