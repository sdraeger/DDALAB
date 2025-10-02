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
    resetCurrentPathSync,
    clearPendingFileSelection,
    ui
  } = useAppStore()

  const [files, setFiles] = useState<EDFFileInfo[]>([])
  const [directories, setDirectories] = useState<Array<{name: string, path: string}>>([])
  const [loading, setLoading] = useState(true) // Start with loading true
  const [error, setError] = useState<string | null>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [pendingFileSelection, setPendingFileSelection] = useState<EDFFileInfo | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [showDirectoryChangeWarning, setShowDirectoryChangeWarning] = useState(false)
  const [dataDirectoryPath, setDataDirectoryPath] = useState<string>('')

  // Load the data directory path on mount
  useEffect(() => {
    const loadDataDirectoryPath = async () => {
      if (TauriService.isTauri()) {
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
    if (dataDirectoryPath && ui.isServerReady && !isInitialLoad) {
      loadCurrentDirectory()
    }
  }, [fileManager.currentPath, dataDirectoryPath, ui.isServerReady])

  // Ensure we load on mount even if currentPath hasn't changed
  // Wait for server to be ready before loading
  useEffect(() => {
    if (isInitialLoad && ui.isServerReady && dataDirectoryPath) {
      console.log('[FILEMANAGER] Server ready, loading initial directory')
      setIsInitialLoad(false)
      loadCurrentDirectory()
    }
  }, [ui.isServerReady, isInitialLoad, dataDirectoryPath])

  const loadCurrentDirectory = async () => {
    try {
      setLoading(true)
      setError(null)

      // Build absolute path: dataDirectoryPath + relative currentPath
      const relativePath = fileManager.currentPath.join('/')
      const absolutePath = relativePath ? `${dataDirectoryPath}/${relativePath}` : dataDirectoryPath

      console.log('[FILEMANAGER] Loading directory:', {
        dataDirectoryPath,
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

        setDirectories(dirs.map(d => ({
          name: d.name,
          path: d.path
        })))

        // Convert to EDFFileInfo format
        const edfFiles: EDFFileInfo[] = fileList
          .filter(file =>
            file.name.toLowerCase().endsWith('.edf') ||
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
      }
    } catch (err) {
      console.error('Failed to load directory:', err)
      setError(err instanceof Error ? err.message : 'Failed to load directory')
    } finally {
      setLoading(false)
    }
  }

  // Handle pending file selection after files are loaded
  // Only restore file selection when server is ready and not loading to avoid blocking UI
  useEffect(() => {
    if (fileManager.pendingFileSelection && files.length > 0 && ui.isServerReady && !loading) {
      const fileToSelect = files.find(f => f.file_path === fileManager.pendingFileSelection)
      if (fileToSelect) {
        console.log('Restoring selected file from persistence:', fileToSelect.file_name)
        handleFileSelect(fileToSelect)
        clearPendingFileSelection()
      }
    }
  }, [files, fileManager.pendingFileSelection, clearPendingFileSelection, ui.isServerReady, loading])

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
      setLoading(true)

      // Get detailed file information
      const fileInfo = await apiService.getFileInfo(file.file_path)
      setSelectedFile(fileInfo)

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

  const handleDirectorySelect = (dir: {name: string, path: string}) => {
    // dir.path is absolute - we need to make it relative to dataDirectoryPath
    const absolutePath = dir.path

    // Remove the dataDirectoryPath prefix to get relative path
    let relativePath = absolutePath
    if (absolutePath.startsWith(dataDirectoryPath)) {
      relativePath = absolutePath.slice(dataDirectoryPath.length)
    }

    // Split and filter empty segments
    const newPath = relativePath.split('/').filter(p => p.length > 0)

    console.log('[FILEMANAGER] Directory selected:', {
      dirPath: dir.path,
      dataDirectoryPath,
      relativePath,
      newPath
    })

    setCurrentPath(newPath)
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
    setShowDirectoryChangeWarning(true)
  }

  const confirmChangeDirectory = async () => {
    setShowDirectoryChangeWarning(false)

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
      console.log('[FILEMANAGER] Current dataDirectoryPath:', dataDirectoryPath)
      console.log('[FILEMANAGER] Current path array:', fileManager.currentPath)

      // Reset currentPath to [] and persist synchronously before changing directory
      console.log('[FILEMANAGER] Calling resetCurrentPathSync...')
      await resetCurrentPathSync()
      console.log('[FILEMANAGER] resetCurrentPathSync complete')

      // Update the local data directory path (client-side only - don't save to backend)
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
                className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent cursor-pointer transition-colors"
              >
                <Folder className="h-5 w-5 text-blue-600" />
                <div className="flex-1">
                  <div className="font-medium">{dir.name}</div>
                  <div className="text-sm text-muted-foreground">Directory</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}

            {/* Files */}
            {filteredAndSortedFiles.map((file, index) => (
              <div
                key={`${file.file_path}-${index}`}
                onClick={() => handleFileSelect(file)}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all
                  ${fileManager.selectedFile?.file_path === file.file_path
                    ? 'bg-primary/10 border-primary shadow-sm ring-2 ring-primary/20'
                    : 'hover:bg-accent hover:shadow-sm'
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
                <p>No files found</p>
                <p className="text-sm mt-2">
                  {fileManager.searchQuery
                    ? 'Try adjusting your search query'
                    : 'No EDF or ASCII files in this directory'
                  }
                </p>
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

      {/* Directory Change Warning Dialog */}
      <AlertDialog open={showDirectoryChangeWarning} onOpenChange={setShowDirectoryChangeWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Data Directory</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  You are about to open a folder selection dialog. Please note:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>The dialog may freeze temporarily when navigating folders with many files (thousands of items)</li>
                  <li>This is a limitation of the native OS file picker, not DDALAB</li>
                  <li>Avoid browsing into very large directories if possible</li>
                  <li>Select your target directory directly when you reach it</li>
                </ul>
                <p className="font-medium pt-2">
                  Tip: If the dialog freezes, wait a moment - it should recover after scanning completes.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmChangeDirectory}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
