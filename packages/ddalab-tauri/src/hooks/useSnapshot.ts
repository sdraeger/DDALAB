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
  SnapshotValidation,
} from "@/types/snapshot";

const POLL_MAX_ATTEMPTS = 10;
const POLL_BASE_DELAY_MS = 50;
const SNAPSHOT_FORMAT_VERSION = "1.0.0";

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

/**
 * Check if data starts with ZIP magic bytes (PK\x03\x04).
 */
function isZipFile(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04
  );
}

/**
 * Extract manifest.json from a .ddalab ZIP file (stored uncompressed).
 * Minimal ZIP parser that avoids Tauri IPC serialization issues.
 */
function extractManifestFromZip(data: Uint8Array): SnapshotManifest {
  if (!isZipFile(data)) {
    // Check if it's a plain JSON file (old config export format)
    const decoder = new TextDecoder();
    const firstChars = decoder
      .decode(data.subarray(0, Math.min(100, data.length)))
      .trim();
    if (firstChars.startsWith("{")) {
      throw new Error(
        "This .ddalab file is a plain JSON config (old format), not a snapshot archive. " +
          "Please export a new snapshot from the Results tab.",
      );
    }
    throw new Error(
      `Not a valid .ddalab snapshot file (expected ZIP, got magic bytes: 0x${data[0]?.toString(16)} 0x${data[1]?.toString(16)})`,
    );
  }

  // Find End of Central Directory record (search backwards from end)
  let eocdOffset = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4b &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error(
      "Not a valid .ddalab snapshot file (no ZIP end-of-central-directory found)",
    );
  }

  // Parse EOCD to get central directory offset and count
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const cdEntries = view.getUint16(eocdOffset + 8, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const decoder = new TextDecoder();

  // Walk central directory entries to find manifest.json
  let offset = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (
      data[offset] !== 0x50 ||
      data[offset + 1] !== 0x4b ||
      data[offset + 2] !== 0x01 ||
      data[offset + 3] !== 0x02
    ) {
      throw new Error("Invalid central directory entry");
    }
    const compressionMethod = view.getUint16(offset + 10, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileName = decoder.decode(
      data.subarray(offset + 46, offset + 46 + fileNameLength),
    );

    if (fileName === "manifest.json") {
      if (compressionMethod !== 0) {
        throw new Error("manifest.json is compressed; expected Stored (0)");
      }
      // Parse local file header to find data start
      const lfhNameLength = view.getUint16(localHeaderOffset + 26, true);
      const lfhExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + lfhNameLength + lfhExtraLength;
      const jsonBytes = data.subarray(dataStart, dataStart + uncompressedSize);
      const jsonStr = decoder.decode(jsonBytes);
      return JSON.parse(jsonStr) as SnapshotManifest;
    }

    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  throw new Error("manifest.json not found in snapshot file");
}

function validateManifest(
  manifest: SnapshotManifest,
  sourceFileFound: boolean,
  sourceFileHashMatch: boolean,
): SnapshotValidation {
  const warnings: string[] = [];
  const errors: string[] = [];

  const manifestMajor = manifest.format_version.split(".")[0] || "0";
  const currentMajor = SNAPSHOT_FORMAT_VERSION.split(".")[0] || "0";
  const formatVersionCompatible = manifestMajor === currentMajor;

  if (!formatVersionCompatible) {
    errors.push(
      `Incompatible format version: ${manifest.format_version} (expected major version ${currentMajor})`,
    );
  }

  if (!sourceFileFound) {
    warnings.push(
      `Source file not found at original path: ${manifest.source_file.original_path}`,
    );
  } else if (!sourceFileHashMatch) {
    warnings.push(
      "Source file hash does not match the snapshot. The file may have been modified.",
    );
  }

  const valid = formatVersionCompatible && errors.length === 0;

  return {
    valid,
    format_version_compatible: formatVersionCompatible,
    source_file_found: sourceFileFound,
    source_file_hash_match: sourceFileHashMatch,
    analysis_count: manifest.analyses.length,
    warnings,
    errors,
  };
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
      loggers.export.info("Import: opening file dialog");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        title: "Import DDALAB Snapshot",
        filters: [{ name: "DDALAB Snapshot", extensions: ["ddalab"] }],
      });
      if (!selected || typeof selected !== "string") return null;
      loggers.export.info("Import: file selected", { path: selected });

      loggers.export.info("Import: reading file bytes");
      const { readFile } = await import("@tauri-apps/plugin-fs");
      let fileBytes: Uint8Array;
      try {
        fileBytes = await readFile(selected);
      } catch (readErr: unknown) {
        console.error("readFile raw error:", readErr);
        const msg =
          readErr instanceof Error
            ? readErr.message
            : typeof readErr === "object" && readErr !== null
              ? JSON.stringify(readErr, Object.getOwnPropertyNames(readErr))
              : String(readErr);
        throw new Error(`Failed to read file: ${msg}`);
      }
      loggers.export.info("Import: file read OK", {
        byteLength: fileBytes.byteLength,
      });

      loggers.export.info("Import: extracting manifest from ZIP");
      const manifest = extractManifestFromZip(fileBytes);
      loggers.export.info("Import: manifest extracted", {
        formatVersion: manifest.format_version,
        analysisCount: manifest.analyses.length,
        mode: manifest.mode,
      });

      // Check if source file exists at the original path and verify hash
      const { exists } = await import("@tauri-apps/plugin-fs");
      const { invoke } = await import("@tauri-apps/api/core");
      const originalPath = manifest.source_file.original_path;
      const sourceFileFound = await exists(originalPath).catch(() => false);

      let sourceFileHashMatch = false;
      if (sourceFileFound) {
        try {
          const hash = await invoke<string>("compute_file_hash", {
            filePath: originalPath,
          });
          sourceFileHashMatch = hash === manifest.source_file.file_hash;
        } catch {
          loggers.export.warn("Could not verify source file hash", {
            path: originalPath,
          });
        }
      }

      const validation = validateManifest(
        manifest,
        sourceFileFound,
        sourceFileHashMatch,
      );

      const result: SnapshotImportResult = {
        manifest,
        validation,
        snapshot_path: selected,
        suggested_source_path: sourceFileFound ? originalPath : null,
      };
      setImportResult(result);
      return result;
    } catch (error: unknown) {
      console.error("Import snapshot raw error:", error);
      const errorMsg =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : typeof error === "object" && error !== null
              ? JSON.stringify(error, Object.getOwnPropertyNames(error))
              : String(error);
      loggers.export.error("Failed to import snapshot", {
        error: errorMsg,
        errorType: typeof error,
        isError: error instanceof Error,
        errorConstructor:
          error && typeof error === "object"
            ? (error as Record<string, unknown>).constructor?.name
            : undefined,
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

  const browseSourceFile = useCallback(async () => {
    if (!importResult) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      title: "Select Source Data File",
      filters: [
        {
          name: "Data Files",
          extensions: [
            "edf",
            "vhdr",
            "set",
            "fif",
            "nii",
            "nii.gz",
            "xdf",
            "csv",
            "txt",
            "nwb",
          ],
        },
      ],
    });
    if (!selected || typeof selected !== "string") return;
    setImportResult((prev) =>
      prev
        ? {
            ...prev,
            suggested_source_path: selected,
            validation: {
              ...prev.validation,
              source_file_found: true,
            },
          }
        : null,
    );
  }, [importResult]);

  return {
    exportSnapshot,
    importSnapshot,
    applySnapshot,
    clearImportResult,
    browseSourceFile,
    importResult,
    isExporting,
    isImporting,
    isApplying,
  };
}
