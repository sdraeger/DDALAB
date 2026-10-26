// Running a batch (core/batch.ts): the settings of one moment on each recording of an opened folder, one recording at
// a time through the engine and its worker pool, which keeps memory to one run's. A recording opens in the engine
// without a tab and closes after its run; its result becomes an ordinary analysis record. A failure is recorded and
// the batch goes on; Cancel stops the run in progress, which leaves no files, and keeps the results before it. The
// batch holds a Web Lock while it runs: one found running whose lock is free was cut short by a reload or a crash.
import { makeZip } from "client-zip";
import {
  type BatchProgress,
  type BatchRecord,
  type BatchResult,
  batchManifest,
  bundleDirs,
  channelsFor,
  intervalFor,
  listBatches,
  type Mark,
  saveBatch,
} from "../core/batch";
import { bundleFiles } from "../core/exporters";
import type { FolderRecording } from "../core/folder";
import { type AnalysisRecord, recordedManifest, saveAnalysis } from "../core/history";
import type { AnalysisHandle } from "../core/scheduler";
import { buildFileSet } from "../core/sources";
import { validateRequest } from "../features/analysis/validate";
import { useStore } from "../store/store";
import { leaving, refreshAnalyses, variants } from "./analyses";
import { saveStream } from "./download";
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
          : { path, status: "error" as const, warnings: [], error: "The recording is not in the folder" };
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
  } finally {
    running = false;
    current = undefined;
    useStore.setState((s) => ({ run: s.run?.recordingId === "" ? null : s.run }));
  }
}

/**
 * Runs `batch`'s request on one recording: how it ended, or `undefined` when Cancel or the page closing stopped it.
 * Refusals are the single run's: the settings checked as the run bar checks them, then the core's plan.
 */
async function runOne(batch: BatchRecord, recording: FolderRecording): Promise<BatchResult | undefined> {
  const { path } = recording;
  const warnings: string[] = [];
  const fail = (error: string): BatchResult => ({ path, status: "error", warnings, error });
  // The run state keeps a single run from starting beside the batch; no tab owns it.
  const zero = { blocksDone: 0, blocks: 0, windowsDone: 0, windows: 0, etaS: null };
  useStore.setState({ run: { id: "", recordingId: "", status: "running", progress: zero } });
  if (recording.missing) return fail(recording.missing);
  const set = buildFileSet(recording.files, path);
  if (!("primary" in set)) return fail("error" in set ? set.error : `${path} is one of several recordings`);
  let opened: Awaited<ReturnType<typeof engine.open>>;
  try {
    opened = await engine.open({ kind: "files", files: set.files, primary: set.primary });
  } catch (error) {
    return fail(messageOf(error));
  }
  try {
    const { info } = opened;
    warnings.push(...info.warnings);
    const channels = channelsFor(batch.channels, info, opened.analysis_channels);
    const interval = intervalFor(batch.interval, info);
    warnings.push(...channels.warnings, ...interval.warnings);
    const refusal = channels.error ?? interval.error;
    if (refusal) return fail(refusal);
    const chosen = (await variants).filter((v) => batch.form.variants.includes(v.abbreviation));
    const { startS, endS } = interval;
    const draft = { ...batch.form, variants: chosen, channels: channels.channels, startS, endS };
    const { request, errors } = validateRequest(draft, info);
    if (!request) return fail(Object.values(errors)[0]);
    if (cancelled) return undefined;
    const createdAt = Date.now();
    const handle = await engine.run(opened.id, request);
    current = handle;
    if (cancelled) handle.cancel();
    handle.progress((p) => useStore.setState((s) => ({ run: s.run && { ...s.run, progress: p } })));
    try {
      await handle.done;
    } catch (error) {
      if (aborted(error) || leaving) return undefined;
      return fail(messageOf(error));
    } finally {
      current = undefined;
    }
    const record: AnalysisRecord = {
      id: handle.id,
      fingerprint: opened.fingerprint,
      fileName: info.input_files[0],
      request,
      plan: handle.plan,
      createdAt,
      finishedAt: Date.now(),
      status: "complete",
      manifest: recordedManifest(await engine.resultManifest(handle.id)),
      batch: batch.id,
    };
    await saveAnalysis(record).catch(() => {});
    await refreshAnalyses();
    return { path, status: "ok", resultId: record.id, warnings };
  } catch (error) {
    return fail(messageOf(error));
  } finally {
    // A recording a tab holds (opened before, or since) stays open.
    if (!opened.duplicate && !useStore.getState().recordings[opened.id]) engine.close(opened.id);
  }
}

/**
 * Saves the combined export of `batch`: its manifest as `batch.json` and each result's bundle under its recording's
 * path, streamed into one zip. Call it first thing in a click (download.ts `saveStream`).
 */
export function exportBatch(batch: BatchRecord) {
  return saveStream(`${batch.root || "batch"}.batch.zip`, async () => {
    const { analyses } = useStore.getState();
    const manifest = batchManifest(batch, analyses);
    const dirs = bundleDirs(batch.paths, batch.root);
    async function* files() {
      yield { name: "batch.json", input: `${JSON.stringify(manifest, null, 2)}\n` };
      for (const result of manifest.results) {
        const id = batch.results.find((r) => r.path === result.inputPath)?.resultId;
        if (result.status === "ok" && id) yield* await bundleFiles(id, `${dirs.get(result.inputPath)}/`);
      }
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
