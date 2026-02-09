"use client";

import { useState, useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import { useExportGallery } from "@/hooks/useGallery";
import { tauriBackendService } from "@/services/tauriBackendService";
import type {
  GalleryConfigRequest,
  GalleryItemMetaRequest,
} from "@/services/tauriBackendService";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Folder,
  Globe,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface PublishToGalleryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysisIds: string[];
}

interface ItemMeta {
  title: string;
  description: string;
  tags: string;
}

export function PublishToGalleryDialog({
  open,
  onOpenChange,
  analysisIds,
}: PublishToGalleryDialogProps) {
  const config = useAppStore((s) => s.gallery.config);
  const setGalleryConfig = useAppStore((s) => s.setGalleryConfig);
  const exportMutation = useExportGallery();

  const [outputDir, setOutputDir] = useState(config.outputDirectory);
  const [siteTitle, setSiteTitle] = useState(config.siteTitle);
  const [author, setAuthor] = useState(config.author);
  const [theme, setTheme] = useState(config.theme);
  const [itemMeta, setItemMeta] = useState<Record<string, ItemMeta>>(() => {
    const meta: Record<string, ItemMeta> = {};
    for (const id of analysisIds) {
      meta[id] = {
        title: `Analysis ${id.slice(0, 8)}`,
        description: "",
        tags: "",
      };
    }
    return meta;
  });

  const handlePickDir = useCallback(async () => {
    const dir = await tauriBackendService.selectGalleryDirectory();
    if (dir) {
      setOutputDir(dir);
      setGalleryConfig({ outputDirectory: dir });
    }
  }, [setGalleryConfig]);

  const handleExport = useCallback(async () => {
    if (!outputDir) return;

    const galleryConfig: GalleryConfigRequest = {
      siteTitle,
      siteDescription: config.siteDescription,
      author,
      baseUrl: config.baseUrl,
      theme,
    };

    const metadata: GalleryItemMetaRequest[] = analysisIds.map((id) => {
      const meta = itemMeta[id] || { title: id, description: "", tags: "" };
      return {
        analysisId: id,
        title: meta.title,
        description: meta.description,
        author,
        tags: meta.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
    });

    setGalleryConfig({ siteTitle, author, theme, outputDirectory: outputDir });

    exportMutation.mutate({
      analysisIds,
      config: galleryConfig,
      itemMetadata: metadata,
      outputDirectory: outputDir,
    });
  }, [
    outputDir,
    siteTitle,
    author,
    theme,
    analysisIds,
    itemMeta,
    config.siteDescription,
    config.baseUrl,
    exportMutation,
    setGalleryConfig,
  ]);

  const updateItemMeta = (id: string, field: keyof ItemMeta, value: string) => {
    setItemMeta((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const isSuccess = exportMutation.isSuccess;
  const isError = exportMutation.isError;
  const isPending = exportMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Publish to Gallery
          </DialogTitle>
          <DialogDescription>
            Generate a static website from{" "}
            {analysisIds.length === 1
              ? "this analysis"
              : `${analysisIds.length} analyses`}
            .
          </DialogDescription>
        </DialogHeader>

        {isSuccess ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
            <p className="font-medium">Gallery exported successfully!</p>
            <p className="text-sm text-muted-foreground">
              {exportMutation.data?.pagesGenerated} pages generated at{" "}
              {exportMutation.data?.outputPath}
            </p>
            {exportMutation.data?.warnings &&
              exportMutation.data.warnings.length > 0 && (
                <div className="text-xs text-amber-600 space-y-1">
                  {exportMutation.data.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              )}
            <Button
              variant="outline"
              onClick={() =>
                tauriBackendService.openGalleryDirectory(
                  exportMutation.data?.outputPath || outputDir,
                )
              }
            >
              Open Output Folder
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Output Directory</Label>
              <div className="flex gap-2">
                <Input
                  value={outputDir}
                  readOnly
                  placeholder="Select a folder..."
                  className="flex-1"
                />
                <Button variant="outline" size="icon" onClick={handlePickDir}>
                  <Folder className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Site Title</Label>
                <Input
                  value={siteTitle}
                  onChange={(e) => setSiteTitle(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Author</Label>
                <Input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-xs font-medium">
                Analysis Metadata ({analysisIds.length})
              </Label>
              {analysisIds.map((id) => (
                <div
                  key={id}
                  className="border rounded-md p-3 space-y-2 bg-muted/30"
                >
                  <Badge variant="outline" className="text-xs font-mono">
                    {id.slice(0, 12)}...
                  </Badge>
                  <Input
                    value={itemMeta[id]?.title || ""}
                    onChange={(e) =>
                      updateItemMeta(id, "title", e.target.value)
                    }
                    placeholder="Title"
                    className="h-7 text-sm"
                  />
                  <Input
                    value={itemMeta[id]?.description || ""}
                    onChange={(e) =>
                      updateItemMeta(id, "description", e.target.value)
                    }
                    placeholder="Description (optional)"
                    className="h-7 text-sm"
                  />
                  <Input
                    value={itemMeta[id]?.tags || ""}
                    onChange={(e) => updateItemMeta(id, "tags", e.target.value)}
                    placeholder="Tags (comma-separated)"
                    className="h-7 text-sm"
                  />
                </div>
              ))}
            </div>

            {isPending && (
              <div className="space-y-2">
                <Progress value={undefined} className="h-1.5" />
                <p className="text-xs text-muted-foreground text-center">
                  Generating gallery...
                </p>
              </div>
            )}

            {isError && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p>
                  {exportMutation.error instanceof Error
                    ? exportMutation.error.message
                    : "Export failed"}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {isSuccess ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleExport}
                disabled={isPending || !outputDir || analysisIds.length === 0}
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Export Gallery
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
