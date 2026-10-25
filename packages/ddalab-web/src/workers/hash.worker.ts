// The hash worker: SHA-256 of a recording's files with the core's streaming hash, in 4 MiB slices, one file at a
// time. The digests are kept in OPFS next to the tiles; a recording opened again is not read a second time.
import { instantiateCore } from "../core/abi";
import wasmUrl from "../core/ddalab.wasm?url";
import { readJson, writeJson } from "../core/opfs";
import type { HashReply, HashRequest } from "../core/protocol";
import { type Part, partsOf, readSource } from "../core/sources";
import { yieldToLoop } from "./scan";

const SLICE_BYTES = 4 * 2 ** 20;

const core = WebAssembly.compileStreaming(fetch(wasmUrl)).then((module) =>
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
  for (let at = 0; at < part.size; at += SLICE_BYTES) {
    const slice = buffer.subarray(0, Math.min(SLICE_BYTES, part.size - at));
    readSource(part.source, at, slice);
    stream.update(slice);
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
  const { id, fingerprint, input, names } = data;
  try {
    const kept = ((await readJson(fingerprint, "sha256.json")) ?? {}) as Record<string, string>;
    const all = { ...kept };
    const parts = partsOf(input);
    for (const name of names) {
      const part = parts.find((p) => p.name === name);
      if (!part) throw new Error(`${name} is not among the opened files`);
      const sha256 = kept[name] ?? (await digest(part, id));
      if (sha256 === undefined) return;
      all[name] = sha256;
      reply({ id, name, sha256 });
    }
    await writeJson(fingerprint, "sha256.json", all).catch(() => {}); // storage full: hash again next time
  } catch (error) {
    reply({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
