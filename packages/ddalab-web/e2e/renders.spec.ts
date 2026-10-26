// What re-renders while values change at a high rate: the scan and the hashes of a recording, the blocks of a run,
// scrolling and the keyboard in lists. Counted per component through React's devtools hook (renders.ts). And what
// the canvases repaint for.
import { countRenders, renders } from "./renders";
import { showFixture } from "./resultFixture";
import { expect, type Page, test } from "./test";

/** 64 channels at 256 Hz for 4 h: a scan and a hash that report dozens of times. */
const SCAN = { channels: 64, rateHz: 256, durationS: 4 * 3600, seed: 11 };

/** The renders of `names` from now until `done` resolves. */
async function rendersDuring(page: Page, names: string[], done: () => Promise<unknown>) {
  const before = await renders(page);
  await done();
  const after = await renders(page);
  return Object.fromEntries(names.map((name) => [name, (after[name] ?? 0) - (before[name] ?? 0)]));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await countRenders(page);
  await page.goto("/");
});

test("a_scan_re_renders_its_progress_only", async ({ page }) => {
  test.setTimeout(120_000);
  const id = await page.evaluate((spec) => window.__ddalab.openSynthetic(spec), SCAN);
  // A run of this recording, still running: the provenance shows how far its files are hashed.
  await page.evaluate((id) => {
    const { store } = window.__ddalab;
    const request = {
      file_path: "synthetic.edf",
      channels: [0, 1],
      time_range: { start: 0, end: 2560 },
      preprocessing_options: { highpass: null, lowpass: null },
      algorithm_selection: { enabled_variants: ["ST"] },
      window_parameters: { window_length: 200, window_step: 100 },
      delay_parameters: { delays: [7, 10] },
    };
    const { fingerprint } = store.getState().recordings[id];
    const record = {
      id: "run",
      fingerprint,
      fileName: "synthetic.edf",
      request,
      createdAt: 0,
      status: "running",
    };
    store.setState({ analyses: [record as never], activeResultId: "run" });
    const counted = window as unknown as { writes: number };
    counted.writes = 0;
    store.subscribe((now, before) => {
      if (now.recordings !== before.recordings) counted.writes++;
    });
  }, id);
  await expect(page.getByRole("region", { name: "Provenance" })).toBeVisible();
  const counts = await rendersDuring(
    page,
    ["Scan", "Inspector", "DdaSettings", "RunBar", "Details", "Command", "OpenRecordings", "OpenRecording"],
    () =>
      expect
        .poll(
          () =>
            page.evaluate((id) => {
              const { scan } = window.__ddalab.store.getState().recordings[id];
              return scan.scannedRows === scan.totalRows && Object.keys(scan.sha256 ?? {}).length === 1;
            }, id),
          { timeout: 100_000 },
        )
        .toBe(true),
  );
  const writes = await page.evaluate(() => (window as unknown as { writes: number }).writes);
  expect(writes).toBeGreaterThan(5);
  expect(counts.Scan).toBeGreaterThan(5);
  // The annotations replace the recording's info once; nothing else these show changes.
  for (const name of [
    "Inspector",
    "DdaSettings",
    "RunBar",
    "Details",
    "Command",
    "OpenRecordings",
    "OpenRecording",
  ]) {
    expect(counts[name], name).toBeLessThanOrEqual(2);
  }
});

test("a_run_re_renders_its_progress_only", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(
    !(await page.evaluate(() =>
      navigator.storage.getDirectory().then(
        () => true,
        () => false,
      ),
    )),
    "this browser window has no OPFS",
  );
  // Four DDA workers whatever the machine, for a fixed count of blocks.
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
  await runBar.getByLabel("End", { exact: true }).fill("1200");
  await runBar.getByLabel("End", { exact: true }).press("Enter");
  const plan = runBar.getByText(/windows, [\d,]+ blocks, \d+ workers?/);
  await expect(plan).toBeVisible();
  const blocks = Number(/([\d,]+) blocks/.exec((await plan.textContent()) ?? "")?.[1].replace(",", ""));
  expect(blocks).toBeGreaterThanOrEqual(4);
  const counts = await rendersDuring(page, ["RunBar", "RunButton", "Progress"], async () => {
    await runBar.getByRole("button", { name: "Run DDA" }).click();
    await expect(runBar.getByText("Complete", { exact: true })).toBeVisible({ timeout: 150_000 });
  });
  // Progress follows every block; the bar and the button follow the start and the end.
  expect(counts.Progress).toBeGreaterThanOrEqual(blocks);
  expect(counts.RunBar).toBeLessThanOrEqual(3);
  expect(counts.RunButton).toBeLessThanOrEqual(3);
});

test("canvases_repaint_for_what_they_draw", async ({ page }) => {
  test.skip(
    !(await page.evaluate(() =>
      navigator.storage.getDirectory().then(
        () => true,
        () => false,
      ),
    )),
    "this browser window has no OPFS",
  );
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 8, rateHz: 256, durationS: 60, seed: 4 }),
  );
  await page.evaluate(() => window.__ddalab.viewer.settled());
  await showFixture(page, { id: "fixture", windows: 200, rows: 4, first: 0.5, step: 0.25, values: [] });
  await page.evaluate(() => window.__ddalab.results.settled());
  await expect(page.getByText("Overview 100%")).toBeVisible();
  /** The paints of each canvas over 10 store writes, two frames apart, that `write` makes. */
  const paints = (write: "settings" | "cursor") =>
    page.evaluate(async (write) => {
      const { viewer, results, store } = window.__ddalab;
      viewer.frames = [];
      let overview = 0;
      const tab = document.querySelector('[class*="outline"] > span') as HTMLElement;
      const observer = new MutationObserver((records) => (overview += records.length));
      observer.observe(tab, { childList: true, characterData: true, subtree: true });
      let heatmap = 0;
      results.frame = null;
      const poll = setInterval(() => {
        if (results.frame) heatmap++;
        results.frame = null;
      });
      for (let i = 0; i < 10; i++) {
        if (write === "settings")
          store.setState((s) => ({ ddaForm: { ...s.ddaForm, windowLength: String(200 + i) } }));
        else store.setState((s) => ({ cursorS: 10 + i, view: { ...s.view, t0: i, t1: i + 10 } }));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }
      clearInterval(poll);
      observer.disconnect();
      const waveform = viewer.frames.length;
      viewer.frames = null;
      return { waveform, overview, heatmap };
    }, write);
  // Typing in the DDA settings changes nothing they draw; moving the view and the cursor redraws all three.
  expect(await paints("settings")).toEqual({ waveform: 0, overview: 0, heatmap: 0 });
  const moved = await paints("cursor");
  expect(moved.waveform).toBeGreaterThan(5);
  expect(moved.overview).toBeGreaterThan(5);
  expect(moved.heatmap).toBeGreaterThan(5);
});

test("a_closed_inspector_neither_renders_nor_plans", async ({ page }) => {
  test.setTimeout(120_000);
  await page.getByRole("button", { name: "Inspector" }).click();
  const id = await page.evaluate((spec) => window.__ddalab.openSynthetic(spec), SCAN);
  const counts = await rendersDuring(page, ["Inspector", "Scan", "RunBar", "RunButton"], async () => {
    await expect
      .poll(
        () =>
          page.evaluate((id) => {
            const { scan } = window.__ddalab.store.getState().recordings[id];
            return scan.scannedRows === scan.totalRows;
          }, id),
        { timeout: 100_000 },
      )
      .toBe(true);
  });
  expect(counts.Scan).toBeLessThanOrEqual(1);
  expect(counts.Inspector).toBeLessThanOrEqual(1);
  // Each rested view asks the core for one plan: the command bar's, which says why a run cannot start.
  const plans = await page.evaluate(async (id) => {
    const { engine, store } = window.__ddalab;
    store.setState((s) => ({
      recordings: { ...s.recordings, [id]: { ...s.recordings[id], selectedChannels: [0, 1] } },
    }));
    await new Promise((rested) => setTimeout(rested, 600));
    let asked = 0;
    const plan = engine.plan.bind(engine);
    engine.plan = (...args: Parameters<typeof plan>) => {
      asked++;
      return plan(...args);
    };
    for (let i = 1; i <= 4; i++) {
      store.setState((s) => ({ view: { ...s.view, t0: i * 10, t1: i * 10 + 10 } }));
      await new Promise((rested) => setTimeout(rested, 800));
    }
    await new Promise((rested) => setTimeout(rested, 2000));
    return asked;
  }, id);
  expect(plans).toBe(4);
  // Opened again, the inspector shows the interval of this moment.
  await page.getByRole("button", { name: "Inspector" }).click();
  await expect(page.getByRole("region", { name: "Run" }).getByLabel("Start", { exact: true })).toHaveValue(
    "40",
  );
});
