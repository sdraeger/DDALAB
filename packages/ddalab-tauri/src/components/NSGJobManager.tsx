'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  XCircle,
  Cloud,
  AlertTriangle,
  Copy,
  Check,
  Eye,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react'
import { TauriService, type NSGJob, NSGJobStatus } from '@/services/tauriService'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  useNSGCredentials,
  useNSGJobs,
  useUpdateNSGJobStatus,
  useDownloadNSGResults,
  useCancelNSGJob,
  useDeleteNSGJob,
  useCleanupPendingNSGJobs,
  useExtractNSGTarball,
  isExternalJob,
} from '@/hooks/useNSGJobs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

export function NSGJobManager() {
  // TanStack Query hooks
  const { data: hasCredentials = false } = useNSGCredentials()
  const {
    data: jobs = [],
    isLoading,
    error: jobsError,
    refetch: refetchJobs,
  } = useNSGJobs({ enabled: hasCredentials })
  const updateJobStatus = useUpdateNSGJobStatus()
  const downloadResults = useDownloadNSGResults()
  const cancelJob = useCancelNSGJob()
  const deleteJob = useDeleteNSGJob()
  const cleanupPendingJobs = useCleanupPendingNSGJobs()
  const extractTarball = useExtractNSGTarball()

  // Local UI state
  const [error, setError] = useState<string | null>(null)
  const [copiedJobId, setCopiedJobId] = useState<string | null>(null)
  const [viewingJobId, setViewingJobId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [successDialog, setSuccessDialog] = useState<{
    show: boolean
    jobId: string
    numChannels: number
  } | null>(null)
  const [previousJobStatuses, setPreviousJobStatuses] = useState<Map<string, NSGJobStatus>>(new Map())
  const [downloadProgress, setDownloadProgress] = useState<{
    jobId: string
    currentFile: number
    totalFiles: number
    filename: string
    bytesDownloaded: number
    totalBytes: number
    fileProgress: number
  } | null>(null)

  // Sort state with localStorage persistence
  type SortColumn = 'jobId' | 'status' | 'tool' | 'created' | 'submitted' | 'completed'
  type SortDirection = 'asc' | 'desc'
  const [sortColumn, setSortColumn] = useState<SortColumn>(() => {
    const saved = localStorage.getItem('nsgJobManager_sortColumn')
    return (saved as SortColumn) || 'created'
  })
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    const saved = localStorage.getItem('nsgJobManager_sortDirection')
    return (saved as SortDirection) || 'desc'
  })

  // Persist sort preferences
  useEffect(() => {
    localStorage.setItem('nsgJobManager_sortColumn', sortColumn)
    localStorage.setItem('nsgJobManager_sortDirection', sortDirection)
  }, [sortColumn, sortDirection])

  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New column, default to descending for dates, ascending for others
      setSortColumn(column)
      setSortDirection(['created', 'submitted', 'completed'].includes(column) ? 'desc' : 'asc')
    }
  }

  // Track job status changes for notifications
  useEffect(() => {
    if (!jobs.length) return

    const newStatuses = new Map<string, NSGJobStatus>()
    for (const job of jobs) {
      newStatuses.set(job.id, job.status)

      const previousStatus = previousJobStatuses.get(job.id)

      // Fire notification if job just completed
      if (
        previousStatus &&
        previousStatus !== NSGJobStatus.Completed &&
        job.status === NSGJobStatus.Completed
      ) {
        TauriService.createNotification(
          'NSG Job Completed',
          `Job ${job.id.substring(0, 8)}... has finished successfully. Results are ready to download.`,
          'Success' as any,
          'navigate_nsg_manager',
          { jobId: job.id }
        ).catch((error) => {
          console.error('[NSG] Failed to create completion notification:', error)
        })
      }

      // Fire notification if job failed
      if (
        previousStatus &&
        previousStatus !== NSGJobStatus.Failed &&
        job.status === NSGJobStatus.Failed
      ) {
        TauriService.createNotification(
          'NSG Job Failed',
          `Job ${job.id.substring(0, 8)}... has failed. Check the job details for more information.`,
          'Error' as any,
          'navigate_nsg_manager',
          { jobId: job.id }
        ).catch((error) => {
          console.error('[NSG] Failed to create failure notification:', error)
        })
      }
    }

    setPreviousJobStatuses(newStatuses)
  }, [jobs])

  useEffect(() => {
    if (!TauriService.isTauri()) return

    let unlisten: (() => void) | undefined

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen('nsg-download-progress', (event: any) => {
          const payload = event.payload
          console.log('[NSG] Download progress:', payload)
          setDownloadProgress({
            jobId: payload.job_id,
            currentFile: payload.current_file,
            totalFiles: payload.total_files,
            filename: payload.filename,
            bytesDownloaded: payload.bytes_downloaded,
            totalBytes: payload.total_bytes,
            fileProgress: payload.file_progress
          })
        })
      } catch (error) {
        console.error('[NSG] Failed to setup progress listener:', error)
      }
    }

    setupListener()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

  const handleRefresh = async () => {
    setError(null)
    await refetchJobs()
  }

  const handleUpdateStatus = async (jobId: string) => {
    try {
      setError(null)
      await updateJobStatus.mutateAsync(jobId)
    } catch (error) {
      console.error('[NSG] Failed to update job status:', error)
      const errorMsg = error instanceof Error ? error.message : String(error)

      // If job hasn't been submitted yet, show a clearer message
      if (errorMsg.includes('has not been submitted yet') || errorMsg.includes('Job not found')) {
        setError(
          'Cannot update status: Job is still pending submission. Try deleting and re-submitting this job.'
        )
      } else {
        setError(`Failed to update job status: ${errorMsg}`)
      }
    }
  }

  const handleDownloadResults = async (jobId: string) => {
    try {
      setError(null)
      const files = await downloadResults.mutateAsync(jobId)

      if (files.length > 0) {
        alert(`Downloaded ${files.length} files:\n${files.join('\n')}`)
      } else {
        alert('No result files available')
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to download results')
    }
  }

  const handleCancelJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to cancel this job?')) return

    try {
      setError(null)
      await cancelJob.mutateAsync(jobId)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to cancel job')
    }
  }

  const handleDeleteJob = async (jobId: string) => {
    if (
      !confirm('Are you sure you want to delete this job? This will remove it from the database.')
    )
      return

    try {
      setError(null)
      await deleteJob.mutateAsync(jobId)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to delete job')
    }
  }

  const handleCleanupPending = async () => {
    const pendingCount = jobs.filter((j) => j.status === NSGJobStatus.Pending).length
    if (pendingCount === 0) {
      alert('No pending jobs to clean up')
      return
    }

    if (
      !confirm(`This will delete ${pendingCount} pending job(s) that failed to submit. Continue?`)
    )
      return

    try {
      setError(null)
      const deletedCount = await cleanupPendingJobs.mutateAsync()
      alert(`Cleaned up ${deletedCount} pending job(s)`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to cleanup pending jobs')
    }
  }

  const handleCopyJobId = async (jobId: string, nsgJobId: string | null) => {
    try {
      const idToCopy = nsgJobId || jobId
      await navigator.clipboard.writeText(idToCopy)
      setCopiedJobId(jobId)

      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopiedJobId(null)
      }, 2000)
    } catch (error) {
      console.error('Failed to copy job ID:', error)
      setError('Failed to copy job ID to clipboard')
    }
  }

  const handleViewResults = async (jobId: string) => {
    try {
      setViewingJobId(jobId)

      console.log('[NSG] Downloading results for job:', jobId)

      // Download results files (will fetch from NSG API)
      const files = await TauriService.downloadNSGResults(jobId)

      console.log('[NSG] Downloaded files:', files)

      if (files.length === 0) {
        alert('No result files available.\n\nThis job may have failed or the results may have been cleaned up by NSG.\n\nIf this is an old job from before recent fixes, please submit a new job.')
        return
      }

      // Check if output.tar.gz exists - need to extract it
      const tarFile = files.find((f) => f.includes('output.tar.gz'))
      if (tarFile) {
        console.log('[NSG] Found output.tar.gz, extracting...')
        try {
          const extractedFiles = await extractTarball.mutateAsync({ jobId, tarFilePath: tarFile })
          console.log('[NSG] Extracted files:', extractedFiles)
          // Add extracted files to the files list
          files.push(...extractedFiles)
        } catch (error) {
          console.error('[NSG] Failed to extract tarball:', error)
          // Continue anyway - maybe the files are already extracted
        }
      }

      // Find dda_results.json in the downloaded files
      const resultsFile = files.find(f => f.includes('dda_results.json'))

      if (!resultsFile) {
        // Show all downloaded files for debugging
        console.error('[NSG] Available files:', files)

        // Check if this is an external non-DDALAB job
        const isExternalNonDDALAB = isExternalJob({ id: jobId } as NSGJob)

        if (isExternalNonDDALAB) {
          alert(
            `This external job doesn't have DDALAB DDA results.\n\n` +
            `This appears to be a job submitted outside of DDALAB (possibly through the NSG portal directly).\n\n` +
            `Only DDALAB DDA analysis jobs have viewable results in the application.\n\n` +
            `Downloaded files (${files.length} total):\n${files.map(f => f.split('/').pop()).join('\n')}\n\n` +
            `Files have been downloaded to your local system. Check STDOUT/STDERR for job output.`
          )
        } else {
          alert(
            `DDA results file not found.\n\n` +
            `Downloaded files:\n${files.map(f => f.split('/').pop()).join('\n')}\n\n` +
            `The job may have failed. Check STDERR for errors.`
          )
        }
        return
      }

      // Read and parse the results file
      console.log('[NSG] Loading results from:', resultsFile)

      try {
        // Read the JSON file from disk
        const resultsJson = await TauriService.readTextFile(resultsFile)

        console.log('[NSG] Raw JSON length:', resultsJson.length, 'chars')
        console.log('[NSG] First 500 chars:', resultsJson.substring(0, 500))

        // Check for invalid JSON patterns
        if (resultsJson.includes('NaN') || resultsJson.includes('Infinity')) {
          console.log('[NSG] JSON contains NaN/Infinity, sanitizing...')
          // Only replace in numeric contexts, not in strings
          const sanitized = resultsJson
            .replace(/:\s*NaN\b/g, ': null')
            .replace(/:\s*Infinity\b/g, ': null')
            .replace(/:\s*-Infinity\b/g, ': null')
            .replace(/,\s*NaN\b/g, ', null')
            .replace(/,\s*Infinity\b/g, ', null')
            .replace(/,\s*-Infinity\b/g, ', null')
            .replace(/\[\s*NaN\b/g, '[null')
            .replace(/\[\s*Infinity\b/g, '[null')
            .replace(/\[\s*-Infinity\b/g, '[null')

          console.log('[NSG] Parsing sanitized JSON...')
          var resultsData = JSON.parse(sanitized)
        } else {
          console.log('[NSG] Parsing JSON directly...')
          var resultsData = JSON.parse(resultsJson)
        }

        console.log('[NSG] ✅ Parsed results data successfully:', {
          hasQMatrix: !!resultsData.q_matrix,
          qMatrixType: Array.isArray(resultsData.q_matrix) ? 'array' : 'object',
          numChannels: resultsData.num_channels,
          numTimepoints: resultsData.num_timepoints,
          parameters: resultsData.parameters
        })

        // NSG returns q_matrix as 2D array [[...], [...]] (channels × timepoints)
        // We need to convert to {channel_name: [...]} format
        const channelIndices = resultsData.parameters?.channels || []
        const qMatrixArray = Array.isArray(resultsData.q_matrix)
          ? resultsData.q_matrix
          : Object.values(resultsData.q_matrix)

        console.log('[NSG] Channel indices from params:', channelIndices)
        console.log('[NSG] Q matrix array length:', qMatrixArray.length)

        // Convert 2D array to map format
        // IMPORTANT: Channel indices can be 0, which is falsy in JavaScript!
        // Use explicit undefined check instead of ||
        const ddaMatrix: Record<string, number[]> = {}
        const channels: string[] = []

        // Use channel names from EDF if available, otherwise fall back to generic names
        const channelNamesFromEdf = resultsData.channel_names || []

        qMatrixArray.forEach((channelData: number[], index: number) => {
          // Get channel index or use the iteration index as fallback
          const channelIndex = channelIndices[index] !== undefined ? channelIndices[index] : index

          // Use actual channel name from EDF if available, otherwise use generic name
          const channelName = channelNamesFromEdf[index] || `Ch ${channelIndex + 1}`

          ddaMatrix[channelName] = channelData
          channels.push(channelName)
        })

        console.log('[NSG] Using channel names:', channels)

        // Sample some values to check data range
        const firstChannel = Object.keys(ddaMatrix)[0]
        const firstChannelData = ddaMatrix[firstChannel]
        const sampleValues = firstChannelData?.slice(0, 10) || []
        const allValues = Object.values(ddaMatrix).flat()
        const minVal = Math.min(...allValues)
        const maxVal = Math.max(...allValues)

        console.log('[NSG] Converted q_matrix to dda_matrix:', {
          numChannels: Object.keys(ddaMatrix).length,
          channels: Object.keys(ddaMatrix),
          firstChannelLength: firstChannelData?.length,
          sampleValues: sampleValues,
          dataRange: { min: minVal, max: maxVal }
        })

        // Generate scales array (actual time values, not just indices)
        // Match local results format: 0.0, 0.1, 0.2, ...
        const numTimepoints = resultsData.num_timepoints || qMatrixArray[0]?.length || 0
        const scales = resultsData.scales || Array.from(
          { length: numTimepoints },
          (_, i) => i * 0.1  // Match local results: time in 0.1s increments
        )

        // Transform NSG results to match DDA Results component expected format
        // DDAResults expects: result.results.variants to be an ARRAY of variant objects
        const transformedResults = {
          results: {
            variants: [  // MUST be an array!
              {
                variant_id: 'single_timeseries',
                variant_name: 'NSG Results',
                dda_matrix: ddaMatrix,  // {channel: [values]}
                exponents: resultsData.exponents || {},
                quality_metrics: resultsData.quality_metrics || {}
              }
            ],
            scales: scales,  // Required: x-axis values for plots
            Q: qMatrixArray,  // Original 2D array format
            channels: channels,
            plot_data: qMatrixArray,  // Original 2D array format
            dda_matrix: ddaMatrix,  // Also add at top level for backward compatibility
            metadata: {
              input_file: resultsData.parameters?.input_file,
              time_range: resultsData.parameters?.time_range,
              window_parameters: {
                window_length: resultsData.parameters?.window_length,
                window_step: resultsData.parameters?.window_step
              },
              scale_parameters: resultsData.parameters?.scale_parameters,
              num_channels: resultsData.num_channels,
              num_timepoints: numTimepoints
            }
          },
          parameters: resultsData.parameters,
          channels: channels,  // Top-level channels for metadata display
          name: `NSG Job ${jobId.slice(0, 8)}`,
          id: jobId,
          created_at: new Date().toISOString(),
          source: 'nsg'  // Mark as NSG source
        }

        console.log('[NSG] Transformed results for viewer:', {
          hasVariants: !!transformedResults.results.variants,
          variantsIsArray: Array.isArray(transformedResults.results.variants),
          variantsLength: transformedResults.results.variants?.length,
          hasScales: !!transformedResults.results.scales,
          scalesLength: transformedResults.results.scales?.length,
          channels: transformedResults.channels
        })

        // Load the results into the DDA analysis viewer
        // Dispatch event to DDA Analysis component to load these results
        window.dispatchEvent(new CustomEvent('load-nsg-results', {
          detail: {
            jobId,
            resultsFile,
            resultsData: transformedResults,
            sourceType: 'nsg'
          }
        }))

        // Show success dialog with option to navigate to Results tab
        setSuccessDialog({
          show: true,
          jobId: jobId.slice(0, 8),
          numChannels: resultsData.num_channels || 0
        })

      } catch (parseError) {
        console.error('[NSG] Failed to parse results file:', parseError)
        alert(`Failed to load results file.\n\nFile: ${resultsFile}\nError: ${parseError}\n\nThe file may be corrupted.`)
        return
      }

    } catch (error) {
      console.error('[NSG] Failed to view results:', error)
      const errorMsg = error instanceof Error ? error.message : 'Failed to view results'

      // Show user-friendly error
      if (errorMsg.includes('No output files available')) {
        setError('No output files available. This job may have failed or results were cleaned up. Please submit a new job.')
      } else {
        setError(errorMsg)
      }
    } finally {
      setViewingJobId(null)
      setDownloadProgress(null)
    }
  }

  const getStatusIcon = (status: NSGJobStatus) => {
    switch (status) {
      case NSGJobStatus.Pending:
        return <Clock className="h-4 w-4 text-gray-500" />
      case NSGJobStatus.Submitted:
      case NSGJobStatus.Queue:
        return <Play className="h-4 w-4 text-blue-500" />
      case NSGJobStatus.InputStaging:
        return <Cloud className="h-4 w-4 text-blue-500" />
      case NSGJobStatus.Running:
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
      case NSGJobStatus.Completed:
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case NSGJobStatus.Failed:
        return <XCircle className="h-4 w-4 text-red-500" />
      case NSGJobStatus.Cancelled:
        return <AlertCircle className="h-4 w-4 text-orange-500" />
      default:
        return <AlertCircle className="h-4 w-4" />
    }
  }

  const getStatusBadge = (status: NSGJobStatus) => {
    const variants: Record<NSGJobStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      [NSGJobStatus.Pending]: 'outline',
      [NSGJobStatus.Submitted]: 'secondary',
      [NSGJobStatus.Queue]: 'secondary',
      [NSGJobStatus.InputStaging]: 'secondary',
      [NSGJobStatus.Running]: 'default',
      [NSGJobStatus.Completed]: 'default',
      [NSGJobStatus.Failed]: 'destructive',
      [NSGJobStatus.Cancelled]: 'outline',
    }

    return (
      <Badge variant={variants[status]} className="flex items-center gap-1">
        {getStatusIcon(status)}
        <span>{status}</span>
      </Badge>
    )
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString()
  }

  // Filter jobs based on search term across all fields
  const filteredJobs = jobs
    .filter((job) => {
      if (!searchTerm.trim()) return true

      const search = searchTerm.toLowerCase()
      const jobId = (job.nsg_job_id || job.id || '').toLowerCase()
      const status = job.status.toLowerCase()
      const tool = job.tool.toLowerCase()
      const created = formatDate(job.created_at).toLowerCase()
      const submitted = formatDate(job.submitted_at).toLowerCase()
      const completed = formatDate(job.completed_at).toLowerCase()

      return (
        jobId.includes(search) ||
        status.includes(search) ||
        tool.includes(search) ||
        created.includes(search) ||
        submitted.includes(search) ||
        completed.includes(search)
      )
    })
    .sort((a, b) => {
      let aVal: string | number | null
      let bVal: string | number | null

      switch (sortColumn) {
        case 'jobId':
          aVal = a.nsg_job_id || a.id || ''
          bVal = b.nsg_job_id || b.id || ''
          break
        case 'status':
          aVal = a.status
          bVal = b.status
          break
        case 'tool':
          aVal = a.tool
          bVal = b.tool
          break
        case 'created':
          aVal = a.created_at ? new Date(a.created_at).getTime() : 0
          bVal = b.created_at ? new Date(b.created_at).getTime() : 0
          break
        case 'submitted':
          aVal = a.submitted_at ? new Date(a.submitted_at).getTime() : 0
          bVal = b.submitted_at ? new Date(b.submitted_at).getTime() : 0
          break
        case 'completed':
          aVal = a.completed_at ? new Date(a.completed_at).getTime() : 0
          bVal = b.completed_at ? new Date(b.completed_at).getTime() : 0
          break
        default:
          return 0
      }

      // Handle null/empty values - push to end
      if (!aVal && bVal) return 1
      if (aVal && !bVal) return -1
      if (!aVal && !bVal) return 0

      // Compare values
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

  const canCancel = (job: NSGJob) => {
    return [NSGJobStatus.Submitted, NSGJobStatus.Queue, NSGJobStatus.Running].includes(job.status)
  }

  const canDownload = (job: NSGJob) => {
    return job.status === NSGJobStatus.Completed && job.output_files.length > 0
  }

  const canViewResults = (job: NSGJob) => {
    // Show view button for all completed jobs (both DDALAB and external)
    // Results are read from dda_results.json which contains all necessary data
    // Files will be downloaded on-demand when clicking view
    return job.status === NSGJobStatus.Completed
  }

  const canUpdateStatus = (job: NSGJob) => {
    // External jobs are automatically synced from NSG - can't manually update status
    if (isExternalJob(job)) return false
    return ![NSGJobStatus.Completed, NSGJobStatus.Failed, NSGJobStatus.Cancelled].includes(job.status)
  }

  const handleNavigateToResults = () => {
    // Navigate to the main Dashboard Results tab, not the DDA Analysis tab
    window.dispatchEvent(new CustomEvent('navigate-to-main-results'))
    setSuccessDialog(null)
  }

  if (!TauriService.isTauri()) {
    return (
      <div className="p-6">
        <Alert>
          <AlertDescription>
            NSG job management is only available in the Tauri desktop application.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!hasCredentials) {
    return (
      <div className="p-6">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Please configure NSG credentials in Settings before managing jobs.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                NSG Job Manager
              </CardTitle>
              <CardDescription>
                View and manage your Neuroscience Gateway HPC jobs
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {jobs.some((j) => j.status === NSGJobStatus.Pending) && (
                <Button
                  onClick={handleCleanupPending}
                  variant="outline"
                  size="sm"
                  disabled={cleanupPendingJobs.isPending}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Clean Up Pending
                </Button>
              )}
              <Button onClick={handleRefresh} variant="outline" size="sm" disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {(error || jobsError) && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error || (jobsError instanceof Error ? jobsError.message : 'Failed to load jobs')}
              </AlertDescription>
            </Alert>
          )}

          {/* Search Bar */}
          {jobs.length > 0 && (
            <div className="mb-4 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search jobs by ID, status, tool, or date..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  title="Clear search"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {isLoading && jobs.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No NSG jobs found. Submit a job from the DDA analysis panel to get started.
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No jobs match your search "{searchTerm}". Try a different search term.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button
                        onClick={() => handleSort('jobId')}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Job ID
                        {sortColumn === 'jobId' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort('status')}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Status
                        {sortColumn === 'status' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort('tool')}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Tool
                        {sortColumn === 'tool' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort('created')}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Created
                        {sortColumn === 'created' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort('submitted')}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Submitted
                        {sortColumn === 'submitted' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort('completed')}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Completed
                        {sortColumn === 'completed' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>Results</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredJobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            {isExternalJob(job) ? (
                              <Badge variant="outline" className="text-xs px-1.5 py-0">
                                <Cloud className="h-3 w-3 mr-1" />
                                External
                              </Badge>
                            ) : (
                              <Badge variant="default" className="text-xs px-1.5 py-0 bg-blue-600">
                                DDALAB
                              </Badge>
                            )}
                            <span>{job.nsg_job_id || job.id.slice(0, 8)}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => handleCopyJobId(job.id, job.nsg_job_id)}
                            title="Copy job ID"
                          >
                            {copiedJobId === job.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(job.status)}</TableCell>
                      <TableCell>{job.tool}</TableCell>
                      <TableCell className="text-sm">{formatDate(job.created_at)}</TableCell>
                      <TableCell className="text-sm">{formatDate(job.submitted_at)}</TableCell>
                      <TableCell className="text-sm">{formatDate(job.completed_at)}</TableCell>
                      <TableCell className="text-sm">
                        {(() => {
                          const canView = canViewResults(job)
                          const isDownloading = viewingJobId === job.id
                          const showProgress = isDownloading && downloadProgress?.jobId === job.id
                          const isExternal = isExternalJob(job)

                          return canView ? (
                            <div className="flex flex-col gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleViewResults(job.id)}
                                disabled={isDownloading}
                                className="h-7"
                                title={
                                  isExternal
                                    ? 'Download files (DDA results may not be available for external jobs)'
                                    : 'View DDA results'
                                }
                              >
                                {isDownloading ? (
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                ) : isExternal ? (
                                  <Download className="h-3 w-3 mr-1" />
                                ) : (
                                  <Eye className="h-3 w-3 mr-1" />
                                )}
                                {isExternal
                                  ? job.output_files.length > 0
                                    ? `Download (${job.output_files.length})`
                                    : 'Download Files'
                                  : job.output_files.length > 0
                                  ? `View (${job.output_files.length})`
                                  : 'View Results'}
                              </Button>
                              {showProgress && (
                                <div className="flex flex-col gap-1 min-w-[200px]">
                                  <div className="text-xs text-muted-foreground truncate" title={downloadProgress.filename}>
                                    {downloadProgress.filename}
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                                    <div
                                      className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                                      style={{ width: `${downloadProgress.fileProgress}%` }}
                                    />
                                  </div>
                                  <div className="text-xs text-muted-foreground flex justify-between">
                                    <span>File {downloadProgress.currentFile}/{downloadProgress.totalFiles}</span>
                                    <span>{downloadProgress.fileProgress}%</span>
                                  </div>
                                  <div className="text-xs text-muted-foreground text-center">
                                    {formatBytes(downloadProgress.bytesDownloaded)} / {formatBytes(downloadProgress.totalBytes)}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">
                              {job.output_files.length > 0 ? `${job.output_files.length} files` : '-'}
                            </span>
                          )
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {canUpdateStatus(job) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleUpdateStatus(job.id)}
                              disabled={updateJobStatus.isPending}
                              title="Update job status"
                            >
                              {updateJobStatus.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {canDownload(job) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownloadResults(job.id)}
                              disabled={downloadResults.isPending}
                            >
                              {downloadResults.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {canCancel(job) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleCancelJob(job.id)}
                              disabled={cancelJob.isPending}
                            >
                              {cancelJob.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <XCircle className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteJob(job.id)}
                            disabled={deleteJob.isPending}
                          >
                            {deleteJob.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Success Dialog */}
      <AlertDialog open={successDialog?.show || false} onOpenChange={(open) => !open && setSuccessDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              NSG Results Loaded Successfully!
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-2">
                <div className="text-sm">
                  <strong>Job ID:</strong> {successDialog?.jobId}
                </div>
                <div className="text-sm">
                  <strong>Channels Analyzed:</strong> {successDialog?.numChannels}
                </div>
                <div className="text-sm text-muted-foreground mt-4">
                  Your results have been loaded and are ready to view in the DDA Analysis panel.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSuccessDialog(null)}>
              Close
            </AlertDialogAction>
            <Button onClick={handleNavigateToResults} className="ml-2">
              <Eye className="h-4 w-4 mr-2" />
              View Results
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
