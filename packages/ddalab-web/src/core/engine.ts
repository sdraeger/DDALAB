// The engine as UI code sees it: the only module UI code imports for engine access. Workers do the work; this
// module owns them. A wasm instance that trapped (a Rust panic) is unusable: the engine replaces its worker and
// opens the recordings it held again, and the request that trapped fails with the trap's message. Replacements
// that never get a reply (the worker script does not load) stop after a few, with the engine unavailable.
import type {
  Annotations,
  AnnotationsReply,
  AnnotationsRequest,
  HashReply,
  HashRequest,
  IoEvent,
  IoReply,
  IoRequest,
  IoResults,
  MemoryReply,
  MemoryRequest,
  ScanState,
  Tile,
} from "./protocol";
import { isScanned } from "./sources";
import type { SyntheticSpec } from "./synthetic";
import { TileCache } from "./tileCache";
import type { EngineVersion, RecordingInfo } from "./types";

export type RecordingInput =
  | { kind: "files"; files: File[]; primary: string }
  | { kind: "url"; files: { name: string; url: string; size: number }[]; primary: string }
  | { kind: "synthetic"; spec: SyntheticSpec }; // dev and e2e builds only

export interface Engine {
  version(): Promise<EngineVersion>;
  /**
   * `analysis_channels` are the indices into `info.channels` of the display channels: `raw` returns these and DDA
   * requests index this list. A recording already open (same fingerprint) is not opened again: its id comes back.
   */
  open(input: RecordingInput): Promise<{
    id: string;
    info: RecordingInfo;
    fingerprint: string;
    analysis_channels: number[];
  }>;
  close(id: string): void;
  /**
   * Tile `index` of pyramid `level`, or `null` while the scan has not reached it and building it from the file
   * would take too long. The bytes are shared with the tile cache: copy them to transfer them.
   */
  tile(id: string, level: number, index: number): Promise<Tile | null>;
  /** All display channels, row-major. */
  raw(id: string, row0: number, rows: number): Promise<Float32Array>;
  /**
   * The full annotation list. An EDF+ takes a pass over the whole file, which a worker of its own makes: the
   * answer comes late and nothing else waits for it. Remote recordings above 1 GiB are not read (a warning says so).
   */
  annotations(id: string): Promise<Annotations>;
  /** Calls `listener` with the current scan state at once and with every change after. */
  onScan(id: string, listener: (state: ScanState) => void): () => void;
  // `run` and `resultTile` arrive with the DDA worker pool (Tasks 6 and 7).
}

/** What dev and e2e builds add for tests. */
export type DevEngine = Engine & {
  trap(): Promise<void>;
  quota(bytes: number): Promise<void>;
  /** Bytes of wasm memory of each running worker. */
  wasmBytes(): Promise<Record<"io" | "hash" | "annotations", number>>;
};

/** Replacements allowed in a row, none of which got a reply. */
const MAX_REPLACEMENTS = 3;

/** The engine, not the request, failed: the request may be sent again once the engine has a worker. */
class EngineStopped extends Error {}

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
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      request: IoRequest;
      /** Sent by `replace` itself (reopening and the probe): the next `replace` sends its own again. */
      restoring: boolean;
    }
  >();
  const listeners = new Map<string, Set<(state: ScanState) => void>>();
  /** The scan as the IO worker reports it and the hashes the hash worker has finished, by recording. */
  const scans = new Map<string, Tracked>();
  // Tiles by recording content: another recording of the same file shares them, and they outlive a close.
  const cache = new TileCache();
  const requested = new Map<string, Promise<Tile | null>>();
  let worker: Worker;
  let hasher: Worker | undefined;
  let annotator: Worker | undefined;
  const annotating = new Map<number, { resolve(found: Annotations): void; reject(error: Error): void }>();
  let serial = 0;
  /** Workers that have sent a message: their script loaded. */
  const loaded = new WeakSet<Worker>();
  /** Replacements since a worker last answered a request. */
  let failures = 0;
  /** Set when the engine gave up: every request fails with it. */
  let unavailable: Error | undefined;

  /** The worker answers in the order it was asked. */
  const call = <T extends IoRequest["type"]>(request: Extract<IoRequest, { type: T }>, restoring = false) =>
    new Promise<IoResults[T]>((resolve, reject) => {
      if (unavailable) return reject(unavailable);
      pending.set(++serial, { resolve: resolve as (value: unknown) => void, reject, request, restoring });
      worker.postMessage({ n: serial, ...request });
    });

  function replace(failed: Worker, message: string, culprit?: number) {
    if (failed !== worker) return;
    failed.terminate();
    const waiting = [...pending];
    pending.clear();
    if (++failures > MAX_REPLACEMENTS) {
      unavailable = new EngineStopped(`The engine could not start: ${message}`);
      for (const [, { reject }] of waiting) reject(unavailable);
      return;
    }
    start();
    // These come before any later request. One that fails for its own reason (its file is gone) is forgotten and
    // reported; one cut short by another restart is opened again by that restart.
    for (const [id, input] of held) {
      call({ type: "open", id, input }, true).catch((error: Error) => {
        if (error instanceof EngineStopped) return;
        held.delete(id);
        const entry = scans.get(id);
        if (!entry) return;
        entry.scan = {
          ...entry.scan,
          error: `The recording could not be opened again after the engine restarted: ${error.message}`,
        };
        publish(id);
      });
    }
    // Answers from the replacement are what end the count of failed replacements.
    call({ type: "version" }, true).catch(() => {});
    for (const [n, entry] of waiting) {
      if (entry.restoring) {
        // The calls above reopen every held recording once: these would open them a second time.
        entry.reject(new EngineStopped("The engine restarted; try again"));
      } else if (!loaded.has(failed)) {
        // The worker never ran it: the replacement does.
        pending.set(n, entry);
        worker.postMessage({ n, ...entry.request });
      } else {
        const own = n === culprit || culprit === undefined;
        entry.reject(
          new EngineStopped(
            own ? `The engine stopped unexpectedly: ${message}` : "The engine restarted; try again",
          ),
        );
      }
    }
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

  /** Started with the first request: it loads a third copy of the wasm. A trapped or failed worker is replaced. */
  function annotate(input: RecordingInput) {
    if (!annotator) {
      const started = new Worker(new URL("../workers/annotations.worker.ts", import.meta.url), {
        type: "module",
      });
      annotator = started;
      const lose = (error: Error) => {
        if (annotator !== started) return;
        annotator = undefined;
        started.terminate();
        for (const { reject } of annotating.values()) reject(error);
        annotating.clear();
      };
      started.onmessage = ({ data }: MessageEvent<AnnotationsReply>) => {
        const waiting = annotating.get(data.n);
        annotating.delete(data.n);
        if ("error" in data) {
          waiting?.reject(new Error(data.error));
          if (data.trapped) lose(new Error("The annotation reader stopped; try again"));
        } else waiting?.resolve(data.ok);
      };
      started.onerror = (event) => lose(new Error(event.message || "The annotation reader stopped"));
    }
    return new Promise<Annotations>((resolve, reject) => {
      annotating.set(++serial, { resolve, reject });
      annotator?.postMessage({ n: serial, input } satisfies AnnotationsRequest);
    });
  }

  function start() {
    const started = new Worker(new URL("../workers/io.worker.ts", import.meta.url), { type: "module" });
    worker = started;
    started.onmessage = ({ data }: MessageEvent<IoReply | IoEvent>) => {
      loaded.add(started);
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
      else {
        failures = 0;
        request.resolve(data.ok);
      }
    };
    started.onerror = (event) => replace(started, event.message || "The engine stopped");
  }
  start();

  const engine: Engine = {
    version: () => call({ type: "version" }),
    async open(input) {
      const id = crypto.randomUUID();
      const { duplicateOf, ...opened } = await call({ type: "open", id, input });
      if (duplicateOf) return { id: duplicateOf, ...opened };
      held.set(id, input);
      const { info, fingerprint } = opened;
      scans.set(id, { fingerprint, scan: { scannedRows: 0, totalRows: info.sample_count }, sha256: {} });
      if (isScanned(input)) hash({ type: "hash", id, input, names: info.input_files });
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
    annotations(id) {
      const input = held.get(id);
      if (!input) return Promise.reject(new Error(`no open recording ${id}`));
      if (!isScanned(input)) {
        return Promise.resolve({
          annotations: [],
          warnings: ["Annotations are not read from recordings above 1 GiB opened from a URL."],
        });
      }
      return annotate(input);
    },
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
        async wasmBytes() {
          const ask = (target: Worker | undefined) =>
            new Promise<number>((resolve) => {
              if (!target) return resolve(0);
              const answer = ({ data }: MessageEvent) => {
                if (!(data && typeof data === "object" && "wasmBytes" in data)) return;
                target.removeEventListener("message", answer);
                resolve((data as MemoryReply).wasmBytes);
              };
              target.addEventListener("message", answer);
              target.postMessage({ type: "memory" } satisfies MemoryRequest);
            });
          const [io, hash, annotations] = await Promise.all([
            call({ type: "memory" }),
            ask(hasher),
            ask(annotator),
          ]);
          return { io, hash, annotations };
        },
      })
    : engine;
}
