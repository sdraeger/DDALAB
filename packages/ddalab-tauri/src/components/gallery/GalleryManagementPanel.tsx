"use client";

import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useGalleryItems, useRemoveGalleryItem } from "@/hooks/useGallery";
import { tauriBackendService } from "@/services/tauriBackendService";
import { GalleryConfigForm } from "./GalleryConfigForm";
import { GalleryItemCard } from "./GalleryItemCard";
import { PublishToGalleryDialog } from "./PublishToGalleryDialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Globe, Plus, Settings2 } from "lucide-react";

export function GalleryManagementPanel() {
  const { data: items = [], isLoading } = useGalleryItems();
  const removeMutation = useRemoveGalleryItem();
  const analysisHistory = useAppStore((s) => s.dda.analysisHistory);
  const selectedIds = useAppStore((s) => s.gallery.selectedAnalysisIds);
  const toggleAnalysis = useAppStore((s) => s.toggleAnalysisForGallery);
  const clearSelection = useAppStore((s) => s.clearGallerySelection);

  const [showConfig, setShowConfig] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);

  const handleOpenDir = (dir: string) => {
    tauriBackendService.openGalleryDirectory(dir);
  };

  const handleRemove = (id: string) => {
    removeMutation.mutate(id);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Results Gallery</h2>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowConfig(!showConfig)}
            title="Gallery settings"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowPublishDialog(true)}
            disabled={selectedIds.length === 0 && analysisHistory.length === 0}
          >
            <Plus className="h-3 w-3 mr-1" />
            New Export
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {showConfig && (
            <>
              <GalleryConfigForm />
              <Separator />
            </>
          )}

          {analysisHistory.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Select Analyses to Export
              </h3>
              <div className="space-y-1">
                {analysisHistory.slice(0, 20).map((analysis) => (
                  <label
                    key={analysis.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(analysis.id)}
                      onChange={() => toggleAnalysis(analysis.id)}
                      className="rounded"
                    />
                    <span className="truncate flex-1">
                      {analysis.name || `Analysis ${analysis.id.slice(0, 8)}`}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(analysis.created_at).toLocaleDateString()}
                    </span>
                  </label>
                ))}
              </div>
              {selectedIds.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {selectedIds.length} selected
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={clearSelection}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-6 text-xs ml-auto"
                    onClick={() => setShowPublishDialog(true)}
                  >
                    Export Selected
                  </Button>
                </div>
              )}
              <Separator />
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Published Items ({items.length})
            </h3>
            {isLoading ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Loading...
              </p>
            ) : items.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <Globe className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  No gallery exports yet
                </p>
                <p className="text-xs text-muted-foreground">
                  Select analyses above and click &quot;New Export&quot; to
                  generate a static gallery site.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <GalleryItemCard
                    key={item.id}
                    item={item}
                    onOpenDirectory={handleOpenDir}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <PublishToGalleryDialog
        open={showPublishDialog}
        onOpenChange={setShowPublishDialog}
        analysisIds={
          selectedIds.length > 0
            ? selectedIds
            : analysisHistory.slice(0, 1).map((a) => a.id)
        }
      />
    </div>
  );
}
