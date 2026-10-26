// The performance contracts of the spec, measured in Chromium on this machine. Machine-sensitive: they run only in
// the `perf` project (`npm run test:perf`), never by default, and print what they measure.
import {
  firstViewportMs,
  gb,
  LARGE,
  LARGE_PATH,
  type MemorySample,
  memory,
  openDay,
  PANS,
  pan,
  scanMemory,
  scanned,
  scanThroughput,
  start,
  walkGapMs,
  widenPlot,
  writeSynthetic,
} from "./perfMeasures";
import { showFixture } from "./resultFixture";
import { expect, test } from "./test";

const report = (name: string, value: string) => {
  test.info().annotations.push({ type: name, description: value });
  console.log(`${name}: ${value}`);
};

test.beforeAll(() => writeSynthetic(LARGE, LARGE_PATH));

test.beforeEach(({ page }) => start(page));

test("first_viewport_under_500ms", async ({ page }) => {
  const ms = await firstViewportMs(page);
  report("first viewport", `${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(500);
});

test("scan_throughput_over_500mb_s", async ({ page }) => {
  test.setTimeout(300_000);
  const { mbPerS, seconds } = await scanThroughput(page);
  report("scan throughput", `${mbPerS.toFixed(0)} MB/s over ${seconds.toFixed(1)} s`);
  expect(mbPerS).toBeGreaterThan(500);
});

test("pan_p95_under_16ms", async ({ page }) => {
  test.setTimeout(600_000);
  await widenPlot(page);
  for (const [spanS, mode] of PANS) {
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

test("memory_under_1_5gb", async ({ page }) => {
  test.setTimeout(300_000);
  const { midScan, peak, end } = await scanMemory(page);
  report("memory, 2 GiB file mid-scan", `${gb(peak)}, asked at ${(100 * midScan).toFixed(0)}% scanned`);
  report("memory, 2 GiB file scanned", gb(end));
  expect(midScan).toBeLessThan(1);
  for (const sample of [peak, end]) expect(sample.js + sample.wasm).toBeLessThan(1.5e9);
});

// The walk of 5,000 files, their classification and the folder tree of their 2,142 rows (folder.spec.ts checks the
// tree) hold the page for at most 200 ms at a time.
test("walk_of_5000_files_keeps_the_page_responsive", async ({ page }) => {
  test.setTimeout(180_000);
  const ms = await walkGapMs(page);
  report("longest pause, walk of 5,000 files", `${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(200);
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
  const samples: MemorySample[] = [];
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
  const total = (sample: MemorySample) => sample.js + sample.wasm;
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
