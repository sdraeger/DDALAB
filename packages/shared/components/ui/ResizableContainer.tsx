"use client";

import React from "react";
import { cn } from "../../lib/utils/misc";
import { useResizable } from "../../hooks/useResizable";

interface ResizableContainerProps {
  children: React.ReactNode;
  className?: string;
  storageKey?: string;
  defaultHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  enabled?: boolean;
  onHeightChange?: (height: number) => void;
}

export function ResizableContainer({
  children,
  className,
  storageKey,
  defaultHeight = 400,
  minHeight = 200,
  maxHeight = 800,
  enabled = true,
  onHeightChange,
}: ResizableContainerProps) {
  const { height, isResizing, resizeHandleProps } = useResizable({
    storageKey,
    defaultHeight,
    minHeight,
    maxHeight,
    onHeightChange,
  });

  if (!enabled) {
    return (
      <div className={className} style={{ height: defaultHeight }}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn("relative overflow-visible", className)}
      style={{ height }}
    >
      {children}

      {/* Resize Handle */}
      <div
        {...resizeHandleProps}
        title="Drag to resize height"
        className={cn(
          resizeHandleProps.className,
          isResizing && "bg-primary/15 border-primary/70"
        )}
      >
        {/* Prominent resize indicator with double bars and arrows */}
        <div
          className={cn(
            "flex flex-col items-center justify-center w-full h-full gap-0.5 transition-all duration-200",
            isResizing
              ? "opacity-100 scale-110"
              : "opacity-60 group-hover:opacity-100"
          )}
        >
          {/* Top arrow */}
          <div
            className={cn(
              "w-0 h-0 border-l-2 border-r-2 border-b-2 border-transparent transition-colors",
              isResizing
                ? "border-b-primary"
                : "border-b-muted-foreground group-hover:border-b-primary"
            )}
          />

          {/* Double bars */}
          <div className="flex flex-col gap-0.5">
            <div
              className={cn(
                "w-8 h-0.5 rounded-full transition-colors",
                isResizing
                  ? "bg-primary"
                  : "bg-muted-foreground/60 group-hover:bg-primary/80"
              )}
            />
            <div
              className={cn(
                "w-8 h-0.5 rounded-full transition-colors",
                isResizing
                  ? "bg-primary"
                  : "bg-muted-foreground/60 group-hover:bg-primary/80"
              )}
            />
          </div>

          {/* Bottom arrow */}
          <div
            className={cn(
              "w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent transition-colors",
              isResizing
                ? "border-t-primary"
                : "border-t-muted-foreground group-hover:border-t-primary"
            )}
          />
        </div>

        {/* Subtle background highlight with shadow */}
        <div
          className={cn(
            "absolute inset-0 bg-gradient-to-r from-transparent to-transparent transition-all duration-200",
            "shadow-sm group-hover:shadow-md",
            isResizing
              ? "via-primary/15 shadow-lg shadow-primary/25"
              : "via-muted-foreground/5 group-hover:via-primary/10"
          )}
        />

        {/* Optional dotted guide lines for better visibility */}
        <div
          className={cn(
            "absolute left-0 right-0 top-1 h-px bg-dotted opacity-0 transition-opacity duration-200",
            "group-hover:opacity-30",
            isResizing && "opacity-60"
          )}
          style={{
            backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
            backgroundSize: "6px 1px",
            backgroundRepeat: "repeat-x",
          }}
        />
      </div>

      {/* Resize feedback overlay */}
      {isResizing && (
        <div className="absolute top-2 right-2 bg-background/90 border rounded px-2 py-1 text-xs font-mono backdrop-blur-sm">
          {height}px
        </div>
      )}
    </div>
  );
}
