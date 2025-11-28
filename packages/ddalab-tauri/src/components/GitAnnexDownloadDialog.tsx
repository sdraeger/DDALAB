"use client";

import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Download,
  CloudOff,
  Loader2,
  CheckCircle,
  XCircle,
  Copy,
  ExternalLink,
} from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { TauriService } from "@/services/tauriService";

interface GitAnnexDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  fileName: string;
  onDownloadComplete?: () => void;
}

type DownloadStatus = "idle" | "downloading" | "success" | "error";

interface DownloadProgress {
  filePath: string;
  fileName: string;
  phase: "starting" | "downloading" | "complete" | "error";
  progressPercent: number;
  bytesDownloaded: number;
  totalBytes: number;
  transferRate: string;
  message: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export function GitAnnexDownloadDialog({
  open,
  onOpenChange,
  filePath,
  fileName,
  onDownloadComplete,
}: GitAnnexDownloadDialogProps) {
  const [status, setStatus] = useState<DownloadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  // Get the directory containing the file for running git annex
  const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));

  // Command to show the user
  const downloadCommand = `cd "${fileDir}" && git annex get "${fileName}"`;

  // Set up event listener for progress updates
  useEffect(() => {
    if (!TauriService.isTauri() || !open) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<DownloadProgress>(
          "git-annex-progress",
          (event) => {
            const payload = event.payload;
            // Only handle progress for our file
            if (payload.filePath === filePath) {
              console.log("[GitAnnex] Progress update:", payload);
              setProgress(payload);

              // Update status based on phase
              if (payload.phase === "complete") {
                setStatus("success");
              } else if (payload.phase === "error") {
                setStatus("error");
                setErrorMessage(payload.message);
              }
            }
          },
        );
      } catch (error) {
        console.error("[GitAnnex] Failed to setup progress listener:", error);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [open, filePath]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStatus("idle");
      setErrorMessage("");
      setProgress(null);
    }
  }, [open]);

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(downloadCommand);
    toast.success("Command copied to clipboard");
  };

  const handleDownload = async () => {
    setStatus("downloading");
    setErrorMessage("");
    setProgress(null);

    try {
      if (TauriService.isTauri()) {
        // Use Tauri shell command
        const { invoke } = await import("@tauri-apps/api/core");

        // Run git annex get in the file's directory
        const result = await invoke<{
          success: boolean;
          output: string;
          error?: string;
        }>("run_git_annex_get", {
          filePath: filePath,
        });

        if (result.success) {
          setStatus("success");
          toast.success(`Successfully downloaded ${fileName}`);
          onDownloadComplete?.();
          // Auto-close after success
          setTimeout(() => {
            onOpenChange(false);
            setStatus("idle");
            setProgress(null);
          }, 1500);
        } else {
          setStatus("error");
          setErrorMessage(result.error || "Download failed");
          toast.error(`Failed to download: ${result.error || "Unknown error"}`);
        }
      } else {
        // Not in Tauri - show manual instructions
        setStatus("error");
        setErrorMessage(
          "Automatic download is only available in the desktop app. Please run the command manually in your terminal.",
        );
      }
    } catch (error) {
      setStatus("error");
      const message = error instanceof Error ? error.message : "Unknown error";
      setErrorMessage(message);
      toast.error(`Failed to download: ${message}`);
    }
  };

  const handleClose = () => {
    if (status !== "downloading") {
      onOpenChange(false);
      setStatus("idle");
      setErrorMessage("");
      setProgress(null);
    }
  };

  // Calculate display values
  const progressPercent = progress?.progressPercent ?? 0;
  const showProgress = status === "downloading" && progress !== null;
  const hasFileSize = progress?.totalBytes && progress.totalBytes > 0;

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CloudOff className="h-5 w-5 text-orange-500" />
            File Not Downloaded
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-sm">
              <p>
                This file is managed by{" "}
                <a
                  href="https://git-annex.branchable.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  git-annex
                  <ExternalLink className="h-3 w-3" />
                </a>{" "}
                and hasn&apos;t been downloaded to your local machine yet.
              </p>

              <div className="bg-muted rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-foreground font-medium">
                  <Badge variant="outline" className="gap-1">
                    <Download className="h-3 w-3" />
                    {fileName}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  Large dataset files are stored remotely to save disk space.
                  Download this file to view and analyze it.
                </p>
              </div>

              {/* Progress section */}
              {status === "downloading" && (
                <div className="space-y-3 bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm font-medium">
                      {progress?.phase === "starting"
                        ? "Initializing..."
                        : "Downloading..."}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-2">
                    <Progress value={progressPercent} className="h-2" />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{Math.round(progressPercent)}%</span>
                      {hasFileSize && (
                        <span>
                          {formatBytes(progress?.bytesDownloaded ?? 0)} /{" "}
                          {formatBytes(progress?.totalBytes ?? 0)}
                        </span>
                      )}
                      {progress?.transferRate && (
                        <span className="text-primary font-medium">
                          {progress.transferRate}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Current operation message */}
                  {progress?.message && progress.phase !== "starting" && (
                    <p className="text-xs text-muted-foreground truncate">
                      {progress.message}
                    </p>
                  )}
                </div>
              )}

              {status === "success" && (
                <div className="flex items-center gap-2 text-green-600 bg-green-500/10 p-3 rounded-lg">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-medium">Download complete!</span>
                </div>
              )}

              {status === "error" && errorMessage && (
                <div className="flex items-start gap-2 text-destructive bg-destructive/10 p-3 rounded-lg">
                  <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="text-xs">{errorMessage}</span>
                </div>
              )}

              {/* Manual command section - collapsed during download */}
              {status !== "downloading" && status !== "success" && (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs font-medium">
                    Manual download command:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-black/90 text-green-400 px-3 py-2 rounded text-xs font-mono overflow-x-auto">
                      git annex get &quot;{fileName}&quot;
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyCommand}
                      className="shrink-0"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={status === "downloading"}>
            {status === "success" ? "Close" : "Cancel"}
          </AlertDialogCancel>
          {TauriService.isTauri() && status !== "success" && (
            <Button
              onClick={handleDownload}
              disabled={status === "downloading"}
              className="gap-2"
            >
              {status === "downloading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download File
                </>
              )}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
