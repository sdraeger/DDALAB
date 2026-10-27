// ddalab-wasm: the DDALAB engine (dda-rs) as WebAssembly, with a Node host that reads recordings from disk. `load`
// gives the host's ABI functions (open, plan, runBlock, manifest, annotations, readRaw, ...) and `run`, which runs a
// whole request and returns the manifest `ddalab run --bundle` writes with each array as a Float64Array.
import { load as loadHost } from './node/host.mjs';

export { decodeReply, unframe, WASM } from './node/host.mjs';

/** Loads the engine; `onProgress` gets each progress object a run reports. */
export async function load({ onProgress } = {}) {
  const engine = await loadHost(undefined, onProgress);

  /**
   * Runs `request` on the recording `handle`, in blocks that read at most `budgetMb` MiB of samples (0: a block per
   * window). `id`, `createdAt` and `inputSha256` go into the manifest as given.
   */
  function run(handle, request, { budgetMb = 64, id = '', createdAt = new Date().toISOString(), inputSha256 = {} } = {}) {
    const { blocks, layout, windows } = engine.plan(handle, request, budgetMb);
    const arrays = layout.arrays.map((a) => ({ shape: a.shape, data: new Float64Array(a.shape.reduce((x, y) => x * y, 1)) }));
    for (const block of blocks) {
      for (const { array, offset, bytes } of engine.runBlock(handle, request, block.w0, block.w1)) {
        // Offsets count from the start of the .npy file, its header included.
        new Uint8Array(arrays[array].data.buffer).set(bytes, offset - layout.arrays[array].header.length);
      }
    }
    const extras = { id, created_at_iso: createdAt, input_sha256: inputSha256, windows };
    const manifest = engine.manifest(handle, request, extras);
    return { manifest, arrays: Object.fromEntries(layout.arrays.map((a, i) => [a.path, arrays[i]])) };
  }

  return { ...engine, run };
}
