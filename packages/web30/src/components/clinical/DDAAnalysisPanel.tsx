"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  BarChart3, 
  Download, 
  Trash2, 
  Clock, 
  TrendingUp, 
  Settings, 
  Eye,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  FileText,
  Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { apiService, DDAAnalysisRequest, DDAResult, EDFFileInfo } from '@/services/apiService';
import { cn } from '@/lib/utils';

interface DDAAnalysisPanelProps {
  file: EDFFileInfo;
  selectedChannels: string[];
  currentTimeWindow: { start: number; end: number };
  onResultSelect: (result: DDAResult) => void;
  selectedResult?: DDAResult;
  className?: string;
}

interface DDAVariant {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  index: number;
}

const DDA_VARIANTS: DDAVariant[] = [
  {
    id: 'single_timeseries',
    name: 'Single Timeseries',
    abbreviation: 'ST',
    description: 'Single timeseries analysis for standard temporal dynamics',
    index: 0
  },
  {
    id: 'cross_timeseries',
    name: 'Cross Timeseries',
    abbreviation: 'CT', 
    description: 'Cross timeseries analysis for inter-channel relationships',
    index: 1
  },
  {
    id: 'cross_dynamical',
    name: 'Cross Dynamical',
    abbreviation: 'CD',
    description: 'Cross dynamical analysis for dynamic coupling patterns',
    index: 2
  },
  {
    id: 'dynamical_ergodicity',
    name: 'Dynamical Ergodicity',
    abbreviation: 'DE',
    description: 'Dynamical ergodicity analysis for temporal stationarity assessment',
    index: 3
  }
];

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800'
};

const STATUS_ICONS = {
  pending: Clock,
  running: RefreshCw,
  completed: CheckCircle,
  failed: AlertCircle
};

export function DDAAnalysisPanel({
  file,
  selectedChannels,
  currentTimeWindow,
  onResultSelect,
  selectedResult,
  className
}: DDAAnalysisPanelProps) {
  const [results, setResults] = useState<DDAResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVariants, setSelectedVariants] = useState<string[]>(['single_timeseries']);
  const [customParameters, setCustomParameters] = useState<DDAAnalysisRequest>({
    file_path: file.file_path,
    channels: selectedChannels,
    start_time: currentTimeWindow.start,
    end_time: currentTimeWindow.end,
    variants: ['single_timeseries'],
    window_length: 4,
    window_step: 2,
    detrending: 'linear',
    scale_min: 4,
    scale_max: 64,
    scale_num: 16
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
  const [jobProgress, setJobProgress] = useState<Record<string, number>>({});

  // Load existing results for this file
  const loadResults = useCallback(async () => {
    try {
      setLoading(true);
      const existingResults = await apiService.getDDAResults(undefined, file.file_path);
      setResults(existingResults);
    } catch (error) {
      console.error('Failed to load DDA results:', error);
    } finally {
      setLoading(false);
    }
  }, [file.file_path]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  // Update parameters when selections change
  useEffect(() => {
    setCustomParameters(prev => ({
      ...prev,
      file_path: file.file_path,
      channels: selectedChannels,
      start_time: currentTimeWindow.start,
      end_time: currentTimeWindow.end,
      variants: selectedVariants
    }));
  }, [file.file_path, selectedChannels, currentTimeWindow, selectedVariants]);

  // Handle variant selection
  const handleVariantToggle = useCallback((variantId: string) => {
    setSelectedVariants(prev => {
      const newVariants = prev.includes(variantId)
        ? prev.filter(v => v !== variantId)
        : [...prev, variantId];
      
      // Ensure at least one variant is selected
      return newVariants.length > 0 ? newVariants : ['single_timeseries'];
    });
  }, []);

  const handleSelectAllVariants = useCallback(() => {
    setSelectedVariants(DDA_VARIANTS.map(v => v.id));
  }, []);

  const handleSelectNoVariants = useCallback(() => {
    setSelectedVariants(['single_timeseries']); // Keep at least one
  }, []);

  // Run DDA analysis
  const handleRunAnalysis = useCallback(async () => {
    if (selectedChannels.length === 0) return;

    try {
      setLoading(true);
      
      // Show as running briefly for UX
      const tempJobId = `dda_temp_${Date.now()}`;
      setRunningJobs(prev => new Set([...prev, tempJobId]));
      setJobProgress(prev => ({ ...prev, [tempJobId]: 50 }));

      // Submit analysis and get immediate result
      const response = await apiService.submitDDAAnalysis(customParameters);
      
      // Remove temporary job
      setRunningJobs(prev => {
        const newSet = new Set(prev);
        newSet.delete(tempJobId);
        return newSet;
      });
      setJobProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[tempJobId];
        return newProgress;
      });

      // Refresh results to show the new analysis
      await loadResults();
      
      // Auto-select the newest result (should be the one we just created)
      const updatedResults = await apiService.getDDAResults(undefined, file.file_path);
      if (updatedResults.length > 0) {
        // Find the most recent completed result
        const newestResult = updatedResults
          .filter(r => r.status === 'completed')
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        
        if (newestResult) {
          onResultSelect(newestResult);
        }
      }
      
      // Show success message
      console.log('DDA analysis completed successfully');
      
    } catch (error) {
      console.error('Failed to run DDA analysis:', error);
      // Could add toast notification here
    } finally {
      setLoading(false);
    }
  }, [selectedChannels, customParameters, loadResults]);

  const handleDeleteResult = useCallback(async (resultId: string) => {
    try {
      await apiService.deleteDDAResult(resultId);
      await loadResults();
    } catch (error) {
      console.error('Failed to delete result:', error);
    }
  }, [loadResults]);

  const formatDuration = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  }, []);

  const estimateProcessingTime = useCallback(() => {
    const duration = currentTimeWindow.end - currentTimeWindow.start;
    const windowStep = customParameters.window_step || 2; // Provide default value
    const windowCount = Math.floor(duration / windowStep);
    const channelCount = selectedChannels.length;
    
    // Rough estimate: 0.05s per window per channel
    const estimatedSeconds = Math.max(5, windowCount * channelCount * 0.05);
    return Math.round(estimatedSeconds);
  }, [currentTimeWindow, customParameters.window_step, selectedChannels.length]);

  const getQualityScore = useCallback((result: DDAResult) => {
    // Calculate quality based on R² values and other metrics
    if (!result.results.quality_metrics) return 0;
    
    const rSquaredValues = Object.values(result.results.quality_metrics);
    const avgRSquared = rSquaredValues.reduce((sum, val) => sum + val, 0) / rSquaredValues.length;
    return Math.round(avgRSquared * 100);
  }, []);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            <h3 className="text-lg font-semibold">DDA Analysis</h3>
            <Badge variant="outline">{results.length} results</Badge>
          </div>
        </div>
      </div>

      <Tabs defaultValue="setup" className="flex-1 flex flex-col">
        <div className="flex-shrink-0 px-4 pt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="batch">Batch</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="setup" className="flex-1 p-4 space-y-4">
          {/* Quick Analysis */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={handleRunAnalysis}
                  disabled={selectedChannels.length === 0 || loading}
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
                  Preview Parameters
                </Button>
              </div>

              {/* Running Jobs Progress */}
              {runningJobs.size > 0 && (
                <div className="space-y-2">
                  {Array.from(runningJobs).map(jobId => (
                    <div key={jobId} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>Processing...</span>
                        <span>{Math.round(jobProgress[jobId] || 0)}%</span>
                      </div>
                      <Progress value={jobProgress[jobId] || 0} />
                    </div>
                  ))}
                </div>
              )}

              {/* Estimation */}
              {!loading && runningJobs.size === 0 && (
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Estimated duration: ~{estimateProcessingTime()}s
                </div>
              )}
            </CardContent>
          </Card>

          {/* Analysis Range */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Analysis Window</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span>Start:</span>
                  <span>{formatDuration(currentTimeWindow.start)}</span>
                </div>
                <div className="flex justify-between">
                  <span>End:</span>
                  <span>{formatDuration(currentTimeWindow.end)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Duration:</span>
                  <span>{formatDuration(currentTimeWindow.end - currentTimeWindow.start)}</span>
                </div>
              </div>
              
              <div className="text-xs text-muted-foreground">
                Selected channels: {selectedChannels.join(', ') || 'None'}
              </div>
            </CardContent>
          </Card>

          {/* DDA Variants */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                DDA Variants
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAllVariants}
                    className="h-6 px-2 text-xs"
                  >
                    All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectNoVariants}
                    className="h-6 px-2 text-xs"
                  >
                    None
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3">
                {DDA_VARIANTS.map((variant) => (
                  <div
                    key={variant.id}
                    className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                    onClick={() => handleVariantToggle(variant.id)}
                  >
                    <div className="flex items-center space-x-2 mt-0.5">
                      <input
                        type="checkbox"
                        checked={selectedVariants.includes(variant.id)}
                        onChange={() => handleVariantToggle(variant.id)}
                        className="rounded border-gray-300"
                      />
                      <Badge variant="outline" className="font-mono text-xs">
                        {variant.abbreviation}
                      </Badge>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{variant.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {variant.description}
                      </div>
                    </div>
                  </div>
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
                          value={[customParameters.window_length || 4]}
                          onValueChange={([value]) => setCustomParameters(prev => ({
                            ...prev,
                            window_length: value
                          }))}
                          max={30}
                          min={1}
                          step={0.5}
                          className="mt-1"
                        />
                        <div className="text-xs text-muted-foreground mt-1">
                          {customParameters.window_length || 4}s
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm">Window Step (s)</Label>
                        <Slider
                          value={[customParameters.window_step || 2]}
                          onValueChange={([value]) => setCustomParameters(prev => ({
                            ...prev,
                            window_step: value
                          }))}
                          max={customParameters.window_length || 4}
                          min={0.5}
                          step={0.5}
                          className="mt-1"
                        />
                        <div className="text-xs text-muted-foreground mt-1">
                          {customParameters.window_step || 2}s
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
                          value={customParameters.scale_min || 4}
                          onChange={(e) => setCustomParameters(prev => ({
                            ...prev,
                            scale_min: parseInt(e.target.value) || 4
                          }))}
                          min={2}
                          max={(customParameters.scale_max || 64) - 1}
                        />
                      </div>
                      <div>
                        <Label className="text-sm">Max Scale</Label>
                        <Input
                          type="number"
                          value={customParameters.scale_max || 64}
                          onChange={(e) => setCustomParameters(prev => ({
                            ...prev,
                            scale_max: parseInt(e.target.value) || 64
                          }))}
                          min={(customParameters.scale_min || 4) + 1}
                          max={512}
                        />
                      </div>
                      <div>
                        <Label className="text-sm">Scale Count</Label>
                        <Input
                          type="number"
                          value={customParameters.scale_num || 16}
                          onChange={(e) => setCustomParameters(prev => ({
                            ...prev,
                            scale_num: parseInt(e.target.value) || 16
                          }))}
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
                    <div>
                      <Label className="text-sm">Detrending</Label>
                      <Select
                        value={customParameters.detrending || 'linear'}
                        onValueChange={(value: any) => setCustomParameters(prev => ({
                          ...prev,
                          detrending: value
                        }))}
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
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </TabsContent>

        <TabsContent value="results" className="flex-1 p-4">
          {results.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <BarChart3 className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">No DDA results yet</p>
                <p className="text-sm text-muted-foreground">Run an analysis to see results here</p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-full">
              <div className="space-y-2">
                {results.map((result) => {
                  const StatusIcon = STATUS_ICONS[result.status];
                  const qualityScore = getQualityScore(result);
                  
                  return (
                    <Card 
                      key={result.id} 
                      className={cn(
                        "cursor-pointer hover:bg-muted/50 transition-colors",
                        selectedResult?.id === result.id && "ring-2 ring-primary bg-primary/5"
                      )}
                      onClick={() => onResultSelect(result)}
                    >
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <StatusIcon className={cn(
                                "h-4 w-4",
                                result.status === 'running' && "animate-spin",
                                result.status === 'completed' && "text-green-600",
                                result.status === 'failed' && "text-red-600"
                              )} />
                              <Badge variant="outline" className={STATUS_COLORS[result.status]}>
                                {result.status}
                              </Badge>
                              <Badge variant="outline">
                                DDA
                              </Badge>
                              <span className="text-sm font-medium">
                                {result.channels.length} channel{result.channels.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onResultSelect(result);
                                }}
                                disabled={result.status !== 'completed'}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Download result logic
                                }}
                                disabled={result.status !== 'completed'}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteResult(result.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <div className="text-muted-foreground">Time Range</div>
                              <div>{formatDuration(result.parameters.start_time)} - {formatDuration(result.parameters.end_time)}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Window</div>
                              <div>{result.parameters.window_length}s / {result.parameters.window_step}s</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Scales</div>
                              <div>{result.parameters.scale_min}-{result.parameters.scale_max} ({result.parameters.scale_num})</div>
                            </div>
                            {result.status === 'completed' && (
                              <div>
                                <div className="text-muted-foreground">Quality</div>
                                <div className="flex items-center gap-1">
                                  <TrendingUp className="h-3 w-3" />
                                  {qualityScore}%
                                </div>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <div>
                              Created: {new Date(result.created_at).toLocaleString()}
                            </div>
                            {result.completed_at && (
                              <div>
                                Completed: {new Date(result.completed_at).toLocaleString()}
                              </div>
                            )}
                          </div>
                          
                          {result.error_message && (
                            <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                              Error: {result.error_message}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="batch" className="flex-1 p-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Batch Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                Batch analysis features coming soon...
                <ul className="mt-2 ml-4 list-disc">
                  <li>Process multiple time windows</li>
                  <li>Channel-wise batch processing</li>
                  <li>Automated parameter sweeps</li>
                  <li>Export batch results</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}