// The IO worker: one wasm instance that opens recordings, reads their bytes synchronously (`host_read`), serves raw
// rows and tiles and scans each recording in the background. Requests run one at a time in the order they arrive;
// the scan runs between them.
import { type HostRead, instantiateCore } from "../core/abi";
import wasmUrl from "../core/ddalab.wasm?url";
import type { RecordingInput } from "../core/engine";
import { fingerprintOf, sha256Hex } from "../core/fingerprint";
import { levelCount, loadTile, saveTiles, tileCount, tileRows, tileSlot } from "../core/opfs";
import type { IoEvent, IoReply, IoRequest, IoResults, ScanState } from "../core/protocol";
import { isScanned, partsOf, readSource, type Source } from "../core/sources";
import type { RecordingInfo } from "../core/types";
import { scan, yieldToLoop } from "./scan";

/** Bytes `a..b` of a source, for the fingerprint. */
const slice = (source: Source) => (a: number, b: number) => {
  if ("file" in source) return source.file.slice(a, b);
  const bytes = new Uint8Array(b - a);
  readSource(source, a, bytes);
  return bytes;
};

/** The most file bytes a tile may read on demand; a coarser tile waits for the scan. */
const ON_DEMAND_BYTES = 64 * 2 ** 20;

interface Recording {
  handle: number;
  fileIds: number[];
  fingerprint: string;
  info: RecordingInfo;
  /** Display channels, which the tiles hold. */
  channels: number;
  /** Bytes of all files of the recording. */
  fileBytes: number;
  closed: boolean;
}

/** Sources by the file id the core reads them with; ids are never reused. */
const sources = new Map<number, Source>();
const recordings = new Map<string, Recording>();
let lastFileId = 0;

const read: HostRead = (fileId, offset, dst) => {
  const source = sources.get(fileId);
  if (!source) throw new Error(`no file ${fileId}`);
  readSource(source, offset, dst);
};
const core = WebAssembly.compileStreaming(fetch(wasmUrl)).then((module) => instantiateCore(module, read));

const recording = (id: string) => {
  const found = recordings.get(id);
  if (!found) throw new Error(`no open recording ${id}`);
  return found;
};

function startScan(id: string, input: RecordingInput, rec: Recording) {
  const { info } = rec;
  const emit = (state: ScanState) => {
    if (!rec.closed) self.postMessage({ event: "scan", id, state } satisfies IoEvent);
  };
  // Events follow the reply to `open`: the engine knows a recording from that reply on.
  if (!isScanned(input)) {
    void yieldToLoop().then(() =>
      emit({
        scannedRows: 0,
        totalRows: info.sample_count,
        notice:
          "Recordings above 1 GiB opened from a URL have no stored overview; tiles are built as needed.",
      }),
    );
    return;
  }
  core
    .then((c) =>
      scan({
        core: c,
        handle: rec.handle,
        fingerprint: rec.fingerprint,
        rows: info.sample_count,
        channels: rec.channels,
        rawType: info.raw_type,
        fileBytes: rec.fileBytes,
        emit,
        closed: () => rec.closed,
      }),
    )
    .catch(() => {
      stopped = true; // a trap: the next request tells the engine to replace this worker
    });
}

async function open(id: string, input: RecordingInput): Promise<IoResults["open"]> {
  if (recordings.has(id)) throw new Error(`recording ${id} is already open`);
  const parts = partsOf(input);
  const fileIds = parts.map(({ source }) => {
    sources.set(++lastFileId, source);
    return lastFileId;
  });
  let handle: number | undefined;
  try {
    const opened = (await core).open(
      {
        primary: "primary" in input ? input.primary : parts[0].name,
        files: parts.map(({ name, size }, i) => ({ name, file_id: fileIds[i], len: size })),
      },
      { cacheMb: 64 },
    );
    handle = opened.handle;
    const { info } = opened;
    // The identity of what the core read: its files, by name.
    const used = parts
      .filter(({ name }) => info.input_files.includes(name))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    const prints = await Promise.all(
      used.map(({ name, size, source }) => fingerprintOf(name, size, slice(source))),
    );
    const fingerprint = await sha256Hex(prints.join("\n"));
    // Tiles and hashes are kept per fingerprint: one engine recording per content.
    const known = [...recordings].find(([, other]) => other.fingerprint === fingerprint)?.[0];
    if (known !== undefined) {
      (await core).close(handle);
      for (const fileId of fileIds) sources.delete(fileId);
      return { info, fingerprint, analysis_channels: opened.analysis_channels, duplicateOf: known };
    }
    const rec: Recording = {
      handle,
      fileIds,
      fingerprint,
      info,
      channels: opened.analysis_channels.length,
      fileBytes: parts.reduce((sum, { size }) => sum + size, 0),
      closed: false,
    };
    recordings.set(id, rec);
    startScan(id, input, rec);
    return { info, fingerprint, analysis_channels: opened.analysis_channels };
  } catch (error) {
    if (handle !== undefined) (await core).close(handle);
    for (const fileId of fileIds) sources.delete(fileId);
    throw error;
  }
}

async function close(id: string) {
  const rec = recording(id);
  rec.closed = true;
  (await core).close(rec.handle);
  for (const fileId of rec.fileIds) sources.delete(fileId);
  recordings.delete(id);
}

/** Tile `index` of `level`: stored by the scan, or built from the file when that is quick, else `null`. */
async function tile(id: string, level: number, index: number): Promise<IoResults["tile"]> {
  const rec = recording(id);
  const { sample_count: rows, raw_type: rawType } = rec.info;
  if (level >= levelCount(rows) || index >= tileCount(rows, level)) {
    throw new Error(`tile ${index} of level ${level} does not exist for ${rows} rows`);
  }
  const slot = tileSlot(rec.channels, rawType);
  const stored = await loadTile(rec.fingerprint, slot, level, index).catch(() => null);
  if (stored) return { level, index, bytes: stored };
  // The tiles of the region on screen come this way while the scan, which can only start at row 0, works its way up.
  if ((Math.min(tileRows(level), rows) * rec.fileBytes) / rows > ON_DEMAND_BYTES) return null;
  const bytes = (await core).rawTile(rec.handle, level, index);
  await saveTiles(rec.fingerprint, slot, [bytes]).catch(() => {}); // a full or missing storage only costs the reuse
  return { level, index, bytes };
}

async function handle(request: IoRequest): Promise<unknown> {
  switch (request.type) {
    case "version":
      return (await core).version();
    case "open":
      return open(request.id, request.input);
    case "close":
      return close(request.id);
    case "raw":
      return (await core).readRaw(recording(request.id).handle, request.row0, request.rows);
    case "tile":
      return tile(request.id, request.level, request.index);
    case "annotations":
      return (await core).annotations(recording(request.id).handle);
    case "trap": {
      if (!(import.meta.env.DEV || import.meta.env.MODE === "e2e")) throw new Error("unknown request");
      // A module whose export runs `unreachable`, the instruction a Rust panic compiles to.
      // biome-ignore format: the bytes of a wasm module
      const bytes = new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 8, 1, 4, 116, 114, 97, 112, 0, 0, 10, 5, 1, 3, 0, 0, 11,
      ]);
      (new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.trap as () => void)();
      return;
    }
    case "quota": {
      if (!(import.meta.env.DEV || import.meta.env.MODE === "e2e")) throw new Error("unknown request");
      let left = request.bytes;
      const write = FileSystemSyncAccessHandle.prototype.write;
      FileSystemSyncAccessHandle.prototype.write = function (buffer, options) {
        left -= buffer.byteLength;
        if (left < 0) throw new DOMException("The quota was exceeded", "QuotaExceededError");
        return write.call(this, buffer, options);
      };
      return;
    }
  }
}

/** The buffers a reply hands over instead of copying. */
const transfers = (ok: unknown): ArrayBuffer[] =>
  ok instanceof Float32Array
    ? [ok.buffer as ArrayBuffer]
    : ok && typeof ok === "object" && "bytes" in ok
      ? [ok.bytes as ArrayBuffer]
      : [];

// After a trap the instance is unusable (a panic leaves its locks and allocator in an unknown state): requests
// queued behind the one that trapped fail at once, until the engine replaces this worker.
let stopped = false;
let queue = Promise.resolve();
self.addEventListener("message", ({ data }: MessageEvent<IoRequest & { n: number }>) => {
  queue = queue.then(async () => {
    const { n } = data;
    try {
      if (stopped) throw new WebAssembly.RuntimeError("The engine stopped after an earlier error");
      const ok = await handle(data);
      const reply: IoReply = { n, ok };
      self.postMessage(reply, { transfer: transfers(ok) });
    } catch (error) {
      stopped ||= error instanceof WebAssembly.RuntimeError;
      const reply: IoReply = {
        n,
        error: error instanceof Error ? error.message : String(error),
        trapped: error instanceof WebAssembly.RuntimeError,
      };
      self.postMessage(reply);
    }
  });
});
