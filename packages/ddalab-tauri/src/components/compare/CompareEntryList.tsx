"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Plus, FolderOpen } from "lucide-react";
import type { ComparisonEntry } from "@/store/slices/comparisonSlice";

interface CompareEntryListProps {
  entries: ComparisonEntry[];
  groupName?: string | null;
  onRemoveEntry: (analysisId: string) => void;
  onAddFromHistory: () => void;
  onLoadGroup: () => void;
  hasGroups: boolean;
}

export function CompareEntryList({
  entries,
  groupName,
  onRemoveEntry,
  onAddFromHistory,
  onLoadGroup,
  hasGroups,
}: CompareEntryListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold">{groupName ?? "Comparison"}</h3>
          <Badge variant="secondary" className="text-xs">
            {entries.length}
          </Badge>
        </div>
        {groupName && (
          <p className="text-xs text-muted-foreground">Saved group</p>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {entries.map((entry, i) => (
            <div
              key={entry.analysisId}
              className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group"
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{
                  backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length],
                }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{entry.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {entry.channels.length} ch &middot; {entry.variantIds.length}{" "}
                  variant
                  {entry.variantIds.length !== 1 ? "s" : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onRemoveEntry(entry.analysisId)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="p-2 border-t space-y-1">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={onAddFromHistory}
        >
          <Plus className="h-3 w-3 mr-1.5" />
          Add from History
        </Button>
        {hasGroups && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={onLoadGroup}
          >
            <FolderOpen className="h-3 w-3 mr-1.5" />
            Load Saved Group
          </Button>
        )}
      </div>
    </div>
  );
}

export const COMPARE_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#14b8a6", // teal
  "#6366f1", // indigo
];
