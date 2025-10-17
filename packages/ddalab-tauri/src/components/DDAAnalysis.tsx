'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import { ApiService } from '@/services/apiService'
import { DDAAnalysisRequest, DDAResult } from '@/types/api'
import { DDAResults } from '@/components/DDAResults'
import { CTChannelPairPicker } from '@/components/CTChannelPairPicker'
import { useWorkflow } from '@/hooks/useWorkflow'
import { createSetDDAParametersAction, createRunDDAAnalysisAction } from '@/types/workflow'
import { useSubmitDDAAnalysis, useDDAProgress, useSaveDDAToHistory, useDDAHistory, useDeleteAnalysis, useRenameAnalysis } from '@/hooks/useDDAAnalysis'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ChannelSelector } from '@/components/ChannelSelector'
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
  RefreshCw,
  Pencil,
  Trash2
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
  // CT-specific parameters
  ctWindowLength?: number
  ctWindowStep?: number
  ctChannelPairs: [string, string][]  // Pairs of channel names
}

export function DDAAnalysis({ apiService }: DDAAnalysisProps) {
  // Use granular selectors to prevent unnecessary re-renders
  const fileManager = useAppStore((state) => state.fileManager)
  const storedAnalysisParameters = useAppStore((state) => state.dda.analysisParameters)
  const currentAnalysis = useAppStore((state) => state.dda.currentAnalysis)
  const isRunning = useAppStore((state) => state.dda.isRunning)
  const workflowRecording = useAppStore((state) => state.workflowRecording)
  const setCurrentAnalysis = useAppStore((state) => state.setCurrentAnalysis)
  const addAnalysisToHistory = useAppStore((state) => state.addAnalysisToHistory)
  const updateAnalysisParameters = useAppStore((state) => state.updateAnalysisParameters)
  const setDDARunning = useAppStore((state) => state.setDDARunning)
  const incrementActionCount = useAppStore((state) => state.incrementActionCount)
  const isServerReady = useAppStore((state) => state.ui.isServerReady)

  const { recordAction } = useWorkflow()

  // TanStack Query: Submit DDA analysis mutation
  const submitAnalysisMutation = useSubmitDDAAnalysis(apiService)
  const saveToHistoryMutation = useSaveDDAToHistory(apiService)

  // TanStack Query: Fetch analysis history (only when server is ready and authenticated)
  const {
    data: historyData,
    isLoading: historyLoading,
    error: historyErrorObj,
    refetch: refetchHistory
  } = useDDAHistory(apiService, isServerReady && !!apiService.getSessionToken())

  // TanStack Query: Delete and rename mutations with optimistic updates
  const deleteAnalysisMutation = useDeleteAnalysis(apiService)
  const renameAnalysisMutation = useRenameAnalysis(apiService)

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
    timeEnd: fileManager.selectedFile?.duration || 30,
    selectedChannels: [],
    preprocessing: {
      highpass: 0.5,
      lowpass: 70,
      notch: [50]
    },
    ctWindowLength: undefined,
    ctWindowStep: undefined,
    ctChannelPairs: []
  })

  // Use local parameters directly - no need to merge with store
  const parameters = localParameters

  const [localIsRunning, setLocalIsRunning] = useState(false) // Local UI state for this component
  const [results, setResults] = useState<DDAResult | null>(null)
  const [analysisName, setAnalysisName] = useState('')

  // Derive state from mutation and progress events
  const progress = progressEvent?.progress_percent || (submitAnalysisMutation.isPending ? 50 : 0)
  const analysisStatus = progressEvent?.current_step ||
    (submitAnalysisMutation.isPending ? 'Running DDA analysis...' :
     submitAnalysisMutation.isSuccess ? 'Analysis completed successfully!' : '')
  const error = submitAnalysisMutation.error ?
    (submitAnalysisMutation.error as Error).message : null
  const [previewingAnalysis, setPreviewingAnalysis] = useState<DDAResult | null>(null)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' })
  const [autoLoadingResults, setAutoLoadingResults] = useState(false)
  const [resultsFromPersistence, setResultsFromPersistence] = useState(false)
  const [renamingAnalysisId, setRenamingAnalysisId] = useState<string | null>(null)
  const [newAnalysisName, setNewAnalysisName] = useState('')

  // Derive history state from TanStack Query
  const historyError = historyErrorObj ? (historyErrorObj as Error).message : null
  const analysisHistoryFromQuery = historyData || []

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

  // Preview analysis from history in dedicated window
  const previewAnalysis = useCallback(async (analysis: DDAResult) => {
    try {
      // Validate analysis object
      if (!analysis || !analysis.id) {
        console.error('Invalid analysis object:', analysis)
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
      }
    } catch (error) {
      console.error('Failed to load analysis preview:', error)
    }
  }, [apiService])

  // Delete analysis from history with optimistic update
  const handleDeleteAnalysis = useCallback(async (analysisId: string, event: React.MouseEvent) => {
    event.stopPropagation() // Prevent triggering preview

    try {
      // Use Tauri dialog API instead of browser confirm
      const { ask } = await import('@tauri-apps/plugin-dialog')
      const confirmed = await ask('Are you sure you want to delete this analysis from history?', {
        title: 'Delete Analysis',
        kind: 'warning'
      })

      if (!confirmed) {
        return
      }

      // Clear preview if deleting the currently previewed analysis
      if (previewingAnalysis?.id === analysisId) {
        setPreviewingAnalysis(null)
      }

      // Use mutation with optimistic update - UI updates immediately
      deleteAnalysisMutation.mutate(analysisId, {
        onError: async (error) => {
          console.error('[DDAAnalysis] Error deleting analysis:', error)
          const { message } = await import('@tauri-apps/plugin-dialog')
          await message((error as Error).message || 'Failed to delete analysis', {
            title: 'Delete Failed',
            kind: 'error'
          })
        }
      })
    } catch (error) {
      console.error('[DDAAnalysis] Error in delete handler:', error)
    }
  }, [deleteAnalysisMutation, previewingAnalysis])

  // Start renaming an analysis
  const handleStartRename = useCallback((analysis: DDAResult, event: React.MouseEvent) => {
    event.stopPropagation() // Prevent triggering preview
    setRenamingAnalysisId(analysis.id)
    setNewAnalysisName(analysis.name || '')
  }, [])

  // Submit rename with optimistic update
  const handleSubmitRename = useCallback(async (analysisId: string, event?: React.MouseEvent) => {
    if (event) event.stopPropagation()

    // Validate and sanitize the input
    const trimmedName = newAnalysisName.trim()

    if (!trimmedName) {
      setRenamingAnalysisId(null)
      return
    }

    // Validation: max length 200 characters
    if (trimmedName.length > 200) {
      const { message } = await import('@tauri-apps/plugin-dialog')
      await message('Analysis name must be 200 characters or less', {
        title: 'Invalid Name',
        kind: 'error'
      })
      return
    }

    // Sanitize: remove control characters and null bytes
    const sanitizedName = trimmedName
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .replace(/\0/g, '') // Remove null bytes

    if (!sanitizedName) {
      const { message } = await import('@tauri-apps/plugin-dialog')
      await message('Analysis name contains only invalid characters', {
        title: 'Invalid Name',
        kind: 'error'
      })
      return
    }

    // Exit edit mode immediately for instant feedback
    setRenamingAnalysisId(null)
    setNewAnalysisName('')

    // Use mutation with optimistic update - UI updates immediately
    renameAnalysisMutation.mutate(
      { analysisId, newName: sanitizedName },
      {
        onError: async (error) => {
          console.error('[DDAAnalysis] Error renaming analysis:', error)
          const { message } = await import('@tauri-apps/plugin-dialog')
          await message((error as Error).message || 'Failed to rename analysis', {
            title: 'Rename Failed',
            kind: 'error'
          })
        }
      }
    )
  }, [renameAnalysisMutation, newAnalysisName])

  // Cancel rename
  const handleCancelRename = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    setRenamingAnalysisId(null)
    setNewAnalysisName('')
  }, [])

  // Note: Analysis history is loaded by DashboardLayout on app startup
  // This component only refreshes when the user clicks the Refresh button
  // or after saving a new analysis

  // Sync local results with current analysis from store
  // Track when results are loaded from persistence vs fresh analysis
  useEffect(() => {
    if (currentAnalysis && !results) {
      setResults(currentAnalysis)
      setResultsFromPersistence(true)
    }
  }, [currentAnalysis, results])

  const availableVariants = [
    { id: 'single_timeseries', name: 'Single Timeseries (ST)', description: 'Standard temporal dynamics analysis' },
    { id: 'cross_timeseries', name: 'Cross Timeseries (CT)', description: 'Inter-channel relationship analysis' },
    { id: 'cross_dynamical', name: 'Cross Dynamical (CD)', description: 'Dynamic coupling pattern analysis' },
    { id: 'dynamical_ergodicity', name: 'Dynamical Ergodicity (DE)', description: 'Temporal stationarity assessment' }
  ]

  // Initialize with file data - run when file changes or duration is loaded
  useEffect(() => {
    if (fileManager.selectedFile) {
      const fileDuration = fileManager.selectedFile.duration

      // Only update if we have a valid duration (> 0)
      if (fileDuration && fileDuration > 0) {
        const defaultChannels = fileManager.selectedFile.channels.slice(0, Math.min(8, fileManager.selectedFile.channels.length))
        // Calculate default window length as 1/4 second (0.25 * sampling_rate)
        const defaultWindowLength = Math.round(0.25 * fileManager.selectedFile.sample_rate)

        console.log('[DDAAnalysis] Updating time range - file duration:', fileDuration, 'seconds')

        setLocalParameters(prev => ({
          ...prev,
          selectedChannels: defaultChannels,
          timeStart: 0,
          timeEnd: fileDuration
        }))

        // Update window length based on sampling rate
        setLocalParameters(prev => ({ ...prev, windowLength: defaultWindowLength }))
      } else {
        console.warn('[DDAAnalysis] File loaded but duration not available yet:', fileManager.selectedFile.file_path)
      }
    }
  }, [fileManager.selectedFile?.file_path, fileManager.selectedFile?.duration]) // Depend on both file path and duration

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

    // Convert CT channel pairs from names to indices
    const ctChannelPairs: [number, number][] | undefined =
      parameters.ctChannelPairs.length > 0 && fileManager.selectedFile
        ? parameters.ctChannelPairs.map(([ch1, ch2]) => {
            const idx1 = fileManager.selectedFile!.channels.indexOf(ch1)
            const idx2 = fileManager.selectedFile!.channels.indexOf(ch2)
            return [idx1, idx2] as [number, number]
          }).filter(([idx1, idx2]) => idx1 !== -1 && idx2 !== -1)
        : undefined

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
      scale_num: parameters.scaleNum,
      ct_window_length: parameters.ctWindowLength,
      ct_window_step: parameters.ctWindowStep,
      ct_channel_pairs: ctChannelPairs
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
        // Add custom name to result if provided
        const resultWithName = analysisName.trim()
          ? { ...result, name: analysisName.trim() }
          : result

        setResults(resultWithName)
        setCurrentAnalysis(resultWithName)
        addAnalysisToHistory(resultWithName)
        setLocalIsRunning(false)
        setDDARunning(false)
        setAnalysisName('') // Clear name after successful analysis
        setResultsFromPersistence(false) // Mark as fresh analysis, not from persistence

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
        saveToHistoryMutation.mutate(resultWithName, {
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
      timeEnd: fileManager.selectedFile?.duration || 30,
      selectedChannels: fileManager.selectedFile?.channels.slice(0, 8) || [],
      preprocessing: {
        highpass: 0.5,
        lowpass: 70,
        notch: [50]
      },
      ctWindowLength: undefined,
      ctWindowStep: undefined,
      ctChannelPairs: []
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
            <Input
              placeholder="Analysis name (optional)"
              value={analysisName}
              onChange={(e) => setAnalysisName(e.target.value)}
              disabled={localIsRunning}
              className="w-48"
            />
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
          {/* Analysis Status - only show for active/recent analysis, not restored from persistence */}
          {(localIsRunning || autoLoadingResults || (results && !resultsFromPersistence)) && (
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
                    onChange={(e) => {
                      const inputValue = parseFloat(e.target.value) || 0
                      const maxDuration = fileManager.selectedFile?.duration || Infinity
                      setLocalParameters(prev => ({
                        ...prev,
                        timeEnd: Math.min(maxDuration, Math.max(prev.timeStart + 0.1, inputValue))
                      }))
                    }}
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

            {/* CT-Specific Parameters */}
            {parameters.variants.includes('cross_timeseries') && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">CT Parameters</CardTitle>
                  <CardDescription>Cross-Timeseries specific settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-sm">CT Window Length (optional)</Label>
                    <Input
                      type="number"
                      value={parameters.ctWindowLength || ''}
                      onChange={(e) => setLocalParameters(prev => ({
                        ...prev,
                        ctWindowLength: e.target.value ? parseInt(e.target.value) : undefined
                      }))}
                      disabled={localIsRunning}
                      placeholder="Uses standard window length if empty"
                      min="10"
                      max="1000"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">CT Window Step (optional)</Label>
                    <Input
                      type="number"
                      value={parameters.ctWindowStep || ''}
                      onChange={(e) => setLocalParameters(prev => ({
                        ...prev,
                        ctWindowStep: e.target.value ? parseInt(e.target.value) : undefined
                      }))}
                      disabled={localIsRunning}
                      placeholder="Uses standard window step if empty"
                      min="1"
                      max="100"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm">Channel Pairs ({parameters.ctChannelPairs.length})</Label>
                      {parameters.ctChannelPairs.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLocalParameters(prev => ({ ...prev, ctChannelPairs: [] }))}
                          disabled={localIsRunning}
                        >
                          Clear All
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Click two channels below to create a pair
                    </p>

                    {/* Display existing pairs */}
                    {parameters.ctChannelPairs.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3 p-2 bg-muted/50 rounded-md">
                        {parameters.ctChannelPairs.map(([ch1, ch2], idx) => (
                          <Badge
                            key={idx}
                            variant="secondary"
                            className="cursor-pointer hover:bg-destructive/80"
                            onClick={() => {
                              setLocalParameters(prev => ({
                                ...prev,
                                ctChannelPairs: prev.ctChannelPairs.filter((_, i) => i !== idx)
                              }))
                            }}
                          >
                            {ch1} ⟷ {ch2} ×
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Channel pair picker */}
                    {fileManager.selectedFile && (
                      <CTChannelPairPicker
                        channels={fileManager.selectedFile.channels}
                        onPairAdded={(ch1, ch2) => {
                          setLocalParameters(prev => ({
                            ...prev,
                            ctChannelPairs: [...prev.ctChannelPairs, [ch1, ch2]]
                          }))
                        }}
                        disabled={localIsRunning}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Delay Parameters */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Delay Parameters</CardTitle>
                <CardDescription>Time delay range (τ) for DDA analysis</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-sm">Min Delay (τ)</Label>
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
                    <Label className="text-sm">Max Delay (τ)</Label>
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
                  <Label className="text-sm">Number of Delays: {parameters.scaleNum}</Label>
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
          <ChannelSelector
            channels={fileManager.selectedFile.channels}
            selectedChannels={parameters.selectedChannels}
            onSelectionChange={(channels) => {
              setLocalParameters(prev => ({
                ...prev,
                selectedChannels: channels
              }))
            }}
            label="Channel Selection"
            description="Select channels for DDA analysis"
            variant="default"
            maxHeight="max-h-40"
          />

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
                  {historyLoading ? 'Loading...' : `${analysisHistoryFromQuery.length} analyses stored`}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchHistory()}
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

              {analysisHistoryFromQuery.length > 0 ? (
                <div className="space-y-2">
                  {analysisHistoryFromQuery.map(analysis => {
                    const isRenaming = renamingAnalysisId === analysis.id

                    return (
                    <div
                      key={analysis.id}
                      className={`flex items-center justify-between p-3 border rounded-lg ${!isRenaming ? 'cursor-pointer hover:bg-accent' : ''} transition-colors ${
                        previewingAnalysis?.id === analysis.id ? 'bg-blue-50 border-blue-200' : ''
                      }`}
                      onClick={!isRenaming ? () => previewAnalysis(analysis) : undefined}
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        {isRenaming ? (
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Input
                              value={newAnalysisName}
                              onChange={(e) => setNewAnalysisName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSubmitRename(analysis.id)
                                if (e.key === 'Escape') handleCancelRename(e as any)
                              }}
                              className="text-sm h-8"
                              placeholder="Analysis name"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              onClick={() => handleSubmitRename(analysis.id)}
                              className="h-8"
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleCancelRename}
                              className="h-8"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <>
                            <p className="font-medium text-sm">
                              {analysis.name || (analysis.file_path ? analysis.file_path.split('/').pop() : `Analysis ${analysis.id}`)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {analysis.name && analysis.file_path && `${analysis.file_path.split('/').pop()} • `}
                              {analysis.channels?.length || 0} channels • {new Date(analysis.created_at).toLocaleString()}
                            </p>
                          </>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 flex-shrink-0">
                        {!isRenaming && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => handleStartRename(analysis, e)}
                              className="h-8 w-8 p-0"
                              title="Rename analysis"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => handleDeleteAnalysis(analysis.id, e)}
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Delete analysis"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
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
                  <p className="text-xs mt-2">Completed analyses are automatically saved to history</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
