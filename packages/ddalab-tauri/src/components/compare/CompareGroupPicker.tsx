"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FolderOpen, Loader2, Trash2 } from "lucide-react";
import { useAnalysisGroups } from "@/hooks/useComparisonAnalysis";
import { tauriBackendService } from "@/services/tauriBackendService";
import { useQueryClient } from "@tanstack/react-query";
import { comparisonKeys } from "@/hooks/useComparisonAnalysis";
import { useCallback } from "react";

interface CompareGroupPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectGroup: (groupId: string) => void;
}

export function CompareGroupPicker({
  open,
  onOpenChange,
  onSelectGroup,
}: CompareGroupPickerProps) {
  const { data: groups, isLoading } = useAnalysisGroups(50);
  const queryClient = useQueryClient();

  const handleDelete = useCallback(
    async (groupId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await tauriBackendService.deleteAnalysisGroup(groupId);
        queryClient.invalidateQueries({ queryKey: comparisonKeys.groups() });
      } catch (err) {
        console.error("[CompareGroupPicker] Failed to delete:", err);
      }
    },
    [queryClient],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Load Comparison Group</DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-64">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !groups || groups.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              No saved comparison groups
            </div>
          ) : (
            <div className="space-y-1 p-1">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className="flex items-center gap-3 p-3 rounded-md hover:bg-muted/50 cursor-pointer group"
                  onClick={() => onSelectGroup(group.id)}
                >
                  <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{group.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px] py-0">
                        {group.source}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {group.memberCount} analyses
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(group.createdAt)}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => handleDelete(group.id, e)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
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
