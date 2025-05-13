"use client";

import { useState, useEffect } from "react";
import { Folder, File, ChevronRight, ArrowLeft, Star } from "lucide-react";
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

export function FileBrowser({ onFileSelect }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [pathHistory, setPathHistory] = useState<string[]>([]);

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

      console.log("favfiles toggle response", response);

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
        <div className="text-sm text-muted-foreground mb-4">
          Current path: {currentPath || "/"}
        </div>

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
                    <th className="text-left p-2 hidden md:table-cell">Size</th>
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
                          {file.isDirectory ? "--" : formatFileSize(file.size)}
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
      </CardContent>

      <EDFPlotDialog
        open={plotDialogOpen}
        onOpenChange={setPlotDialogOpen}
        filePath={selectedFilePath}
      />
    </Card>
  );
}
