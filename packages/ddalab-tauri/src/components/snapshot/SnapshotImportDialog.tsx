"use client";

import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SnapshotImportResult } from "@/types/snapshot";

interface SnapshotImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importResult: SnapshotImportResult;
  onApply: (snapshotPath: string, sourceFilePath: string) => Promise<void>;
  onBrowseSourceFile?: () => void;
  isApplying: boolean;
}

export function SnapshotImportDialog({
  open,
  onOpenChange,
  importResult,
  onApply,
  onBrowseSourceFile,
  isApplying,
}: SnapshotImportDialogProps) {
  const { manifest, validation, snapshot_path, suggested_source_path } =
    importResult;

  const handleApply = async () => {
    const sourcePath =
      suggested_source_path || manifest.source_file.original_path;
    await onApply(snapshot_path, sourcePath);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Import Snapshot
          </DialogTitle>
          <DialogDescription>
            Review the snapshot details before applying.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{manifest.name}</span>
              <Badge
                variant={manifest.mode === "full" ? "default" : "secondary"}
              >
                {manifest.mode === "full" ? "Full Snapshot" : "Recipe Only"}
              </Badge>
            </div>
            {manifest.description && (
              <p className="text-sm text-muted-foreground">
                {manifest.description}
              </p>
            )}
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Source File</span>
              {validation.source_file_found ? (
                validation.source_file_hash_match ? (
                  <div className="flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-xs">Verified</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-xs">Hash mismatch</span>
                  </div>
                )
              ) : (
                <div className="flex items-center gap-1 text-red-600">
                  <XCircle className="h-4 w-4" />
                  <span className="text-xs">Not found</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {manifest.source_file.file_name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {manifest.source_file.channels.length} channels •{" "}
              {manifest.source_file.format}
            </p>
            {!validation.source_file_found && onBrowseSourceFile && (
              <Button
                variant="outline"
                size="sm"
                onClick={onBrowseSourceFile}
                className="gap-1"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse for file
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between text-sm">
            <span>Analyses</span>
            <span className="font-medium">{manifest.analyses.length}</span>
          </div>

          {manifest.has_annotations && (
            <div className="flex items-center justify-between text-sm">
              <span>Annotations</span>
              <span className="font-medium">Included</span>
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
              {validation.warnings.map((warning, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300"
                >
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          {validation.errors.length > 0 && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/30 p-3 space-y-1">
              {validation.errors.map((error, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300"
                >
                  <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Created with DDALAB v{manifest.application_version} •{" "}
            {new Date(manifest.created_at).toLocaleDateString()}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isApplying}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={isApplying || !validation.valid}
          >
            {isApplying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Applying...
              </>
            ) : (
              "Apply Snapshot"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
