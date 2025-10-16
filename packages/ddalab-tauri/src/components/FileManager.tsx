'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import { ApiService } from '@/services/apiService'
import { EDFFileInfo } from '@/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useDirectoryListing, useLoadFileInfo } from '@/hooks/useFileManagement'
import { useBIDSMultipleDetections } from '@/hooks/useBIDSQuery'
import type { DirectoryEntry } from '@/types/bids'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Search,
  Folder,
  FileText,
  SortAsc,
  SortDesc,
  RefreshCw,
  Download,
  Calendar,
  HardDrive,
  Eye,
  EyeOff,
  ChevronRight,
  Home,
  Check,
  FolderOpen,
  Upload
} from 'lucide-react'
import { TauriService } from '@/services/tauriService'
import { formatBytes, formatDate } from '@/lib/utils'
import { useWorkflow } from '@/hooks/useWorkflow'
import { createLoadFileAction } from '@/types/workflow'
import { BIDSBrowser } from '@/components/BIDSBrowser'
import { BIDSUploadDialog } from '@/components/BIDSUploadDialog'
import { openNeuroService } from '@/services/openNeuroService'

interface FileManagerProps {
  apiService: ApiService
}

export function FileManager({ apiService }: FileManagerProps) {
  const {
    fileManager,
    setSelectedFile,
    updateFileManagerState,
    setSelectedChannels,
    setCurrentPath,
    setDataDirectoryPath,
    resetCurrentPathSync,
    clearPendingFileSelection,
    ui,
    workflowRecording,
    incrementActionCount,
    isPersistenceRestored
  } = useAppStore()

  const { recordAction } = useWorkflow()

  // Build absolute path for directory listing
  const relativePath = fileManager.currentPath.join('/')
  const absolutePath = relativePath ? `${fileManager.dataDirectoryPath}/${relativePath}` : fileManager.dataDirectoryPath

  // Use TanStack Query for directory listing
  // Only wait for server to be ready - no need to block on persistence
  const {
    data: directoryData,
    isLoading: directoryLoading,
    error: directoryError,
    refetch: refetchDirectory
  } = useDirectoryListing(
    apiService,
    absolutePath || '',
    !!absolutePath && !!fileManager.dataDirectoryPath && ui.isServerReady
  )

  // Use mutation for loading file info
  const loadFileInfoMutation = useLoadFileInfo(apiService)

  const [pendingFileSelection, setPendingFileSelection] = useState<EDFFileInfo | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [bidsDatasetPath, setBidsDatasetPath] = useState<string | null>(null)
  const [showBidsBrowser, setShowBidsBrowser] = useState(false)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [uploadDatasetPath, setUploadDatasetPath] = useState<string | null>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  // Extract directories and files from query data
  const directories = useMemo(() => {
    if (!directoryData?.files) return []
    return directoryData.files
      .filter(f => f.is_directory)
      .map(d => ({ name: d.name, path: d.path }))
  }, [directoryData])

  const files = useMemo(() => {
    if (!directoryData?.files) return []
    return directoryData.files
      .filter(f => !f.is_directory)
      .filter(file =>
        file.name.toLowerCase().endsWith('.edf') ||
        file.name.toLowerCase().endsWith('.csv') ||
        file.name.toLowerCase().endsWith('.ascii') ||
        file.name.toLowerCase().endsWith('.txt')
      )
      .map(file => ({
        file_path: file.path,
        file_name: file.name,
        file_size: file.size || 0,
        duration: 0,
        sample_rate: 256,
        channels: [],
        total_samples: 0,
        start_time: file.last_modified || new Date().toISOString(),
        end_time: file.last_modified || new Date().toISOString(),
        annotations_count: 0
      }))
  }, [directoryData])

  // Use BIDS detection queries for all directories
  const bidsQueries = useBIDSMultipleDetections(directories)
  const directoriesWithBIDS = useMemo(() => {
    return bidsQueries.map((query, index) => {
      if (query.isSuccess && query.data) {
        return query.data
      }
      return { ...directories[index], isBIDS: false }
    })
  }, [bidsQueries, directories])

  const checkingBIDS = bidsQueries.some(q => q.isLoading)

  // Load the data directory path on mount if not already set
  useEffect(() => {
    const loadDataDirectoryPath = async () => {
      if (TauriService.isTauri() && !fileManager.dataDirectoryPath) {
        try {
          const path = await TauriService.getDataDirectory()
          console.log('[FILEMANAGER] Loaded data directory path:', path)
          setDataDirectoryPath(path)
        } catch (error) {
          console.error('[FILEMANAGER] Failed to load data directory path:', error)
        }
      }
    }
    loadDataDirectoryPath()
  }, [])

  // Handle initial load state
  useEffect(() => {
    if (isInitialLoad && ui.isServerReady && isPersistenceRestored) {
      console.log('[FILEMANAGER] Server ready and persistence restored')
      setIsInitialLoad(false)
    }
  }, [ui.isServerReady, isPersistenceRestored, isInitialLoad])

  // Handle pending file selection restoration
  // Start immediately when server is ready - no need to wait for isInitialLoad flag
  useEffect(() => {
    if (fileManager.pendingFileSelection && ui.isServerReady && isPersistenceRestored) {
      // Try to restore immediately without waiting for directory listing
      const filePath = fileManager.pendingFileSelection
      console.log('[FILEMANAGER] ⚡ Fast-restoring file from path:', filePath)

      // Load file directly by path - don't wait for directory listing
      loadFileInfoMutation.mutate(filePath, {
        onSuccess: (fileInfo) => {
          console.log('[FILEMANAGER] ✓ File restored successfully:', fileInfo.file_name)
          setSelectedFile(fileInfo)
          clearPendingFileSelection()

          // Record file load action if recording is active
          if (workflowRecording.isRecording) {
            const action = createLoadFileAction(fileInfo.file_path, fileInfo.file_path.endsWith('.edf') ? 'EDF' : 'ASCII')
            recordAction(action).then(() => {
              console.log('[WORKFLOW] Recorded restored file load:', fileInfo.file_path)
            }).catch(err => {
              console.error('[WORKFLOW] Failed to record action:', err)
            })
          }
        },
        onError: (error) => {
          console.error('[FILEMANAGER] ✗ File restoration failed:', error)
          clearPendingFileSelection()
        }
      })
    }
  }, [fileManager.pendingFileSelection, ui.isServerReady, isPersistenceRestored])

  // Show loading if directory is loading OR if we're waiting for initial data
  const loading = directoryLoading || (isInitialLoad && !directoryData) || loadFileInfoMutation.isPending
  const error = directoryError ? (directoryError instanceof Error ? directoryError.message : 'Failed to load directory') : null

  // Filter directories based on search query
  const filteredDirectories = useMemo(() => {
    let filtered = directoriesWithBIDS

    // Apply search filter
    if (fileManager.searchQuery) {
      const query = fileManager.searchQuery.toLowerCase()
      filtered = filtered.filter(dir =>
        dir.name.toLowerCase().includes(query) ||
        (dir.isBIDS && dir.bidsInfo?.datasetName?.toLowerCase().includes(query))
      )
    }

    // Apply hidden files filter
    if (!fileManager.showHidden) {
      filtered = filtered.filter(dir => !dir.name.startsWith('.'))
    }

    return filtered
  }, [directoriesWithBIDS, fileManager.searchQuery, fileManager.showHidden])

  // Filter and sort files
  const filteredAndSortedFiles = useMemo(() => {
    let filtered = files

    // Apply search filter
    if (fileManager.searchQuery) {
      const query = fileManager.searchQuery.toLowerCase()
      filtered = filtered.filter(file =>
        file.file_name.toLowerCase().includes(query)
      )
    }

    // Apply hidden files filter
    if (!fileManager.showHidden) {
      filtered = filtered.filter(file => !file.file_name.startsWith('.'))
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0

      switch (fileManager.sortBy) {
        case 'name':
          comparison = a.file_name.localeCompare(b.file_name)
          break
        case 'size':
          comparison = a.file_size - b.file_size
          break
        case 'date':
          comparison = new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
          break
        default:
          comparison = a.file_name.localeCompare(b.file_name)
      }

      return fileManager.sortOrder === 'desc' ? -comparison : comparison
    })

    return filtered
  }, [files, fileManager.searchQuery, fileManager.showHidden, fileManager.sortBy, fileManager.sortOrder])

  const handleFileSelect = (file: EDFFileInfo) => {
    // Prevent file selection while persisted file is being restored
    // This avoids race conditions and unintentional clicks during startup
    if (fileManager.pendingFileSelection) {
      console.log('[FILEMANAGER] Ignoring file click - pending restoration:', fileManager.pendingFileSelection)
      return
    }

    // If a file is already selected and it's different from the new selection
    if (fileManager.selectedFile && fileManager.selectedFile.file_path !== file.file_path) {
      setPendingFileSelection(file)
      setShowConfirmDialog(true)
    } else {
      // No file selected yet or clicking the same file
      loadFileInfo(file)
    }
  }

  const loadFileInfo = async (file: EDFFileInfo) => {
    // Set file as selected immediately for instant visual feedback
    setSelectedFile(file)

    // Use mutation to load file info
    loadFileInfoMutation.mutate(file.file_path, {
      onSuccess: (fileInfo) => {
        // Update with full details
        setSelectedFile(fileInfo)

        // Record file load action if recording is active
        if (workflowRecording.isRecording) {
          try {
            const ext = file.file_path.split('.').pop()?.toLowerCase()
            let fileType: 'EDF' | 'ASCII' | 'CSV' = 'EDF'
            if (ext === 'csv') fileType = 'CSV'
            else if (ext === 'ascii' || ext === 'txt') fileType = 'ASCII'

            const action = createLoadFileAction(file.file_path, fileType)
            recordAction(action).then(() => {
              incrementActionCount()
              console.log('[WORKFLOW] Recorded file load:', file.file_path)
            }).catch(error => {
              console.error('[WORKFLOW] Failed to record file load:', error)
            })
          } catch (error) {
            console.error('[WORKFLOW] Failed to record file load:', error)
          }
        }

        // Auto-select first few channels if none selected OR if selected channels don't exist in this file
        const validSelectedChannels = fileManager.selectedChannels.filter(ch =>
          fileInfo.channels.includes(ch)
        )

        if (fileInfo.channels.length > 0 && validSelectedChannels.length === 0) {
          const defaultChannels = fileInfo.channels.slice(0, Math.min(10, fileInfo.channels.length))
          console.log('[FILEMANAGER] Auto-selecting default channels:', defaultChannels)
          setSelectedChannels(defaultChannels)
        } else if (validSelectedChannels.length !== fileManager.selectedChannels.length) {
          console.log('[FILEMANAGER] Updating to valid channels only:', validSelectedChannels)
          setSelectedChannels(validSelectedChannels)
        }
      },
      onError: (error) => {
        console.error('Failed to load file info:', error)
      }
    })
  }

  const confirmFileSelection = () => {
    if (pendingFileSelection) {
      loadFileInfo(pendingFileSelection)
      setPendingFileSelection(null)
    }
    setShowConfirmDialog(false)
  }

  const cancelFileSelection = () => {
    setPendingFileSelection(null)
    setShowConfirmDialog(false)
  }

  const handleDirectorySelect = (dir: DirectoryEntry) => {
    // Check if this is a BIDS dataset - if so, open BIDS browser instead of navigating
    if (dir.isBIDS) {
      console.log('[FILEMANAGER] BIDS dataset detected, opening BIDS browser:', dir.path)
      setBidsDatasetPath(dir.path)
      setShowBidsBrowser(true)
      return
    }

    // dir.path is absolute - we need to make it relative to dataDirectoryPath
    const absolutePath = dir.path

    // Remove the dataDirectoryPath prefix to get relative path
    let relativePath = absolutePath
    if (absolutePath.startsWith(fileManager.dataDirectoryPath)) {
      relativePath = absolutePath.slice(fileManager.dataDirectoryPath.length)
    }

    // Split and filter empty segments
    const newPath = relativePath.split('/').filter(p => p.length > 0)

    console.log('[FILEMANAGER] Directory selected:', {
      dirPath: dir.path,
      dataDirectoryPath: fileManager.dataDirectoryPath,
      relativePath,
      newPath,
      isBIDS: dir.isBIDS,
      bidsInfo: dir.bidsInfo
    })

    setCurrentPath(newPath)
  }

  const handleBidsFileSelect = async (filePath: string) => {
    console.log('[FILEMANAGER] BIDS file selected:', filePath)

    // Check if file format is supported
    const extension = filePath.split('.').pop()?.toLowerCase()
    const supportedFormats = ['edf', 'csv', 'txt', 'ascii', 'vhdr', 'set']

    if (extension && !supportedFormats.includes(extension)) {
      console.error(
        `File format .${extension} is not yet supported. Currently supported formats: EDF, CSV, ASCII/TXT, BrainVision (.vhdr), EEGLAB (.set).`
      )
      return
    }

    // Load the selected file through the API using mutation
    try {
      loadFileInfoMutation.mutate(filePath, {
        onSuccess: (fileInfo) => {
          // Load file info and close BIDS browser
          loadFileInfo(fileInfo)
          setShowBidsBrowser(false)
          setBidsDatasetPath(null)
        },
        onError: (error) => {
          console.error('[FILEMANAGER] Failed to load BIDS file:', error)
        }
      })
    } catch (error) {
      console.error('[FILEMANAGER] Failed to load BIDS file:', error)
    }
  }

  const handleCloseBidsBrowser = () => {
    setShowBidsBrowser(false)
    setBidsDatasetPath(null)
  }

  const navigateUp = () => {
    if (fileManager.currentPath.length > 0) {
      const newPath = fileManager.currentPath.slice(0, -1)
      setCurrentPath(newPath)
    }
  }

  const navigateToRoot = () => {
    setCurrentPath([])
  }

  const toggleSort = (sortBy: typeof fileManager.sortBy) => {
    if (fileManager.sortBy === sortBy) {
      updateFileManagerState({
        sortOrder: fileManager.sortOrder === 'asc' ? 'desc' : 'asc'
      })
    } else {
      updateFileManagerState({
        sortBy,
        sortOrder: 'asc'
      })
    }
  }

  const handleChangeDataDirectory = async () => {
    if (!TauriService.isTauri()) return

    try {
      // Open folder picker dialog (without saving to backend config)
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Data Directory'
      })

      if (!selected || typeof selected !== 'string') {
        console.log('[FILEMANAGER] Directory selection cancelled')
        return
      }

      console.log('[FILEMANAGER] ===== DIRECTORY CHANGE START =====')
      console.log('[FILEMANAGER] Selected directory:', selected)
      console.log('[FILEMANAGER] Type of selected:', typeof selected)
      console.log('[FILEMANAGER] Current dataDirectoryPath:', fileManager.dataDirectoryPath)
      console.log('[FILEMANAGER] Current path array:', fileManager.currentPath)

      // Reset currentPath to [] and persist synchronously before changing directory
      console.log('[FILEMANAGER] Calling resetCurrentPathSync...')
      await resetCurrentPathSync()
      console.log('[FILEMANAGER] resetCurrentPathSync complete')

      // Save to backend (persists to OS config directory)
      console.log('[FILEMANAGER] Saving to backend with TauriService.setDataDirectory...')
      await TauriService.setDataDirectory(selected)
      console.log('[FILEMANAGER] Backend save complete')

      // Update the store (which also persists via state manager)
      console.log('[FILEMANAGER] Calling setDataDirectoryPath with:', selected)
      setDataDirectoryPath(selected)
      console.log('[FILEMANAGER] ===== DIRECTORY CHANGE END =====')

      // React Query will automatically refetch when path changes
    } catch (error) {
      console.error('Failed to select data directory:', error)
      // User probably cancelled - silently ignore
    }
  }

  // Show BIDS browser if a BIDS dataset is selected
  if (showBidsBrowser && bidsDatasetPath) {
    return (
      <BIDSBrowser
        datasetPath={bidsDatasetPath}
        onFileSelect={handleBidsFileSelect}
        onClose={handleCloseBidsBrowser}
      />
    )
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Folder className="h-5 w-5" />
              File Manager
            </CardTitle>
            <CardDescription>
              Browse and select EDF/ASCII files for analysis
            </CardDescription>
          </div>
        </div>

        {/* Navigation breadcrumbs and controls */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1 flex-shrink-0">
            {TauriService.isTauri() && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleChangeDataDirectory}
                title="Change data directory"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Change Directory
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => updateFileManagerState({
                showHidden: !fileManager.showHidden
              })}
              title={fileManager.showHidden ? "Hide hidden files" : "Show hidden files"}
            >
              {fileManager.showHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetchDirectory()}
              disabled={loading}
              title="Refresh directory"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="sm"
              onClick={navigateToRoot}
              className="h-6 px-2"
            >
              <Home className="h-3 w-3" />
            </Button>

            {fileManager.currentPath.map((segment, index) => (
              <div key={index} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentPath(fileManager.currentPath.slice(0, index + 1))}
                  className="h-6 px-2"
                >
                  {segment}
                </Button>
              </div>
            ))}

            {fileManager.currentPath.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={navigateUp}
                className="h-6 px-2 ml-2"
                title="Go up one level"
              >
                ..
              </Button>
            )}
          </div>
        </div>

        {/* Search and filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={fileManager.searchQuery}
              onChange={(e) => updateFileManagerState({ searchQuery: e.target.value })}
              className="pl-8"
            />
          </div>

          <Select
            value={fileManager.sortBy}
            onValueChange={(value: typeof fileManager.sortBy) => toggleSort(value)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="size">Size</SelectItem>
              <SelectItem value="date">Date</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleSort(fileManager.sortBy)}
            title={`Sort ${fileManager.sortOrder === 'asc' ? 'descending' : 'ascending'}`}
          >
            {fileManager.sortOrder === 'asc' ?
              <SortAsc className="h-4 w-4" /> :
              <SortDesc className="h-4 w-4" />
            }
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        {error && (
          <div className="p-4 mb-4 text-sm text-red-800 bg-red-100 rounded-lg">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="relative">
              <RefreshCw className="h-12 w-12 animate-spin text-primary" />
              <div className="absolute -inset-2 bg-primary/10 rounded-full blur-xl animate-pulse" />
            </div>
            <div className="text-center space-y-2">
              <p className="font-medium text-lg">
                {loadFileInfoMutation.isPending
                  ? 'Loading file metadata...'
                  : !isPersistenceRestored
                    ? 'Restoring previous session...'
                    : 'Loading directory...'}
              </p>
              <p className="text-sm text-muted-foreground">
                {loadFileInfoMutation.isPending
                  ? 'Reading file information from backend'
                  : !isPersistenceRestored
                    ? 'Loading saved state, plots, and analysis results'
                    : `Scanning ${fileManager.currentPath.length > 0 ? fileManager.currentPath.join('/') : 'root directory'}`
                }
              </p>
              {checkingBIDS && (
                <div className="flex items-center justify-center gap-2 mt-2 text-purple-600">
                  <div className="w-2 h-2 bg-purple-600 rounded-full animate-pulse" />
                  <span className="text-xs">Checking for BIDS datasets...</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Directories */}
            {filteredDirectories.map((dir) => (
              <div
                key={dir.path}
                className={`flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition-colors ${
                  dir.isBIDS ? 'border-purple-300 bg-purple-50/50' : ''
                }`}
              >
                <div
                  onClick={() => handleDirectorySelect(dir)}
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                >
                  <Folder className={`h-5 w-5 flex-shrink-0 ${dir.isBIDS ? 'text-purple-600' : 'text-blue-600'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{dir.name}</span>
                      {dir.isBIDS && (
                        <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-xs flex-shrink-0">
                          BIDS Dataset
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {dir.isBIDS && dir.bidsInfo ? (
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {dir.bidsInfo.datasetName && (
                            <span className="font-medium text-purple-700 truncate">{dir.bidsInfo.datasetName}</span>
                          )}
                          {dir.bidsInfo.subjectCount !== undefined && (
                            <span className="flex-shrink-0">{dir.bidsInfo.subjectCount} subject{dir.bidsInfo.subjectCount !== 1 ? 's' : ''}</span>
                          )}
                          {dir.bidsInfo.modalities && dir.bidsInfo.modalities.length > 0 && (
                            <span className="text-xs truncate">{dir.bidsInfo.modalities.join(', ')}</span>
                          )}
                        </div>
                      ) : (
                        'Directory'
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
                {dir.isBIDS && openNeuroService.isAuthenticated() && (
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setUploadDatasetPath(dir.path);
                      setShowUploadDialog(true);
                    }}
                    className="ml-2 flex-shrink-0"
                    title="Upload to OpenNeuro"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}

            {/* Files */}
            {filteredAndSortedFiles.map((file, index) => (
              <div
                key={`${file.file_path}-${index}`}
                onClick={() => handleFileSelect(file)}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all
                  ${(fileManager.pendingFileSelection || loadFileInfoMutation.isPending)
                    ? 'opacity-50 cursor-wait pointer-events-none'
                    : 'cursor-pointer hover:bg-accent hover:shadow-sm'
                  }
                  ${fileManager.selectedFile?.file_path === file.file_path
                    ? 'bg-primary/10 border-primary shadow-sm ring-2 ring-primary/20'
                    : ''
                  }`}
              >
                <FileText className="h-5 w-5 text-green-600" />

                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{file.file_name}</div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      {formatBytes(file.file_size)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(file.start_time)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  {fileManager.selectedFile?.file_path === file.file_path && (
                    <div className="flex items-center gap-1 text-primary mb-1">
                      <Check className="h-4 w-4" />
                      <span className="text-xs font-medium">Selected</span>
                    </div>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    {file.file_name.toLowerCase().endsWith('.edf') ? 'EDF' :
                     file.file_name.toLowerCase().endsWith('.csv') ? 'CSV' :
                     file.file_name.toLowerCase().endsWith('.ascii') ? 'ASCII' : 'TXT'}
                  </Badge>
                  {file.channels.length > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {file.channels.length} channels
                    </Badge>
                  )}
                </div>
              </div>
            ))}

            {filteredAndSortedFiles.length === 0 && filteredDirectories.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                {!fileManager.dataDirectoryPath ? (
                  <div className="space-y-3">
                    <p className="font-medium text-foreground">No Data Directory Selected</p>
                    <p className="text-sm">
                      Choose a data directory using the "Change Directory" button above to get started
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p>No files found</p>
                    <p className="text-sm">
                      {fileManager.searchQuery
                        ? 'Try adjusting your search query'
                        : 'No EDF, CSV, or ASCII files in this directory'
                      }
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Selected File?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to change the selected file? This will reset your current analysis workspace.
              <div className="mt-4 space-y-2">
                <div className="p-2 bg-muted rounded">
                  <p className="text-sm font-medium">Current file:</p>
                  <p className="text-sm">{fileManager.selectedFile?.file_name}</p>
                </div>
                <div className="p-2 bg-muted rounded">
                  <p className="text-sm font-medium">New file:</p>
                  <p className="text-sm">{pendingFileSelection?.file_name}</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelFileSelection}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmFileSelection}>Change File</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* BIDS Upload Dialog */}
      {uploadDatasetPath && (
        <BIDSUploadDialog
          isOpen={showUploadDialog}
          onClose={() => {
            setShowUploadDialog(false);
            setUploadDatasetPath(null);
          }}
          datasetPath={uploadDatasetPath}
          onUploadComplete={(datasetId) => {
            console.log(`Dataset uploaded successfully: ${datasetId}`);
            setShowUploadDialog(false);
            setUploadDatasetPath(null);
          }}
        />
      )}

    </Card>
  )
}
