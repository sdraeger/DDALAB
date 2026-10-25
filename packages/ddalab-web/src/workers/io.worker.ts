// The IO worker: one wasm instance that opens recordings, reads their bytes synchronously (`host_read`) and serves
// raw rows. Requests run one at a time in the order they arrive.
import { type HostRead, instantiateCore } from "../core/abi";
import wasmUrl from "../core/ddalab.wasm?url";
import type { RecordingInput } from "../core/engine";
import { fingerprintOf, sha256Hex } from "../core/fingerprint";
import type { IoReply, IoRequest, IoResults } from "../core/protocol";
import { readFileSync, readUrlSync } from "../core/sources";

type Source = { file: Blob } | { url: string };
/** Bytes `a..b` of a source, for the fingerprint. */
const slice = (source: Source) => (a: number, b: number) => {
  if ("file" in source) return source.file.slice(a, b);
  const bytes = new Uint8Array(b - a);
  readUrlSync(source.url, a, bytes);
  return bytes;
};

/** Sources by the file id the core reads them with; ids are never reused. */
const sources = new Map<number, Source>();
const recordings = new Map<string, { handle: number; fileIds: number[] }>();
let lastFileId = 0;

const read: HostRead = (fileId, offset, dst) => {
  const source = sources.get(fileId);
  if (!source) throw new Error(`no file ${fileId}`);
  if ("file" in source) readFileSync(source.file, offset, dst);
  else readUrlSync(source.url, offset, dst);
};
const core = WebAssembly.compileStreaming(fetch(wasmUrl)).then((module) => instantiateCore(module, read));

const recording = (id: string) => {
  const found = recordings.get(id);
  if (!found) throw new Error(`no open recording ${id}`);
  return found;
};

// A module whose export runs `unreachable`, the instruction a Rust panic compiles to.
// biome-ignore format: the bytes of a wasm module
const UNREACHABLE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 8, 1, 4, 116, 114, 97, 112, 0, 0, 10, 5, 1, 3, 0, 0, 11,
]);

async function open(id: string, input: RecordingInput): Promise<IoResults["open"]> {
  if (input.kind === "synthetic") throw new Error("Synthetic recordings are not available yet");
  if (recordings.has(id)) throw new Error(`recording ${id} is already open`);
  const parts: { name: string; size: number; source: Source }[] =
    input.kind === "files"
      ? input.files.map((file) => ({ name: file.name, size: file.size, source: { file } }))
      : input.files.map(({ name, size, url }) => ({ name, size, source: { url } }));
  const fileIds = parts.map(({ source }) => {
    sources.set(++lastFileId, source);
    return lastFileId;
  });
  try {
    const { handle, info } = (await core).open(
      {
        primary: input.primary,
        files: parts.map(({ name, size }, i) => ({ name, file_id: fileIds[i], len: size })),
      },
      { cacheMb: 64 },
    );
    recordings.set(id, { handle, fileIds });
    // The identity of what the core read: its files, by name.
    const used = parts
      .filter(({ name }) => info.input_files.includes(name))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    const prints = await Promise.all(
      used.map(({ name, size, source }) => fingerprintOf(name, size, slice(source))),
    );
    return { info, fingerprint: await sha256Hex(prints.join("\n")) };
  } catch (error) {
    await close(id).catch(() => {});
    for (const fileId of fileIds) sources.delete(fileId);
    throw error;
  }
}

async function close(id: string) {
  const { handle, fileIds } = recording(id);
  (await core).close(handle);
  for (const fileId of fileIds) sources.delete(fileId);
  recordings.delete(id);
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
    case "trap":
      if (!(import.meta.env.DEV || import.meta.env.MODE === "e2e")) throw new Error("unknown request");
      (new WebAssembly.Instance(new WebAssembly.Module(UNREACHABLE)).exports.trap as () => void)();
      return;
  }
}

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
      self.postMessage(reply, { transfer: ok instanceof Float32Array ? [ok.buffer] : [] });
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
