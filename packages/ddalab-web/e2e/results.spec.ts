// The result views: the heatmap on the waveform's time axis, its max-magnitude pyramid when zoomed out, the row plot
// and the variant tabs. Results come from runs of the BrainVision fixture (equal to the CLI bundles of global-setup.ts,
// which e2e/analysis.spec.ts checks) and from a result written straight into OPFS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResultDocument } from "../src/core/types";
import { colorIndex, LUTS, type MapName } from "../src/render/colormaps";
import { FANOUT, resultLevels } from "../src/render/resultPyramid";
import type { View } from "../src/store/store";
import { type Bundle, bundleDir } from "./global-setup";
import { type Fixture, showFixture } from "./resultFixture";
import { expect, type Page, test } from "./test";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));
const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map(fixturePath);

// Playwright's WebKit has no OPFS (getDirectory throws UnknownError); Safari itself has.
const hasStorage = (page: Page) =>
  page.evaluate(() =>
    navigator.storage.getDirectory().then(
      () => true,
      () => false,
    ),
  );
const NO_STORAGE = "this browser window has no OPFS";

const settings = (page: Page) => page.getByRole("region", { name: "DDA settings" });
const runBar = (page: Page) => page.getByRole("region", { name: "Run" });
const result = (page: Page) => page.getByRole("region", { name: "Result" });
const setView = (page: Page, change: Partial<View>) =>
  page.evaluate((c) => window.__ddalab.store.setState((s) => ({ view: { ...s.view, ...c } })), change);

/** Runs `variants` on Fp1 and Fp2 of the BrainVision fixture from 1 s to 5 s, the requests of global-setup.ts. */
async function runFixture(page: Page, variants: string[]) {
  await page.getByLabel("Recording files").setInputFiles(BRAINVISION);
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await page.getByRole("checkbox", { name: "Select Fp2" }).check();
  for (const variant of ["ST", "CT", "CD", "DE", "SY"]) {
    await settings(page)
      .getByRole("checkbox", { name: variant, exact: true })
      .setChecked(variants.includes(variant));
  }
  await runBar(page).getByLabel("Start", { exact: true }).fill("1");
  await runBar(page).getByLabel("End", { exact: true }).fill("5");
  await runBar(page).getByLabel("End", { exact: true }).press("Enter");
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(result(page)).toBeVisible();
}

/** A `.npy` file of the CLI bundle: window-major f64 of shape (windows, rows). */
function npy(bundle: Bundle, path: string) {
  const bytes = readFileSync(join(bundleDir(bundle), path));
  const start = 10 + bytes.readUInt16LE(8);
  const shape = /'shape': \((\d+), (\d+)\)/.exec(bytes.toString("latin1", 10, start));
  if (!shape) throw new Error(`${path} has no two-dimensional shape`);
  const [windows, rows] = shape.slice(1).map(Number);
  const values = new Float64Array(
    bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + bytes.length),
  );
  return { windows, rows, values, at: (w: number, r: number) => values[w * rows + r] };
}

const manifest = (bundle: Bundle): ResultDocument =>
  JSON.parse(readFileSync(join(bundleDir(bundle), "manifest.json"), "utf8"));

/** The window whose center is nearest `t`. */
const nearest = (centers: number[], t: number) =>
  centers.reduce((best, c, i) => (Math.abs(c - t) < Math.abs(centers[best] - t) ? i : best), 0);

/** Whether an RGBA pixel is the LUT entry of `value`, or one either side (float32 arithmetic on the GPU). */
function shows(pixel: number[], map: MapName, value: number, lo: number, hi: number) {
  const k = colorIndex(value, lo, hi);
  return [k - 1, k, k + 1].some(
    (i) => i >= 0 && i < 256 && [0, 1, 2, 3].every((c) => LUTS[map][4 * i + c] === pixel[c]),
  );
}

/** The heatmap after its next complete frame: the frame and, for each result row, its middle pixel row (RGBA). */
const heatmapRows = (page: Page) =>
  page.evaluate(async () => {
    const { results } = window.__ddalab;
    const frame = await results.settled();
    const { width: W, height: H, data } = results.pixels();
    const lines = Array.from({ length: frame.rows }, (_, r) => {
      const y = Math.floor(((r + 0.5) * H) / frame.rows);
      const start = (H - 1 - y) * W * 4;
      return Array.from(data.subarray(start, start + W * 4));
    });
    return { frame, lines };
  });

const pixelAt = (line: number[], x: number) => line.slice(4 * x, 4 * x + 4);

const openTwoHours = (page: Page) =>
  page.evaluate(() => window.__ddalab.openSynthetic({ channels: 4, rateHz: 256, durationS: 7200, seed: 9 }));

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000); // a run of the fixture is part of each test, and may take up to a minute on a busy machine
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("/");
});

test("heatmap_aligns_with_waveform", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await runFixture(page, ["ST"]);
  const q = npy("st", "ST/q.npy");
  const centers = manifest("st").window_centers_seconds;
  // The heatmap's plot spans the waveform's plot: one time axis.
  const traces = await page.locator("canvas[data-traces]").boundingBox();
  const heatmap = await page.locator("canvas[data-heatmap]").boundingBox();
  expect(heatmap?.x).toBe(traces?.x);
  expect(heatmap?.width).toBe(traces?.width);

  const [t0, t1] = [0.9, 4.9];
  await setView(page, { t0, t1 });
  const { frame, lines } = await heatmapRows(page);
  expect(frame).toMatchObject({ variant: "ST", array: "q", level: 0, map: "vik", rows: 2 });
  const m = q.values.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  const step = centers[1] - centers[0];
  const half = 200 / 500 / 2; // the window, 200 samples at 500 Hz, about its center
  const dt = (t1 - t0) / frame.width;
  const failures: string[] = [];
  let checked = 0;
  for (let x = 0; x < frame.width; x++) {
    const t = t0 + (x + 0.5) * dt;
    const i = nearest(centers, t);
    const last = centers[centers.length - 1];
    const outside = t < centers[0] - half || t > last + half;
    // A column within a pixel of the border between two windows, or of the data's ends, may show either side.
    const border = Math.min(
      Math.abs(t - (centers[i] - step / 2)),
      Math.abs(t - (centers[i] + step / 2)),
      Math.abs(t - (centers[0] - half)),
      Math.abs(t - (last + half)),
    );
    if (border < dt) continue;
    for (let r = 0; r < 2; r++) {
      const pixel = pixelAt(lines[r], x);
      const ok = outside ? pixel[3] === 0 : shows(pixel, "vik", q.at(i, r), -m, m);
      if (!ok) failures.push(`t ${t.toFixed(4)} row ${r}: ${pixel} for window ${outside ? "none" : i}`);
      checked++;
    }
  }
  expect(failures).toEqual([]);
  expect(checked).toBeGreaterThan(frame.width);

  // Hovering reads out the window under the pointer: its row, its center and its value.
  const w = 7;
  const box = heatmap as NonNullable<typeof heatmap>;
  await page.mouse.move(box.x + ((centers[w] - t0) / (t1 - t0)) * box.width, box.y + box.height / 4);
  const readout = result(page).getByRole("tooltip");
  await expect(readout).toContainText("Fp1");
  await expect(readout).toContainText(`${centers[w].toFixed(3)} s`);
  await expect(readout).toContainText(q.at(w, 0).toPrecision(4));
});

test("outlier_window_survives_zoom_out", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  // Two hours of four channels and a result of 57,000 windows every 0.125 s: one window of row 2 is -10, the rest
  // lie between 0.2 and 0.6. Vik with symmetric limits draws the outlier as its first entry.
  await openTwoHours(page);
  const fixture = {
    id: "fixture-outlier",
    windows: 57_000,
    rows: 4,
    first: 0.5,
    step: 0.125,
    outlier: 31_415,
    row: 2,
    missing: 31_400,
    values: [
      [31_415, 2, -10],
      [31_400, 0, Number.NaN],
    ] as [number, number, number][],
  };
  await showFixture(page, fixture);
  await expect(result(page)).toBeVisible();

  const center = 0.5 + fixture.outlier * fixture.step;
  const levels = new Set<number>();
  for (const [t0, t1] of [
    [0, 7200],
    [2000, 6000],
    [3600, 4200],
    [3880, 3980],
    [3922, 3932],
  ]) {
    await setView(page, { t0, t1 });
    const { frame, lines } = await heatmapRows(page);
    levels.add(frame.level);
    expect(frame).toMatchObject({ map: "vik", lo: -10, hi: 10, rows: 4 });
    const dt = (t1 - t0) / frame.width;
    const column = (t: number) => Math.floor((t - t0) / dt);
    // Every column the outlier's window reaches draws it; none beyond the cell holding it (and a pixel) does.
    const f = 4 ** frame.level;
    const first = Math.floor(fixture.outlier / f) * f;
    const cell = [
      0.5 + first * fixture.step - fixture.step / 2,
      0.5 + (first + f - 1) * fixture.step + fixture.step / 2,
    ];
    const own = [column(center - fixture.step / 2), column(center + fixture.step / 2 - 1e-9)];
    const reach = [column(cell[0]) - 1, column(cell[1]) + 1];
    const columns = Array.from({ length: frame.width }, (_, x) => x);
    const drawnIn = (r: number) => columns.filter((x) => shows(pixelAt(lines[r], x), "vik", -10, -10, 10));
    const drawn = drawnIn(fixture.row);
    const at = `view ${t0} to ${t1} at level ${frame.level}`;
    expect(
      drawn.some((x) => x >= own[0] && x <= own[1]),
      `${at}: drawn at ${drawn}`,
    ).toBe(true);
    for (let x = own[0] + 1; x < own[1]; x++) expect(drawn, at).toContain(x);
    expect(
      drawn.every((x) => x >= reach[0] && x <= reach[1]),
      `${at}: drawn at ${drawn}`,
    ).toBe(true);
    for (const r of [0, 1, 3]) expect(drawnIn(r), `${at}: row ${r}`).toEqual([]);
  }
  // Zoomed out the pyramid draws; zoomed in the windows themselves do.
  expect(levels.has(0)).toBe(true);
  expect([...levels].some((level) => level >= 2)).toBe(true);
  // A window without a value (NaN, window 31,400 of row 0) draws nothing: its own columns stay transparent.
  const { frame, lines } = await heatmapRows(page);
  const [t0, dt] = [3922, 10 / frame.width];
  const missing = 0.5 + fixture.missing * fixture.step;
  const [x0, x1] = [missing - fixture.step / 2, missing + fixture.step / 2].map((t) =>
    Math.floor((t - t0) / dt),
  );
  expect(x1 - x0).toBeGreaterThan(2);
  for (let x = x0 + 1; x < x1; x++) expect(pixelAt(lines[0], x)[3], `column ${x}`).toBe(0);
  expect(pixelAt(lines[0], x0 - 2)[3]).toBe(255);
});

test("row_plot_values_match_document", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await runFixture(page, ["ST"]);
  const q = npy("st", "ST/q.npy");
  const centers = manifest("st").window_centers_seconds;
  await result(page).getByRole("button", { name: "Fp2", exact: true }).click();
  await expect(result(page).getByRole("img", { name: "Line plot of Fp2" })).toBeVisible();
  const plotted = await page.evaluate(async () => {
    await window.__ddalab.results.settled();
    return window.__ddalab.results.rowPlot;
  });
  expect(plotted?.row).toBe(1);
  expect(plotted?.points.map((p) => p.t)).toEqual(centers);
  expect(plotted?.points.map((p) => p.v)).toEqual(centers.map((_, w) => Math.fround(q.at(w, 1))));
  // The plot prints its scale: the row's smallest and largest value.
  const row = centers.map((_, w) => q.at(w, 1));
  const scale = result(page).getByRole("list", { name: "Line plot scale" });
  await expect(scale).toContainText(Math.max(...row).toPrecision(3));
  await expect(scale).toContainText(Math.min(...row).toPrecision(3));
});

test("variant_tabs_switch", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await runFixture(page, ["CT", "CD", "DE", "SY"]);
  const tabs = result(page).getByRole("tab");
  await expect(tabs).toHaveText(["CT", "CD", "DE", "SY"]);
  await expect(result(page).getByRole("tab", { name: "CT" })).toHaveAttribute("aria-selected", "true");
  await expect(result(page).getByRole("button", { name: "Fp1 & Fp2" })).toBeVisible();
  expect((await heatmapRows(page)).frame).toMatchObject({ variant: "CT", array: "q", rows: 1 });

  await result(page).getByRole("tab", { name: "SY" }).click();
  await expect(result(page).getByRole("button", { name: "Fp1 <-> Fp2" })).toBeVisible();
  const sy = npy("ct_cd_de_sy", "SY/q.npy");
  const centers = manifest("ct_cd_de_sy").window_centers_seconds;
  await setView(page, { t0: 1, t1: 5 });
  const { frame, lines } = await heatmapRows(page);
  expect(frame).toMatchObject({ variant: "SY", array: "q", rows: 1, map: "vik" });
  const m = sy.values.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  for (const w of [0, 5, 11]) {
    const x = Math.floor(((centers[w] - 1) / 4) * frame.width);
    expect(shows(pixelAt(lines[0], x), "vik", sy.at(w, 0), -m, m), `window ${w}`).toBe(true);
  }

  // The arrow keys move between the variants; CD has two directed rows.
  await result(page).getByRole("tab", { name: "SY" }).press("ArrowLeft");
  await result(page).getByRole("tab", { name: "DE" }).press("ArrowLeft");
  await expect(result(page).getByRole("tab", { name: "CD" })).toHaveAttribute("aria-selected", "true");
  await expect(result(page).getByRole("button", { name: "Fp2 <- Fp1" })).toBeVisible();
  expect((await heatmapRows(page)).frame).toMatchObject({ variant: "CD", rows: 2, map: "vik" });
  // DE is an absolute value: batlow, from its smallest to its largest value.
  await result(page).getByRole("tab", { name: "DE" }).click();
  const de = npy("ct_cd_de_sy", "DE/q.npy");
  expect((await heatmapRows(page)).frame).toMatchObject({
    variant: "DE",
    map: "batlow",
    lo: Math.min(...de.values),
    hi: Math.max(...de.values),
  });

  // CT keeps a fit error per window: its own toggle shows it, a sequential quantity in batlow.
  await expect(result(page).getByRole("button", { name: "Fit error" })).toHaveCount(0);
  await result(page).getByRole("tab", { name: "CT" }).click();
  expect((await heatmapRows(page)).frame).toMatchObject({ variant: "CT", array: "q", map: "vik" });
  await result(page).getByRole("button", { name: "Fit error" }).click();
  expect((await heatmapRows(page)).frame).toMatchObject({ variant: "CT", array: "fit_error", map: "batlow" });
});

test("short_result_outlier_visible_far_out", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  // 1,000 windows (125 s) of a two-hour recording, seen whole: a few pixels hold all of them, about 90 windows a
  // pixel. The outlier must still draw, from a coarse level of the pyramid.
  await openTwoHours(page);
  await showFixture(page, {
    id: "fixture-short",
    windows: 1000,
    rows: 2,
    first: 3000,
    step: 0.125,
    values: [[517, 1, -10]],
  });
  await expect(result(page)).toBeVisible();
  await setView(page, { t0: 0, t1: 7200 });
  const { frame, lines } = await heatmapRows(page);
  expect(frame.level).toBeGreaterThanOrEqual(3);
  const dt = 7200 / frame.width;
  const x = Math.floor((3000 + 517 * 0.125 - 0) / dt);
  const outlier = (r: number, at: number) => shows(pixelAt(lines[r], at), "vik", -10, -10, 10);
  expect(outlier(1, x), `column ${x} at level ${frame.level}`).toBe(true);
  expect([x - 1, x, x + 1].some((at) => outlier(0, at))).toBe(false);
});

test("keyboard_reads_window_values", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await runFixture(page, ["ST"]);
  const q = npy("st", "ST/q.npy");
  const centers = manifest("st").window_centers_seconds;
  const { t0, t1 } = await page.evaluate(() => window.__ddalab.store.getState().view);
  const row = result(page).getByRole("button", { name: "Fp2", exact: true });
  await row.focus();
  // Right puts the cursor on the window nearest the middle of the view; Left steps back one window.
  await row.press("ArrowRight");
  const middle = nearest(centers, (t0 + t1) / 2);
  await expect
    .poll(() => page.evaluate(() => window.__ddalab.store.getState().cursorS))
    .toBe(centers[middle]);
  await row.press("ArrowLeft");
  const w = middle - 1;
  await expect.poll(() => page.evaluate(() => window.__ddalab.store.getState().cursorS)).toBe(centers[w]);
  const readout = result(page).getByRole("tooltip");
  await expect(readout).toContainText("Fp2");
  await expect(readout).toContainText(`${centers[w].toFixed(3)} s`);
  await expect(readout).toContainText(q.at(w, 1).toPrecision(4));
  // Screen readers hear it; the focus stays, and the view did not page.
  const spoken = `Fp2, window at ${centers[w].toFixed(3)} s, Q ${q.at(w, 1).toPrecision(4)}`;
  const status = result(page).getByRole("status").filter({ hasText: "window at" });
  await expect(status).toHaveText(spoken);
  await expect(row).toBeFocused();
  expect(await page.evaluate(() => window.__ddalab.store.getState().view.t0)).toBe(t0);
  // The pointer resting on the plot shows its own cell, and screen readers still hear the keyboard's.
  const box = await page.locator("canvas[data-heatmap]").boundingBox();
  if (!box) throw new Error("no heatmap canvas");
  const hovered = w + 3;
  await page.mouse.move(box.x + ((centers[hovered] - t0) / (t1 - t0)) * box.width, box.y + box.height / 4);
  await expect(readout).toContainText("Fp1");
  // The frame that moved the readout to the pointer's cell also set what is spoken.
  await expect(readout).toContainText(`${centers[hovered].toFixed(3)} s`);
  await expect(status).toHaveText(spoken);
  await page.mouse.move(0, 0);
  await row.blur();
  await expect(readout).toBeHidden();
});

test("array_read_failure_offers_try_again", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await openTwoHours(page);
  const fixture: Fixture = { id: "fixture-late", windows: 400, rows: 2, first: 10, step: 0.125, values: [] };
  await showFixture(page, { ...fixture, noArray: true });
  const alert = result(page).getByRole("alert").filter({ hasText: "could not be read" });
  await expect(alert).toBeVisible();
  // Once the file is there, Try again reads it.
  await showFixture(page, fixture);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toBeHidden();
  expect((await heatmapRows(page)).frame).toMatchObject({ resultId: "fixture-late", rows: 2 });
});

test("a_result_chunk_that_does_not_load_offers_reload", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  // A tab opened before a deploy asks for a chunk the host no longer has.
  await page.route(/\/ResultPanel\.tsx/, (route) => route.fulfill({ status: 404, body: "" }));
  await openTwoHours(page);
  await showFixture(page, { id: "fixture-gone", windows: 40, rows: 2, first: 10, step: 0.125, values: [] });
  const alert = page.getByRole("alert").filter({ hasText: "This result could not be shown" });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  await page.getByRole("button", { name: "Close the result" }).click();
  await expect(alert).toHaveCount(0);
  expect(await page.evaluate(() => window.__ddalab.store.getState().shownResult)).toBeNull();
});

test("manifest_read_failure_offers_try_again", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await openTwoHours(page);
  // Shown before its files exist: the manifest cannot be read.
  await page.evaluate(() => {
    const { store } = window.__ddalab;
    const { recordings, activeRecordingId } = store.getState();
    const { fingerprint } = recordings[activeRecordingId as string];
    store.setState({
      shownResult: { id: "fixture-unread", fingerprint, variant: null, array: "q", row: null },
    });
  });
  const alert = result(page).getByRole("alert").filter({ hasText: "could not be read" });
  await expect(alert).toBeVisible();
  // Once the files are there, Try again reads them.
  await showFixture(page, {
    id: "fixture-unread",
    windows: 400,
    rows: 2,
    first: 10,
    step: 0.125,
    values: [],
  });
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toBeHidden();
  expect((await heatmapRows(page)).frame).toMatchObject({ resultId: "fixture-unread", rows: 2 });
});

// 57,000 windows of 4 rows: the storage takes all of the levels' files but the record, or half of the files.
for (const [what, part] of [
  ["record", 1],
  ["levels", 0.5],
] as const) {
  test(`full_storage_for_the_pyramid_${what}_leaves_no_partial_files`, async ({ page }) => {
    test.skip(!(await hasStorage(page)), NO_STORAGE);
    await openTwoHours(page);
    // The scan writes through the same storage: it is over before the quota starts counting.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = window.__ddalab.store.getState();
          const { scannedRows, totalRows } = s.recordings[s.activeRecordingId as string].scan;
          return scannedRows === totalRows;
        }),
      )
      .toBe(true);
    const [windows, rows] = [57_000, 4];
    let levelBytes = 0;
    for (let level = 1; level < resultLevels(windows); level++) {
      levelBytes += Math.ceil(windows / FANOUT ** level) * rows * 4;
    }
    await page.evaluate((bytes) => window.__ddalab.engine.quota(bytes), Math.floor(part * levelBytes));
    await showFixture(page, { id: "fixture-full", windows, rows, first: 0.5, step: 0.125, values: [] });
    await expect(
      result(page).getByRole("alert").filter({ hasText: "Zooming out on this result needs about" }),
    ).toBeVisible();
    const left = await page.evaluate(async () => {
      const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results");
      const st = await (await results.getDirectoryHandle("fixture-full")).getDirectoryHandle("ST");
      const names: string[] = [];
      for await (const [name] of st.entries()) names.push(name);
      return names;
    });
    expect(left).toEqual(["q.npy"]);
  });
}
