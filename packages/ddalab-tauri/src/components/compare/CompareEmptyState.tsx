"use client";

import { GitCompareArrows, FolderSearch, History } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CompareEmptyStateProps {
  onLoadGroup: () => void;
  onPickFromHistory: () => void;
  hasGroups: boolean;
}

export function CompareEmptyState({
  onLoadGroup,
  onPickFromHistory,
  hasGroups,
}: CompareEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <GitCompareArrows className="h-16 w-16 text-muted-foreground/30 mb-6" />
      <h3 className="text-lg font-semibold mb-2">
        No analyses selected for comparison
      </h3>
      <p className="text-sm text-muted-foreground mb-8 max-w-md">
        Compare DDA results across multiple subjects or conditions. Select
        analyses from history or load a saved comparison group.
      </p>
      <div className="flex gap-3">
        {hasGroups && (
          <Button variant="outline" onClick={onLoadGroup}>
            <FolderSearch className="h-4 w-4 mr-2" />
            Load Saved Group
          </Button>
        )}
        <Button onClick={onPickFromHistory}>
          <History className="h-4 w-4 mr-2" />
          Pick from History
        </Button>
      </div>
    </div>
  );
}
