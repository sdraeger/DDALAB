// The analyses run in this browser, in IndexedDB: what was asked of which recording and how the run ended. A result's
// files are in OPFS under the same id (resultStore.ts).
import { database } from "../store/recent";
import type { DDARequest } from "./types";

export interface AnalysisRecord {
  id: string;
  fingerprint: string;
  fileName: string;
  request: DDARequest;
  createdAt: number;
  /** "interrupted": a reload or a crash ended the run, and its files were deleted. */
  status: "running" | "complete" | "interrupted" | "failed";
  error?: string;
}

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
