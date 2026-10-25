// The engine as UI code sees it: the only module UI code imports for engine access. Workers do the work; this
// module owns them. A wasm instance that trapped (a Rust panic) is unusable: the engine replaces its worker and
// opens the recordings it held again, and the request that trapped fails with the trap's message. Replacements
// that never get a reply (the worker script does not load) stop after a few, with the engine unavailable.
// A DDA run gets a pool of workers of its own, which end with it: a trap or a failed worker fails the run.
import type {
  Annotations,
  AnnotationsReply,
  AnnotationsRequest,
  DdaReply,
  DdaRequest,
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
import { type AnalysisHandle, runAnalysis } from "./scheduler";
import { isScanned } from "./sources";
import type { SyntheticSpec } from "./synthetic";
import { TileCache } from "./tileCache";
import type {
  Block,
  BlockChunks,
  DDARequest,
  EngineVersion,
  ManifestExtras,
  RecordingInfo,
  ResultDocument,
} from "./types";

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
  /**
   * What a run of `request` takes: its windows, its blocks and the workers it runs on. Rejects with the core's
   * message when the core refuses the request.
   */
  plan(id: string, request: DDARequest): Promise<{ windows: number; blocks: number; workers: number }>;
  /**
   * Runs `request` on a pool of DDA workers; each block's arrays are written to OPFS as it finishes (resultStore.ts).
   * `done` resolves once the manifest is written and the result is complete; a failed or cancelled run leaves no
   * files. The result id is the handle's id.
   */
  run(id: string, request: DDARequest): Promise<AnalysisHandle>;
  /** Deletes the files of results a reload or a crash left unfinished; their ids. */
  sweepInterrupted(): Promise<string[]>;
  // `resultTile` arrives with the result views (Task 7).
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
export class EngineStopped extends Error {}

const cancelled = () => new DOMException("The run was cancelled", "AbortError");

/** Bytes of a text recording per DDA worker: each parses the whole file. */
const TEXT_BYTES_PER_WORKER = 512 * 2 ** 20;

/** The workers of a run: every core but one, and one per 512 MiB of a text recording. */
function poolSize(input: RecordingInput, info: RecordingInfo): number {
  const cores = Math.max(1, navigator.hardwareConcurrency - 1);
  if (input.kind === "synthetic" || (info.format !== "CSV" && info.format !== "ASCII")) return cores;
  const bytes = input.files.find((file) => file.name === input.primary)?.size ?? 0;
  return Math.min(cores, Math.max(1, Math.floor(TEXT_BYTES_PER_WORKER / bytes)));
}

/** The DDA workers of one run, started as blocks need them; `stop` ends them and what they were asked. */
function ddaPool(input: RecordingInput, request: DDARequest) {
  const idle: Worker[] = [];
  const asked = new Map<Worker, (error: Error) => void>();
  let stopped = false;
  const drop = (worker: Worker) => {
    worker.terminate();
    asked.delete(worker);
  };
  const ask = <T>(task: { block: Block } | { extras: ManifestExtras }) =>
    new Promise<T>((resolve, reject) => {
      if (stopped) return reject(cancelled());
      const worker =
        idle.pop() ?? new Worker(new URL("../workers/dda.worker.ts", import.meta.url), { type: "module" });
      asked.set(worker, reject);
      worker.onmessage = ({ data }: MessageEvent<DdaReply>) => {
        if ("error" in data) {
          reject(new Error(data.error));
          if (data.trapped) return drop(worker);
        } else resolve(data.ok as T);
        asked.delete(worker);
        idle.push(worker);
      };
      worker.onerror = (event) => {
        reject(new Error(event.message || "A DDA worker stopped"));
        drop(worker);
      };
      worker.postMessage({ input, request, ...task } satisfies DdaRequest);
    });
  return {
    block: (block: Block) => ask<BlockChunks>({ block }),
    manifest: (extras: ManifestExtras) => ask<ResultDocument>({ extras }),
    stop() {
      stopped = true;
      for (const [worker, reject] of asked) {
        reject(cancelled());
        worker.terminate();
      }
      for (const worker of idle) worker.terminate();
      asked.clear();
      idle.length = 0;
    },
  };
}

interface Tracked {
  fingerprint: string;
  info: RecordingInfo;
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

  /** Called when a recording's hashes change or it closes. */
  const hashWaits = new Set<() => void>();

  /** The worker answers in the order it was asked. `transfer` moves buffers of the request to it. */
  const call = <T extends IoRequest["type"]>(
    request: Extract<IoRequest, { type: T }>,
    restoring = false,
    transfer: Transferable[] = [],
  ) =>
    new Promise<IoResults[T]>((resolve, reject) => {
      if (unavailable) return reject(unavailable);
      pending.set(++serial, { resolve: resolve as (value: unknown) => void, reject, request, restoring });
      worker.postMessage({ n: serial, ...request }, transfer);
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
    for (const wait of [...hashWaits]) wait();
  }

  /** The SHA-256 of each input file once all are known, the hash worker failed, or the recording closed. */
  function inputHashes(id: string) {
    return new Promise<Record<string, string>>((resolve) => {
      const entry = scans.get(id);
      const input = held.get(id);
      if (!entry || !input || !isScanned(input)) return resolve(entry?.sha256 ?? {});
      const check = () => {
        const waiting = !entry.hashError && entry.info.input_files.some((name) => !entry.sha256[name]);
        if (waiting && scans.get(id) === entry) return;
        hashWaits.delete(check);
        resolve(entry.sha256);
      };
      hashWaits.add(check);
      check();
    });
  }

  /** The recording `id` as it was opened. */
  function opened(id: string) {
    const input = held.get(id);
    const entry = scans.get(id);
    if (!input || !entry) throw new Error(`no open recording ${id}`);
    return { input, info: entry.info };
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
      scans.set(id, {
        fingerprint,
        info,
        scan: { scannedRows: 0, totalRows: info.sample_count },
        sha256: {},
      });
      if (isScanned(input)) hash({ type: "hash", id, input, names: info.input_files });
      return { id, ...opened };
    },
    close(id) {
      held.delete(id);
      listeners.delete(id);
      scans.delete(id);
      for (const wait of [...hashWaits]) wait();
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
    async plan(id, request) {
      const { input, info } = opened(id);
      const workers = poolSize(input, info);
      const plan = await call({ type: "plan", id, request, workers });
      return { windows: plan.windows, blocks: plan.blocks.length, workers };
    },
    async run(id, request) {
      const { input, info } = opened(id);
      const workers = poolSize(input, info);
      const plan = await call({ type: "plan", id, request, workers });
      const resultId = crypto.randomUUID();
      const discard = () => call({ type: "discardResult", resultId }).catch(() => {});
      await call({ type: "createResult", resultId, layout: plan.layout }).catch(async (error) => {
        await discard();
        throw error;
      });
      const pool = ddaPool(input, request);
      const scheduled = runAnalysis({
        id: resultId,
        plan,
        workers,
        dispatch: pool.block,
        write: (chunks) =>
          call(
            { type: "writeChunks", resultId, chunks },
            false,
            chunks.chunks.map((chunk) => chunk.bytes),
          ),
      });
      const done = scheduled.done
        .then(async () => {
          const extras: ManifestExtras = {
            id: resultId,
            created_at_iso: new Date().toISOString(),
            input_sha256: await inputHashes(id),
            windows: plan.windows,
          };
          await call({ type: "finishResult", resultId, manifest: await pool.manifest(extras) });
          return { resultId };
        })
        .catch(async (error: Error) => {
          await discard();
          throw error;
        })
        .finally(() => pool.stop());
      return {
        ...scheduled,
        done,
        cancel() {
          pool.stop();
          scheduled.cancel();
        },
      };
    },
    sweepInterrupted: () => call({ type: "sweepResults" }),
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
