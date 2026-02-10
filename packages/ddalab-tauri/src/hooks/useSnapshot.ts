"use client";

import { useCallback, useState } from "react";
import { TauriService } from "@/services/tauriService";
import { tauriBackendService } from "@/services/tauriBackendService";
import { useAppStore } from "@/store/appStore";
import { toast } from "@/components/ui/toaster";
import { loggers } from "@/lib/logger";
import type {
  ExportSnapshotRequest,
  SnapshotImportResult,
  SnapshotApplyResult,
  SnapshotManifest,
} from "@/types/snapshot";

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
      loggers.export.error("Failed to import snapshot", { error });
      toast.error(
        "Import failed",
        error instanceof Error ? error.message : "Could not read snapshot file",
      );
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
        const applyResult = await TauriService.applySnapshot(
          snapshotPath,
          sourceFilePath,
        );

        const fileInfo = await tauriBackendService.getEdfInfo(sourceFilePath);

        setSelectedFile(fileInfo);

        if (manifest.analyses.length > 0) {
          const firstAnalysis = manifest.analyses[0];
          const params = firstAnalysis.parameters;
          if (params) {
            updateAnalysisParameters({
              variants: params.variants as string[] | undefined,
              windowLength: params.window_length as number | undefined,
              windowStep: params.window_step as number | undefined,
              delays: params.delay_list as number[] | undefined,
            });
          }
        }

        if (
          manifest.mode === "full" &&
          applyResult.analyses_restored > 0 &&
          manifest.analyses.length > 0
        ) {
          await new Promise((resolve) => setTimeout(resolve, 300));

          const analysisId = manifest.analyses[0].id;
          const analysis = await tauriBackendService.getDDAResult(analysisId);
          if (analysis) {
            setCurrentAnalysis(analysis);
          }
        }

        setPrimaryNav("analyze");
        setSecondaryNav("dda");
        setDDAActiveTab("results");

        const analysisCount = applyResult.analyses_restored;
        const annotationCount = applyResult.annotations_restored;
        toast.success(
          "Snapshot applied",
          `Restored ${analysisCount} analysis${analysisCount !== 1 ? "es" : ""}${annotationCount > 0 ? ` and ${annotationCount} annotations` : ""}`,
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
