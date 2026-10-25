// Synthetic recordings for tests and benchmarks: reachable only in dev and e2e builds.
// A plain EDF of 1 s records, `channels` int16 signals of `rateHz` samples each. A channel is a mixture of three
// seeded sinusoids (about 0.5 to 4, 4 to 12 and 12 to 40 Hz) plus a spike of +-30000 every 97 s. Any byte range is
// computed from its offset: a 90 GB recording needs no storage.
export interface SyntheticSpec {
  channels: number;
  rateHz: number;
  durationS: number;
  seed: number;
}

const SPIKE_S = 97;
const SPIKE = 30_000;
const AMPLITUDES = [6000, 3000, 1500];
const BANDS = [
  [0.5, 4],
  [4, 12],
  [12, 40],
];
const PHASE_BITS = 12;

const headerBytes = ({ channels }: SyntheticSpec) => 256 * (channels + 1);
const recordBytes = ({ channels, rateHz }: SyntheticSpec) => channels * rateHz * 2;

export function syntheticEdfSize(spec: SyntheticSpec): number {
  return headerBytes(spec) + spec.durationS * recordBytes(spec);
}

/** A 32-bit integer hash; the same everywhere, unlike floating-point library functions. */
function mix(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const part of parts) {
    h = Math.imul(h ^ part, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

let sine: Int16Array | undefined;
/** One period of a sine in 4096 steps, +-32767. */
const table = () =>
  (sine ??= Int16Array.from({ length: 1 << PHASE_BITS }, (_, i) =>
    Math.round(32767 * Math.sin((2 * Math.PI * i) / (1 << PHASE_BITS))),
  ));

interface Waves {
  /** Phase steps per sample on a 2^32 circle, the starting phase and the amplitude of wave `3 * channel + k`. */
  step: Int32Array;
  phase: Int32Array;
  amplitude: Int32Array;
}

function waves(spec: SyntheticSpec): Waves {
  const n = spec.channels * 3;
  const w = { step: new Int32Array(n), phase: new Int32Array(n), amplitude: new Int32Array(n) };
  for (let c = 0; c < spec.channels; c++) {
    for (let k = 0; k < 3; k++) {
      const q = 3 * c + k;
      const [lo, hi] = BANDS[k];
      const hz = Math.min(lo + ((hi - lo) * mix(spec.seed, c, k, 1)) / 2 ** 32, spec.rateHz / 4);
      w.step[q] = Math.round((hz / spec.rateHz) * 2 ** 32);
      w.phase[q] = mix(spec.seed, c, k, 2);
      w.amplitude[q] = Math.round(AMPLITUDES[k] * (0.5 + mix(spec.seed, c, k, 3) / 2 ** 33));
    }
  }
  return w;
}

/** The header, cached for the last spec asked for (a scan asks for the same one thousands of times). */
let cached: { key: string; header: Uint8Array; waves: Waves } | undefined;
function prepare(spec: SyntheticSpec) {
  const key = JSON.stringify(spec);
  if (cached?.key === key) return cached;
  const { channels, rateHz, durationS } = spec;
  if (!Number.isInteger(channels) || !Number.isInteger(rateHz) || !Number.isInteger(durationS)) {
    throw new Error("channels, rateHz and durationS of a synthetic recording are whole numbers");
  }
  const header = new Uint8Array(headerBytes(spec)).fill(32);
  const put = (at: number, text: string, width: number) => {
    if (text.length > width) throw new Error(`${text} does not fit in ${width} bytes`);
    header.set(new TextEncoder().encode(text), at);
  };
  put(0, "0", 8);
  put(8, "X X X X", 80);
  put(88, "Startdate 01-JAN-2020 X X X", 80);
  put(168, "01.01.20", 8);
  put(176, "00.00.00", 8);
  put(184, String(header.length), 8);
  put(236, String(durationS), 8);
  put(244, "1", 8);
  put(252, String(channels), 4);
  // One column per field, every signal's cell in turn: label, transducer, unit, physical and digital range,
  // prefilter, samples per record, reserved.
  const columns: [width: number, cell: (c: number) => string][] = [
    [16, (c) => `CH${c + 1}`],
    [80, () => ""],
    [8, () => "uV"],
    [8, () => "-3276.8"],
    [8, () => "3276.7"],
    [8, () => "-32768"],
    [8, () => "32767"],
    [80, () => ""],
    [8, () => String(rateHz)],
    [32, () => ""],
  ];
  let at = 256;
  for (const [width, cell] of columns) {
    for (let c = 0; c < channels; c++, at += width) put(at, cell(c), width);
  }
  cached = { key, header, waves: waves(spec) };
  return cached;
}

/** Fills `dst` with bytes `offset..offset + dst.length` of the recording; throws past its end. */
export function readSynthetic(spec: SyntheticSpec, offset: number, dst: Uint8Array): void {
  const size = syntheticEdfSize(spec);
  if (offset < 0 || offset + dst.length > size) {
    throw new Error(`synthetic recording of ${size} bytes: no ${dst.length} bytes at ${offset}`);
  }
  const { header, waves: w } = prepare(spec);
  let pos = 0;
  if (offset < header.length) {
    pos = Math.min(dst.length, header.length - offset);
    dst.set(header.subarray(offset, offset + pos));
  }
  if (pos === dst.length) return;
  const { channels, rateHz } = spec;
  const sines = table();
  const spike = SPIKE_S * rateHz;
  // The data byte at dst[pos]; `pos` goes to -1 when a sample starts one byte before the range.
  const at = offset + pos - header.length;
  const sample0 = Math.floor(at / 2);
  pos -= at % 2;
  const perRecord = channels * rateHz;
  let record = Math.floor(sample0 / perRecord);
  let channel = Math.floor((sample0 - record * perRecord) / rateHz);
  let i = sample0 - record * perRecord - channel * rateHz;
  while (pos < dst.length) {
    const n = record * rateHz + i;
    let v = 0;
    if (n > 0 && n % spike === 0) v = SPIKE * (channel % 2 ? -1 : 1);
    else {
      for (let q = 3 * channel; q < 3 * channel + 3; q++) {
        v +=
          (sines[((Math.imul(n, w.step[q]) + w.phase[q]) | 0) >>> (32 - PHASE_BITS)] * w.amplitude[q]) >> 15;
      }
    }
    if (pos >= 0) dst[pos] = v & 255;
    if (pos + 1 < dst.length) dst[pos + 1] = (v >> 8) & 255;
    pos += 2;
    if (++i === rateHz) {
      i = 0;
      if (++channel === channels) {
        channel = 0;
        record++;
      }
    }
  }
}
