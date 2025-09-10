"use client";

import { useState, useEffect, useMemo, useRef, memo, useCallback } from "react";
import { Search, SortAsc, SortDesc, Upload } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { LoadingOverlay } from "../../ui/loading-overlay";
import { getFileIcon, isEdfFile } from "../../../lib/utils/fileIcons";
import { get, post } from "../../../lib/utils/request";
import { toast } from "../../../hooks/useToast";
import { useUnifiedSessionData } from "../../../hooks/useUnifiedSession";
import { useAuthMode } from "../../../contexts/AuthModeContext";
import { useAppSelector, useAppDispatch } from "../../../store";
import {
  fetchFiles,
  selectFiles,
  selectCurrentPath,
  selectFilesLoading,
  selectFilesError,
  selectSelectedFile,
  clearError,
  FileItem,
} from "../../../store/slices/filesSlice";

interface ConfigResponse {
  allowedDirs: string[];
}

interface FileUploadResponse {
  success: boolean;
  message: string;
  file_path: string;
}

type SortField = "name" | "type" | "size" | "modified";
type SortDirection = "asc" | "desc";

interface FileBrowserWidgetProps {
  onFileSelect?: (filePath: string) => void;
  maxHeight?: string;
}

export const FileBrowserWidget = memo(function FileBrowserWidget({
  onFileSelect,
  maxHeight = "400px",
}: FileBrowserWidgetProps) {
  const [configData, setConfigData] = useState<ConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // Load config using direct API call
  useEffect(() => {
    let isCancelled = false;

    const loadConfig = async () => {
      try {
        setConfigLoading(true);
        setConfigError(null);

        const response = await get<ConfigResponse>("/api/config");

        if (!isCancelled) {
          console.log(
            "[FileBrowserWidget] Config loaded successfully:",
            response
          );
          setConfigData(response);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error("[FileBrowserWidget] Failed to load config:", error);
          setConfigError(
            error instanceof Error
              ? error.message
              : "Failed to load configuration"
          );
        }
      } finally {
        if (!isCancelled) {
          setConfigLoading(false);
        }
      }
    };

    loadConfig();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Show loading while config is being fetched
  if (configLoading || !configData) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-sm text-muted-foreground">
          Loading directories...
        </div>
        <div className="text-xs text-muted-foreground">
          Fetching configuration from server...
        </div>
      </div>
    );
  }

  return (
    <FileBrowserContent
      configData={configData}
      onFileSelect={onFileSelect}
      maxHeight={maxHeight}
    />
  );
});

// Separate component for the main file browser functionality
function FileBrowserContent({
  configData,
  onFileSelect,
  maxHeight = "400px",
}: {
  configData: { allowedDirs: string[] };
  onFileSelect?: (filePath: string) => void;
  maxHeight?: string;
}) {
  const { data: session, status } = useUnifiedSessionData();
  const { isLocalMode } = useAuthMode();
  const isAuthenticated =
    isLocalMode || (status === "authenticated" && session?.data?.accessToken);

  const dispatch = useAppDispatch();
  const files = useAppSelector(selectFiles);
  const currentPath = useAppSelector(selectCurrentPath);
  const selectedFile = useAppSelector(selectSelectedFile);
  const isLoading = useAppSelector(selectFilesLoading);
  const error = useAppSelector(selectFilesError);

  // Debug logging for Redux state
  console.log("[FileBrowserContent] Redux state:", {
    filesCount: files.length,
    currentPath,
    isLoading,
    error,
    files: files.slice(0, 5), // Log first 5 files to avoid spam
  });

  // Keep some local UI state for component-specific functionality
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isSelectingFile, setIsSelectingFile] = useState(false);
  const [selectedFileForLoading, setSelectedFileForLoading] = useState<
    string | null
  >(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Function to navigate to a new path
  const navigateToPath = useCallback(
    (path: string) => {
      if (path && path !== currentPath) {
        dispatch(fetchFiles(path));
      }
    },
    [dispatch, currentPath]
  );

  // Load initial directory from config - wait for config to load
  useEffect(() => {
    console.log("[FileBrowserContent] File loading effect triggered:", {
      currentPath,
      configDataExists: !!configData,
      allowedDirsLength: configData?.allowedDirs?.length,
      allowedDirs: configData?.allowedDirs,
    });

    if ((!currentPath || currentPath === "") && configData?.allowedDirs?.length) {
      console.log("[FileBrowserContent] Dispatching fetchFiles for:", configData.allowedDirs[0]);
      dispatch(fetchFiles(configData.allowedDirs[0]));
    } else if (currentPath && files.length === 0 && !isLoading && !error) {
      console.log("[FileBrowserContent] Current path exists but no files loaded, fetching:", currentPath);
      dispatch(fetchFiles(currentPath));
    }
  }, [dispatch, currentPath, configData, files.length, isLoading, error]); // Include files.length to detect empty state

  // Clear error when component unmounts or path changes
  useEffect(() => {
    return () => {
      if (error) {
        dispatch(clearError());
      }
    };
  }, [dispatch, error]);

  // Filter and sort files
  const filteredAndSortedFiles = useMemo(() => {
    let filtered = files.filter((file) =>
      file.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Sort files
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "type":
          // Directories first, then files
          if (a.isDirectory !== b.isDirectory) {
            comparison = a.isDirectory ? -1 : 1;
          } else {
            comparison = a.name.localeCompare(b.name);
          }
          break;
        case "size":
          comparison = (a.size || 0) - (b.size || 0);
          break;
        case "modified":
          comparison =
            (parseFloat(a.lastModified) || 0) -
            (parseFloat(b.lastModified) || 0);
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [files, searchTerm, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleItemClick = async (item: FileItem) => {
    console.log("[FileBrowserWidget] handleItemClick:", item);
    if (item.isDirectory) {
      // Navigate to directory
      const newPath =
        currentPath === "/" ? `/${item.name}` : `${currentPath}/${item.name}`;
      navigateToPath(newPath);
    } else {
      // Show loading state for file selection
      setIsSelectingFile(true);
      const fullPath =
        currentPath === "/" ? `/${item.name}` : `${currentPath}/${item.name}`;
      setSelectedFileForLoading(fullPath);

      try {
        console.log("[FileBrowserWidget] onFileSelect called with:", fullPath);
        onFileSelect?.(fullPath);
      } catch (error) {
        console.error("Error during file selection:", error);
      } finally {
        // Clear loading state after a brief delay
        setTimeout(() => {
          setIsSelectingFile(false);
          setSelectedFileForLoading(null);
        }, 500);
      }
    }
  };

  const handleGoUp = () => {
    if (currentPath !== "/") {
      const parentPath = currentPath.split("/").slice(0, -1).join("/") || "/";
      navigateToPath(parentPath);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "";

    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  // File upload functions
  const isValidFileType = (file: File) => {
    return isEdfFile(file.name);
  };

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("target_path", currentPath);

      const response = await post<FileUploadResponse>(
        "/api/files/upload",
        formData,
        session?.data?.accessToken
      );

      if (response.success) {
        toast({
          title: "Upload Successful",
          description: `File "${file.name}" uploaded successfully`,
        });
        fetchFiles(currentPath);
      } else {
        throw new Error(response.message);
      }
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message || `Failed to upload "${file.name}"`,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (
      dropZoneRef.current &&
      !dropZoneRef.current.contains(e.relatedTarget as Node)
    ) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(isValidFileType);
    const invalidFiles = files.filter((file) => !isValidFileType(file));

    if (invalidFiles.length) {
      toast({
        title: "Invalid File Types",
        description: `Only .edf and .ascii files are allowed. ${invalidFiles.length} file(s) ignored.`,
        variant: "destructive",
      });
    }

    for (const file of validFiles) {
      await uploadFile(file);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === "asc" ? (
      <SortAsc className="h-3 w-3" />
    ) : (
      <SortDesc className="h-3 w-3" />
    );
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Header with current path */}
      <div className="p-2 border-b bg-muted/20">
        {/* Directory selector */}
        {configData?.allowedDirs?.length > 1 && (
          <div className="mb-2">
            <Select
              value={currentPath}
              onValueChange={(value) => navigateToPath(value)}
            >
              <SelectTrigger className="h-6 text-xs">
                <SelectValue placeholder="Select directory" />
              </SelectTrigger>
              <SelectContent>
                {configData?.allowedDirs?.map((dir) => (
                  <SelectItem key={dir} value={dir} className="text-xs">
                    {dir}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoUp}
            disabled={currentPath === "/"}
            className="h-6 px-2"
          >
            ← Up
          </Button>
          <span className="font-mono">{currentPath}</span>
          <div className="flex items-center gap-1 text-xs ml-auto">
            <Upload className="h-3 w-3" /> Drag & drop .edf/.ascii files
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search files..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex gap-1 p-1 border-b bg-muted/10">
        <Button
          variant={sortField === "name" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => handleSort("name")}
          className="h-6 px-2 text-xs gap-1"
        >
          Name <SortIcon field="name" />
        </Button>
        <Button
          variant={sortField === "type" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => handleSort("type")}
          className="h-6 px-2 text-xs gap-1"
        >
          Type <SortIcon field="type" />
        </Button>
        <Button
          variant={sortField === "size" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => handleSort("size")}
          className="h-6 px-2 text-xs gap-1"
        >
          Size <SortIcon field="size" />
        </Button>
      </div>

      {/* File list with drag and drop */}
      <div
        ref={dropZoneRef}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex-1 overflow-auto relative min-h-0 ${isDragOver
          ? "border-2 border-dashed border-primary bg-primary/10"
          : ""
          }`}
        style={{ maxHeight }}
      >
        {isDragOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/20 rounded-md">
            <div className="text-center p-4">
              <Upload className="h-8 w-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium text-primary">
                Drop .edf or .ascii files here
              </p>
            </div>
          </div>
        )}

        {isUploading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 rounded-md">
            <div className="text-center p-4">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Uploading files...
              </p>
            </div>
          </div>
        )}
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Loading files...
          </div>
        ) : error ? (
          <div className="p-4 text-center text-sm text-destructive">
            {error}
          </div>
        ) : filteredAndSortedFiles.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {searchTerm ? "No files match your search" : "No files found"}
          </div>
        ) : (
          <div className="space-y-1 p-1">
            {filteredAndSortedFiles.map((item, index) => (
              <div
                key={`${item.name}-${index}`}
                className={`flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer text-xs ${selectedFile === `${currentPath}/${item.name}`
                  ? "bg-primary/10"
                  : ""
                  }`}
                onClick={() => handleItemClick(item)}
              >
                {getFileIcon({
                  name: item.name,
                  isDirectory: item.isDirectory,
                })}
                <span className="flex-1 truncate">{item.name}</span>
                {!item.isDirectory && item.size && (
                  <span className="text-muted-foreground text-xs">
                    {formatFileSize(item.size)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer with file count */}
      <div className="p-2 border-t bg-muted/10 text-xs text-muted-foreground">
        {filteredAndSortedFiles.length} items
        {searchTerm && ` (filtered from ${files.length})`}
      </div>

      {isSelectingFile && selectedFileForLoading && (
        <LoadingOverlay
          show={true}
          message={`Selecting file: ${selectedFileForLoading}`}
          type="file-load"
          variant="modal"
          size="sm"
        />
      )}
    </div>
  );
}
