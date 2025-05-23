"use client";

import { useState, useEffect, useRef } from "react";
import {
  Folder,
  File,
  ChevronRight,
  ArrowLeft,
  Star,
  Upload,
} from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { EDFPlotDialog } from "../dialog/edf-plot-dialog";
import { useEDFPlot } from "../../contexts/edf-plot-context";
import { toast } from "../ui/use-toast";
import { apiRequest } from "../../lib/utils/request";
import { useApiQuery } from "../../lib/hooks/query";
import { useSession } from "next-auth/react";

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: string;
  isFavorite?: boolean;
}

interface FileBrowserProps {
  onFileSelect: (filePath: string) => void;
  initialPath?: string;
}

interface FileListResponse {
  files: FileItem[];
}

interface ConfigResponse {
  institutionName: string;
  allowedDirs: string[];
}

interface ToggleFavoriteResponse {
  success: boolean;
  file_path: string;
  message: string | null;
}

interface FileUploadResponse {
  success: boolean;
  message: string;
  file_path: string;
}

export function FileBrowser({ onFileSelect }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Remove local state and use context instead
  const {
    setSelectedFilePath,
    setPlotDialogOpen,
    plotDialogOpen,
    selectedFilePath,
  } = useEDFPlot();

  const { data: session } = useSession();

  const {
    loading: configLoading,
    error: configError,
    data: configData,
  } = useApiQuery<ConfigResponse>({
    url: "/api/config",
    method: "GET",
    responseType: "json",
    enabled: true,
  });

  useEffect(() => {
    if (configData && currentPath === "") {
      const newPath = configData.allowedDirs[0];
      setCurrentPath(newPath);
    }
  }, [configData, currentPath]);

  const { loading, error, data, refetch, updateData } =
    useApiQuery<FileListResponse>({
      url: currentPath
        ? `/api/files/list?path=${encodeURIComponent(currentPath)}`
        : "",
      token: session?.accessToken,
      method: "GET",
      responseType: "json",
      enabled: !!currentPath,
    });

  // Format file size
  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes === 0) return "Unknown";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (
      Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
    );
  };

  // Format date
  const formatDate = (dateString?: string) => {
    if (!dateString) return "Unknown";
    const date = new Date(dateString);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  // Refresh file list
  const refreshFiles = () => {
    refetch();
  };

  // Navigate to a directory
  const navigateToDirectory = (dirPath: string) => {
    setPathHistory([...pathHistory, currentPath]);
    setCurrentPath(dirPath);
  };

  // Navigate back
  const navigateBack = () => {
    if (pathHistory.length > 0) {
      const previousPath = pathHistory[pathHistory.length - 1];
      setPathHistory(pathHistory.slice(0, -1));
      setCurrentPath(previousPath);
    }
  };

  // Handle file selection
  const handleFileSelect = (file: FileItem) => {
    if (file.isDirectory) {
      navigateToDirectory(file.path);
    } else {
      onFileSelect(file.path);
    }
  };

  // Handle star/favorite button click
  const handleStarClick = async (e: React.MouseEvent, file: FileItem) => {
    e.stopPropagation();
    try {
      const response = await apiRequest<ToggleFavoriteResponse>({
        url: `/api/favfiles/toggle?file_path=${encodeURIComponent(file.path)}`,
        token: session?.accessToken,
        method: "POST",
        responseType: "json",
      });

      // Update data.files immutably
      updateData((prevData) => {
        if (!prevData) return prevData;
        return {
          ...prevData,
          files: prevData.files.map((f) =>
            f.path === response.file_path
              ? { ...f, isFavorite: response.success }
              : f
          ),
        };
      });
    } catch (error) {
      console.error("Error toggling favorite:", error);
      toast({
        title: "Error",
        description: "Failed to update favorite status",
        variant: "destructive",
      });
      refetch(); // Sync with backend on error
    }
  };

  // Validate file type for drag and drop
  const isValidFileType = (file: File): boolean => {
    const allowedExtensions = [".edf", ".ascii"];
    const fileName = file.name.toLowerCase();
    return allowedExtensions.some((ext) => fileName.endsWith(ext));
  };

  // Handle file upload
  const uploadFile = async (file: File): Promise<void> => {
    try {
      setIsUploading(true);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("target_path", currentPath);

      // Debug logging
      console.log("Uploading file:", file.name, "to path:", currentPath);
      console.log("FormData file:", formData.get("file"));
      console.log("FormData target_path:", formData.get("target_path"));

      const response = await apiRequest<FileUploadResponse>({
        url: "/api/files/upload",
        token: session?.accessToken,
        method: "POST",
        body: formData,
        responseType: "json",
      });

      console.log("Upload response:", response);

      if (response.success) {
        toast({
          title: "Upload Successful",
          description: `File "${file.name}" uploaded successfully`,
        });
        // Refresh the file list
        refreshFiles();
      } else {
        throw new Error(response.message);
      }
    } catch (error: any) {
      console.error("Error uploading file:", error);
      toast({
        title: "Upload Failed",
        description: error.message || `Failed to upload "${file.name}"`,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Handle drag over
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  // Handle drag enter
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  // Handle drag leave
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only set isDragOver to false if we're leaving the drop zone entirely
    if (
      dropZoneRef.current &&
      !dropZoneRef.current.contains(e.relatedTarget as Node)
    ) {
      setIsDragOver(false);
    }
  };

  // Handle drop
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);

    if (files.length === 0) {
      return;
    }

    // Filter valid files
    const validFiles = files.filter(isValidFileType);
    const invalidFiles = files.filter((file) => !isValidFileType(file));

    if (invalidFiles.length > 0) {
      toast({
        title: "Invalid File Types",
        description: `Only .edf and .ascii files are allowed. ${invalidFiles.length} file(s) were ignored.`,
        variant: "destructive",
      });
    }

    if (validFiles.length === 0) {
      return;
    }

    // Upload valid files
    for (const file of validFiles) {
      await uploadFile(file);
    }
  };

  useEffect(() => {
    refreshFiles();
  }, [currentPath]);

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>File Browser</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={navigateBack}
            disabled={pathHistory.length === 0}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <Button variant="outline" size="sm" onClick={refreshFiles}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-muted-foreground">
            Current path: {currentPath || "/"}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Upload className="h-3 w-3" />
            Drag & drop .edf/.ascii files
          </div>
        </div>

        {/* Drag and Drop Zone */}
        <div
          ref={dropZoneRef}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative ${
            isDragOver
              ? "border-2 border-dashed border-primary bg-primary/10"
              : ""
          }`}
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
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">
                  Uploading files...
                </p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="text-destructive">
              Error loading files: {error.message}
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <div className="max-h-[900px] overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2 hidden md:table-cell">
                        Size
                      </th>
                      <th className="text-left p-2 hidden md:table-cell">
                        Last Modified
                      </th>
                      <th className="text-right p-2 w-12">Favorite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.files?.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="p-4 text-center text-muted-foreground"
                        >
                          No files found in this directory
                        </td>
                      </tr>
                    ) : (
                      data?.files?.map((file: FileItem) => (
                        <tr
                          key={file.path}
                          className="border-b hover:bg-muted/50 cursor-pointer"
                          onClick={() => handleFileSelect(file)}
                        >
                          <td className="p-2 flex items-center gap-2">
                            {file.isDirectory ? (
                              <>
                                <Folder className="h-4 w-4 text-blue-500" />
                                <span>{file.name}</span>
                                <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
                              </>
                            ) : (
                              <>
                                <File className="h-4 w-4 text-gray-500" />
                                <span>{file.name}</span>
                              </>
                            )}
                          </td>
                          <td className="p-2 hidden md:table-cell">
                            {file.isDirectory
                              ? "--"
                              : formatFileSize(file.size)}
                          </td>
                          <td className="p-2 hidden md:table-cell">
                            {formatDate(file.lastModified)}
                          </td>
                          <td className="p-2 text-right">
                            {!file.isDirectory && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => handleStarClick(e, file)}
                                title={
                                  file.isFavorite ? "Unstar file" : "Star file"
                                }
                              >
                                <Star
                                  className={`h-4 w-4 ${
                                    file.isFavorite
                                      ? "fill-yellow-400 text-yellow-400"
                                      : ""
                                  }`}
                                />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </CardContent>

      <EDFPlotDialog
        open={plotDialogOpen}
        onOpenChange={setPlotDialogOpen}
        filePath={selectedFilePath}
      />
    </Card>
  );
}
