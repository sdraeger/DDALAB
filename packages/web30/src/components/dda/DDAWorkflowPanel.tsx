"use client";

import React, { useState, useCallback, useMemo } from 'react';
import { Play, Save, Download, Eye, BarChart3, Settings, Clock, Users, Zap, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DDAParameters, DDAResult, TimeWindow } from '@/types/eeg';
import { cn } from '@/lib/utils';

interface DDAWorkflowPanelProps {
  selectedChannels: string[];
  timeWindow: TimeWindow;
  totalDuration: number;
  sampleRate: number;
  onRunDDA: (parameters: DDAParameters, channels: string[], timeRange: [number, number]) => Promise<DDAResult>;
  results: DDAResult[];
  onResultSelect: (result: DDAResult) => void;
  onResultDelete: (resultId: string) => void;
  isProcessing?: boolean;
  processingProgress?: number;
  className?: string;
}

interface DDAPreset {
  id: string;
  name: string;
  description: string;
  parameters: DDAParameters;
  tags: string[];
}

const DEFAULT_PRESETS: DDAPreset[] = [
  {
    id: 'standard',
    name: 'Standard DFA',
    description: 'Standard detrended fluctuation analysis',
    parameters: {
      windowLength: 4,
      windowStep: 2,
      detrending: 'linear',
      fluctuation: 'dfa',
      qOrder: [2],
      scaleMin: 4,
      scaleMax: 64,
      scaleNum: 16
    },
    tags: ['standard', 'dfa']
  },
  {
    id: 'multifractal',
    name: 'Multifractal DFA',
    description: 'Multifractal analysis with multiple q-orders',
    parameters: {
      windowLength: 4,
      windowStep: 2,
      detrending: 'linear',
      fluctuation: 'mfdfa',
      qOrder: [-5, -3, -1, 0, 1, 2, 3, 4, 5],
      scaleMin: 4,
      scaleMax: 128,
      scaleNum: 20
    },
    tags: ['multifractal', 'mfdfa']
  },
  {
    id: 'high_resolution',
    name: 'High Resolution',
    description: 'Fine-grained analysis with small windows',
    parameters: {
      windowLength: 2,
      windowStep: 1,
      detrending: 'linear',
      fluctuation: 'dfa',
      qOrder: [2],
      scaleMin: 2,
      scaleMax: 32,
      scaleNum: 24
    },
    tags: ['high-res', 'detailed']
  },
  {
    id: 'fast',
    name: 'Fast Analysis',
    description: 'Quick analysis with larger windows',
    parameters: {
      windowLength: 8,
      windowStep: 4,
      detrending: 'linear',
      fluctuation: 'dfa',
      qOrder: [2],
      scaleMin: 8,
      scaleMax: 64,
      scaleNum: 12
    },
    tags: ['fast', 'preview']
  }
];

export function DDAWorkflowPanel({
  selectedChannels,
  timeWindow,
  totalDuration,
  sampleRate,
  onRunDDA,
  results,
  onResultSelect,
  onResultDelete,
  isProcessing = false,
  processingProgress = 0,
  className
}: DDAWorkflowPanelProps) {
  const [parameters, setParameters] = useState<DDAParameters>(DEFAULT_PRESETS[0].parameters);
  const [selectedPreset, setSelectedPreset] = useState<string>('standard');
  const [customPresetName, setCustomPresetName] = useState('');
  const [analysisRange, setAnalysisRange] = useState<'current' | 'full' | 'custom'>('current');
  const [customRange, setCustomRange] = useState<[number, number]>([0, 30]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const estimatedDuration = useMemo(() => {
    const range = analysisRange === 'current' 
      ? timeWindow.duration
      : analysisRange === 'full' 
        ? totalDuration 
        : customRange[1] - customRange[0];
    
    const windowCount = Math.floor(range / parameters.windowStep);
    const channelCount = selectedChannels.length;
    
    // Rough estimate: 0.1s per window per channel
    return Math.max(1, Math.round((windowCount * channelCount * 0.1) / 10) * 10);
  }, [parameters, selectedChannels.length, analysisRange, timeWindow.duration, totalDuration, customRange]);

  const handleParameterChange = useCallback((key: keyof DDAParameters, value: any) => {
    setParameters(prev => ({ ...prev, [key]: value }));
    setSelectedPreset('custom');
  }, []);

  const handlePresetSelect = useCallback((presetId: string) => {
    const preset = DEFAULT_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setParameters(preset.parameters);
      setSelectedPreset(presetId);
    }
  }, []);

  const handleRunAnalysis = useCallback(async () => {
    if (selectedChannels.length === 0) return;

    let timeRange: [number, number];
    switch (analysisRange) {
      case 'current':
        timeRange = [timeWindow.start, timeWindow.end];
        break;
      case 'full':
        timeRange = [0, totalDuration];
        break;
      case 'custom':
        timeRange = customRange;
        break;
      default:
        timeRange = [timeWindow.start, timeWindow.end];
    }

    try {
      await onRunDDA(parameters, selectedChannels, timeRange);
    } catch (error) {
      console.error('DDA analysis failed:', error);
    }
  }, [parameters, selectedChannels, analysisRange, timeWindow, totalDuration, customRange, onRunDDA]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          <h3 className="text-lg font-semibold">DDA Analysis</h3>
          {results.length > 0 && (
            <Badge variant="outline">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="setup" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="batch">Batch</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="space-y-4">
          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={handleRunAnalysis}
                  disabled={selectedChannels.length === 0 || isProcessing}
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  Run DDA ({selectedChannels.length} channels)
                </Button>
                <Button
                  variant="outline"
                  disabled={selectedChannels.length === 0}
                  className="gap-2"
                >
                  <Eye className="h-4 w-4" />
                  Preview
                </Button>
              </div>

              {/* Progress */}
              {isProcessing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Processing...</span>
                    <span>{Math.round(processingProgress)}%</span>
                  </div>
                  <Progress value={processingProgress} />
                </div>
              )}

              {/* Estimation */}
              {!isProcessing && (
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Estimated duration: ~{estimatedDuration}s
                </div>
              )}
            </CardContent>
          </Card>

          {/* Analysis Range */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Analysis Range</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={analysisRange} onValueChange={(value: any) => setAnalysisRange(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">
                    Current Time Window ({timeWindow.duration.toFixed(1)}s)
                  </SelectItem>
                  <SelectItem value="full">
                    Full Recording ({totalDuration.toFixed(1)}s)
                  </SelectItem>
                  <SelectItem value="custom">
                    Custom Range
                  </SelectItem>
                </SelectContent>
              </Select>

              {analysisRange === 'custom' && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-sm">Start (s)</Label>
                      <Input
                        type="number"
                        value={customRange[0]}
                        onChange={(e) => setCustomRange([parseFloat(e.target.value) || 0, customRange[1]])}
                        min={0}
                        max={totalDuration}
                        step={0.1}
                      />
                    </div>
                    <div>
                      <Label className="text-sm">End (s)</Label>
                      <Input
                        type="number"
                        value={customRange[1]}
                        onChange={(e) => setCustomRange([customRange[0], parseFloat(e.target.value) || totalDuration])}
                        min={customRange[0]}
                        max={totalDuration}
                        step={0.1}
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Parameter Presets */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Parameter Presets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {DEFAULT_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    variant={selectedPreset === preset.id ? "default" : "outline"}
                    onClick={() => handlePresetSelect(preset.id)}
                    className="h-auto p-3 text-left"
                  >
                    <div>
                      <div className="font-medium text-sm">{preset.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {preset.description}
                      </div>
                      <div className="flex gap-1 mt-1">
                        {preset.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Advanced Parameters */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <Card>
              <CardHeader className="pb-3">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between p-0">
                    <CardTitle className="text-base">Advanced Parameters</CardTitle>
                    <Settings className={cn("h-4 w-4 transition-transform", showAdvanced && "rotate-90")} />
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>

              <CollapsibleContent>
                <CardContent className="space-y-4">
                  {/* Window Parameters */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Window Parameters</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm">Window Length (s)</Label>
                        <Slider
                          value={[parameters.windowLength]}
                          onValueChange={([value]) => handleParameterChange('windowLength', value)}
                          max={30}
                          min={1}
                          step={0.5}
                          className="mt-1"
                        />
                        <div className="text-xs text-muted-foreground mt-1">
                          {parameters.windowLength}s
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm">Window Step (s)</Label>
                        <Slider
                          value={[parameters.windowStep]}
                          onValueChange={([value]) => handleParameterChange('windowStep', value)}
                          max={parameters.windowLength}
                          min={0.5}
                          step={0.5}
                          className="mt-1"
                        />
                        <div className="text-xs text-muted-foreground mt-1">
                          {parameters.windowStep}s
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Scale Parameters */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Scale Parameters</Label>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-sm">Min Scale</Label>
                        <Input
                          type="number"
                          value={parameters.scaleMin}
                          onChange={(e) => handleParameterChange('scaleMin', parseInt(e.target.value) || 4)}
                          min={2}
                          max={parameters.scaleMax - 1}
                        />
                      </div>
                      <div>
                        <Label className="text-sm">Max Scale</Label>
                        <Input
                          type="number"
                          value={parameters.scaleMax}
                          onChange={(e) => handleParameterChange('scaleMax', parseInt(e.target.value) || 64)}
                          min={parameters.scaleMin + 1}
                          max={256}
                        />
                      </div>
                      <div>
                        <Label className="text-sm">Scale Count</Label>
                        <Input
                          type="number"
                          value={parameters.scaleNum}
                          onChange={(e) => handleParameterChange('scaleNum', parseInt(e.target.value) || 16)}
                          min={8}
                          max={50}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Analysis Method */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Analysis Method</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm">Detrending</Label>
                        <Select
                          value={parameters.detrending}
                          onValueChange={(value: any) => handleParameterChange('detrending', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="linear">Linear</SelectItem>
                            <SelectItem value="polynomial">Polynomial</SelectItem>
                            <SelectItem value="none">None</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-sm">Fluctuation</Label>
                        <Select
                          value={parameters.fluctuation}
                          onValueChange={(value: any) => handleParameterChange('fluctuation', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dfa">DFA</SelectItem>
                            <SelectItem value="mfdfa">Multifractal DFA</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* Q-orders for multifractal */}
                  {parameters.fluctuation === 'mfdfa' && (
                    <div>
                      <Label className="text-sm font-medium">Q-orders</Label>
                      <Input
                        value={parameters.qOrder.join(', ')}
                        onChange={(e) => {
                          const values = e.target.value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
                          handleParameterChange('qOrder', values);
                        }}
                        placeholder="e.g., -5, -3, -1, 0, 1, 2, 3, 4, 5"
                        className="mt-1"
                      />
                      <div className="text-xs text-muted-foreground mt-1">
                        Comma-separated list of q-order values
                      </div>
                    </div>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </TabsContent>

        <TabsContent value="results" className="space-y-4">
          {results.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <BarChart3 className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">No DDA results yet</p>
                <p className="text-sm text-muted-foreground">Run an analysis to see results here</p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-96">
              <div className="space-y-2">
                {results.map((result) => (
                  <Card key={result.id} className="cursor-pointer hover:bg-muted/50">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {result.parameters.fluctuation.toUpperCase()}
                            </Badge>
                            <span className="text-sm font-medium">
                              {result.channels.length} channel{result.channels.length !== 1 ? 's' : ''}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {result.timeRange[0].toFixed(1)}-{result.timeRange[1].toFixed(1)}s
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {result.timestamp.toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onResultSelect(result)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onResultDelete(result.id)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="batch" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Batch Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                Batch analysis features coming soon...
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}