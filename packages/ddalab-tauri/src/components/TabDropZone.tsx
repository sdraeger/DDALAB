/**
 * TabDropZone - Visual indicator for cross-window tab drag-and-drop
 * Shows a drop zone overlay when a tab from another window is dragged over this window
 */

import { useCrossWindowDragListener } from "@/hooks/useCrossWindowDrag";
import { FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface TabDropZoneProps {
  children: React.ReactNode;
  onTabReceived?: (tabData: { filePath: string; fileName: string }) => void;
  className?: string;
}

export function TabDropZone({
  children,
  onTabReceived,
  className,
}: TabDropZoneProps) {
  const { dragState, isDropTarget } = useCrossWindowDragListener(onTabReceived);

  const isDragging = dragState.isDragging && dragState.tabData;
  const showDropTarget = isDragging && isDropTarget;

  return (
    <div className={cn("relative h-full", className)}>
      {children}

      {/* Drop zone overlay - uses CSS transitions for smooth animations */}
      <div
        className={cn(
          "absolute inset-0 z-[100] pointer-events-none transition-all duration-200 ease-out",
          showDropTarget ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        {/* Full window overlay with subtle background */}
        <div
          className={cn(
            "absolute inset-0 transition-colors duration-200",
            showDropTarget ? "bg-blue-500/8" : "bg-transparent",
          )}
        />

        {/* Tab bar drop zone indicator */}
        <div
          className={cn(
            "absolute top-0 inset-x-0 mx-2 flex items-center justify-center gap-2",
            "bg-blue-500/15 border-2 border-blue-500 border-dashed rounded-b-lg",
            "backdrop-blur-sm",
            "transition-all duration-200 ease-out",
            showDropTarget
              ? "h-12 opacity-100 translate-y-0"
              : "h-0 opacity-0 -translate-y-2",
          )}
        >
          <FileIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-blue-700 dark:text-blue-300 font-medium text-sm">
            Drop to add &ldquo;{dragState.tabData?.fileName}&rdquo;
          </span>
        </div>

        {/* Border glow effect */}
        <div
          className={cn(
            "absolute inset-0 rounded-lg transition-all duration-200",
            showDropTarget
              ? "border-2 border-blue-500/60 shadow-[inset_0_0_20px_rgba(59,130,246,0.1)]"
              : "border-0 border-transparent",
          )}
        />
      </div>

      {/* Subtle indicator when dragging but not over this window */}
      <div
        className={cn(
          "absolute inset-0 z-[99] pointer-events-none transition-all duration-200 ease-out",
          isDragging && !isDropTarget ? "opacity-100" : "opacity-0",
        )}
      >
        <div
          className={cn(
            "absolute inset-0 rounded-lg transition-all duration-200",
            isDragging && !isDropTarget
              ? "border border-blue-400/20"
              : "border-0 border-transparent",
          )}
        />
      </div>
    </div>
  );
}

export default TabDropZone;
