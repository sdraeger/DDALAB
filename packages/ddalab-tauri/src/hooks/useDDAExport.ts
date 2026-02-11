"use client";

import { useCallback, useRef } from "react";
import { TauriService } from "@/services/tauriService";
import { tauriBackendService } from "@/services/tauriBackendService";
import { loggers } from "@/lib/logger";
import {
  exportDDAToCSV,
  exportDDAToJSON,
  getDefaultExportFilename,
} from "@/utils/ddaExport";
import {
  generatePythonScript,
  getDefaultPythonFilename,
} from "@/utils/pythonExport";
import {
  generateMatlabScript,
  getDefaultMatlabFilename,
} from "@/utils/matlabExport";
import {
  generateJuliaScript,
  getDefaultJuliaFilename,
} from "@/utils/juliaExport";
import { generateRustScript, getDefaultRustFilename } from "@/utils/rustExport";
import {
  canvasToPNG,
  canvasToSVG,
  canvasToPDF,
  getDefaultPlotFilename,
} from "@/utils/plotExport";
import { toast } from "@/components/ui/toaster";
import { useSync } from "@/hooks/useSync";
import { useSnapshot } from "@/hooks/useSnapshot";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { useAppStore } from "@/store/appStore";
import type { DDAResult } from "@/types/api";
import type { SourceFileInfo } from "@/types/snapshot";
import type { AccessPolicy, AccessPolicyType } from "@/types/sync";
import { DEFAULT_EXPIRY_DAYS } from "@/types/sync";
import type { ViewMode } from "@/components/dda/ViewModeSelector";
import type { ColorScheme } from "@/components/dda/ColorSchemePicker";
import type { PlotAnnotation } from "@/types/annotations";

interface UseDDAExportOptions {
  result: DDAResult;
  selectedVariant: number;
  availableVariants: Array<{
    variant_id: string;
    variant_name: string;
    dda_matrix: Record<string, number[]>;
  }>;
  selectedChannels: string[];
  viewMode: ViewMode;
  colorScheme: ColorScheme;
  colorRange: [number, number];
  autoScale: boolean;
  heatmapRef: React.RefObject<HTMLDivElement | null>;
  linePlotRef: React.RefObject<HTMLDivElement | null>;
  heatmapAnnotations: PlotAnnotation[];
  linePlotAnnotations: PlotAnnotation[];
}

export function useDDAExport({
  result,
  selectedVariant,
  availableVariants,
  selectedChannels,
  viewMode,
  colorScheme,
  colorRange,
  autoScale,
  heatmapRef,
  linePlotRef,
  heatmapAnnotations,
  linePlotAnnotations,
}: UseDDAExportOptions) {
  const { shareResult, isConnected: isSyncConnected } = useSync();
  const { exportSnapshot } = useSnapshot();
  const { createWindow } = usePopoutWindows();
  const sharedResultsRef = useRef<Map<string, string>>(new Map());

  // Progressive loading may leave dda_matrix empty on history-loaded results.
  // Export callbacks that need matrix data must resolve the full result first.
  const resolveFullResult = useCallback(async (): Promise<DDAResult> => {
    const hasData = result.results.variants.some(
      (v) => Object.keys(v.dda_matrix).length > 0,
    );
    if (hasData) return result;

    loggers.export.info("Fetching full result for export", { id: result.id });
    const full = await tauriBackendService.getDDAFromHistoryFull(result.id);
    if (!full) {
      throw new Error("Could not load analysis data for export");
    }
    return full;
  }, [result]);

  // Export plot as image
  const exportPlot = useCallback(
    async (format: "png" | "svg" | "pdf") => {
      try {
        let canvas: HTMLCanvasElement | null = null;
        let plotTypeForFilename: "heatmap" | "lineplot" = "heatmap";

        if (viewMode === "heatmap") {
          canvas = heatmapRef.current?.querySelector("canvas") || null;
          plotTypeForFilename = "heatmap";
        } else if (viewMode === "lineplot") {
          canvas = linePlotRef.current?.querySelector("canvas") || null;
          plotTypeForFilename = "lineplot";
        } else if (viewMode === "all") {
          const heatmapCanvas = heatmapRef.current?.querySelector("canvas");
          const linePlotCanvas = linePlotRef.current?.querySelector("canvas");

          if (heatmapCanvas && linePlotCanvas) {
            const combinedCanvas = document.createElement("canvas");
            combinedCanvas.width = Math.max(
              heatmapCanvas.width,
              linePlotCanvas.width,
            );
            combinedCanvas.height =
              heatmapCanvas.height + linePlotCanvas.height + 20;

            const ctx = combinedCanvas.getContext("2d");
            if (ctx) {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, combinedCanvas.width, combinedCanvas.height);
              ctx.drawImage(heatmapCanvas, 0, 0);
              ctx.drawImage(linePlotCanvas, 0, heatmapCanvas.height + 20);
              canvas = combinedCanvas;
              plotTypeForFilename = "heatmap";
            }
          } else {
            canvas = (heatmapCanvas || linePlotCanvas) ?? null;
            plotTypeForFilename = heatmapCanvas ? "heatmap" : "lineplot";
          }
        }

        if (!canvas) {
          loggers.export.error("No canvas found to export");
          return;
        }

        const resultName = result.name || result.id.slice(0, 8);
        const variant = availableVariants[selectedVariant];
        const variantId = variant?.variant_id || "unknown";
        const filename = getDefaultPlotFilename(
          resultName,
          variantId,
          plotTypeForFilename,
          format,
        );

        let imageData: Uint8Array;
        if (format === "png") {
          imageData = await canvasToPNG(canvas);
        } else if (format === "svg") {
          imageData = await canvasToSVG(canvas);
        } else {
          imageData = await canvasToPDF(canvas);
        }

        const savedPath = await TauriService.savePlotExportFile(
          imageData,
          format,
          filename,
        );
        if (savedPath) {
          loggers.export.info("Plot exported successfully", {
            savedPath,
            format,
          });
          toast.success(
            "Plot exported",
            `Saved as ${format.toUpperCase()} to ${savedPath.split("/").pop()}`,
          );
        }
      } catch (error) {
        loggers.export.error("Failed to export plot", { format, error });
        toast.error(
          "Export failed",
          `Could not export plot as ${format.toUpperCase()}`,
        );
      }
    },
    [
      viewMode,
      selectedVariant,
      result,
      availableVariants,
      heatmapRef,
      linePlotRef,
    ],
  );

  // Export data as CSV or JSON
  const exportData = useCallback(
    async (format: "csv" | "json") => {
      try {
        const fullResult = await resolveFullResult();
        let content: string;
        const variant = availableVariants[selectedVariant];
        const variantId = variant?.variant_id;

        if (format === "csv") {
          content = exportDDAToCSV(fullResult, {
            variant: variantId,
            channels: selectedChannels,
          });
        } else {
          content = exportDDAToJSON(fullResult, {
            variant: variantId,
            channels: selectedChannels,
          });
        }

        const filename = getDefaultExportFilename(
          fullResult,
          format,
          variantId,
        );
        const savedPath = await TauriService.saveDDAExportFile(
          content,
          format,
          filename,
        );

        if (savedPath) {
          loggers.export.info("Data exported successfully", {
            savedPath,
            format,
          });
          toast.success(
            "Data exported",
            `Saved as ${format.toUpperCase()} to ${savedPath.split("/").pop()}`,
          );
        }
      } catch (error) {
        loggers.export.error("Failed to export data", { format, error });
        toast.error(
          "Export failed",
          `Could not export data as ${format.toUpperCase()}`,
        );
      }
    },
    [resolveFullResult, selectedVariant, selectedChannels, availableVariants],
  );

  // Export all variants
  const exportAllData = useCallback(
    async (format: "csv" | "json") => {
      try {
        const fullResult = await resolveFullResult();
        let content: string;

        if (format === "csv") {
          content = exportDDAToCSV(fullResult, {});
        } else {
          content = exportDDAToJSON(fullResult, {});
        }

        const filename = getDefaultExportFilename(fullResult, format);
        const savedPath = await TauriService.saveDDAExportFile(
          content,
          format,
          filename,
        );

        if (savedPath) {
          loggers.export.info("All variants exported successfully", {
            savedPath,
            format,
            variantCount: availableVariants.length,
          });
          toast.success(
            "All variants exported",
            `Saved ${availableVariants.length} variants as ${format.toUpperCase()} to ${savedPath.split("/").pop()}`,
          );
        }
      } catch (error) {
        loggers.export.error("Failed to export all data", { format, error });
        toast.error(
          "Export failed",
          `Could not export all variants as ${format.toUpperCase()}`,
        );
      }
    },
    [resolveFullResult, availableVariants.length],
  );

  // Export reproducible script (Python, MATLAB, Julia, or Rust)
  // Reproduction scripts export ALL variants (not filtered to selected) since
  // the purpose is to reproduce the full analysis, not a single view.
  const exportScript = useCallback(
    async (format: "python" | "matlab" | "julia" | "rust") => {
      try {
        const fullResult = await resolveFullResult();
        const exportOptions = {};

        const formatMap = {
          python: {
            generate: generatePythonScript,
            filename: getDefaultPythonFilename,
            ext: "py" as const,
            label: "Python",
          },
          matlab: {
            generate: generateMatlabScript,
            filename: getDefaultMatlabFilename,
            ext: "m" as const,
            label: "MATLAB",
          },
          julia: {
            generate: generateJuliaScript,
            filename: getDefaultJuliaFilename,
            ext: "jl" as const,
            label: "Julia",
          },
          rust: {
            generate: generateRustScript,
            filename: getDefaultRustFilename,
            ext: "rs" as const,
            label: "Rust",
          },
        };

        const fmt = formatMap[format];
        const content = fmt.generate(fullResult, exportOptions);
        const filename = fmt.filename(fullResult);

        const savedPath = await TauriService.saveDDAExportFile(
          content,
          fmt.ext,
          filename,
        );

        if (savedPath) {
          loggers.export.info("Script exported successfully", {
            savedPath,
            format,
          });
          toast.success(
            "Script exported",
            `Saved ${fmt.label} script to ${savedPath.split("/").pop()}`,
          );
        }
      } catch (error) {
        loggers.export.error("Failed to export script", { format, error });
        toast.error("Export failed", `Could not export ${format} script`);
      }
    },
    [resolveFullResult],
  );

  // Pop out to separate window
  const handlePopOut = useCallback(async () => {
    const ddaResultsData = {
      result,
      uiState: {
        selectedVariant,
        colorScheme,
        viewMode,
        selectedChannels,
        colorRange,
        autoScale,
      },
      annotations: {
        heatmap: heatmapAnnotations,
        lineplot: linePlotAnnotations,
      },
    };

    try {
      const windowId = await createWindow(
        "dda-results",
        result.id,
        ddaResultsData,
      );
      loggers.ui.debug("Created DDA results popout window", { windowId });
    } catch (error) {
      loggers.ui.error("Failed to create popout window", { error });
    }
  }, [
    result,
    selectedVariant,
    colorScheme,
    viewMode,
    selectedChannels,
    colorRange,
    autoScale,
    createWindow,
    heatmapAnnotations,
    linePlotAnnotations,
  ]);

  // Share result
  const handleShare = useCallback(
    async (
      title: string,
      description: string,
      accessPolicyType: AccessPolicyType,
    ): Promise<string | null> => {
      try {
        const expiryDays = DEFAULT_EXPIRY_DAYS.unclassified;
        const expiresAt = new Date(
          Date.now() + expiryDays * 24 * 60 * 60 * 1000,
        ).toISOString();
        const accessPolicy: AccessPolicy = {
          type: accessPolicyType,
          institution_id: "",
          permissions: ["view", "download"],
          expires_at: expiresAt,
        };
        const link = await shareResult(
          result.id,
          title,
          description || null,
          accessPolicy,
        );
        sharedResultsRef.current.set(result.id, link);
        toast.success(
          "Share created",
          "Your result is now shared with colleagues",
        );
        return link;
      } catch (error) {
        loggers.api.error("Failed to share result", { error });
        toast.error(
          "Share failed",
          error instanceof Error ? error.message : "Could not share result",
        );
        return null;
      }
    },
    [shareResult, result.id],
  );

  // Get existing share link for this result
  const getExistingShareLink = useCallback(() => {
    return sharedResultsRef.current.get(result.id) || null;
  }, [result.id]);

  const handleExportSnapshot = useCallback(
    async (mode: "full" | "recipe_only") => {
      const selectedFile = useAppStore.getState().fileManager.selectedFile;
      const sourceFileInfo: SourceFileInfo = {
        original_path: result.file_path,
        file_name: result.file_path.split("/").pop() || result.file_path,
        file_hash: "",
        file_size: selectedFile?.file_size ?? 0,
        duration_seconds: selectedFile?.duration ?? null,
        sample_rate: selectedFile?.sample_rate ?? null,
        channels: result.channels,
        format: result.file_path.split(".").pop()?.toUpperCase() || "UNKNOWN",
      };

      await exportSnapshot({
        sourceFilePath: result.file_path,
        analysisIds: [result.id],
        mode,
        name: result.name || `DDA Analysis ${result.id.slice(0, 8)}`,
        parameters: result.parameters as unknown as Record<string, unknown>,
        sourceFileInfo,
      });
    },
    [result, exportSnapshot],
  );

  return {
    exportPlot,
    exportData,
    exportAllData,
    exportScript,
    handlePopOut,
    handleShare,
    getExistingShareLink,
    isSyncConnected,
    handleExportSnapshot,
  };
}
