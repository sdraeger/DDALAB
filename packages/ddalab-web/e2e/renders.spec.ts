// What re-renders while values change at a high rate: the scan and the hashes of a recording, the blocks of a run,
// scrolling and the keyboard in lists. Counted per component through React's devtools hook (renders.ts).
import { countRenders, renders } from "./renders";
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
