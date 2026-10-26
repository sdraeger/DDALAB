// The hash worker: SHA-256 of a recording's files with the core's streaming hash, in 4 MiB slices, one file at a
// time. Every open of local files reads them again (a stored digest would stand on the fingerprint, which does not
// pin the middle of a file, and these digests go into result manifests as provenance); a URL recording is read here
// only when a run needs its digests (engine.ts).
import { instantiateCore } from "../core/abi";
import { compileWasm } from "../core/compileWasm";
import wasmUrl from "../core/ddalab.wasm?url";
import type { HashReply, HashRequest, MemoryReply } from "../core/protocol";
import { type Part, partsOf, readSource } from "../core/sources";
import { yieldToLoop } from "./scan";

const SLICE_BYTES = 4 * 2 ** 20;

const core = compileWasm(wasmUrl).then((module) =>
  instantiateCore(module, () => {
    throw new Error("the hash worker opens no recordings");
  }),
);
const cancelled = new Set<string>();
const reply = (message: HashReply) => self.postMessage(message);

/** The hex digest of `part`, or `undefined` once recording `id` was closed. */
async function digest(part: Part, id: string): Promise<string | undefined> {
  const stream = (await core).sha256();
  const buffer = new Uint8Array(Math.min(SLICE_BYTES, part.size));
  let percent = 0;
  for (let at = 0; at < part.size; at += SLICE_BYTES) {
    const slice = buffer.subarray(0, Math.min(SLICE_BYTES, part.size - at));
    readSource(part.source, at, slice);
    stream.update(slice);
    const hashedBytes = at + slice.length;
    if (Math.floor((100 * hashedBytes) / part.size) > percent) {
      percent = Math.floor((100 * hashedBytes) / part.size);
      reply({ id, name: part.name, hashedBytes, bytes: part.size });
    }
    await yieldToLoop();
    if (cancelled.has(id)) return undefined;
  }
  return stream.hex();
}

self.addEventListener("message", async ({ data }: MessageEvent<HashRequest>) => {
  if (data.type === "cancel") {
    cancelled.add(data.id);
    return;
  }
  if (data.type === "memory") {
    if (import.meta.env.DEV || import.meta.env.MODE === "e2e") {
      self.postMessage({ wasmBytes: (await core).memoryBytes() } satisfies MemoryReply);
    }
    return;
  }
  const { id, input, names } = data;
  try {
    const parts = partsOf(input);
    for (const name of names) {
      const part = parts.find((p) => p.name === name);
      if (!part) throw new Error(`${name} is not among the opened files`);
      const sha256 = await digest(part, id);
      if (sha256 === undefined) return;
      reply({ id, name, sha256 });
    }
  } catch (error) {
    reply({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
