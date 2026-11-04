// ST on the GPU (WebGPU): each window and channel of a block summed into the normal equations of its least-squares
// problem, in f32 with Kahan compensation, for the core to solve in f64 (dda_rs::blocks::st_from_sums). The shader
// transliterates dda_rs::blocks::st_window_sums; e2e/webgpu.spec.ts holds the two to the same sums.
import type { StGpuPlan } from "./types";

/** The most model terms the shader holds; a model with more runs on the CPU. */
const MAX_TERMS = 8;
const MAX_WIDTH = 1 + (MAX_TERMS * (MAX_TERMS + 1)) / 2 + MAX_TERMS + 1;
const WORKGROUP = 64;
/** A dispatch's largest workgroup count in x. */
const MAX_GROUPS = 65535;

const SHADER = /* wgsl */ `
struct Params {
  channels: u32, raw_len: u32, dm: u32, max_delay: u32, wl: u32,
  factors: u32, terms: u32, nr_exclude: u32, items: u32, width: u32,
}
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> rows: array<f32>;
@group(0) @binding(2) var<storage, read> starts: array<u32>;
@group(0) @binding(3) var<storage, read> term_delays: array<u32>;
@group(0) @binding(4) var<storage, read_write> out: array<f32>;

var<private> start: u32;
var<private> channel: u32;
var<private> acc: array<f32, ${MAX_WIDTH}>;
var<private> carry: array<f32, ${MAX_WIDTH}>;

fn x(r: u32) -> f32 { return rows[(start + r) * p.channels + channel]; }

// A sample in a run of nr_exclude or more equal samples of the window is missing.
fn missing(r: u32) -> bool {
  let v = x(r);
  var run = 1u;
  var i = r;
  loop {
    if (i == 0u || run >= p.nr_exclude || x(i - 1u) != v) { break; }
    run += 1u;
    i -= 1u;
  }
  i = r;
  loop {
    if (i + 1u >= p.raw_len || run >= p.nr_exclude || x(i + 1u) != v) { break; }
    run += 1u;
    i += 1u;
  }
  return run >= p.nr_exclude;
}

// Kahan: carry holds what the last addition lost.
fn add(k: u32, value: f32) {
  let y = value - carry[k];
  let t = acc[k] + y;
  carry[k] = (t - acc[k]) - y;
  acc[k] = t;
}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let item = id.x;
  if (item >= p.items) { return; }
  start = starts[item / p.channels];
  channel = item % p.channels;
  let base = item * p.width;
  // z-score over the shifted rows dm..dm + wl + max_delay, the sample deviation.
  let shifted = p.wl + p.max_delay;
  var sum = 0.0;
  var count = 0.0;
  for (var r = p.dm; r < p.dm + shifted; r++) {
    if (!missing(r)) { sum += x(r); count += 1.0; }
  }
  let mean = sum / count;
  var square = 0.0;
  for (var r = p.dm; r < p.dm + shifted; r++) {
    if (!missing(r)) { let d = x(r) - mean; square += d * d; }
  }
  let deviation = sqrt(square / (count - 1.0));
  // n = 0 (an invalid window) unless the deviation is positive and finite.
  if (count < 2.0 || !(deviation > 0.0) || !(deviation < 3.0e38)) {
    for (var k = 0u; k < p.width; k++) { out[base + k] = 0.0; }
    return;
  }
  var row: array<f32, ${MAX_TERMS}>;
  for (var i = 0u; i < p.wl; i++) {
    // The derivative at raw row dm + max_delay + i, from the 2 dm samples around it.
    let center = p.dm + p.max_delay + i;
    if (missing(center)) { continue; }
    var ok = true;
    var derivative = 0.0;
    for (var s = 1u; s <= p.dm; s++) {
      if (missing(center + s) || missing(center - s)) { ok = false; break; }
      derivative += (x(center + s) - x(center - s)) / f32(s);
    }
    if (!ok) { continue; }
    let y = derivative / f32(p.dm) / deviation;
    for (var k = 0u; k < p.terms; k++) {
      var product = 1.0;
      for (var f = 0u; f < p.factors; f++) {
        let delay = term_delays[k * p.factors + f];
        if (delay == 0xffffffffu) { break; }
        let r = p.dm + i + p.max_delay - delay;
        if (missing(r)) { ok = false; break; }
        product *= (x(r) - mean) / deviation;
      }
      if (!ok) { break; }
      row[k] = product;
    }
    if (!ok) { continue; }
    add(0u, 1.0);
    var at = 1u;
    for (var a = 0u; a < p.terms; a++) {
      for (var b = a; b < p.terms; b++) { add(at, row[a] * row[b]); at++; }
    }
    for (var a = 0u; a < p.terms; a++) { add(at + a, row[a] * y); }
    add(at + p.terms, y * y);
  }
  for (var k = 0u; k < p.width; k++) { out[base + k] = acc[k]; }
}
`;

/** Values per window and channel the sums hold (dda_rs::blocks::st_sum_width). */
export const sumWidth = (terms: number) => 1 + (terms * (terms + 1)) / 2 + terms + 1;

type Gpu = { device: GPUDevice; pipeline: GPUComputePipeline };
let gpu: Promise<Gpu | null> | undefined;

/** This context's GPU device and the compiled shader; `null` without WebGPU or an adapter. */
function connect(): Promise<Gpu | null> {
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
    void device.lost.then(() => (gpu = undefined));
    const pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: "main" },
    });
    return { device, pipeline };
  })().catch(() => null);
  return gpu;
}

/** Whether this browser offers a GPU to compute on. */
export const gpuAvailable = async () => (await connect()) !== null;

/**
 * The sums of `plan` on `rows` (row-major f32 of `plan.channels` columns), or `null` when the GPU cannot take them:
 * no device, too many model terms or a block beyond its limits. The caller then runs the block on the CPU.
 */
export async function stSums(plan: StGpuPlan, rows: Float32Array<ArrayBuffer>): Promise<Float32Array | null> {
  const found = await connect();
  const terms = plan.terms.length / plan.factors;
  const items = plan.window_starts.length * plan.channels;
  if (!found || terms > MAX_TERMS || Math.ceil(items / WORKGROUP) > MAX_GROUPS) return null;
  const { device, pipeline } = found;
  const width = sumWidth(terms);
  const outBytes = items * width * 4;
  if (
    rows.byteLength > device.limits.maxStorageBufferBindingSize ||
    outBytes > device.limits.maxStorageBufferBindingSize
  )
    return null;
  const buffer = (data: ArrayBufferView<ArrayBuffer>, usage: number) => {
    const made = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage });
    device.queue.writeBuffer(made, 0, data);
    return made;
  };
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const params = new Uint32Array([
    plan.channels,
    plan.raw_len,
    plan.dm,
    plan.max_delay,
    plan.window_length,
    plan.factors,
    terms,
    plan.nr_exclude,
    items,
    width,
    0,
    0,
  ]);
  const buffers = [
    buffer(params, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    buffer(rows, storage),
    buffer(new Uint32Array(plan.window_starts), storage),
    buffer(new Uint32Array(plan.terms), storage),
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
    pass.dispatchWorkgroups(Math.ceil(items / WORKGROUP));
    pass.end();
    encoder.copyBufferToBuffer(buffers[4], 0, readback, 0, outBytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    return new Float32Array(readback.getMappedRange().slice(0));
  } finally {
    readback.destroy();
    for (const b of buffers) b.destroy();
  }
}
