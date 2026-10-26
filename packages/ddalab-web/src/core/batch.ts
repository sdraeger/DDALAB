// Batch runs: the DDA settings of one moment on every recording of an opened folder, one recording after another. A
// batch's record (IndexedDB, beside the analyses) holds what it asked and how each recording ended; each result is an
// ordinary analysis record that names its batch. The combined export's manifest has the fields and the key order
// `ddalab batch --output-dir` prints, with each result as a bundle under the recording's path.
import type { DdaForm } from "../features/analysis/validate";
import { database } from "../store/recent";
import type { AnalysisRecord } from "./history";
import type { RecordingInfo } from "./types";

/**
 * Which channels each recording runs on. "signal": the analysis channels BIDS channels.tsv does not mark bad, all of
 * them without one (the rule of `ddalab batch`). "labels": the channels of these labels.
 */
export type ChannelRule = { kind: "signal" } | { kind: "labels"; labels: string[] };
/** "range" is clipped to each recording. */
export type IntervalRule = { kind: "whole" } | { kind: "range"; startS: number; endS: number };

/** How one recording of a batch ended. */
export interface BatchResult {
  /** The recording's path from the opened folder's parent, as the folder tree gives it. */
  path: string;
  status: "ok" | "error";
  /** The analysis record of its result. */
  resultId?: string;
  /** The recording's own warnings, then the batch's (labels it lacks, an interval clipped). */
  warnings: string[];
  error?: string;
}

export interface BatchRecord {
  id: string;
  createdAt: number;
  finishedAt?: number;
  /** The opened folder's name, the first segment of every path; empty for several dropped folders. */
  root: string;
  /** The opened folder's handle where the browser gives one (Chromium): Resume reads the folder through it. */
  handle?: FileSystemDirectoryHandle;
  form: DdaForm;
  channels: ChannelRule;
  interval: IntervalRule;
  /** Every recording of the batch, in the order it runs them. */
  paths: string[];
  /** The recordings done, in the order they ran. */
  results: BatchResult[];
  /** "interrupted": the page closed while it ran; "cancelled": Cancel stopped it. */
  status: "running" | "complete" | "cancelled" | "interrupted";
}

/** A tree row's batch mark. */
export type Mark = "running" | "done" | "failed";

/** The batch of this page as the Folder section and the command bar show it. */
export interface BatchProgress {
  id: string;
  root: string;
  total: number;
  /** The file name of the recording running. */
  name: string;
  marks: Record<string, Mark>;
  status: BatchRecord["status"];
}

const seconds = (s: number) => `${Number(s.toFixed(3))} s`;

const isBad = (status: string | null) => status?.toLowerCase() === "bad";

/**
 * The analysis channels (indices into `analysis`, ascending) `rule` picks in a recording, with the warnings it
 * leaves, or why it runs on none. Messages are the CLI's where it has one.
 */
export function channelsFor(
  rule: ChannelRule,
  info: RecordingInfo,
  analysis: number[],
): { channels: number[]; warnings: string[]; error?: string } {
  const name = info.input_files[0];
  if (rule.kind === "signal") {
    const channels = analysis.flatMap((c, i) => (isBad(info.channels[c].bids_status) ? [] : [i]));
    const error = channels.length === 0 ? `${name} has no analysis channel to run on` : undefined;
    return { channels, warnings: [], error };
  }
  const labels = analysis.map((c) => info.channels[c].label);
  const missing = rule.labels.filter((label) => !labels.includes(label));
  const channels = labels.flatMap((label, i) => (rule.labels.includes(label) ? [i] : []));
  if (channels.length === 0)
    return { channels, warnings: [], error: `${name} has none of the channels ${rule.labels.join(", ")}` };
  return { channels, warnings: missing.length > 0 ? [`Without channels ${missing.join(", ")}`] : [] };
}

/** The interval of `rule` in a recording, in seconds, clipped to it with a warning, or why it is outside. */
export function intervalFor(
  rule: IntervalRule,
  info: RecordingInfo,
): { startS: number; endS: number; warnings: string[]; error?: string } {
  const duration = info.duration_s;
  if (rule.kind === "whole") return { startS: 0, endS: duration, warnings: [] };
  const first = Math.max(0, Math.floor(rule.startS * info.sample_rate_hz + 1e-6));
  if (first >= info.sample_count) {
    const error = `start sample ${first} is not inside the ${info.sample_count} samples of ${info.input_files[0]}`;
    return { startS: rule.startS, endS: rule.endS, warnings: [], error };
  }
  if (rule.endS <= duration) return { startS: rule.startS, endS: rule.endS, warnings: [] };
  const clipped = `The interval ends at the recording's end, ${seconds(duration)}, before ${seconds(rule.endS)}`;
  return { startS: rule.startS, endS: duration, warnings: [clipped] };
}

/**
 * The folder of each recording's bundle in the combined export: its path below the opened folder with `.dda` in place
 * of the extension, as `ddalab run --bundle` is named; a second recording of the same stem keeps its extension.
 */
export function bundleDirs(paths: string[], root: string): Map<string, string> {
  const dirs = new Map<string, string>();
  const taken = new Set<string>();
  for (const path of paths) {
    const below = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
    const stem = `${below.replace(/\.[^./]*$/, "")}.dda`;
    const dir = taken.has(stem) ? `${below}.dda` : stem;
    taken.add(dir);
    dirs.set(path, dir);
  }
  return dirs;
}

/**
 * The manifest `ddalab batch --bids-dir <folder> --output-dir` prints for the results of `batch` so far, its keys in
 * the CLI's order (serde_json's, alphabetical). A recording's paths start with the folder's name, as the CLI's do; its
 * output is its bundle's folder in the export. A result deleted from the history since is an error.
 */
export function batchManifest(batch: BatchRecord, analyses: AnalysisRecord[]) {
  const dirs = bundleDirs(batch.paths, batch.root);
  const results = batch.results.map(({ path, status, resultId, warnings, error }) => {
    const record = analyses.find((a) => a.id === resultId && a.status === "complete");
    if (status === "error" || !record?.manifest) {
      const reason = status === "error" ? error : "The result was deleted from the history";
      return {
        error: reason,
        inputPath: path,
        outputPath: null,
        resolvedDatasetPath: path,
        status: "error",
        warnings,
      };
    }
    const rows = Object.fromEntries(record.manifest.variants.map((v) => [v.id, v.row_labels.length]));
    const result = { rows, windows: record.plan?.windows ?? 0 };
    return {
      inputPath: path,
      outputPath: dirs.get(path),
      resolvedDatasetPath: path,
      result,
      status,
      warnings,
    };
  });
  const failed = results.filter((r) => r.status === "error").length;
  return {
    failed,
    matchedFiles: batch.paths.length,
    processedFiles: results.length,
    results,
    succeeded: results.length - failed,
    withWarnings: results.filter((r) => r.warnings.length > 0).length,
  };
}

/** The settings of a batch in a line: variants, windowing, model, channels and interval. */
export function settingsLine({
  form,
  channels,
  interval,
}: Pick<BatchRecord, "form" | "channels" | "interval">) {
  const model = form.expert ? `delays ${form.delays}, terms ${form.modelTerms}` : "standard model";
  const picked = channels.kind === "signal" ? "signal channels" : `channels ${channels.labels.join(" ")}`;
  const span =
    interval.kind === "whole"
      ? "whole recordings"
      : `${seconds(interval.startS)} to ${seconds(interval.endS)}`;
  return `${form.variants.join(" ")}, window ${form.windowLength}, step ${form.windowStep}, ${model}, ${picked}, ${span}`;
}

/** How a batch stands: "12 of 12", "10 of 12, 2 failed", "Interrupted after 5 of 12". */
export function batchOutcome({ status, paths, results }: BatchRecord): string {
  const failed = results.filter((r) => r.status === "error").length;
  const of = `${results.length} of ${paths.length}`;
  if (status === "running") return `Running, ${of} done`;
  if (status === "interrupted") return `Interrupted after ${of}`;
  if (status === "cancelled") return `Cancelled after ${of}`;
  return failed > 0 ? `${results.length - failed} of ${paths.length}, ${failed} failed` : of;
}

/** Newest first. */
export async function listBatches(): Promise<BatchRecord[]> {
  const all: BatchRecord[] = await (await database()).getAll("batches");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveBatch(batch: BatchRecord): Promise<void> {
  await (await database()).put("batches", batch);
}
