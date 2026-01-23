"use client";

import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { open } from "@tauri-apps/plugin-dialog";
import {
  BIDSFileAssignment,
  BIDSDatasetMetadata,
  BIDSExportOptions,
  BIDSExportResult,
} from "@/types/bidsExport";
import {
  Folder,
  FolderOpen,
  FileText,
  FileAudio,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ReviewStepProps {
  files: BIDSFileAssignment[];
  metadata: BIDSDatasetMetadata;
  options: BIDSExportOptions;
  outputPath: string;
  setOutputPath: (path: string) => void;
  validationErrors: string[];
  result: BIDSExportResult | null;
}

export function ReviewStep({
  files,
  metadata,
  options,
  outputPath,
  setOutputPath,
  validationErrors,
  result,
}: ReviewStepProps) {
  const folderStructure = useMemo(() => {
    const structure: { path: string; type: "folder" | "file" }[] = [];
    const seen = new Set<string>();

    structure.push({ path: "dataset_description.json", type: "file" });
    structure.push({ path: "participants.tsv", type: "file" });
    structure.push({ path: "README", type: "file" });

    const sortedFiles = [...files].sort((a, b) => {
      if (a.subjectId !== b.subjectId)
        return a.subjectId.localeCompare(b.subjectId);
      if (a.sessionId !== b.sessionId)
        return (a.sessionId || "").localeCompare(b.sessionId || "");
      return a.task.localeCompare(b.task);
    });

    for (const file of sortedFiles) {
      const subPath = `sub-${file.subjectId}`;
      if (!seen.has(subPath)) {
        structure.push({ path: subPath, type: "folder" });
        seen.add(subPath);
      }

      let currentPath = subPath;

      if (file.sessionId) {
        currentPath = `${subPath}/ses-${file.sessionId}`;
        if (!seen.has(currentPath)) {
          structure.push({ path: currentPath, type: "folder" });
          seen.add(currentPath);
        }
      }

      const eegPath = `${currentPath}/eeg`;
      if (!seen.has(eegPath)) {
        structure.push({ path: eegPath, type: "folder" });
        seen.add(eegPath);
      }

      const parts = [`sub-${file.subjectId}`];
      if (file.sessionId) parts.push(`ses-${file.sessionId}`);
      parts.push(`task-${file.task}`);
      if (file.run) parts.push(`run-${file.run.toString().padStart(2, "0")}`);

      const baseName = parts.join("_");
      const ext = options.outputFormat === "edf" ? "edf" : "vhdr";

      structure.push({
        path: `${eegPath}/${baseName}_eeg.${ext}`,
        type: "file",
      });
      structure.push({ path: `${eegPath}/${baseName}_eeg.json`, type: "file" });
      structure.push({
        path: `${eegPath}/${baseName}_channels.tsv`,
        type: "file",
      });
    }

    return structure;
  }, [files, options.outputFormat]);

  const handleSelectFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Output Folder",
    });

    if (selected && typeof selected === "string") {
      const sanitizedName = metadata.name
        .replace(/[^a-zA-Z0-9-_]/g, "_")
        .toLowerCase();
      setOutputPath(`${selected}/${sanitizedName}`);
    }
  };

  if (result) {
    return (
      <div className="space-y-4">
        {result.success ? (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Export Complete</AlertTitle>
            <AlertDescription>
              Successfully exported {result.filesExported} file
              {result.filesExported !== 1 ? "s" : ""} to BIDS format.
              <br />
              <span className="font-mono text-sm">{result.datasetPath}</span>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Export Failed</AlertTitle>
            <AlertDescription>{result.error}</AlertDescription>
          </Alert>
        )}

        {result.warnings.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Warnings</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside">
                {result.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Review & Export</h3>
        <p className="text-sm text-muted-foreground">
          Review your settings and choose where to save the dataset
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Output Location</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-2 border rounded-md bg-muted font-mono text-sm truncate">
            {outputPath || "No location selected"}
          </div>
          <Button onClick={handleSelectFolder}>
            <FolderOpen className="h-4 w-4 mr-2" />
            Choose Folder
          </Button>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Validation Errors</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside">
              {validationErrors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Dataset Name:</span>
          <span className="ml-2 font-medium">{metadata.name}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Files:</span>
          <span className="ml-2 font-medium">{files.length}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Format:</span>
          <span className="ml-2 font-medium">
            {options.outputFormat === "edf" ? "EDF" : "BrainVision"}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">License:</span>
          <span className="ml-2 font-medium">{metadata.license}</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Folder Structure Preview</label>
        <div className="border rounded-md p-3 bg-muted/50 max-h-[200px] overflow-auto">
          <div className="font-mono text-xs space-y-0.5">
            <div className="flex items-center gap-1">
              <Folder className="h-3 w-3 text-yellow-500" />
              <span>
                {metadata.name.replace(/[^a-zA-Z0-9-_]/g, "_").toLowerCase()}/
              </span>
            </div>
            {folderStructure.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-1"
                style={{ paddingLeft: `${item.path.split("/").length * 12}px` }}
              >
                {item.type === "folder" ? (
                  <Folder className="h-3 w-3 text-yellow-500" />
                ) : item.path.endsWith(".json") ||
                  item.path.endsWith(".tsv") ? (
                  <FileText className="h-3 w-3 text-blue-500" />
                ) : (
                  <FileAudio className="h-3 w-3 text-green-500" />
                )}
                <span>{item.path.split("/").pop()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
