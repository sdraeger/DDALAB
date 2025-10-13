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
import { useBIDSDetection } from '@/hooks/useBIDSDetection'
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
  FolderOpen
} from 'lucide-react'
import { TauriService } from '@/services/tauriService'
import { formatBytes, formatDate } from '@/lib/utils'
import { useWorkflow } from '@/hooks/useWorkflow'
import { createLoadFileAction } from '@/types/workflow'
import { BIDSBrowser } from '@/components/BIDSBrowser'

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
  const { checkDirectories, checking: checkingBIDS } = useBIDSDetection()

  const [files, setFiles] = useState<EDFFileInfo[]>([])
  const [directories, setDirectories] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(true) // Start with loading true
  const [error, setError] = useState<string | null>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [pendingFileSelection, setPendingFileSelection] = useState<EDFFileInfo | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [bidsDatasetPath, setBidsDatasetPath] = useState<string | null>(null)
  const [showBidsBrowser, setShowBidsBrowser] = useState(false)

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

  // Load files when component mounts or path changes
  // Only load if server is ready to avoid blocking UI with failed requests
  useEffect(() => {
    if (fileManager.dataDirectoryPath && ui.isServerReady && !isInitialLoad) {
      loadCurrentDirectory()
    }
  }, [fileManager.currentPath, fileManager.dataDirectoryPath, ui.isServerReady])

  // Ensure we load on mount even if currentPath hasn't changed
  // Wait for server to be ready AND persistence to be restored before loading
  useEffect(() => {
    if (isInitialLoad && ui.isServerReady && isPersistenceRestored && fileManager.dataDirectoryPath) {
      console.log('[FILEMANAGER] Server ready and persistence restored, loading initial directory')
      setIsInitialLoad(false)
      loadCurrentDirectory()
    } else if (isInitialLoad && ui.isServerReady && !fileManager.dataDirectoryPath) {
      // Server is ready but no directory selected - stop loading and show message
      console.log('[FILEMANAGER] Server ready, no directory selected')
      setIsInitialLoad(false)
      setLoading(false)
    } else if (isInitialLoad && ui.isServerReady && !isPersistenceRestored) {
      console.log('[FILEMANAGER] Server ready, waiting for persistence to restore...')
    }
  }, [ui.isServerReady, isPersistenceRestored, isInitialLoad, fileManager.dataDirectoryPath])

  const loadCurrentDirectory = async () => {
    try {
      setLoading(true)
      setError(null)

      // Build absolute path: dataDirectoryPath + relative currentPath
      const relativePath = fileManager.currentPath.join('/')
      const absolutePath = relativePath ? `${fileManager.dataDirectoryPath}/${relativePath}` : fileManager.dataDirectoryPath

      console.log('[FILEMANAGER] Loading directory:', {
        dataDirectoryPath: fileManager.dataDirectoryPath,
        relativePath,
        absolutePath,
        currentPathArray: fileManager.currentPath
      })

      // Get directory listing - pass absolute path
      const result = await apiService.listDirectory(absolutePath)

      if (result.files) {
        // Separate directories and files
        const dirs = result.files.filter(f => f.is_directory)
        const fileList = result.files.filter(f => !f.is_directory)

        // Convert to DirectoryEntry format
        const dirEntries: DirectoryEntry[] = dirs.map(d => ({
          name: d.name,
          path: d.path
        }))

        // Check for BIDS datasets asynchronously
        const bidsEnrichedDirs = await checkDirectories(dirEntries)
        setDirectories(bidsEnrichedDirs)

        // Convert to EDFFileInfo format
        const edfFiles: EDFFileInfo[] = fileList
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
            duration: 0, // Will be loaded when file is selected
            sample_rate: 256,
            channels: [],
            total_samples: 0,
            start_time: file.last_modified || new Date().toISOString(),
            end_time: file.last_modified || new Date().toISOString(),
            annotations_count: 0
          }))

        setFiles(edfFiles)

        // Immediately restore pending file selection if present
        // This eliminates the delay between loading files and restoring selection
        console.log('[FILEMANAGER] Checking for pending file selection:', {
          pendingFileSelection: fileManager.pendingFileSelection,
          isServerReady: ui.isServerReady,
          filesLoaded: edfFiles.length
        })

        if (fileManager.pendingFileSelection && ui.isServerReady) {
          const fileToSelect = edfFiles.find(f => f.file_path === fileManager.pendingFileSelection)
          if (fileToSelect) {
            console.log('[FILEMANAGER] ✓ Restoring selected file asynchronously:', {
              fileName: fileToSelect.file_name,
              filePath: fileToSelect.file_path
            })
            // Load file info asynchronously without blocking UI
            // Use setTimeout to defer to next event loop tick
            setTimeout(() => {
              loadFileInfo(fileToSelect).then(() => {
                console.log('[FILEMANAGER] File restoration completed')
              }).catch(err => {
                console.error('[FILEMANAGER] File restoration failed:', err)
              })
            }, 0)
            clearPendingFileSelection()
          } else {
            console.warn('[FILEMANAGER] ✗ Pending file not found in loaded files:', {
              pendingPath: fileManager.pendingFileSelection,
              loadedFiles: edfFiles.map(f => f.file_path)
            })
            clearPendingFileSelection()
          }
        } else if (!fileManager.pendingFileSelection) {
          console.log('[FILEMANAGER] No pending file selection to restore')
        }
      }
    } catch (err) {
      console.error('Failed to load directory:', err)
      setError(err instanceof Error ? err.message : 'Failed to load directory')
    } finally {
      setLoading(false)
    }
  }

  // NOTE: Pending file selection is now handled inline in loadCurrentDirectory
  // to eliminate the visible delay. The useEffect has been removed to avoid double-loading.

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
    try {
      // Set file as selected immediately for instant visual feedback
      // This shows the file highlighted while metadata loads
      setSelectedFile(file)
      setLoading(true)

      // Get detailed file information
      const fileInfo = await apiService.getFileInfo(file.file_path)
      // Update with full details
      setSelectedFile(fileInfo)

      // Record file load action if recording is active
      if (workflowRecording.isRecording) {
        try {
          // Determine file type from extension
          const ext = file.file_path.split('.').pop()?.toLowerCase()
          let fileType: 'EDF' | 'ASCII' | 'CSV' = 'EDF'
          if (ext === 'csv') fileType = 'CSV'
          else if (ext === 'ascii' || ext === 'txt') fileType = 'ASCII'

          const action = createLoadFileAction(file.file_path, fileType)
          await recordAction(action)
          incrementActionCount()
          console.log('[WORKFLOW] Recorded file load:', file.file_path)
        } catch (error) {
          console.error('[WORKFLOW] Failed to record file load:', error)
        }
      }

      // Auto-select first few channels if none selected
      if (fileInfo.channels.length > 0 && fileManager.selectedChannels.length === 0) {
        const defaultChannels = fileInfo.channels.slice(0, Math.min(4, fileInfo.channels.length))
        setSelectedChannels(defaultChannels)
      }

    } catch (error) {
      console.error('Failed to load file info:', error)
      setError(error instanceof Error ? error.message : 'Failed to load file info')
    } finally {
      setLoading(false)
    }
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
      setError(
        `File format .${extension} is not yet supported. Currently supported formats: EDF, CSV, ASCII/TXT, BrainVision (.vhdr), EEGLAB (.set).`
      )
      setLoading(false)
      return
    }

    // Load the selected file through the API
    try {
      setLoading(true)
      setError(null)
      const fileInfo = await apiService.getFileInfo(filePath)

      if (fileInfo) {
        // Load file info and close BIDS browser
        await loadFileInfo(fileInfo)
        setShowBidsBrowser(false)
        setBidsDatasetPath(null)
      }
    } catch (error) {
      console.error('[FILEMANAGER] Failed to load BIDS file:', error)
      setError(
        `Failed to load selected file. ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    } finally {
      setLoading(false)
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
      setLoading(true)
      setError(null)

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

      // The useEffect will reload automatically when dataDirectoryPath changes
    } catch (error) {
      console.error('Failed to select data directory:', error)
      if (error instanceof Error && !error.message.includes('cancelled') && !error.message.includes('No directory selected')) {
        setError('Failed to change directory: ' + error.message)
      }
      // User probably cancelled
    } finally {
      setLoading(false)
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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Folder className="h-5 w-5" />
              File Manager
            </CardTitle>
            <CardDescription>
              Browse and select EDF/ASCII files for analysis
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {TauriService.isTauri() && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleChangeDataDirectory}
                title="Change data directory (Note: Dialog may be slow when browsing directories with many files)"
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
              onClick={loadCurrentDirectory}
              disabled={loading}
              title="Refresh directory"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Navigation breadcrumbs */}
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
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="font-medium">Loading files...</p>
              <p className="text-sm text-muted-foreground">
                Scanning {fileManager.currentPath.length > 0 ? fileManager.currentPath.join('/') : 'root directory'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Directories */}
            {directories.map((dir) => (
              <div
                key={dir.path}
                onClick={() => handleDirectorySelect(dir)}
                className={`flex items-center gap-3 p-3 rounded-lg border hover:bg-accent cursor-pointer transition-colors ${
                  dir.isBIDS ? 'border-purple-300 bg-purple-50/50' : ''
                }`}
              >
                <Folder className={`h-5 w-5 ${dir.isBIDS ? 'text-purple-600' : 'text-blue-600'}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{dir.name}</span>
                    {dir.isBIDS && (
                      <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-xs">
                        BIDS Dataset
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {dir.isBIDS && dir.bidsInfo ? (
                      <div className="flex items-center gap-3 mt-1">
                        {dir.bidsInfo.datasetName && (
                          <span className="font-medium text-purple-700">{dir.bidsInfo.datasetName}</span>
                        )}
                        {dir.bidsInfo.subjectCount !== undefined && (
                          <span>{dir.bidsInfo.subjectCount} subject{dir.bidsInfo.subjectCount !== 1 ? 's' : ''}</span>
                        )}
                        {dir.bidsInfo.modalities && dir.bidsInfo.modalities.length > 0 && (
                          <span className="text-xs">{dir.bidsInfo.modalities.join(', ')}</span>
                        )}
                      </div>
                    ) : (
                      'Directory'
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}

            {/* Files */}
            {filteredAndSortedFiles.map((file, index) => (
              <div
                key={`${file.file_path}-${index}`}
                onClick={() => handleFileSelect(file)}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all
                  ${fileManager.pendingFileSelection
                    ? 'opacity-50 cursor-wait'
                    : 'cursor-pointer'
                  }
                  ${fileManager.selectedFile?.file_path === file.file_path
                    ? 'bg-primary/10 border-primary shadow-sm ring-2 ring-primary/20'
                    : fileManager.pendingFileSelection ? '' : 'hover:bg-accent hover:shadow-sm'
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

            {filteredAndSortedFiles.length === 0 && directories.length === 0 && (
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

    </Card>
  )
}
