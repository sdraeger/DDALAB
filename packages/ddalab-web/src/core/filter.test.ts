import { expect, test } from "vitest";
import { applyFilter, type Filter, filterLabel, padRows } from "./filter";

const RATE = 500;
const OFF: Filter = { highpassHz: null, lowpassHz: null, notchHz: null };

/** `rows` samples of sines at `hz` (amplitude 1 each) plus `offset`, `channels` identical columns, row-major. */
function sines(hz: number[], rows: number, channels = 1, offset = 0) {
  const x = new Float32Array(rows * channels);
  for (let r = 0; r < rows; r++) {
    const v = offset + hz.reduce((sum, f) => sum + Math.sin((2 * Math.PI * f * r) / RATE), 0);
    for (let c = 0; c < channels; c++) x[r * channels + c] = v;
  }
  return x;
}

/** The amplitude of `hz` in column 0 of the middle half, by projection on sine and cosine. */
function amplitude(x: Float32Array, hz: number, channels = 1) {
  const rows = x.length / channels;
  let s = 0;
  let c = 0;
  let n = 0;
  for (let r = rows / 4; r < (3 * rows) / 4; r++, n++) {
    s += x[r * channels] * Math.sin((2 * Math.PI * hz * r) / RATE);
    c += x[r * channels] * Math.cos((2 * Math.PI * hz * r) / RATE);
  }
  return (2 * Math.hypot(s, c)) / n;
}

test("notch_removes_line_noise_and_keeps_alpha", () => {
  const x = sines([10, 60], 5000);
  const y = applyFilter(x, 1, RATE, { ...OFF, notchHz: 60 });
  expect(amplitude(y, 60)).toBeLessThan(0.01);
  expect(amplitude(y, 10)).toBeCloseTo(1, 2);
});

test("notch_removes_harmonics", () => {
  const y = applyFilter(sines([10, 120, 180], 5000), 1, RATE, { ...OFF, notchHz: 60 });
  expect(amplitude(y, 120)).toBeLessThan(0.01);
  expect(amplitude(y, 180)).toBeLessThan(0.01);
});

test("highpass_removes_offset_and_drift", () => {
  const y = applyFilter(sines([0.05, 10], 10000, 1, 300), 1, RATE, { ...OFF, highpassHz: 1 });
  expect(amplitude(y, 0.05)).toBeLessThan(0.02);
  expect(amplitude(y, 10)).toBeCloseTo(1, 2);
  expect(Math.abs(y[5000])).toBeLessThan(2); // the 300 offset is gone
});

test("lowpass_removes_fast_and_keeps_slow", () => {
  const y = applyFilter(sines([5, 150], 5000), 1, RATE, { ...OFF, lowpassHz: 30 });
  expect(amplitude(y, 150)).toBeLessThan(0.001);
  expect(amplitude(y, 5)).toBeCloseTo(1, 2);
});

// Zero phase: the band's edge passes at half power (-3 dB per pass, -6 dB both ways) and the peaks stay in place.
test("bandpass_is_zero_phase_at_cutoffs", () => {
  const band = { ...OFF, highpassHz: 8, lowpassHz: 13 };
  expect(amplitude(applyFilter(sines([8], 10000), 1, RATE, band), 8)).toBeCloseTo(0.5, 1);
  expect(amplitude(applyFilter(sines([13], 10000), 1, RATE, band), 13)).toBeCloseTo(0.5, 1);
  const x = sines([10], 5000);
  const y = applyFilter(x, 1, RATE, band);
  let lag = 0;
  for (let k = -5, best = -Infinity; k <= 5; k++) {
    let sum = 0;
    for (let r = 1000; r < 4000; r++) sum += x[r] * y[r + k];
    if (sum > best) [best, lag] = [sum, k];
  }
  expect(lag).toBe(0);
});

test("filters_each_channel_alone", () => {
  const x = sines([60], 4000, 3);
  for (let r = 0; r < 4000; r++) x[r * 3 + 1] = 5; // a flat channel between two hum channels
  const y = applyFilter(x, 3, RATE, { ...OFF, notchHz: 60, lowpassHz: 40 });
  for (let r = 0; r < 4000; r += 97) expect(y[r * 3 + 1]).toBeCloseTo(5, 4);
  expect(
    amplitude(
      y.filter((_, i) => i % 3 === 2),
      60,
    ),
  ).toBeLessThan(0.01);
});

test("off_returns_input_and_cutoffs_past_nyquist_are_skipped", () => {
  const x = sines([10], 1000);
  expect(applyFilter(x, 1, RATE, OFF)).toBe(x);
  expect(applyFilter(x, 1, RATE, { ...OFF, lowpassHz: 300 })).toBe(x);
  expect(padRows(OFF, RATE)).toBe(0);
  expect(padRows({ ...OFF, highpassHz: 1 }, RATE)).toBeGreaterThanOrEqual(3 * RATE);
});

test("labels_the_settings", () => {
  expect(filterLabel(OFF)).toBe("Off");
  expect(filterLabel({ highpassHz: 0.5, lowpassHz: 70, notchHz: 60 })).toBe("0.5–70 Hz, 60 Hz notch");
  expect(filterLabel({ ...OFF, highpassHz: 1 })).toBe("High-pass 1 Hz");
  expect(filterLabel({ ...OFF, lowpassHz: 40 })).toBe("Low-pass 40 Hz");
});
