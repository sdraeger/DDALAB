import React, { useState, useEffect, memo } from "react";
import {
  Download,
  Folder,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader,
  Info,
  ChevronRight,
  ChevronDown,
  File,
  FolderOpen,
  Activity,
} from "lucide-react";
import {
  openNeuroService,
  type DownloadOptions,
  type DownloadProgress,
  type OpenNeuroDataset,
  type OpenNeuroFile,
  isDDACompatibleFile,
} from "../services/openNeuroService";
import { useDownloadedDatasetsStore } from "../store/downloadedDatasetsStore";
import { useAppStore } from "../store/appStore";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  useDownloadDataset,
  useCancelDownload,
  useGitAvailable,
  useGitAnnexAvailable,
  useOpenNeuroDatasetSize,
  useOpenNeuroDatasetFiles,
} from "../hooks/useOpenNeuro";

interface OpenNeuroDownloadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  dataset: OpenNeuroDataset | null;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  annexed: boolean;
  children?: FileTreeNode[];
  expanded?: boolean;
  selected?: boolean;
}

export const OpenNeuroDownloadDialog = memo(function OpenNeuroDownloadDialog({
  isOpen,
  onClose,
  dataset,
}: OpenNeuroDownloadDialogProps) {
  const [destinationPath, setDestinationPath] = useState("");
  const [useGitHub, setUseGitHub] = useState(true);
  const [downloadAnnexed, setDownloadAnnexed] = useState(true);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeNode | null>(null);
  const [showFileTree, setShowFileTree] = useState(false);
  const [enableSizeQuery, setEnableSizeQuery] = useState(false);
  const [enableFilesQuery, setEnableFilesQuery] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;

  // TanStack Query hooks
  const { data: gitAvailable = false } = useGitAvailable();
  const { data: gitAnnexAvailable = false } = useGitAnnexAvailable();

  const { data: sizeInfo, isLoading: loadingSize } = useOpenNeuroDatasetSize(
    dataset?.id || "",
    selectedSnapshot || undefined,
    enableSizeQuery && !!dataset,
  );

  // Use summary data if available (much faster than calculating from files)
  const summarySize = dataset?.summary?.size || 0;
  const summaryFileCount = dataset?.summary?.totalFiles || 0;
  const hasSummaryData = summarySize > 0 || summaryFileCount > 0;

  const { data: files, isLoading: loadingFiles } = useOpenNeuroDatasetFiles(
    dataset?.id || "",
    selectedSnapshot || undefined,
    enableFilesQuery && !!dataset,
  );

  const downloadMutation = useDownloadDataset();
  const cancelMutation = useCancelDownload();

  const isDownloading = downloadMutation.isPending;
  const error =
    localError ||
    (downloadMutation.error
      ? downloadMutation.error instanceof Error
        ? downloadMutation.error.message
        : "Download failed"
      : null);

  useEffect(() => {
    if (isOpen) {
      setProgress(null);
      setLocalError(null);
      setEnableSizeQuery(false);
      setEnableFilesQuery(false);
      setShowFileTree(false);
      setRetryCount(0);

      // Set default snapshot to latest
      if (dataset?.snapshots && dataset.snapshots.length > 0) {
        setSelectedSnapshot(dataset.snapshots[0].tag);
      }
    }
  }, [isOpen, dataset]);

  const fetchDatasetSize = () => {
    setEnableSizeQuery(true);
  };

  const fetchFileTree = () => {
    setEnableFilesQuery(true);
  };

  // Build file tree when files data is available
  useEffect(() => {
    if (files && files.length > 0 && !fileTree) {
      const tree = buildFileTree(files);
      setFileTree(tree);
      setShowFileTree(true);
    }
  }, [files]);

  const buildFileTree = (files: OpenNeuroFile[]): FileTreeNode => {
    const root: FileTreeNode = {
      name: dataset?.id || "root",
      path: "",
      isDirectory: true,
      size: 0,
      annexed: false,
      children: [],
      expanded: true,
      selected: true,
    };

    files.forEach((file) => {
      const parts = file.filename.split("/").filter(Boolean);
      let current = root;

      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        const path = parts.slice(0, index + 1).join("/");

        if (!current.children) {
          current.children = [];
        }

        let child = current.children.find((c) => c.name === part);

        if (!child) {
          const isDir = !isLast || file.directory || false;
          child = {
            name: part,
            path,
            isDirectory: isDir,
            size: isLast && !file.directory ? file.size || 0 : 0,
            annexed: isLast ? file.annexed || false : false,
            children: isDir ? [] : undefined,
            expanded: false,
            selected: true,
          };
          current.children.push(child);
        }

        if (child) {
          current = child;
        }
      });
    });

    // Sort: directories first, then files
    const sortNodes = (nodes: FileTreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      nodes.forEach((node) => {
        if (node.children) {
          sortNodes(node.children);
        }
      });
    };

    if (root.children) {
      sortNodes(root.children);
    }

    return root;
  };

  const toggleNodeExpanded = (path: string) => {
    if (!fileTree) return;

    const updateNode = (node: FileTreeNode): FileTreeNode => {
      if (node.path === path) {
        return { ...node, expanded: !node.expanded };
      }
      if (node.children) {
        return { ...node, children: node.children.map(updateNode) };
      }
      return node;
    };

    setFileTree(updateNode(fileTree));
  };

  const toggleNodeSelected = (path: string, selected: boolean) => {
    if (!fileTree) return;

    const updateNode = (node: FileTreeNode): FileTreeNode => {
      if (node.path === path || node.path.startsWith(path + "/")) {
        return {
          ...node,
          selected,
          children: node.children?.map((child) => updateNode(child)),
        };
      }
      if (node.children) {
        return { ...node, children: node.children.map(updateNode) };
      }
      return node;
    };

    setFileTree(updateNode(fileTree));
  };

  // Listen for download progress events
  useEffect(() => {
    if (!isOpen) return;

    const unlisten = listen<DownloadProgress>(
      "openneuro-download-progress",
      (event) => {
        console.log("[DOWNLOAD] Progress:", event.payload);
        setProgress(event.payload);

        if (event.payload.phase === "error") {
          setLocalError(event.payload.message);
        }
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isOpen]);

  const handleSelectDestination = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Download Destination",
      });

      if (selected && typeof selected === "string") {
        setDestinationPath(selected);
      }
    } catch (err) {
      console.error("Failed to select directory:", err);
    }
  };

  const handleDownload = () => {
    if (!dataset || !destinationPath) {
      setLocalError("Please select a destination folder");
      return;
    }

    if (!gitAvailable) {
      setLocalError(
        "Git is not installed. Please install git to download datasets.",
      );
      return;
    }

    setLocalError(null);
    setProgress(null);

    const options: DownloadOptions = {
      dataset_id: dataset.id,
      destination_path: destinationPath,
      use_github: useGitHub,
      download_annexed: downloadAnnexed && gitAnnexAvailable,
      snapshot_tag: selectedSnapshot || undefined,
    };

    downloadMutation.mutate(options, {
      onSuccess: (resultPath) => {
        console.log("[DOWNLOAD] Completed successfully:", resultPath);
        setRetryCount(0);

        // Track in downloaded datasets store
        if (dataset) {
          useDownloadedDatasetsStore.getState().addDataset({
            datasetId: dataset.id,
            name: dataset.name || dataset.id,
            path: resultPath,
            snapshotTag: selectedSnapshot,
            modalities: dataset.summary?.modalities || [],
            subjects: dataset.summary?.subjects,
            size: dataset.summary?.size,
          });
        }
      },
      onError: (err) => {
        console.error("[DOWNLOAD] Failed:", err);
        setRetryCount((prev) => prev + 1);
      },
    });
  };

  const handleRetry = () => {
    if (retryCount >= MAX_RETRIES) {
      setLocalError(
        `Maximum retry attempts (${MAX_RETRIES}) reached. Please try again later.`,
      );
      return;
    }
    setLocalError(null);
    setProgress(null);
    handleDownload();
  };

  const handleCancel = () => {
    if (!dataset) return;

    if (window.confirm("Are you sure you want to cancel this download?")) {
      cancelMutation.mutate(dataset.id, {
        onSuccess: () => {
          setLocalError("Download cancelled by user");
        },
        onError: (err) => {
          console.error("[DOWNLOAD] Failed to cancel:", err);
          setLocalError(
            err instanceof Error ? err.message : "Failed to cancel download",
          );
        },
      });
    }
  };

  const handleClose = () => {
    if (isDownloading) {
      if (
        window.confirm(
          "Download is in progress. Are you sure you want to close this dialog? The download will continue in the background.",
        )
      ) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const renderFileTree = (
    node: FileTreeNode,
    level: number = 0,
  ): React.JSX.Element => {
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
          style={{ paddingLeft: `${level * 16 + 8}px` }}
        >
          {/* Expand/collapse icon */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNodeExpanded(node.path);
              }}
              className="p-0.5 hover:bg-background rounded"
            >
              {node.expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          )}
          {!hasChildren && <div className="w-4" />}

          {/* Checkbox */}
          <input
            type="checkbox"
            checked={node.selected}
            onChange={(e) => {
              e.stopPropagation();
              toggleNodeSelected(node.path, e.target.checked);
            }}
            className="w-3 h-3"
          />

          {/* Icon */}
          {node.isDirectory ? (
            node.expanded ? (
              <FolderOpen className="h-4 w-4 text-yellow-500" />
            ) : (
              <Folder className="h-4 w-4 text-yellow-500" />
            )
          ) : (
            <File className="h-4 w-4 text-gray-500" />
          )}

          {/* Name and size */}
          <span className="text-sm flex-1">{node.name}</span>
          {!node.isDirectory && isDDACompatibleFile(node.name) && (
            <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded font-medium">
              DDA
            </span>
          )}
          {!node.isDirectory && node.size > 0 && (
            <span className="text-xs text-muted-foreground">
              {formatFileSize(node.size)}
            </span>
          )}
          {node.annexed && (
            <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
              annexed
            </span>
          )}
        </div>

        {/* Children */}
        {node.expanded && hasChildren && (
          <div>
            {node.children!.map((child) => renderFileTree(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!isOpen || !dataset) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleClose}
    >
      <div
        className="bg-background border rounded-lg shadow-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Download className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">Download Dataset</h2>
        </div>

        {/* Dataset info */}
        <div className="mb-6 p-4 bg-accent rounded-lg">
          <div className="font-semibold text-lg">{dataset.id}</div>
          {dataset.name && dataset.name !== dataset.id && (
            <div className="text-sm text-muted-foreground">{dataset.name}</div>
          )}

          {/* Size information */}
          <div className="mt-3 pt-3 border-t border-border">
            {loadingSize ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader className="h-3 w-3 animate-spin" />
                <span>Calculating dataset size...</span>
              </div>
            ) : hasSummaryData ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Total Size:</span>
                  <span className="font-mono">
                    {formatFileSize(summarySize)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>File count:</span>
                  <span>{summaryFileCount.toLocaleString()} files</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                  <Info className="h-3 w-3 flex-shrink-0" />
                  <span>
                    Actual download size may vary based on git compression and
                    annexed files
                  </span>
                </div>
              </div>
            ) : sizeInfo ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Total Size:</span>
                  <span className="font-mono">
                    {formatFileSize(sizeInfo.totalSize)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Repository (metadata):</span>
                  <span className="font-mono">
                    {formatFileSize(sizeInfo.totalSize - sizeInfo.annexedSize)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Annexed files (data):</span>
                  <span className="font-mono">
                    {formatFileSize(sizeInfo.annexedSize)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>File count:</span>
                  <span>{sizeInfo.fileCount.toLocaleString()} files</span>
                </div>
                {!downloadAnnexed && sizeInfo.annexedSize > 0 && (
                  <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-xs text-yellow-700 dark:text-yellow-300">
                    Without annexed files: ~
                    {formatFileSize(sizeInfo.totalSize - sizeInfo.annexedSize)}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={fetchDatasetSize}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Info className="h-4 w-4" />
                Click to calculate detailed download size
              </button>
            )}
          </div>
        </div>

        {/* File tree browser */}
        <div className="mb-6">
          {!showFileTree ? (
            <button
              onClick={fetchFileTree}
              disabled={loadingFiles || isDownloading}
              className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/80 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {loadingFiles ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  <span>Loading file tree...</span>
                </>
              ) : (
                <>
                  <FolderOpen className="h-4 w-4" />
                  <span>Browse Files</span>
                </>
              )}
            </button>
          ) : fileTree ? (
            <div className="border rounded-lg">
              <div className="flex items-center justify-between p-3 bg-accent/50 border-b">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  <span className="font-medium text-sm">File Browser</span>
                </div>
                <button
                  onClick={() => setShowFileTree(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Hide
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto p-2">
                {renderFileTree(fileTree)}
              </div>
              <div className="p-2 bg-accent/30 border-t text-xs text-muted-foreground">
                Select files/folders to download. Uncheck items you don't want.
              </div>
            </div>
          ) : null}
        </div>

        {/* Git availability status */}
        <div className="mb-6 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            {gitAvailable ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            <span>Git {gitAvailable ? "installed" : "not found"}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {gitAnnexAvailable ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-yellow-500" />
            )}
            <span>
              git-annex{" "}
              {gitAnnexAvailable ? "installed" : "not found (optional)"}
            </span>
          </div>
          {!gitAnnexAvailable && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground ml-6">
              <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span>
                Without git-annex, you'll get the dataset structure but large
                files may be symbolic links.
              </span>
            </div>
          )}

          {/* Resume info */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground mt-3 p-2 bg-accent/50 rounded">
            <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <span>
              <strong>Smart Resume:</strong> If a download is interrupted,
              simply download again with the same destination folder. The
              download will automatically resume from where it left off.
            </span>
          </div>
        </div>

        {/* Download options */}
        <div className="space-y-4 mb-6">
          {/* Destination folder */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Destination Folder
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={destinationPath}
                readOnly
                placeholder="Select a folder..."
                className="flex-1 px-3 py-2 border rounded-lg bg-accent text-sm"
              />
              <button
                onClick={handleSelectDestination}
                disabled={isDownloading}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Folder className="h-4 w-4" />
                Browse
              </button>
            </div>
          </div>

          {/* Snapshot selection */}
          {dataset.snapshots && dataset.snapshots.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Snapshot Version
              </label>
              <select
                value={selectedSnapshot || ""}
                onChange={(e) => setSelectedSnapshot(e.target.value)}
                disabled={isDownloading}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {dataset.snapshots.map((snapshot) => (
                  <option key={snapshot.tag} value={snapshot.tag}>
                    {snapshot.tag}{" "}
                    {snapshot.created
                      ? `(${new Date(snapshot.created).toLocaleDateString()})`
                      : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Download source */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Download Source
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={useGitHub}
                  onChange={() => setUseGitHub(true)}
                  disabled={isDownloading}
                  className="w-4 h-4"
                />
                <span className="text-sm">GitHub (recommended, faster)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!useGitHub}
                  onChange={() => setUseGitHub(false)}
                  disabled={isDownloading}
                  className="w-4 h-4"
                />
                <span className="text-sm">OpenNeuro server</span>
              </label>
            </div>
          </div>

          {/* Download annexed files */}
          {gitAnnexAvailable && (
            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={downloadAnnexed}
                  onChange={(e) => setDownloadAnnexed(e.target.checked)}
                  disabled={isDownloading}
                  className="w-4 h-4"
                />
                <span className="text-sm">
                  Download actual file data (may be large)
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Progress display */}
        {progress && (
          <div className="mb-6 p-4 bg-accent rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              {progress.phase === "completed" ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : progress.phase === "error" ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Loader className="h-5 w-5 text-primary animate-spin" />
              )}
              <span className="font-medium capitalize">{progress.phase}</span>
            </div>
            <div className="w-full bg-background rounded-full h-2 mb-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress.progress_percent}%` }}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              {progress.message}
            </div>
            {progress.current_file && (
              <div className="text-xs text-muted-foreground mt-1">
                Current: {progress.current_file}
              </div>
            )}
            {progress.phase === "completed" && downloadMutation.data && (
              <button
                onClick={() => {
                  const appStore = useAppStore.getState();
                  appStore.setDataDirectoryPath(downloadMutation.data);
                  appStore.setPrimaryNav("explore");
                  appStore.setSecondaryNav("timeseries");
                  onClose();
                }}
                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg transition-colors font-medium"
              >
                <Activity className="h-4 w-4" />
                Open & Analyze
              </button>
            )}
          </div>
        )}

        {/* Error message with retry */}
        {error && (
          <div className="mb-6 flex items-start gap-2 p-4 bg-destructive/10 border border-destructive rounded-lg text-destructive">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-medium">Download Failed</div>
              <div className="text-sm">{error}</div>
              {retryCount < MAX_RETRIES && !isDownloading && (
                <button
                  onClick={handleRetry}
                  className="mt-2 text-sm underline hover:no-underline font-medium"
                >
                  Retry download ({MAX_RETRIES - retryCount} attempts left)
                </button>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-accent hover:bg-accent/80 rounded-lg transition-colors"
          >
            Close
          </button>
          {isDownloading ? (
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg transition-colors"
            >
              <XCircle className="h-4 w-4" />
              Cancel Download
            </button>
          ) : (
            <button
              onClick={handleDownload}
              disabled={!destinationPath || !gitAvailable}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
