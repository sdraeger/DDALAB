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
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  Trash2,
  Cloud
} from 'lucide-react'
import { TauriService, NotificationType } from '@/services/tauriService'

interface DDAAnalysisProps {
  apiService: ApiService
}

interface DDAParameters {
  variants: string[]
  windowLength: number
  windowStep: number
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
  // Parallelization
  parallelCores?: number  // Number of CPU cores to use (1 = serial, >1 = parallel)
  // NSG-specific resource configuration
  nsgResourceConfig?: {
    runtimeHours?: number  // Max runtime in hours
    cores?: number  // Number of CPU cores
    nodes?: number  // Number of compute nodes
  }
}

export function DDAAnalysis({ apiService }: DDAAnalysisProps) {
  // OPTIMIZED: Use granular selectors to prevent unnecessary re-renders
  // Select only the specific properties we need, not entire objects
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile)
  const storedAnalysisParameters = useAppStore((state) => state.dda.analysisParameters)
  const currentAnalysis = useAppStore((state) => state.dda.currentAnalysis)
  const isRunning = useAppStore((state) => state.dda.isRunning)
  const isWorkflowRecording = useAppStore((state) => state.workflowRecording.isRecording)
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

  // Tab state for navigation
  const [activeTab, setActiveTab] = useState('parameters')

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
    scaleMin: storedAnalysisParameters.scaleMin,
    scaleMax: storedAnalysisParameters.scaleMax,
    scaleNum: storedAnalysisParameters.scaleNum,
    timeStart: 0,
    timeEnd: selectedFile?.duration || 30,
    selectedChannels: [],
    preprocessing: {
      highpass: 0.5,
      lowpass: 70,
      notch: [50]
    },
    ctWindowLength: undefined,
    ctWindowStep: undefined,
    ctChannelPairs: [],
    parallelCores: 1,  // Default to serial execution
    nsgResourceConfig: {
      runtimeHours: 1.0,
      cores: 4,  // Default to 4 cores for NSG
      nodes: 1
    }
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

  // NSG submission state
  const [hasNsgCredentials, setHasNsgCredentials] = useState(false)
  const [isSubmittingToNsg, setIsSubmittingToNsg] = useState(false)
  const [nsgError, setNsgError] = useState<string | null>(null)
  const [nsgSubmissionPhase, setNsgSubmissionPhase] = useState<string>('')

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
  // Skip NSG results - they should only show in main Results tab
  useEffect(() => {
    if (currentAnalysis && !results) {
      // Check if this is an NSG result (has source: 'nsg' marker)
      const isNSGResult = (currentAnalysis as any).source === 'nsg'

      if (!isNSGResult) {
        setResults(currentAnalysis)
        setResultsFromPersistence(true)
      } else {
        console.log('[DDAAnalysis] Skipping local results sync for NSG result')
      }
    }
  }, [currentAnalysis, results])

  // Check for NSG credentials on mount
  useEffect(() => {
    const checkNsgCredentials = async () => {
      if (!TauriService.isTauri()) return
      try {
        const hasCreds = await TauriService.hasNSGCredentials()
        setHasNsgCredentials(hasCreds)
      } catch (error) {
        console.error('Failed to check NSG credentials:', error)
      }
    }

    checkNsgCredentials()
  }, [])

  // Listen for NSG results being loaded
  useEffect(() => {
    const handleNSGResults = (event: Event) => {
      const customEvent = event as CustomEvent
      const { jobId, resultsData } = customEvent.detail

      console.log('[DDAAnalysis] Received NSG results:', { jobId, resultsData })

      // For NSG results: ONLY update the global store (main Results tab)
      // Do NOT set local results (prevents showing in DDA Analysis → Results sub-tab)
      if (resultsData) {
        setCurrentAnalysis(resultsData)
        console.log('[DDAAnalysis] NSG results loaded to global store (main Results tab only)')
      }
    }

    window.addEventListener('load-nsg-results', handleNSGResults)

    return () => {
      window.removeEventListener('load-nsg-results', handleNSGResults)
    }
  }, [setCurrentAnalysis])

  const availableVariants = [
    { id: 'single_timeseries', name: 'Single Timeseries (ST)', description: 'Standard temporal dynamics analysis' },
    { id: 'cross_timeseries', name: 'Cross Timeseries (CT)', description: 'Inter-channel relationship analysis' },
    { id: 'cross_dynamical', name: 'Cross Dynamical (CD)', description: 'Dynamic coupling pattern analysis' },
    { id: 'dynamical_ergodicity', name: 'Dynamical Ergodicity (DE)', description: 'Temporal stationarity assessment' }
  ]

  // Initialize with file data - run when file changes or duration is loaded
  useEffect(() => {
    if (selectedFile) {
      const fileDuration = selectedFile.duration

      // Only update if we have a valid duration (> 0)
      if (fileDuration && fileDuration > 0) {
        const defaultChannels = selectedFile.channels.slice(0, Math.min(8, selectedFile.channels.length))
        // Calculate default window length as 1/4 second (0.25 * sampling_rate)
        const defaultWindowLength = Math.round(0.25 * selectedFile.sample_rate)

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
        console.warn('[DDAAnalysis] File loaded but duration not available yet:', selectedFile.file_path)
      }
    }
  }, [selectedFile?.file_path, selectedFile?.duration]) // Depend on both file path and duration

  const runAnalysis = async () => {
    if (!selectedFile || parameters.selectedChannels.length === 0) {
      // Can't use setError directly anymore, error comes from mutation
      console.error('Please select a file and at least one channel')
      return
    }

    // Sync local parameters to store when running analysis
    updateAnalysisParameters({
      variants: parameters.variants,
      windowLength: parameters.windowLength,
      windowStep: parameters.windowStep,
      scaleMin: parameters.scaleMin,
      scaleMax: parameters.scaleMax,
      scaleNum: parameters.scaleNum
    })

    // Convert CT channel pairs from names to indices
    const ctChannelPairs: [number, number][] | undefined =
      parameters.ctChannelPairs.length > 0 && selectedFile
        ? parameters.ctChannelPairs.map(([ch1, ch2]) => {
            const idx1 = selectedFile!.channels.indexOf(ch1)
            const idx2 = selectedFile!.channels.indexOf(ch2)
            return [idx1, idx2] as [number, number]
          }).filter(([idx1, idx2]) => idx1 !== -1 && idx2 !== -1)
        : undefined

    // Prepare the analysis request
    const request: DDAAnalysisRequest = {
      file_path: selectedFile.file_path,
      channels: parameters.selectedChannels,
      start_time: parameters.timeStart,
      end_time: parameters.timeEnd,
      variants: parameters.variants,
      window_length: parameters.windowLength,
      window_step: parameters.windowStep,
      scale_min: parameters.scaleMin,
      scale_max: parameters.scaleMax,
      scale_num: parameters.scaleNum,
      ct_window_length: parameters.ctWindowLength,
      ct_window_step: parameters.ctWindowStep,
      ct_channel_pairs: ctChannelPairs
    }

    // Convert channel names to indices for comparison
    const channelIndices = parameters.selectedChannels.map(ch =>
      typeof ch === 'string' ? selectedFile!.channels.indexOf(ch) : ch
    )

    console.log('📋 [LOCAL] DDA Analysis Parameters:')
    console.log(`   File: ${selectedFile.file_path}`)
    console.log(`   Sample rate: ${selectedFile.sample_rate} Hz`)
    console.log(`   Channels (names): [${request.channels.join(', ')}]`)
    console.log(`   Channels (indices): [${channelIndices.join(', ')}]`)
    console.log(`   Time range: ${request.start_time} - ${request.end_time} seconds`)
    console.log(`   Window: length=${request.window_length}, step=${request.window_step}`)
    console.log(`   Scale: min=${request.scale_min}, max=${request.scale_max}, num=${request.scale_num}`)

    // Record DDA parameters if recording is active
    if (isWorkflowRecording) {
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
        if (isWorkflowRecording && selectedFile) {
          // Convert channel names to their actual indices in the file's channel list
          const channelIndices = parameters.selectedChannels
            .map(channelName => selectedFile!.channels.indexOf(channelName))
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
          file_path: selectedFile?.file_path,
          channels: parameters.selectedChannels,
          time_range: [parameters.timeStart, parameters.timeEnd],
          variants: parameters.variants,
        })
      }
    })
  }

  const submitToNSG = async () => {
    if (!TauriService.isTauri()) {
      setNsgError('NSG submission is only available in the Tauri desktop application')
      return
    }

    if (!selectedFile || parameters.selectedChannels.length === 0) {
      setNsgError('Please select a file and at least one channel')
      return
    }

    if (!hasNsgCredentials) {
      setNsgError('Please configure NSG credentials in Settings first')
      return
    }

    try {
      setIsSubmittingToNsg(true)
      setNsgError(null)
      setNsgSubmissionPhase('Preparing job parameters...')

      // Build DDA request parameters in the format expected by Rust DDARequest struct
      // Note: selectedFile is guaranteed to be non-null by the check above
      const request = {
        file_path: selectedFile!.file_path,
        channels: parameters.selectedChannels.length > 0
          ? parameters.selectedChannels.map(ch => {
              const channelIndex = selectedFile!.channels.indexOf(ch)
              return channelIndex >= 0 ? channelIndex : 0
            })
          : null,
        time_range: {
          start: parameters.timeStart,
          end: parameters.timeEnd
        },
        preprocessing_options: {
          highpass: parameters.preprocessing.highpass || null,
          lowpass: parameters.preprocessing.lowpass || null
        },
        algorithm_selection: {
          enabled_variants: parameters.variants,
          select_mask: null
        },
        window_parameters: {
          window_length: parameters.windowLength,
          window_step: parameters.windowStep,
          ct_window_length: parameters.ctWindowLength || null,
          ct_window_step: parameters.ctWindowStep || null
        },
        scale_parameters: {
          scale_min: parameters.scaleMin,
          scale_max: parameters.scaleMax,
          scale_num: parameters.scaleNum
        },
        ct_channel_pairs: parameters.ctChannelPairs?.length > 0
          ? parameters.ctChannelPairs.map(pair => {
              const idx0 = selectedFile.channels.indexOf(pair[0])
              const idx1 = selectedFile.channels.indexOf(pair[1])
              return [idx0 >= 0 ? idx0 : 0, idx1 >= 0 ? idx1 : 0]
            })
          : null,
        parallel_cores: parameters.nsgResourceConfig?.cores || 4,  // Use NSG cores setting
        resource_config: parameters.nsgResourceConfig
      }

      // Map channel indices back to names for display
      const channelNames = request.channels?.map(idx => selectedFile.channels[idx] || `Unknown(${idx})`) || []

      console.log('📋 [NSG] DDA Analysis Parameters:')
      console.log(`   File: ${selectedFile.file_path}`)
      console.log(`   Sample rate: ${selectedFile.sample_rate} Hz`)
      console.log(`   Channels (indices): [${request.channels?.join(', ') || ''}]`)
      console.log(`   Channels (names): [${channelNames.join(', ')}]`)
      console.log(`   Time range: ${request.time_range.start} - ${request.time_range.end} seconds`)
      console.log(`   Window: length=${request.window_parameters.window_length}, step=${request.window_parameters.window_step}`)
      console.log(`   Scale: min=${request.scale_parameters.scale_min}, max=${request.scale_parameters.scale_max}, num=${request.scale_parameters.scale_num}`)

      setNsgSubmissionPhase('Creating job in database...')

      // Create NSG job with PY_EXPANSE tool (resource params not used by NSG)
      const jobId = await TauriService.createNSGJob(
        'PY_EXPANSE',
        request,
        selectedFile.file_path
      )

      console.log('[NSG] Job created with ID:', jobId)

      setNsgSubmissionPhase('Uploading file to NSG (this may take a few minutes for large files)...')

      // Submit the job to NSG
      await TauriService.submitNSGJob(jobId)

      console.log('[NSG] Job submitted successfully')

      setNsgSubmissionPhase('')
      setIsSubmittingToNsg(false)

      // Show native notification instead of alert dialog
      await TauriService.createNotification(
        'NSG Job Submitted',
        `Job successfully submitted to Neuroscience Gateway. Job ID: ${jobId.substring(0, 8)}...`,
        NotificationType.Success,
        'navigate_nsg_manager',
        { jobId }
      )
    } catch (error) {
      console.error('[NSG] Submission error:', error)
      console.error('[NSG] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        error
      })
      setNsgError(error instanceof Error ? error.message : 'Failed to submit job to NSG')
      setNsgSubmissionPhase('')
      setIsSubmittingToNsg(false)
    }
  }

  const resetParameters = () => {
    // Calculate default window length based on sampling rate (0.25 seconds)
    const defaultWindowLength = selectedFile
      ? Math.round(0.25 * selectedFile.sample_rate)
      : 64 // Fallback for 256 Hz: 0.25 * 256 = 64

    setLocalParameters({
      variants: ['single_timeseries'],
      windowLength: defaultWindowLength,
      windowStep: 10,
      scaleMin: 1,
      scaleMax: 20,
      scaleNum: 20,
      timeStart: 0,
      timeEnd: selectedFile?.duration || 30,
      selectedChannels: selectedFile?.channels.slice(0, 8) || [],
      preprocessing: {
        highpass: 0.5,
        lowpass: 70,
        notch: [50]
      },
      ctWindowLength: undefined,
      ctWindowStep: undefined,
      ctChannelPairs: [],
      parallelCores: 1,
      nsgResourceConfig: {
        runtimeHours: 1.0,
        cores: 4,
        nodes: 1
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

  if (!selectedFile) {
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
    <div className="h-full flex flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between flex-shrink-0 pb-4">
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
            {TauriService.isTauri() && hasNsgCredentials && (
              <Button
                onClick={submitToNSG}
                disabled={isSubmittingToNsg || localIsRunning || parameters.selectedChannels.length === 0}
                variant="outline"
                className="min-w-[140px]"
              >
                {isSubmittingToNsg ? (
                  <>
                    <Cloud className="h-4 w-4 mr-2 animate-pulse" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Cloud className="h-4 w-4 mr-2" />
                    Submit to NSG
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {nsgSubmissionPhase && (
          <Alert className="mt-4 flex-shrink-0">
            <Cloud className="h-4 w-4 animate-pulse" />
            <AlertDescription>{nsgSubmissionPhase}</AlertDescription>
          </Alert>
        )}

        {nsgError && (
          <Alert variant="destructive" className="mt-4 flex-shrink-0">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{nsgError}</AlertDescription>
          </Alert>
        )}


        <TabsContent value="parameters" className="flex-1 min-h-0 space-y-4 overflow-y-auto">
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
                    max={selectedFile?.duration}
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
                      const maxDuration = selectedFile?.duration || Infinity
                      setLocalParameters(prev => ({
                        ...prev,
                        timeEnd: Math.min(maxDuration, Math.max(prev.timeStart + 0.1, inputValue))
                      }))
                    }}
                    disabled={localIsRunning}
                    min={parameters.timeStart + 1}
                    max={selectedFile?.duration}
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
                    {selectedFile && (
                      <CTChannelPairPicker
                        channels={selectedFile.channels}
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

            {/* NSG Resource Configuration */}
            {TauriService.isTauri() && hasNsgCredentials && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">NSG Resource Configuration</CardTitle>
                  <CardDescription>Neuroscience Gateway compute resources (for Submit to NSG)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-sm">Runtime Limit: {parameters.nsgResourceConfig?.runtimeHours || 1.0} hours</Label>
                    <Slider
                      value={[parameters.nsgResourceConfig?.runtimeHours || 1.0]}
                      onValueChange={([value]) => setLocalParameters(prev => ({
                        ...prev,
                        nsgResourceConfig: { ...prev.nsgResourceConfig, runtimeHours: value }
                      }))}
                      disabled={localIsRunning || isSubmittingToNsg}
                      min={0.5}
                      max={48}
                      step={0.5}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">NSG CPU Cores: {parameters.nsgResourceConfig?.cores || 4}</Label>
                    <Slider
                      value={[parameters.nsgResourceConfig?.cores || 4]}
                      onValueChange={([value]) => setLocalParameters(prev => ({
                        ...prev,
                        nsgResourceConfig: { ...prev.nsgResourceConfig, cores: value }
                      }))}
                      disabled={localIsRunning || isSubmittingToNsg}
                      min={1}
                      max={128}
                      step={1}
                      className="mt-2"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Max 128 cores per Expanse node
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm">Nodes: {parameters.nsgResourceConfig?.nodes || 1}</Label>
                    <Slider
                      value={[parameters.nsgResourceConfig?.nodes || 1]}
                      onValueChange={([value]) => setLocalParameters(prev => ({
                        ...prev,
                        nsgResourceConfig: { ...prev.nsgResourceConfig, nodes: value }
                      }))}
                      disabled={localIsRunning || isSubmittingToNsg}
                      min={1}
                      max={4}
                      step={1}
                      className="mt-2"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Multi-node support (experimental)
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Channel Selection */}
          <ChannelSelector
            channels={selectedFile.channels}
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

        <TabsContent value="results" className="flex-1 min-h-0 overflow-y-auto">
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

        <TabsContent value="history" className="flex-1 min-h-0 overflow-y-auto">
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
