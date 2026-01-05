"use client";

import * as React from "react";
import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { TOAST_DURATIONS } from "@/lib/constants";
import {
  Upload,
  FileUp,
  File,
  FileText,
  FileSpreadsheet,
  FileAudio,
  AlertCircle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// File type detection
const fileTypeIcons: Record<string, React.ElementType> = {
  edf: FileAudio,
  csv: FileSpreadsheet,
  txt: FileText,
  ascii: FileText,
  vhdr: FileAudio,
  xdf: FileAudio,
  set: FileAudio,
  fif: FileAudio,
  nwb: FileAudio,
  default: File,
};

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return fileTypeIcons[ext] || fileTypeIcons.default;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export interface FilePreview {
  file: File;
  name: string;
  size: number;
  type: string;
  preview?: string; // For images
}

export interface FileDropZoneProps {
  onFilesDropped: (files: File[]) => void;
  accept?: string[]; // File extensions to accept (e.g., [".edf", ".csv"])
  multiple?: boolean;
  maxFiles?: number;
  maxSize?: number; // Max file size in bytes
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
  showPreview?: boolean;
  // Overlay mode - shows drop zone as overlay when dragging
  overlayMode?: boolean;
}

export function FileDropZone({
  onFilesDropped,
  accept = [".edf", ".csv", ".txt", ".ascii", ".vhdr", ".xdf", ".set", ".fif"],
  multiple = true,
  maxFiles = 10,
  maxSize = 5 * 1024 * 1024 * 1024, // 5GB default
  disabled = false,
  children,
  className,
  showPreview = false,
  overlayMode = false,
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const dragCounterRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup error timeout on unmount
  React.useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = null;
    }
  }, []);

  const setErrorWithTimeout = useCallback((message: string) => {
    // Clear any existing timeout
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }
    setError(message);
    // Use longer duration (8 seconds) for error messages to give users time to read
    errorTimeoutRef.current = setTimeout(() => {
      setError(null);
      errorTimeoutRef.current = null;
    }, TOAST_DURATIONS.LONG);
  }, []);

  const validateFiles = useCallback(
    (files: File[]): { valid: File[]; errors: string[] } => {
      const valid: File[] = [];
      const errors: string[] = [];

      for (const file of files) {
        // Check file extension
        const ext = "." + file.name.split(".").pop()?.toLowerCase();
        if (accept.length > 0 && !accept.includes(ext)) {
          errors.push(`${file.name}: Unsupported file type`);
          continue;
        }

        // Check file size
        if (file.size > maxSize) {
          errors.push(
            `${file.name}: File too large (max ${formatFileSize(maxSize)})`,
          );
          continue;
        }

        valid.push(file);
      }

      // Check max files
      if (valid.length > maxFiles) {
        errors.push(`Too many files. Maximum is ${maxFiles}`);
        return { valid: valid.slice(0, maxFiles), errors };
      }

      return { valid, errors };
    },
    [accept, maxSize, maxFiles],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      dragCounterRef.current++;
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDragging(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setIsDragging(false);
      dragCounterRef.current = 0;

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      const { valid, errors } = validateFiles(files);

      if (errors.length > 0) {
        setErrorWithTimeout(errors[0]);
      }

      if (valid.length > 0) {
        clearError(); // Clear error on successful file drop
        if (showPreview) {
          const newPreviews = valid.map((file) => ({
            file,
            name: file.name,
            size: file.size,
            type: file.type,
          }));
          setPreviews(newPreviews);
        } else {
          onFilesDropped(valid);
        }
      }
    },
    [
      disabled,
      validateFiles,
      onFilesDropped,
      showPreview,
      setErrorWithTimeout,
      clearError,
    ],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      const { valid, errors } = validateFiles(files);

      if (errors.length > 0) {
        setErrorWithTimeout(errors[0]);
      }

      if (valid.length > 0) {
        clearError(); // Clear error on successful file selection
        if (showPreview) {
          const newPreviews = valid.map((file) => ({
            file,
            name: file.name,
            size: file.size,
            type: file.type,
          }));
          setPreviews(newPreviews);
        } else {
          onFilesDropped(valid);
        }
      }

      // Reset input
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [
      validateFiles,
      onFilesDropped,
      showPreview,
      setErrorWithTimeout,
      clearError,
    ],
  );

  const handleConfirmUpload = useCallback(() => {
    if (previews.length > 0) {
      onFilesDropped(previews.map((p) => p.file));
      setPreviews([]);
    }
  }, [previews, onFilesDropped]);

  const handleRemovePreview = useCallback((index: number) => {
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleClearPreviews = useCallback(() => {
    setPreviews([]);
  }, []);

  const openFileDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  // Overlay mode - renders a drop overlay over children
  if (overlayMode) {
    return (
      <div
        className={cn("relative", className)}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {children}

        {/* Drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg backdrop-blur-sm transition-all">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Upload className="h-12 w-12 animate-bounce" />
              <span className="text-lg font-medium">Drop files here</span>
              <span className="text-sm text-muted-foreground">
                {accept.join(", ")}
              </span>
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple={multiple}
          accept={accept.join(",")}
          onChange={handleFileSelect}
          disabled={disabled}
        />
      </div>
    );
  }

  // Standard drop zone
  return (
    <div className={cn("space-y-4", className)}>
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={openFileDialog}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-all cursor-pointer",
          isDragging
            ? "border-primary bg-primary/5 scale-[1.02]"
            : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/50",
          disabled && "opacity-50 cursor-not-allowed",
          error && "border-destructive bg-destructive/5",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple={multiple}
          accept={accept.join(",")}
          onChange={handleFileSelect}
          disabled={disabled}
        />

        <div
          className={cn(
            "flex flex-col items-center gap-3 text-center",
            isDragging && "scale-105",
          )}
        >
          {error ? (
            <AlertCircle className="h-10 w-10 text-destructive" />
          ) : (
            <FileUp
              className={cn(
                "h-10 w-10",
                isDragging
                  ? "text-primary animate-bounce"
                  : "text-muted-foreground",
              )}
            />
          )}

          <div className="space-y-1">
            <p className="text-sm font-medium">
              {error ||
                (isDragging
                  ? "Drop files here"
                  : "Drop files or click to browse")}
            </p>
            <p className="text-xs text-muted-foreground">
              Supports: {accept.join(", ")} (max {formatFileSize(maxSize)})
            </p>
          </div>

          {/* Dismiss error button */}
          {error && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                clearError();
              }}
              className="mt-2 text-xs text-destructive hover:text-destructive"
            >
              <X className="h-3 w-3 mr-1" />
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {/* File previews */}
      {showPreview && previews.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {previews.length} file{previews.length !== 1 ? "s" : ""} selected
            </span>
            <Button variant="ghost" size="sm" onClick={handleClearPreviews}>
              Clear all
            </Button>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {previews.map((preview, index) => {
              const FileIcon = getFileIcon(preview.name);
              return (
                <div
                  key={index}
                  className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
                >
                  <FileIcon className="h-8 w-8 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {preview.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(preview.size)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => handleRemovePreview(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>

          <Button onClick={handleConfirmUpload} className="w-full">
            <Upload className="h-4 w-4 mr-2" />
            Upload {previews.length} file{previews.length !== 1 ? "s" : ""}
          </Button>
        </div>
      )}
    </div>
  );
}
