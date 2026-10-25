// The workspace shell and the waveform viewer: pixel-exact drawing in every mode, paging, sensitivity, the channel
// list at 512 channels, keyboard-only use and the states of the plot area.
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { View } from "../src/store/store";

const EDF = fileURLToPath(new URL("../../dda-rs/tests/fixtures/fixture.edf", import.meta.url));
const channels = (page: Page) => page.getByRole("list", { name: "Channels" }).getByRole("listitem");

async function openFixture(page: Page) {
  await page.getByLabel("Recording files").setInputFiles(EDF);
  await expect(channels(page)).toHaveCount(2);
}

const openSynthetic = (
  page: Page,
  spec: { channels: number; rateHz: number; durationS: number; seed: number },
) => page.evaluate((s) => window.__ddalab.openSynthetic(s), spec);

const view = (page: Page) => page.evaluate(() => window.__ddalab.store.getState().view);
const setView = (page: Page, change: Partial<View>) =>
  page.evaluate((c) => window.__ddalab.store.setState((s) => ({ view: { ...s.view, ...c } })), change);

/** Shows one channel at `samplesPerPixel` from `t0`, at 100 µV/mm. */
async function zoom(page: Page, samplesPerPixel: number, t0: number, channel: number) {
  const { width } = await page.evaluate(() => window.__ddalab.viewer.settled());
  const rate = await page.evaluate(() => {
    const s = window.__ddalab.store.getState();
    return s.recordings[s.activeRecordingId as string].info.sample_rate_hz;
  });
  await setView(page, {
    t0,
    t1: t0 + (samplesPerPixel * width) / rate,
    firstChannel: channel,
    rowCount: 1,
    sensitivityUvPerMm: 100,
  });
}

/**
 * Compares every column of the drawn traces with the full polyline through the raw samples. In column c (sample
 * positions p0 = s0 + c * spp to p1 = p0 + spp) the polyline spans the samples strictly inside and its values at p0
 * and p1. The drawn span must contain that span and lie within the union of the spans of columns c - 1 to c + 1.
 * A value within TOLERANCE px of a pixel edge may fall on either side (float32 in the shader, float64 here).
 */
const checkPixels = (page: Page) =>
  page.evaluate(async () => {
    const TOLERANCE = 1e-3;
    const { engine, store, viewer } = window.__ddalab;
    const frame = await viewer.settled();
    const { width: W, height: H, s0, spp, firstChannel, rowCount, rowHeight, pxPerUnit, params } = frame;
    const state = store.getState();
    const id = state.activeRecordingId as string;
    const N = state.recordings[id].info.sample_count;
    const C = state.recordings[id].analysis_channels.length;
    const first = Math.max(0, Math.floor(s0) - 1);
    const last = Math.min(N - 1, Math.ceil(s0 + W * spp) + 1);
    const raw = await engine.raw(id, first, last - first + 1);
    const { data } = viewer.pixels();
    const failures: string[] = [];
    let inked = 0;
    for (let r = 0; r < rowCount; r++) {
      const ch = firstChannel + r;
      const [gain, offset] = params[ch];
      const center = (r + 0.5) * rowHeight;
      const v = (i: number) => raw[(i - first) * C + ch] * gain + offset;
      const at = (p: number) => {
        const i = Math.floor(p);
        return i + 1 > N - 1 ? v(i) : v(i) + (v(i + 1) - v(i)) * (p - i);
      };
      const y = (value: number) => center - value * pxPerUnit;
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
      for (let c = 0; c < W; c++) {
        let top = -1;
        let bottom = -1;
        let gaps = 0;
        for (let row = 0; row < H; row++) {
          const ink = data[((H - 1 - row) * W + c) * 4 + 3] > 0;
          if (ink && top < 0) top = row;
          if (ink) {
            gaps += bottom >= 0 && row > bottom + 1 ? 1 : 0;
            bottom = row;
          }
        }
        const ref = reference[c + 1];
        if (!ref) {
          if (top >= 0) failures.push(`column ${c}: ink where the recording has no rows`);
          continue;
        }
        if (Math.floor(ref[1]) < 0 || Math.floor(ref[0]) > H - 1) continue; // off the canvas
        const clamp = (row: number) => Math.min(H - 1, Math.max(0, row));
        const need = [clamp(Math.floor(ref[0] + TOLERANCE)), clamp(Math.floor(ref[1] - TOLERANCE))];
        const near = [c, c + 1, c + 2].flatMap((k) => (reference[k] ? [reference[k]] : []));
        const allow = [
          clamp(Math.floor(Math.min(...near.map((s) => s[0])) - TOLERANCE)),
          clamp(Math.floor(Math.max(...near.map((s) => s[1])) + TOLERANCE)),
        ];
        inked++;
        if (top < 0) failures.push(`column ${c}: no ink, expected rows ${need}`);
        else if (gaps > 0) failures.push(`column ${c}: the span has gaps`);
        else if (top > need[0] || bottom < need[1])
          failures.push(`column ${c}: ${top}..${bottom} misses ${need}`);
        else if (top < allow[0] || bottom > allow[1])
          failures.push(`column ${c}: ${top}..${bottom} past ${allow}`);
      }
    }
    return { mode: frame.mode, inked, failures: failures.slice(0, 10) };
  });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("/");
});

test("waveform_is_pixel_exact", async ({ page }) => {
  test.setTimeout(120_000);
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

// The synthetic recording has a +30000 spike (3000 µV) on its first channel every 97 s; the traces stay under
// 1050 µV. At every zoom from the whole recording to one epoch the column of every spike in view reaches its
// height, and no other column comes near it.
test("spike_survives_every_zoom", async ({ page }) => {
  test.setTimeout(120_000);
  await openSynthetic(page, { channels: 2, rateHz: 256, durationS: 7200, seed: 4 });
  const spikeS = 97;
  for (const span of [7200, 2400, 600, 150, 40, 10]) {
    const t0 = Math.min(7200 - span, Math.max(0, spikeS - span / 3));
    await setView(page, { t0, t1: t0 + span, firstChannel: 0, rowCount: 1, sensitivityUvPerMm: 100 });
    const seen = await page.evaluate(async (every) => {
      const { viewer } = window.__ddalab;
      const frame = await viewer.settled();
      const { data } = viewer.pixels();
      const { width: W, height: H, s0, spp, rowHeight, pxPerUnit } = frame;
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
      return { mode: frame.mode, spikeTops, elsewhere, expected: rowHeight / 2 - 3000 * pxPerUnit };
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
  await openSynthetic(page, { channels: 64, rateHz: 1000, durationS: 86_400, seed: 2 });
  await setView(page, { t0: 60_000, t1: 60_000 + 6 * 3600 });
  await expect
    .poll(() => page.evaluate(() => window.__ddalab.viewer.frame?.missing ?? []))
    .toEqual([[0, expect.any(Number)]]);
  const frame = await page.evaluate(() => window.__ddalab.viewer.frame);
  expect(frame?.missing[0][1]).toBe(frame?.width);
  expect(frame?.mode).toBe("tile");
});

test("paging_keys", async ({ page }) => {
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
});

test("sensitivity_steps", async ({ page }) => {
  await openFixture(page);
  const sensitivity = async () => (await view(page)).sensitivityUvPerMm;
  await setView(page, { sensitivityUvPerMm: 7 });
  await page.keyboard.press("]");
  expect(await sensitivity()).toBe(10);
  await expect(
    page.getByRole("region", { name: "Waveforms" }).getByText("10 µV/mm", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("[");
  await page.keyboard.press("[");
  expect(await sensitivity()).toBe(5);
  await setView(page, { sensitivityUvPerMm: 100 });
  await page.keyboard.press("]");
  expect(await sensitivity()).toBe(100);
  await setView(page, { sensitivityUvPerMm: 1 });
  await page.keyboard.press("[");
  expect(await sensitivity()).toBe(1);
  // The command bar sets it too.
  await page.getByRole("combobox", { name: "Sensitivity" }).click();
  await page.getByRole("option", { name: "30 µV/mm" }).click();
  expect(await sensitivity()).toBe(30);
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
