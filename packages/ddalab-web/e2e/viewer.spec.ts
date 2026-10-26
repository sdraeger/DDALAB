// The workspace shell and the waveform viewer: pixel-exact drawing in every mode, paging, sensitivity, the channel
// list at 512 channels, keyboard-only use and the states of the plot area.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { readSynthetic, type SyntheticSpec, syntheticEdfSize } from "../src/core/synthetic";
import type { View } from "../src/store/store";
import { expect, hasStorage, hasWebGL2, NO_WEBGL2, type Page, test } from "./test";

const EDF = fileURLToPath(new URL("../../dda-rs/tests/fixtures/fixture.edf", import.meta.url));
const channels = (page: Page) => page.getByRole("list", { name: "Channels" }).getByRole("listitem");

async function openFixture(page: Page) {
  await page.getByLabel("Recording files").setInputFiles(EDF);
  await expect(channels(page)).toHaveCount(2);
}

const openSynthetic = (page: Page, spec: SyntheticSpec) =>
  page.evaluate((s) => window.__ddalab.openSynthetic(s), spec);

const view = (page: Page) => page.evaluate(() => window.__ddalab.store.getState().view);
const setView = (page: Page, change: Partial<View>) =>
  page.evaluate((c) => window.__ddalab.store.setState((s) => ({ view: { ...s.view, ...c } })), change);
/** The scan is over: complete, or not run (no storage in this window). */
const scanDone = (page: Page) =>
  page.evaluate(() => {
    const s = window.__ddalab.store.getState();
    const { scan } = s.recordings[s.activeRecordingId as string];
    return scan.scannedRows === scan.totalRows || Boolean(scan.notice);
  });
/** Shows `rows` channels from `channel` at `samplesPerPixel` from `t0`, at 100 µV/mm. */
async function zoom(page: Page, samplesPerPixel: number, t0: number, channel: number, rows = 1) {
  // A frame of the active recording first: its canvas has its size.
  const { width, rate } = await page.evaluate(async () => {
    await window.__ddalab.viewer.settled();
    const s = window.__ddalab.store.getState();
    const canvas = document.querySelector("canvas[data-traces]") as HTMLCanvasElement;
    return { width: canvas.width, rate: s.recordings[s.activeRecordingId as string].info.sample_rate_hz };
  });
  await setView(page, {
    t0,
    t1: t0 + (samplesPerPixel * width) / rate,
    firstChannel: channel,
    rowCount: rows,
    sensitivityUvPerMm: 100,
  });
}

/**
 * Compares every column of every row of the drawn traces with the full polyline through the raw samples. The
 * mapping from samples to pixels comes from the store, the recording's channel list and the canvas size, as the
 * spec states it, not from the renderer; the rows draw every display channel, or the chosen ones alone. In column c
 * (sample positions p0 = s0 + c * spp to p1 = p0 + spp) the polyline spans the samples strictly inside and its values
 * at p0 and p1. The drawn span must contain that span and lie within the union of the spans of columns c - 1 to
 * c + 1, both clamped to the row's band of pixel rows (the last band ends at the canvas edge): a span past the band
 * inks its edge row, and a row inks its own band only, which tells the rows' pixels apart. A value within TOLERANCE
 * px of a pixel edge may fall on either side (float32 in the shader, float64 here). `clamped` counts the columns
 * whose span leaves its band, `edge` those wholly past it, which must ink the edge row alone.
 */
const checkPixels = (page: Page) =>
  page.evaluate(async () => {
    const TOLERANCE = 1e-3;
    const { engine, store, viewer } = window.__ddalab;
    const frame = await viewer.settled();
    const { view, recordings, activeRecordingId } = store.getState();
    const id = activeRecordingId as string;
    const { info, analysis_channels, selectedChannels } = recordings[id];
    const rate = info.sample_rate_hz;
    const N = info.sample_count;
    const C = analysis_channels.length;
    const { width: W, height: H, data } = viewer.pixels();
    const s0 = view.t0 * rate;
    const spp = ((view.t1 - view.t0) * rate) / W;
    const pxPerUnit = ((96 / 25.4 / view.mmPerCssMm) * devicePixelRatio) / view.sensitivityUvPerMm;
    const order = view.chosenOnly ? selectedChannels : analysis_channels.map((_, i) => i);
    const rows = Math.min(view.rowCount, order.length);
    const rowHeight = H / rows;
    const first = Math.max(0, Math.floor(s0) - 1);
    const last = Math.min(N - 1, Math.ceil(s0 + W * spp) + 1);
    const raw = await engine.raw(id, first, last - first + 1);
    const failures: string[] = [];
    let inked = 0;
    let clamped = 0;
    let edge = 0;
    for (let r = 0; r < Math.min(rows, order.length - view.firstChannel); r++) {
      const ch = order[view.firstChannel + r];
      const { unit, gain, offset } = info.channels[analysis_channels[ch]];
      const scale = unit === "V" ? 1e6 : 1;
      const v = (i: number) => raw[(i - first) * C + ch] * gain * scale + offset * scale;
      const at = (p: number) => {
        const i = Math.floor(p);
        return i + 1 > N - 1 ? v(i) : v(i) + (v(i + 1) - v(i)) * (p - i);
      };
      const center = (r + 0.5) * rowHeight;
      const y = (value: number) => center - value * pxPerUnit;
      const band = [Math.floor(r * rowHeight), (r + 1 === rows ? H : Math.floor((r + 1) * rowHeight)) - 1];
      const toBand = (row: number) => Math.min(band[1], Math.max(band[0], row));
      // The polyline's [top, bottom] in fractional pixel rows, per column; null where the recording has no rows.
      // Columns -1 and W lie just past the edges: a bucket or sample at an edge belongs to them.
      const reference = Array.from({ length: W + 2 }, (_, k) => {
        const c = k - 1;
        const p0 = Math.max(0, s0 + c * spp);
        const p1 = Math.min(N - 1, s0 + (c + 1) * spp);
        if (p0 > N - 1 || p1 < 0 || p1 < p0) return null;
        const values = [at(p0), at(p1)];
        for (let i = Math.floor(p0) + 1; i < p1; i++) values.push(v(i));
        return [y(Math.max(...values)), y(Math.min(...values))];
      });
      const columns = reference.slice(1, W + 1);
      clamped += columns.filter(
        (s) => s && (Math.floor(s[0]) < band[0] || Math.floor(s[1]) > band[1]),
      ).length;
      edge += columns.filter((s) => s && (Math.floor(s[1]) < band[0] || Math.floor(s[0]) > band[1])).length;
      for (let c = 0; c < W; c++) {
        let top = -1;
        let bottom = -1;
        let gaps = 0;
        for (let row = band[0]; row <= band[1]; row++) {
          const ink = data[((H - 1 - row) * W + c) * 4 + 3] > 0;
          if (ink && top < 0) top = row;
          if (ink) {
            gaps += bottom >= 0 && row > bottom + 1 ? 1 : 0;
            bottom = row;
          }
        }
        const ref = reference[c + 1];
        if (!ref) {
          if (top >= 0) failures.push(`row ${r} column ${c}: ink where the recording has no rows`);
          continue;
        }
        const need = [toBand(Math.floor(ref[0] + TOLERANCE)), toBand(Math.floor(ref[1] - TOLERANCE))];
        const near = [c, c + 1, c + 2].flatMap((k) => (reference[k] ? [reference[k]] : []));
        const allow = [
          toBand(Math.floor(Math.min(...near.map((s) => s[0])) - TOLERANCE)),
          toBand(Math.floor(Math.max(...near.map((s) => s[1])) + TOLERANCE)),
        ];
        inked++;
        if (top < 0) failures.push(`row ${r} column ${c}: no ink, expected rows ${need}`);
        else if (gaps > 0) failures.push(`row ${r} column ${c}: the span has gaps`);
        else if (top > need[0] || bottom < need[1])
          failures.push(`row ${r} column ${c}: ${top}..${bottom} misses ${need}`);
        else if (top < allow[0] || bottom > allow[1])
          failures.push(`row ${r} column ${c}: ${top}..${bottom} past ${allow}`);
      }
    }
    return { mode: frame.mode, inked, clamped, edge, failures: failures.slice(0, 10) };
  });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("/");
});

test("waveform_is_pixel_exact", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  await openFixture(page);
  const zooms = [
    ["line", [0.2, 0.5, 0.9]],
    ["rawSpan", [1.5, 5, 12]],
  ] as const;
  for (const [mode, spps] of zooms) {
    for (const spp of spps) {
      for (const channel of [0, 1]) {
        await zoom(page, spp, 3.1, channel);
        const result = await checkPixels(page);
        expect(result, `${spp} samples per pixel, channel ${channel}`).toMatchObject({ mode, failures: [] });
        expect(result.inked).toBeGreaterThan(100);
      }
    }
  }
  // The fixture is too short for tiles at this width: a two-hour recording takes its place.
  await openSynthetic(page, { channels: 2, rateHz: 256, durationS: 7200, seed: 7 });
  for (const spp of [70, 300, 1500]) {
    await zoom(page, spp, 1234.5, 1);
    const result = await checkPixels(page);
    expect(result, `${spp} samples per pixel`).toMatchObject({ mode: "tile", failures: [] });
    expect(result.inked).toBeGreaterThan(100);
  }
});

// A 30 s epoch at 2 kHz on a wide plot of a 512-channel recording, six rows from channel 500: below 64 samples per
// pixel the spans come from raw samples of the rows on screen, however many channels the recording has.
test("waveform_is_pixel_exact_with_many_rows", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Inspector" }).click();
  await openSynthetic(page, { channels: 512, rateHz: 2000, durationS: 120, seed: 6 });
  // 1 to 31 s holds no spike (they come every 97 s): every trace stays within its row at 100 µV/mm.
  await setView(page, { t0: 1, t1: 31, epochS: 30, firstChannel: 500, rowCount: 6, sensitivityUvPerMm: 100 });
  const result = await checkPixels(page);
  expect(result).toMatchObject({ mode: "rawSpan", failures: [] });
  expect(result.inked).toBeGreaterThan(6 * 1000);
});

// Four rows at 30 µV/mm: the synthetic traces (up to about 1050 µV) and their spikes at 97 s (3000 µV, up on even
// channels and down on odd ones) leave their rows. Each row inks its own band and none of its neighbors' ink, in raw
// spans and in the polyline: a trace past the band rides its edge, and a column wholly past it inks the edge row.
test("traces_stay_in_their_rows", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  await openSynthetic(page, { channels: 4, rateHz: 256, durationS: 120, seed: 9 });
  for (const [mode, spp, t0] of [
    ["line", 0.5, 96],
    ["rawSpan", 5, 90],
  ] as const) {
    await zoom(page, spp, t0, 0, 4);
    await setView(page, { sensitivityUvPerMm: 30 });
    const result = await checkPixels(page);
    expect(result, `${spp} samples per pixel`).toMatchObject({ mode, failures: [] });
    expect(result.inked).toBeGreaterThan(1000);
    expect(result.clamped).toBeGreaterThan(100);
    expect(result.edge).toBeGreaterThan(20);
  }
});

// The synthetic recording has a +30000 spike (3000 µV) on its first channel every 97 s; the traces stay under
// 1050 µV. At every zoom from the whole recording to one epoch the column of every spike in view reaches its
// height, and no other column comes near it.
test("spike_survives_every_zoom", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  await openSynthetic(page, { channels: 2, rateHz: 256, durationS: 7200, seed: 4 });
  const spikeS = 97;
  for (const span of [7200, 2400, 600, 150, 40, 10]) {
    const t0 = Math.min(7200 - span, Math.max(0, spikeS - span / 3));
    await setView(page, { t0, t1: t0 + span, firstChannel: 0, rowCount: 1, sensitivityUvPerMm: 100 });
    const seen = await page.evaluate(async (every) => {
      const { store, viewer } = window.__ddalab;
      const frame = await viewer.settled();
      const { width: W, height: H, data } = viewer.pixels();
      const { view, recordings, activeRecordingId } = store.getState();
      const rate = recordings[activeRecordingId as string].info.sample_rate_hz;
      const s0 = view.t0 * rate;
      const spp = ((view.t1 - view.t0) * rate) / W;
      const pxPerUnit = ((96 / 25.4 / view.mmPerCssMm) * devicePixelRatio) / view.sensitivityUvPerMm;
      const top = (c: number) => {
        for (let row = 0; row < H; row++) if (data[((H - 1 - row) * W + c) * 4 + 3] > 0) return row;
        return H;
      };
      const spikes: number[] = [];
      for (let row = every; row < s0 + W * spp; row += every) {
        const x = Math.floor((row - s0) / spp);
        if (x >= 1 && x < W - 1) spikes.push(x);
      }
      const spikeTops = spikes.map((x) => Math.min(top(x - 1), top(x), top(x + 1)));
      let elsewhere = H;
      for (let c = 0; c < W; c++) {
        if (spikes.every((x) => Math.abs(c - x) > 3)) elsewhere = Math.min(elsewhere, top(c));
      }
      return { mode: frame.mode, spikeTops, elsewhere, expected: H / 2 - 3000 * pxPerUnit };
    }, spikeS * 256);
    expect(seen.spikeTops.length, `${span} s`).toBeGreaterThan(0);
    for (const spikeTop of seen.spikeTops) {
      expect(spikeTop, `${span} s (${seen.mode})`).toBeLessThanOrEqual(Math.floor(seen.expected) + 1);
    }
    expect(seen.elsewhere).toBeGreaterThan(seen.expected + 20);
  }
});

// Six hours of a day-long recording, far ahead of the scan, at a level too coarse to build from the file on demand.
test("unscanned_region_is_hatched", async ({ page }) => {
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  await openSynthetic(page, { channels: 64, rateHz: 1000, durationS: 86_400, seed: 2 });
  await setView(page, { t0: 60_000, t1: 60_000 + 6 * 3600 });
  await expect
    .poll(() => page.evaluate(() => window.__ddalab.viewer.frame?.gaps ?? []))
    .toEqual([{ x0: 0, x1: expect.any(Number), reason: "unscanned" }]);
  const frame = await page.evaluate(() => window.__ddalab.viewer.frame);
  expect(frame?.gaps[0].x1).toBe(frame?.width);
  expect(frame?.mode).toBe("tile");
});

// Once the scan has stored the pyramid, jumps and pages into rows not read yet draw coarser tiles until the raw rows
// arrive: no frame has a column without data.
test("paging_never_blanks", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasStorage(page)), "the stored pyramid needs OPFS");
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  await openSynthetic(page, { channels: 64, rateHz: 1000, durationS: 1800, seed: 8 });
  await expect.poll(() => scanDone(page), { timeout: 60_000 }).toBe(true);
  // The first jump after the scan asks for the stored top tile, after the jump's own rows. The engine answers in
  // order: once the second jump has its rows, the top tile, which covers every later jump, is loaded.
  for (const key of ["End", "Home"]) {
    await page.keyboard.press(key);
    await page.evaluate(() => window.__ddalab.viewer.settled());
  }
  await page.evaluate(() => {
    window.__ddalab.viewer.frames = [];
  });
  for (const step of ["PageDown", "PageDown", "middle", "End", "PageUp", "Home"]) {
    if (step === "middle") await setView(page, { t0: 900, t1: 910 });
    else await page.keyboard.press(step);
    await page.evaluate(() => window.__ddalab.viewer.settled());
  }
  const frames = await page.evaluate(() => {
    const { viewer } = window.__ddalab;
    const recorded = viewer.frames ?? [];
    viewer.frames = null;
    return recorded;
  });
  // Some frames waited for raw rows: the cover drew them.
  expect(frames.filter((f) => !f.complete).length).toBeGreaterThan(0);
  expect(frames.filter((f) => f.blank > 0)).toEqual([]);
});

// A read that fails is reported in the plot and tried again; the plot recovers once reads work.
test("read_failure_is_reported", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  // About 200 MB, more than the engine's file cache: rows in the middle are read again after the scan.
  const spec = { channels: 64, rateHz: 256, durationS: 6000, seed: 12 };
  const size = syntheticEdfSize(spec);
  let failing = false;
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    if (failing) return void res.writeHead(503).end();
    if (!range) return void res.writeHead(416).end();
    const [from, to] = [Number(range[1]), Math.min(Number(range[2]), size - 1)];
    const body = Buffer.alloc(to - from + 1);
    readSynthetic(spec, from, body);
    res
      .writeHead(206, { "Content-Range": `bytes ${from}-${to}/${size}`, "Content-Length": body.length })
      .end(body);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/remote.edf`;
    await page.evaluate(
      (remote) => window.__ddalab.open({ kind: "url", files: [remote], primary: remote.name }),
      { name: "remote.edf", url, size },
    );
    await expect.poll(() => scanDone(page), { timeout: 60_000 }).toBe(true);
    await page.evaluate(() => window.__ddalab.viewer.settled());
    failing = true;
    await setView(page, { t0: 3000, t1: 3010 });
    const problem = page.getByRole("region", { name: "Waveforms" }).getByRole("alert");
    await expect(problem).toContainText("The recording could not be read");
    failing = false;
    await expect(problem).toBeHidden({ timeout: 15_000 });
    await page.evaluate(() => window.__ddalab.viewer.settled());
  } finally {
    server.close();
  }
});

test("paging_keys", async ({ page }) => {
  // The scale settings sit in the bar from 1440 px with the inspector open (Shell.module.css).
  await page.setViewportSize({ width: 1440, height: 720 });
  await openFixture(page);
  expect(await view(page)).toMatchObject({ t0: 0, t1: 10, epochS: 10 });
  await page.keyboard.press("PageDown");
  expect(await view(page)).toMatchObject({ t0: 10, t1: 20 });
  await expect(page.getByText("10.00 to 20.00 s")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  expect(await view(page)).toMatchObject({ t0: 20, t1: 30 });
  // The last page ends at the end of the recording.
  await page.keyboard.press("PageDown");
  expect(await view(page)).toMatchObject({ t0: 20, t1: 30 });
  await page.keyboard.press("PageUp");
  expect(await view(page)).toMatchObject({ t0: 10, t1: 20 });
  await page.keyboard.press("ArrowLeft");
  expect(await view(page)).toMatchObject({ t0: 0, t1: 10 });
  await page.keyboard.press("End");
  expect(await view(page)).toMatchObject({ t0: 20, t1: 30 });
  await page.keyboard.press("Home");
  expect(await view(page)).toMatchObject({ t0: 0, t1: 10 });
  await page.getByRole("button", { name: "Next page" }).click();
  expect(await view(page)).toMatchObject({ t0: 10, t1: 20 });
  // At 20 s epochs the 30 s recording has two pages; its end is on the second.
  await page.getByRole("combobox", { name: "Epoch" }).click();
  await page.getByRole("option", { name: "20 s" }).click();
  await page.keyboard.press("End");
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
});

// Twelve channels: "Show chosen channels only" shows the chosen ones alone, in order, paged by the same keys and
// scrolling; the rows follow the choice and each draws its own channel (CH3, CH7 and CH10 are not a run of channels).
// Off, every channel shows from the top row's channel.
test("chosen_channels_alone", async ({ page }) => {
  test.setTimeout(120_000);
  const gl = await hasWebGL2(page);
  await openSynthetic(page, { channels: 12, rateHz: 256, durationS: 60, seed: 5 });
  const toggle = page.getByRole("button", { name: "Show chosen channels only" });
  const rows = page.getByRole("list", { name: "Channel rows" }).getByRole("listitem");
  const choose = (label: string, on = true) =>
    page.getByRole("checkbox", { name: `Select ${label}`, exact: true }).setChecked(on);
  const drawn = () => page.evaluate(async () => (await window.__ddalab.viewer.settled()).channels);
  // With none chosen it cannot act, and says why.
  await expect(toggle).toHaveAttribute("aria-disabled", "true");
  await expect(toggle).toHaveAccessibleDescription("No channel is chosen.");
  // Playwright waits for an aria-disabled button to turn enabled before it clicks; a pointer reaches it at once.
  await toggle.click({ force: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // The note's line stays when the first channel is chosen: nothing below it moves.
  const groups = page.getByRole("list", { name: "Electrode groups" });
  const groupsAt = await groups.boundingBox();
  for (const label of ["CH10", "CH3", "CH7"]) await choose(label);
  await expect(toggle).not.toHaveAttribute("aria-disabled");
  expect(await groups.boundingBox()).toEqual(groupsAt);
  // On, a check marks it besides the color. The check holds its place while off, which keeps the button's size.
  const check = toggle.locator("svg");
  const toggleAt = await toggle.boundingBox();
  await expect(check).toHaveCSS("opacity", "0");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(check).toHaveCSS("opacity", "1");
  expect(await toggle.boundingBox()).toEqual(toggleAt);
  await expect(rows).toHaveText([/^CH3\b/, /^CH7\b/, /^CH10\b/]);
  if (gl) {
    expect(await drawn()).toEqual([2, 6, 9]);
    await zoom(page, 5, 3.1, 0, 3);
    expect(await checkPixels(page)).toMatchObject({ mode: "rawSpan", failures: [] });
  }
  // Two rows: the arrow keys and the scroller page through the chosen channels.
  await setView(page, { rowCount: 2 });
  const pane = page.getByRole("region", { name: "Waveforms" });
  await pane.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(rows).toHaveText([/^CH7\b/, /^CH10\b/]);
  // The next frame moves the scroller to the row; a scroll back to the top then shows the first row again.
  const scroller = () => pane.evaluate((p) => (p.firstElementChild as HTMLElement).scrollTop);
  await expect.poll(scroller).toBeGreaterThan(0);
  await pane.evaluate((p) => p.firstElementChild?.scrollTo(0, 0));
  await expect(rows).toHaveText([/^CH3\b/, /^CH7\b/]);
  // A channel chosen joins in order; the top row's channel unchosen gives way to the next.
  await choose("CH5");
  await expect(rows).toHaveText([/^CH3\b/, /^CH5\b/]);
  await choose("CH3", false);
  await expect(rows).toHaveText([/^CH5\b/, /^CH7\b/]);
  if (gl) expect(await drawn()).toEqual([4, 6]);
  // Off: every channel, from the top row's.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(rows).toHaveText([/^CH5\b/, /^CH6\b/]);
  if (gl) expect(await drawn()).toEqual([4, 5]);
  // Unchoosing the last channel while on shows every channel again, and the note says why it is off.
  await toggle.click();
  for (const label of ["CH5", "CH7", "CH10"]) await choose(label, false);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAttribute("aria-disabled", "true");
  await expect(rows).toHaveText([/^CH10\b/, /^CH11\b/]);
});

test("escape_and_a_press_off_the_plot_let_the_cursor_go", async ({ page }) => {
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  await openFixture(page);
  const cursor = () => page.evaluate(() => window.__ddalab.store.getState().cursorS);
  const plot = page.locator("canvas[data-traces]");
  await plot.click({ position: { x: 200, y: 40 } });
  expect(await cursor()).not.toBeNull();
  await page.keyboard.press("Escape");
  expect(await cursor()).toBeNull();
  await plot.click({ position: { x: 200, y: 40 } });
  expect(await cursor()).not.toBeNull();
  await page.getByRole("heading", { name: "Channels" }).click();
  expect(await cursor()).toBeNull();
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("pinch_zooms_about_the_fingers_and_a_held_drag_selects", async ({ page, browserName }) => {
    // Two fingers at once go through the DevTools protocol, which only Chromium speaks; they arrive as real pointers.
    test.skip(browserName !== "chromium", "multi-touch is sent through the Chromium DevTools protocol");
    test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
    await openFixture(page);
    const box = await page.locator("canvas[data-traces]").boundingBox();
    if (!box) throw new Error("the plot has no box");
    const y = box.y + 40;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", xs: number[]) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: xs.map((x, id) => ({ x, y, id })) });
    const state = () => page.evaluate(() => window.__ddalab.store.getState());
    const mid = box.x + box.width / 2;
    const before = (await state()).view;
    const midS = before.t0 + ((mid - box.x) / box.width) * (before.t1 - before.t0);
    await touch("touchStart", [mid - 40, mid + 40]);
    await touch("touchMove", [mid - 120, mid + 120]);
    await touch("touchEnd", []);
    const after = await state();
    // Fingers three times as far apart show a third of the span, with the time under their midpoint kept.
    expect((after.view.t1 - after.view.t0) / (before.t1 - before.t0)).toBeCloseTo(1 / 3, 2);
    expect(after.view.t0 + ((mid - box.x) / box.width) * (after.view.t1 - after.view.t0)).toBeCloseTo(
      midS,
      3,
    );
    expect(after.cursorS).toBeNull();
    // A finger held still, then moved, selects the interval of a run; a quick drag would have panned.
    await touch("touchStart", [box.x + 100]);
    await page.waitForTimeout(600);
    await touch("touchMove", [box.x + 300]);
    await touch("touchEnd", []);
    const { selection, view: kept } = await state();
    expect(selection).not.toBeNull();
    expect((selection?.t1 ?? 0) - (selection?.t0 ?? 0)).toBeGreaterThan(0);
    expect(kept).toEqual(after.view);
  });
});

test("sensitivity_steps", async ({ page }) => {
  // The scale settings sit in the bar from 1440 px with the inspector open (Shell.module.css).
  await page.setViewportSize({ width: 1440, height: 720 });
  await openFixture(page);
  const sensitivity = async () => (await view(page)).sensitivityUvPerMm;
  // The printed scale's field, as it reads (hidden copies of the other unit hold its width).
  const readout = page.getByRole("region", { name: "Waveforms" }).getByRole("definition").first();
  const control = page.getByRole("combobox", { name: "Sensitivity" });
  const widths = async () => [(await readout.boundingBox())?.width, (await control.boundingBox())?.width];
  await setView(page, { sensitivityUvPerMm: 7 });
  await page.keyboard.press("]");
  expect(await sensitivity()).toBe(10);
  await expect(readout).toHaveText("10 µV/mm", { useInnerText: true });
  const width = await widths();
  await page.keyboard.press("[");
  await page.keyboard.press("[");
  expect(await sensitivity()).toBe(5);
  // Past 100 µV/mm to 10 mV/mm, in mV/mm from 1 mV/mm on, and no wider.
  await setView(page, { sensitivityUvPerMm: 100 });
  await page.keyboard.press("]");
  expect(await sensitivity()).toBe(150);
  for (const [value, text] of [
    [700, "700 µV/mm"],
    [1000, "1 mV/mm"],
    [1500, "1.5 mV/mm"],
    [10000, "10 mV/mm"],
  ] as const) {
    await setView(page, { sensitivityUvPerMm: value });
    await expect(readout).toHaveText(text, { useInnerText: true });
    await expect(control).toHaveText(text, { useInnerText: true });
    expect(await widths(), text).toEqual(width);
  }
  await page.keyboard.press("]");
  expect(await sensitivity()).toBe(10000);
  await expect(page.getByText("100 mV", { exact: true })).toBeAttached();
  await setView(page, { sensitivityUvPerMm: 1 });
  await page.keyboard.press("[");
  expect(await sensitivity()).toBe(1);
  // The command bar sets it too.
  await control.click();
  await page.getByRole("option", { name: "30 µV/mm" }).click();
  expect(await sensitivity()).toBe(30);
  await control.click();
  await page.getByRole("option", { name: "1.5 mV/mm" }).click();
  expect(await sensitivity()).toBe(1500);
});

// Twenty electrode groups: eight show, the rest behind "Show all", and the annotations stay in the first viewport at
// 1440 x 900; the channel list comes to rest on whole rows.
test("the_inspector_bounds_its_groups_and_rests_on_whole_rows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const spec = { channels: 20, rateHz: 256, durationS: 60, seed: 4 };
  const bytes = new Uint8Array(syntheticEdfSize(spec));
  readSynthetic(spec, 0, bytes);
  // Labels AX1, BX1, ... TX1: a group each (the 16-byte label fields follow the 256-byte header).
  for (let c = 0; c < spec.channels; c++) {
    bytes.set(new TextEncoder().encode(`${String.fromCharCode(65 + c)}X1`.padEnd(16)), 256 + 16 * c);
  }
  await page
    .getByLabel("Recording files")
    .setInputFiles({ name: "groups.edf", mimeType: "", buffer: Buffer.from(bytes) });
  const groups = page.getByRole("list", { name: "Electrode groups" }).getByRole("listitem");
  await expect(groups).toHaveCount(8);
  await expect(page.getByRole("heading", { name: /^Annotations/ })).toBeInViewport();
  const more = page.getByRole("button", { name: "Show all 20 groups" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(groups).toHaveCount(20);
  await expect(page.getByRole("button", { name: "Show the first 8 groups" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // A scroll that stops between rows settles on a whole row.
  const list = page.getByRole("list", { name: "Channels" });
  await list.evaluate((element) => (element.parentElement as HTMLElement).scrollBy({ top: 40 }));
  await expect
    .poll(() => list.evaluate((element) => (element.parentElement as HTMLElement).scrollTop % 28))
    .toBe(0);
});

test("virtualized_512_channels", async ({ page }) => {
  await openSynthetic(page, { channels: 512, rateHz: 256, durationS: 60, seed: 3 });
  const list = page.getByRole("list", { name: "Channels" });
  await expect(list.getByText("CH1", { exact: true })).toBeVisible();
  expect(await channels(page).count()).toBeLessThan(80);
  // The waveform gutter holds the visible rows only.
  expect(await page.getByRole("region", { name: "Waveforms" }).getByRole("listitem").count()).toBeLessThan(
    80,
  );
  await list.evaluate((element) => {
    const row = element.querySelector("li") as HTMLElement;
    (element.parentElement as HTMLElement).scrollTop = 499 * row.offsetHeight;
  });
  await expect(list.getByText("CH500", { exact: true })).toBeVisible();
  expect(await channels(page).count()).toBeLessThan(80);
});

/**
 * Presses Tab (or Shift+Tab) until the focused element satisfies `is`. WebKit, like Safari without full keyboard
 * access, tabs to text fields only; Option+Tab reaches every control.
 */
async function tabTo(page: Page, is: (element: Element) => boolean, back = false) {
  const tab = test.info().project.name === "webkit" ? "Alt+Tab" : "Tab";
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press(back ? `Shift+${tab}` : tab);
    if (await page.evaluate(`(${is.toString()})(document.activeElement)`)) return;
  }
  throw new Error("focus never got there");
}

test("keyboard_only_open_and_page", async ({ page }) => {
  // Waiting for the chooser from the start: Playwright intercepts it only once the wait is registered.
  const chooser = page.waitForEvent("filechooser");
  await tabTo(page, (e) => e.textContent === "Open files");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(EDF);
  await expect(channels(page)).toHaveCount(2);
  await tabTo(page, (e) => e.getAttribute("aria-label") === "Select Fp2");
  await page.keyboard.press("Space");
  const selected = () =>
    page.evaluate(() => {
      const s = window.__ddalab.store.getState();
      return s.recordings[s.activeRecordingId as string].selectedChannels;
    });
  expect(await selected()).toEqual([1]);
  await tabTo(page, (e) => e.getAttribute("aria-label") === "Waveforms", true);
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  expect(await view(page)).toMatchObject({ t0: 20, t1: 30 });
});

test("webgl2_missing_message", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      return kind === "webgl2" ? null : getContext.call(this, kind as "2d", ...(rest as []));
    } as typeof getContext;
  });
  await page.reload();
  await openFixture(page);
  await expect(page.getByRole("region", { name: "Waveforms" })).toContainText("WebGL2");
});

test("narrow_viewport_notice", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("DDALAB needs a window at least 768 pixels wide.")).toBeVisible();
});

test("theme_toggle_remembers_the_pick", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const toggle = page.getByRole("button", { name: "Dark theme" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("webgl_context_loss_and_restore", async ({ page }) => {
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  await openFixture(page);
  await zoom(page, 5, 3.1, 0);
  expect((await checkPixels(page)).failures).toEqual([]);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas[data-traces]") as HTMLCanvasElement;
    const lose = (canvas.getContext("webgl2") as WebGL2RenderingContext).getExtension("WEBGL_lose_context");
    Object.assign(window, { lose });
    lose?.loseContext();
  });
  const pane = page.getByRole("region", { name: "Waveforms" });
  await expect(pane).toContainText("The browser reset WebGL2 drawing");
  await page.evaluate(() => (window as unknown as { lose: WEBGL_lose_context }).lose.restoreContext());
  await expect(pane).not.toContainText("The browser reset WebGL2 drawing");
  expect(await checkPixels(page)).toMatchObject({ mode: "rawSpan", failures: [] });
});

// A program that does not link shows its reason in the pane; the rest of the workspace stays.
test("webgl_program_failure_message", async ({ page }) => {
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  await page.addInitScript(() => {
    const parameter = WebGL2RenderingContext.prototype.getProgramParameter;
    WebGL2RenderingContext.prototype.getProgramParameter = function (this: WebGL2RenderingContext, p, name) {
      return name === this.LINK_STATUS ? false : parameter.call(this, p, name);
    };
  });
  await page.reload();
  await openFixture(page);
  await expect(page.getByRole("region", { name: "Waveforms" })).toContainText(
    "DDALAB could not set up WebGL2 drawing",
  );
  await expect(page.getByRole("heading", { name: "fixture.edf" })).toBeVisible();
});

// The viewer is a chunk of its own, asked for after the entry has run (a module the entry imports is fetched before
// it runs); the plots come in the same commit as the rest of the recording's workspace, with no fallback in between.
test("viewer_chunk_comes_after_the_entry_and_with_the_first_recording", async ({ page }) => {
  // When the entry runs: main.tsx sets the test hook as it does.
  await page.addInitScript(() => {
    let hook: unknown;
    Object.defineProperty(window, "__ddalab", {
      configurable: true,
      get: () => hook,
      set(value) {
        hook = value;
        Object.assign(window, { entryRan: performance.now() });
      },
    });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "OpenNeuro" })).toBeVisible();
  const { ran, asked } = await page.evaluate(async () => {
    const find = () =>
      performance.getEntriesByType("resource").find((entry) => /\/src\/app\/Viewer\.tsx/.test(entry.name));
    while (!find()) await new Promise(requestAnimationFrame);
    return { ran: (window as unknown as { entryRan: number }).entryRan, asked: find()?.startTime };
  });
  expect(asked).toBeGreaterThan(ran);
  await page.evaluate(() => {
    const batches: string[][] = [];
    Object.assign(window, { batches });
    new MutationObserver((records) => {
      const added = records.flatMap((record) => [...record.addedNodes]);
      const found = added.flatMap((node) =>
        node instanceof Element
          ? [node, ...node.querySelectorAll("*")].flatMap((element) =>
              element.matches("canvas[data-traces]")
                ? ["traces"]
                : element.matches("h2") && element.textContent === "fixture.edf"
                  ? ["heading"]
                  : [],
            )
          : [],
      );
      if (found.length > 0) batches.push(found);
    }).observe(document.body, { childList: true, subtree: true });
  });
  await openFixture(page);
  await expect(page.locator("canvas[data-traces]")).toHaveCount(1);
  const batches = await page.evaluate(() => (window as unknown as { batches: string[][] }).batches);
  expect(batches[0]).toEqual(expect.arrayContaining(["heading", "traces"]));
});
