"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { DDAResult } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  RefreshCw,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Save,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DDAHistorySidebarProps {
  history: DDAResult[];
  currentAnalysisId: string | null;
  selectedAnalysisId: string | null;
  isLoading: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelectAnalysis: (analysis: DDAResult) => void;
  onDeleteAnalysis: (id: string, e: React.MouseEvent) => void;
  onRenameAnalysis: (id: string, name: string) => void;
  onRefresh: () => void;
}

export function DDAHistorySidebar({
  history,
  currentAnalysisId,
  selectedAnalysisId,
  isLoading,
  isCollapsed,
  onToggleCollapse,
  onSelectAnalysis,
  onDeleteAnalysis,
  onRenameAnalysis,
  onRefresh,
}: DDAHistorySidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Virtual scrolling state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 });

  // Constants for virtual scrolling
  const ITEM_HEIGHT = 96; // Approximate height of each history item in pixels
  const BUFFER_SIZE = 5; // Number of items to render above/below viewport

  const handleStartRename = useCallback(
    (analysis: DDAResult, e?: React.MouseEvent) => {
      e?.stopPropagation();
      setRenamingId(analysis.id);
      setNewName(analysis.name || `Analysis ${analysis.id.slice(0, 8)}`);
    },
    [],
  );

  const handleSubmitRename = useCallback(
    (id: string) => {
      if (newName.trim()) {
        onRenameAnalysis(id, newName.trim());
      }
      setRenamingId(null);
      setNewName("");
    },
    [newName, onRenameAnalysis],
  );

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setNewName("");
  }, []);

  // Focus and select text when entering rename mode
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Handle scroll for virtual rendering
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || history.length === 0) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;

      // Calculate visible range with buffer
      const start = Math.max(
        0,
        Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE,
      );
      const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT);
      const end = Math.min(
        history.length,
        start + visibleCount + BUFFER_SIZE * 2,
      );

      setVisibleRange({ start, end });
    };

    // Initial calculation
    handleScroll();

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [history.length]);

  // Calculate visible items
  const visibleHistory = useMemo(() => {
    return history.slice(visibleRange.start, visibleRange.end);
  }, [history, visibleRange.start, visibleRange.end]);

  // Total height for scroll container
  const totalHeight = history.length * ITEM_HEIGHT;
  const offsetY = visibleRange.start * ITEM_HEIGHT;

  if (isCollapsed) {
    return (
      <div
        className="w-10 border-r bg-muted/20 flex flex-col items-center cursor-pointer hover:bg-muted/40 transition-colors group"
        onClick={onToggleCollapse}
        title={`Expand history (${history.length} analyses)`}
      >
        {/* Expand handle */}
        <div className="h-10 flex items-center justify-center border-b w-full">
          <ChevronRight
            className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors"
            aria-hidden="true"
          />
        </div>

        {/* Vertical label with count badge */}
        <div className="flex-1 flex flex-col items-center justify-center py-3 gap-2">
          {/* Count badge */}
          {history.length > 0 && (
            <Badge
              variant="secondary"
              className="h-5 w-5 p-0 flex items-center justify-center text-[10px] font-medium rounded-full"
            >
              {history.length > 99 ? "99+" : history.length}
            </Badge>
          )}

          {/* Vertical text */}
          <div
            className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground tracking-wider uppercase"
            style={{
              writingMode: "vertical-rl",
              textOrientation: "mixed",
              transform: "rotate(180deg)",
            }}
          >
            History
          </div>
        </div>

        {/* Visual indicator of recent activity */}
        {history.length > 0 && (
          <div className="w-full px-1.5 pb-3">
            <div className="w-full h-1 bg-primary/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary/60 rounded-full"
                style={{ width: `${Math.min(100, history.length * 10)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-64 border-r bg-muted/30 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">History</h3>
          <Badge variant="secondary" className="text-xs">
            {history.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={isLoading}
            className="h-7 w-7"
            title="Refresh history"
            aria-label="Refresh history"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
              aria-hidden="true"
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            className="h-7 w-7"
            title="Collapse history"
            aria-label="Collapse history"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* History List */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        style={{ position: "relative" }}
      >
        {history.length === 0 ? (
          <div className="p-2">
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Save className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No analysis history</p>
              <p className="text-xs mt-1">Run analysis to see results here</p>
            </div>
          </div>
        ) : (
          <div style={{ height: totalHeight, position: "relative" }}>
            <div
              className="p-2 space-y-2"
              style={{
                transform: `translateY(${offsetY}px)`,
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
              }}
            >
              {visibleHistory.map((analysis) => {
                const isRenaming = renamingId === analysis.id;
                const isCurrent = currentAnalysisId === analysis.id;
                const isSelected = selectedAnalysisId === analysis.id;
                const displayName =
                  analysis.name || `Analysis ${analysis.id.slice(0, 8)}`;

                return (
                  <div
                    key={analysis.id}
                    onClick={() => !isRenaming && onSelectAnalysis(analysis)}
                    className={cn(
                      "p-3 rounded-md border transition-colors",
                      !isRenaming && "cursor-pointer hover:bg-accent/50",
                      (isSelected || isCurrent) && "bg-accent",
                      isCurrent && "border-primary",
                      !isCurrent && isSelected && "border-accent-foreground/20",
                    )}
                  >
                    {isRenaming ? (
                      <div
                        className="space-y-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <label className="text-xs font-medium text-muted-foreground">
                          Rename Analysis
                        </label>
                        <Input
                          ref={renameInputRef}
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSubmitRename(analysis.id);
                            }
                            if (e.key === "Escape") handleCancelRename();
                          }}
                          className="w-full text-sm h-10 px-3 font-medium border-primary/50 focus:border-primary"
                          placeholder="Enter analysis name"
                        />
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => handleSubmitRename(analysis.id)}
                            className="h-8 flex-1 gap-1.5"
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleCancelRename}
                            className="h-8 flex-1 gap-1.5"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Name row with inline edit on double-click */}
                        <div className="flex items-center gap-2 mb-2">
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className="flex-1 min-w-0 group/name"
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    handleStartRename(analysis);
                                  }}
                                >
                                  <p
                                    className={cn(
                                      "font-semibold text-sm truncate cursor-text",
                                      "group-hover/name:text-primary transition-colors",
                                    )}
                                    title="Double-click to rename"
                                  >
                                    {displayName}
                                  </p>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                className="max-w-[280px]"
                              >
                                <p className="font-medium">{displayName}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Double-click to rename
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => handleStartRename(analysis, e)}
                            className="h-7 w-7 flex-shrink-0 opacity-60 hover:opacity-100"
                            title="Rename analysis"
                            aria-label="Rename analysis"
                          >
                            <Pencil
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          </Button>
                        </div>

                        {/* Date and metadata */}
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {new Date(analysis.created_at).toLocaleString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </span>
                          <div className="flex items-center gap-1">
                            <span>
                              {analysis.parameters?.channels?.length ||
                                analysis.channels?.length ||
                                0}{" "}
                              ch
                            </span>
                            <span>•</span>
                            <span>
                              {analysis.parameters?.variants?.length || 0} var
                            </span>
                          </div>
                        </div>

                        {/* Actions row */}
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                          {isCurrent ? (
                            <Badge
                              variant="default"
                              className="text-[10px] h-5 px-2 font-semibold bg-primary"
                            >
                              Current
                            </Badge>
                          ) : (
                            <span />
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => onDeleteAnalysis(analysis.id, e)}
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            title="Delete analysis"
                            aria-label="Delete analysis"
                          >
                            <Trash2
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
