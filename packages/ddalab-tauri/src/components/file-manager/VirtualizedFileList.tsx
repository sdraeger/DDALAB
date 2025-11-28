"use client";

import React, { useCallback, useRef, useMemo } from "react";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import { EDFFileInfo } from "@/types/api";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  HardDrive,
  Calendar,
  Check,
  Download,
  CloudOff,
  AlertTriangle,
} from "lucide-react";
import { formatBytes, formatDate } from "@/lib/utils";
import { getFileFormat, getModalityBadgeClass } from "./fileUtils";

export interface VirtualizedFileListProps {
  files: EDFFileInfo[];
  selectedFile: EDFFileInfo | null;
  height: number;
  onFileSelect: (file: EDFFileInfo) => void;
  onContextMenu?: (e: React.MouseEvent, file: EDFFileInfo) => void;
  highlightedFilePath?: string | null;
  isLoading?: boolean;
}

const ITEM_HEIGHT = 72; // Height of each file row in pixels

/**
 * Virtualized file list component for displaying large numbers of files.
 * Uses react-window for efficient rendering of only visible items.
 */
export function VirtualizedFileList({
  files,
  selectedFile,
  height,
  onFileSelect,
  onContextMenu,
  highlightedFilePath,
  isLoading,
}: VirtualizedFileListProps) {
  const listRef = useRef<FixedSizeList>(null);

  // Memoize the file row renderer
  const FileRow = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const file = files[index];
      const isSelected = selectedFile?.file_path === file.file_path;
      const isHighlighted = highlightedFilePath === file.file_path;

      return (
        <div style={style} className="px-2">
          <div
            className={`flex items-start gap-3 w-full p-2 rounded-md transition-all cursor-pointer hover:bg-accent/50 ${
              isSelected ? "bg-primary/10 ring-1 ring-primary/30" : ""
            } ${
              isHighlighted
                ? "ring-2 ring-yellow-500 bg-yellow-500/10 animate-pulse"
                : ""
            }`}
            onClick={() => onFileSelect(file)}
            onContextMenu={(e) => onContextMenu?.(e, file)}
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
                className={`font-medium truncate ${
                  file.is_annex_placeholder
                    ? "text-orange-700 dark:text-orange-400"
                    : ""
                }`}
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
                    {file.bidsMetadata.modality && (
                      <Badge
                        variant="outline"
                        className={`text-xs ${getModalityBadgeClass(
                          file.bidsMetadata.modality,
                        )}`}
                      >
                        {file.bidsMetadata.modality.toUpperCase()}
                      </Badge>
                    )}
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
              {isSelected && (
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
            </div>
          </div>
        </div>
      );
    },
    [files, selectedFile, highlightedFilePath, onFileSelect, onContextMenu],
  );

  // Calculate optimal height
  const listHeight = useMemo(() => {
    const maxHeight = height;
    const contentHeight = files.length * ITEM_HEIGHT;
    return Math.min(maxHeight, contentHeight);
  }, [height, files.length]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      {isLoading && (
        <div className="absolute top-2 right-2 z-10">
          <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
        </div>
      )}
      <FixedSizeList
        ref={listRef}
        height={listHeight}
        width="100%"
        itemCount={files.length}
        itemSize={ITEM_HEIGHT}
        overscanCount={5}
        className="scrollbar-thin"
        itemKey={(index) => files[index].file_path}
      >
        {FileRow}
      </FixedSizeList>
      {files.length > 50 && (
        <div className="text-xs text-muted-foreground text-center py-2 border-t">
          Showing {files.length} files (virtualized for performance)
        </div>
      )}
    </div>
  );
}

/**
 * Threshold for switching to virtualized list
 */
export const VIRTUALIZATION_THRESHOLD = 100;
