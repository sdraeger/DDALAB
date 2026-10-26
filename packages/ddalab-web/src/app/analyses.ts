// Running DDA: the run of a request on an open recording, its progress in the store and its history record.
import {
  type AnalysisRecord,
  deleteAnalysis,
  listAnalyses,
  recordedManifest,
  saveAnalysis,
} from "../core/history";
import type { AnalysisHandle } from "../core/scheduler";
import type { DDARequest, VariantInfo } from "../core/types";
import { loads, manifestKey, manifestOf, preloadPanel } from "../features/results/loads";
import { openResult, type RunState, showResult, useStore } from "../store/store";
import { engine } from "./recordings";
import { inTransition } from "./viewTransition";

/** The engine's version and metadata, asked for once. */
export const engineVersion = engine.version();

/** The variants the core offers, from its metadata; none when the engine did not start (the library says why). */
export const variants = engineVersion.then(
  (version) => version.variants,
  (): VariantInfo[] => [],
);

/** The run in progress; one at a time, as each takes every core but one. */
let current: AnalysisHandle | undefined;
/** Cancel was pressed before the engine had started the run. */
let cancelling = false;

const setRun = (change: Partial<RunState>) =>
  useStore.setState((s) => ({ run: s.run && { ...s.run, ...change } }));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The history is a convenience: without IndexedDB (some private windows) runs still work and it stays empty.
export async function refreshAnalyses() {
  useStore.setState({ analyses: await listAnalyses().catch(() => []) });
}

/**
 * On startup: the results a reload or a crash cut short lose their files, and their records say so. A record still
 * running whose files are already gone was cut short too; one whose files remain is a run in another tab.
 */
export async function sweepAnalyses() {
  const listed = listAnalyses().catch(() => []);
  const directory = navigator.storage
    .getDirectory()
    .then((root) => root.getDirectoryHandle("results", { create: true }))
    .catch(() => undefined);
  const swept = new Set(await engine.sweepInterrupted().catch(() => []));
  const results = await directory;
  const kept = (id: string) =>
    results?.getDirectoryHandle(id).then(
      () => true,
      () => false,
    ) ?? false;
  let rewritten = false;
  for (const record of await listed) {
    if (record.status === "running" && (swept.has(record.id) || !(await kept(record.id)))) {
      await saveAnalysis({ ...record, status: "interrupted" }).catch(() => {});
      rewritten = true;
    }
  }
  if (rewritten) await refreshAnalyses();
  else useStore.setState({ analyses: await listed });
}

/**
 * The page is going away: a run that ends now was interrupted, which the next start records. `beforeunload` counts
 * too, as Firefox stops the workers of a reloading page before `pagehide`. A page restored from the back-forward
 * cache is back.
 */
let leaving = false;
for (const type of ["beforeunload", "pagehide", "pageshow"]) {
  addEventListener(type, () => {
    leaving = type !== "pageshow";
  });
}

export async function startRun(recordingId: string, request: DDARequest) {
  const { recordings, run } = useStore.getState();
  const recording = recordings[recordingId];
  if (run?.status === "running" || !recording) return;
  preloadPanel(); // the result shows once the run completes
  const progress = { blocksDone: 0, blocks: 0, windowsDone: 0, windows: 0, etaS: null };
  useStore.setState({ run: { id: "", recordingId, status: "running", progress } });
  cancelling = false;
  let handle: AnalysisHandle;
  try {
    handle = await engine.run(recordingId, request);
  } catch (error) {
    return setRun({ status: "failed", error: messageOf(error) });
  }
  current = handle;
  const outcome = handle.done.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (cancelling) handle.cancel();
  setRun({ id: handle.id });
  handle.progress((p) => setRun({ progress: p }));
  const record: AnalysisRecord = {
    id: handle.id,
    fingerprint: recording.fingerprint,
    fileName: recording.info.input_files[0],
    inputFiles: recording.info.input_files,
    request,
    plan: handle.plan,
    createdAt: Date.now(),
    status: "running",
  };
  await saveAnalysis(record).catch(() => {});
  await refreshAnalyses();
  const error = await outcome;
  current = undefined;
  if (leaving) return;
  if (error === undefined) {
    const finishedAt = Date.now();
    // The result view takes this read from the cache. A failed read is left for the view to make again.
    const document = await manifestOf(record.id);
    if ("error" in document) loads.delete(manifestKey(record.id));
    const manifest = "ok" in document ? recordedManifest(document.ok) : undefined;
    const complete: AnalysisRecord = { ...record, status: "complete", manifest, finishedAt };
    // The result shows before its record is saved and the history listed again.
    useStore.setState((s) => ({ analyses: s.analyses.map((a) => (a.id === record.id ? complete : a)) }));
    setRun({ status: "complete" });
    // Without its manifest, the interval comes from the request, in samples of the recording. Not in a view
    // transition: the run ends whatever the pointer is doing, the panel fades in by itself, and the result often lands
    // in a tab that is not shown (store.ts showResult).
    const rate = recording.info.sample_rate_hz;
    const asked = { t0: request.time_range.start / rate, t1: request.time_range.end / rate };
    showResult(complete, manifest ? undefined : asked);
    await saveAnalysis(complete).catch(() => {});
  } else if (error instanceof DOMException && error.name === "AbortError") {
    await deleteAnalysis(record.id).catch(() => {});
    setRun({ status: "cancelled" });
  } else {
    await saveAnalysis({ ...record, status: "failed", error: messageOf(error) }).catch(() => {});
    setRun({ status: "failed", error: messageOf(error) });
  }
  await refreshAnalyses();
}

/** Deletes a result that is not running: its files, then its record. */
export async function deleteResult(id: string) {
  await engine.deleteResult(id);
  await deleteAnalysis(id);
  if (useStore.getState().activeResultId === id) inTransition(() => openResult(null));
  await refreshAnalyses();
}

export function cancelRun() {
  cancelling = true;
  current?.cancel();
}
