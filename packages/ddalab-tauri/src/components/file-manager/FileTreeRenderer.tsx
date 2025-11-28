"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  memo,
} from "react";
import { EDFFileInfo } from "@/types/api";
import type { DirectoryEntry } from "@/types/bids";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Folder,
  FileText,
  Download,
  Calendar,
  HardDrive,
  Check,
  Upload,
  CloudOff,
  AlertTriangle,
} from "lucide-react";
import { TauriService } from "@/services/tauriService";
import { formatBytes, formatDate } from "@/lib/utils";
import {
  FileTreeInput,
  type FileTreeNode,
  type FileTreeSelection,
} from "@/components/ui/file-tree-input";
import { ApiService } from "@/services/apiService";
import { bidsCache } from "@/services/bidsCacheService";
import {
  getFileFormat,
  getModalityBadgeClass,
  matchesSearch,
  SUPPORTED_EXTENSIONS,
} from "./fileUtils";
import {
  VirtualizedFileList,
  VIRTUALIZATION_THRESHOLD,
} from "./VirtualizedFileList";

export interface FileTreeRendererProps {
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
  highlightedFilePath: string | null;
}

export const FileTreeRenderer = memo(function FileTreeRenderer({
  directories,
  files,
  selectedFile,
  isOpenNeuroAuthenticated,
  pendingFileSelection,
  loadFileInfoMutationPending,
  onFileSelect,
  onContextMenu,
  onUploadClick,
  apiService,
  searchQuery,
  highlightedFilePath,
}: FileTreeRendererProps) {
  const [loadedDirs, setLoadedDirs] = useState<
    Map<string, { dirs: DirectoryEntry[]; files: EDFFileInfo[] }>
  >(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [isLoadingForSearch, setIsLoadingForSearch] = useState(false);
  const loadingAbortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper function to load BIDS dataset contents
  const loadBIDSContents = useCallback(
    async (
      bidsPath: string,
    ): Promise<{ dirs: DirectoryEntry[]; files: EDFFileInfo[] } | null> => {
      if (loadedDirs.has(bidsPath)) {
        return loadedDirs.get(bidsPath) || null;
      }

      if (loadingDirs.has(bidsPath)) {
        return null;
      }

      setLoadingDirs((prev) => new Set(prev).add(bidsPath));

      try {
        // Import BIDS reader functions dynamically
        const { discoverSubjects } = await import("@/services/bids/reader");
        const subjects = await discoverSubjects(bidsPath);

        // Convert BIDS subjects to virtual directories with metadata
        const subjectDirs: DirectoryEntry[] = subjects.map((subject) => {
          // Count total runs across all sessions
          const totalRuns = subject.sessions.reduce((sum: number, session) => {
            return sum + (session.runs?.length || 0);
          }, 0);

          // Extract unique modalities
          const modalities = new Set<string>();
          subject.sessions.forEach((session) => {
            if (session.runs && Array.isArray(session.runs)) {
              session.runs.forEach((run) => {
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
              subjectCount: subject.sessions.length,
              datasetName: `${totalRuns} run${totalRuns !== 1 ? "s" : ""}`,
              modalities: Array.from(modalities),
            },
          };
        });

        // Store in BIDS cache service instead of window object
        bidsCache.setSubjects(bidsPath, subjects);

        const contents = { dirs: subjectDirs, files: [] };
        setLoadedDirs((prev) => new Map(prev).set(bidsPath, contents));
        return contents;
      } catch (error) {
        console.error("[BIDS] Failed to load BIDS dataset:", bidsPath, error);
        return null;
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(bidsPath);
          return next;
        });
      }
    },
    [loadedDirs, loadingDirs],
  );

  // Helper function to load directory contents
  const loadDirectoryContents = useCallback(
    async (
      dirPath: string,
    ): Promise<{ dirs: DirectoryEntry[]; files: EDFFileInfo[] } | null> => {
      if (loadedDirs.has(dirPath)) {
        return loadedDirs.get(dirPath) || null;
      }

      if (loadingDirs.has(dirPath)) {
        return null;
      }

      // Check if this is a BIDS subject/session directory using cache service
      const bidsContext = bidsCache.getBIDSContext(dirPath);

      if (bidsContext.isInsideBIDS && bidsContext.bidsRoot) {
        const subjectId = dirPath.split("/").pop();
        const subject = bidsCache.findSubject(
          bidsContext.bidsRoot,
          subjectId || "",
        );

        if (subject && subject.sessions && Array.isArray(subject.sessions)) {
          setLoadingDirs((prev) => new Set(prev).add(dirPath));
          try {
            // This is a BIDS subject - show sessions or runs
            if (subject.sessions.length === 1 && !subject.sessions[0].id) {
              // No explicit sessions - show runs as files
              const firstSession = subject.sessions[0];
              if (!firstSession.runs || !Array.isArray(firstSession.runs)) {
                const contents = { dirs: [], files: [] };
                setLoadedDirs((prev) => new Map(prev).set(dirPath, contents));
                return contents;
              }

              // Check annex status for each file in parallel
              const fileInfos: EDFFileInfo[] = await Promise.all(
                firstSession.runs.map(async (run) => {
                  const filePath = run.dataFile;
                  const isAnnexPlaceholder =
                    await TauriService.checkAnnexPlaceholder(filePath);
                  return {
                    file_path: filePath,
                    file_name:
                      filePath.split("/").pop() ||
                      `task-${run.task}_run-${run.run}`,
                    file_size: 0,
                    duration: 0,
                    sample_rate: 256,
                    channels: [],
                    total_samples: 0,
                    start_time: new Date().toISOString(),
                    end_time: new Date().toISOString(),
                    annotations_count: 0,
                    is_annex_placeholder: isAnnexPlaceholder,
                    bidsMetadata: {
                      task: run.task,
                      run: run.run,
                      modality: run.modality,
                    },
                  };
                }),
              );

              const contents = { dirs: [], files: fileInfos };
              setLoadedDirs((prev) => new Map(prev).set(dirPath, contents));
              return contents;
            } else {
              // Show sessions as directories
              const sessionDirs: DirectoryEntry[] = subject.sessions.map(
                (session) => ({
                  name: session.id || "no-session",
                  path: `${dirPath}/${session.id || "no-session"}`,
                  isBIDS: false,
                }),
              );

              // Store sessions in cache
              bidsCache.setSessions(dirPath, subject.sessions);

              const contents = { dirs: sessionDirs, files: [] };
              setLoadedDirs((prev) => new Map(prev).set(dirPath, contents));
              return contents;
            }
          } finally {
            setLoadingDirs((prev) => {
              const next = new Set(prev);
              next.delete(dirPath);
              return next;
            });
          }
        }

        // Check if this is a session directory
        const sessionId = dirPath.split("/").pop();
        const parentPath = dirPath.substring(0, dirPath.lastIndexOf("/"));
        const sessions = bidsCache.getSessions(parentPath);

        if (sessions && Array.isArray(sessions)) {
          const session = sessions.find(
            (s) => (s.id || "no-session") === sessionId,
          );

          if (session && session.runs && Array.isArray(session.runs)) {
            setLoadingDirs((prev) => new Set(prev).add(dirPath));
            try {
              // This is a BIDS session - show runs as files
              const fileInfos: EDFFileInfo[] = await Promise.all(
                session.runs.map(async (run) => {
                  const filePath = run.dataFile;
                  const isAnnexPlaceholder =
                    await TauriService.checkAnnexPlaceholder(filePath);
                  return {
                    file_path: filePath,
                    file_name:
                      filePath.split("/").pop() ||
                      `task-${run.task}_run-${run.run}`,
                    file_size: 0,
                    duration: 0,
                    sample_rate: 256,
                    channels: [],
                    total_samples: 0,
                    start_time: new Date().toISOString(),
                    end_time: new Date().toISOString(),
                    annotations_count: 0,
                    is_annex_placeholder: isAnnexPlaceholder,
                    bidsMetadata: {
                      task: run.task,
                      run: run.run,
                      modality: run.modality,
                    },
                  };
                }),
              );

              const contents = { dirs: [], files: fileInfos };
              setLoadedDirs((prev) => new Map(prev).set(dirPath, contents));
              return contents;
            } finally {
              setLoadingDirs((prev) => {
                const next = new Set(prev);
                next.delete(dirPath);
                return next;
              });
            }
          }
        }
      }

      // Regular directory - use API
      setLoadingDirs((prev) => new Set(prev).add(dirPath));

      try {
        const response = await apiService.listDirectory(dirPath);

        const subdirs = response.files
          .filter((f: { is_directory: boolean }) => f.is_directory)
          .map((d: { name: string; path: string }) => ({
            name: d.name,
            path: d.path,
            isBIDS: false,
          }));

        const subfiles = response.files
          .filter((f: { is_directory: boolean }) => !f.is_directory)
          .filter((file: { name: string }) => {
            const lowerName = file.name.toLowerCase();
            return SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
          })
          .map(
            (file: {
              path: string;
              name: string;
              size?: number;
              last_modified?: string;
            }) => ({
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
            }),
          );

        const contents = { dirs: subdirs, files: subfiles };
        setLoadedDirs((prev) => new Map(prev).set(dirPath, contents));
        return contents;
      } catch (error) {
        console.error("[SEARCH] Failed to load directory:", dirPath, error);
        return null;
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [loadedDirs, loadingDirs, apiService],
  );

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
    const currentDirs = directories;

    // Create new abort controller for this search
    const abortController = new AbortController();
    loadingAbortControllerRef.current = abortController;

    const loadRecursively = async () => {
      setIsLoadingForSearch(true);

      try {
        // Breadth-first loading with max depth of 3
        const queue: Array<{ path: string; depth: number }> = currentDirs.map(
          (d) => ({ path: d.path, depth: 0 }),
        );
        const loaded = new Set<string>();
        const maxDepth = 3;

        while (queue.length > 0 && !abortController.signal.aborted) {
          const { path, depth } = queue.shift()!;

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
                queue.push({ path: subdir.path, depth: depth + 1 });
              }
            }
          }
        }

        if (!abortController.signal.aborted) {
          setIsLoadingForSearch(false);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("[SEARCH] Error during recursive load:", error);
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
  }, [searchQuery, directories, loadDirectoryContents]);

  // Transform directories and files to tree nodes
  const treeData: FileTreeNode[] = useMemo(() => {
    // Create file node
    const createFileNode = (file: EDFFileInfo): FileTreeNode => ({
      id: file.file_path,
      label: file.file_name,
      icon: (
        <div
          className={`flex items-start gap-3 w-full p-2 rounded-md transition-all ${
            pendingFileSelection || loadFileInfoMutationPending
              ? "opacity-50 cursor-wait"
              : "cursor-pointer hover:bg-accent/50"
          } ${
            selectedFile?.file_path === file.file_path
              ? "bg-primary/10 ring-1 ring-primary/30"
              : ""
          } ${
            highlightedFilePath === file.file_path
              ? "ring-2 ring-yellow-500 bg-yellow-500/10 animate-pulse"
              : ""
          }`}
          onContextMenu={(e) => onContextMenu(e, file)}
        >
          {file.is_annex_placeholder ? (
            <div className="relative flex-shrink-0 mt-0.5">
              <CloudOff className="h-5 w-5 text-orange-500" />
              <AlertTriangle className="h-3 w-3 text-orange-600 absolute -bottom-1 -right-1" />
            </div>
          ) : (
            <FileText className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div
              className={`font-medium truncate ${file.is_annex_placeholder ? "text-orange-700 dark:text-orange-400" : ""}`}
            >
              {file.file_name}
            </div>
            <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
              {file.bidsMetadata ? (
                <>
                  <Badge
                    variant="outline"
                    className="text-xs bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800"
                  >
                    task-{file.bidsMetadata.task}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-xs bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800"
                  >
                    run-{file.bidsMetadata.run}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-xs ${getModalityBadgeClass(file.bidsMetadata.modality ?? "")}`}
                  >
                    {file.bidsMetadata.modality?.toUpperCase()}
                  </Badge>
                </>
              ) : (
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
            {file.is_annex_placeholder && (
              <Badge
                variant="outline"
                className="text-xs bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700"
              >
                <Download className="h-3 w-3 mr-1" />
                Not Downloaded
              </Badge>
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
      const dirContents = loadedDirs.get(dir.path);
      const children: FileTreeNode[] = dirContents
        ? [
            ...dirContents.dirs.map(createDirectoryNode),
            ...dirContents.files.map(createFileNode),
          ]
        : [];

      return {
        id: dir.path,
        label: dir.name,
        children: children,
        icon: (
          <div
            className="flex items-start gap-2 w-full"
            onContextMenu={(e) => {
              if (dir.isBIDS) {
                e.preventDefault();
                e.stopPropagation();
                console.log("[BIDS] Right-click on BIDS dataset:", dir);
              }
            }}
          >
            <Folder
              className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                dir.isBIDS || dir.isInsideBIDS
                  ? "text-purple-600"
                  : "text-blue-600"
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
                    <span
                      className={`font-medium truncate text-xs ${
                        dir.isBIDS || dir.isInsideBIDS
                          ? "text-purple-700 dark:text-purple-400"
                          : "text-blue-700 dark:text-blue-400"
                      }`}
                    >
                      {dir.bidsInfo.datasetName}
                    </span>
                  )}
                  {dir.bidsInfo.subjectCount !== undefined && (
                    <span className="flex-shrink-0 text-xs">
                      {dir.bidsInfo.subjectCount}{" "}
                      {dir.isBIDS ? "subject" : "session"}
                      {dir.bidsInfo.subjectCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {dir.bidsInfo.modalities &&
                    dir.bidsInfo.modalities.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {dir.bidsInfo.modalities.map((modality) => (
                          <Badge
                            key={modality}
                            variant="outline"
                            className={`text-xs font-medium ${getModalityBadgeClass(
                              modality,
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
      ...files.map(createFileNode),
    ];

    // Filter nodes based on search query
    if (searchQuery) {
      const filterNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
        return nodes
          .map((node) => {
            if (node.children) {
              const filteredChildren = filterNodes(node.children);
              const nodeMatches = matchesSearch(node.label, searchQuery);

              if (nodeMatches || filteredChildren.length > 0) {
                return {
                  ...node,
                  children:
                    filteredChildren.length > 0
                      ? filteredChildren
                      : node.children,
                };
              }
              return null;
            }

            const matches = matchesSearch(node.label, searchQuery);
            return matches ? node : null;
          })
          .filter((node): node is FileTreeNode => node !== null);
      };

      return filterNodes(allNodes);
    }

    return allNodes;
  }, [
    directories,
    files,
    loadedDirs,
    selectedFile,
    isOpenNeuroAuthenticated,
    pendingFileSelection,
    loadFileInfoMutationPending,
    highlightedFilePath,
    onContextMenu,
    onUploadClick,
    searchQuery,
  ]);

  const handleSelection = useCallback(
    async (selection: FileTreeSelection) => {
      if (!selection.node?.metadata) return;

      const { type, data } = selection.node.metadata;

      if (type === "directory") {
        const dir = data as DirectoryEntry;
        if (dir.isBIDS) {
          setTimeout(async () => {
            await loadBIDSContents(dir.path);
          }, 0);
        } else {
          setTimeout(() => {
            loadDirectoryContents(dir.path);
          }, 0);
        }
      } else if (type === "file") {
        onFileSelect(data as EDFFileInfo);
      }
    },
    [loadBIDSContents, loadDirectoryContents, onFileSelect],
  );

  // Calculate which nodes should be initially expanded for search
  const initialExpandedNodes = useMemo(() => {
    if (!searchQuery) return [];

    const expandedIds: string[] = [];

    const collectExpandedNodes = (nodes: FileTreeNode[]) => {
      nodes.forEach((node) => {
        if (node.children && node.children.length > 0) {
          expandedIds.push(node.id);
          collectExpandedNodes(node.children);
        }
      });
    };

    collectExpandedNodes(treeData);
    return expandedIds;
  }, [searchQuery, treeData]);

  // Check if we should use virtualized list (flat file list with many files)
  const shouldUseVirtualizedList = useMemo(() => {
    // Use virtualized list when:
    // 1. No directories to display
    // 2. Many files (above threshold)
    // 3. Search is active (flat results)
    return (
      directories.length === 0 &&
      files.length >= VIRTUALIZATION_THRESHOLD &&
      searchQuery
    );
  }, [directories.length, files.length, searchQuery]);

  // Filter files for virtualized list based on search
  const filteredFilesForVirtualList = useMemo(() => {
    if (!shouldUseVirtualizedList) return [];
    return files.filter((file) => matchesSearch(file.file_name, searchQuery));
  }, [files, searchQuery, shouldUseVirtualizedList]);

  return (
    <>
      {isLoadingForSearch && searchQuery && (
        <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
          <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
          <span>Loading directories for search...</span>
        </div>
      )}
      {shouldUseVirtualizedList ? (
        <VirtualizedFileList
          files={filteredFilesForVirtualList}
          selectedFile={selectedFile}
          height={500}
          onFileSelect={onFileSelect}
          onContextMenu={onContextMenu}
          highlightedFilePath={highlightedFilePath}
          isLoading={isLoadingForSearch}
        />
      ) : (
        <FileTreeInput
          data={treeData}
          onChange={handleSelection}
          size="md"
          className="border-0 bg-transparent p-0"
          initialExpandedNodes={initialExpandedNodes}
          key={searchQuery}
        />
      )}
    </>
  );
});
