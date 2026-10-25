// The engine as UI code sees it: the only module UI code imports for engine access. Workers do the work; this
// module owns them. A wasm instance that trapped (a Rust panic) is unusable: the engine replaces its worker and
// opens the recordings it held again, and the request that trapped fails with the trap's message.
import type {
  HashReply,
  HashRequest,
  IoEvent,
  IoReply,
  IoRequest,
  IoResults,
  ScanState,
  Tile,
} from "./protocol";
import { isScanned } from "./sources";
import type { SyntheticSpec } from "./synthetic";
import { TileCache } from "./tileCache";
import type { Annotation, EngineVersion, RecordingInfo } from "./types";

export type RecordingInput =
  | { kind: "files"; files: File[]; primary: string }
  | { kind: "url"; files: { name: string; url: string; size: number }[]; primary: string }
  | { kind: "synthetic"; spec: SyntheticSpec }; // dev and e2e builds only

export interface Engine {
  version(): Promise<EngineVersion>;
  open(input: RecordingInput): Promise<{ id: string; info: RecordingInfo; fingerprint: string }>;
  close(id: string): void;
  /**
   * Tile `index` of pyramid `level`, or `null` while the scan has not reached it and building it from the file
   * would take too long. The bytes are shared with the tile cache: copy them to transfer them.
   */
  tile(id: string, level: number, index: number): Promise<Tile | null>;
  /** All display channels, row-major. */
  raw(id: string, row0: number, rows: number): Promise<Float32Array>;
  /** The full annotation list; it reads every record of an EDF+: ask in the background. */
  annotations(id: string): Promise<{ annotations: Annotation[]; warnings: string[] }>;
  /** Calls `listener` with the current scan state at once and with every change after. */
  onScan(id: string, listener: (state: ScanState) => void): () => void;
  // `run` and `resultTile` arrive with the DDA worker pool (Tasks 6 and 7).
}

/** What dev and e2e builds add for tests. */
export type DevEngine = Engine & { trap(): Promise<void>; quota(bytes: number): Promise<void> };

interface Tracked {
  fingerprint: string;
  scan: ScanState;
  sha256: Record<string, string>;
  hashError?: string;
}

const stateOf = ({ scan, sha256, hashError }: Tracked): ScanState => ({
  ...scan,
  sha256,
  error: scan.error ?? hashError,
});

export function createEngine(): Engine {
  /** What a replacement worker opens again, under the ids the UI already holds. */
  const held = new Map<string, RecordingInput>();
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const listeners = new Map<string, Set<(state: ScanState) => void>>();
  /** The scan as the IO worker reports it and the hashes the hash worker has finished, by recording. */
  const scans = new Map<string, Tracked>();
  // Tiles by recording content: another recording of the same file shares them, and they outlive a close.
  const cache = new TileCache();
  const requested = new Map<string, Promise<Tile | null>>();
  let worker: Worker;
  let hasher: Worker | undefined;
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

  function publish(id: string) {
    const entry = scans.get(id);
    if (entry) for (const listener of listeners.get(id) ?? []) listener(stateOf(entry));
  }

  /** Started with the first recording: it loads a second copy of the wasm. */
  function hash(request: HashRequest) {
    if (!hasher) {
      hasher = new Worker(new URL("../workers/hash.worker.ts", import.meta.url), { type: "module" });
      hasher.onmessage = ({ data }: MessageEvent<HashReply>) => {
        const entry = scans.get(data.id);
        if (!entry) return;
        if ("error" in data) entry.hashError = `The hash could not be computed: ${data.error}`;
        else entry.sha256 = { ...entry.sha256, [data.name]: data.sha256 };
        publish(data.id);
      };
    }
    hasher.postMessage(request);
  }

  function start() {
    const started = new Worker(new URL("../workers/io.worker.ts", import.meta.url), { type: "module" });
    worker = started;
    started.onmessage = ({ data }: MessageEvent<IoReply | IoEvent>) => {
      if ("event" in data) {
        const entry = scans.get(data.id);
        if (entry) entry.scan = data.state;
        publish(data.id);
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
      const { info, fingerprint } = opened;
      scans.set(id, { fingerprint, scan: { scannedRows: 0, totalRows: info.sample_count }, sha256: {} });
      if (isScanned(input)) hash({ type: "hash", id, fingerprint, input, names: info.input_files });
      return { id, ...opened };
    },
    close(id) {
      held.delete(id);
      listeners.delete(id);
      scans.delete(id);
      hasher?.postMessage({ type: "cancel", id } satisfies HashRequest);
      call({ type: "close", id }).catch(() => {});
    },
    tile(id, level, index) {
      const entry = scans.get(id);
      if (!entry) return Promise.reject(new Error(`no open recording ${id}`));
      const key = `${entry.fingerprint}/${level}/${index}`;
      const hit = cache.get(key);
      if (hit) return Promise.resolve(hit);
      const inFlight =
        requested.get(key) ??
        call({ type: "tile", id, level, index })
          .then((tile) => {
            if (tile) cache.set(key, tile); // `null` changes as the scan goes on
            return tile;
          })
          .finally(() => requested.delete(key));
      requested.set(key, inFlight);
      return inFlight;
    },
    raw: (id, row0, rows) => call({ type: "raw", id, row0, rows }),
    annotations: (id) => call({ type: "annotations", id }),
    onScan(id, listener) {
      const set = listeners.get(id) ?? new Set();
      listeners.set(id, set.add(listener));
      const entry = scans.get(id);
      if (entry) listener(stateOf(entry));
      return () => void set.delete(listener);
    },
  };
  return import.meta.env.DEV || import.meta.env.MODE === "e2e"
    ? Object.assign(engine, {
        trap: () => call({ type: "trap" }),
        quota: (bytes: number) => call({ type: "quota", bytes }),
      })
    : engine;
}
