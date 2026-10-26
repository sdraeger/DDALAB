// The waveform traces in WebGL2. Every device-pixel column of a channel row is one instance: the vertex shader
// folds the minimum and maximum of every raw sample or pyramid bucket the column overlaps (spec, "Display is
// pixel-exact") and emits a quad over exactly those pixel rows. Below one sample per pixel it folds the polyline
// through the raw samples instead, interpolated at the column edges, which is the polyline's own raster.
//
// Two R32F texture arrays hold the data. A tile layer holds one pyramid tile of every display channel (1,024 minima
// rows, then 1,024 maxima rows). A raw layer holds 2,048 raw rows of a window of channels around those on screen,
// so raw layers cost what the rows shown need, whatever the channel count. A slot texture maps the slots of a frame
// (consecutive raw chunks, or consecutive tiles of the planned level) to layers. A slot whose own data has not
// arrived draws from the finest loaded coarser tile over it: every frame asks for a few tiles covering the whole
// view and for the top tile, which stay loaded. The plot never blanks once a region is scanned.
import { bucketSize, levelCount, tileRows } from "../core/opfs";
import type { Tile } from "../core/protocol";
import { CACHE_MB, TileCache } from "../core/tileCache";
import { program } from "./gl";
import { type DrawPlan, drawPlan, tileIndices } from "./levels";
import { type Failure, nextFailure } from "./retry";

/** Raw rows per raw layer; a tile layer holds 1,024 minima then 1,024 maxima. */
const LAYER_ROWS = 2048;
const TILE_BUCKETS = 1024;
/** GPU bytes each texture array may take, and the fewest layers each gets whatever the channel count. */
const TILE_BUDGET = 128 * 2 ** 20;
const RAW_BUDGET = 128 * 2 ** 20;
const MIN_LAYERS = 32;
/** Channels a raw layer holds at least: rows can be added on screen without uploading again. */
const MIN_RAW_CHANNELS = 16;
/** Raw chunks kept on the CPU (every display channel), for scrolling rows and for the epochs either side. */
const RAW_CACHE = CACHE_MB.raw * 2 ** 20;
/** Bytes per raw request. */
const RUN_BYTES = 32 * 2 ** 20;
/** Requests to the engine in flight at once: a fast pan should not queue stale work. */
const MAX_IN_FLIGHT = 6;
/** Raw chunks put into layers from the CPU cache within one frame. */
const UPLOADS_PER_FRAME = 32;
/** Raw chunks of every display channel by `${trace.key}/${chunk}`, least recently used first; shared by the layers. */
const rawCache = new TileCache<Float32Array>(RAW_CACHE, (values) => values.byteLength);
/** The view is covered by at most this many tiles of the cover level. */
const COVER_TILES = 4;

export interface DataSource {
  tile(level: number, index: number): Promise<Tile | null>;
  raw(row0: number, rows: number): Promise<Float32Array>;
}

export interface Trace {
  /** What the raw chunks are cached by (the recording's fingerprint): a layer made again for it finds them. */
  key: string;
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
  /** Rows either side of the view whose raw samples are read ahead (an epoch), for paging. */
  aheadRows: number;
}

/** Device-pixel columns that drew no data: rows on their way, or rows the scan has not reached. */
export interface Gap {
  x0: number;
  x1: number;
  reason: "loading" | "unscanned";
}

export interface Drawn {
  plan: DrawPlan;
  /** Every slot drew from its planned data. */
  complete: boolean;
  gaps: Gap[];
  /** Why data on screen could not be read, while that lasts. */
  error: string | null;
}

const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
uniform sampler2DArray u_tiles;
uniform sampler2DArray u_raw;
uniform sampler2D u_slots;
uniform sampler2D u_params;
uniform int u_channel;
uniform int u_rawFirst;
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
// first row within the layer's tile, w: 1 for a raw layer.
vec4 slotOf(int s) { return texelFetch(u_slots, ivec2(s, 0), 0); }

float rawAt(int y, int layer) { return texelFetch(u_raw, ivec3(u_channel - u_rawFirst, y, layer), 0).r; }

// Row r (relative to slot 0) as a raw value; ok is false when its slot holds no raw rows.
float sampleAt(float r, out bool ok) {
  int s = min(int(floor(r / u_slotRows)), u_slotCount - 1);
  vec4 slot = slotOf(s);
  ok = slot.x >= 0.0 && slot.w > 0.5;
  if (!ok) return 0.0;
  return rawAt(int(r - float(s) * u_slotRows), int(slot.x));
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
        float v = rawAt(y, layer);
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
        mn = min(mn, texelFetch(u_tiles, ivec3(u_channel, k, layer), 0).r);
        mx = max(mx, texelFetch(u_tiles, ivec3(u_channel, BUCKETS + k, layer), 0).r);
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

/** Layers of one texture array, least recently drawn out first. */
interface Pool {
  texture: WebGLTexture;
  /** Channels per layer. */
  width: number;
  layers: number;
  resident: Map<string, { layer: number; used: number }>;
  free: number[];
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
  const top = levels - 1;
  const spans = program(gl, SPANS, INK);
  const dots = program(gl, DOTS, INK);
  const maxLayers = Math.min(256, gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number);
  const layersFor = (width: number, budget: number) =>
    Math.max(
      Math.min(MIN_LAYERS, maxLayers),
      Math.min(maxLayers, Math.floor(budget / (width * LAYER_ROWS * 4))),
    );

  function createPool(width: number, budget: number): Pool {
    const layers = layersFor(width, budget);
    const texture = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, width, LAYER_ROWS, layers);
    nearest(gl, gl.TEXTURE_2D_ARRAY);
    const free = Array.from({ length: layers }, (_, i) => layers - 1 - i);
    return { texture, width, layers, resident: new Map(), free };
  }
  const tiles = createPool(channels, TILE_BUDGET);
  let raws = createPool(Math.min(channels, MIN_RAW_CHANNELS), RAW_BUDGET);
  const slots = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, slots);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, maxLayers, 1);
  nearest(gl, gl.TEXTURE_2D);
  const params = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, params);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, channels, 1);
  nearest(gl, gl.TEXTURE_2D);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, channels, 1, gl.RG, gl.FLOAT, trace.params);
  const vertices = gl.createVertexArray();

  const chunkBytes = channels * LAYER_ROWS * 4;
  const runChunks = Math.max(1, Math.min(16, Math.floor(RUN_BYTES / chunkBytes)));
  const chunkKey = (chunk: number) => `${trace.key}/${chunk}`;
  /** Requests in flight by key: tiles `level/index`, raw chunks `r<chunk>`. */
  const inFlight = new Set<string>();
  let tilesInFlight = 0;
  /** Tiles the engine had no data for yet, by key: asked again once the scan has passed their last row. */
  const unavailable = new Map<string, number>();
  /** Requests that failed: when to ask again, and the reason the user sees (none while the engine restarts). */
  const failures = new Map<string, Failure>();
  /** Tiles kept whatever their age: the view's cover and the top tile. */
  const pinned = new Set<string>();
  /** The raw chunks of the last frame and their channel window, put into layers as they arrive. */
  let wanted = { chunks: new Set<number>(), first: 0 };
  /** Rows the scan has stored tiles for: covers there are read from storage alone. */
  let scannedRows = 0;
  let frameNumber = 0;
  let disposed = false;

  const usable = () => !disposed && !gl.isContextLost();
  const waiting = (key: string) => (failures.get(key)?.retryAt ?? 0) > performance.now();

  /** A free layer, or the least recently drawn one that this frame does not use and nothing pins. */
  function acquire(pool: Pool): number | undefined {
    const layer = pool.free.pop();
    if (layer !== undefined) return layer;
    let oldest: [string, { layer: number; used: number }] | undefined;
    for (const entry of pool.resident) {
      if (!pinned.has(entry[0]) && (!oldest || entry[1].used < oldest[1].used)) oldest = entry;
    }
    if (!oldest || oldest[1].used >= frameNumber) return undefined;
    pool.resident.delete(oldest[0]);
    return oldest[1].layer;
  }

  function uploadTile(key: string, tile: ArrayBuffer) {
    if (!usable() || tiles.resident.has(key)) return;
    const layer = acquire(tiles);
    if (layer === undefined) return; // every layer is on screen: the next frame asks again
    const { buckets, values } = decodeTile(tile);
    const n = buckets * channels;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tiles.texture);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, channels, buckets, 1, gl.RED, gl.FLOAT, values, 0);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      TILE_BUCKETS,
      layer,
      channels,
      buckets,
      1,
      gl.RED,
      gl.FLOAT,
      values,
      n,
    );
    // Counted as drawn in the last frame: later uploads before the next frame do not push it out.
    tiles.resident.set(key, { layer, used: frameNumber });
  }

  /** Puts the channels `first..first + width` of a raw chunk (rows of every channel) into a raw layer. */
  function uploadRaw(chunk: number, values: Float32Array, first: number) {
    const key = `${chunk}@${first}`;
    if (!usable() || raws.resident.has(key)) return;
    const layer = acquire(raws);
    if (layer === undefined) return;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, raws.texture);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, channels);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, first);
    const n = values.length / channels;
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, raws.width, n, 1, gl.RED, gl.FLOAT, values, 0);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    raws.resident.set(key, { layer, used: frameNumber });
  }

  function remember(chunk: number, values: Float32Array) {
    rawCache.set(chunkKey(chunk), values);
  }

  function cached(chunk: number): Float32Array | undefined {
    return rawCache.get(chunkKey(chunk));
  }

  /** A failed request is asked again as retry.ts says. */
  function failed(keys: string[], error: unknown) {
    let pause = 0;
    for (const key of keys) {
      const failure = nextFailure(failures.get(key), error);
      failures.set(key, failure);
      pause = failure.pause;
    }
    setTimeout(() => !disposed && onData(), pause + 10); // the retry comes even when nothing else redraws
  }

  function requestTile(level: number, index: number) {
    const key = `${level}/${index}`;
    inFlight.add(key);
    tilesInFlight++;
    source
      .tile(level, index)
      .then((found) => {
        failures.delete(key);
        if (found) uploadTile(key, found.bytes);
        else unavailable.set(key, Math.min(rows, (index + 1) * tileRows(level)));
      })
      .catch((error) => failed([key], error))
      .finally(() => {
        inFlight.delete(key);
        tilesInFlight--;
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
          failures.delete(key);
          const start = i * LAYER_ROWS;
          const n = Math.min(LAYER_ROWS, values.length / channels - start);
          if (n <= 0) return;
          // A copy: a view would keep the whole request's buffer alive while the cache counts the chunk alone.
          const chunk = values.slice(start * channels, (start + n) * channels);
          remember(first + i, chunk);
          if (wanted.chunks.has(first + i)) uploadRaw(first + i, chunk, wanted.first);
        });
      })
      .catch((error) => failed(keys, error))
      .finally(() => {
        for (const key of keys) inFlight.delete(key);
        if (!disposed) onData();
      });
  }

  /** Asks for the chunks of `want` in runs of consecutive chunks, nearest first, while requests may be added. */
  function requestRuns(want: number[]) {
    const left = want.filter((k) => !inFlight.has(`r${k}`) && !waiting(`r${k}`));
    while (left.length > 0 && inFlight.size - tilesInFlight < MAX_IN_FLIGHT * runChunks) {
      const run = [left.shift() as number];
      for (let grown = true; grown && run.length < runChunks; ) {
        grown = false;
        for (const next of [run[0] - 1, (run.at(-1) as number) + 1]) {
          const at = left.indexOf(next);
          if (at >= 0 && run.length < runChunks) {
            left.splice(at, 1);
            if (next < run[0]) run.unshift(next);
            else run.push(next);
            grown = true;
          }
        }
      }
      requestRaw(run[0], run.length);
    }
  }

  const askTile = (level: number, index: number) => {
    const key = `${level}/${index}`;
    if (tilesInFlight < MAX_IN_FLIGHT && !inFlight.has(key) && !unavailable.has(key) && !waiting(key)) {
      requestTile(level, index);
    }
  };

  /** The finest loaded tile at `from` or above covering rows from `row`: its key, level and index. */
  function coarser(from: number, row: number) {
    for (let level = from; level < levels; level++) {
      const index = Math.floor(row / tileRows(level));
      const entry = tiles.resident.get(`${level}/${index}`);
      if (entry) return { entry, level, index };
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
    if (lastRow < firstRow || disposed) return { plan, complete: true, gaps: [], error: null };

    // Raw layers hold a window of channels around the rows on screen.
    const rawWidth = Math.min(channels, Math.max(frame.rowCount, MIN_RAW_CHANNELS));
    if (rawWidth > raws.width) {
      gl.deleteTexture(raws.texture);
      raws = createPool(rawWidth, RAW_BUDGET);
    }
    const rawFirst = Math.min(frame.firstChannel, channels - raws.width);
    // shortcut: raw rows of a view wider than half the raw layers draw from level 0 tiles, whose 64-row buckets can
    // widen a span past its neighbors; split such a view into passes if screens that wide appear.
    const rawChunks = Math.floor(lastRow / LAYER_ROWS) - Math.floor(firstRow / LAYER_ROWS) + 1;
    if (plan.mode !== "tile" && rawChunks * 2 > raws.layers) plan = { mode: "tile", level: 0 };
    const raw = plan.mode !== "tile";
    let level = plan.mode === "tile" ? plan.level : -1;
    const span = (at: number) => {
      const [a, b] = tileIndices(firstRow, lastRow + 1, at);
      return { a, b, count: b - a + 1 };
    };
    // A view far wider than a screen would need more tiles than there are layers: a coarser level draws it.
    while (!raw && level < top && span(level).count > tiles.layers / 2) level++;
    if (!raw) plan = { mode: "tile", level };
    const slotRows = raw ? LAYER_ROWS : tileRows(level);
    const first = Math.floor(firstRow / slotRows);
    const count = Math.floor(lastRow / slotRows) - first + 1;
    const base = first * slotRows;

    // The cover: the view's few tiles at the finest level above the plan that has at most COVER_TILES of them
    // (coarser while those are not scanned yet), and the top tile. They are asked for after the view's own data,
    // and only once the scan has stored them: building them from the file would delay what they stand in for.
    pinned.clear();
    let cover = Math.min(top, raw ? 0 : level + 1);
    const scanned = (at: number) => {
      const { a, b } = span(at);
      for (let i = a; i <= b; i++) if (unavailable.has(`${at}/${i}`)) return false;
      return true;
    };
    while (cover < top && (span(cover).count > COVER_TILES || !scanned(cover))) cover++;
    const covering: [number, number][] = [[top, 0]];
    for (let i = span(cover).a; i <= span(cover).b; i++) covering.push([cover, i]);
    for (const [at, index] of covering) {
      const key = `${at}/${index}`;
      pinned.add(key);
      const entry = tiles.resident.get(key);
      if (entry) entry.used = frameNumber;
    }

    const table = new Float32Array(4 * count);
    const gaps: Gap[] = [];
    const wantRaw: number[] = [];
    const wantTiles: number[] = [];
    const needed: string[] = covering.map(([at, index]) => `${at}/${index}`);
    let complete = true;
    let uploads = 0;
    let deferred = false;
    wanted = { chunks: new Set(), first: rawFirst };
    for (let s = 0; s < count; s++) {
      const k = first + s;
      const key = raw ? `${k}@${rawFirst}` : `${level}/${k}`;
      needed.push(raw ? `r${k}` : key);
      if (raw) {
        wanted.chunks.add(k);
        const values = !raws.resident.has(key) && uploads < UPLOADS_PER_FRAME ? cached(k) : undefined;
        if (values) {
          uploadRaw(k, values, rawFirst);
          uploads++;
        }
      }
      const own = (raw ? raws : tiles).resident.get(key);
      if (own) {
        own.used = frameNumber;
        table.set([own.layer, raw ? 1 : bucketSize(level), 0, raw ? 1 : 0], 4 * s);
        continue;
      }
      complete = false;
      if (raw && rawCache.has(chunkKey(k))) deferred = true;
      else if (raw) wantRaw.push(k);
      else wantTiles.push(k);
      const start = k * slotRows;
      const found = coarser(raw ? 0 : level + 1, start);
      if (found) {
        found.entry.used = frameNumber;
        const size = bucketSize(found.level);
        table.set([found.entry.layer, size, (start - found.index * tileRows(found.level)) / size, 0], 4 * s);
        continue;
      }
      table.set([-1, 1, 0, 0], 4 * s);
      const x0 = Math.max(0, (start - s0) / spp);
      const x1 = Math.min(width, (start + slotRows - s0) / spp);
      const reason = !raw && unavailable.has(key) ? "unscanned" : "loading";
      const last = gaps.at(-1);
      if (last && last.reason === reason && last.x1 >= x0) last.x1 = x1;
      else gaps.push({ x0, x1, reason });
    }

    // Own data nearest the middle of the view first; then, in raw views, the epochs either side for paging.
    const middle = (s0 + (width * spp) / 2) / slotRows;
    const byDistance = (a: number, b: number) => Math.abs(a - middle) - Math.abs(b - middle);
    for (const k of wantTiles.sort(byDistance)) askTile(level, k);
    requestRuns(wantRaw.sort(byDistance));
    for (const [at, index] of covering) {
      const stored = Math.min(rows, (index + 1) * tileRows(at)) <= scannedRows;
      if (stored && !tiles.resident.has(`${at}/${index}`)) askTile(at, index);
    }
    if (raw) {
      const ahead = Math.ceil(frame.aheadRows / LAYER_ROWS);
      const firstChunk = Math.floor(firstRow / LAYER_ROWS);
      const lastChunk = Math.floor(lastRow / LAYER_ROWS);
      if ((rawChunks + 2 * ahead) * chunkBytes <= RAW_CACHE) {
        const around: number[] = [];
        for (let i = 1; i <= ahead; i++) {
          for (const k of [lastChunk + i, firstChunk - i]) {
            const loaded = rawCache.has(chunkKey(k)) || raws.resident.has(`${k}@${rawFirst}`);
            if (k >= 0 && k * LAYER_ROWS < rows && !loaded) around.push(k);
          }
        }
        requestRuns(around);
      }
    }
    const error = needed.map((key) => failures.get(key)?.reason).find((reason) => reason) ?? null;
    if (deferred) onData();

    gl.bindTexture(gl.TEXTURE_2D, slots);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, count, 1, gl.RGBA, gl.FLOAT, table);
    gl.bindVertexArray(vertices);
    const bind = (unit: number, target: number, texture: WebGLTexture | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, texture);
    };
    bind(0, gl.TEXTURE_2D_ARRAY, tiles.texture);
    bind(1, gl.TEXTURE_2D_ARRAY, raws.texture);
    bind(2, gl.TEXTURE_2D, slots);
    bind(3, gl.TEXTURE_2D, params);
    const rowsShown = Math.min(frame.rowCount, channels - frame.firstChannel);
    const common = (p: ReturnType<typeof program>) => {
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
      gl.useProgram(p.program);
      gl.uniform1i(p.uniform("u_tiles"), 0);
      gl.uniform1i(p.uniform("u_raw"), 1);
      gl.uniform1i(p.uniform("u_slots"), 2);
      gl.uniform1i(p.uniform("u_params"), 3);
      gl.uniform1i(p.uniform("u_rawFirst"), rawFirst);
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
    return { plan, complete, gaps, error };
  }

  return {
    draw,
    /** The scan has stored the tiles up to `scannedRows`: those the engine did not have before exist now. */
    scanAdvanced(rowsScanned: number) {
      scannedRows = rowsScanned;
      for (const [key, end] of unavailable) if (scannedRows >= end) unavailable.delete(key);
    },
    dispose() {
      disposed = true;
      if (gl.isContextLost()) return;
      for (const texture of [tiles.texture, raws.texture, slots, params]) gl.deleteTexture(texture);
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
