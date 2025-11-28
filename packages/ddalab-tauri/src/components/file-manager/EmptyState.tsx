"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  FileText,
  FolderOpen,
  Search,
  Filter,
  Database,
  HardDrive,
  X,
} from "lucide-react";

export interface EmptyStateContext {
  hasDataDirectory: boolean;
  searchQuery: string;
  hasFilters: boolean;
  sortBy?: string;
  currentPath: string[];
  totalFilesInDirectory?: number;
}

interface EmptyStateProps {
  context: EmptyStateContext;
  onClearSearch?: () => void;
  onClearFilters?: () => void;
  onSelectDirectory?: () => void;
}

/**
 * Contextual empty state component for FileManager.
 * Displays different messages based on why no files are shown.
 */
export function EmptyState({
  context,
  onClearSearch,
  onClearFilters,
  onSelectDirectory,
}: EmptyStateProps) {
  const {
    hasDataDirectory,
    searchQuery,
    hasFilters,
    currentPath,
    totalFilesInDirectory,
  } = context;

  // No data directory configured
  if (!hasDataDirectory) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="relative">
          <HardDrive className="h-16 w-16 text-muted-foreground/30" />
          <FolderOpen className="h-8 w-8 text-primary absolute -bottom-1 -right-1" />
        </div>
        <h3 className="mt-6 font-semibold text-lg">
          No Data Directory Selected
        </h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          Choose a data directory containing your EDF, CSV, or neuroimaging
          files to get started with analysis.
        </p>
        {onSelectDirectory && (
          <Button
            onClick={onSelectDirectory}
            className="mt-4"
            variant="default"
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            Select Directory
          </Button>
        )}
      </div>
    );
  }

  // Search returned no results
  if (searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="relative">
          <Search className="h-16 w-16 text-muted-foreground/30" />
          <X className="h-6 w-6 text-orange-500 absolute -bottom-1 -right-1" />
        </div>
        <h3 className="mt-6 font-semibold text-lg">No Results Found</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          No files or folders match "
          <span className="font-medium text-foreground">{searchQuery}</span>"
          {currentPath.length > 0 && (
            <>
              {" "}
              in{" "}
              <span className="font-mono text-xs">{currentPath.join("/")}</span>
            </>
          )}
        </p>
        <div className="mt-4 flex gap-2">
          {onClearSearch && (
            <Button onClick={onClearSearch} variant="outline" size="sm">
              <X className="h-4 w-4 mr-2" />
              Clear Search
            </Button>
          )}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Tip: Try a shorter search term or check for typos
        </p>
      </div>
    );
  }

  // Filters active but no matching files
  if (hasFilters && totalFilesInDirectory && totalFilesInDirectory > 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="relative">
          <Filter className="h-16 w-16 text-muted-foreground/30" />
        </div>
        <h3 className="mt-6 font-semibold text-lg">No Matching Files</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          {totalFilesInDirectory} file{totalFilesInDirectory > 1 ? "s" : ""} in
          this directory
          {totalFilesInDirectory > 1 ? " don't match" : " doesn't match"} the
          current filters.
        </p>
        {onClearFilters && (
          <Button
            onClick={onClearFilters}
            variant="outline"
            size="sm"
            className="mt-4"
          >
            <X className="h-4 w-4 mr-2" />
            Clear Filters
          </Button>
        )}
      </div>
    );
  }

  // In a subdirectory with no supported files
  if (currentPath.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="relative">
          <FolderOpen className="h-16 w-16 text-muted-foreground/30" />
          <FileText className="h-6 w-6 text-muted-foreground/50 absolute -bottom-1 -right-1" />
        </div>
        <h3 className="mt-6 font-semibold text-lg">No Supported Files</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          This directory doesn't contain any supported file formats.
        </p>
        <div className="mt-4 p-3 bg-muted rounded-lg text-xs text-muted-foreground">
          <p className="font-medium mb-1">Supported formats:</p>
          <p>EDF, BDF, CSV, ASCII, FIF, SET, VHDR, NIfTI, XDF</p>
        </div>
      </div>
    );
  }

  // Root directory empty
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="relative">
        <Database className="h-16 w-16 text-muted-foreground/30" />
      </div>
      <h3 className="mt-6 font-semibold text-lg">Empty Directory</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        No EDF, CSV, or neuroimaging files found in this directory. Try
        selecting a different data directory.
      </p>
      {onSelectDirectory && (
        <Button onClick={onSelectDirectory} variant="outline" className="mt-4">
          <FolderOpen className="h-4 w-4 mr-2" />
          Change Directory
        </Button>
      )}
    </div>
  );
}
