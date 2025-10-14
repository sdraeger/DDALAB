'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import { ApiService } from '@/services/apiService'
import { DDAAnalysisRequest, DDAResult } from '@/types/api'
import { DDAResults } from '@/components/DDAResults'
import { useWorkflow } from '@/hooks/useWorkflow'
import { createSetDDAParametersAction, createRunDDAAnalysisAction } from '@/types/workflow'
import { useSubmitDDAAnalysis, useDDAProgress, useSaveDDAToHistory } from '@/hooks/useDDAAnalysis'
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
  Brain,
  RefreshCw
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
  // Use granular selectors to prevent unnecessary re-renders
  const fileManager = useAppStore((state) => state.fileManager)
  const storedAnalysisParameters = useAppStore((state) => state.dda.analysisParameters)
  const currentAnalysis = useAppStore((state) => state.dda.currentAnalysis)
  // Only subscribe to history count to avoid re-renders when history updates during analysis
  const analysisHistoryCount = useAppStore((state) => state.dda.analysisHistory.length)
  // Get the actual history array once initially, but don't subscribe to updates
  const [analysisHistory, setAnalysisHistoryLocal] = useState(() => useAppStore.getState().dda.analysisHistory)
  const isRunning = useAppStore((state) => state.dda.isRunning)
  const workflowRecording = useAppStore((state) => state.workflowRecording)
  const setCurrentAnalysis = useAppStore((state) => state.setCurrentAnalysis)
  const addAnalysisToHistory = useAppStore((state) => state.addAnalysisToHistory)
  const setAnalysisHistory = useAppStore((state) => state.setAnalysisHistory)
  const updateAnalysisParameters = useAppStore((state) => state.updateAnalysisParameters)
  const setDDARunning = useAppStore((state) => state.setDDARunning)
  const incrementActionCount = useAppStore((state) => state.incrementActionCount)

  const { recordAction } = useWorkflow()

  // TanStack Query: Submit DDA analysis mutation
  const submitAnalysisMutation = useSubmitDDAAnalysis(apiService)
  const saveToHistoryMutation = useSaveDDAToHistory(apiService)

  // Track progress from Tauri events for the current analysis
  const progressEvent = useDDAProgress(
    submitAnalysisMutation.data?.id,
    submitAnalysisMutation.isPending
  )

  // Store ALL parameters locally for instant UI updates - only sync to store when running analysis
  const [localParameters, setLocalParameters] = useState<DDAParameters>({
    variants: storedAnalysisParameters.variants,
    windowLength: storedAnalysisParameters.windowLength,
    windowStep: storedAnalysisParameters.windowStep,
    detrending: storedAnalysisParameters.detrending,
    scaleMin: storedAnalysisParameters.scaleMin,
    scaleMax: storedAnalysisParameters.scaleMax,
    scaleNum: storedAnalysisParameters.scaleNum,
    timeStart: 0,
    timeEnd: 30,
    selectedChannels: [],
    preprocessing: {
      highpass: 0.5,
      lowpass: 70,
      notch: [50]
    }
  })

  // Use local parameters directly - no need to merge with store
  const parameters = localParameters

  const [localIsRunning, setLocalIsRunning] = useState(false) // Local UI state for this component
  const [results, setResults] = useState<DDAResult | null>(null)

  // Derive state from mutation and progress events
  const progress = progressEvent?.progress_percent || (submitAnalysisMutation.isPending ? 50 : 0)
  const analysisStatus = progressEvent?.current_step ||
    (submitAnalysisMutation.isPending ? 'Running DDA analysis...' :
     submitAnalysisMutation.isSuccess ? 'Analysis completed successfully!' : '')
  const error = submitAnalysisMutation.error ?
    (submitAnalysisMutation.error as Error).message : null
  const [previewingAnalysis, setPreviewingAnalysis] = useState<DDAResult | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' })
  const [autoLoadingResults, setAutoLoadingResults] = useState(false)

  // Calculate estimated time using useMemo to avoid re-running on every render
  const estimatedTime = useMemo(() => {
    const channelCount = parameters.selectedChannels.length
    const timeRange = parameters.timeEnd - parameters.timeStart
    const windowCount = Math.floor(timeRange / parameters.windowStep)
    const variantCount = parameters.variants.length

    // Rough estimate: base time + channels * windows * variants * scale points
    const baseTime = 2 // seconds
    const perOperationTime = 0.01 // seconds per operation
    const totalOperations = channelCount * windowCount * variantCount * parameters.scaleNum
    const estimated = baseTime + (totalOperations * perOperationTime)

    return Math.round(estimated)
  }, [parameters.selectedChannels.length, parameters.timeEnd, parameters.timeStart, parameters.windowStep, parameters.variants.length, parameters.scaleNum])

  // Refresh analysis history from MinIO (called by Refresh button)
  const loadAnalysisHistoryRef = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const history = await apiService.getAnalysisHistory()
      setAnalysisHistory(history)
      setAnalysisHistoryLocal(history) // Update local state to show new history
    } catch (error) {
      console.error('Failed to load analysis history:', error)
      setHistoryError('Failed to load analysis history')
    } finally {
      setHistoryLoading(false)
    }
  }, [apiService, setAnalysisHistory])

  // Save analysis to history when completed
  const saveAnalysisToHistory = useCallback(async (result: DDAResult) => {
    try {
      setSaveStatus({ type: null, message: 'Saving analysis to history...' })

      const success = await apiService.saveAnalysisToHistory(result)
      if (success) {
        setSaveStatus({ type: 'success', message: 'Analysis saved to history successfully!' })

        // Add to local history immediately instead of reloading entire history (performance optimization)
        setAnalysisHistoryLocal(prev => [result, ...prev])

        // Clear success message after 3 seconds
        setTimeout(() => setSaveStatus({ type: null, message: '' }), 3000)
      } else {
        setSaveStatus({ type: 'error', message: 'Failed to save analysis to history. Server returned false.' })
      }
    } catch (error) {
      console.error('Error saving analysis to history:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      setSaveStatus({ type: 'error', message: `Failed to save analysis: ${errorMessage}` })
    }
  }, [apiService])

  // Preview analysis from history in dedicated window
  const previewAnalysis = useCallback(async (analysis: DDAResult) => {
    try {
      // Validate analysis object
      if (!analysis || !analysis.id) {
        console.error('Invalid analysis object:', analysis)
        setHistoryError('Invalid analysis data')
        return
      }

      console.log('Preview analysis - Using ID for lookup:', analysis.id)

      // Get full analysis data from history (in case the list only has metadata)
      const fullAnalysis = await apiService.getAnalysisFromHistory(analysis.id)
      if (fullAnalysis) {
        // Import TauriService dynamically to avoid SSR issues
        const { TauriService } = await import('@/services/tauriService')
        const tauriService = TauriService.getInstance()

        // Open analysis preview in dedicated window
        await tauriService.openAnalysisPreviewWindow(fullAnalysis)

        // Still set the previewing analysis for the blue notification
        setPreviewingAnalysis(fullAnalysis)
      } else {
        console.warn('No analysis data returned for ID:', analysis.id)
        setHistoryError('Analysis data not found')
      }
    } catch (error) {
      console.error('Failed to load analysis preview:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setHistoryError(`Failed to load analysis preview: ${errorMessage}`)
    }
  }, [apiService])

  // Note: Analysis history is loaded by DashboardLayout on app startup
  // This component only refreshes when the user clicks the Refresh button
  // or after saving a new analysis

  // Sync local results with current analysis from store
  useEffect(() => {
    if (currentAnalysis && !results) {
      setResults(currentAnalysis)
    }
  }, [currentAnalysis, results])

  const availableVariants = [
    { id: 'single_timeseries', name: 'Single Timeseries (ST)', description: 'Standard temporal dynamics analysis' },
    { id: 'cross_timeseries', name: 'Cross Timeseries (CT)', description: 'Inter-channel relationship analysis' },
    { id: 'cross_dynamical', name: 'Cross Dynamical (CD)', description: 'Dynamic coupling pattern analysis' },
    { id: 'dynamical_ergodicity', name: 'Dynamical Ergodicity (DE)', description: 'Temporal stationarity assessment' }
  ]

  // Initialize with file data - only run when file changes
  useEffect(() => {
    if (fileManager.selectedFile) {
      const defaultChannels = fileManager.selectedFile.channels.slice(0, Math.min(8, fileManager.selectedFile.channels.length))
      // Calculate default window length as 1/4 second (0.25 * sampling_rate)
      const defaultWindowLength = Math.round(0.25 * fileManager.selectedFile.sample_rate)

      setLocalParameters(prev => ({
        ...prev,
        selectedChannels: defaultChannels,
        timeEnd: Math.min(30, fileManager.selectedFile?.duration || 30)
      }))

      // Update window length based on sampling rate
      setLocalParameters(prev => ({ ...prev, windowLength: defaultWindowLength }))
    }
  }, [fileManager.selectedFile?.file_path]) // Only depend on file path to avoid unnecessary re-runs

  const runAnalysis = async () => {
    if (!fileManager.selectedFile || parameters.selectedChannels.length === 0) {
      // Can't use setError directly anymore, error comes from mutation
      console.error('Please select a file and at least one channel')
      return
    }

    // Sync local parameters to store when running analysis
    updateAnalysisParameters({
      variants: parameters.variants,
      windowLength: parameters.windowLength,
      windowStep: parameters.windowStep,
      detrending: parameters.detrending,
      scaleMin: parameters.scaleMin,
      scaleMax: parameters.scaleMax,
      scaleNum: parameters.scaleNum
    })

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

    // Record DDA parameters if recording is active
    if (workflowRecording.isRecording) {
      try {
        const paramAction = createSetDDAParametersAction(
          parameters.scaleMin, // lag (using scaleMin as proxy)
          4, // dimension (default)
          parameters.windowLength,
          parameters.windowStep
        )
        await recordAction(paramAction)
        incrementActionCount()
        console.log('[WORKFLOW] Recorded DDA parameters')
      } catch (error) {
        console.error('[WORKFLOW] Failed to record DDA parameters:', error)
      }
    }

    // Submit analysis using mutation
    setLocalIsRunning(true)
    setDDARunning(true)

    submitAnalysisMutation.mutate(request, {
      onSuccess: (result) => {
        setResults(result)
        setCurrentAnalysis(result)
        addAnalysisToHistory(result)
        setLocalIsRunning(false)
        setDDARunning(false)

        // Record DDA analysis execution if recording is active
        if (workflowRecording.isRecording && fileManager.selectedFile) {
          // Convert channel names to their actual indices in the file's channel list
          const channelIndices = parameters.selectedChannels
            .map(channelName => fileManager.selectedFile!.channels.indexOf(channelName))
            .filter(idx => idx !== -1) // Remove any channels not found

          console.log('[WORKFLOW] Recording DDA analysis with channel indices:', channelIndices)
          const analysisAction = createRunDDAAnalysisAction(result.id, channelIndices)
          recordAction(analysisAction).then(() => {
            incrementActionCount()
            console.log('[WORKFLOW] Recorded DDA analysis execution')
          }).catch(error => {
            console.error('[WORKFLOW] Failed to record DDA analysis:', error)
          })
        }

        // Save to history asynchronously (non-blocking)
        saveToHistoryMutation.mutate(result, {
          onError: (err) => {
            console.error('Background save to history failed:', err)
          }
        })
      },
      onError: (err) => {
        console.error('❌ DDA analysis failed:', err)
        setLocalIsRunning(false)
        setDDARunning(false)

        // Extract detailed error message for logging
        let errorMessage = 'Analysis failed';
        if (err instanceof Error) {
          errorMessage = err.message;
          console.error('📤 Error name:', err.name)
          console.error('📤 Error message:', err.message)
          console.error('📤 Error stack:', err.stack)
        } else {
          console.error('📤 Non-Error object thrown:', err)
        }

        console.error('📤 Analysis request parameters:', {
          file_path: fileManager.selectedFile?.file_path,
          channels: parameters.selectedChannels,
          time_range: [parameters.timeStart, parameters.timeEnd],
          variants: parameters.variants,
        })
      }
    })
  }

  const resetParameters = () => {
    // Calculate default window length based on sampling rate (0.25 seconds)
    const defaultWindowLength = fileManager.selectedFile
      ? Math.round(0.25 * fileManager.selectedFile.sample_rate)
      : 64 // Fallback for 256 Hz: 0.25 * 256 = 64

    setLocalParameters({
      variants: ['single_timeseries'],
      windowLength: defaultWindowLength,
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
    setLocalParameters(prev => ({
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
    <div className="h-full flex flex-col space-y-4 overflow-y-auto">
      <Tabs defaultValue="parameters" className="flex-1 flex flex-col">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="parameters">Parameters</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={resetParameters}>
              Reset
            </Button>
            <Button
              onClick={runAnalysis}
              disabled={localIsRunning || parameters.selectedChannels.length === 0}
              className="min-w-[120px]"
            >
              {localIsRunning ? (
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
          {(localIsRunning || results || autoLoadingResults) && (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {localIsRunning ? (
                        <Cpu className="h-4 w-4 animate-spin text-blue-600" />
                      ) : autoLoadingResults ? (
                        <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                      ) : results ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-600" />
                      )}
                      <span className="text-sm font-medium">
                        {localIsRunning ? analysisStatus : autoLoadingResults ? 'Loading previous analysis results...' : analysisStatus}
                      </span>
                    </div>
                    {localIsRunning && (
                      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>~{estimatedTime}s estimated</span>
                      </div>
                    )}
                  </div>

                  {localIsRunning && (
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
                        const newVariants = checked
                          ? [...parameters.variants, variant.id]
                          : parameters.variants.filter(v => v !== variant.id)
                        setLocalParameters(prev => ({ ...prev, variants: newVariants }))
                      }}
                      disabled={localIsRunning}
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
                    onChange={(e) => setLocalParameters(prev => ({
                      ...prev,
                      timeStart: Math.max(0, parseFloat(e.target.value) || 0)
                    }))}
                    disabled={localIsRunning}
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
                    onChange={(e) => setLocalParameters(prev => ({
                      ...prev,
                      timeEnd: Math.min(fileManager.selectedFile?.duration || 0, parseFloat(e.target.value) || 30)
                    }))}
                    disabled={localIsRunning}
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
                    onValueChange={([value]) => setLocalParameters(prev => ({ ...prev, windowLength: value }))}
                    disabled={localIsRunning}
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
                    onValueChange={([value]) => setLocalParameters(prev => ({ ...prev, windowStep: value }))}
                    disabled={localIsRunning}
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
                      setLocalParameters(prev => ({ ...prev, detrending: value }))
                    }
                    disabled={localIsRunning}
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
                      onChange={(e) => setLocalParameters(prev => ({
                        ...prev,
                        scaleMin: Math.max(1, parseInt(e.target.value) || 1)
                      }))}
                      disabled={localIsRunning}
                      min="1"
                      max={parameters.scaleMax - 1}
                    />
                  </div>
                  <div>
                    <Label className="text-sm">Max Scale</Label>
                    <Input
                      type="number"
                      value={parameters.scaleMax}
                      onChange={(e) => setLocalParameters(prev => ({
                        ...prev,
                        scaleMax: Math.max(parameters.scaleMin + 1, parseInt(e.target.value) || 20)
                      }))}
                      disabled={localIsRunning}
                      min={parameters.scaleMin + 1}
                      max="100"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Number of Scales: {parameters.scaleNum}</Label>
                  <Slider
                    value={[parameters.scaleNum]}
                    onValueChange={([value]) => setLocalParameters(prev => ({ ...prev, scaleNum: value }))}
                    disabled={localIsRunning}
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
          {(results || currentAnalysis) ? (
            <DDAResults result={results || currentAnalysis!} />
          ) : (
            <Card className="h-full flex items-center justify-center">
              <CardContent>
                <div className="text-center">
                  <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Analysis Results</h3>
                  <p className="text-muted-foreground">Run a DDA analysis to see results here</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="flex-1">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Analysis History</CardTitle>
                <CardDescription>
                  {historyLoading ? 'Loading...' : `${analysisHistoryCount} analyses stored in MinIO`}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadAnalysisHistoryRef}
                disabled={historyLoading}
                className="shrink-0"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${historyLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {historyError && (
                <div className="p-4 mb-4 text-sm text-red-800 bg-red-100 rounded-lg">
                  {historyError}
                </div>
              )}

              {saveStatus.message && (
                <div className={`p-4 mb-4 text-sm rounded-lg ${
                  saveStatus.type === 'success'
                    ? 'text-green-800 bg-green-100 border border-green-200'
                    : saveStatus.type === 'error'
                    ? 'text-red-800 bg-red-100 border border-red-200'
                    : 'text-blue-800 bg-blue-100 border border-blue-200'
                }`}>
                  <div className="flex items-center">
                    {saveStatus.type === 'success' && <CheckCircle className="h-4 w-4 mr-2" />}
                    {saveStatus.type === 'error' && <AlertCircle className="h-4 w-4 mr-2" />}
                    {!saveStatus.type && <Clock className="h-4 w-4 mr-2 animate-spin" />}
                    {saveStatus.message}
                  </div>
                </div>
              )}

              {previewingAnalysis && (
                <div className="p-3 mb-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-blue-900">Previewing Analysis</p>
                      <p className="text-xs text-blue-700">
                        {previewingAnalysis.file_path ? previewingAnalysis.file_path.split('/').pop() : `Analysis ${previewingAnalysis.id}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreviewingAnalysis(null)}
                      className="text-blue-700 hover:text-blue-900"
                    >
                      ×
                    </Button>
                  </div>
                </div>
              )}

              {analysisHistory.length > 0 ? (
                <div className="space-y-2">
                  {analysisHistory.map(analysis => {
                    return (
                    <div
                      key={analysis.id}
                      className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-accent transition-colors ${
                        previewingAnalysis?.id === analysis.id ? 'bg-blue-50 border-blue-200' : ''
                      }`}
                      onClick={() => previewAnalysis(analysis)}
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {analysis.file_path ? analysis.file_path.split('/').pop() : `Analysis ${analysis.id}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {analysis.channels?.length || 0} channels • {new Date(analysis.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline" className="text-xs">
                          Stored
                        </Badge>
                        {previewingAnalysis?.id === analysis.id && (
                          <Badge variant="default" className="text-xs">
                            Previewing
                          </Badge>
                        )}
                      </div>
                    </div>
                    )
                  })}
                </div>
              ) : !historyLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No analyses in history</p>
                  <p className="text-xs mt-2">Completed analyses are automatically saved to MinIO</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
