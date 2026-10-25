// The performance contracts of the spec, measured in Chromium on this machine. Machine-sensitive: they run only in
// the `perf` project (`npm run test:perf`), never by default, and print what they measure.
import { closeSync, existsSync, openSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { readSynthetic, syntheticEdfSize } from "../src/core/synthetic";
import { showFixture } from "./resultFixture";

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

/**
 * Pans `steps` frames of `spanS` seconds by 1% of the span each after every frame of the range is cached; returns
 * the whole-frame times (paint start to GPU done) and the frames that lacked planned data or drew blank columns.
 */
async function pan(page: Page, spanS: number, steps: number) {
  const stepS = spanS / 100;
  const frame = await page.evaluate(async (span) => {
    window.__ddalab.store.setState((s) => ({ view: { ...s.view, t0: 0, t1: span, rowCount: 64 } }));
    return window.__ddalab.viewer.settled();
  }, spanS);
  expect(frame.width).toBeGreaterThanOrEqual(3840);
  expect(frame.rowCount).toBe(64);
  // Every frame of the range is cached first.
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
      new Promise<{ ms: number; complete: boolean; blank: number }[]>((done) => {
        const { store, viewer } = window.__ddalab;
        store.setState((s) => ({ view: { ...s.view, t0: 0, t1: span } }));
        viewer.frames = [];
        let i = 0;
        const tick = () => {
          if (i++ === n) {
            const recorded = viewer.frames ?? [];
            viewer.frames = null;
            return done(recorded);
          }
          store.setState((s) => ({ view: { ...s.view, t0: s.view.t0 + step, t1: s.view.t1 + step } }));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [spanS, steps, stepS],
  );
  const sorted = frames.map((f) => f.ms).sort((a, b) => a - b);
  return {
    mode: frame.mode,
    count: sorted.length,
    p95: sorted[Math.floor(0.95 * (sorted.length - 1))],
    median: sorted[sorted.length >> 1],
    incomplete: frames.filter((f) => !f.complete).length,
    blank: frames.filter((f) => f.blank > 0).length,
  };
}

test("pan_p95_under_16ms", async ({ page }) => {
  test.setTimeout(600_000);
  // A plot 1920 CSS px wide at device pixel ratio 2: 3,840 device px.
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Inspector" }).click();
  await openDay(page);
  const plotWidth = await page.evaluate(async () => (await window.__ddalab.viewer.settled()).cssWidth);
  const viewport = page.viewportSize() as { width: number; height: number };
  await page.setViewportSize({ width: viewport.width + 1920 - plotWidth, height: viewport.height });
  // 300 s spans draw level 0 tiles; 20 s spans (10.4 samples per pixel) draw raw spans.
  for (const [spanS, mode] of [
    [300, "tile"],
    [20, "rawSpan"],
  ] as const) {
    const result = await pan(page, spanS, 300);
    report(
      `pan ${mode}`,
      `p95 ${result.p95.toFixed(2)} ms, median ${result.median.toFixed(2)} ms over ${result.count} frames`,
    );
    expect(result.mode).toBe(mode);
    expect(result.count).toBeGreaterThanOrEqual(299);
    expect(result).toMatchObject({ incomplete: 0, blank: 0 });
    expect(result.p95).toBeLessThan(16);
  }
});

/** JS heaps of the page and its workers, plus every worker's wasm memory, in bytes. */
const memory = (page: Page) =>
  page.evaluate(async () => {
    const measure = (
      performance as unknown as { measureUserAgentSpecificMemory(): Promise<{ bytes: number }> }
    ).measureUserAgentSpecificMemory();
    const [js, wasm] = await Promise.all([measure, window.__ddalab.engine.wasmBytes()]);
    return { js: js.bytes, wasm: wasm.io + wasm.hash + wasm.annotations };
  });
const gb = (sample: { js: number; wasm: number }) =>
  `${((sample.js + sample.wasm) / 1e9).toFixed(2)} GB (JS ${(sample.js / 1e9).toFixed(2)}, wasm ${(sample.wasm / 1e9).toFixed(2)})`;

/** The scanned part of the active recording; 0 before it is open, -1 when the scan failed. */
const scanned = (page: Page) =>
  page.evaluate(() => {
    const s = window.__ddalab.store.getState();
    const scan = s.recordings[s.activeRecordingId as string]?.scan;
    return !scan ? 0 : scan.error ? -1 : scan.scannedRows / scan.totalRows;
  });

test("memory_under_1_5gb", async ({ page }) => {
  test.setTimeout(300_000);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  // The 2 GiB file on disk: its reads go through the engine's file cache. Sampled mid-scan, with the pyramid
  // builder busy and the plot drawing raw rows, and once the scan is over.
  await page.getByLabel("Recording files").setInputFiles(LARGE_PATH);
  await expect.poll(() => scanned(page), { timeout: 60_000, intervals: [20] }).toBeGreaterThan(0.05);
  // The plot reads raw rows of 64 channels while the measurement is taken (wasm memory only grows: the sample at
  // the end holds the scan's high-water mark too).
  await page.evaluate(() =>
    window.__ddalab.store.setState((s) => ({ view: { ...s.view, t0: 8000, t1: 8030, rowCount: 64 } })),
  );
  const midScan = await scanned(page);
  const peak = await memory(page);
  await expect.poll(() => scanned(page), { timeout: 120_000 }).toBe(1);
  const end = await memory(page);
  report("memory, 2 GiB file mid-scan", `${gb(peak)}, asked at ${(100 * midScan).toFixed(0)}% scanned`);
  report("memory, 2 GiB file scanned", gb(end));
  expect(midScan).toBeLessThan(1);
  for (const sample of [peak, end]) expect(sample.js + sample.wasm).toBeLessThan(1.5e9);
});

// The 24 h synthetic recording, 88 GB, in a context of its own. A Playwright context stores less than its 3.7 GB
// pyramid: the scan stops with the quota message part way, which is reported, and memory is sampled there.
test("memory_after_the_24h_scan_under_1_5gb", async ({ page }) => {
  test.setTimeout(1_200_000);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await openDay(page);
  const progress = () =>
    page.evaluate(() => {
      const s = window.__ddalab.store.getState();
      const scan = s.recordings[s.activeRecordingId as string]?.scan;
      return scan ? { part: scan.scannedRows / scan.totalRows, error: scan.error ?? null } : null;
    });
  await expect
    .poll(
      async () => {
        const now = await progress();
        return now !== null && (now.part === 1 || now.error !== null);
      },
      { timeout: 1_100_000, intervals: [1000] },
    )
    .toBe(true);
  const stopped = await progress();
  const day = await memory(page);
  const where = stopped?.error
    ? `scan stopped at ${(100 * stopped.part).toFixed(0)}%: ${stopped.error}`
    : "scanned";
  report("memory, 24 h recording", `${gb(day)}, ${where}`);
  expect(stopped?.part).toBeGreaterThan(0.25);
  expect(day.js + day.wasm).toBeLessThan(1.5e9);
});

// A day-long result of 86,400 windows of 1,200 rows: 0.83 GB of f64, as much as a Playwright context stores beside its
// pyramid (it keeps OPFS in memory and refuses a file past about 1.28 GiB). The pyramid, 138 MB as f32, is built into
// OPFS files beside the array; viewing it at every zoom adds only the heatmap's tile cache (64 MiB at most) and
// transient buffers to memory, where holding the pyramid would add all of it.
test("result_memory_bounded", async ({ page }) => {
  test.setTimeout(900_000);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 2, rateHz: 100, durationS: 86_400, seed: 3 }),
  );
  await expect.poll(() => scanned(page), { timeout: 120_000 }).toBe(1);
  const before = await memory(page);
  const [windows, rows] = [86_400, 1200];
  const labels = Array.from({ length: rows }, (_, r) => `P${Math.floor(r / 60) + 1} & Q${(r % 60) + 1}`);
  const values: [number, number, number][] = [[43_210, 1000, -50]];
  const started = Date.now();
  await showFixture(page, { id: "large", windows, rows, first: 0.5, step: 1, values, labels });
  const written = Date.now();
  await expect(
    page.getByRole("status").filter({ hasText: "Building the zoomed-out levels of Q" }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Building the zoomed-out levels" })).toHaveCount(
    0,
    {
      timeout: 600_000,
    },
  );
  report(
    "result fixture",
    `written in ${(written - started) / 1000} s, pyramid built in ${(Date.now() - written) / 1000} s`,
  );
  const samples: { js: number; wasm: number }[] = [];
  for (const [t0, t1] of [
    [0, 86_400],
    [20_000, 40_000],
    [30_000, 31_000],
    [43_180, 43_240],
  ]) {
    await page.evaluate((v) => window.__ddalab.store.setState((s) => ({ view: { ...s.view, ...v } })), {
      t0,
      t1,
    });
    await page.evaluate(() => window.__ddalab.results.settled());
    samples.push(await memory(page));
  }
  const total = (sample: { js: number; wasm: number }) => sample.js + sample.wasm;
  const peak = samples.reduce((a, b) => (total(b) > total(a) ? b : a));
  const stored = await page.evaluate(async () => {
    const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results");
    const st = await (await results.getDirectoryHandle("large")).getDirectoryHandle("ST");
    let bytes = 0;
    for await (const [name, entry] of st.entries()) {
      if (name.endsWith(".f32")) bytes += (await (entry as FileSystemFileHandle).getFile()).size;
    }
    return bytes;
  });
  report("memory, before the result", gb(before));
  report("memory, viewing the result", `${gb(peak)}, pyramid files ${(stored / 1e6).toFixed(0)} MB in OPFS`);
  expect(stored).toBeGreaterThan(130e6);
  expect(total(peak) - total(before)).toBeLessThan(128e6);
  expect(total(peak)).toBeLessThan(1.5e9);
});
