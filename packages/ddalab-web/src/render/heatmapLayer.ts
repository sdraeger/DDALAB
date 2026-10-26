// The result heatmap in WebGL2. Every device pixel folds the cells its column and its rows overlap, keeping the
// signed value of largest magnitude, and takes its color from a 256-entry table (colormaps.ts). Window i owns the
// times nearer its center than any other window's center and within its analysis interval: the column under a time
// shows the window whose center is nearest it, and a column across a border counts toward both windows. Zoomed out,
// the cells come from the max-magnitude pyramid (resultPyramid.ts) at the coarsest level whose cells are no wider than
// a pixel, so no outlier window disappears.
//
// An R32F texture array holds one tile per layer (`rows` texels wide, 1,024 cells high). A slot texture maps the tiles
// of a frame to layers; a tile still on its way draws from the finest loaded coarser tile over it, and the top tile,
// which covers every window, stays loaded.
import { TileCache } from "../core/tileCache";
import { program } from "./gl";
import { FANOUT, type ResultTile, TILE_CELLS } from "./resultPyramid";
import { type Failure, nextFailure } from "./retry";

/** GPU bytes the tiles may take, and the fewest layers whatever the row count. */
const BUDGET = 64 * 2 ** 20;
const MIN_LAYERS = 8;
/** Bytes of tiles kept on the CPU, for the row plot and the readout. */
const CPU_BUDGET = 64 * 2 ** 20;
const MAX_IN_FLIGHT = 4;
/** The opacity of the rows other than the hovered one. */
const RECEDE = 0.84;
/** Tiles on the CPU by `${array.key}/${level}/${index}`, least recently used first; shared by the layers. */
const cpuTiles = new TileCache<ResultTile>(CPU_BUDGET, (found) => found.values.byteLength);

export interface HeatmapArray {
  /** What its tiles are cached by (result, variant and array): a layer made again for it finds them. */
  key: string;
  windows: number;
  rows: number;
  levels: number;
  lo: number;
  hi: number;
  lut: Uint8Array;
}

export interface HeatmapFrame {
  /** Device pixels. */
  width: number;
  height: number;
  /** The window position at the left edge (window i is centered at i), and windows per device pixel. */
  p0: number;
  ppx: number;
  /** Half the analysis window, in windows. */
  half: number;
  hoverRow: number | null;
}

export interface HeatmapDrawn {
  level: number;
  /** Every slot drew from its own tile. */
  complete: boolean;
  /** Why tiles on screen could not be read, while that lasts. */
  error: string | null;
}

const VERTEX = /* glsl */ `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
uniform sampler2DArray u_cells;
uniform sampler2D u_slots;
uniform sampler2D u_lut;
uniform float u_p0;
uniform float u_ppx;
uniform float u_half;
uniform float u_last;
uniform float u_slotWindows;
uniform int u_slotCount;
uniform int u_rows;
uniform int u_height;
uniform int u_hover;
uniform float u_lo;
uniform float u_hi;
out vec4 color;
const int MAX_CELLS = 16;
const int MAX_ROWS = 256;

void main() {
  int y = u_height - 1 - int(gl_FragCoord.y);
  float pa = u_p0 + floor(gl_FragCoord.x) * u_ppx;
  float pb = pa + u_ppx;
  // The windows owning times in [pa, pb), relative to slot 0; the first and the last own the rest of their interval.
  if (pb <= -u_half || pa >= u_last + u_half) discard;
  float ia = floor(pa - 0.5) + 1.0;
  float ib = ceil(pb + 0.5) - 1.0;
  if (ia + u_half <= pa) ia += 1.0;
  if (ib - u_half >= pb) ib -= 1.0;
  ia = clamp(ia, 0.0, u_last);
  ib = clamp(ib, 0.0, u_last);
  if (ia > ib) discard;
  int r0 = y * u_rows / u_height;
  int r1 = max(r0, ((y + 1) * u_rows + u_height - 1) / u_height - 1);
  float best = 0.0;
  bool any = false;
  int s1 = min(int(floor(ib / u_slotWindows)), u_slotCount - 1);
  for (int s = int(floor(ia / u_slotWindows)); s <= s1; s++) {
    // x: layer (-1 when nothing covers the slot), y: windows per cell, z: windows from the layer's first to the slot's.
    vec4 slot = texelFetch(u_slots, ivec2(s, 0), 0);
    if (slot.x < 0.0) continue;
    float start = float(s) * u_slotWindows;
    int k0 = int(floor((max(ia, start) - start + slot.z) / slot.y));
    int k1 = int(floor((min(ib, start + u_slotWindows - 1.0) - start + slot.z) / slot.y));
    for (int i = 0; i < MAX_CELLS; i++) {
      int k = k0 + i;
      if (k > k1) break;
      for (int j = 0; j < MAX_ROWS; j++) {
        int r = r0 + j;
        if (r > r1) break;
        float v = texelFetch(u_cells, ivec3(r, k, int(slot.x)), 0).r;
        if (!isnan(v) && (!any || abs(v) > abs(best))) {
          best = v;
          any = true;
        }
      }
    }
  }
  if (!any) discard;
  float t = clamp((best - u_lo) / (u_hi - u_lo), 0.0, 1.0);
  vec4 c = texelFetch(u_lut, ivec2(int(floor(t * 255.0 + 0.5)), 0), 0);
  float a = u_hover >= 0 && (u_hover < r0 || u_hover > r1) ? ${RECEDE} : 1.0;
  color = vec4(c.rgb * a, a);
}
`;

export type HeatmapLayer = ReturnType<typeof createHeatmapLayer>;

export function createHeatmapLayer(
  gl: WebGL2RenderingContext,
  tile: (level: number, index: number) => Promise<ResultTile>,
  array: HeatmapArray,
  onData: () => void,
) {
  const { windows, rows } = array;
  const top = array.levels - 1;
  const maxWidth = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  // shortcut: one texel per row; heatmaps of more rows than the GPU's texture width need rows split across layers.
  if (rows > maxWidth)
    throw new Error(`a heatmap of ${rows} rows is wider than this GPU's ${maxWidth} texels`);
  const shader = program(gl, VERTEX, FRAGMENT);
  const maxLayers = Math.min(256, gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number);
  const layers = Math.min(maxLayers, Math.max(MIN_LAYERS, Math.floor(BUDGET / (rows * TILE_CELLS * 4))));
  const cells = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, cells);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, rows, TILE_CELLS, layers);
  nearest(gl, gl.TEXTURE_2D_ARRAY);
  const slots = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, slots);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, layers, 1);
  nearest(gl, gl.TEXTURE_2D);
  const lut = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lut);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 1);
  nearest(gl, gl.TEXTURE_2D);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, array.lut);
  const vertices = gl.createVertexArray();

  /** Tiles by `level/index`: on the CPU (in `cpuTiles`) and in layers. */
  const cpu = {
    get: (key: string) => cpuTiles.get(`${array.key}/${key}`),
    set: (key: string, found: ResultTile) => cpuTiles.set(`${array.key}/${key}`, found),
  };
  const resident = new Map<string, { layer: number; used: number }>();
  const free = Array.from({ length: layers }, (_, i) => layers - 1 - i);
  const inFlight = new Set<string>();
  /** Requests that failed: when to ask again, and the reason the user sees (retry.ts). */
  const failures = new Map<string, Failure>();
  const topKey = `${top}/0`;
  let frameNumber = 0;
  let last = { level: 0, wa: 0, wb: -1 };
  let disposed = false;

  const tileWindows = (level: number) => TILE_CELLS * FANOUT ** level;

  function request(level: number, index: number) {
    const key = `${level}/${index}`;
    if (inFlight.has(key) || inFlight.size >= MAX_IN_FLIGHT) return;
    if ((failures.get(key)?.retryAt ?? 0) > performance.now()) return;
    inFlight.add(key);
    tile(level, index)
      .then((found) => {
        failures.delete(key);
        cpu.set(key, found);
      })
      .catch((error) => {
        const failure = nextFailure(failures.get(key), error);
        failures.set(key, failure);
        setTimeout(() => !disposed && onData(), failure.pause + 10);
      })
      .finally(() => {
        inFlight.delete(key);
        if (!disposed) onData();
      });
  }

  /** The layer of a tile: resident, or uploaded from the CPU now when a layer is free or stale. */
  function layerOf(key: string): number | undefined {
    const entry = resident.get(key);
    if (entry) {
      entry.used = frameNumber;
      return entry.layer;
    }
    const found = cpu.get(key);
    if (!found || gl.isContextLost()) return undefined;
    let layer = free.pop();
    if (layer === undefined) {
      let oldest: [string, { layer: number; used: number }] | undefined;
      for (const item of resident) {
        if (item[0] !== topKey && (!oldest || item[1].used < oldest[1].used)) oldest = item;
      }
      if (!oldest || oldest[1].used >= frameNumber) return undefined;
      resident.delete(oldest[0]);
      layer = oldest[1].layer;
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, cells);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      rows,
      found.windows,
      1,
      gl.RED,
      gl.FLOAT,
      found.values,
    );
    resident.set(key, { layer, used: frameNumber });
    return layer;
  }

  function draw(frame: HeatmapFrame): HeatmapDrawn {
    frameNumber++;
    const { width, height, p0, ppx } = frame;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let level = 0;
    while (level < top && FANOUT ** (level + 1) <= ppx) level++;
    // The first and last window reach half a window from their centers, the others half a step.
    const reach = Math.max(0.5, frame.half);
    const wa = Math.max(0, Math.floor(p0 - reach));
    const wb = Math.min(windows - 1, Math.ceil(p0 + width * ppx + reach));
    const span = (at: number) => Math.floor(wb / tileWindows(at)) - Math.floor(wa / tileWindows(at)) + 1;
    // A view wider than the layers hold draws from a coarser level.
    while (level < top && span(level) > layers / 2) level++;
    last = { level, wa, wb };
    if (wb < wa || disposed) return { level, complete: true, error: null };

    // The top tile first: it covers whatever else is missing.
    const topLayer = layerOf(topKey);
    if (topLayer === undefined) request(top, 0);
    const S = tileWindows(level);
    const first = Math.floor(wa / S);
    const count = span(level);
    const base = first * S;
    const table = new Float32Array(4 * count);
    const needed = [topKey];
    let complete = true;
    for (let s = 0; s < count; s++) {
      const key = `${level}/${first + s}`;
      needed.push(key);
      const own = layerOf(key);
      if (own !== undefined) {
        table.set([own, FANOUT ** level, 0, 0], 4 * s);
        continue;
      }
      complete = false;
      request(level, first + s);
      const start = (first + s) * S;
      table.set([-1, 1, 0, 0], 4 * s);
      for (let at = level + 1; at <= top; at++) {
        const index = Math.floor(start / tileWindows(at));
        const layer = layerOf(`${at}/${index}`);
        if (layer === undefined) continue;
        table.set([layer, FANOUT ** at, start - index * tileWindows(at), 0], 4 * s);
        break;
      }
    }
    const error = needed.map((key) => failures.get(key)?.reason).find((reason) => reason) ?? null;

    gl.bindTexture(gl.TEXTURE_2D, slots);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, count, 1, gl.RGBA, gl.FLOAT, table);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
    gl.useProgram(shader.program);
    gl.bindVertexArray(vertices);
    const bind = (unit: number, target: number, texture: WebGLTexture | null, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, texture);
      gl.uniform1i(shader.uniform(name), unit);
    };
    bind(0, gl.TEXTURE_2D_ARRAY, cells, "u_cells");
    bind(1, gl.TEXTURE_2D, slots, "u_slots");
    bind(2, gl.TEXTURE_2D, lut, "u_lut");
    gl.uniform1f(shader.uniform("u_p0"), p0 - base);
    gl.uniform1f(shader.uniform("u_ppx"), ppx);
    gl.uniform1f(shader.uniform("u_half"), frame.half);
    gl.uniform1f(shader.uniform("u_last"), windows - 1 - base);
    gl.uniform1f(shader.uniform("u_slotWindows"), S);
    gl.uniform1i(shader.uniform("u_slotCount"), count);
    gl.uniform1i(shader.uniform("u_rows"), rows);
    gl.uniform1i(shader.uniform("u_height"), height);
    gl.uniform1i(shader.uniform("u_hover"), frame.hoverRow ?? -1);
    gl.uniform1f(shader.uniform("u_lo"), array.lo);
    gl.uniform1f(shader.uniform("u_hi"), array.hi);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { level, complete, error };
  }

  return {
    draw,
    /** Window `w` of `row` as stored (float32), or `undefined` while its tile is on its way. */
    value(w: number, row: number): number | undefined {
      const index = Math.floor(w / TILE_CELLS);
      const found = cpu.get(`0/${index}`);
      if (!found) request(0, index);
      return found?.values[(w - index * TILE_CELLS) * rows + row];
    },
    /** The cells of `row` the last frame drew at its level, as [first window, value]; loading tiles give NaN. */
    row(row: number): { level: number; cells: [number, number][] } {
      const { level, wa, wb } = last;
      const f = FANOUT ** level;
      const out: [number, number][] = [];
      let found: ResultTile | undefined;
      for (let k = Math.floor(wa / f); k <= Math.floor(wb / f); k++) {
        const index = Math.floor(k / TILE_CELLS);
        if (k === Math.floor(wa / f) || k % TILE_CELLS === 0) found = cpu.get(`${level}/${index}`);
        out.push([k * f, found ? found.values[(k - index * TILE_CELLS) * rows + row] : Number.NaN]);
      }
      return { level, cells: out };
    },
    dispose() {
      disposed = true;
      if (gl.isContextLost()) return;
      for (const texture of [cells, slots, lut]) gl.deleteTexture(texture);
      gl.deleteVertexArray(vertices);
      gl.deleteProgram(shader.program);
    },
  };
}

function nearest(gl: WebGL2RenderingContext, target: number) {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
