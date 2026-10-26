// Batch runs: the DDA settings of one moment on every recording of an opened folder, one recording after another. A
// batch's record (IndexedDB, beside the analyses) holds what it asked and how each recording ended; each result is an
// ordinary analysis record that names its batch. The combined export is what `ddalab batch --bids-dir <folder>
// --output-dir dda` writes: its stdout as `batch_manifest.json` and each result document as `dda/<stem>.<sha8>.dda.json`.
// In a BIDS dataset the batch takes the recordings the CLI finds there (`discover_bids_recordings`).
import type { DdaForm } from "../features/analysis/validate";
import { changed, database } from "../store/recent";
import type { RecordingInput } from "./engine";
import type { AnalysisRecord } from "./history";
import type { RecordingInfo } from "./types";

/**
 * Which channels each recording runs on. "signal": the analysis channels BIDS channels.tsv does not mark bad, all of
 * them without one (the rule of `ddalab batch`). "labels": the channels of these labels.
 */
export type ChannelRule = { kind: "signal" } | { kind: "labels"; labels: string[] };
/** "range" is clipped to each recording. */
export type IntervalRule = { kind: "whole" } | { kind: "range"; startS: number; endS: number };

/** A recording a batch runs, by its path: the files of an opened folder, or the input that streams it (OpenNeuro). */
export type BatchInput = { path: string; files: File[] } | { path: string; input: RecordingInput };

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
  /**
   * A batch on a folder of an OpenNeuro snapshot (`root` is the dataset's id): the snapshot and the folder walked, its
   * path from the id and its tree, which Resume walks again.
   */
  remote?: { tag: string; path: string; tree?: string };
  form: DdaForm;
  channels: ChannelRule;
  interval: IntervalRule;
  /** Every recording of the batch, in the order it runs them. */
  paths: string[];
  /** The recordings done, in the order they ran. */
  results: BatchResult[];
  /** "interrupted": the page closed while it ran; "cancelled" (the stored spelling): Cancel stopped it. */
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
 * The analysis channels (indices into `analysis`, ascending) `rule` picks in the recording at `path`, with the
 * warnings it leaves, or why it runs on none. Messages are the CLI's where it has one.
 */
export function channelsFor(
  rule: ChannelRule,
  info: RecordingInfo,
  analysis: number[],
  path: string,
): { channels: number[]; warnings: string[]; error?: string } {
  if (rule.kind === "signal") {
    const channels = analysis.flatMap((c, i) => (isBad(info.channels[c].bids_status) ? [] : [i]));
    const error = channels.length === 0 ? `${path} has no analysis channel to run on` : undefined;
    return { channels, warnings: [], error };
  }
  const labels = analysis.map((c) => info.channels[c].label);
  const missing = rule.labels.filter((label) => !labels.includes(label));
  const channels = labels.flatMap((label, i) => (rule.labels.includes(label) ? [i] : []));
  if (channels.length === 0)
    return { channels, warnings: [], error: `${path} has none of the channels ${rule.labels.join(", ")}` };
  return { channels, warnings: missing.length > 0 ? [`Without channels ${missing.join(", ")}`] : [] };
}

/** The interval of `rule` in the recording at `path`, in seconds, clipped to it with a warning, or why it is outside. */
export function intervalFor(
  rule: IntervalRule,
  info: RecordingInfo,
  path: string,
): { startS: number; endS: number; warnings: string[]; error?: string } {
  const duration = info.duration_s;
  if (rule.kind === "whole") return { startS: 0, endS: duration, warnings: [] };
  const first = Math.max(0, Math.floor(rule.startS * info.sample_rate_hz + 1e-6));
  if (first >= info.sample_count) {
    const error = `start sample ${first} is not inside the ${info.sample_count} samples of ${path}`;
    return { startS: rule.startS, endS: rule.endS, warnings: [], error };
  }
  if (rule.endS <= duration) return { startS: rule.startS, endS: rule.endS, warnings: [] };
  const clipped = `The interval ends at the recording's end, ${seconds(duration)}, before ${seconds(rule.endS)}`;
  return { startS: rule.startS, endS: duration, warnings: [clipped] };
}

/** Entries `discover_bids_recordings` (dda-rs io/bids.rs) skips at any depth, and the deepest folder it reads. */
export const SKIPPED = ["code", "derivatives", "sourcedata"];
export const MAX_DEPTH = 6;

/** A path's file name before its last dot, as Rust's `Path::file_stem`, and after it. */
function stemOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? { stem: name.slice(0, dot), extension: name.slice(dot + 1) }
    : { stem: name, extension: "" };
}

/** Rust's order of paths: component by component. */
// shortcut: compares UTF-16 units where Rust compares bytes, which differ only between an astral character and U+E000
// to U+FFFF in one component; compare UTF-8 bytes if a dataset ever names files so.
export const byComponents = (a: string, b: string) => {
  const [x, y] = [a.split("/"), b.split("/")];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length - y.length;
};

/**
 * The recordings `ddalab batch --bids-dir` finds in the dataset `root`, in its order: `*_eeg` and `*_ieeg` stems of
 * `.edf`, `.bdf` and `.vhdr` files at most 6 folders down, none under a hidden entry, code, derivatives or sourcedata.
 */
export function discovered<T extends { path: string }>(recordings: T[], root: string): T[] {
  const kept = recordings.filter(({ path }) => {
    const parts = path.slice(root.length + 1).split("/");
    const { stem, extension } = stemOf(path);
    return (
      parts.length - 1 <= MAX_DEPTH &&
      !parts.some((part) => part.startsWith(".") || SKIPPED.includes(part)) &&
      /_i?eeg$/.test(stem) &&
      ["edf", "bdf", "vhdr"].includes(extension.toLowerCase())
    );
  });
  return kept.sort((a, b) => byComponents(a.path, b.path));
}

/**
 * `<stem>.<sha8>.dda.json`, the name `output_name` of dda-rs commands/batch.rs gives a result document: the file stem
 * with every character other than letters, digits, `-`, `_` and `.` replaced by `_` and `.` and `_` trimmed from its
 * ends ("dataset" when nothing is left), and the first 8 hex digits of a SHA-1. The CLI hashes the file's absolute
 * path, which a page never learns: this hashes `path`, the dataset-relative one.
 */
export async function outputName(path: string): Promise<string> {
  const safe = [...stemOf(path).stem]
    .map((c) => (/[\p{Alphabetic}\p{N}]/u.test(c) || "-_.".includes(c) ? c : "_"))
    .join("")
    .replace(/^[._]+|[._]+$/g, "");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(path)));
  const sha8 = Array.from(digest.slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${safe || "dataset"}.${sha8}.dda.json`;
}

/** The output name of each of `paths`. */
export const outputNames = async (paths: string[]) =>
  new Map(await Promise.all(paths.map(async (path) => [path, await outputName(path)] as const)));

/** A recording's row of the manifest. */
export interface ManifestResult {
  error?: string;
  inputPath: string;
  outputPath: string | null;
  resolvedDatasetPath: string;
  result?: { rows: Record<string, number>; windows: number };
  status: "ok" | "error";
  warnings: string[];
}

/**
 * The manifest `ddalab batch --bids-dir <folder> --output-dir dda` prints for the results of `batch` so far, its keys
 * in the CLI's order (serde_json's, alphabetical). Paths start with the folder's name, as the CLI's do; a result's
 * output is `dda/` and its name in `names` (`outputNames`). A result deleted from the history since is an error.
 */
export function batchManifest(batch: BatchRecord, analyses: AnalysisRecord[], names: Map<string, string>) {
  const results = batch.results.map(({ path, status, resultId, warnings, error }): ManifestResult => {
    const record = analyses.find((a) => a.id === resultId && a.status === "complete");
    if (status === "error" || !record?.manifest) {
      const reason = status === "error" ? error : "The result was deleted from the history";
      return {
        error: reason,
        inputPath: path,
        outputPath: null,
        resolvedDatasetPath: path,
        status: "error",
        warnings: [...warnings],
      };
    }
    const counts = record.manifest.variants.map((v) => [v.id, v.row_labels.length] as const);
    const rows = Object.fromEntries(counts.sort(([a], [b]) => (a < b ? -1 : 1)));
    return {
      inputPath: path,
      outputPath: `dda/${names.get(path)}`,
      resolvedDatasetPath: path,
      result: { rows, windows: record.plan?.windows ?? 0 },
      status,
      // A copy: the export may add to it, and the batch's own list belongs to the store.
      warnings: [...warnings],
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

/**
 * Turns `row` of `manifest` into a bundle's row: its output the document's name without `.json`, a warning that says
 * why (`reason`), and the count of rows with warnings again.
 */
export function asBundle(manifest: ReturnType<typeof batchManifest>, row: ManifestResult, reason: string) {
  row.outputPath = row.outputPath?.replace(/\.json$/, "") ?? null;
  row.warnings = [
    ...row.warnings,
    `The result document is too large for the browser; this is its bundle. ${reason}`,
  ];
  manifest.withWarnings = manifest.results.filter((r) => r.warnings.length > 0).length;
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
  if (status === "cancelled") return `Canceled after ${of}`;
  return failed > 0 ? `${results.length - failed} of ${paths.length}, ${failed} failed` : of;
}

/** Newest first. */
export async function listBatches(): Promise<BatchRecord[]> {
  const all: BatchRecord[] = await (await database()).getAll("batches");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveBatch(batch: BatchRecord): Promise<void> {
  await (await database()).put("batches", batch);
  changed("batches");
}
