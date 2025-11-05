"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { EDFFileInfo } from "@/types/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  useDirectoryListing,
  useLoadFileInfo,
} from "@/hooks/useFileManagement";
import { useBIDSMultipleDetections } from "@/hooks/useBIDSQuery";
import type { DirectoryEntry } from "@/types/bids";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Upload,
} from "lucide-react";
import { TauriService } from "@/services/tauriService";
import { formatBytes, formatDate } from "@/lib/utils";
import { useWorkflow } from "@/hooks/useWorkflow";
import { createLoadFileAction } from "@/types/workflow";
import { BIDSBrowser } from "@/components/BIDSBrowser";
import { BIDSUploadDialog } from "@/components/BIDSUploadDialog";
import { openNeuroService } from "@/services/openNeuroService";
import { FileContextMenu } from "@/components/FileContextMenu";
import {
  FileSegmentationDialog,
  type SegmentationParams,
} from "@/components/FileSegmentationDialog";
import {
  FileTreeInput,
  type FileTreeNode,
  type FileTreeSelection,
} from "@/components/ui/file-tree-input";

interface FileManagerProps {
  apiService: ApiService;
}

interface FileTreeRendererProps {
  directories: DirectoryEntry[];
  files: EDFFileInfo[];
  selectedFile: EDFFileInfo | null;
  isOpenNeuroAuthenticated: boolean;
  pendingFileSelection: EDFFileInfo | null;
  loadFileInfoMutationPending: boolean;
  onDirectorySelect: (dir: DirectoryEntry) => void;
  onFileSelect: (file: EDFFileInfo) => void;
  onContextMenu: (e: React.MouseEvent, file: EDFFileInfo) => void;
  onUploadClick: (dir: DirectoryEntry) => void;
  apiService: ApiService;
  searchQuery: string;
}

function FileTreeRenderer({
  directories,
  files,
  selectedFile,
  isOpenNeuroAuthenticated,
  pendingFileSelection,
  loadFileInfoMutationPending,
  onDirectorySelect,
  onFileSelect,
  onContextMenu,
  onUploadClick,
  apiService,
  searchQuery,
}: FileTreeRendererProps) {
  const [loadedDirs, setLoadedDirs] = useState<Map<string, { dirs: DirectoryEntry[], files: EDFFileInfo[] }>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [isLoadingForSearch, setIsLoadingForSearch] = useState(false);
  const loadingAbortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper function to load BIDS dataset contents
  const loadBIDSContents = async (bidsPath: string): Promise<{ dirs: DirectoryEntry[], files: EDFFileInfo[] } | null> => {
    if (loadedDirs.has(bidsPath)) {
      return loadedDirs.get(bidsPath) || null;
    }

    if (loadingDirs.has(bidsPath)) {
      return null;
    }

    setLoadingDirs(prev => new Set(prev).add(bidsPath));

    try {
      // Import BIDS reader functions dynamically
      const { discoverSubjects } = await import("@/services/bids/reader");
      const subjects = await discoverSubjects(bidsPath);

      // Convert BIDS subjects to virtual directories with metadata
      const subjectDirs: DirectoryEntry[] = subjects.map(subject => {
        // Count total runs across all sessions
        const totalRuns = subject.sessions.reduce((sum: number, session: any) => {
          return sum + (session.runs?.length || 0);
        }, 0);

        // Extract unique modalities
        const modalities = new Set<string>();
        subject.sessions.forEach((session: any) => {
          if (session.runs && Array.isArray(session.runs)) {
            session.runs.forEach((run: any) => {
              if (run.modality) {
                modalities.add(run.modality);
              }
            });
          }
        });

        return {
          name: subject.id,
          path: `${bidsPath}/${subject.id}`,
          isBIDS: false,
          bidsInfo: {
            subjectCount: subject.sessions.length, // Use session count for subjects
            datasetName: `${totalRuns} run${totalRuns !== 1 ? 's' : ''}`,
            modalities: Array.from(modalities),
          }
        };
      });

      // Don't flatten - let subjects be expandable directories
      // Store the full BIDS structure for later use
      (window as any).__bids_cache = (window as any).__bids_cache || {};
      (window as any).__bids_cache[bidsPath] = subjects;

      const contents = { dirs: subjectDirs, files: [] }; // No files at dataset level
      setLoadedDirs(prev => new Map(prev).set(bidsPath, contents));
      return contents;
    } catch (error) {
      console.error('[BIDS] Failed to load BIDS dataset:', bidsPath, error);
      return null;
    } finally {
      setLoadingDirs(prev => {
        const next = new Set(prev);
        next.delete(bidsPath);
        return next;
      });
    }
  };

  // Helper function to load directory contents
  const loadDirectoryContents = async (dirPath: string): Promise<{ dirs: DirectoryEntry[], files: EDFFileInfo[] } | null> => {
    if (loadedDirs.has(dirPath)) {
      return loadedDirs.get(dirPath) || null;
    }

    if (loadingDirs.has(dirPath)) {
      return null;
    }

    // Check if this is a BIDS subject/session directory
    const cache = (window as any).__bids_cache || {};
    for (const [bidsRoot, subjects] of Object.entries(cache)) {
      // Check if this is a subject directory
      const subjectId = dirPath.split('/').pop();
      const subject = (subjects as any[]).find((s: any) => s.id === subjectId && dirPath.startsWith(bidsRoot));

      if (subject && subject.sessions && Array.isArray(subject.sessions)) {
        setLoadingDirs(prev => new Set(prev).add(dirPath));
        try {
          // This is a BIDS subject - show sessions or runs
          if (subject.sessions.length === 1 && !subject.sessions[0].id) {
            // No explicit sessions - show runs as files
            const firstSession = subject.sessions[0];
            if (!firstSession.runs || !Array.isArray(firstSession.runs)) {
              // No runs found - return empty
              const contents = { dirs: [], files: [] };
              setLoadedDirs(prev => new Map(prev).set(dirPath, contents));
              return contents;
            }

            const files: EDFFileInfo[] = firstSession.runs.map((run: any) => ({
              file_path: run.dataFile,
              file_name: run.dataFile.split('/').pop() || `task-${run.task}_run-${run.run}`,
              file_size: 0,
              duration: 0,
              sample_rate: 256,
              channels: [],
              total_samples: 0,
              start_time: new Date().toISOString(),
              end_time: new Date().toISOString(),
              annotations_count: 0,
              bidsMetadata: {
                task: run.task,
                run: run.run,
                modality: run.modality,
              }
            }));

            const contents = { dirs: [], files };
            setLoadedDirs(prev => new Map(prev).set(dirPath, contents));
            return contents;
          } else {
            // Show sessions as directories
            const sessionDirs: DirectoryEntry[] = subject.sessions.map((session: any) => ({
              name: session.id || 'no-session',
              path: `${dirPath}/${session.id || 'no-session'}`,
              isBIDS: false,
            }));

            // Store sessions for later
            (window as any).__bids_cache[dirPath] = subject.sessions;

            const contents = { dirs: sessionDirs, files: [] };
            setLoadedDirs(prev => new Map(prev).set(dirPath, contents));
            return contents;
          }
        } finally {
          setLoadingDirs(prev => {
            const next = new Set(prev);
            next.delete(dirPath);
            return next;
          });
        }
      }

      // Check if this is a session directory
      const sessionId = dirPath.split('/').pop();
      const parentPath = dirPath.substring(0, dirPath.lastIndexOf('/'));
      const sessions = cache[parentPath];

      if (sessions && Array.isArray(sessions)) {
        const session = sessions.find((s: any) => (s.id || 'no-session') === sessionId);

        if (session && session.runs && Array.isArray(session.runs)) {
          setLoadingDirs(prev => new Set(prev).add(dirPath));
          try {
            // This is a BIDS session - show runs as files
            const files: EDFFileInfo[] = session.runs.map((run: any) => ({
              file_path: run.dataFile,
              file_name: run.dataFile.split('/').pop() || `task-${run.task}_run-${run.run}`,
              file_size: 0,
              duration: 0,
              sample_rate: 256,
              channels: [],
              total_samples: 0,
              start_time: new Date().toISOString(),
              end_time: new Date().toISOString(),
              annotations_count: 0,
              bidsMetadata: {
                task: run.task,
                run: run.run,
                modality: run.modality,
              }
            }));

            const contents = { dirs: [], files };
            setLoadedDirs(prev => new Map(prev).set(dirPath, contents));
            return contents;
          } finally {
            setLoadingDirs(prev => {
              const next = new Set(prev);
              next.delete(dirPath);
              return next;
            });
          }
        }
      }
    }

    // Regular directory - use API
    setLoadingDirs(prev => new Set(prev).add(dirPath));

    try {
      const response = await apiService.listDirectory(dirPath);

      const subdirs = response.files
        .filter((f: { is_directory: boolean }) => f.is_directory)
        .map((d: { name: string; path: string }) => ({ name: d.name, path: d.path, isBIDS: false }));

      const subfiles = response.files
        .filter((f: { is_directory: boolean }) => !f.is_directory)
        .filter((file: { name: string }) =>
          file.name.toLowerCase().endsWith(".edf") ||
          file.name.toLowerCase().endsWith(".csv") ||
          file.name.toLowerCase().endsWith(".ascii") ||
          file.name.toLowerCase().endsWith(".txt")
        )
        .map((file: { path: string; name: string; size?: number; last_modified?: string }) => ({
          file_path: file.path,
          file_name: file.name,
          file_size: file.size || 0,
          duration: 0,
          sample_rate: 256,
          channels: [],
          total_samples: 0,
          start_time: file.last_modified || new Date().toISOString(),
          end_time: file.last_modified || new Date().toISOString(),
          annotations_count: 0,
        }));

      const contents = { dirs: subdirs, files: subfiles };
      setLoadedDirs(prev => new Map(prev).set(dirPath, contents));
      return contents;
    } catch (error) {
      console.error('[SEARCH] Failed to load directory:', dirPath, error);
      return null;
    } finally {
      setLoadingDirs(prev => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  };

  // Helper function to get file format badge
  const getFileFormat = (fileName: string) => {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith(".edf")) return "EDF";
    if (lowerName.endsWith(".fif")) return "FIF";
    if (lowerName.endsWith(".csv")) return "CSV";
    if (lowerName.endsWith(".ascii")) return "ASCII";
    if (lowerName.endsWith(".set")) return "SET";
    if (lowerName.endsWith(".vhdr")) return "VHDR";
    if (lowerName.endsWith(".nii.gz")) return "NII.GZ";
    if (lowerName.endsWith(".nii")) return "NII";
    return "TXT";
  };

  // Helper function to get BIDS modality badge color
  const getModalityBadgeClass = (modality: string) => {
    const modalityLower = modality.toLowerCase();
    if (modalityLower === "eeg") {
      return "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700";
    } else if (modalityLower === "meg") {
      return "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700";
    } else if (modalityLower === "ieeg") {
      return "bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700";
    } else if (modalityLower === "mri" || modalityLower === "anat") {
      return "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700";
    } else if (modalityLower === "fmri" || modalityLower === "func") {
      return "bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700";
    } else if (modalityLower === "dwi") {
      return "bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700";
    } else if (modalityLower === "pet") {
      return "bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700";
    }
    return "bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700";
  };

  // Helper function to check if a string matches the search query - memoized to prevent infinite loops
  const matchesSearch = useCallback((text: string, query: string): boolean => {
    if (!query) return true;
    return text.toLowerCase().includes(query.toLowerCase());
  }, []);

  // Helper function to check if a node or any of its descendants match the search
  const nodeOrDescendantsMatch = useCallback((
    node: FileTreeNode,
    query: string
  ): boolean => {
    if (!query) return true;

    // Check if this node matches
    const nodeMatches = matchesSearch(node.label, query);
    if (nodeMatches) return true;

    // Check if any children match (recursively)
    if (node.children) {
      return node.children.some((child) => nodeOrDescendantsMatch(child, query));
    }

    return false;
  }, [matchesSearch]);

  // Recursive directory loading for search
  useEffect(() => {
    // Clear any pending timeout from previous search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    // Cancel any ongoing loading
    if (loadingAbortControllerRef.current) {
      loadingAbortControllerRef.current.abort();
      loadingAbortControllerRef.current = null;
    }

    // If no search query, clear state and return
    if (!searchQuery) {
      setIsLoadingForSearch(false);
      return;
    }

    // Capture current values for closure
    const currentQuery = searchQuery;
    const currentDirs = directories;

    // Create new abort controller for this search
    const abortController = new AbortController();
    loadingAbortControllerRef.current = abortController;

    const loadRecursively = async () => {
      setIsLoadingForSearch(true);

      try {
        // Breadth-first loading with max depth of 3
        const queue: Array<{path: string, depth: number}> = currentDirs.map(d => ({path: d.path, depth: 0}));
        const loaded = new Set<string>();
        const maxDepth = 3;

        while (queue.length > 0 && !abortController.signal.aborted) {
          const {path, depth} = queue.shift()!;

          // Skip if already loaded or max depth reached
          if (depth >= maxDepth || loaded.has(path)) {
            continue;
          }

          loaded.add(path);

          const contents = await loadDirectoryContents(path);

          if (contents && !abortController.signal.aborted) {
            // Add subdirectories to queue for next level
            for (const subdir of contents.dirs) {
              if (!loaded.has(subdir.path)) {
                queue.push({path: subdir.path, depth: depth + 1});
              }
            }
          }
        }

        if (!abortController.signal.aborted) {
          setIsLoadingForSearch(false);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error('[SEARCH] Error during recursive load:', error);
          setIsLoadingForSearch(false);
        }
      }
    };

    // Debounce the loading by 300ms
    searchTimeoutRef.current = setTimeout(() => {
      loadRecursively();
    }, 300);

    // Cleanup function
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      if (loadingAbortControllerRef.current) {
        loadingAbortControllerRef.current.abort();
        loadingAbortControllerRef.current = null;
      }
    };
  }, [searchQuery]); // Only depend on searchQuery to prevent re-triggering during directory loads

  // Transform directories and files to tree nodes
  const treeData: FileTreeNode[] = useMemo(() => {
    // Create file node
    const createFileNode = (file: EDFFileInfo): FileTreeNode => ({
      id: file.file_path,
      label: file.file_name,
      icon: (
        <div
          className={`flex items-center gap-3 w-full p-2 rounded-md transition-all ${
            pendingFileSelection || loadFileInfoMutationPending
              ? "opacity-50 cursor-wait"
              : "cursor-pointer hover:bg-accent/50"
          } ${
            selectedFile?.file_path === file.file_path
              ? "bg-primary/10 ring-1 ring-primary/30"
              : ""
          }`}
          onContextMenu={(e) => onContextMenu(e, file)}
        >
          <FileText className="h-5 w-5 text-green-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{file.file_name}</div>
            <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
              {(file as any).bidsMetadata ? (
                // BIDS file - show task, run, modality
                <>
                  <Badge variant="outline" className="text-xs bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800">
                    task-{(file as any).bidsMetadata.task}
                  </Badge>
                  <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800">
                    run-{(file as any).bidsMetadata.run}
                  </Badge>
                  <Badge variant="outline" className={`text-xs ${getModalityBadgeClass((file as any).bidsMetadata.modality)}`}>
                    {(file as any).bidsMetadata.modality.toUpperCase()}
                  </Badge>
                </>
              ) : (
                // Regular file - show size and date
                <>
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {formatBytes(file.file_size)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(file.start_time)}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {selectedFile?.file_path === file.file_path && (
              <div className="flex items-center gap-1 text-primary mb-1">
                <Check className="h-4 w-4" />
                <span className="text-xs font-medium">Selected</span>
              </div>
            )}
            <Badge variant="secondary" className="text-xs">
              {getFileFormat(file.file_name)}
            </Badge>
            {file.channels.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {file.channels.length} channels
              </Badge>
            )}
          </div>
        </div>
      ),
      metadata: { type: "file", data: file },
    });

    // Create directory node (with recursive support)
    const createDirectoryNode = (dir: DirectoryEntry): FileTreeNode => {
      // Check if this directory has been loaded
      const dirContents = loadedDirs.get(dir.path);
      const children: FileTreeNode[] = dirContents
        ? [
            ...dirContents.dirs.map(createDirectoryNode),
            ...dirContents.files.map(createFileNode)
          ]
        : [];

      return {
        id: dir.path,
        label: dir.name,
        // Always set children array for directories (even if empty) to show expand chevron
        children: children,
        icon: (
          <div
            className="flex items-center gap-2 w-full"
            onContextMenu={(e) => {
              if (dir.isBIDS) {
                e.preventDefault();
                e.stopPropagation();
                // TODO: Show BIDS context menu
                console.log('[BIDS] Right-click on BIDS dataset:', dir);
              }
            }}
          >
            <Folder
              className={`h-5 w-5 flex-shrink-0 ${
                dir.isBIDS ? "text-purple-600" : "text-blue-600"
              }`}
            />
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{dir.name}</span>
                {dir.isBIDS && (
                  <Badge
                    variant="secondary"
                    className="bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 text-xs flex-shrink-0"
                  >
                    BIDS
                  </Badge>
                )}
              </div>
              {dir.bidsInfo && (
                <div className="flex items-center gap-2 mt-1 flex-wrap text-sm text-muted-foreground">
                  {dir.bidsInfo.datasetName && (
                    <span className={`font-medium truncate text-xs ${
                      dir.isBIDS
                        ? "text-purple-700 dark:text-purple-400"
                        : "text-blue-700 dark:text-blue-400"
                    }`}>
                      {dir.bidsInfo.datasetName}
                    </span>
                  )}
                  {dir.bidsInfo.subjectCount !== undefined && (
                    <span className="flex-shrink-0 text-xs">
                      {dir.bidsInfo.subjectCount} {dir.isBIDS ? "subject" : "session"}
                      {dir.bidsInfo.subjectCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {dir.bidsInfo.modalities && dir.bidsInfo.modalities.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {dir.bidsInfo.modalities.map((modality) => (
                        <Badge
                          key={modality}
                          variant="outline"
                          className={`text-xs font-medium ${getModalityBadgeClass(
                            modality
                          )}`}
                        >
                          {modality.toUpperCase()}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {dir.isBIDS && isOpenNeuroAuthenticated && (
              <Button
                size="icon"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onUploadClick(dir);
                }}
                className="ml-2 flex-shrink-0"
                title="Upload to OpenNeuro"
              >
                <Upload className="h-4 w-4" />
              </Button>
            )}
          </div>
        ),
        metadata: { type: "directory", data: dir },
      };
    };

    // Create all nodes
    const allNodes = [
      ...directories.map(createDirectoryNode),
      ...files.map(createFileNode)
    ];

    // Filter nodes based on search query
    if (searchQuery) {
      const filterNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
        return nodes
          .map((node) => {
            // If node has children, filter them recursively
            if (node.children) {
              const filteredChildren = filterNodes(node.children);

              // Keep this node if it matches or has matching children
              const nodeMatches = matchesSearch(node.label, searchQuery);

              if (nodeMatches || filteredChildren.length > 0) {
                return {
                  ...node,
                  children: filteredChildren.length > 0 ? filteredChildren : node.children,
                };
              }
              return null;
            }

            // For leaf nodes, only keep if they match
            const matches = matchesSearch(node.label, searchQuery);
            return matches ? node : null;
          })
          .filter((node): node is FileTreeNode => node !== null);
      };

      return filterNodes(allNodes);
    }

    return allNodes;
  }, [directories, files, loadedDirs, selectedFile, isOpenNeuroAuthenticated, pendingFileSelection, loadFileInfoMutationPending, onContextMenu, onUploadClick, getFileFormat, getModalityBadgeClass, searchQuery, matchesSearch, isLoadingForSearch]);

  const handleSelection = async (selection: FileTreeSelection) => {
    if (!selection.node?.metadata) return;

    const { type, data } = selection.node.metadata;

    if (type === "directory") {
      const dir = data as DirectoryEntry;
      // For BIDS datasets, load BIDS structure
      if (dir.isBIDS) {
        // Load BIDS structure as children - defer to avoid setState during render
        setTimeout(async () => {
          await loadBIDSContents(dir.path);
        }, 0);
      } else {
        // Load directory contents when clicked - defer to avoid setState during render
        setTimeout(() => {
          loadDirectoryContents(dir.path);
        }, 0);
      }
    } else if (type === "file") {
      onFileSelect(data as EDFFileInfo);
    }
  };

  // Calculate which nodes should be initially expanded for search
  const initialExpandedNodes = useMemo(() => {
    if (!searchQuery) return [];

    const expandedIds: string[] = [];

    const collectExpandedNodes = (nodes: FileTreeNode[]) => {
      nodes.forEach((node) => {
        if (node.children && node.children.length > 0) {
          // Expand any directory that has children (which means it has matches)
          expandedIds.push(node.id);
          collectExpandedNodes(node.children);
        }
      });
    };

    collectExpandedNodes(treeData);
    return expandedIds;
  }, [searchQuery, treeData]);

  return (
    <>
      {isLoadingForSearch && searchQuery && (
        <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
          <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
          <span>Loading directories for search...</span>
        </div>
      )}
      <FileTreeInput
        data={treeData}
        onChange={handleSelection}
        size="md"
        className="border-0 bg-transparent p-0"
        initialExpandedNodes={initialExpandedNodes}
        key={searchQuery} // Re-mount when search changes to apply new expanded state
      />
    </>
  );
}

export function FileManager({ apiService }: FileManagerProps) {
  const dataDirectoryPath = useAppStore(
    (state) => state.fileManager.dataDirectoryPath
  );
  const currentPath = useAppStore((state) => state.fileManager.currentPath);
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const selectedChannels = useAppStore(
    (state) => state.fileManager.selectedChannels
  );
  const pendingFileSelectionPath = useAppStore(
    (state) => state.fileManager.pendingFileSelection
  );
  const searchQuery = useAppStore((state) => state.fileManager.searchQuery);
  const showHidden = useAppStore((state) => state.fileManager.showHidden);
  const sortBy = useAppStore((state) => state.fileManager.sortBy);
  const sortOrder = useAppStore((state) => state.fileManager.sortOrder);
  const isServerReady = useAppStore((state) => state.ui.isServerReady);
  const isRecording = useAppStore(
    (state) => state.workflowRecording.isRecording
  );
  const isPersistenceRestored = useAppStore(
    (state) => state.isPersistenceRestored
  );

  // Action functions
  const setSelectedFile = useAppStore((state) => state.setSelectedFile);
  const updateFileManagerState = useAppStore(
    (state) => state.updateFileManagerState
  );
  const setSelectedChannels = useAppStore((state) => state.setSelectedChannels);
  const setCurrentPath = useAppStore((state) => state.setCurrentPath);
  const setDataDirectoryPath = useAppStore(
    (state) => state.setDataDirectoryPath
  );
  const resetCurrentPathSync = useAppStore(
    (state) => state.resetCurrentPathSync
  );
  const clearPendingFileSelection = useAppStore(
    (state) => state.clearPendingFileSelection
  );
  const incrementActionCount = useAppStore(
    (state) => state.incrementActionCount
  );

  const { recordAction } = useWorkflow();

  // Build absolute path for directory listing
  const relativePath = currentPath.join("/");
  const absolutePath = relativePath
    ? `${dataDirectoryPath}/${relativePath}`
    : dataDirectoryPath;

  // Use TanStack Query for directory listing
  // Only wait for server to be ready - no need to block on persistence
  const {
    data: directoryData,
    isLoading: directoryLoading,
    error: directoryError,
    refetch: refetchDirectory,
  } = useDirectoryListing(
    apiService,
    absolutePath || "",
    !!absolutePath &&
      !!dataDirectoryPath &&
      isServerReady &&
      !!apiService.getSessionToken()
  );

  // Use mutation for loading file info
  const loadFileInfoMutation = useLoadFileInfo(apiService);

  const [pendingFileSelection, setPendingFileSelection] =
    useState<EDFFileInfo | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [bidsDatasetPath, setBidsDatasetPath] = useState<string | null>(null);
  const [showBidsBrowser, setShowBidsBrowser] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadDatasetPath, setUploadDatasetPath] = useState<string | null>(
    null
  );
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isOpenNeuroAuthenticated, setIsOpenNeuroAuthenticated] =
    useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    file: EDFFileInfo;
  } | null>(null);
  const [showSegmentationDialog, setShowSegmentationDialog] = useState(false);
  const [fileToSegment, setFileToSegment] = useState<EDFFileInfo | null>(null);

  // Extract directories and files from query data
  const directories = useMemo(() => {
    if (!directoryData?.files) return [];
    return directoryData.files
      .filter((f) => f.is_directory)
      .map((d) => ({ name: d.name, path: d.path }));
  }, [directoryData]);

  const files = useMemo(() => {
    if (!directoryData?.files) return [];
    return directoryData.files
      .filter((f) => !f.is_directory)
      .filter(
        (file) =>
          file.name.toLowerCase().endsWith(".edf") ||
          file.name.toLowerCase().endsWith(".csv") ||
          file.name.toLowerCase().endsWith(".ascii") ||
          file.name.toLowerCase().endsWith(".txt")
      )
      .map((file) => ({
        file_path: file.path,
        file_name: file.name,
        file_size: file.size || 0,
        duration: 0,
        sample_rate: 256,
        channels: [],
        total_samples: 0,
        start_time: file.last_modified || new Date().toISOString(),
        end_time: file.last_modified || new Date().toISOString(),
        annotations_count: 0,
      }));
  }, [directoryData]);

  // Use BIDS detection queries for all directories
  const bidsQueries = useBIDSMultipleDetections(directories);
  const directoriesWithBIDS = useMemo(() => {
    return bidsQueries.map((query, index) => {
      if (query.isSuccess && query.data) {
        return query.data;
      }
      return { ...directories[index], isBIDS: false };
    });
  }, [bidsQueries, directories]);

  const checkingBIDS = bidsQueries.some((q) => q.isLoading);

  // Load the data directory path on mount if not already set
  useEffect(() => {
    const loadDataDirectoryPath = async () => {
      if (TauriService.isTauri() && !dataDirectoryPath) {
        try {
          const path = await TauriService.getDataDirectory();
          console.log("[FILEMANAGER] Loaded data directory path:", path);
          setDataDirectoryPath(path);
        } catch (error) {
          console.error(
            "[FILEMANAGER] Failed to load data directory path:",
            error
          );
        }
      }
    };
    loadDataDirectoryPath();
  }, []);

  // Check OpenNeuro authentication status on mount and when auth changes
  // This ensures upload buttons appear after saving API key
  useEffect(() => {
    const checkAuth = async () => {
      const isAuth = await openNeuroService.isAuthenticated();
      console.log("[FILEMANAGER] OpenNeuro authentication status:", isAuth);
      setIsOpenNeuroAuthenticated(isAuth);
    };

    // Initial check
    checkAuth();

    // Listen for auth changes (fired when key is saved/deleted)
    const handleAuthChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ authenticated: boolean }>;
      console.log(
        "[FILEMANAGER] OpenNeuro auth changed:",
        customEvent.detail.authenticated
      );
      setIsOpenNeuroAuthenticated(customEvent.detail.authenticated);
    };

    // Re-check when window gains focus (user might have added key externally)
    const handleFocus = () => {
      console.log("[FILEMANAGER] Window focused, re-checking OpenNeuro auth");
      checkAuth();
    };

    window.addEventListener("openneuro-auth-changed", handleAuthChanged);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("openneuro-auth-changed", handleAuthChanged);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  // Handle initial load state
  useEffect(() => {
    if (isInitialLoad && isServerReady && isPersistenceRestored) {
      console.log("[FILEMANAGER] Server ready and persistence restored");
      setIsInitialLoad(false);
    }
  }, [isServerReady, isPersistenceRestored, isInitialLoad]);

  // Handle pending file selection restoration
  // Start immediately when server is ready - no need to wait for isInitialLoad flag
  useEffect(() => {
    console.log(
      "[FILEMANAGER] 🔍 Pending file status:",
      "Pending:",
      pendingFileSelectionPath || "NONE",
      "| Server ready:",
      isServerReady,
      "| Persistence restored:",
      isPersistenceRestored
    );

    if (pendingFileSelectionPath && isServerReady && isPersistenceRestored) {
      // Try to restore immediately without waiting for directory listing
      const filePath = pendingFileSelectionPath;
      console.log("[FILEMANAGER] ⚡ Fast-restoring file from path:", filePath);

      // Load file directly by path - don't wait for directory listing
      loadFileInfoMutation.mutate(filePath, {
        onSuccess: (fileInfo) => {
          console.log(
            "[FILEMANAGER] ✓ File restored successfully:",
            fileInfo.file_name
          );
          setSelectedFile(fileInfo);
          clearPendingFileSelection();

          // Record file load action if recording is active
          if (isRecording) {
            const action = createLoadFileAction(
              fileInfo.file_path,
              fileInfo.file_path.endsWith(".edf") ? "EDF" : "ASCII"
            );
            recordAction(action)
              .then(() => {
                console.log(
                  "[WORKFLOW] Recorded restored file load:",
                  fileInfo.file_path
                );
              })
              .catch((err) => {
                console.error("[WORKFLOW] Failed to record action:", err);
              });
          }
        },
        onError: (error) => {
          console.error("[FILEMANAGER] ✗ File restoration failed:", error);
          clearPendingFileSelection();
        },
      });
    }
  }, [pendingFileSelectionPath, isServerReady, isPersistenceRestored]);

  // Show loading if directory is loading OR if we're waiting for initial data
  const loading =
    directoryLoading ||
    (isInitialLoad && !directoryData) ||
    loadFileInfoMutation.isPending;
  const error = directoryError
    ? directoryError instanceof Error
      ? directoryError.message
      : "Failed to load directory"
    : null;

  // Filter directories based on search query
  const filteredDirectories = useMemo(() => {
    let filtered = directoriesWithBIDS;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (dir) =>
          dir.name.toLowerCase().includes(query) ||
          (dir.isBIDS &&
            dir.bidsInfo?.datasetName?.toLowerCase().includes(query))
      );
    }

    // Apply hidden files filter
    if (!showHidden) {
      filtered = filtered.filter((dir) => !dir.name.startsWith("."));
    }

    return filtered;
  }, [directoriesWithBIDS, searchQuery, showHidden]);

  // Filter and sort files
  const filteredAndSortedFiles = useMemo(() => {
    let filtered = files;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((file) =>
        file.file_name.toLowerCase().includes(query)
      );
    }

    // Apply hidden files filter
    if (!showHidden) {
      filtered = filtered.filter((file) => !file.file_name.startsWith("."));
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "name":
          comparison = a.file_name.localeCompare(b.file_name);
          break;
        case "size":
          comparison = a.file_size - b.file_size;
          break;
        case "date":
          comparison =
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
          break;
        default:
          comparison = a.file_name.localeCompare(b.file_name);
      }

      return sortOrder === "desc" ? -comparison : comparison;
    });

    return filtered;
  }, [files, searchQuery, showHidden, sortBy, sortOrder]);

  const handleFileSelect = (file: EDFFileInfo) => {
    // Prevent file selection while persisted file is being restored
    // This avoids race conditions and unintentional clicks during startup
    if (pendingFileSelection) {
      console.log(
        "[FILEMANAGER] Ignoring file click - pending restoration:",
        pendingFileSelection
      );
      return;
    }

    // If a file is already selected and it's different from the new selection
    if (selectedFile && selectedFile.file_path !== file.file_path) {
      setPendingFileSelection(file);
      setShowConfirmDialog(true);
    } else {
      // No file selected yet or clicking the same file
      loadFileInfo(file);
    }
  };

  const loadFileInfo = async (file: EDFFileInfo) => {
    // Set file as selected immediately for instant visual feedback
    setSelectedFile(file);

    // Use mutation to load file info
    loadFileInfoMutation.mutate(file.file_path, {
      onSuccess: (fileInfo) => {
        // Update with full details
        setSelectedFile(fileInfo);

        // Record file load action if recording is active
        if (isRecording) {
          try {
            const ext = file.file_path.split(".").pop()?.toLowerCase();
            let fileType: "EDF" | "ASCII" | "CSV" = "EDF";
            if (ext === "csv") fileType = "CSV";
            else if (ext === "ascii" || ext === "txt") fileType = "ASCII";

            const action = createLoadFileAction(file.file_path, fileType);
            recordAction(action)
              .then(() => {
                incrementActionCount();
                console.log("[WORKFLOW] Recorded file load:", file.file_path);
              })
              .catch((error) => {
                console.error("[WORKFLOW] Failed to record file load:", error);
              });
          } catch (error) {
            console.error("[WORKFLOW] Failed to record file load:", error);
          }
        }

        // Auto-select first few channels if none selected OR if selected channels don't exist in this file
        const validSelectedChannels = selectedChannels.filter((ch) =>
          fileInfo.channels.includes(ch)
        );

        if (
          fileInfo.channels.length > 0 &&
          validSelectedChannels.length === 0
        ) {
          const defaultChannels = fileInfo.channels.slice(
            0,
            Math.min(10, fileInfo.channels.length)
          );
          console.log(
            "[FILEMANAGER] Auto-selecting default channels:",
            defaultChannels
          );
          setSelectedChannels(defaultChannels);
        } else if (validSelectedChannels.length !== selectedChannels.length) {
          console.log(
            "[FILEMANAGER] Updating to valid channels only:",
            validSelectedChannels
          );
          setSelectedChannels(validSelectedChannels);
        }
      },
      onError: (error) => {
        console.error("Failed to load file info:", error);
      },
    });
  };

  const confirmFileSelection = () => {
    if (pendingFileSelection) {
      loadFileInfo(pendingFileSelection);
      setPendingFileSelection(null);
    }
    setShowConfirmDialog(false);
  };

  const cancelFileSelection = () => {
    setPendingFileSelection(null);
    setShowConfirmDialog(false);
  };

  const handleContextMenu = (e: React.MouseEvent, file: EDFFileInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  const handleSegmentFile = (file: EDFFileInfo) => {
    setFileToSegment(file);
    setShowSegmentationDialog(true);
  };

  const handleSegment = async (params: SegmentationParams) => {
    try {
      console.log("[FILEMANAGER] Cutting file with params:", params);
      const result = await TauriService.segmentFile(params);
      console.log("[FILEMANAGER] Cut result:", result);

      alert(`File cut successfully!\n\nCreated file:\n${result.outputPath}`);

      // Refresh directory listing if output directory is the current directory
      if (params.outputDirectory === absolutePath) {
        refetchDirectory();
      }
    } catch (error) {
      console.error("[FILEMANAGER] File cut failed:", error);
      throw error;
    }
  };

  const handleDirectorySelect = (dir: DirectoryEntry) => {
    // BIDS datasets now expand inline - no special handling needed
    // The FileTreeRenderer will load BIDS contents when expanded

    // dir.path is absolute - we need to make it relative to dataDirectoryPath
    const absolutePath = dir.path;

    // Remove the dataDirectoryPath prefix to get relative path
    let relativePath = absolutePath;
    if (absolutePath.startsWith(dataDirectoryPath)) {
      relativePath = absolutePath.slice(dataDirectoryPath.length);
    }

    // Split and filter empty segments
    const newPath = relativePath.split("/").filter((p) => p.length > 0);

    console.log("[FILEMANAGER] Directory selected:", {
      dirPath: dir.path,
      dataDirectoryPath: dataDirectoryPath,
      relativePath,
      newPath,
      isBIDS: dir.isBIDS,
      bidsInfo: dir.bidsInfo,
    });

    setCurrentPath(newPath);
  };

  const handleBidsFileSelect = async (filePath: string) => {
    console.log("[FILEMANAGER] BIDS file selected:", filePath);

    // Check if file format is supported
    const extension = filePath.split(".").pop()?.toLowerCase();
    const supportedFormats = [
      "edf",
      "fif",
      "csv",
      "txt",
      "ascii",
      "vhdr",
      "set",
    ];

    if (extension && !supportedFormats.includes(extension)) {
      console.error(
        `File format .${extension} is not yet supported. Currently supported formats: EDF, FIFF (.fif), CSV, ASCII/TXT, BrainVision (.vhdr), EEGLAB (.set).`
      );
      return;
    }

    // Load the selected file through the API using mutation
    try {
      loadFileInfoMutation.mutate(filePath, {
        onSuccess: (fileInfo) => {
          // Load file info and close BIDS browser
          loadFileInfo(fileInfo);
          setShowBidsBrowser(false);
          setBidsDatasetPath(null);
        },
        onError: (error) => {
          console.error("[FILEMANAGER] Failed to load BIDS file:", error);
        },
      });
    } catch (error) {
      console.error("[FILEMANAGER] Failed to load BIDS file:", error);
    }
  };

  const handleCloseBidsBrowser = () => {
    setShowBidsBrowser(false);
    setBidsDatasetPath(null);
  };

  const navigateUp = () => {
    if (currentPath.length > 0) {
      const newPath = currentPath.slice(0, -1);
      setCurrentPath(newPath);
    }
  };

  const navigateToRoot = () => {
    setCurrentPath([]);
  };

  const toggleSort = (newSortBy: typeof sortBy) => {
    if (sortBy === newSortBy) {
      updateFileManagerState({
        sortOrder: sortOrder === "asc" ? "desc" : "asc",
      });
    } else {
      updateFileManagerState({
        sortBy: newSortBy,
        sortOrder: "asc",
      });
    }
  };

  const handleChangeDataDirectory = async () => {
    if (!TauriService.isTauri()) return;

    try {
      // Open folder picker dialog (without saving to backend config)
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Data Directory",
      });

      if (!selected || typeof selected !== "string") {
        console.log("[FILEMANAGER] Directory selection cancelled");
        return;
      }

      console.log("[FILEMANAGER] ===== DIRECTORY CHANGE START =====");
      console.log("[FILEMANAGER] Selected directory:", selected);
      console.log("[FILEMANAGER] Type of selected:", typeof selected);
      console.log(
        "[FILEMANAGER] Current dataDirectoryPath:",
        dataDirectoryPath
      );
      console.log("[FILEMANAGER] Current path array:", currentPath);

      // Reset currentPath to [] and persist synchronously before changing directory
      console.log("[FILEMANAGER] Calling resetCurrentPathSync...");
      await resetCurrentPathSync();
      console.log("[FILEMANAGER] resetCurrentPathSync complete");

      // Save to backend (persists to OS config directory)
      console.log(
        "[FILEMANAGER] Saving to backend with TauriService.setDataDirectory..."
      );
      await TauriService.setDataDirectory(selected);
      console.log("[FILEMANAGER] Backend save complete");

      // Update the store (which also persists via state manager)
      console.log("[FILEMANAGER] Calling setDataDirectoryPath with:", selected);
      setDataDirectoryPath(selected);
      console.log("[FILEMANAGER] ===== DIRECTORY CHANGE END =====");

      // React Query will automatically refetch when path changes
    } catch (error) {
      console.error("Failed to select data directory:", error);
      // User probably cancelled - silently ignore
    }
  };

  // BIDS datasets now expand inline - no full-page view needed

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
              onClick={() =>
                updateFileManagerState({
                  showHidden: !showHidden,
                })
              }
              title={showHidden ? "Hide hidden files" : "Show hidden files"}
            >
              {showHidden ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetchDirectory()}
              disabled={loading}
              title="Refresh directory"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
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

            {currentPath.map((segment, index) => (
              <div key={index} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCurrentPath(currentPath.slice(0, index + 1))
                  }
                  className="h-6 px-2"
                >
                  {segment}
                </Button>
              </div>
            ))}

            {currentPath.length > 0 && (
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
              value={searchQuery}
              onChange={(e) => updateFileManagerState({ searchQuery: e.target.value })}
              className="pl-8"
            />
          </div>

          <Select
            value={sortBy}
            onValueChange={(value: typeof sortBy) => toggleSort(value)}
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
            onClick={() => toggleSort(sortBy)}
            title={`Sort ${sortOrder === "asc" ? "descending" : "ascending"}`}
          >
            {sortOrder === "asc" ? (
              <SortAsc className="h-4 w-4" />
            ) : (
              <SortDesc className="h-4 w-4" />
            )}
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
                  ? "Loading file metadata..."
                  : !isPersistenceRestored
                  ? "Restoring previous session..."
                  : "Loading directory..."}
              </p>
              <p className="text-sm text-muted-foreground">
                {loadFileInfoMutation.isPending
                  ? "Reading file information from backend"
                  : !isPersistenceRestored
                  ? "Loading saved state, plots, and analysis results"
                  : `Scanning ${
                      currentPath.length > 0
                        ? currentPath.join("/")
                        : "root directory"
                    }`}
              </p>
              {checkingBIDS && (
                <div className="flex items-center justify-center gap-2 mt-2 text-purple-600">
                  <div className="w-2 h-2 bg-purple-600 rounded-full animate-pulse" />
                  <span className="text-xs">Checking for BIDS datasets...</span>
                </div>
              )}
            </div>
          </div>
        ) : filteredAndSortedFiles.length === 0 &&
          filteredDirectories.length === 0 &&
          !searchQuery ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            {!dataDirectoryPath ? (
              <div className="space-y-3">
                <p className="font-medium text-foreground">
                  No Data Directory Selected
                </p>
                <p className="text-sm">
                  Choose a data directory using the "Change Directory" button
                  above to get started
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p>No files found</p>
                <p className="text-sm">
                  No EDF, CSV, or ASCII files in this directory
                </p>
              </div>
            )}
          </div>
        ) : (
          <FileTreeRenderer
            directories={searchQuery ? directoriesWithBIDS : filteredDirectories}
            files={searchQuery ? files : filteredAndSortedFiles}
            selectedFile={selectedFile}
            isOpenNeuroAuthenticated={isOpenNeuroAuthenticated}
            pendingFileSelection={pendingFileSelection}
            loadFileInfoMutationPending={loadFileInfoMutation.isPending}
            onDirectorySelect={handleDirectorySelect}
            onFileSelect={handleFileSelect}
            onContextMenu={handleContextMenu}
            onUploadClick={(dir) => {
              setUploadDatasetPath(dir.path);
              setShowUploadDialog(true);
            }}
            apiService={apiService}
            searchQuery={searchQuery}
          />
        )}
      </CardContent>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Selected File?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to change the selected file? This will reset
              your current analysis workspace.
              <div className="mt-4 space-y-2">
                <div className="p-2 bg-muted rounded">
                  <p className="text-sm font-medium">Current file:</p>
                  <p className="text-sm">{selectedFile?.file_name}</p>
                </div>
                <div className="p-2 bg-muted rounded">
                  <p className="text-sm font-medium">New file:</p>
                  <p className="text-sm">{pendingFileSelection?.file_name}</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelFileSelection}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmFileSelection}>
              Change File
            </AlertDialogAction>
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

      {/* File Context Menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          onClose={() => setContextMenu(null)}
          onSegmentFile={handleSegmentFile}
        />
      )}

      {/* File Segmentation Dialog */}
      <FileSegmentationDialog
        open={showSegmentationDialog}
        onClose={() => {
          setShowSegmentationDialog(false);
          setFileToSegment(null);
        }}
        file={fileToSegment}
        onSegment={handleSegment}
        apiService={apiService}
      />
    </Card>
  );
}
