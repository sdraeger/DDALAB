"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { tauriBackendService } from "@/services/tauriBackendService";
import type { ComparisonEntry } from "@/store/slices/comparisonSlice";

interface CompareAnalysisPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingEntryIds: Set<string>;
  onAddEntries: (entries: ComparisonEntry[]) => void;
}

export function CompareAnalysisPicker({
  open,
  onOpenChange,
  existingEntryIds,
  onAddEntries,
}: CompareAnalysisPickerProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: history, isLoading } = useQuery({
    queryKey: ["dda", "summaries"],
    queryFn: () => tauriBackendService.listDDASummaries(100),
    enabled: open,
    staleTime: 10_000,
  });

  const filtered = useMemo(() => {
    if (!history) return [];
    const q = search.toLowerCase().trim();
    return history.filter((h) => {
      if (existingEntryIds.has(h.id)) return false;
      if (!q) return true;
      return (
        h.filePath.toLowerCase().includes(q) ||
        (h.name ?? "").toLowerCase().includes(q) ||
        h.variantNames.some((v) => v.toLowerCase().includes(q))
      );
    });
  }, [history, search, existingEntryIds]);

  const toggleSelection = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleAdd = useCallback(() => {
    if (!history) return;
    const entries: ComparisonEntry[] = [];
    for (const item of history) {
      if (!selected.has(item.id)) continue;
      entries.push({
        analysisId: item.id,
        label: item.name ?? item.filePath.split("/").pop() ?? item.id,
        filePath: item.filePath,
        channels: item.channelNames ?? [],
        variantIds: item.variantNames,
        createdAt: item.createdAt,
      });
    }
    onAddEntries(entries);
    setSelected(new Set());
    onOpenChange(false);
  }, [history, selected, onAddEntries, onOpenChange]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setSearch("");
        setSelected(new Set());
      }
      onOpenChange(open);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Analyses to Comparison</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by file name or variant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <ScrollArea className="h-72">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              {search ? "No matching analyses found" : "No analyses available"}
            </div>
          ) : (
            <div className="space-y-1 p-1">
              {filtered.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selected.has(item.id)}
                    onCheckedChange={() => toggleSelection(item.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">
                      {item.name ?? item.filePath.split("/").pop() ?? item.id}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[10px] py-0">
                        {item.variantNames.join(", ")}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(item.createdAt)}
                      </span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleAdd} disabled={selected.size === 0}>
            Add {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
