// The wasm ABI of packages/ddalab-wasm as typed calls: one function per export that moves the bytes in and out
// and throws the `{"error"}` replies. Ported from the Node reference host (ddalab-wasm/node/host.mjs).
import type {
  Annotation,
  Block,
  BlockChunks,
  DDARequest,
  EngineVersion,
  ManifestExtras,
  Opened,
  OpenRequest,
  Plan,
  Progress,
  ResultDocument,
} from "./types";

/** Fills `dst`, a view of wasm memory, from `offset` of file `fileId`; throws on failure. */
export type HostRead = (fileId: number, offset: number, dst: Uint8Array) => void;

export interface Core {
  version(): EngineVersion;
  /** `cacheMb` is the file cache of each file in MiB (the engine's default is 64). */
  open(input: OpenRequest, options?: { cacheMb?: number }): Opened;
  /** Also drops the pyramids built from `handle`. */
  close(handle: number): void;
  /** The full annotation list. It scans the file: call it after `open`, in the background. */
  annotations(handle: number): { annotations: Annotation[]; warnings: string[] };
  /** The `encode_tile` bytes of a tile. */
  rawTile(handle: number, level: number, index: number): ArrayBuffer;
  /** Rows `row0..row0 + rows` of the display channels, row-major. */
  readRaw(handle: number, row0: number, rows: number): Float32Array;
  plan(handle: number, request: DDARequest, budgetMb: number): Plan;
  runBlock(handle: number, request: DDARequest, block: Block): BlockChunks;
  manifest(handle: number, request: DDARequest, extras: ManifestExtras): ResultDocument;
  /** A SHA-256 stream: `update` throws on an error reply and `hex` ends the stream. */
  sha256(): { update(bytes: Uint8Array): void; hex(): string };
  /** Bytes of the instance's linear memory, which only grows. */
  memoryBytes(): number;
  /** Rows go in order from row 0; `push` and `finish` return the encoded tiles that completed. */
  pyramid(handle: number): {
    push(row0: number, rows: number): ArrayBuffer[];
    finish(): ArrayBuffer[];
    drop(): void;
  };
}

/** The exports of the module. u32 values arrive as signed i32 and replies as signed i64. */
interface Exports {
  memory: WebAssembly.Memory;
  ddalab_alloc(len: number): number;
  ddalab_free(ptr: number, len: number): void;
  ddalab_version(): bigint;
  ddalab_open(ptr: number, len: number): bigint;
  ddalab_close(handle: number): void;
  ddalab_annotations(handle: number): bigint;
  ddalab_raw_tile(handle: number, level: number, tile: number): bigint;
  ddalab_read_raw(handle: number, row0: number, rows: number): bigint;
  ddalab_plan(handle: number, ptr: number, len: number, budgetMb: number): bigint;
  ddalab_run_block(handle: number, ptr: number, len: number, w0: number, w1: number): bigint;
  ddalab_manifest(handle: number, ptr: number, len: number, extrasPtr: number, extrasLen: number): bigint;
  ddalab_sha256_new(): number;
  ddalab_sha256_update(id: number, ptr: number, len: number): bigint;
  ddalab_sha256_hex(id: number): bigint;
  ddalab_pyramid_new(handle: number): number;
  ddalab_pyramid_push(id: number, row0: number, rows: number): bigint;
  ddalab_pyramid_drop(id: number): void;
  ddalab_pyramid_finish(id: number): bigint;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ERROR = encoder.encode('{"error"');

const u32 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);

/** `[u32 count]([u32 len][bytes])*` as a list of views. */
export function unframe(bytes: Uint8Array): Uint8Array[] {
  const items: Uint8Array[] = [];
  for (let i = 0, at = 4; i < u32(bytes, 0); i++, at += 4 + u32(bytes, at)) {
    items.push(bytes.subarray(at + 4, at + 4 + u32(bytes, at)));
  }
  return items;
}

/** `[ptr, len]` of a reply `(ptr << 32) | len`, which arrives as a signed i64. */
export function decodeReply(reply: bigint): [ptr: number, len: number] {
  const bits = BigInt.asUintN(64, reply);
  return [Number(bits >> 32n), Number(bits & 0xffffffffn)];
}

export async function instantiateCore(
  wasm: WebAssembly.Module,
  read: HostRead,
  onProgress?: (p: Progress) => void,
): Promise<Core> {
  let abi: Exports;
  // The view must be taken after any call into the module, which may grow its memory.
  const memory = () => new Uint8Array(abi.memory.buffer);
  // An exception must not unwind through the module's frames: the imports return a status or swallow it.
  const host = {
    host_read(fileId: number, offset: number, ptr: number, len: number) {
      try {
        read(fileId >>> 0, offset, new Uint8Array(abi.memory.buffer, ptr >>> 0, len >>> 0));
        return 0;
      } catch {
        return 3;
      }
    },
    host_progress(ptr: number, len: number) {
      try {
        const start = ptr >>> 0;
        onProgress?.(JSON.parse(decoder.decode(memory().subarray(start, start + (len >>> 0)))));
      } catch {
        // Progress is advisory.
      }
    },
  };
  abi = (await WebAssembly.instantiate(wasm, { host })).exports as unknown as Exports;

  /** The reply buffer, copied out of wasm memory and freed. */
  const take = (reply: bigint) => {
    const [ptr, len] = decodeReply(reply);
    const bytes = memory().slice(ptr, ptr + len);
    abi.ddalab_free(ptr, len);
    return bytes;
  };
  const binary = (reply: bigint) => {
    const bytes = take(reply);
    if (bytes.length >= ERROR.length && ERROR.every((b, i) => bytes[i] === b)) {
      throw new Error(JSON.parse(decoder.decode(bytes)).error);
    }
    return bytes;
  };
  const json = <T>(reply: bigint): T => {
    const { ok, error } = JSON.parse(decoder.decode(take(reply)));
    if (error !== undefined) throw new Error(error);
    return ok;
  };
  /** Calls `call(ptr, len)` with `bytes` in wasm memory. */
  const withBytes = <T>(bytes: Uint8Array, call: (ptr: number, len: number) => T): T => {
    const ptr = abi.ddalab_alloc(bytes.length) >>> 0;
    memory().set(bytes, ptr);
    try {
      return call(ptr, bytes.length);
    } finally {
      abi.ddalab_free(ptr, bytes.length);
    }
  };
  const withJson = <T>(value: unknown, call: (ptr: number, len: number) => T) =>
    withBytes(encoder.encode(JSON.stringify(value)), call);
  /** Tiles as buffers of their own, which can be transferred. */
  const tiles = (reply: bigint) => unframe(binary(reply)).map((tile) => tile.slice().buffer);

  return {
    version: () => json(abi.ddalab_version()),
    open: (input, options) =>
      withJson({ ...input, cache_mb: options?.cacheMb }, (p, n) => json(abi.ddalab_open(p, n))),
    close: (handle) => abi.ddalab_close(handle),
    annotations: (handle) => json(abi.ddalab_annotations(handle)),
    rawTile: (handle, level, index) => binary(abi.ddalab_raw_tile(handle, level, index)).buffer,
    readRaw: (handle, row0, rows) => new Float32Array(binary(abi.ddalab_read_raw(handle, row0, rows)).buffer),
    plan: (handle, request, budgetMb) =>
      withJson(request, (p, n) => json(abi.ddalab_plan(handle, p, n, budgetMb))),

    runBlock(handle, request, block) {
      const bytes = withJson(request, (p, n) =>
        binary(abi.ddalab_run_block(handle, p, n, block.w0, block.w1)),
      );
      const headerEnd = 4 + u32(bytes, 0);
      const header = JSON.parse(decoder.decode(bytes.subarray(4, headerEnd)));
      let at = headerEnd;
      const chunks = [];
      for (const { array, offset, len } of header.chunks) {
        chunks.push({ array, offset, bytes: bytes.slice(at, at + len).buffer });
        at += len;
      }
      return { chunks };
    },
    manifest: (handle, request, extras) =>
      withJson(request, (p, n) => withJson(extras, (q, m) => json(abi.ddalab_manifest(handle, p, n, q, m)))),

    sha256() {
      const id = abi.ddalab_sha256_new() >>> 0;
      return {
        update: (bytes) => {
          withBytes(bytes, (p, n) => json(abi.ddalab_sha256_update(id, p, n)));
        },
        hex: () => json(abi.ddalab_sha256_hex(id)),
      };
    },

    memoryBytes: () => abi.memory.buffer.byteLength,

    pyramid(handle) {
      const id = abi.ddalab_pyramid_new(handle) >>> 0;
      if (id === 0) throw new Error(`no pyramid for recording ${handle}`);
      return {
        push: (row0, rows) => tiles(abi.ddalab_pyramid_push(id, row0, rows)),
        finish: () => tiles(abi.ddalab_pyramid_finish(id)),
        drop: () => abi.ddalab_pyramid_drop(id),
      };
    },
  };
}
