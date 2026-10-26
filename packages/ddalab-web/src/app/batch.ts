// Running a batch (core/batch.ts): the settings of one moment on each recording of an opened folder, one recording at
// a time through the engine and its worker pool, which keeps memory to one run's. A recording opens in the engine
// without a tab or an overview scan and closes after its run; its result becomes an ordinary analysis record. A
// failure is recorded in the CLI's words and the batch goes on; Cancel stops the run in progress, which leaves no
// files, and keeps the results before it. The batch holds a Web Lock while it runs: one found running whose lock is
// free was cut short by a reload or a crash.
import { makeZip } from "client-zip";
import {
  asBundle,
  type BatchProgress,
  type BatchRecord,
  type BatchResult,
  batchManifest,
  channelsFor,
  intervalFor,
  listBatches,
  type Mark,
  outputNames,
  saveBatch,
} from "../core/batch";
import { bundleFiles } from "../core/exporters";
import type { FolderRecording } from "../core/folder";
import { type AnalysisRecord, persistStorage, recordedManifest, saveAnalysis } from "../core/history";
import type { AnalysisHandle } from "../core/scheduler";
import { buildFileSet } from "../core/sources";
import { validateRequest } from "../features/analysis/validate";
import { useStore } from "../store/store";
import { leaving, refreshAnalyses, variants } from "./analyses";
import { download } from "./download";
import { engine } from "./recordings";

/** The run of the batch in progress, and whether Cancel was pressed. */
let current: AnalysisHandle | undefined;
let cancelled = false;
let running = false;

const lockOf = (id: string) => `ddalab-batch:${id}`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const aborted = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

async function keep(batch: BatchRecord) {
  useStore.setState((s) => ({ batches: [batch, ...s.batches.filter((b) => b.id !== batch.id)] }));
  await saveBatch(batch).catch(() => {});
}

const setProgress = (change: Partial<BatchProgress>) =>
  useStore.setState((s) => ({ batch: s.batch && { ...s.batch, ...change } }));

/** On startup: the batches, a running one whose lock is free marked interrupted. */
export async function sweepBatches() {
  const batches = await listBatches().catch(() => []);
  const swept = await Promise.all(
    batches.map(async (batch) => {
      if (batch.status !== "running") return batch;
      const free = await navigator.locks.request(
        lockOf(batch.id),
        { ifAvailable: true },
        (lock) => lock !== null,
      );
      if (!free) return batch;
      const interrupted = { ...batch, status: "interrupted" as const };
      await saveBatch(interrupted).catch(() => {});
      return interrupted;
    }),
  );
  useStore.setState({ batches: swept });
}

/** Lists the batches again: another window changed them. */
export async function refreshBatches() {
  useStore.setState({ batches: await listBatches().catch(() => useStore.getState().batches) });
}

/** Why a batch cannot start now, or `undefined`. */
export function busy(): string | undefined {
  if (running) return "A batch is running.";
  if (useStore.getState().run?.status === "running") return "Another recording's run is in progress.";
  return undefined;
}

export function cancelBatch() {
  cancelled = true;
  current?.cancel();
}

/** Starts a batch of `recordings` with the settings of this moment. */
export function startBatch(
  settings: Pick<BatchRecord, "channels" | "interval" | "root" | "handle">,
  recordings: FolderRecording[],
) {
  const batch: BatchRecord = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    form: useStore.getState().ddaForm,
    ...settings,
    paths: recordings.map((r) => r.path),
    results: [],
    status: "running",
  };
  return runBatch(batch, recordings);
}

/** Runs the recordings of batch `id` it has not run, from `recordings` (the folder read again). */
export function resumeBatch(id: string, recordings: FolderRecording[], handle?: FileSystemDirectoryHandle) {
  const batch = useStore.getState().batches.find((b) => b.id === id);
  if (!batch || batch.status === "running" || batch.status === "complete") return;
  return runBatch(
    { ...batch, handle: handle ?? batch.handle, status: "running", finishedAt: undefined },
    recordings,
  );
}

async function runBatch(start: BatchRecord, recordings: FolderRecording[]) {
  if (busy()) return;
  running = true;
  cancelled = false;
  let batch = start;
  const marks: Record<string, Mark> = Object.fromEntries(
    batch.results.map((r) => [r.path, r.status === "ok" ? "done" : "failed"]),
  );
  const progress = {
    id: batch.id,
    root: batch.root,
    total: batch.paths.length,
    name: "",
    status: batch.status,
  };
  useStore.setState({ batch: { ...progress, marks: { ...marks } } });
  try {
    await navigator.locks.request(lockOf(batch.id), async () => {
      await keep(batch);
      const byPath = new Map(recordings.map((r) => [r.path, r]));
      const done = new Set(batch.results.map((r) => r.path));
      for (const path of batch.paths.filter((p) => !done.has(p))) {
        if (cancelled || leaving) break;
        const recording = byPath.get(path);
        marks[path] = "running";
        setProgress({ name: path.slice(path.lastIndexOf("/") + 1), marks: { ...marks } });
        const result = recording
          ? await runOne(batch, recording)
          : { path, status: "error" as const, warnings: [], error: `Input file not found: ${path}` };
        if (!result) break;
        marks[path] = result.status === "ok" ? "done" : "failed";
        batch = { ...batch, results: [...batch.results, result] };
        setProgress({ marks: { ...marks } });
        await keep(batch);
      }
      if (leaving) return;
      for (const [path, mark] of Object.entries(marks)) if (mark === "running") delete marks[path];
      const all = batch.results.length === batch.paths.length;
      batch = { ...batch, status: all ? "complete" : "cancelled", finishedAt: Date.now() };
      setProgress({ status: batch.status, marks: { ...marks } });
      await keep(batch);
    });
  } catch {
    // A failure outside a recording's run (the lock, the storage) ends the batch as cut short: Resume takes it up.
    batch = { ...batch, status: "interrupted" };
    setProgress({ status: batch.status });
    await keep(batch);
  } finally {
    running = false;
    current = undefined;
    useStore.setState((s) => ({ run: s.run?.recordingId === "" ? null : s.run }));
  }
}

/**
 * Runs `batch`'s request on one recording: how it ended, or `undefined` when Cancel or the page closing stopped it.
 * Refusals are the single run's: the settings checked as the run bar checks them, then the core's plan. A failure reads
 * as `ddalab batch` words it: an open or a plan refused after `<path>: `, and a failure after the open followed by the
 * recording's warnings, each after a space, with no warnings of its own.
 */
async function runOne(batch: BatchRecord, recording: FolderRecording): Promise<BatchResult | undefined> {
  const { path } = recording;
  const fail = (error: string): BatchResult => ({ path, status: "error", warnings: [], error });
  // The run state keeps a single run from starting beside the batch; no tab owns it.
  const zero = { blocksDone: 0, blocks: 0, windowsDone: 0, windows: 0, etaS: null };
  useStore.setState({ run: { id: "", recordingId: "", status: "running", progress: zero } });
  const set = buildFileSet(recording.files, path);
  if (!("primary" in set))
    return fail(`${path}: ${"error" in set ? set.error : "one of several recordings"}`);
  let opened: Awaited<ReturnType<typeof engine.open>>;
  try {
    opened = await engine.open({ kind: "files", files: set.files, primary: set.primary }, { scan: false });
  } catch (error) {
    return fail(`${path}: ${messageOf(error)}`);
  }
  const { info } = opened;
  const failOpened = (error: string) => fail(info.warnings.reduce((text, w) => `${text} ${w}`, error));
  try {
    const channels = channelsFor(batch.channels, info, opened.analysis_channels, path);
    const interval = intervalFor(batch.interval, info, path);
    const refusal = channels.error ?? interval.error;
    if (refusal) return failOpened(refusal);
    const chosen = (await variants).filter((v) => batch.form.variants.includes(v.abbreviation));
    const { startS, endS } = interval;
    const draft = { ...batch.form, variants: chosen, channels: channels.channels, startS, endS };
    const checked = validateRequest(draft, info);
    if (!checked.request) return failOpened(Object.values(checked.errors)[0]);
    // The document names the file by its path in the dataset, as `ddalab batch --bids-dir <folder>` run beside it does.
    const request = { ...checked.request, file_path: path };
    if (cancelled) return undefined;
    const createdAt = Date.now();
    let handle: AnalysisHandle;
    try {
      handle = await engine.run(opened.id, request);
    } catch (error) {
      return failOpened(`${path}: ${messageOf(error)}`);
    }
    current = handle;
    if (cancelled) handle.cancel();
    handle.progress((p) => useStore.setState((s) => ({ run: s.run && { ...s.run, progress: p } })));
    try {
      await handle.done;
    } catch (error) {
      if (aborted(error) || leaving) return undefined;
      return failOpened(messageOf(error));
    } finally {
      current = undefined;
    }
    const record: AnalysisRecord = {
      id: handle.id,
      fingerprint: opened.fingerprint,
      fileName: info.input_files[0],
      inputFiles: info.input_files,
      request,
      plan: handle.plan,
      createdAt,
      finishedAt: Date.now(),
      status: "complete",
      manifest: recordedManifest(await engine.resultManifest(handle.id)),
      batch: batch.id,
    };
    await saveAnalysis(record).catch(() => {});
    void persistStorage();
    await refreshAnalyses();
    return {
      path,
      status: "ok",
      resultId: record.id,
      warnings: [...info.warnings, ...channels.warnings, ...interval.warnings],
    };
  } catch (error) {
    return failOpened(messageOf(error));
  } finally {
    // A recording a tab holds (opened before, or since) stays open.
    if (!opened.duplicate && !useStore.getState().recordings[opened.id]) engine.close(opened.id);
  }
}

/** The document export's refusal of a result of more text than a tab should hold (exporters.ts `refuseAbove`). */
const TOO_LARGE = /^The JSON document would be about/;

/**
 * Saves the combined export of `batch` as one zip, streamed: what `ddalab batch --bids-dir <folder> --output-dir dda`
 * writes, its manifest as `batch_manifest.json` and each result document at its `outputPath`. A result whose document
 * the export refuses as too large goes in as its bundle, at that path without `.json`, with a warning. Call it first
 * thing in a click: the Save dialog needs the click (download.ts). `onMake` hears when the zip starts, after the dialog.
 */
export function exportBatch(batch: BatchRecord, onMake: () => void) {
  return download(`${batch.root || "batch"}.batch.zip`, async () => {
    onMake();
    const manifest = batchManifest(batch, useStore.getState().analyses, await outputNames(batch.paths));
    async function* files() {
      for (const result of manifest.results) {
        const id = batch.results.find((r) => r.path === result.inputPath)?.resultId;
        if (!id || !result.outputPath) continue;
        try {
          yield { name: result.outputPath, input: await engine.exportDocument(id) };
        } catch (error) {
          if (!TOO_LARGE.test(messageOf(error))) throw error;
          asBundle(manifest, result, messageOf(error));
          yield* await bundleFiles(id, `${result.outputPath}/`);
        }
      }
      // Last, as the CLI prints it: a bundle in place of a document changes its row.
      yield { name: "batch_manifest.json", input: `${JSON.stringify(manifest, null, 2)}\n` };
    }
    return makeZip(files());
  });
}

/** Read access to the folder of `batch` through its handle, asked for if it lapsed; `undefined` without. */
export async function reattach(batch: BatchRecord): Promise<FileSystemDirectoryHandle | undefined> {
  const handle = batch.handle as
    | (FileSystemDirectoryHandle & {
        queryPermission(options: { mode: "read" }): Promise<PermissionState>;
        requestPermission(options: { mode: "read" }): Promise<PermissionState>;
      })
    | undefined;
  if (!handle) return undefined;
  try {
    const granted = (await handle.queryPermission({ mode: "read" })) === "granted";
    return granted || (await handle.requestPermission({ mode: "read" })) === "granted" ? handle : undefined;
  } catch {
    return undefined;
  }
}
