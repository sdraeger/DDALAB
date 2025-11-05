/**
 * React hook for detecting BIDS datasets in directories
 */

import { useState, useCallback } from "react";
import {
  isBIDSDataset,
  readDatasetDescription,
  getDatasetSummary,
} from "@/services/bids";
import type { DirectoryEntry, BIDSInfo } from "@/types/bids";

export function useBIDSDetection() {
  const [checking, setChecking] = useState(false);

  /**
   * Check if a directory is a BIDS dataset and enrich it with metadata
   */
  const checkDirectory = useCallback(
    async (dir: DirectoryEntry): Promise<DirectoryEntry> => {
      try {
        const isBIDS = await isBIDSDataset(dir.path);

        if (!isBIDS) {
          return { ...dir, isBIDS: false };
        }

        // Get BIDS metadata
        const [description, summary] = await Promise.all([
          readDatasetDescription(dir.path),
          getDatasetSummary(dir.path),
        ]);

        const bidsInfo: BIDSInfo = {
          datasetName: description?.Name,
          bidsVersion: description?.BIDSVersion,
          subjectCount: summary.subjectCount,
          sessionCount: summary.sessionCount,
          runCount: summary.runCount,
          modalities: Array.from(summary.modalities),
          tasks: Array.from(summary.tasks),
        };

        return {
          ...dir,
          isBIDS: true,
          bidsInfo,
        };
      } catch (error) {
        console.error(`Error checking BIDS for ${dir.name}:`, error);
        return { ...dir, isBIDS: false };
      }
    },
    [],
  );

  /**
   * Check multiple directories in parallel
   */
  const checkDirectories = useCallback(
    async (
      dirs: Array<{ name: string; path: string }>,
    ): Promise<DirectoryEntry[]> => {
      setChecking(true);
      try {
        const results = await Promise.all(
          dirs.map((dir) => checkDirectory(dir)),
        );
        return results;
      } finally {
        setChecking(false);
      }
    },
    [checkDirectory],
  );

  return {
    checkDirectory,
    checkDirectories,
    checking,
  };
}
