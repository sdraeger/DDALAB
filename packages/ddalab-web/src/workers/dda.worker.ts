// A DDA worker: one wasm instance that runs blocks of windows of a run. It opens the recording itself, from the same
// files or URLs as the IO worker, with an 8 MiB file cache; a text recording is parsed here whole, which is why the
// engine gives a large one fewer workers. The engine starts a pool of these for one run and stops them after it.
import { instantiateCore } from "../core/abi";
import { compileWasm } from "../core/compileWasm";
import wasmUrl from "../core/ddalab.wasm?url";
import type { DdaReply, DdaRequest } from "../core/protocol";
import { openRequestOf, type Part, partsOf, readSource } from "../core/sources";
import { CACHE_MB } from "../core/tileCache";

/** The files of the recording: file id `n` is `parts[n - 1]`. */
let parts: Part[] = [];
const core = compileWasm(wasmUrl).then((module) =>
  instantiateCore(module, (fileId, offset, dst) => readSource(parts[fileId - 1].source, offset, dst)),
);
/** The recording of this worker's run, opened with its first request. */
let handle: number | undefined;

// After a trap the instance is unusable; the engine fails the run and stops this worker.
let stopped = false;
self.addEventListener("message", async ({ data }: MessageEvent<DdaRequest>) => {
  const { input, request } = data;
  try {
    if (stopped) throw new WebAssembly.RuntimeError("The engine stopped after an earlier error");
    const engine = await core;
    if (handle === undefined) {
      parts = partsOf(input);
      const fileIds = parts.map((_, i) => i + 1);
      handle = engine.open(openRequestOf(input, parts, fileIds), { cacheMb: CACHE_MB.workerFiles }).handle;
    }
    if ("extras" in data) {
      self.postMessage({ ok: engine.manifest(handle, request, data.extras) } satisfies DdaReply);
    } else {
      const ok = engine.runBlock(handle, request, data.block);
      // Dev and e2e builds report the instance's memory with each block (e2e/bench.spec.ts).
      const memory =
        import.meta.env.DEV || import.meta.env.MODE === "e2e" ? { wasmBytes: engine.memoryBytes() } : {};
      self.postMessage({ ok, ...memory } satisfies DdaReply, {
        transfer: ok.chunks.map((chunk) => chunk.bytes),
      });
    }
  } catch (error) {
    stopped ||= error instanceof WebAssembly.RuntimeError;
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      trapped: error instanceof WebAssembly.RuntimeError,
    } satisfies DdaReply);
  }
});
