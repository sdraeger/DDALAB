import React, { useEffect, useRef, useCallback, useState } from "react";
import { EDFFileInfo } from "@/types/api";
import { Scissors, ExternalLink, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileContextMenuProps {
  x: number;
  y: number;
  file: EDFFileInfo;
  onClose: () => void;
  onSegmentFile: (file: EDFFileInfo) => void;
  onOpenInSystemViewer?: (file: EDFFileInfo) => void;
  onShowFileInfo?: (file: EDFFileInfo) => void;
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  x,
  y,
  file,
  onClose,
  onSegmentFile,
  onOpenInSystemViewer,
  onShowFileInfo,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (!menuRef.current) return;

      const menuItems =
        menuRef.current.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]',
        );
      const currentIndex = Array.from(menuItems).findIndex(
        (item) => item === document.activeElement,
      );

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex =
          currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
        menuItems[nextIndex]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prevIndex =
          currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
        menuItems[prevIndex]?.focus();
      }
    },
    [onClose],
  );

  // Adjusted position to prevent viewport overflow
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y });
  // Track if menu is mounted for animation
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    // Trigger entrance animation after mount
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Focus first menu item on mount
    const firstMenuItem =
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstMenuItem?.focus();

    // Adjust position to prevent viewport overflow
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      // Check right edge overflow
      if (x + rect.width > viewportWidth - 8) {
        newX = viewportWidth - rect.width - 8;
      }

      // Check bottom edge overflow
      if (y + rect.height > viewportHeight - 8) {
        newY = viewportHeight - rect.height - 8;
      }

      // Ensure minimum position
      newX = Math.max(8, newX);
      newY = Math.max(8, newY);

      if (newX !== x || newY !== y) {
        setAdjustedPosition({ x: newX, y: newY });
      }
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, handleKeyDown, x, y]);

  const handleMenuItemClick = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${file.file_name}`}
      className={cn(
        "fixed z-50 min-w-[200px] overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-md",
        // Animation classes consistent with dropdown-menu
        "transition-all duration-150 ease-out",
        isVisible
          ? "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2"
          : "opacity-0 scale-95",
      )}
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
      }}
    >
      <div className="px-3 py-2 border-b border-border">
        <div className="text-xs font-medium text-muted-foreground truncate">
          {file.file_name}
        </div>
      </div>

      {/* Edit actions */}
      <div className="py-1">
        <button
          role="menuitem"
          onClick={() => handleMenuItemClick(() => onSegmentFile(file))}
          className="relative w-full flex cursor-default select-none items-center rounded-sm px-3 py-2 text-sm outline-none transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground gap-2"
        >
          <Scissors className="h-4 w-4" aria-hidden="true" />
          Cut/Extract File
        </button>
      </div>

      {/* View actions - separated by divider */}
      {(onOpenInSystemViewer || onShowFileInfo) && (
        <>
          <div className="-mx-1 my-1 h-px bg-muted" role="separator" />
          <div className="py-1">
            {onOpenInSystemViewer && (
              <button
                role="menuitem"
                onClick={() =>
                  handleMenuItemClick(() => onOpenInSystemViewer(file))
                }
                className="relative w-full flex cursor-default select-none items-center rounded-sm px-3 py-2 text-sm outline-none transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground gap-2"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open in System Viewer
              </button>
            )}

            {onShowFileInfo && (
              <button
                role="menuitem"
                onClick={() => handleMenuItemClick(() => onShowFileInfo(file))}
                className="relative w-full flex cursor-default select-none items-center rounded-sm px-3 py-2 text-sm outline-none transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground gap-2"
              >
                <Info className="h-4 w-4" aria-hidden="true" />
                File Info
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
