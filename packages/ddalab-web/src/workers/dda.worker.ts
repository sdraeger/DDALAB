// A DDA worker: one wasm instance that runs blocks of windows of a run. It opens the recording itself, from the same
// files or URLs as the IO worker, with an 8 MiB file cache; a text recording is parsed here whole, which is why the
// engine gives a large one fewer workers. The engine starts a pool of these for one run and stops them after it.
import { instantiateCore } from "../core/abi";
import { compileWasm } from "../core/compileWasm";
import wasmUrl from "../core/ddalab.wasm?url";
import type { DdaReply, DdaRequest } from "../core/protocol";
import { openRequestOf, type Part, partsOf, readSource } from "../core/sources";
import { CACHE_MB } from "../core/tileCache";
import type { Block, DDARequest } from "../core/types";
import { stSums } from "../core/webgpu";
import { messageOf } from "../core/words";

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
      const gpu = data.gpu ? await onGpu(await core, handle, request, data.block) : null;
      const ok = gpu ?? engine.runBlock(handle, request, data.block);
      // Dev and e2e builds report the instance's memory with each block (e2e/bench.spec.ts).
      const memory =
        import.meta.env.DEV || import.meta.env.MODE === "e2e" ? { wasmBytes: engine.memoryBytes() } : {};
      self.postMessage({ ok, gpu: gpu !== null, ...memory } satisfies DdaReply, {
        transfer: ok.chunks.map((chunk) => chunk.bytes),
      });
    }
  } catch (error) {
    stopped ||= error instanceof WebAssembly.RuntimeError;
    self.postMessage({
      error: messageOf(error),
      trapped: error instanceof WebAssembly.RuntimeError,
    } satisfies DdaReply);
  }
});

/** The block's chunks from sums on the GPU; `null` when it runs on the CPU (not ST alone, no GPU, or a GPU error). */
async function onGpu(engine: Awaited<typeof core>, handle: number, request: DDARequest, block: Block) {
  const inputs = engine.stInputs(handle, request, block);
  if (!inputs) return null;
  const sums = await stSums(inputs.plan, inputs.rows).catch(() => null);
  return sums && engine.stFinish(handle, request, block, sums);
}
