// Display filters for the waveform: a line-noise notch at 50 or 60 Hz and its harmonics, and a 4th-order Butterworth
// high-pass, low-pass or both (a band-pass), each a cascade of biquads (RBJ cookbook, bilinear transform prewarped at
// the cutoff) run forward and backward for zero phase. They change what the viewer draws, never what DDA analyzes.

export interface Filter {
  highpassHz: number | null;
  lowpassHz: number | null;
  notchHz: 50 | 60 | null;
}

/** H(z) = (b0 + b1 z⁻¹ + b2 z⁻²) / (1 + a1 z⁻¹ + a2 z⁻²). */
type Biquad = [b0: number, b1: number, b2: number, a1: number, a2: number];

/** Q of the two sections of a 4th-order Butterworth: 1 / (2 sin(π(2k + 1) / 8)). */
const BUTTERWORTH_Q = [1 / (2 * Math.sin(Math.PI / 8)), 1 / (2 * Math.sin((3 * Math.PI) / 8))];
/** Width of each notch in Hz: its Q is the notch frequency over this. */
const NOTCH_WIDTH_HZ = 2;
/** Cutoffs at or past this fraction of the sample rate are skipped: the bilinear transform folds them. */
export const MAX_FRACTION = 0.45;
/** Rows read past each side of a request, at most: the high-pass settling time is capped at this. */
const MAX_PAD_ROWS = 2 ** 16;

function biquad(kind: "lowpass" | "highpass" | "notch", hz: number, q: number, rate: number): Biquad {
  const w = (2 * Math.PI * hz) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const [b0, b1, b2] =
    kind === "lowpass"
      ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
      : kind === "highpass"
        ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
        : [1, -2 * cos, 1];
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

/** The sections of `filter` at `rate` Hz, empty when nothing below the folding limit is on. */
function sections(filter: Filter, rate: number): Biquad[] {
  const below = (hz: number | null): hz is number => hz !== null && hz > 0 && hz < MAX_FRACTION * rate;
  const out: Biquad[] = [];
  if (below(filter.highpassHz))
    for (const q of BUTTERWORTH_Q) out.push(biquad("highpass", filter.highpassHz, q, rate));
  if (below(filter.lowpassHz))
    for (const q of BUTTERWORTH_Q) out.push(biquad("lowpass", filter.lowpassHz, q, rate));
  if (filter.notchHz)
    for (let hz = filter.notchHz; below(hz); hz += filter.notchHz)
      out.push(biquad("notch", hz, hz / NOTCH_WIDTH_HZ, rate));
  return out;
}

/**
 * Rows to read on each side of a request so that the filters settle before it: four time constants of the lowest
 * corner, the notch's 1 / width included.
 */
export function padRows(filter: Filter, rate: number): number {
  if (sections(filter, rate).length === 0) return 0;
  const corners = [filter.highpassHz, filter.lowpassHz, filter.notchHz && NOTCH_WIDTH_HZ].filter(
    (hz): hz is number => !!hz && hz < MAX_FRACTION * rate,
  );
  // shortcut: a high-pass below ~4 * rate / 2^16 Hz settles only partly at a request's edge; read more if it shows.
  return Math.min(MAX_PAD_ROWS, Math.ceil((4 * rate) / Math.min(...corners)));
}

/** Runs one section over `x` in place, front to back or back to front, starting from the steady state of a constant input `x[0]`. */
function run([b0, b1, b2, a1, a2]: Biquad, x: Float64Array, backward: boolean) {
  const n = x.length;
  const first = backward ? n - 1 : 0;
  const step = backward ? -1 : 1;
  const x0 = x[first];
  const y0 = (x0 * (b0 + b1 + b2)) / (1 + a1 + a2);
  let z2 = b2 * x0 - a2 * y0;
  let z1 = b1 * x0 - a1 * y0 + z2;
  for (let i = first, k = 0; k < n; i += step, k++) {
    const v = x[i];
    const y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    x[i] = y;
  }
}

/**
 * `x` (`rows` × `channels`, row-major) filtered by `filter` at `rate` Hz, each channel alone, forward then backward
 * over an odd extension of each end (as SciPy's `filtfilt`); `x` itself when no filter applies.
 */
export function applyFilter(x: Float32Array, channels: number, rate: number, filter: Filter): Float32Array {
  const cascade = sections(filter, rate);
  const rows = x.length / channels;
  if (cascade.length === 0 || rows < 2) return x;
  const ext = Math.min(rows - 1, padRows(filter, rate));
  const out = new Float32Array(x.length);
  const column = new Float64Array(rows + 2 * ext);
  for (let c = 0; c < channels; c++) {
    const at = (r: number) => x[r * channels + c];
    for (let r = 0; r < rows; r++) column[ext + r] = at(r);
    for (let k = 1; k <= ext; k++) {
      column[ext - k] = 2 * at(0) - at(k);
      column[ext + rows - 1 + k] = 2 * at(rows - 1) - at(rows - 1 - k);
    }
    for (const s of cascade) run(s, column, false);
    for (const s of cascade) run(s, column, true);
    for (let r = 0; r < rows; r++) out[r * channels + c] = column[ext + r];
  }
  return out;
}

/** The settings as the viewer's filter button names them. */
export function filterLabel({ highpassHz: hp, lowpassHz: lp, notchHz }: Filter): string {
  const pass = hp && lp ? `${hp}–${lp} Hz` : hp ? `High-pass ${hp} Hz` : lp ? `Low-pass ${lp} Hz` : null;
  const notch = notchHz && `${notchHz} Hz notch`;
  return [pass, notch].filter(Boolean).join(", ") || "Off";
}

export const NO_FILTER: Filter = { highpassHz: null, lowpassHz: null, notchHz: null };

const KEY = "ddalab.filter";
const hz = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);

/** The filter the user last set, which localStorage keeps for every recording; off without storage. */
export function storedFilter(): Filter {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const notch = saved.notchHz === 50 || saved.notchHz === 60 ? saved.notchHz : null;
    return { highpassHz: hz(saved.highpassHz), lowpassHz: hz(saved.lowpassHz), notchHz: notch };
  } catch {
    return NO_FILTER;
  }
}

export function saveFilter(filter: Filter) {
  try {
    localStorage.setItem(KEY, JSON.stringify(filter));
  } catch {}
}
