// The measurements behind the spec's performance contracts, in Chromium on this machine: e2e/perf.spec.ts holds them
// to the contracts, e2e/bench.spec.ts records them.
import { closeSync, existsSync, openSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { readSynthetic, type SyntheticSpec, syntheticEdfSize } from "../src/core/synthetic";

/** 24 h of 256 channels at 2 kHz: an 88 GB EDF whose bytes are computed as they are read. */
export const DAY = { channels: 256, rateHz: 2000, durationS: 86_400, seed: 1 };
/** 64 channels at 1024 Hz for 16,384 s: 2 GiB of samples. */
export const LARGE = { channels: 64, rateHz: 1024, durationS: 16_384, seed: 9 };
export const LARGE_PATH = join(tmpdir(), "ddalab-perf-2gib.edf");
/** Pan spans and their draw modes: 300 s spans draw level 0 tiles, 20 s spans (10.4 samples per pixel) raw spans. */
export const PANS = [
  [300, "tile"],
  [20, "rawSpan"],
] as const;

/** Writes the synthetic EDF of `spec` to `path` unless a file of its size is there already. */
export function writeSynthetic(spec: SyntheticSpec, path: string) {
  const size = syntheticEdfSize(spec);
  if (existsSync(path) && statSync(path).size === size) return;
  const file = openSync(path, "w");
  const chunk = Buffer.alloc(16 * 2 ** 20);
  for (let offset = 0; offset < size; offset += chunk.length) {
    const part = chunk.subarray(0, Math.min(chunk.length, size - offset));
    readSynthetic(spec, offset, part);
    writeSync(file, part);
  }
  closeSync(file);
}

/**
 * 5,000 files in the origin private file system, behind `showDirectoryPicker`: 714 subjects with two runs (an EDF with
 * its channels and events tables each) and a scans table, and the dataset's description and participants. Returns
 * how many files it made.
 */
export const bigFolder = (page: Page) =>
  page.evaluate(async () => {
    const big = await (await navigator.storage.getDirectory()).getDirectoryHandle("big", { create: true });
    const top = ["dataset_description.json", "participants.tsv"];
    await Promise.all(top.map((name) => big.getFileHandle(name, { create: true })));
    let count = top.length;
    for (let s = 1; s <= 714; s++) {
      const sub = `sub-${String(s).padStart(3, "0")}`;
      const folder = await big.getDirectoryHandle(sub, { create: true });
      const eeg = await folder.getDirectoryHandle("eeg", { create: true });
      const names = [1, 2].flatMap((run) =>
        ["eeg.edf", "channels.tsv", "events.tsv"].map((end) => `${sub}_task-rest_run-${run}_${end}`),
      );
      await Promise.all(names.map((name) => eeg.getFileHandle(name, { create: true })));
      await folder.getFileHandle(`${sub}_scans.tsv`, { create: true });
      count += names.length + 1;
    }
    Object.assign(window, { showDirectoryPicker: async () => big });
    return count;
  });

/** Opens the folder of `bigFolder` and waits for its tree and its count of 1,428 recordings. */
export async function openBigFolder(page: Page) {
  await page.getByRole("button", { name: "Open folder" }).click();
  const tree = page.getByRole("tree", { name: "Recordings in big" });
  await expect(tree).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Folder 1428" })).toBeVisible();
  return tree;
}

/** The longest gap between timer tasks, in ms, while the folder of `bigFolder` is walked and shown as a tree. */
export async function walkGapMs(page: Page) {
  expect(await bigFolder(page)).toBe(5000);
  await page.evaluate(() => {
    const probe = { gap: 0, stop: false };
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      probe.gap = Math.max(probe.gap, now - last);
      last = now;
      if (!probe.stop) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    Object.assign(window, { gapProbe: probe });
  });
  await openBigFolder(page);
  return page.evaluate(() => {
    const { gapProbe } = window as unknown as { gapProbe: { gap: number; stop: boolean } };
    gapProbe.stop = true;
    return gapProbe.gap;
  });
}

/** The page with the engine started, opening files through the file input. */
export async function start(page: Page) {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("/");
  await page.evaluate(() => window.__ddalab.engine.version());
}

export const openDay = (page: Page) => page.evaluate((spec) => window.__ddalab.openSynthetic(spec), DAY);

/** Milliseconds from opening the 24 h recording to its first complete frame. */
export const firstViewportMs = (page: Page) =>
  page.evaluate(async (spec) => {
    const start = performance.now();
    await window.__ddalab.openSynthetic(spec);
    await window.__ddalab.viewer.settled();
    return performance.now() - start;
  }, DAY);

/** Opens the 2 GiB EDF by the file picker: its size over the wall time of the scan, in MB/s, and that time. */
export async function scanThroughput(page: Page) {
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
    { timeout: 280_000 },
  );
  const [start, end] = await page.evaluate(() => (window as unknown as { scanTimes: number[] }).scanTimes);
  const seconds = (end - start) / 1000;
  return { mbPerS: statSync(LARGE_PATH).size / 1e6 / seconds, seconds };
}

/** Widens the plot to 1920 CSS px (3,840 device px at ratio 2) with the 24 h recording open, for `pan`. */
export async function widenPlot(page: Page) {
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Inspector" }).click();
  await openDay(page);
  const plotWidth = await page.evaluate(async () => (await window.__ddalab.viewer.settled()).cssWidth);
  const viewport = page.viewportSize() as { width: number; height: number };
  await page.setViewportSize({ width: viewport.width + 1920 - plotWidth, height: viewport.height });
}

/**
 * Pans `steps` frames of `spanS` seconds by 1% of the span each after every frame of the range is cached; returns
 * the whole-frame times (paint start to GPU done) and the frames that lacked planned data or drew blank columns.
 */
export async function pan(page: Page, spanS: number, steps: number) {
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

export type MemorySample = { js: number; wasm: number };

/** JS heaps of the page and its workers, plus every worker's wasm memory, in bytes. */
export const memory = (page: Page): Promise<MemorySample> =>
  page.evaluate(async () => {
    const measure = (
      performance as unknown as { measureUserAgentSpecificMemory(): Promise<{ bytes: number }> }
    ).measureUserAgentSpecificMemory();
    const [js, wasm] = await Promise.all([measure, window.__ddalab.engine.wasmBytes()]);
    return { js: js.bytes, wasm: wasm.io + wasm.hash + wasm.annotations };
  });
export const gb = (sample: MemorySample) =>
  `${((sample.js + sample.wasm) / 1e9).toFixed(2)} GB (JS ${(sample.js / 1e9).toFixed(2)}, wasm ${(sample.wasm / 1e9).toFixed(2)})`;

/** The scanned part of the active recording; 0 before it is open, -1 when the scan failed. */
export const scanned = (page: Page) =>
  page.evaluate(() => {
    const s = window.__ddalab.store.getState();
    const scan = s.recordings[s.activeRecordingId as string]?.scan;
    return !scan ? 0 : scan.error ? -1 : scan.scannedRows / scan.totalRows;
  });

/**
 * Memory while the 2 GiB file on disk is scanned (its reads go through the engine's file cache): sampled mid-scan,
 * with the pyramid builder busy and the plot drawing raw rows, and once the scan is over. `midScan` is the scanned
 * part when the first sample was asked for.
 */
export async function scanMemory(page: Page) {
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
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
  return { midScan, peak, end: await memory(page) };
}
