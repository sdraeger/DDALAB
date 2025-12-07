"use client";

import React, { useCallback, useState, useRef, memo } from "react";
import { X, Pin, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { OpenFile } from "@/store/openFilesStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FileTabProps {
  file: OpenFile;
  isActive: boolean;
  onActivate: (filePath: string) => void;
  onClose: (filePath: string) => void;
  onPin: (filePath: string) => void;
  onUnpin: (filePath: string) => void;
  onCloseOthers: (filePath: string) => void;
  onCloseToRight: (filePath: string) => void;
}

/**
 * Individual file tab component
 * Displays file name, close button, pin indicator, and modified dot
 */
export const FileTab = memo(function FileTab({
  file,
  isActive,
  onActivate,
  onClose,
  onPin,
  onUnpin,
  onCloseOthers,
  onCloseToRight,
}: FileTabProps) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const tabRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't activate if clicking the close button area
      const target = e.target as HTMLElement;
      if (target.closest("[data-close-button]")) {
        return;
      }
      onActivate(file.filePath);
    },
    [file.filePath, onActivate],
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onClose(file.filePath);
    },
    [file.filePath, onClose],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't toggle pin if clicking the close button
      const target = e.target as HTMLElement;
      if (target.closest("[data-close-button]")) {
        return;
      }
      if (file.isPinned) {
        onUnpin(file.filePath);
      } else {
        onPin(file.filePath);
      }
    },
    [file.filePath, file.isPinned, onPin, onUnpin],
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        onClose(file.filePath);
      }
    },
    [file.filePath, onClose],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuOpen(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate(file.filePath);
      }
    },
    [file.filePath, onActivate],
  );

  return (
    <>
      <div
        ref={tabRef}
        role="tab"
        tabIndex={0}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMiddleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        aria-selected={isActive}
        className={cn(
          "group relative flex h-8 min-w-[120px] max-w-[200px] cursor-pointer items-center gap-2 border-r border-border/50 px-3",
          "transition-colors duration-150",
          "hover:bg-muted/60",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          isActive
            ? "bg-background text-foreground border-b-2 border-b-primary"
            : "bg-muted/30 text-muted-foreground",
        )}
      >
        {/* Pin indicator */}
        {file.isPinned && (
          <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}

        {/* File icon */}
        {!file.isPinned && (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}

        {/* File name with truncation */}
        <span className="flex-1 truncate text-left text-xs font-medium">
          {file.fileName}
        </span>

        {/* Modified indicator */}
        {file.isModified && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
        )}

        {/* Close button - using span with role to avoid nested button issue */}
        <span
          role="button"
          tabIndex={-1}
          data-close-button
          onClick={handleClose}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onClose(file.filePath);
            }
          }}
          className={cn(
            "shrink-0 rounded p-0.5 transition-opacity",
            "hover:bg-muted-foreground/20",
            isActive
              ? "opacity-60 hover:opacity-100"
              : "opacity-0 group-hover:opacity-60",
          )}
          aria-label={`Close ${file.fileName}`}
        >
          <X className="h-3 w-3" />
        </span>
      </div>

      {/* Context menu - rendered separately to not interfere with clicks */}
      <DropdownMenu open={contextMenuOpen} onOpenChange={setContextMenuOpen}>
        {/* Hidden trigger anchor for the menu */}
        <DropdownMenuTrigger asChild>
          <span
            className="sr-only"
            style={{
              position: "fixed",
              left: menuPosition.x,
              top: menuPosition.y,
              width: 1,
              height: 1,
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={2}>
          <DropdownMenuItem onClick={() => onClose(file.filePath)}>
            Close
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCloseOthers(file.filePath)}>
            Close Others
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCloseToRight(file.filePath)}>
            Close to the Right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {file.isPinned ? (
            <DropdownMenuItem onClick={() => onUnpin(file.filePath)}>
              Unpin
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => onPin(file.filePath)}>
              Pin
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
});
