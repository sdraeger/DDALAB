// Synthetic recordings for tests and benchmarks: reachable only in dev and e2e builds.
// An EDF of 1 s records, `channels` int16 signals of `rateHz` samples each. A channel is a mixture of three
// seeded sinusoids (about 0.5 to 4, 4 to 12 and 12 to 40 Hz) plus a spike of +-30000 every 97 s. Any byte range is
// computed from its offset: a 90 GB recording needs no storage.
export interface SyntheticSpec {
  channels: number;
  rateHz: number;
  durationS: number;
  seed: number;
  /** An EDF+ with an annotation channel after the signals and a "spike" annotation at each spike. */
  annotations?: boolean;
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
/** Samples (2 bytes each) of the annotation channel in every record. */
const ANNOTATION_SAMPLES = 30;

/** Signals in the file, the annotation channel included. */
const signalsOf = ({ channels, annotations }: SyntheticSpec) => channels + (annotations ? 1 : 0);
const headerBytes = (spec: SyntheticSpec) => 256 * (signalsOf(spec) + 1);
const recordSamples = (spec: SyntheticSpec) =>
  spec.channels * spec.rateHz + (spec.annotations ? ANNOTATION_SAMPLES : 0);

export function syntheticEdfSize(spec: SyntheticSpec): number {
  return headerBytes(spec) + spec.durationS * recordSamples(spec) * 2;
}

/** The annotation channel of `record`: the timekeeping TAL and the spike that starts in it, padded with zeros. */
function annotationSlot(record: number): Uint8Array {
  const spike = record > 0 && record % SPIKE_S === 0 ? `+${record}\x14spike\x14\x00` : "";
  const text = new TextEncoder().encode(`+${record}\x14\x14\x00${spike}`);
  if (text.length > ANNOTATION_SAMPLES * 2) throw new Error(`record ${record} has too many annotation bytes`);
  const slot = new Uint8Array(ANNOTATION_SAMPLES * 2);
  slot.set(text);
  return slot;
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
  const signals = signalsOf(spec);
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
  if (spec.annotations) put(192, "EDF+C", 44);
  put(236, String(durationS), 8);
  put(244, "1", 8);
  put(252, String(signals), 4);
  // One column per field, every signal's cell in turn: label, transducer, unit, physical and digital range,
  // prefilter, samples per record, reserved. The last text is the annotation channel's cell.
  const columns: [width: number, cell: (c: number) => string, annotation: string][] = [
    [16, (c) => `CH${c + 1}`, "EDF Annotations"],
    [80, () => "", ""],
    [8, () => "uV", ""],
    [8, () => "-3276.8", "-1"],
    [8, () => "3276.7", "1"],
    [8, () => "-32768", "-32768"],
    [8, () => "32767", "32767"],
    [80, () => "", ""],
    [8, () => String(rateHz), String(ANNOTATION_SAMPLES)],
    [32, () => "", ""],
  ];
  let at = 256;
  for (const [width, cell, annotation] of columns) {
    for (let c = 0; c < signals; c++, at += width) put(at, c < channels ? cell(c) : annotation, width);
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
  const signals = signalsOf(spec);
  const sines = table();
  const spike = SPIKE_S * rateHz;
  // The data byte at dst[pos]; `pos` goes to -1 when a sample starts one byte before the range.
  const at = offset + pos - header.length;
  const sample0 = Math.floor(at / 2);
  pos -= at % 2;
  // Position in the record: signal `channel` (the annotation channel is number `channels`) and its sample `i`.
  const perRecord = recordSamples(spec);
  let record = Math.floor(sample0 / perRecord);
  const within = sample0 - record * perRecord;
  let channel = within < channels * rateHz ? Math.floor(within / rateHz) : channels;
  let i = within - channel * rateHz;
  let slot: { record: number; bytes: Uint8Array } = { record: -1, bytes: new Uint8Array(0) };
  while (pos < dst.length) {
    const n = record * rateHz + i;
    let v = 0;
    if (channel === channels) {
      if (slot.record !== record) slot = { record, bytes: annotationSlot(record) };
      v = slot.bytes[2 * i] | (slot.bytes[2 * i + 1] << 8);
    } else if (n > 0 && n % spike === 0) v = SPIKE * (channel % 2 ? -1 : 1);
    else {
      for (let q = 3 * channel; q < 3 * channel + 3; q++) {
        v +=
          (sines[((Math.imul(n, w.step[q]) + w.phase[q]) | 0) >>> (32 - PHASE_BITS)] * w.amplitude[q]) >> 15;
      }
    }
    if (pos >= 0) dst[pos] = v & 255;
    if (pos + 1 < dst.length) dst[pos + 1] = (v >> 8) & 255;
    pos += 2;
    if (++i === (channel === channels ? ANNOTATION_SAMPLES : rateHz)) {
      i = 0;
      if (++channel === signals) {
        channel = 0;
        record++;
      }
    }
  }
}
