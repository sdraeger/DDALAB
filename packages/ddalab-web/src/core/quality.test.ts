import { expect, test } from "vitest";
import { assessChannelQuality, qualitySummary } from "./quality";

test("detects_clean_flat_clipped_and_mains_noise_channels", () => {
  const rateHz = 250;
  const rows = 5 * rateHz; // 5 s
  const nChannels = 5;
  const buf = new Float32Array(rows * nChannels);

  for (let r = 0; r < rows; r++) {
    const t = r / rateHz;
    // ch 0: clean physiological mix (10 Hz alpha + 4 Hz theta)
    buf[r * nChannels + 0] = Math.sin(2 * Math.PI * 10 * t) + 0.6 * Math.sin(2 * Math.PI * 4 * t);
    // ch 1: flatline / disconnected
    buf[r * nChannels + 1] = 42.0;
    // ch 2: rail-clipped sinusoid (15% clipped at +/-0.5)
    buf[r * nChannels + 2] = Math.max(-0.5, Math.min(0.5, 2.0 * Math.sin(2 * Math.PI * 3 * t)));
    // ch 3: heavy 60 Hz US mains hum
    buf[r * nChannels + 3] = 2.0 * Math.sin(2 * Math.PI * 60 * t) + 0.2 * Math.sin(2 * Math.PI * 9 * t);
    // ch 4: heavy 50 Hz EU mains hum
    buf[r * nChannels + 4] = 2.0 * Math.sin(2 * Math.PI * 50 * t) + 0.2 * Math.sin(2 * Math.PI * 9 * t);
  }

  const res = assessChannelQuality(buf, nChannels, rateHz);
  expect(res).toHaveLength(5);
  expect(res[0].flags).toEqual([]);
  expect(res[1].flags).toEqual(["flat"]);
  expect(res[2].flags).toEqual(["clipped"]);
  expect(res[3].flags).toEqual(["60 Hz"]);
  expect(res[3].line60Fraction).toBeGreaterThan(0.8);
  expect(res[4].flags).toEqual(["50 Hz"]);
  expect(res[4].line50Fraction).toBeGreaterThan(0.8);
  expect(qualitySummary(res[3])).toContain("60 Hz");
});
