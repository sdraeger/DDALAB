// Basic DDA flavors (ST, CT, DE, CD, SY) on browser WebGPU using the exact same 47-bit fixed-point integer shader
// (`packages/dda-rs/src/engine/gpu_sums.wgsl`) that native `wgpu` runs. Each workgroup computes one dot product
// into 20 u32 accumulator words, so compiler fast-math (e.g. Metal/Safari) cannot erase precision, and `dda-rs`
// assembles and solves the small normal-equations systems in f64 with CPU SVD fallback.
import type { GpuBlockPlan } from "./types";

type Gpu = { device: GPUDevice; pipeline: GPUComputePipeline; maxGroups: number };
let gpu: Promise<Gpu | null> | undefined;
let available: Promise<boolean> | undefined;

/** This worker's GPU device and compiled `gpu_sums.wgsl` pipeline; `null` without WebGPU or an adapter. */
function connect(shader: string): Promise<Gpu | null> {
  gpu ??= (async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    // A lost device (a driver reset) is asked for again by the next block.
    void device.lost.then(() => {
      gpu = undefined;
    });
    const pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: shader }), entryPoint: "main" },
    });
    return { device, pipeline, maxGroups: device.limits.maxComputeWorkgroupsPerDimension };
  })().catch(() => null);
  return gpu;
}

/** Whether this browser offers a WebGPU adapter without allocating a device on the UI thread. */
export function gpuAvailable(): Promise<boolean> {
  available ??= (async () =>
    (await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" })) != null)().catch(
    () => false,
  );
  return available;
}

/**
 * Runs `gpu_sums.wgsl` on `plan` and its packed `[lo, hi]` fixed-point `data` words, returning 20 `u32`
 * accumulator words per window-pair, or `null` when the GPU cannot run the block (no adapter or over buffer/dispatch
 * limits). The caller then falls back to CPU execution.
 */
export async function gpuSums(
  shader: string,
  plan: GpuBlockPlan,
  data: Uint32Array<ArrayBuffer>,
): Promise<Uint32Array | null> {
  const found = await connect(shader);
  const pairCount = plan.pairs.length / 2;
  const count = plan.windows * pairCount;
  if (!found || count === 0) return null;
  const { device, pipeline, maxGroups } = found;
  const x = Math.min(count, maxGroups);
  const y = Math.ceil(count / x);
  if (y > maxGroups) return null;

  const pairs = new Uint32Array(plan.pairs);
  const outBytes = count * 20 * 4;
  const maxBinding = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
  if (data.byteLength > maxBinding || pairs.byteLength > maxBinding || outBytes > maxBinding) return null;

  const makeBuffer = (view: ArrayBufferView<ArrayBuffer>, usage: number) => {
    const made = device.createBuffer({ size: Math.max(16, Math.ceil(view.byteLength / 4) * 4), usage });
    device.queue.writeBuffer(made, 0, view);
    return made;
  };
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const params = new Uint32Array([plan.rows, plan.vectors, plan.windows, pairCount]);
  const buffers = [
    makeBuffer(params, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    makeBuffer(data, storage),
    makeBuffer(pairs, storage),
    device.createBuffer({ size: outBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
  ];
  const readback = device.createBuffer({
    size: outBytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  try {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: buffers.map((b, binding) => ({ binding, resource: { buffer: b } })),
      }),
    );
    pass.dispatchWorkgroups(x, y, 1);
    pass.end();
    encoder.copyBufferToBuffer(buffers[3], 0, readback, 0, outBytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    return new Uint32Array(readback.getMappedRange().slice(0));
  } finally {
    readback.destroy();
    for (const b of buffers) b.destroy();
  }
}
