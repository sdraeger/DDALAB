// The analyses run in this browser, in IndexedDB: what was asked of which recording and how the run ended. A result's
// files are in OPFS under the same id (resultStore.ts).
import { database } from "../store/recent";
import type { DDARequest, ResultDocument } from "./types";

export interface AnalysisRecord {
  id: string;
  /** The recording's fingerprint; empty for an imported result, whose manifest names its files by SHA-256. */
  fingerprint: string;
  fileName: string;
  request: DDARequest;
  /**
   * The result's manifest.json once it is complete, without its window centres: a long run has a million of them, and
   * they stay in OPFS.
   */
  manifest?: Omit<ResultDocument, "window_centers_seconds">;
  /** What the run took; an imported result knows only its windows. */
  plan?: { windows: number; blocks?: number; workers?: number };
  createdAt: number;
  finishedAt?: number;
  /** "interrupted": a reload or a crash ended the run, and its files were deleted. */
  status: "running" | "complete" | "interrupted" | "failed";
  error?: string;
  /** The batch that ran it (core/batch.ts); the history lists it under the batch. */
  batch?: string;
}

/** A manifest as its record keeps it. */
export const recordedManifest = ({ window_centers_seconds: _, ...manifest }: ResultDocument) => manifest;

/** What the history calls a result: its variants on its file. */
export const resultName = (record: AnalysisRecord) =>
  `${record.request.algorithm_selection.enabled_variants.join(" ")} on ${record.fileName}`;

/** Newest first. */
export async function listAnalyses(): Promise<AnalysisRecord[]> {
  const all: AnalysisRecord[] = await (await database()).getAll("analyses");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveAnalysis(record: AnalysisRecord): Promise<void> {
  await (await database()).put("analyses", record);
}

export async function deleteAnalysis(id: string): Promise<void> {
  await (await database()).delete("analyses", id);
}
