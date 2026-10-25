// Running DDA: the run of a request on an open recording, its progress in the store and its history record.
import { deleteAnalysis, listAnalyses, saveAnalysis } from "../core/history";
import type { AnalysisHandle } from "../core/scheduler";
import type { DDARequest } from "../core/types";
import { type RunState, showResult, useStore } from "../store/store";
import { engine } from "./recordings";

/** The variants the core offers, from its metadata. */
export const variants = engine.version().then((version) => version.variants);

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
  const swept = new Set(await engine.sweepInterrupted().catch(() => []));
  const results = await navigator.storage
    .getDirectory()
    .then((root) => root.getDirectoryHandle("results", { create: true }))
    .catch(() => undefined);
  const kept = (id: string) =>
    results?.getDirectoryHandle(id).then(
      () => true,
      () => false,
    ) ?? false;
  for (const record of await listAnalyses().catch(() => [])) {
    if (record.status === "running" && (swept.has(record.id) || !(await kept(record.id)))) {
      await saveAnalysis({ ...record, status: "interrupted" }).catch(() => {});
    }
  }
  await refreshAnalyses();
}

/**
 * The page is going away: a run that ends now was interrupted, which the next start records. Firefox stops the
 * workers of a reloading page before `pagehide`, so `beforeunload` counts too.
 */
let leaving = false;
for (const type of ["beforeunload", "pagehide"]) {
  addEventListener(type, () => {
    leaving = true;
  });
}

export async function startRun(recordingId: string, request: DDARequest) {
  const { recordings, run } = useStore.getState();
  const recording = recordings[recordingId];
  if (run?.status === "running" || !recording) return;
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
  const record = {
    id: handle.id,
    fingerprint: recording.fingerprint,
    fileName: recording.info.input_files[0],
    request,
    createdAt: Date.now(),
    status: "running" as const,
  };
  await saveAnalysis(record).catch(() => {});
  await refreshAnalyses();
  const error = await outcome;
  current = undefined;
  if (leaving) return;
  if (error === undefined) {
    await saveAnalysis({ ...record, status: "complete" }).catch(() => {});
    setRun({ status: "complete" });
    showResult(record.id, record.fingerprint);
  } else if (error instanceof DOMException && error.name === "AbortError") {
    await deleteAnalysis(record.id).catch(() => {});
    setRun({ status: "cancelled" });
  } else {
    await saveAnalysis({ ...record, status: "failed", error: messageOf(error) }).catch(() => {});
    setRun({ status: "failed", error: messageOf(error) });
  }
  await refreshAnalyses();
}

export function cancelRun() {
  cancelling = true;
  current?.cancel();
}
