"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { Command } from "lucide-react";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md",
      "animate-in fade-in-0 zoom-in-95",
      "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
      "data-[side=bottom]:slide-in-from-top-2",
      "data-[side=left]:slide-in-from-right-2",
      "data-[side=right]:slide-in-from-left-2",
      "data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

// Keyboard shortcut display component
function ShortcutKeys({ shortcut }: { shortcut: string }) {
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");

  // Parse shortcut string (e.g., "cmd+k", "ctrl+shift+s")
  const parts = shortcut.toLowerCase().split("+");

  const keySymbols: Record<string, string | React.ReactNode> = {
    cmd: isMac ? "⌘" : "Ctrl",
    ctrl: isMac ? "⌃" : "Ctrl",
    shift: isMac ? "⇧" : "Shift",
    alt: isMac ? "⌥" : "Alt",
    meta: isMac ? "⌘" : "Win",
    enter: "↵",
    escape: "Esc",
    esc: "Esc",
    backspace: "⌫",
    delete: "Del",
    tab: "Tab",
    space: "Space",
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
  };

  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold bg-muted/80 border border-border/50 rounded"
        >
          {keySymbols[part] || part.toUpperCase()}
        </kbd>
      ))}
    </span>
  );
}

// Enhanced tooltip with optional keyboard shortcut
export interface EnhancedTooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  shortcut?: string; // e.g., "cmd+k", "ctrl+s"
  description?: string; // Additional description
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  className?: string;
  disabled?: boolean;
}

export function EnhancedTooltip({
  children,
  content,
  shortcut,
  description,
  side = "top",
  align = "center",
  delayDuration = 300,
  className,
  disabled = false,
}: EnhancedTooltipProps) {
  if (disabled) {
    return <>{children}</>;
  }

  const hasExtendedContent = shortcut || description;

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          className={cn(hasExtendedContent && "py-2", className)}
        >
          <div className="flex flex-col gap-1">
            {/* Main content with optional shortcut inline */}
            <div className="flex items-center gap-2">
              <span>{content}</span>
              {shortcut && !description && <ShortcutKeys shortcut={shortcut} />}
            </div>

            {/* Description and shortcut on separate line if description exists */}
            {description && (
              <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                <span>{description}</span>
                {shortcut && <ShortcutKeys shortcut={shortcut} />}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Simple tooltip for backwards compatibility
export function SimpleTooltip({
  children,
  content,
  side = "top",
  delayDuration = 300,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Re-export primitives for custom usage
export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
