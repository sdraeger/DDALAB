"use client";

import React, { useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { BIDSFileAssignment } from "@/types/bidsExport";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, FileAudio } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface FileSelectionStepProps {
  files: BIDSFileAssignment[];
  addFiles: (files: BIDSFileAssignment[]) => void;
  removeFile: (sourcePath: string) => void;
  initialFiles?: string[];
}

export function FileSelectionStep({
  files,
  addFiles,
  removeFile,
  initialFiles = [],
}: FileSelectionStepProps) {
  // Load initial files on mount
  useEffect(() => {
    if (initialFiles.length > 0 && files.length === 0) {
      loadFileInfo(initialFiles);
    }
  }, [initialFiles]);

  const loadFileInfo = useCallback(
    async (paths: string[]) => {
      const newFiles: BIDSFileAssignment[] = [];

      for (const path of paths) {
        // Skip if already added
        if (files.some((f) => f.sourcePath === path)) continue;

        try {
          // Get file info from backend
          const info = await invoke<{
            duration: number;
            channelCount: number;
            sampleRate: number;
          }>("get_file_info", { filePath: path });

          const fileName = path.split(/[/\\]/).pop() || path;

          newFiles.push({
            sourcePath: path,
            fileName,
            subjectId: "01",
            task: "rest",
            sessionId: undefined,
            run: undefined,
            duration: info.duration,
            channelCount: info.channelCount,
          });
        } catch (error) {
          // If we can't get info, still add the file with minimal info
          const fileName = path.split(/[/\\]/).pop() || path;
          newFiles.push({
            sourcePath: path,
            fileName,
            subjectId: "01",
            task: "rest",
            sessionId: undefined,
            run: undefined,
          });
        }
      }

      if (newFiles.length > 0) {
        addFiles(newFiles);
      }
    },
    [files, addFiles],
  );

  const handleAddFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "EEG Files",
          extensions: ["edf", "vhdr", "set", "fif", "nwb"],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
    });

    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await loadFileInfo(paths);
    }
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Select Files</h3>
          <p className="text-sm text-muted-foreground">
            Add the EEG files you want to include in the BIDS dataset
          </p>
        </div>
        <Button onClick={handleAddFiles}>
          <Plus className="h-4 w-4 mr-2" />
          Add Files
        </Button>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-lg">
          <FileAudio className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">No files selected</p>
          <Button variant="secondary" onClick={handleAddFiles}>
            <Plus className="h-4 w-4 mr-2" />
            Add Files
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File Name</TableHead>
                <TableHead className="w-24">Duration</TableHead>
                <TableHead className="w-24">Channels</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.sourcePath}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileAudio className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate max-w-[300px]">
                        {file.fileName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{formatDuration(file.duration)}</TableCell>
                  <TableCell>{file.channelCount ?? "—"}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFile(file.sourcePath)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {files.length} file{files.length !== 1 ? "s" : ""} selected
      </p>
    </div>
  );
}
