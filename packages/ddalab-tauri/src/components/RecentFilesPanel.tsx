"use client";

import { memo, useCallback, useMemo, useState } from "react";
import {
  useRecentFilesStore,
  formatFileSize,
  formatDuration,
  getRelativeTime,
} from "@/store/recentFilesStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Clock,
  Star,
  StarOff,
  File,
  FileAudio,
  FileSpreadsheet,
  FileText,
  MoreHorizontal,
  Trash2,
  FolderOpen,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";

// File type icons
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

function getFileIcon(type: string) {
  return fileTypeIcons[type.toLowerCase()] || fileTypeIcons.default;
}

interface RecentFileItemProps {
  path: string;
  name: string;
  type: string;
  lastAccessed: number;
  accessCount: number;
  metadata?: {
    channels?: number;
    duration?: number;
    sampleRate?: number;
    fileSize?: number;
  };
  isFavorite: boolean;
  onSelect: (path: string) => void;
  onToggleFavorite: (file: {
    path: string;
    name: string;
    type: string;
  }) => void;
  onRemove: (file: { path: string; name: string; type: string }) => void;
}

const RecentFileItem = memo(function RecentFileItem({
  path,
  name,
  type,
  lastAccessed,
  accessCount,
  metadata,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onRemove,
}: RecentFileItemProps) {
  const FileIcon = getFileIcon(type);

  const handleClick = useCallback(() => {
    onSelect(path);
  }, [onSelect, path]);

  const handleToggleFavorite = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleFavorite({ path, name, type });
    },
    [onToggleFavorite, path, name, type],
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove({ path, name, type });
    },
    [onRemove, path, name, type],
  );

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
        "hover:bg-accent",
      )}
      onClick={handleClick}
    >
      {/* Icon */}
      <div className="flex-shrink-0">
        <FileIcon className="h-8 w-8 text-muted-foreground" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{name}</span>
          {isFavorite && (
            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{getRelativeTime(lastAccessed)}</span>
          {metadata?.channels && (
            <>
              <span>•</span>
              <span>{metadata.channels} ch</span>
            </>
          )}
          {metadata?.duration && (
            <>
              <span>•</span>
              <span>{formatDuration(metadata.duration)}</span>
            </>
          )}
          {metadata?.fileSize && (
            <>
              <span>•</span>
              <span>{formatFileSize(metadata.fileSize)}</span>
            </>
          )}
        </div>
      </div>

      {/* Access count badge */}
      {accessCount > 1 && (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {accessCount}×
        </Badge>
      )}

      {/* Actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleToggleFavorite}>
            {isFavorite ? (
              <>
                <StarOff className="h-4 w-4 mr-2" />
                Remove from favorites
              </>
            ) : (
              <>
                <Star className="h-4 w-4 mr-2" />
                Add to favorites
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleRemove} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Remove from recent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

interface RecentFilesPanelProps {
  onFileSelect: (path: string) => void;
  className?: string;
  maxItems?: number;
  showFavorites?: boolean;
  compact?: boolean;
}

export function RecentFilesPanel({
  onFileSelect,
  className,
  maxItems = 10,
  showFavorites = true,
  compact = false,
}: RecentFilesPanelProps) {
  const recentFiles = useRecentFilesStore((s) => s.recentFiles);
  const favorites = useRecentFilesStore((s) => s.favorites);
  const isFavorite = useRecentFilesStore((s) => s.isFavorite);
  const toggleFavorite = useRecentFilesStore((s) => s.toggleFavorite);
  const removeRecentFile = useRecentFilesStore((s) => s.removeRecentFile);
  const clearRecentFiles = useRecentFilesStore((s) => s.clearRecentFiles);

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const displayedFiles = useMemo(
    () => recentFiles.slice(0, maxItems),
    [recentFiles, maxItems],
  );

  const handleToggleFavorite = useCallback(
    (file: { path: string; name: string; type: string }) => {
      toggleFavorite(file);
    },
    [toggleFavorite],
  );

  const handleRemoveRecentFile = useCallback(
    (file: { path: string; name: string; type: string }) => {
      removeRecentFile(file.path);
    },
    [removeRecentFile],
  );

  const hasFiles = displayedFiles.length > 0 || favorites.length > 0;

  if (!hasFiles) {
    return (
      <div className={className}>
        <EmptyState
          icon="files"
          title="No recent files"
          description="Files you open will appear here for quick access."
          size={compact ? "sm" : "md"}
        />
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Favorites section */}
      {showFavorites && favorites.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-3 mb-2">
            <Star className="h-4 w-4 text-yellow-500" />
            <h3 className="text-sm font-semibold">Favorites</h3>
          </div>
          <div className="space-y-1">
            {favorites.map((file) => (
              <RecentFileItem
                key={file.path}
                path={file.path}
                name={file.name}
                type={file.type}
                lastAccessed={file.addedAt}
                accessCount={0}
                isFavorite={true}
                onSelect={onFileSelect}
                onToggleFavorite={handleToggleFavorite}
                onRemove={handleToggleFavorite}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recent files section */}
      <div>
        <div className="flex items-center justify-between px-3 mb-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Recent</h3>
          </div>
          {displayedFiles.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setShowClearConfirm(true)}
            >
              Clear all
            </Button>
          )}
        </div>

        {displayedFiles.length > 0 ? (
          <ScrollArea className={compact ? "max-h-[200px]" : "max-h-[400px]"}>
            <div className="space-y-1">
              {displayedFiles.map((file) => (
                <RecentFileItem
                  key={file.path}
                  path={file.path}
                  name={file.name}
                  type={file.type}
                  lastAccessed={file.lastAccessed}
                  accessCount={file.accessCount}
                  metadata={file.metadata}
                  isFavorite={isFavorite(file.path)}
                  onSelect={onFileSelect}
                  onToggleFavorite={handleToggleFavorite}
                  onRemove={handleRemoveRecentFile}
                />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <p className="text-sm text-muted-foreground px-3">
            No recent files yet
          </p>
        )}
      </div>

      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear recent files?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all {displayedFiles.length} files from your
              recent files list. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                clearRecentFiles();
                setShowClearConfirm(false);
              }}
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Compact dropdown version for quick access
export function RecentFilesDropdown({
  onFileSelect,
  trigger,
}: {
  onFileSelect: (path: string) => void;
  trigger?: React.ReactNode;
}) {
  const recentFiles = useRecentFilesStore((s) => s.recentFiles);
  const favorites = useRecentFilesStore((s) => s.favorites);

  const topFiles = recentFiles.slice(0, 5);
  const hasFiles = topFiles.length > 0 || favorites.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Clock className="h-4 w-4 mr-2" />
            Recent
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {!hasFiles ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No recent files
          </div>
        ) : (
          <>
            {favorites.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-1">
                  <Star className="h-3 w-3 text-yellow-500" />
                  Favorites
                </div>
                {favorites.slice(0, 3).map((file) => {
                  const FileIcon = getFileIcon(file.type);
                  return (
                    <DropdownMenuItem
                      key={file.path}
                      onClick={() => onFileSelect(file.path)}
                      className="flex items-center gap-2"
                    >
                      <FileIcon className="h-4 w-4" />
                      <span className="truncate">{file.name}</span>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
              </>
            )}
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Recent
            </div>
            {topFiles.map((file) => {
              const FileIcon = getFileIcon(file.type);
              return (
                <DropdownMenuItem
                  key={file.path}
                  onClick={() => onFileSelect(file.path)}
                  className="flex items-center gap-2"
                >
                  <FileIcon className="h-4 w-4" />
                  <div className="flex-1 min-w-0">
                    <span className="truncate block">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {getRelativeTime(file.lastAccessed)}
                    </span>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
