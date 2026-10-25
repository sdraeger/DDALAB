// The waveform traces in WebGL2. Every device-pixel column of a channel row is one instance: the vertex shader
// folds the minimum and maximum of every raw sample or pyramid bucket the column overlaps (spec, "Display is
// pixel-exact") and emits a quad over exactly those pixel rows. Below one sample per pixel it folds the polyline
// through the raw samples instead, interpolated at the column edges, which is the polyline's own raster.
//
// Data sits in one R32F texture array whose layers hold either 2,048 raw rows of every display channel or one
// pyramid tile (1,024 minima rows, then 1,024 maxima rows). A small slot texture maps the slots of the current frame
// (consecutive raw chunks, or consecutive tiles of the planned level) to layers; a slot whose own data is not loaded
// yet points at a coarser tile that covers it: the plot never blanks once a region has any data.
import { bucketSize, levelCount, tileRows } from "../core/opfs";
import type { Tile } from "../core/protocol";
import { program } from "./gl";
import { type DrawPlan, drawPlan, tileIndices } from "./levels";

/** Raw rows per layer; a tile layer holds 1,024 minima then 1,024 maxima. */
const LAYER_ROWS = 2048;
const TILE_BUCKETS = 1024;
/** GPU bytes the layers may take; at least MIN_LAYERS layers whatever the channel count. */
const GPU_BUDGET = 128 * 2 ** 20;
const MIN_LAYERS = 40;
/** Requests to the engine in flight at once: a fast pan should not queue stale work. */
const MAX_IN_FLIGHT = 6;
/** Raw chunks per raw request. */
const RUN_CHUNKS = 16;

export interface DataSource {
  tile(level: number, index: number): Promise<Tile | null>;
  raw(row0: number, rows: number): Promise<Float32Array>;
}

export interface Trace {
  /** Display channels, the columns of every raw row and tile. */
  channels: number;
  rows: number;
  /** Per display channel: display units per raw unit, then the offset in display units. */
  params: Float32Array;
}

export interface Frame {
  /** Device pixels. */
  width: number;
  height: number;
  /** Sample position at the left edge, and samples per device pixel. */
  s0: number;
  spp: number;
  firstChannel: number;
  rowCount: number;
  /** Device pixels per row, and per display unit (µV for voltage channels). */
  rowHeight: number;
  pxPerUnit: number;
  pointSize: number;
  ink: [number, number, number, number];
}

export interface Drawn {
  plan: DrawPlan;
  /** Every slot drew from its planned data. */
  complete: boolean;
  /** Device-pixel ranges the scan has not reached, with no data at any level yet. */
  missing: [number, number][];
}

const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
uniform sampler2DArray u_data;
uniform sampler2D u_slots;
uniform sampler2D u_params;
uniform int u_channel;
uniform int u_slotCount;
uniform float u_slotRows;
uniform float u_s0;
uniform float u_spp;
uniform float u_lastRow;
uniform float u_width;
uniform float u_height;
uniform float u_center;
uniform float u_pxPerUnit;
const int STEPS = 160;
const int BUCKETS = ${TILE_BUCKETS};

// x: layer (-1 when nothing covers the slot), y: rows per bucket (1 for raw rows), z: bucket offset of the slot's
// first row within the layer's tile, w: 1 for raw rows.
vec4 slotOf(int s) { return texelFetch(u_slots, ivec2(s, 0), 0); }

// Row r (relative to slot 0) as a raw value; ok is false when its slot holds no raw rows.
float sampleAt(float r, out bool ok) {
  int s = min(int(floor(r / u_slotRows)), u_slotCount - 1);
  vec4 slot = slotOf(s);
  ok = slot.x >= 0.0 && slot.w > 0.5;
  if (!ok) return 0.0;
  return texelFetch(u_data, ivec3(u_channel, int(r - float(s) * u_slotRows), int(slot.x)), 0).r;
}

vec2 toPixels(float x, float y) { return vec2(2.0 * x / u_width - 1.0, 1.0 - 2.0 * y / u_height); }
`;

const SPANS = /* glsl */ `${COMMON}
uniform int u_line;

// Folds rows lo..hi (inclusive, relative to slot 0) into mn and mx, in raw units; false when none had data.
bool fold(float lo, float hi, inout float mn, inout float mx) {
  bool any = false;
  int first = int(floor(lo / u_slotRows));
  int last = min(int(floor(hi / u_slotRows)), u_slotCount - 1);
  for (int s = first; s <= last; s++) {
    vec4 slot = slotOf(s);
    if (slot.x < 0.0) continue;
    int layer = int(slot.x);
    float start = float(s) * u_slotRows;
    float a = max(lo, start) - start;
    float b = min(hi, start + u_slotRows) - start;
    if (slot.w > 0.5) {
      int y1 = min(int(b), int(u_slotRows) - 1);
      for (int i = 0; i < STEPS; i++) {
        int y = int(a) + i;
        if (y > y1) break;
        float v = texelFetch(u_data, ivec3(u_channel, y, layer), 0).r;
        mn = min(mn, v);
        mx = max(mx, v);
        any = true;
      }
    } else {
      // Bucket k covers its rows and the first row of the next one: the buckets meeting a..b.
      int k0 = int(floor(slot.z + a / slot.y));
      int k1 = min(max(k0, int(ceil(slot.z + b / slot.y)) - 1), BUCKETS - 1);
      for (int i = 0; i < STEPS; i++) {
        int k = k0 + i;
        if (k > k1) break;
        mn = min(mn, texelFetch(u_data, ivec3(u_channel, k, layer), 0).r);
        mx = max(mx, texelFetch(u_data, ivec3(u_channel, BUCKETS + k, layer), 0).r);
        any = true;
      }
    }
  }
  return any;
}

// The polyline through the raw samples over p0..p1, by its value at both edges and every sample between.
bool polyline(float p0, float p1, inout float mn, inout float mx) {
  bool ok;
  for (int e = 0; e < 2; e++) {
    float p = e == 0 ? p0 : p1;
    float i = floor(p);
    float a = sampleAt(i, ok);
    if (!ok) return false;
    float b = a;
    if (i + 1.0 <= u_lastRow) {
      b = sampleAt(i + 1.0, ok);
      if (!ok) return false;
    }
    float v = mix(a, b, p - i);
    mn = min(mn, v);
    mx = max(mx, v);
  }
  for (float i = floor(p0) + 1.0; i < p1; i += 1.0) {
    float v = sampleAt(i, ok);
    if (!ok) return false;
    mn = min(mn, v);
    mx = max(mx, v);
  }
  return true;
}

void main() {
  float c = float(gl_InstanceID);
  float p0 = u_s0 + c * u_spp;
  float p1 = p0 + u_spp;
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  if (p1 < 0.0 || p0 > u_lastRow) return;
  p0 = max(p0, 0.0);
  p1 = min(p1, u_lastRow);
  float mn = 3.4e38;
  float mx = -3.4e38;
  bool any = u_line == 1 && polyline(p0, p1, mn, mx);
  if (!any) {
    mn = 3.4e38;
    mx = -3.4e38;
    any = fold(floor(p0), ceil(p1), mn, mx);
  }
  if (!any || mn > mx) return;
  vec2 gain = texelFetch(u_params, ivec2(u_channel, 0), 0).rg;
  float v0 = mn * gain.x + gain.y;
  float v1 = mx * gain.x + gain.y;
  float top = floor(u_center - max(v0, v1) * u_pxPerUnit);
  float bottom = floor(u_center - min(v0, v1) * u_pxPerUnit) + 1.0;
  int corner = gl_VertexID;
  gl_Position = vec4(toPixels(c + float(corner & 1), corner < 2 ? top : bottom), 0.0, 1.0);
}
`;

const DOTS = /* glsl */ `${COMMON}
uniform float u_firstSample;
uniform float u_pointSize;
void main() {
  float r = u_firstSample + float(gl_InstanceID);
  bool ok;
  float raw = sampleAt(r, ok);
  vec2 gain = texelFetch(u_params, ivec2(u_channel, 0), 0).rg;
  gl_PointSize = u_pointSize;
  gl_Position = ok
    ? vec4(toPixels((r - u_s0) / u_spp, u_center - (raw * gain.x + gain.y) * u_pxPerUnit), 0.0, 1.0)
    : vec4(2.0, 2.0, 0.0, 1.0);
}
`;

const INK = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 u_ink;
uniform int u_round;
out vec4 color;
void main() {
  if (u_round == 1 && length(gl_PointCoord - 0.5) > 0.5) discard;
  color = u_ink;
}
`;

interface Resident {
  layer: number;
  used: number;
}

/** Decodes an encoded `DDT1` tile to float32 minima then maxima, `[buckets][channels]` each. */
export function decodeTile(bytes: ArrayBuffer): { channels: number; buckets: number; values: Float32Array } {
  const header = new DataView(bytes);
  const channels = header.getUint32(16, true);
  const buckets = header.getUint32(20, true);
  const tag = header.getUint8(24); // I16, I24, I32, F32, F64; I24 is stored as i32, F64 as f32
  const n = 2 * channels * buckets;
  const stored =
    tag === 0
      ? new Int16Array(bytes, 32, n)
      : tag <= 2
        ? new Int32Array(bytes, 32, n)
        : new Float32Array(bytes, 32, n);
  const values = new Float32Array(n);
  values.set(stored);
  return { channels, buckets, values };
}

export type WaveformLayer = ReturnType<typeof createWaveformLayer>;

export function createWaveformLayer(
  gl: WebGL2RenderingContext,
  source: DataSource,
  trace: Trace,
  onData: () => void,
) {
  const { channels, rows } = trace;
  const levels = levelCount(rows);
  const spans = program(gl, SPANS, INK);
  const dots = program(gl, DOTS, INK);
  const layerBytes = channels * LAYER_ROWS * 4;
  const maxLayers = Math.min(256, gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number);
  const layerCount = Math.max(
    Math.min(MIN_LAYERS, maxLayers),
    Math.min(maxLayers, Math.floor(GPU_BUDGET / layerBytes)),
  );

  const data = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, data);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, channels, LAYER_ROWS, layerCount);
  nearest(gl, gl.TEXTURE_2D_ARRAY);
  const slots = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, slots);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, layerCount, 1);
  nearest(gl, gl.TEXTURE_2D);
  const params = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, params);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, channels, 1);
  nearest(gl, gl.TEXTURE_2D);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, channels, 1, gl.RG, gl.FLOAT, trace.params);
  const vertices = gl.createVertexArray();

  const resident = new Map<string, Resident>();
  const free = Array.from({ length: layerCount }, (_, i) => layerCount - 1 - i);
  const inFlight = new Set<string>();
  /** Tiles the engine had no data for yet, by key: asked again once the scan has passed their last row. */
  const unavailable = new Map<string, number>();
  let frameNumber = 0;
  let disposed = false;

  /** A free layer, or the least recently used one not drawn in this frame; `undefined` when every layer is. */
  function acquire(): number | undefined {
    const layer = free.pop();
    if (layer !== undefined) return layer;
    let oldest: [string, Resident] | undefined;
    for (const entry of resident) if (!oldest || entry[1].used < oldest[1].used) oldest = entry;
    if (!oldest || oldest[1].used >= frameNumber) return undefined;
    resident.delete(oldest[0]);
    return oldest[1].layer;
  }

  /** Puts `rowsOf` rows of minima (and maxima at row 1,024) or raw rows into a layer under `key`. */
  function upload(key: string, values: Float32Array, rowsOf: number, tile: boolean) {
    if (disposed || gl.isContextLost() || resident.has(key)) return;
    const layer = acquire();
    if (layer === undefined) return; // every layer is on screen: the next frame asks again
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, data);
    const n = rowsOf * channels;
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, channels, rowsOf, 1, gl.RED, gl.FLOAT, values, 0);
    if (tile) {
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        TILE_BUCKETS,
        layer,
        channels,
        rowsOf,
        1,
        gl.RED,
        gl.FLOAT,
        values,
        n,
      );
    }
    // Counted as drawn in the last frame: later uploads before the next frame do not push it out.
    resident.set(key, { layer, used: frameNumber });
  }

  function requestTile(level: number, index: number) {
    const key = `${level}/${index}`;
    inFlight.add(key);
    source
      .tile(level, index)
      .then((found) => {
        if (!found) return void unavailable.set(key, Math.min(rows, (index + 1) * tileRows(level)));
        const { buckets, values } = decodeTile(found.bytes);
        upload(key, values, buckets, true);
      })
      .catch(() => unavailable.set(key, 0)) // asked again when the scan next reports
      .finally(() => {
        inFlight.delete(key);
        if (!disposed) onData();
      });
  }

  function requestRaw(first: number, count: number) {
    const keys = Array.from({ length: count }, (_, i) => `r${first + i}`);
    for (const key of keys) inFlight.add(key);
    const row0 = first * LAYER_ROWS;
    source
      .raw(row0, Math.min(rows, (first + count) * LAYER_ROWS) - row0)
      .then((values) => {
        keys.forEach((key, i) => {
          const start = i * LAYER_ROWS;
          const n = Math.min(LAYER_ROWS, values.length / channels - start);
          if (n > 0) upload(key, values.subarray(start * channels, (start + n) * channels), n, false);
        });
      })
      .catch(() => {})
      .finally(() => {
        for (const key of keys) inFlight.delete(key);
        if (!disposed) onData();
      });
  }

  /** The finest loaded tile above `from` covering rows from `row`: its key, level and index. */
  function coarser(from: number, row: number): { key: string; level: number; index: number } | undefined {
    for (let level = from; level < levels; level++) {
      const index = Math.floor(row / tileRows(level));
      const key = `${level}/${index}`;
      if (resident.has(key)) return { key, level, index };
    }
    return undefined;
  }

  function draw(frame: Frame): Drawn {
    frameNumber++;
    const { width, height, s0, spp } = frame;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let plan = drawPlan(spp, levels);
    const firstRow = Math.max(0, Math.floor(s0) - 1);
    const lastRow = Math.min(rows - 1, Math.ceil(s0 + width * spp) + 1);
    if (lastRow < firstRow || disposed) return { plan, complete: true, missing: [] };
    // shortcut: raw rows of a very wide view of many channels would not fit the layers and level 0 tiles stand in,
    // whose 64-row buckets can widen a span past its neighbours; upload only the rows on screen if this shows.
    if (
      plan.mode !== "tile" &&
      (Math.floor(lastRow / LAYER_ROWS) - Math.floor(firstRow / LAYER_ROWS) + 1) * 2 > layerCount
    ) {
      plan = { mode: "tile", level: 0 };
    }
    const raw = plan.mode !== "tile";
    let level = plan.mode === "tile" ? plan.level : -1;
    // A view far wider than a screen would need more tiles than there are layers: a coarser level draws it.
    const tiles = (at: number) => tileIndices(firstRow, lastRow + 1, at);
    while (!raw && level < levels - 1 && tiles(level)[1] - tiles(level)[0] + 1 > layerCount) level++;
    if (!raw) plan = { mode: "tile", level };
    const slotRows = raw ? LAYER_ROWS : tileRows(level);
    const first = Math.floor(firstRow / slotRows);
    const count = Math.floor(lastRow / slotRows) - first + 1;
    const base = first * slotRows;

    const table = new Float32Array(4 * count);
    const missing: [number, number][] = [];
    const wantRaw: number[] = [];
    const wantTiles: number[] = [];
    let complete = true;
    for (let s = 0; s < count; s++) {
      const k = first + s;
      const own = resident.get(raw ? `r${k}` : `${level}/${k}`);
      if (own) {
        own.used = frameNumber;
        table.set([own.layer, raw ? 1 : bucketSize(level), 0, raw ? 1 : 0], 4 * s);
        continue;
      }
      complete = false;
      if (raw) wantRaw.push(k);
      else wantTiles.push(k);
      const start = k * slotRows;
      const cover = coarser(raw ? 0 : level + 1, start);
      if (cover) {
        const entry = resident.get(cover.key) as Resident;
        entry.used = frameNumber;
        const size = bucketSize(cover.level);
        table.set([entry.layer, size, (start - cover.index * tileRows(cover.level)) / size, 0], 4 * s);
      } else {
        table.set([-1, 1, 0, 0], 4 * s);
        // Rows still on their way leave a blank; rows the scan has not reached are marked.
        if (raw || !unavailable.has(`${level}/${k}`)) continue;
        const x0 = Math.max(0, (start - s0) / spp);
        const x1 = Math.min(width, (start + slotRows - s0) / spp);
        const last = missing.at(-1);
        if (last && last[1] >= x0) last[1] = x1;
        else missing.push([x0, x1]);
      }
    }
    // Requests for what this frame lacks, nearest the middle of the view first.
    const middle = (s0 + (width * spp) / 2) / slotRows;
    const byDistance = (a: number, b: number) => Math.abs(a - middle) - Math.abs(b - middle);
    for (const k of wantTiles.sort(byDistance)) {
      const key = `${level}/${k}`;
      if (inFlight.size >= MAX_IN_FLIGHT) break;
      if (!inFlight.has(key) && !unavailable.has(key)) requestTile(level, k);
    }
    const runs = wantRaw.filter((k) => !inFlight.has(`r${k}`)).sort(byDistance);
    while (runs.length > 0 && inFlight.size < MAX_IN_FLIGHT * RUN_CHUNKS) {
      // A run of consecutive chunks around the first one wanted.
      const run = [runs.shift() as number];
      for (let more = true; more && run.length < RUN_CHUNKS; ) {
        more = false;
        for (const next of [run[0] - 1, (run.at(-1) as number) + 1]) {
          const at = runs.indexOf(next);
          if (at >= 0 && run.length < RUN_CHUNKS) {
            runs.splice(at, 1);
            if (next < run[0]) run.unshift(next);
            else run.push(next);
            more = true;
          }
        }
      }
      requestRaw(run[0], run.length);
    }

    gl.bindTexture(gl.TEXTURE_2D, slots);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, count, 1, gl.RGBA, gl.FLOAT, table);
    gl.bindVertexArray(vertices);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, data);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, slots);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, params);
    const rowsShown = Math.min(frame.rowCount, channels - frame.firstChannel);
    const common = (p: ReturnType<typeof program>) => {
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
      gl.useProgram(p.program);
      gl.uniform1i(p.uniform("u_data"), 0);
      gl.uniform1i(p.uniform("u_slots"), 1);
      gl.uniform1i(p.uniform("u_params"), 2);
      gl.uniform1i(p.uniform("u_slotCount"), count);
      gl.uniform1f(p.uniform("u_slotRows"), slotRows);
      gl.uniform1f(p.uniform("u_s0"), s0 - base);
      gl.uniform1f(p.uniform("u_spp"), spp);
      gl.uniform1f(p.uniform("u_lastRow"), rows - 1 - base);
      gl.uniform1f(p.uniform("u_width"), width);
      gl.uniform1f(p.uniform("u_height"), height);
      gl.uniform1f(p.uniform("u_pxPerUnit"), frame.pxPerUnit);
      gl.uniform4fv(p.uniform("u_ink"), frame.ink);
    };
    common(spans);
    gl.uniform1i(spans.uniform("u_line"), plan.mode === "line" ? 1 : 0);
    gl.uniform1i(spans.uniform("u_round"), 0);
    for (let r = 0; r < rowsShown; r++) {
      gl.uniform1i(spans.uniform("u_channel"), frame.firstChannel + r);
      gl.uniform1f(spans.uniform("u_center"), (r + 0.5) * frame.rowHeight);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, width);
    }
    // Sample dots once samples are more than 8 px apart.
    if (plan.mode === "line" && 1 / spp > 8) {
      const firstSample = Math.max(0, Math.ceil(s0));
      const samples = Math.min(rows - 1, Math.floor(s0 + width * spp)) - firstSample + 1;
      common(dots);
      gl.uniform1f(dots.uniform("u_firstSample"), firstSample - base);
      gl.uniform1f(dots.uniform("u_pointSize"), frame.pointSize);
      gl.uniform1i(dots.uniform("u_round"), 1);
      for (let r = 0; r < rowsShown && samples > 0; r++) {
        gl.uniform1i(dots.uniform("u_channel"), frame.firstChannel + r);
        gl.uniform1f(dots.uniform("u_center"), (r + 0.5) * frame.rowHeight);
        gl.drawArraysInstanced(gl.POINTS, 0, 1, samples);
      }
    }
    return { plan, complete, missing };
  }

  return {
    draw,
    /** The scan has stored the tiles up to `scannedRows`: those the engine did not have before exist now. */
    scanAdvanced(scannedRows: number) {
      for (const [key, end] of unavailable) if (scannedRows >= end) unavailable.delete(key);
    },
    dispose() {
      disposed = true;
      if (gl.isContextLost()) return;
      for (const texture of [data, slots, params]) gl.deleteTexture(texture);
      gl.deleteVertexArray(vertices);
      gl.deleteProgram(spans.program);
      gl.deleteProgram(dots.program);
    },
  };
}

function nearest(gl: WebGL2RenderingContext, target: number) {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
