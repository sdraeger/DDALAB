// The annotation worker: the full annotation list of a recording, read with a wasm instance of its own. The list
// takes a pass over every record of an EDF+ (a full sequential read of the file), which the IO worker must not
// make between a tile request and its answer. The recording is opened here from the same sources, with a small
// file cache.
import { instantiateCore } from "../core/abi";
import { compileWasm } from "../core/compileWasm";
import wasmUrl from "../core/ddalab.wasm?url";
import type { AnnotationsReply, AnnotationsRequest, MemoryReply, MemoryRequest } from "../core/protocol";
import { openRequestOf, type Part, partsOf, readSource } from "../core/sources";
import { CACHE_MB } from "../core/tileCache";

/** The files of the recording being read: file id `n` is `parts[n - 1]`. A request sets it and uses it at once. */
let parts: Part[] = [];
const core = compileWasm(wasmUrl).then((module) =>
  instantiateCore(module, (fileId, offset, dst) => readSource(parts[fileId - 1].source, offset, dst)),
);

// After a trap the instance is unusable; the engine replaces this worker on the first `trapped` reply.
let stopped = false;
self.addEventListener("message", async ({ data }: MessageEvent<AnnotationsRequest | MemoryRequest>) => {
  if ("type" in data) {
    if (import.meta.env.DEV || import.meta.env.MODE === "e2e") {
      self.postMessage({ wasmBytes: (await core).memoryBytes() } satisfies MemoryReply);
    }
    return;
  }
  const { n, input } = data;
  try {
    if (stopped) throw new WebAssembly.RuntimeError("The annotation reader stopped after an earlier error");
    const engine = await core;
    // Nothing is awaited from here to the reply: requests do not interleave.
    parts = partsOf(input);
    const { handle } = engine.open(
      openRequestOf(
        input,
        parts,
        parts.map((_, i) => i + 1),
      ),
      { cacheMb: CACHE_MB.workerFiles },
    );
    try {
      self.postMessage({ n, ok: engine.annotations(handle) } satisfies AnnotationsReply);
    } finally {
      engine.close(handle);
    }
  } catch (error) {
    stopped ||= error instanceof WebAssembly.RuntimeError;
    self.postMessage({
      n,
      error: error instanceof Error ? error.message : String(error),
      trapped: error instanceof WebAssembly.RuntimeError,
    } satisfies AnnotationsReply);
  }
});
