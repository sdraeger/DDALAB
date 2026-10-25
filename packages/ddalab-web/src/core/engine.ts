// The engine as UI code sees it: the only module UI code imports for engine access. Workers do the work; this
// module owns them. A wasm instance that trapped (a Rust panic) is unusable: the engine replaces its worker and
// opens the recordings it held again, and the request that trapped fails with the trap's message.
import type { IoEvent, IoReply, IoRequest, IoResults, ScanState, Tile } from "./protocol";
import type { SyntheticSpec } from "./synthetic";
import type { EngineVersion, RecordingInfo } from "./types";

export type RecordingInput =
  | { kind: "files"; files: File[]; primary: string }
  | { kind: "url"; files: { name: string; url: string; size: number }[]; primary: string }
  | { kind: "synthetic"; spec: SyntheticSpec }; // dev and e2e builds only

export interface Engine {
  version(): Promise<EngineVersion>;
  open(input: RecordingInput): Promise<{ id: string; info: RecordingInfo; fingerprint: string }>;
  close(id: string): void;
  /** `null` while the region is not scanned. */
  tile(id: string, level: number, index: number): Promise<Tile | null>;
  /** All display channels, row-major. */
  raw(id: string, row0: number, rows: number): Promise<Float32Array>;
  onScan(id: string, listener: (state: ScanState) => void): () => void;
  // `run` and `resultTile` arrive with the DDA worker pool (Tasks 6 and 7).
}

export function createEngine(): Engine {
  /** What a replacement worker opens again, under the ids the UI already holds. */
  const held = new Map<string, RecordingInput>();
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const listeners = new Map<string, Set<(state: ScanState) => void>>();
  let worker: Worker;
  let serial = 0;

  /** The worker answers in the order it was asked. */
  const call = <T extends IoRequest["type"]>(request: Extract<IoRequest, { type: T }>) =>
    new Promise<IoResults[T]>((resolve, reject) => {
      pending.set(++serial, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ n: serial, ...request });
    });

  function replace(failed: Worker, message: string, culprit?: number) {
    if (failed !== worker) return;
    failed.terminate();
    for (const [n, { reject }] of pending) {
      reject(
        new Error(
          n === culprit || culprit === undefined
            ? `The engine stopped unexpectedly: ${message}`
            : "The engine restarted; try again",
        ),
      );
    }
    pending.clear();
    start();
    // These come before any later request. One that fails (its file is gone) is forgotten.
    for (const [id, input] of held) call({ type: "open", id, input }).catch(() => held.delete(id));
  }

  function start() {
    const started = new Worker(new URL("../workers/io.worker.ts", import.meta.url), { type: "module" });
    worker = started;
    started.onmessage = ({ data }: MessageEvent<IoReply | IoEvent>) => {
      if ("event" in data) {
        for (const listener of listeners.get(data.id) ?? []) listener(data.state);
        return;
      }
      if ("error" in data && data.trapped) return replace(started, data.error, data.n);
      const request = pending.get(data.n);
      pending.delete(data.n);
      if (!request) return;
      if ("error" in data) request.reject(new Error(data.error));
      else request.resolve(data.ok);
    };
    started.onerror = (event) => replace(started, event.message || "The engine stopped");
  }
  start();

  const engine: Engine = {
    version: () => call({ type: "version" }),
    async open(input) {
      const id = crypto.randomUUID();
      const opened = await call({ type: "open", id, input });
      held.set(id, input);
      return { id, ...opened };
    },
    close(id) {
      held.delete(id);
      listeners.delete(id);
      call({ type: "close", id }).catch(() => {});
    },
    // The scan (Task 3) fills the tile cache; until then nothing is scanned.
    tile: () => Promise.resolve(null),
    raw: (id, row0, rows) => call({ type: "raw", id, row0, rows }),
    onScan(id, listener) {
      const set = listeners.get(id) ?? new Set();
      listeners.set(id, set.add(listener));
      return () => void set.delete(listener);
    },
  };
  return import.meta.env.DEV || import.meta.env.MODE === "e2e"
    ? Object.assign(engine, { trap: () => call({ type: "trap" }) })
    : engine;
}
