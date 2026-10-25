// The Node host of the ddalab wasm module: `host_read` over fs.readSync, and one function per ABI export
// that moves the bytes and throws the `{"error"}` replies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WASM = fileURLToPath(
  new URL('../target/wasm32-unknown-unknown/release/ddalab_wasm.wasm', import.meta.url),
);

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ERROR = encoder.encode('{"error"');

const u32 = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);

/** `[u32 count]([u32 len][bytes])*` as an array of byte arrays. */
export function unframe(bytes) {
  const items = [];
  for (let i = 0, at = 4; i < u32(bytes, 0); i++, at += 4 + u32(bytes, at)) {
    items.push(bytes.subarray(at + 4, at + 4 + u32(bytes, at)));
  }
  return items;
}

/** Instantiates `module` (a .wasm path or a compiled WebAssembly.Module); `onProgress` gets each progress object. */
export async function load(module = WASM, onProgress = () => {}) {
  const fds = new Map(); // file_id -> fd
  const handleFiles = new Map(); // handle -> file_ids
  let nextFileId = 1;
  let abi;
  const memory = () => new Uint8Array(abi.memory.buffer);
  const host = {
    host_read(fileId, offset, ptr, len) {
      const fd = fds.get(fileId);
      if (fd === undefined) return 1;
      for (let done = 0; done < len; ) {
        const n = fs.readSync(fd, memory(), ptr + done, len - done, offset + done);
        if (n === 0) return 2;
        done += n;
      }
      return 0;
    },
    host_progress(ptr, len) {
      onProgress(JSON.parse(decoder.decode(memory().subarray(ptr, ptr + len))));
    },
  };
  const source = typeof module === 'string' ? fs.readFileSync(module) : module;
  const instantiated = await WebAssembly.instantiate(source, { host });
  abi = (instantiated.instance ?? instantiated).exports;

  /** The reply buffer, copied out of wasm memory and freed. */
  const take = (reply) => {
    const ptr = Number(reply >> 32n);
    const len = Number(reply & 0xffffffffn);
    const bytes = memory().slice(ptr, ptr + len);
    abi.ddalab_free(ptr, len);
    return bytes;
  };
  const failed = (bytes) => bytes.length >= ERROR.length && ERROR.every((b, i) => bytes[i] === b);
  const binary = (reply) => {
    const bytes = take(reply);
    if (failed(bytes)) throw new Error(JSON.parse(decoder.decode(bytes)).error);
    return bytes;
  };
  const json = (reply) => {
    const { ok, error } = JSON.parse(decoder.decode(take(reply)));
    if (error !== undefined) throw new Error(error);
    return ok;
  };
  /** Calls `call(ptr, len)` with `value` (bytes, or JSON for anything else) in wasm memory. */
  const withInput = (value, call) => {
    const bytes = value instanceof Uint8Array ? value : encoder.encode(JSON.stringify(value));
    const ptr = abi.ddalab_alloc(bytes.length);
    memory().set(bytes, ptr);
    try {
      return call(ptr, bytes.length);
    } finally {
      abi.ddalab_free(ptr, bytes.length);
    }
  };

  return {
    exports: abi,
    version: () => json(abi.ddalab_version()),

    /** Opens the recording whose files are `paths`, the primary first: `{handle, info, analysis_channels}`. */
    open(paths, sampleRateHz) {
      const files = paths.map((p) => {
        const fd = fs.openSync(p, 'r');
        const fileId = nextFileId++;
        fds.set(fileId, fd);
        return { name: path.basename(p), file_id: fileId, len: fs.fstatSync(fd).size };
      });
      const closeFiles = () => files.forEach((f) => (fs.closeSync(fds.get(f.file_id)), fds.delete(f.file_id)));
      try {
        const request = { primary: files[0].name, files, sample_rate_hz: sampleRateHz };
        const opened = withInput(request, (p, n) => json(abi.ddalab_open(p, n)));
        handleFiles.set(opened.handle, closeFiles);
        return opened;
      } catch (error) {
        closeFiles();
        throw error;
      }
    },
    close(handle) {
      abi.ddalab_close(handle);
      handleFiles.get(handle)?.();
      handleFiles.delete(handle);
    },
    annotations: (handle) => json(abi.ddalab_annotations(handle)),
    rawTile: (handle, level, index) => binary(abi.ddalab_raw_tile(handle, level, index)),
    readRaw(handle, row0, rows) {
      const bytes = binary(abi.ddalab_read_raw(handle, row0, rows));
      return new Float32Array(bytes.buffer, 0, bytes.length / 4);
    },
    plan: (handle, request, budgetMb) =>
      withInput(request, (p, n) => json(abi.ddalab_plan(handle, p, n, budgetMb))),

    /** `[{array, offset, bytes}]`: the block's bytes of each bundle array, at their file offsets. */
    runBlock(handle, request, w0, w1) {
      const bytes = withInput(request, (p, n) => binary(abi.ddalab_run_block(handle, p, n, w0, w1)));
      const headerEnd = 4 + u32(bytes, 0);
      const { chunks } = JSON.parse(decoder.decode(bytes.subarray(4, headerEnd)));
      let at = headerEnd;
      return chunks.map(({ array, offset, len }) => ({ array, offset, bytes: bytes.subarray(at, (at += len)) }));
    },
    manifest: (handle, request, extras) =>
      withInput(request, (p, n) =>
        withInput(extras, (q, m) => json(abi.ddalab_manifest(handle, p, n, q, m))),
      ),

    /** The SHA-256 of a file, hex, hashed in 4 MiB slices. */
    sha256File(file) {
      const id = abi.ddalab_sha256_new();
      const fd = fs.openSync(file, 'r');
      const slice = new Uint8Array(4 << 20);
      try {
        for (let n; (n = fs.readSync(fd, slice)) > 0; ) {
          withInput(slice.subarray(0, n), (p, m) => abi.ddalab_sha256_update(id, p, m));
        }
      } finally {
        fs.closeSync(fd);
      }
      return json(abi.ddalab_sha256_hex(id));
    },

    /** A pyramid over the display channels; `push` and `finish` return the encoded tiles that completed. */
    pyramid(handle) {
      const id = abi.ddalab_pyramid_new(handle);
      if (id === 0) throw new Error(`no pyramid for recording ${handle}`);
      return {
        push: (row0, rows) => unframe(binary(abi.ddalab_pyramid_push(id, row0, rows))),
        finish: () => unframe(binary(abi.ddalab_pyramid_finish(id))),
      };
    },
  };
}
