"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Folder,
  File,
  ChevronRight,
  ArrowLeft,
  Star,
  Upload,
  Search,
  SortAsc,
  SortDesc,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { EDFPlotDialog } from "../dialog/EDFPlotDialog";
import { useEDFPlot } from "../../contexts/EDFPlotContext";
import { useDashboardState } from "../../contexts/DashboardStateContext";
import { toast } from "../../hooks/useToast";
import { apiRequest } from "../../lib/utils/request";
import { useApiQuery } from "../../hooks/useApiQuery";
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
}

interface FileListResponse {
  files: FileItem[];
}

interface ConfigResponse {
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
  const [currentPath, setCurrentPath] = useState("");
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const fileListScrollRef = useRef<HTMLDivElement>(null);
  const { setPlotDialogOpen, plotDialogOpen, selectedFilePath } = useEDFPlot();
  const { selectedFilePath: dashboardSelectedFilePath } = useDashboardState();
  const { data: session } = useSession();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOptions, setSortOptions] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const { data: configData } = useApiQuery<ConfigResponse>({
    url: "/api/config",
    method: "GET",
    responseType: "json",
    enabled: true,
    token: session?.accessToken,
  });

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

  useEffect(() => {
    if (configData?.allowedDirs?.length && !currentPath) {
      setCurrentPath(configData.allowedDirs[0]);
    }
  }, [configData, currentPath]);

  useEffect(() => {
    if (currentPath) refetch();
  }, [currentPath, refetch]);

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "Unknown";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "Unknown";
    const date = new Date(dateString);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };

  const navigateToDirectory = (dirPath: string) => {
    setPathHistory((prev) => [...prev, currentPath]);
    setCurrentPath(dirPath);
  };

  const navigateBack = () => {
    if (pathHistory.length) {
      setPathHistory((prev) => prev.slice(0, -1));
      setCurrentPath(pathHistory[pathHistory.length - 1] || "");
    }
  };

  const handleFileSelect = (file: FileItem) => {
    if (file.isDirectory) {
      navigateToDirectory(file.path);
    } else {
      onFileSelect(file.path);
    }
  };

  const handleStarClick = async (e: React.MouseEvent, file: FileItem) => {
    e.stopPropagation();
    try {
      const response = await apiRequest<ToggleFavoriteResponse>({
        url: `/api/favfiles/toggle?file_path=${encodeURIComponent(file.path)}`,
        token: session?.accessToken,
        method: "POST",
        responseType: "json",
      });

      updateData((prevData) => {
        if (!prevData) return null;
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
      toast({
        title: "Error",
        description: "Failed to update favorite status",
        variant: "destructive",
      });
      refetch();
    }
  };

  const isValidFileType = (file: File) => {
    const allowedExtensions = [".edf", ".ascii"];
    return allowedExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );
  };

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("target_path", currentPath);

      const response = await apiRequest<FileUploadResponse>({
        url: "/api/files/upload",
        token: session?.accessToken,
        method: "POST",
        body: formData,
        responseType: "json",
      });

      if (response.success) {
        toast({
          title: "Upload Successful",
          description: `File "${file.name}" uploaded successfully`,
        });
        refetch();
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

  const filteredFiles = useMemo(() => {
    if (!data?.files) return [];
    return data.files.filter((file) =>
      file.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [data?.files, searchTerm]);

  const sortedFiles = useMemo(() => {
    if (!filteredFiles) return [];
    return [...filteredFiles].sort((a, b) => {
      // Always sort directories first
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }

      let result = 0;
      if (sortOptions === "name") {
        result = a.name.localeCompare(b.name);
      } else if (sortOptions === "size") {
        result = (a.size || 0) - (b.size || 0);
      } else if (sortOptions === "lastModified") {
        const dateA = new Date(a.lastModified || "").getTime();
        const dateB = new Date(b.lastModified || "").getTime();
        result = dateA - dateB;
      }

      return sortOrder === "asc" ? result : -result;
    });
  }, [filteredFiles, sortOptions, sortOrder]);

  const clearSearch = () => {
    setSearchTerm("");
  };

  // Scroll to selected file when the file list changes or selected file changes
  useEffect(() => {
    if (
      !dashboardSelectedFilePath ||
      !sortedFiles?.length ||
      !fileListScrollRef.current
    ) {
      return;
    }

    // Find the selected file in the current sorted files list
    const selectedFileIndex = sortedFiles.findIndex(
      (file) => file.path === dashboardSelectedFilePath
    );

    if (selectedFileIndex === -1) {
      return; // Selected file not in current directory/search results
    }

    // Use setTimeout to ensure the DOM has been updated after data changes
    setTimeout(() => {
      const tableRows = fileListScrollRef.current?.querySelectorAll("tbody tr");
      const selectedRow = tableRows?.[selectedFileIndex];

      if (selectedRow) {
        selectedRow.scrollIntoView({
          behavior: "smooth",
          block: "start",
          inline: "nearest",
        });
      }
    }, 100);
  }, [dashboardSelectedFilePath, sortedFiles, loading]);

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>File Browser</CardTitle>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={navigateBack}
            disabled={!pathHistory.length}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between mb-4 text-sm text-muted-foreground">
          <span>Current path: {currentPath || "/"}</span>
          <div className="flex items-center gap-1 text-xs">
            <Upload className="h-3 w-3" /> Drag & drop .edf/.ascii files
          </div>
        </div>

        {/* Search and Sort Controls */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files and folders..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-8"
            />
            {searchTerm && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSearch}
                className="absolute right-1 top-1 h-6 w-6 p-0 hover:bg-muted"
                title="Clear search"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Select value={sortOptions} onValueChange={setSortOptions}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="size">Size</SelectItem>
                <SelectItem value="lastModified">Last Modified</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
              title={`Sort ${sortOrder === "asc" ? "descending" : "ascending"}`}
            >
              {sortOrder === "asc" ? (
                <SortAsc className="h-4 w-4" />
              ) : (
                <SortDesc className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Search Results Info */}
        {searchTerm && (
          <div className="text-sm text-muted-foreground mb-2">
            {sortedFiles.length === 0
              ? "No files match your search"
              : `${sortedFiles.length} file${
                  sortedFiles.length === 1 ? "" : "s"
                } found`}
          </div>
        )}

        <div
          ref={dropZoneRef}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
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
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
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
            <div className="text-destructive">Error: {error.message}</div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <div
                ref={fileListScrollRef}
                className="max-h-[900px] overflow-auto"
              >
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
                    {!sortedFiles?.length ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="p-4 text-center text-muted-foreground"
                        >
                          {searchTerm
                            ? "No files match your search"
                            : "No files found"}
                        </td>
                      </tr>
                    ) : (
                      sortedFiles.map((file) => {
                        const isSelected =
                          file.path === dashboardSelectedFilePath;
                        return (
                          <tr
                            key={file.path}
                            className={`border-b cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-primary/10 hover:bg-primary/15 border-primary/20"
                                : "hover:bg-muted/50"
                            }`}
                            onClick={() => handleFileSelect(file)}
                          >
                            <td className="p-2 flex items-center gap-2">
                              {file.isDirectory ? (
                                <>
                                  <Folder className="h-4 w-4 text-blue-500" />
                                  <span
                                    className={isSelected ? "font-medium" : ""}
                                  >
                                    {file.name}
                                  </span>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
                                </>
                              ) : (
                                <>
                                  <File className="h-4 w-4 text-gray-500" />
                                  <span
                                    className={isSelected ? "font-medium" : ""}
                                  >
                                    {file.name}
                                  </span>
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
                                    file.isFavorite
                                      ? "Unstar file"
                                      : "Star file"
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
                        );
                      })
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
