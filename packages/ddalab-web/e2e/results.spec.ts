// The result views: the heatmap on the waveform's time axis, its max-magnitude pyramid when zoomed out, the row plot
// and the variant tabs. Results come from runs of the BrainVision fixture (equal to the CLI bundles of global-setup.ts,
// which e2e/analysis.spec.ts checks) and from a result written straight into OPFS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { ResultDocument } from "../src/core/types";
import { colorIndex, LUTS, type MapName } from "../src/render/colormaps";
import type { View } from "../src/store/store";
import { bundleDir, type CASES } from "./global-setup";

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
function npy(bundle: keyof typeof CASES, path: string) {
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

const manifest = (bundle: keyof typeof CASES): ResultDocument =>
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
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 4, rateHz: 256, durationS: 7200, seed: 9 }),
  );
  const fixture = {
    id: "fixture-outlier",
    windows: 57_000,
    rows: 4,
    outlier: 31_415,
    row: 2,
    step: 0.125,
    missing: 31_400,
  };
  await page.evaluate(async (f) => {
    const { store } = window.__ddalab;
    const recording = store.getState().recordings[store.getState().activeRecordingId as string];
    const labels = recording.analysis_channels.map((c) => recording.info.channels[c].label);
    const values = new Float64Array(f.windows * f.rows);
    let seed = 11;
    for (let i = 0; i < values.length; i++) {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      values[i] = 0.2 + (0.4 * seed) / 2 ** 31;
    }
    values[f.outlier * f.rows + f.row] = -10;
    values[f.missing * f.rows] = Number.NaN;
    // The 128-byte header dda-rs writes: magic, version 1.0, the dict's length (118) and the dict padded to it.
    const dict = `{'descr': '<f8', 'fortran_order': False, 'shape': (${f.windows}, ${f.rows}), }`;
    const header = new Uint8Array(128);
    header.set([0x93, 78, 85, 77, 80, 89, 1, 0, 118, 0]);
    header.set(new TextEncoder().encode(`${dict.padEnd(117)}\n`), 10);
    const centers = Array.from({ length: f.windows }, (_, i) => 0.5 + i * f.step);
    const manifest = {
      schema: "ddalab.result/2",
      id: f.id,
      file_name: "synthetic.edf",
      created_at_iso: new Date().toISOString(),
      diagnostics: [],
      window_centers_seconds: centers,
      variants: [{ id: "ST", label: "Single Timeseries (ST)", row_labels: labels, arrays: ["ST/q.npy"] }],
      reproduction: { window_length_samples: 256, window_step_samples: 32 },
    };
    const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results", {
      create: true,
    });
    const directory = await results.getDirectoryHandle(f.id, { create: true });
    const write = async (folder: FileSystemDirectoryHandle, name: string, parts: BlobPart[]) => {
      const file = await (await folder.getFileHandle(name, { create: true })).createWritable();
      await file.write(new Blob(parts));
      await file.close();
    };
    await write(await directory.getDirectoryHandle("ST", { create: true }), "q.npy", [header, values]);
    await write(directory, "manifest.json", [JSON.stringify(manifest)]);
    await write(directory, "status", ["complete"]);
    store.setState({
      shownResult: { id: f.id, fingerprint: recording.fingerprint, variant: null, array: "q", row: null },
    });
  }, fixture);
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
  expect((await heatmapRows(page)).frame).toMatchObject({ variant: "CD", rows: 2 });

  // CT keeps a fit error per window: its own toggle shows it, a sequential quantity in batlow.
  await expect(result(page).getByRole("button", { name: "Fit error" })).toHaveCount(0);
  await result(page).getByRole("tab", { name: "CT" }).click();
  await result(page).getByRole("button", { name: "Fit error" }).click();
  expect((await heatmapRows(page)).frame).toMatchObject({ variant: "CT", array: "fit_error", map: "batlow" });
});
