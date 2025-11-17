"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { DDAResult } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Save,
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

  // Virtual scrolling state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 });

  // Constants for virtual scrolling
  const ITEM_HEIGHT = 88; // Approximate height of each history item in pixels
  const BUFFER_SIZE = 5; // Number of items to render above/below viewport

  const handleStartRename = (analysis: DDAResult, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(analysis.id);
    setNewName(analysis.name || "");
  };

  const handleSubmitRename = (id: string) => {
    if (newName.trim()) {
      onRenameAnalysis(id, newName.trim());
    }
    setRenamingId(null);
    setNewName("");
  };

  const handleCancelRename = () => {
    setRenamingId(null);
    setNewName("");
  };


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
      <div className="w-12 border-r bg-muted/30 flex flex-col items-center py-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          title="Expand history"
          className="mb-4"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="writing-mode-vertical text-xs text-muted-foreground">
          History ({history.length})
        </div>
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
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            className="h-7 w-7"
            title="Collapse history"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
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

                return (
                <div
                  key={analysis.id}
                  onClick={() => !isRenaming && onSelectAnalysis(analysis)}
                  className={cn(
                    "p-3 rounded-md border transition-colors",
                    !isRenaming && "cursor-pointer hover:bg-accent/50",
                    // When selected OR current: show background highlight
                    (isSelected || isCurrent) && "bg-accent",
                    // Border styling: primary for current, accent for selected only
                    isCurrent && "border-primary",
                    !isCurrent && isSelected && "border-accent-foreground/20",
                  )}
                >
                  {isRenaming ? (
                    <div
                      className="space-y-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            handleSubmitRename(analysis.id);
                          if (e.key === "Escape") handleCancelRename();
                        }}
                        className="text-xs h-7"
                        placeholder="Analysis name"
                        autoFocus
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={() => handleSubmitRename(analysis.id)}
                          className="h-6 text-xs flex-1"
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelRename}
                          className="h-6 text-xs flex-1"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <p className="font-medium text-xs truncate">
                              {analysis.name ||
                                `Analysis ${analysis.id.slice(0, 8)}`}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {new Date(analysis.created_at).toLocaleString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
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

                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => handleStartRename(analysis, e)}
                              className="h-6 w-6 flex-shrink-0"
                              title="Rename"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => onDeleteAnalysis(analysis.id, e)}
                              className="h-6 w-6 flex-shrink-0 text-destructive hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {isCurrent && (
                          <div className="flex items-center">
                            <Badge
                              variant="default"
                              className="text-[10px] h-5 px-2 font-semibold"
                              style={{
                                backgroundColor: '#3b82f6',
                                color: 'white',
                              }}
                            >
                              Current Analysis
                            </Badge>
                          </div>
                        )}
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
