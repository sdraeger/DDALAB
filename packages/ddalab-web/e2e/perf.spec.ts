// The performance contracts of the spec, measured in Chromium on this machine. Machine-sensitive: they run only in
// the `perf` project (`npm run test:perf`), never by default, and print what they measure.
import { closeSync, existsSync, openSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { readSynthetic, syntheticEdfSize } from "../src/core/synthetic";

/** 24 h of 256 channels at 2 kHz: an 88 GB EDF that is computed, never stored. */
const DAY = { channels: 256, rateHz: 2000, durationS: 86_400, seed: 1 };
/** 64 channels at 1024 Hz for 16,384 s: 2 GiB of samples. */
const LARGE = { channels: 64, rateHz: 1024, durationS: 16_384, seed: 9 };
const LARGE_PATH = join(tmpdir(), "ddalab-perf-2gib.edf");

const report = (name: string, value: string) => {
  test.info().annotations.push({ type: name, description: value });
  console.log(`${name}: ${value}`);
};

test.beforeAll(() => {
  const size = syntheticEdfSize(LARGE);
  if (existsSync(LARGE_PATH) && statSync(LARGE_PATH).size === size) return;
  const file = openSync(LARGE_PATH, "w");
  const chunk = Buffer.alloc(16 * 2 ** 20);
  for (let offset = 0; offset < size; offset += chunk.length) {
    const part = chunk.subarray(0, Math.min(chunk.length, size - offset));
    readSynthetic(LARGE, offset, part);
    writeSync(file, part);
  }
  closeSync(file);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("/");
  await page.evaluate(() => window.__ddalab.engine.version());
});

const openDay = (page: Page) => page.evaluate((spec) => window.__ddalab.openSynthetic(spec), DAY);

test("first_viewport_under_500ms", async ({ page }) => {
  const ms = await page.evaluate(async (spec) => {
    const start = performance.now();
    await window.__ddalab.openSynthetic(spec);
    await window.__ddalab.viewer.settled();
    return performance.now() - start;
  }, DAY);
  report("first viewport", `${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(500);
});

test("scan_throughput_over_500mb_s", async ({ page }) => {
  test.setTimeout(300_000);
  await page.evaluate(() => {
    const times: number[] = [];
    Object.assign(window, { scanTimes: times });
    window.__ddalab.store.subscribe((state) => {
      const recording = Object.values(state.recordings)[0];
      if (!recording) return;
      if (times.length === 0) times.push(performance.now());
      if (recording.scan.scannedRows === recording.scan.totalRows && times.length === 1)
        times.push(performance.now());
    });
  });
  await page.getByLabel("Recording files").setInputFiles(LARGE_PATH);
  await page.waitForFunction(
    () => (window as unknown as { scanTimes: number[] }).scanTimes.length === 2,
    null,
    {
      timeout: 280_000,
    },
  );
  const [start, end] = await page.evaluate(() => (window as unknown as { scanTimes: number[] }).scanTimes);
  const mbPerS = statSync(LARGE_PATH).size / 1e6 / ((end - start) / 1000);
  report("scan throughput", `${mbPerS.toFixed(0)} MB/s over ${((end - start) / 1000).toFixed(1)} s`);
  expect(mbPerS).toBeGreaterThan(500);
});

test("pan_p95_under_16ms", async ({ page }) => {
  test.setTimeout(300_000);
  // A plot 1920 CSS px wide at device pixel ratio 2: 3,840 device px.
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Inspector" }).click();
  await openDay(page);
  const plotWidth = await page.evaluate(async () => (await window.__ddalab.viewer.settled()).cssWidth);
  const viewport = page.viewportSize() as { width: number; height: number };
  await page.setViewportSize({ width: viewport.width + 1920 - plotWidth, height: viewport.height });
  const spanS = 300;
  const steps = 300;
  const stepS = spanS / 100;
  const frame = await page.evaluate(async (span) => {
    window.__ddalab.store.setState((s) => ({ view: { ...s.view, t0: 0, t1: span, rowCount: 64 } }));
    return window.__ddalab.viewer.settled();
  }, spanS);
  expect(frame.width).toBeGreaterThanOrEqual(3840);
  expect(frame.rowCount).toBe(64);
  // Every tile of the panned range is cached first.
  for (let t0 = 0; t0 <= steps * stepS + spanS; t0 += spanS / 2) {
    await page.evaluate(
      async ([t, span]) => {
        window.__ddalab.store.setState((s) => ({ view: { ...s.view, t0: t, t1: t + span } }));
        await window.__ddalab.viewer.settled();
      },
      [t0, spanS],
    );
  }
  const frames = await page.evaluate(
    ([span, n, step]) =>
      new Promise<{ ms: number[]; incomplete: number }>((done) => {
        const { store, viewer } = window.__ddalab;
        store.setState((s) => ({ view: { ...s.view, t0: 0, t1: span } }));
        viewer.timing = [];
        let i = 0;
        const tick = () => {
          if (i++ === n) {
            const timing = viewer.timing ?? [];
            viewer.timing = null;
            return done({
              ms: timing.map((t) => t.ms),
              incomplete: timing.filter((t) => !t.complete).length,
            });
          }
          store.setState((s) => ({ view: { ...s.view, t0: s.view.t0 + step, t1: s.view.t1 + step } }));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [spanS, steps, stepS],
  );
  const sorted = [...frames.ms].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
  report(
    "pan",
    `p95 ${p95.toFixed(2)} ms, median ${sorted[sorted.length >> 1].toFixed(2)} ms over ${sorted.length} frames`,
  );
  expect(sorted.length).toBeGreaterThanOrEqual(steps - 1);
  expect(frames.incomplete).toBe(0);
  expect(p95).toBeLessThan(16);
});

test("memory_under_1_5gb", async ({ page }) => {
  test.setTimeout(1_200_000);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await openDay(page);
  await page.waitForFunction(
    () => {
      const s = window.__ddalab.store.getState();
      const { scan } = s.recordings[s.activeRecordingId as string];
      return scan.scannedRows === scan.totalRows || scan.error;
    },
    null,
    { timeout: 1_150_000, polling: 1000 },
  );
  const bytes = await page.evaluate(async () => {
    const measure = (
      performance as unknown as { measureUserAgentSpecificMemory(): Promise<{ bytes: number }> }
    ).measureUserAgentSpecificMemory();
    return (await measure).bytes;
  });
  report("memory after the 24 h scan", `${(bytes / 1e9).toFixed(2)} GB`);
  expect(bytes).toBeLessThan(1.5e9);
});
