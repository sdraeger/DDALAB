"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useAppStore } from "@/store/appStore";
import { useOpenFilesStore } from "@/store/openFilesStore";
import { tauriBackendService } from "@/services/tauriBackendService";
import { EDFFileInfo } from "@/types/api";
import { handleError, isGitAnnexError } from "@/utils/errorHandler";
import { createLogger } from "@/lib/logger";

const logger = createLogger("FileManager");
import { useScrollTrap } from "@/hooks/useScrollTrap";
import {
  useFileManagerSelectors,
  useUISelectors,
  useWorkflowSelectors,
  usePersistenceSelectors,
} from "@/hooks/useStoreSelectors";
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
import {
  useDirectoryListing,
  useLoadFileInfo,
} from "@/hooks/useFileManagement";
import {
  useBIDSMultipleDetections,
  useBIDSParentDetection,
} from "@/hooks/useBIDSQuery";
import type { DirectoryEntry } from "@/types/bids";
import {
  Search,
  Folder,
  SortAsc,
  SortDesc,
  RefreshCw,
  Eye,
  EyeOff,
  ChevronRight,
  Home,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";
import { TauriService } from "@/services/tauriService";
import { formatBytes } from "@/lib/utils";
import { useAutoRecordAction } from "@/hooks/useWorkflowQueries";
import { createLoadFileAction } from "@/types/workflow";
import { BIDSUploadDialog } from "@/components/BIDSUploadDialog";
import { openNeuroService } from "@/services/openNeuroService";
import { FileContextMenu } from "@/components/FileContextMenu";
import {
  FileSegmentationDialog,
  type SegmentationParams,
} from "@/components/FileSegmentationDialog";
import { GitAnnexDownloadDialog } from "@/components/GitAnnexDownloadDialog";
import { BIDSExportWizard } from "@/components/bids";
import { useSearchableItems, createActionItem } from "@/hooks/useSearchable";
import {
  FileTreeRenderer,
  SUPPORTED_EXTENSIONS,
  EmptyState,
} from "@/components/file-manager";
import { bidsCache } from "@/services/bidsCacheService";
import { toast } from "@/components/ui/toaster";

// FileTreeRenderer is now imported from @/components/file-manager

export const FileManager = React.memo(function FileManager() {
  // Use consolidated selector hooks instead of 20+ individual selectors
  const {
    dataDirectoryPath,
    currentPath,
    selectedFile,
    selectedChannels,
    pendingFileSelection: pendingFileSelectionPath,
    searchQuery,
    showHidden,
    sortBy,
    sortOrder,
    highlightedFilePath,
    setSelectedFile,
    updateFileManagerState,
    setSelectedChannels,
    setCurrentPath,
    setDataDirectoryPath,
    resetCurrentPathSync,
    clearPendingFileSelection,
  } = useFileManagerSelectors();

  const { isServerReady } = useUISelectors();
  const { isRecording, incrementActionCount } = useWorkflowSelectors();
  const { isPersistenceRestored } = usePersistenceSelectors();

  // Open files store for file tab management
  const openFileInTabs = useOpenFilesStore((state) => state.openFile);

  const autoRecordActionMutation = useAutoRecordAction();

  // Build absolute path for directory listing
  const relativePath = currentPath.join("/");
  const absolutePath = relativePath
    ? `${dataDirectoryPath}/${relativePath}`
    : dataDirectoryPath;

  // Compute query enabled condition
  const queryEnabled = !!absolutePath && !!dataDirectoryPath && isServerReady;

  // Log query conditions for debugging
  useEffect(() => {
    logger.debug("Directory query conditions", {
      absolutePath: absolutePath || "(empty)",
      dataDirectoryPath: dataDirectoryPath || "(empty)",
      isServerReady,
      queryEnabled,
    });
  }, [absolutePath, dataDirectoryPath, isServerReady, queryEnabled]);

  // Use TanStack Query for directory listing
  // Only wait for server to be ready - no need to block on persistence
  const {
    data: directoryData,
    isLoading: directoryLoading,
    error: directoryError,
    refetch: refetchDirectory,
  } = useDirectoryListing(absolutePath || "", queryEnabled);

  // Log query state changes for debugging
  useEffect(() => {
    logger.debug("Directory query state", {
      absolutePath,
      isLoading: directoryLoading,
      hasData: !!directoryData,
      hasError: !!directoryError,
      errorMessage: directoryError
        ? directoryError instanceof Error
          ? directoryError.message
          : String(directoryError)
        : null,
      fileCount: directoryData?.files?.length || 0,
    });
  }, [absolutePath, directoryLoading, directoryData, directoryError]);

  // Use mutation for loading file info
  const loadFileInfoMutation = useLoadFileInfo();

  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadDatasetPath, setUploadDatasetPath] = useState<string | null>(
    null,
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
  const [showAnnexDownloadDialog, setShowAnnexDownloadDialog] = useState(false);
  const [annexFileToDownload, setAnnexFileToDownload] =
    useState<EDFFileInfo | null>(null);
  const [showBIDSExportWizard, setShowBIDSExportWizard] = useState(false);
  const [bidsExportInitialFiles, setBidsExportInitialFiles] = useState<
    string[]
  >([]);

  // Scroll trap for file list to prevent accidental scroll capture
  const { containerProps: scrollTrapProps, isScrollEnabled } = useScrollTrap({
    activationDelay: 100,
  });

  // Debounced search - local state for immediate input, debounced update to store
  const [searchInput, setSearchInput] = useState(searchQuery);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync local search input with store when store changes externally (e.g., from clear)
  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  // Debounce search query updates to store (300ms delay)
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);

      // Clear existing timeout
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      // Set new debounced update
      searchTimeoutRef.current = setTimeout(() => {
        updateFileManagerState({ searchQuery: value });
      }, 300);
    },
    [updateFileManagerState],
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Cached Intl.Collator for efficient string sorting (avoids O(n²) localeCompare overhead)
  const collator = useMemo(
    () => new Intl.Collator(undefined, { sensitivity: "base" }),
    [],
  );

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
      .filter((file) => {
        const lowerName = file.name.toLowerCase();
        return SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
      })
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
        is_annex_placeholder: file.is_annex_placeholder || false,
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

  // Check parent directories for BIDS (handles reveal navigation into BIDS datasets)
  const bidsParentDetection = useBIDSParentDetection(
    currentPath,
    dataDirectoryPath,
  );

  // Check if we're inside a known BIDS dataset (for reveal navigation)
  const bidsContext = useMemo(() => {
    // Use the centralized BIDS cache service
    if (absolutePath) {
      return bidsCache.getBIDSContext(absolutePath);
    }

    // Fallback: use parent detection if cache doesn't have it yet
    if (bidsParentDetection.bidsRoot && absolutePath) {
      const relativeToBids = absolutePath.substring(
        bidsParentDetection.bidsRoot.length + 1,
      );
      const segments = relativeToBids.split("/").filter(Boolean);
      return {
        isInsideBIDS: true,
        bidsRoot: bidsParentDetection.bidsRoot,
        relativePath: relativeToBids,
        depth: bidsParentDetection.currentDepthInBids,
        currentSegment: segments[segments.length - 1] || null,
      };
    }

    return {
      isInsideBIDS: false,
      bidsRoot: null,
      relativePath: null,
      depth: 0,
      currentSegment: null,
    };
  }, [absolutePath, bidsParentDetection]);

  // When inside a BIDS dataset, enhance directories with BIDS info from cache
  const directoriesWithBIDSContext = useMemo(() => {
    if (!bidsContext.isInsideBIDS || !bidsContext.bidsRoot) {
      return directoriesWithBIDS;
    }

    // Use centralized BIDS cache service
    const subjects = bidsCache.getSubjects(bidsContext.bidsRoot);

    // Even without cache data, mark directories as inside BIDS for styling
    if (!subjects || !Array.isArray(subjects)) {
      return directoriesWithBIDS.map((dir) => ({
        ...dir,
        isInsideBIDS: true,
      }));
    }

    // Enhance directories based on depth with full BIDS info
    return directoriesWithBIDS.map((dir) => {
      const dirName = dir.name;

      if (bidsContext.depth === 0) {
        // At BIDS root - directories are subjects
        const subject = subjects.find((s) => s.id === dirName);
        if (subject) {
          const totalRuns =
            subject.sessions?.reduce(
              (sum: number, session) => sum + (session.runs?.length || 0),
              0,
            ) || 0;
          const modalities = new Set<string>();
          subject.sessions?.forEach((session) => {
            session.runs?.forEach((run) => {
              if (run.modality) modalities.add(run.modality);
            });
          });

          return {
            ...dir,
            isInsideBIDS: true,
            bidsInfo: {
              subjectCount: subject.sessions?.length || 0,
              datasetName: `${totalRuns} run${totalRuns !== 1 ? "s" : ""}`,
              modalities: Array.from(modalities),
            },
          };
        }
      } else if (bidsContext.depth === 1) {
        // Inside a subject - directories are sessions
        const parentSegment = bidsContext.relativePath?.split("/")[0];
        const subject = subjects.find((s) => s.id === parentSegment);
        if (subject && subject.sessions) {
          const session = subject.sessions.find(
            (s) => (s.id || "no-session") === dirName,
          );
          if (session) {
            const runCount = session.runs?.length || 0;
            const modalities = new Set<string>();
            session.runs?.forEach((run) => {
              if (run.modality) modalities.add(run.modality);
            });

            return {
              ...dir,
              isInsideBIDS: true,
              bidsInfo: {
                subjectCount: runCount,
                datasetName: `${runCount} run${runCount !== 1 ? "s" : ""}`,
                modalities: Array.from(modalities),
              },
            };
          }
        }
      }

      return { ...dir, isInsideBIDS: true };
    });
  }, [directoriesWithBIDS, bidsContext]);

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
            error,
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
        customEvent.detail.authenticated,
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
      isPersistenceRestored,
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
            fileInfo.file_name,
          );
          setSelectedFile(fileInfo);
          clearPendingFileSelection();

          // Record file load action if recording is active
          if (isRecording) {
            const action = createLoadFileAction(
              fileInfo.file_path,
              fileInfo.file_path.endsWith(".edf") ? "EDF" : "ASCII",
            );
            autoRecordActionMutation.mutate(
              { action, activeFileId: fileInfo.file_path },
              {
                onSuccess: () => {
                  console.log(
                    "[WORKFLOW] Recorded restored file load:",
                    fileInfo.file_path,
                  );
                },
                onError: (err) => {
                  console.error("[WORKFLOW] Failed to record action:", err);
                },
              },
            );
          }
        },
        onError: (error) => {
          handleError(error, {
            source: "FileManager",
            severity: "warning",
          });
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
    let filtered = directoriesWithBIDSContext;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (dir) =>
          dir.name.toLowerCase().includes(query) ||
          ((dir.isBIDS || dir.isInsideBIDS) &&
            dir.bidsInfo?.datasetName?.toLowerCase().includes(query)),
      );
    }

    // Apply hidden files filter
    if (!showHidden) {
      filtered = filtered.filter((dir) => !dir.name.startsWith("."));
    }

    return filtered;
  }, [directoriesWithBIDSContext, searchQuery, showHidden]);

  // Filter and sort files
  const filteredAndSortedFiles = useMemo(() => {
    let filtered = files;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((file) =>
        file.file_name.toLowerCase().includes(query),
      );
    }

    // Apply hidden files filter
    if (!showHidden) {
      filtered = filtered.filter((file) => !file.file_name.startsWith("."));
    }

    // Apply sorting using cached Intl.Collator for performance
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "name":
          comparison = collator.compare(a.file_name, b.file_name);
          break;
        case "size":
          comparison = a.file_size - b.file_size;
          break;
        case "date":
          comparison =
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
          break;
        default:
          comparison = collator.compare(a.file_name, b.file_name);
      }

      return sortOrder === "desc" ? -comparison : comparison;
    });

    return filtered;
  }, [files, searchQuery, showHidden, sortBy, sortOrder, collator]);

  const loadFileInfo = useCallback(
    (file: EDFFileInfo) => {
      // Set file as selected immediately for instant visual feedback
      setSelectedFile(file);

      // Use mutation to load file info
      loadFileInfoMutation.mutate(file.file_path, {
        onSuccess: (fileInfo) => {
          // Update with full details
          setSelectedFile(fileInfo);

          // Open file in tabs
          openFileInTabs(file.file_path);

          // Record file load action if recording is active
          if (isRecording) {
            try {
              const ext = file.file_path.split(".").pop()?.toLowerCase();
              let fileType: "EDF" | "ASCII" | "CSV" = "EDF";
              if (ext === "csv") fileType = "CSV";
              else if (ext === "ascii" || ext === "txt") fileType = "ASCII";

              const action = createLoadFileAction(file.file_path, fileType);
              autoRecordActionMutation.mutate(
                { action, activeFileId: file.file_path },
                {
                  onSuccess: () => {
                    incrementActionCount();
                    console.log(
                      "[WORKFLOW] Recorded file load:",
                      file.file_path,
                    );
                  },
                  onError: (error) => {
                    console.error(
                      "[WORKFLOW] Failed to record file load:",
                      error,
                    );
                  },
                },
              );
            } catch (error) {
              console.error("[WORKFLOW] Failed to record file load:", error);
            }
          }

          // Auto-select first few channels if none selected OR if selected channels don't exist in this file
          const validSelectedChannels = selectedChannels.filter((ch) =>
            fileInfo.channels.includes(ch),
          );

          if (
            fileInfo.channels.length > 0 &&
            validSelectedChannels.length === 0
          ) {
            const defaultChannels = fileInfo.channels.slice(
              0,
              Math.min(10, fileInfo.channels.length),
            );
            console.log(
              "[FILEMANAGER] Auto-selecting default channels:",
              defaultChannels,
            );
            setSelectedChannels(defaultChannels);
          } else if (validSelectedChannels.length !== selectedChannels.length) {
            console.log(
              "[FILEMANAGER] Updating to valid channels only:",
              validSelectedChannels,
            );
            setSelectedChannels(validSelectedChannels);
          }
        },
        onError: (error) => {
          // Check if this is a git-annex error (file not downloaded)
          if (isGitAnnexError(error)) {
            // Show the download dialog instead of just an error
            setAnnexFileToDownload(file);
            setShowAnnexDownloadDialog(true);
            // Clear the selected file since it can't be loaded
            setSelectedFile(null);
            return;
          }

          handleError(error, {
            source: "FileManager",
            severity: "warning",
          });
        },
      });
    },
    [
      setSelectedFile,
      loadFileInfoMutation,
      openFileInTabs,
      isRecording,
      autoRecordActionMutation,
      incrementActionCount,
      selectedChannels,
      setSelectedChannels,
    ],
  );

  const handleFileSelect = useCallback(
    (file: EDFFileInfo) => {
      // Prevent file selection while persisted file is being restored
      // This avoids race conditions and unintentional clicks during startup
      if (pendingFileSelectionPath) {
        console.log(
          "[FILEMANAGER] Ignoring file click - pending restoration:",
          pendingFileSelectionPath,
        );
        return;
      }

      // Check if this is a git-annex placeholder file
      if (file.is_annex_placeholder) {
        console.log(
          "[FILEMANAGER] Git-annex placeholder file clicked:",
          file.file_path,
        );
        setAnnexFileToDownload(file);
        setShowAnnexDownloadDialog(true);
        return;
      }

      // Load the file directly - file tabs handle multiple open files
      loadFileInfo(file);
    },
    [loadFileInfo, pendingFileSelectionPath],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: EDFFileInfo) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, file });
    },
    [],
  );

  const handleSegmentFile = (file: EDFFileInfo) => {
    setFileToSegment(file);
    setShowSegmentationDialog(true);
  };

  const handleSegment = async (params: SegmentationParams) => {
    try {
      console.log("[FILEMANAGER] Cutting file with params:", params);
      const result = await TauriService.segmentFile(params);
      console.log("[FILEMANAGER] Cut result:", result);

      toast.success(
        "File Cut Successfully",
        `Created file: ${result.outputPath.split("/").pop()}`,
      );

      // Refresh directory listing if output directory is the current directory
      if (params.outputDirectory === absolutePath) {
        refetchDirectory();
      }
    } catch (error) {
      console.error("[FILEMANAGER] File cut failed:", error);
      throw error;
    }
  };

  const handleExportToBIDS = (file: EDFFileInfo) => {
    setBidsExportInitialFiles([file.file_path]);
    setShowBIDSExportWizard(true);
  };

  const handleDirectorySelect = useCallback(
    (dir: DirectoryEntry) => {
      // BIDS datasets now expand inline - no special handling needed
      // The FileTreeRenderer will load BIDS contents when expanded

      // dir.path is absolute - we need to make it relative to dataDirectoryPath
      const absoluteDirPath = dir.path;

      // Remove the dataDirectoryPath prefix to get relative path
      let relativePath = absoluteDirPath;
      if (absoluteDirPath.startsWith(dataDirectoryPath)) {
        relativePath = absoluteDirPath.slice(dataDirectoryPath.length);
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
    },
    [dataDirectoryPath, setCurrentPath],
  );

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

  const handleUploadClick = useCallback((dir: DirectoryEntry) => {
    setUploadDatasetPath(dir.path);
    setShowUploadDialog(true);
  }, []);

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
        dataDirectoryPath,
      );
      console.log("[FILEMANAGER] Current path array:", currentPath);

      // Reset currentPath to [] and persist synchronously before changing directory
      console.log("[FILEMANAGER] Calling resetCurrentPathSync...");
      await resetCurrentPathSync();
      console.log("[FILEMANAGER] resetCurrentPathSync complete");

      // Save to backend (persists to OS config directory)
      console.log(
        "[FILEMANAGER] Saving to backend with TauriService.setDataDirectory...",
      );
      await TauriService.setDataDirectory(selected);
      console.log("[FILEMANAGER] Backend save complete");

      // Update the backend data directory via Tauri IPC
      console.log("[FILEMANAGER] Updating backend data directory...");
      try {
        await tauriBackendService.updateDataDirectory(selected);
        console.log("[FILEMANAGER] Backend data directory updated");
      } catch (backendError) {
        console.warn(
          "[FILEMANAGER] Failed to update backend data directory:",
          backendError,
        );
        // Continue anyway - this is not critical for the UI to function
      }

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

  // Register files as searchable items
  useSearchableItems(
    [
      // Current selected file
      ...(selectedFile
        ? [
            createActionItem(
              `file-current-${selectedFile.file_path}`,
              `Current: ${selectedFile.file_name}`,
              () => {
                // Already selected
              },
              {
                description: `Currently selected file - ${selectedFile.channels.length} channels`,
                keywords: [
                  "file",
                  "current",
                  "selected",
                  selectedFile.file_name,
                ],
                category: "Files",
                priority: 10,
              },
            ),
          ]
        : []),
      // Files in current directory (limit to avoid too many items)
      ...files.slice(0, 20).map((file) =>
        createActionItem(
          `file-${file.file_path}`,
          file.file_name,
          () => handleFileSelect(file),
          {
            description: `${formatBytes(file.file_size)} - ${currentPath.join("/")}`,
            keywords: ["file", "edf", file.file_name.toLowerCase()],
            category: "Files",
          },
        ),
      ),
      // Refresh directory action
      createActionItem(
        "file-refresh-directory",
        "Refresh Files",
        () => refetchDirectory(),
        {
          description: "Refresh the current directory listing",
          keywords: ["refresh", "reload", "files", "directory"],
          category: "File Actions",
        },
      ),
      // Change data directory action
      createActionItem(
        "file-change-directory",
        "Change Data Directory",
        () => handleChangeDataDirectory(),
        {
          description: "Select a different data directory",
          keywords: ["change", "directory", "folder", "browse", "select"],
          category: "File Actions",
        },
      ),
    ],
    [selectedFile?.file_path, files.length, currentPath.join("/")],
  );

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

        {/* Current directory indicator - prominent display */}
        <div className="bg-muted/50 rounded-lg p-3 border">
          <div className="flex items-start gap-2">
            <FolderOpen className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Current Directory
              </div>
              <div className="font-mono text-sm truncate" title={absolutePath}>
                {currentPath.length > 0 ? (
                  <span className="text-foreground">
                    <span className="text-muted-foreground">
                      {dataDirectoryPath}/
                    </span>
                    <span className="font-semibold">
                      {currentPath.join("/")}
                    </span>
                  </span>
                ) : (
                  <span className="text-foreground font-semibold">
                    {dataDirectoryPath || "No directory selected"}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {TauriService.isTauri() && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleChangeDataDirectory}
                  title="Change data directory"
                  className="h-8 px-2"
                >
                  <FolderOpen className="h-4 w-4" />
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
                aria-label={
                  showHidden ? "Hide hidden files" : "Show hidden files"
                }
                aria-pressed={showHidden}
                className="h-8 w-8"
              >
                {showHidden ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetchDirectory()}
                disabled={loading}
                title="Refresh directory"
                aria-label="Refresh directory"
                className="h-8 w-8"
              >
                <RefreshCw
                  className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>
        </div>

        {/* Breadcrumb navigation */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground overflow-x-auto py-1 scrollbar-thin">
          <Button
            variant={currentPath.length === 0 ? "secondary" : "ghost"}
            size="sm"
            onClick={navigateToRoot}
            className="h-7 px-2 flex-shrink-0"
          >
            <Home className="h-3.5 w-3.5" />
          </Button>

          {currentPath.map((segment, index) => (
            <div key={index} className="flex items-center gap-1 flex-shrink-0">
              <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
              <Button
                variant={
                  index === currentPath.length - 1 ? "secondary" : "ghost"
                }
                size="sm"
                onClick={() => setCurrentPath(currentPath.slice(0, index + 1))}
                className={`h-7 px-2 ${index === currentPath.length - 1 ? "font-semibold" : ""}`}
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
              className="h-7 px-2 ml-2 flex-shrink-0"
              title="Go up one level"
            >
              ↑ Up
            </Button>
          )}
        </div>

        {/* Search and filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-8 w-full"
            />
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <Select
              value={sortBy}
              onValueChange={(value: typeof sortBy) => toggleSort(value)}
            >
              <SelectTrigger className="w-24 sm:w-28">
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
              aria-label={`Sort ${sortOrder === "asc" ? "descending" : "ascending"}`}
              className="flex-shrink-0"
            >
              {sortOrder === "asc" ? (
                <SortAsc className="h-4 w-4" aria-hidden="true" />
              ) : (
                <SortDesc className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent
        ref={scrollTrapProps.ref}
        onMouseEnter={scrollTrapProps.onMouseEnter}
        onMouseLeave={scrollTrapProps.onMouseLeave}
        className={`flex-1 p-4 ${isScrollEnabled ? "overflow-auto" : "overflow-hidden"}`}
        style={scrollTrapProps.style}
      >
        {error && (
          <div
            className="p-4 mb-4 text-sm bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="space-y-2">
                <p className="font-medium text-red-800 dark:text-red-200">
                  Could not load directory
                </p>
                <p className="text-red-700 dark:text-red-300">{error}</p>
                <div className="text-red-600 dark:text-red-400 text-xs space-y-1">
                  <p className="font-medium">Try the following:</p>
                  <ul className="list-disc list-inside space-y-0.5 ml-1">
                    <li>
                      Check that the directory path exists and is accessible
                    </li>
                    <li>Verify you have read permissions for this location</li>
                    <li>If using a network drive, check your connection</li>
                    <li>
                      Try selecting a different data directory in Settings
                    </li>
                  </ul>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchDirectory()}
                  className="mt-2 h-7 text-xs border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Retry
                </Button>
              </div>
            </div>
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
          filteredDirectories.length === 0 ? (
          <EmptyState
            context={{
              hasDataDirectory: !!dataDirectoryPath,
              searchQuery: searchQuery,
              hasFilters: false,
              currentPath: currentPath,
              totalFilesInDirectory: files.length,
            }}
            onClearSearch={() => updateFileManagerState({ searchQuery: "" })}
            onSelectDirectory={handleChangeDataDirectory}
          />
        ) : (
          <FileTreeRenderer
            directories={
              searchQuery ? directoriesWithBIDSContext : filteredDirectories
            }
            files={searchQuery ? files : filteredAndSortedFiles}
            selectedFile={selectedFile}
            isOpenNeuroAuthenticated={isOpenNeuroAuthenticated}
            pendingFileSelection={null}
            loadFileInfoMutationPending={loadFileInfoMutation.isPending}
            onDirectorySelect={handleDirectorySelect}
            onFileSelect={handleFileSelect}
            onContextMenu={handleContextMenu}
            onUploadClick={handleUploadClick}
            searchQuery={searchQuery}
            highlightedFilePath={highlightedFilePath}
          />
        )}
      </CardContent>

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
          onExportToBIDS={handleExportToBIDS}
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
      />

      {/* Git Annex Download Dialog */}
      <GitAnnexDownloadDialog
        open={showAnnexDownloadDialog}
        onOpenChange={(open) => {
          setShowAnnexDownloadDialog(open);
          if (!open) setAnnexFileToDownload(null);
        }}
        filePath={annexFileToDownload?.file_path || ""}
        fileName={annexFileToDownload?.file_name || ""}
        onDownloadComplete={() => {
          // Refresh directory listing after download
          refetchDirectory();
        }}
      />

      {/* BIDS Export Wizard */}
      <BIDSExportWizard
        open={showBIDSExportWizard}
        onOpenChange={setShowBIDSExportWizard}
        initialFiles={bidsExportInitialFiles}
      />
    </Card>
  );
});
