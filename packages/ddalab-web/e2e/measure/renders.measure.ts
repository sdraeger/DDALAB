// React renders and DOM work while values change at a high rate, on the dev server (component names unminified),
// counted through React's devtools hook (../renders.ts). Each quantity is a line {name, label, value} in $OUT.
//
// scan_renders[C], scan_renders_per_second[C]: commits that rendered component C while a 64-channel, 4 h synthetic
//   recording is scanned and hashed, with a running result of it active (the provenance shows); per second of that
// scan_closed_*: the same with the inspector closed
// run_renders[C]: commits that rendered C over a 9-block run (8 channels, 4,000-sample windows every 10 samples)
// pan_layouts_per_move, pan_style_recalcs_per_move: Chromium's LayoutCount and RecalcStyleCount over a drag of 60
//   pointer moves across the waveform, one frame apart, divided by 60
// paints_over_30_unrelated_writes: waveform frames (viewer probe), overview tab mutations and heatmap probe frames over
//   30 writes of the DDA settings, two frames apart
// plan_requests_per_rested_view_inspector_closed: engine.plan calls over 5 view moves 600 ms apart, divided by 5
// arrow_key_renders_over_20_keys[C]: commits that rendered C over 20 ArrowDown presses in a 64-row result
// channel_scroll_renders_over_140px[C]: commits that rendered C over 70 scroll steps of 2 px in a 512-channel list
import { appendFileSync } from "node:fs";
import { countRenders, renders } from "../renders";
import { showFixture } from "../resultFixture";
import { expect, type Page, test } from "../test";

const OUT = process.env.OUT as string;
const LABEL = process.env.LABEL as string;
const put = (name: string, value: unknown) =>
  appendFileSync(OUT, `${JSON.stringify({ name, label: LABEL, value })}\n`);
const delta = (after: Record<string, number>, before: Record<string, number>, names: string[]) =>
  Object.fromEntries(names.map((n) => [n, (after[n] ?? 0) - (before[n] ?? 0)]));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await countRenders(page);
  await page.goto("/");
  await page.evaluate(() => window.__ddalab.engine.version());
});

const SCAN = { channels: 64, rateHz: 256, durationS: 4 * 3600, seed: 11 };
const NAMES = [
  "Inspector",
  "Scan",
  "Channels",
  "DdaSettings",
  "RunBar",
  "IntervalFields",
  "Details",
  "InputFiles",
  "Command",
  "OpenRecordings",
  "OpenRecording",
  "LibraryRail",
];

/** A running record of the recording `id` made active: the provenance shows its hashing. */
const provenanceOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { store } = window.__ddalab;
    const { fingerprint } = store.getState().recordings[id];
    const request = {
      file_path: "synthetic.edf",
      channels: [0, 1],
      time_range: { start: 0, end: 2560 },
      preprocessing_options: { highpass: null, lowpass: null },
      algorithm_selection: { enabled_variants: ["ST"] },
      window_parameters: { window_length: 200, window_step: 100 },
      delay_parameters: { delays: [7, 10] },
    };
    store.setState({
      analyses: [
        {
          id: "fake",
          fingerprint,
          fileName: "synthetic.edf",
          request,
          createdAt: Date.now(),
          status: "running",
        },
      ],
      activeResultId: "fake",
    });
  }, id);

async function scanRenders(page: Page, label: string) {
  const id = await page.evaluate((spec) => window.__ddalab.openSynthetic(spec), SCAN);
  await provenanceOf(page, id);
  await page.locator(`section[aria-label="Provenance"]`).waitFor({ state: "attached" });
  await page.waitForTimeout(100);
  const before = await renders(page);
  const start = Date.now();
  const ticks = await page.evaluate(() => {
    const w = window as unknown as { __ticks: number };
    w.__ticks = 0;
    window.__ddalab.store.subscribe((s, p) => {
      if (s.recordings !== p.recordings) w.__ticks++;
    });
  });
  void ticks;
  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          const { scan } = window.__ddalab.store.getState().recordings[id];
          return scan.scannedRows === scan.totalRows && Object.keys(scan.sha256 ?? {}).length === 1;
        }, id),
      { timeout: 200_000 },
    )
    .toBe(true);
  const seconds = (Date.now() - start) / 1000;
  const counts = delta(await renders(page), before, NAMES);
  const storeTicks = await page.evaluate(() => (window as unknown as { __ticks: number }).__ticks);
  put(`${label}_seconds`, Number(seconds.toFixed(1)));
  put(`${label}_recording_writes`, storeTicks);
  put(`${label}_renders`, counts);
  put(
    `${label}_renders_per_second`,
    Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number((v / seconds).toFixed(1))])),
  );
}

test("scan_renders", async ({ page }) => {
  test.setTimeout(300_000);
  await scanRenders(page, "scan");
});

test("scan_renders_inspector_closed", async ({ page }) => {
  test.setTimeout(300_000);
  await page.getByRole("button", { name: "Inspector" }).click();
  await scanRenders(page, "scan_closed");
});

test("run_renders", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 5 }));
  await page.reload();
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 8, rateHz: 256, durationS: 2 * 3600, seed: 5 }),
  );
  await page.getByRole("checkbox", { name: "Select group CH" }).check();
  const settings = page.getByRole("region", { name: "DDA settings" });
  await settings.getByLabel("Window", { exact: true }).fill("4000");
  await settings.getByLabel("Step", { exact: true }).fill("10");
  const runBar = page.getByRole("region", { name: "Run" });
  await runBar.getByLabel("Start", { exact: true }).fill("0");
  await runBar.getByLabel("End", { exact: true }).fill("1800");
  await runBar.getByLabel("End", { exact: true }).press("Enter");
  await expect(runBar.getByText(/windows, [\d,]+ blocks?, \d+ workers?/)).toBeVisible();
  const plan = await runBar.getByText(/windows, [\d,]+ blocks?/).textContent();
  await page.waitForTimeout(500);
  const before = await renders(page);
  await runBar.getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar.getByText("Complete", { exact: true })).toBeVisible({ timeout: 200_000 });
  const counts = delta(await renders(page), before, [
    "RunBar",
    "RunButton",
    "Progress",
    "IntervalFields",
    "Outcome",
    "Inspector",
  ]);
  put("run_plan", plan);
  put("run_renders", counts);
});

test("pan_layouts", async ({ page }) => {
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 32, rateHz: 256, durationS: 600, seed: 4 }),
  );
  await page.evaluate(() => window.__ddalab.viewer.settled());
  await page.waitForTimeout(500);
  const plot = page.locator("canvas[data-traces]");
  const box = (await plot.boundingBox()) as { x: number; y: number; width: number; height: number };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metric = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
    return { layouts: get("LayoutCount"), styles: get("RecalcStyleCount") };
  };
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.79, y);
  const start = await metric();
  const moves = 60;
  for (let i = 0; i < moves; i++) {
    await page.mouse.move(box.x + box.width * (0.79 - (0.5 * (i + 1)) / moves), y);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  const end = await metric();
  await page.mouse.up();
  put("pan_moves", moves);
  put("pan_layouts_per_move", Number(((end.layouts - start.layouts) / moves).toFixed(2)));
  put("pan_style_recalcs_per_move", Number(((end.styles - start.styles) / moves).toFixed(2)));
});

test("unrelated_writes_repaint", async ({ page }) => {
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 8, rateHz: 256, durationS: 60, seed: 4 }),
  );
  await page.evaluate(() => window.__ddalab.viewer.settled());
  await showFixture(page, { id: "fx", windows: 200, rows: 4, first: 0.5, step: 0.25, values: [] });
  await page.evaluate(() => window.__ddalab.results.settled());
  await page.waitForTimeout(500);
  const counts = await page.evaluate(async () => {
    const { viewer, results, store } = window.__ddalab;
    viewer.frames = [];
    let heat = 0;
    const tab = document.querySelector('[class*="outline"] > span') as HTMLElement;
    let overview = 0;
    const observer = new MutationObserver((records) => (overview += records.length));
    observer.observe(tab, { childList: true, characterData: true, subtree: true });
    const waiter = setInterval(() => {
      if (results.frame) heat++;
      results.frame = null;
    }, 1);
    results.frame = null;
    for (let i = 0; i < 30; i++) {
      store.setState((s) => ({ ddaForm: { ...s.ddaForm, windowLength: String(200 + i) } }));
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }
    clearInterval(waiter);
    observer.disconnect();
    const waveform = viewer.frames?.length ?? 0;
    viewer.frames = null;
    return { waveform, overview, heatmap: heat };
  });
  put("paints_over_30_unrelated_writes", counts);
});

test("plan_requests_inspector_closed", async ({ page }) => {
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 8, rateHz: 256, durationS: 600, seed: 4 }),
  );
  await page.getByRole("checkbox", { name: "Select group CH" }).check();
  await page.getByRole("button", { name: "Inspector" }).click();
  await page.waitForTimeout(800);
  const calls = await page.evaluate(async () => {
    const { engine, store } = window.__ddalab;
    let n = 0;
    const plan = engine.plan.bind(engine);
    engine.plan = (...args: Parameters<typeof plan>) => {
      n++;
      return plan(...args);
    };
    for (let i = 1; i <= 5; i++) {
      store.setState((s) => ({ view: { ...s.view, t0: i * 10, t1: i * 10 + 10 } }));
      await new Promise((ok) => setTimeout(ok, 600));
    }
    return n;
  });
  put("plan_requests_per_rested_view_inspector_closed", calls / 5);
});

test("result_row_focus_renders", async ({ page }) => {
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 64, rateHz: 256, durationS: 60, seed: 4 }),
  );
  await page.evaluate(() => window.__ddalab.viewer.settled());
  await showFixture(page, { id: "fx", windows: 200, rows: 64, first: 0.5, step: 0.25, values: [] });
  await page.evaluate(() => window.__ddalab.results.settled());
  const rows = page.getByRole("list", { name: "Result rows" }).getByRole("button");
  await rows.first().focus();
  await page.waitForTimeout(300);
  const before = await renders(page);
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowDown");
  await expect(rows.nth(20)).toBeFocused();
  await page.waitForTimeout(300);
  put(
    "arrow_key_renders_over_20_keys",
    delta(await renders(page), before, ["Heatmap", "Gutter", "VariantTabs", "ColorBar"]),
  );
});

test("channel_scroll_renders", async ({ page }) => {
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 512, rateHz: 256, durationS: 60, seed: 3 }),
  );
  const list = page.getByRole("list", { name: "Channels" });
  await expect(list.getByText("CH1", { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  const before = await renders(page);
  const events = await list.evaluate(async (element) => {
    const scroller = element.parentElement as HTMLElement;
    let n = 0;
    scroller.addEventListener("scroll", () => n++);
    for (let i = 1; i <= 70; i++) {
      scroller.scrollTop = i * 2;
      await new Promise(requestAnimationFrame);
    }
    return n;
  });
  put("channel_scroll_events", events);
  put("channel_scroll_renders_over_140px", delta(await renders(page), before, ["ChannelList", "Channels"]));
});
