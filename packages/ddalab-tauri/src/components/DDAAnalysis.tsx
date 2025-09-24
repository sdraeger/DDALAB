'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { ApiService } from '@/services/apiService'
import { DDAAnalysisRequest, DDAResult } from '@/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { 
  Play, 
  Settings,
  Download,
  BarChart3,
  AlertCircle,
  CheckCircle,
  Clock,
  Cpu,
  Brain
} from 'lucide-react'

interface DDAAnalysisProps {
  apiService: ApiService
}

interface DDAParameters {
  variants: string[]
  windowLength: number
  windowStep: number
  detrending: 'linear' | 'polynomial' | 'none'
  scaleMin: number
  scaleMax: number
  scaleNum: number
  timeStart: number
  timeEnd: number
  selectedChannels: string[]
  preprocessing: {
    highpass?: number
    lowpass?: number
    notch?: number[]
  }
}

export function DDAAnalysis({ apiService }: DDAAnalysisProps) {
  const { fileManager, dda, setCurrentAnalysis, addAnalysisToHistory, updateAnalysisParameters, setDDARunning } = useAppStore()
  
  const [parameters, setParameters] = useState<DDAParameters>({
    variants: ['single_timeseries'],
    windowLength: 100,
    windowStep: 10,
    detrending: 'linear',
    scaleMin: 1,
    scaleMax: 20,
    scaleNum: 20,
    timeStart: 0,
    timeEnd: 30,
    selectedChannels: [],
    preprocessing: {
      highpass: 0.5,
      lowpass: 70,
      notch: [50]
    }
  })

  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [analysisStatus, setAnalysisStatus] = useState<string>('')
  const [estimatedTime, setEstimatedTime] = useState<number>(0)
  const [results, setResults] = useState<DDAResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const availableVariants = [
    { id: 'single_timeseries', name: 'Single Timeseries (ST)', description: 'Standard temporal dynamics analysis' },
    { id: 'cross_timeseries', name: 'Cross Timeseries (CT)', description: 'Inter-channel relationship analysis' },
    { id: 'cross_dynamical', name: 'Cross Dynamical (CD)', description: 'Dynamic coupling pattern analysis' },
    { id: 'dynamical_ergodicity', name: 'Dynamical Ergodicity (DE)', description: 'Temporal stationarity assessment' }
  ]

  // Initialize with file data
  useEffect(() => {
    if (fileManager.selectedFile) {
      const defaultChannels = fileManager.selectedFile.channels.slice(0, Math.min(8, fileManager.selectedFile.channels.length))
      setParameters(prev => ({
        ...prev,
        selectedChannels: defaultChannels,
        timeEnd: Math.min(30, fileManager.selectedFile?.duration || 30)
      }))
    }
  }, [fileManager.selectedFile])

  // Estimate processing time
  useEffect(() => {
    const channelCount = parameters.selectedChannels.length
    const timeRange = parameters.timeEnd - parameters.timeStart
    const windowCount = Math.floor(timeRange / parameters.windowStep)
    const variantCount = parameters.variants.length
    
    // Rough estimate: base time + channels * windows * variants * scale points
    const baseTime = 2 // seconds
    const perOperationTime = 0.01 // seconds per operation
    const totalOperations = channelCount * windowCount * variantCount * parameters.scaleNum
    const estimated = baseTime + (totalOperations * perOperationTime)
    
    setEstimatedTime(Math.round(estimated))
  }, [parameters])

  const runAnalysis = async () => {
    if (!fileManager.selectedFile || parameters.selectedChannels.length === 0) {
      setError('Please select a file and at least one channel')
      return
    }

    try {
      setIsRunning(true)
      setDDARunning(true)
      setError(null)
      setProgress(0)
      setAnalysisStatus('Preparing analysis...')

      // Prepare the analysis request
      const request: DDAAnalysisRequest = {
        file_path: fileManager.selectedFile.file_path,
        channels: parameters.selectedChannels,
        start_time: parameters.timeStart,
        end_time: parameters.timeEnd,
        variants: parameters.variants,
        window_length: parameters.windowLength,
        window_step: parameters.windowStep,
        detrending: parameters.detrending,
        scale_min: parameters.scaleMin,
        scale_max: parameters.scaleMax,
        scale_num: parameters.scaleNum
      }

      setAnalysisStatus('Running DDA analysis on server...')
      setProgress(50)
      
      // Use the real API result
      const result = await apiService.submitDDAAnalysis(request)
      
      setAnalysisStatus('Processing results...')
      setProgress(95)
      
      setResults(result)
      setCurrentAnalysis(result)
      addAnalysisToHistory(result)
      
      setAnalysisStatus('Analysis completed successfully!')
      setProgress(100)

      // Save parameters
      updateAnalysisParameters({
        variants: parameters.variants,
        windowLength: parameters.windowLength,
        windowStep: parameters.windowStep,
        detrending: parameters.detrending,
        scaleMin: parameters.scaleMin,
        scaleMax: parameters.scaleMax,
        scaleNum: parameters.scaleNum
      })

    } catch (err) {
      console.error('DDA analysis failed:', err)
      setError(err instanceof Error ? err.message : 'Analysis failed')
      setAnalysisStatus('Analysis failed')
    } finally {
      setIsRunning(false)
      setDDARunning(false)
    }
  }

  const resetParameters = () => {
    setParameters({
      variants: ['single_timeseries'],
      windowLength: 100,
      windowStep: 10,
      detrending: 'linear',
      scaleMin: 1,
      scaleMax: 20,
      scaleNum: 20,
      timeStart: 0,
      timeEnd: Math.min(30, fileManager.selectedFile?.duration || 30),
      selectedChannels: fileManager.selectedFile?.channels.slice(0, 8) || [],
      preprocessing: {
        highpass: 0.5,
        lowpass: 70,
        notch: [50]
      }
    })
  }

  const handleChannelToggle = (channel: string, checked: boolean) => {
    setParameters(prev => ({
      ...prev,
      selectedChannels: checked 
        ? [...prev.selectedChannels, channel]
        : prev.selectedChannels.filter(ch => ch !== channel)
    }))
  }

  if (!fileManager.selectedFile) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent>
          <div className="text-center">
            <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No File Selected</h3>
            <p className="text-muted-foreground">
              Select an EDF file from the file manager to start DDA analysis
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="h-full flex flex-col space-y-4">
      <Tabs defaultValue="parameters" className="flex-1 flex flex-col">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="parameters">Parameters</TabsTrigger>
            <TabsTrigger value="results" disabled={!results}>Results</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={resetParameters}>
              Reset
            </Button>
            <Button 
              onClick={runAnalysis} 
              disabled={isRunning || parameters.selectedChannels.length === 0}
              className="min-w-[120px]"
            >
              {isRunning ? (
                <>
                  <Cpu className="h-4 w-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run DDA
                </>
              )}
            </Button>
          </div>
        </div>

        <TabsContent value="parameters" className="flex-1 space-y-4">
          {/* Analysis Status */}
          {(isRunning || results) && (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {isRunning ? (
                        <Cpu className="h-4 w-4 animate-spin text-blue-600" />
                      ) : results ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-600" />
                      )}
                      <span className="text-sm font-medium">{analysisStatus}</span>
                    </div>
                    {isRunning && (
                      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>~{estimatedTime}s estimated</span>
                      </div>
                    )}
                  </div>
                  
                  {isRunning && (
                    <Progress value={progress} className="w-full" />
                  )}
                  
                  {error && (
                    <div className="flex items-center space-x-2 text-red-600">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm">{error}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Algorithm Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Algorithm Selection</CardTitle>
                <CardDescription>Choose DDA variants to compute</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {availableVariants.map(variant => (
                  <div key={variant.id} className="flex items-start space-x-3">
                    <Checkbox
                      checked={parameters.variants.includes(variant.id)}
                      onCheckedChange={(checked) => {
                        setParameters(prev => ({
                          ...prev,
                          variants: checked 
                            ? [...prev.variants, variant.id]
                            : prev.variants.filter(v => v !== variant.id)
                        }))
                      }}
                      disabled={isRunning}
                    />
                    <div className="flex-1 min-w-0">
                      <Label className="text-sm font-medium">{variant.name}</Label>
                      <p className="text-xs text-muted-foreground mt-1">{variant.description}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Time Range */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Time Range</CardTitle>
                <CardDescription>Analysis time window</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm">Start Time (s)</Label>
                  <Input
                    type="number"
                    value={parameters.timeStart}
                    onChange={(e) => setParameters(prev => ({ 
                      ...prev, 
                      timeStart: Math.max(0, parseFloat(e.target.value) || 0)
                    }))}
                    disabled={isRunning}
                    min="0"
                    max={fileManager.selectedFile?.duration}
                    step="0.1"
                  />
                </div>
                <div>
                  <Label className="text-sm">End Time (s)</Label>
                  <Input
                    type="number"
                    value={parameters.timeEnd}
                    onChange={(e) => setParameters(prev => ({ 
                      ...prev, 
                      timeEnd: Math.min(fileManager.selectedFile?.duration || 0, parseFloat(e.target.value) || 30)
                    }))}
                    disabled={isRunning}
                    min={parameters.timeStart + 1}
                    max={fileManager.selectedFile?.duration}
                    step="0.1"
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  Duration: {(parameters.timeEnd - parameters.timeStart).toFixed(1)}s
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Window Parameters */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Window Parameters</CardTitle>
                <CardDescription>Analysis window configuration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm">Window Length: {parameters.windowLength}</Label>
                  <Slider
                    value={[parameters.windowLength]}
                    onValueChange={([value]) => setParameters(prev => ({ ...prev, windowLength: value }))}
                    disabled={isRunning}
                    min={50}
                    max={500}
                    step={10}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label className="text-sm">Window Step: {parameters.windowStep}</Label>
                  <Slider
                    value={[parameters.windowStep]}
                    onValueChange={([value]) => setParameters(prev => ({ ...prev, windowStep: value }))}
                    disabled={isRunning}
                    min={1}
                    max={50}
                    step={1}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label className="text-sm">Detrending</Label>
                  <Select
                    value={parameters.detrending}
                    onValueChange={(value: 'linear' | 'polynomial' | 'none') => 
                      setParameters(prev => ({ ...prev, detrending: value }))
                    }
                    disabled={isRunning}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="linear">Linear</SelectItem>
                      <SelectItem value="polynomial">Polynomial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Scale Parameters */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scale Parameters</CardTitle>
                <CardDescription>Scale range for fluctuation analysis</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-sm">Min Scale</Label>
                    <Input
                      type="number"
                      value={parameters.scaleMin}
                      onChange={(e) => setParameters(prev => ({ 
                        ...prev, 
                        scaleMin: Math.max(1, parseInt(e.target.value) || 1)
                      }))}
                      disabled={isRunning}
                      min="1"
                      max={parameters.scaleMax - 1}
                    />
                  </div>
                  <div>
                    <Label className="text-sm">Max Scale</Label>
                    <Input
                      type="number"
                      value={parameters.scaleMax}
                      onChange={(e) => setParameters(prev => ({ 
                        ...prev, 
                        scaleMax: Math.max(parameters.scaleMin + 1, parseInt(e.target.value) || 20)
                      }))}
                      disabled={isRunning}
                      min={parameters.scaleMin + 1}
                      max="100"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Number of Scales: {parameters.scaleNum}</Label>
                  <Slider
                    value={[parameters.scaleNum]}
                    onValueChange={([value]) => setParameters(prev => ({ ...prev, scaleNum: value }))}
                    disabled={isRunning}
                    min={5}
                    max={50}
                    step={1}
                    className="mt-2"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Channel Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Channel Selection ({parameters.selectedChannels.length} of {fileManager.selectedFile.channels.length})
              </CardTitle>
              <CardDescription>Select channels for DDA analysis</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {fileManager.selectedFile.channels.map(channel => (
                  <Badge
                    key={channel}
                    variant={parameters.selectedChannels.includes(channel) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => handleChannelToggle(channel, !parameters.selectedChannels.includes(channel))}
                  >
                    {channel}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Analysis Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Analysis Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Channels</Label>
                  <p className="font-medium">{parameters.selectedChannels.length}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Time Range</Label>
                  <p className="font-medium">{(parameters.timeEnd - parameters.timeStart).toFixed(1)}s</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Variants</Label>
                  <p className="font-medium">{parameters.variants.length}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Est. Time</Label>
                  <p className="font-medium">{estimatedTime}s</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="results" className="flex-1">
          {results ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Analysis Results</CardTitle>
                  <CardDescription>
                    Completed at {new Date(results.completed_at || '').toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <Label className="text-muted-foreground">Channels Analyzed</Label>
                      <p className="font-medium">{results.channels.length}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Mean R²</Label>
                      <p className="font-medium">{(results.results.quality_metrics.mean_r_squared * 100).toFixed(1)}%</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Processing Time</Label>
                      <p className="font-medium">{results.results.quality_metrics.processing_time}s</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Exponent Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Scaling Exponents</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(results.results.exponents).map(([channel, exponent]) => (
                      <div key={channel} className="flex justify-between">
                        <span>{channel}</span>
                        <span className="font-medium">{exponent.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="h-full flex items-center justify-center">
              <CardContent>
                <div className="text-center">
                  <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Results</h3>
                  <p className="text-muted-foreground">Run an analysis to see results</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="flex-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Analysis History</CardTitle>
              <CardDescription>{dda.analysisHistory.length} analyses performed</CardDescription>
            </CardHeader>
            <CardContent>
              {dda.analysisHistory.length > 0 ? (
                <div className="space-y-2">
                  {dda.analysisHistory.map(analysis => (
                    <div
                      key={analysis.id}
                      className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-accent"
                      onClick={() => setResults(analysis)}
                    >
                      <div>
                        <p className="font-medium text-sm">{analysis.file_path.split('/').pop()}</p>
                        <p className="text-xs text-muted-foreground">
                          {analysis.channels.length} channels • {new Date(analysis.created_at).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {(analysis.results.quality_metrics.mean_r_squared * 100).toFixed(0)}% R²
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No analyses performed yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}