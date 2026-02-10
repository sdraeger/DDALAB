"use client";

import { useCallback, useState } from "react";
import { TauriService } from "@/services/tauriService";
import { tauriBackendService } from "@/services/tauriBackendService";
import { useAppStore } from "@/store/appStore";
import { toast } from "@/components/ui/toaster";
import { loggers } from "@/lib/logger";
import type { DDAResult } from "@/types/api";
import type {
  ExportSnapshotRequest,
  SnapshotImportResult,
  SnapshotApplyResult,
  SnapshotManifest,
} from "@/types/snapshot";

const POLL_MAX_ATTEMPTS = 10;
const POLL_BASE_DELAY_MS = 50;

async function pollForAnalysis(analysisId: string): Promise<DDAResult | null> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const analysis = await tauriBackendService.getDDAResult(analysisId);
    if (analysis) return analysis;
    await new Promise((resolve) =>
      setTimeout(resolve, POLL_BASE_DELAY_MS * Math.pow(2, i)),
    );
  }
  return null;
}

export function useSnapshot() {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [importResult, setImportResult] = useState<SnapshotImportResult | null>(
    null,
  );

  const setSelectedFile = useAppStore((s) => s.setSelectedFile);
  const setCurrentAnalysis = useAppStore((s) => s.setCurrentAnalysis);
  const updateAnalysisParameters = useAppStore(
    (s) => s.updateAnalysisParameters,
  );
  const setPrimaryNav = useAppStore((s) => s.setPrimaryNav);
  const setSecondaryNav = useAppStore((s) => s.setSecondaryNav);
  const setDDAActiveTab = useAppStore((s) => s.setDDAActiveTab);

  const exportSnapshot = useCallback(async (request: ExportSnapshotRequest) => {
    setIsExporting(true);
    try {
      const savedPath = await TauriService.exportSnapshot(request);
      if (savedPath) {
        toast.success(
          "Snapshot exported",
          `Saved to ${savedPath.split("/").pop()}`,
        );
        loggers.export.info("Snapshot exported", {
          savedPath,
          mode: request.mode,
        });
      }
      return savedPath;
    } catch (error) {
      loggers.export.error("Failed to export snapshot", { error });
      toast.error(
        "Export failed",
        error instanceof Error ? error.message : "Could not export snapshot",
      );
      return null;
    } finally {
      setIsExporting(false);
    }
  }, []);

  const importSnapshot = useCallback(async () => {
    setIsImporting(true);
    try {
      const result = await TauriService.importSnapshot();
      setImportResult(result);
      return result;
    } catch (error) {
      const errorMsg =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : JSON.stringify(error);
      loggers.export.error("Failed to import snapshot", {
        error: errorMsg,
        rawError: error,
      });
      toast.error("Import failed", errorMsg || "Could not read snapshot file");
      return null;
    } finally {
      setIsImporting(false);
    }
  }, []);

  const applySnapshot = useCallback(
    async (
      snapshotPath: string,
      sourceFilePath: string,
      manifest: SnapshotManifest,
    ): Promise<SnapshotApplyResult | null> => {
      setIsApplying(true);
      try {
        // 1. Write results + annotations to DB
        const applyResult = await TauriService.applySnapshot(
          snapshotPath,
          sourceFilePath,
        );

        // 2. Get file info and open it (triggers state loading chain)
        const fileInfo = await tauriBackendService.getEdfInfo(sourceFilePath);
        setSelectedFile(fileInfo);

        // 3. Restore DDA parameters from manifest
        if (manifest.analyses.length > 0) {
          const params = manifest.analyses[0].parameters;
          updateAnalysisParameters({
            variants: Array.isArray(params.variants)
              ? (params.variants as string[])
              : undefined,
            windowLength:
              typeof params.window_length === "number"
                ? params.window_length
                : undefined,
            windowStep:
              typeof params.window_step === "number"
                ? params.window_step
                : undefined,
            delays: Array.isArray(params.delay_list)
              ? (params.delay_list as number[])
              : undefined,
          });
        }

        // 4. If full snapshot, poll for the restored analysis and set as current
        if (
          manifest.mode === "full" &&
          applyResult.analyses_restored > 0 &&
          manifest.analyses.length > 0
        ) {
          const analysisId = manifest.analyses[0].id;
          try {
            const analysis = await pollForAnalysis(analysisId);
            if (analysis) {
              setCurrentAnalysis(analysis);
            } else {
              loggers.export.warn(
                "Analysis not found after polling; snapshot was applied but result could not be loaded",
                { analysisId },
              );
            }
          } catch (error) {
            loggers.export.warn("Could not load analysis result after apply", {
              analysisId,
              error,
            });
          }
        }

        // 5. Navigate to DDA results view
        setPrimaryNav("analyze");
        setSecondaryNav("dda");
        setDDAActiveTab("results");

        // 6. Toast success
        const analysisCount = applyResult.analyses_restored;
        const annotationCount = applyResult.annotations_restored;
        toast.success(
          "Snapshot applied",
          `Restored ${analysisCount} ${analysisCount === 1 ? "analysis" : "analyses"}${annotationCount > 0 ? ` and ${annotationCount} annotations` : ""}`,
        );

        setImportResult(null);
        return applyResult;
      } catch (error) {
        loggers.export.error("Failed to apply snapshot", { error });
        toast.error(
          "Apply failed",
          error instanceof Error ? error.message : "Could not restore snapshot",
        );
        return null;
      } finally {
        setIsApplying(false);
      }
    },
    [
      setSelectedFile,
      setCurrentAnalysis,
      updateAnalysisParameters,
      setPrimaryNav,
      setSecondaryNav,
      setDDAActiveTab,
    ],
  );

  const clearImportResult = useCallback(() => {
    setImportResult(null);
  }, []);

  return {
    exportSnapshot,
    importSnapshot,
    applySnapshot,
    clearImportResult,
    importResult,
    isExporting,
    isImporting,
    isApplying,
  };
}
