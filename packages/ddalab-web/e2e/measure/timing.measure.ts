// How long the page takes to show what the startup, a finished run, a deep link and an opened recording bring, on an
// e2e-mode build served with the app's CSP (playwright.config.ts). Each quantity is measured REPEAT times; a line
// {name, label, median, values} goes to $OUT. Times in ms. "Since load" is the page's performance.now(), whose origin
// is the navigation start.
//
// history_row_since_load: when the first history row ([data-result]) is in the DOM, over 40 stored results
// engine_ready_since_load: when engine.version() resolves, which waits for the wasm compile
// restored_result_section_since_load, restored_heatmap_frame_since_load: after a reload with a result shown, when the
//   Result section is in the DOM, and when the heatmap draws its first complete frame
// run_done_to_shown_in_store, run_done_to_result_section, run_done_to_heatmap_frame: from the run's `done` to the store
//   showing the result, the Result section, the heatmap's first complete frame of that result
// manifest_reads_per_run: resultManifest calls from the run's start until 500 ms after its first complete frame
// deep_link_first_graphql_request_since_load: when the first request to openneuro.org/crn/graphql reaches the route
//   (wall clock of the test process minus performance.timeOrigin; the API is mocked)
// open_to_first_waveform_frame: from the change event of the recording file input (the BrainVision fixture) to the
//   first complete waveform frame, opened 1 s after the page has loaded
//
// COLD=1 disables the HTTP cache and limits the link to 20 Mbit/s with 40 ms latency; names then start with "cold_".
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "../test";

const OUT = process.env.OUT as string;
const LABEL = process.env.LABEL as string;
const COLD = Boolean(process.env.COLD);
const REPEAT = 7;
const FIXTURES = fileURLToPath(new URL("../../../dda-rs/tests/fixtures/", import.meta.url));
const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) => FIXTURES + name);
const DEMO =
  "?openneuro=ds003029&tag=1.0.7&file=sub-pt01/ses-presurgery/ieeg/sub-pt01_ses-presurgery_task-ictal_acq-ecog_run-01_ieeg.vhdr";

function put(name: string, values: number[]) {
  const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const line = { name: COLD ? `cold_${name}` : name, label: LABEL, median, values: values.map(Math.round) };
  appendFileSync(OUT, `${JSON.stringify(line)}\n`);
}

type Marks = Partial<Record<"row" | "result" | "heatmap" | "wasm", number>>;
/** Marks, since load, the first history row, the Result section, the first complete heatmap frame and the engine. */
const watch = (page: Page) =>
  page.addInitScript(() => {
    const at: Record<string, number> = {};
    let asked = false;
    Object.assign(window, { marks: at });
    const check = () => {
      const now = performance.now();
      const hook = (window as Partial<Window>).__ddalab;
      if (at.row === undefined && document.querySelector("[data-result]")) at.row = now;
      if (at.result === undefined && document.querySelector('section[aria-label="Result"]')) at.result = now;
      if (at.heatmap === undefined && hook?.results.frame?.complete) at.heatmap = now;
      if (!asked && hook) {
        asked = true;
        void hook.engine.version().then(() => {
          at.wasm = performance.now();
        });
      }
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true });
    const frame = () => {
      check();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
const marks = (page: Page) => page.evaluate(() => (window as unknown as { marks: Marks }).marks);

/** Opens the BrainVision fixture and readies a run of ST on Fp1 and Fp2 from 1 s to 5 s. */
async function readyBrainVision(page: Page) {
  await page.getByLabel("Recording files").setInputFiles(BRAINVISION);
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await page.getByRole("checkbox", { name: "Select Fp2" }).check();
  const runBar = page.getByRole("region", { name: "Run" });
  await expect(runBar.getByText(/^Plan /)).toBeVisible();
  await page.evaluate(() => window.__ddalab.store.setState({ selection: { t0: 1, t1: 5 } }));
  await expect(runBar.getByLabel("End", { exact: true })).toHaveValue("5");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  if (!COLD) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: 20e6 / 8,
    uploadThroughput: 5e6 / 8,
  });
});

test("history_fill", async ({ page }) => {
  await watch(page);
  await page.goto("/");
  await page.evaluate(() => window.__ddalab.engine.version());
  // 40 records, each with a stored result's status file.
  await page.evaluate(async () => {
    const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results", {
      create: true,
    });
    const db: IDBDatabase = await new Promise((opened, failed) => {
      const request = indexedDB.open("ddalab");
      request.onsuccess = () => opened(request.result);
      request.onerror = () => failed(request.error);
    });
    const request = {
      file_path: "a.edf",
      channels: [0],
      time_range: { start: 0, end: 1000 },
      preprocessing_options: { highpass: null, lowpass: null },
      algorithm_selection: { enabled_variants: ["ST"] },
      window_parameters: { window_length: 200, window_step: 100 },
      delay_parameters: { delays: [7, 10] },
    };
    for (let i = 0; i < 40; i++) {
      const id = `seed-${i}`;
      const directory = await results.getDirectoryHandle(id, { create: true });
      const status = await (await directory.getFileHandle("status", { create: true })).createWritable();
      await status.write("complete");
      await status.close();
      await new Promise((done) => {
        const put = db.transaction("analyses", "readwrite");
        put
          .objectStore("analyses")
          .put({ id, fingerprint: "f", fileName: "a.edf", request, createdAt: i, status: "complete" });
        put.oncomplete = done;
      });
    }
    db.close();
  });
  const rows: number[] = [];
  const engine: number[] = [];
  for (let i = 0; i < REPEAT; i++) {
    await page.reload();
    await expect
      .poll(async () => (await marks(page)).row !== undefined && (await marks(page)).wasm !== undefined)
      .toBe(true);
    const m = await marks(page);
    rows.push(m.row as number);
    engine.push(m.wasm as number);
  }
  put("history_row_since_load", rows);
  put("engine_ready_since_load", engine);
});

test("restore_result", async ({ page }) => {
  await watch(page);
  await page.goto("/");
  await readyBrainVision(page);
  const runBar = page.getByRole("region", { name: "Run" });
  await runBar.getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar.getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible();
  const section: number[] = [];
  const heatmap: number[] = [];
  for (let i = 0; i < REPEAT; i++) {
    await page.reload();
    await expect.poll(async () => (await marks(page)).heatmap !== undefined, { timeout: 30_000 }).toBe(true);
    const m = await marks(page);
    section.push(m.result as number);
    heatmap.push(m.heatmap as number);
  }
  put("restored_result_section_since_load", section);
  put("restored_heatmap_frame_since_load", heatmap);
});

test("run_to_result", async ({ page }) => {
  test.skip(COLD, "the run reads local files: the link does not take part");
  await page.goto("/");
  await readyBrainVision(page);
  await page.evaluate(() => {
    const { engine, store, results } = window.__ddalab;
    const w = window as unknown as { run?: Record<string, number>; manifests: number };
    w.manifests = 0;
    const read = engine.resultManifest.bind(engine);
    engine.resultManifest = (id: string) => {
      w.manifests++;
      return read(id);
    };
    const run = engine.run.bind(engine);
    engine.run = async (...args: Parameters<typeof run>) => {
      const handle = await run(...args);
      const at: Record<string, number> = {};
      w.run = at;
      void handle.done.then(() => {
        at.done = performance.now();
        const wait = (frame: { resultId: string }) => {
          if (frame.resultId === handle.id) at.heatmap = performance.now();
          else results.waiters.push(wait);
        };
        results.waiters.push(wait);
      });
      const stop = store.subscribe((s) => {
        if (s.shownResult?.id !== handle.id || at.shown !== undefined) return;
        at.shown = performance.now();
        stop();
      });
      new MutationObserver((_, observer) => {
        if (at.done === undefined || !document.querySelector('section[aria-label="Result"]')) return;
        at.section = performance.now();
        observer.disconnect();
      }).observe(document.body, { childList: true, subtree: true });
      return handle;
    };
  });
  const shown: number[] = [];
  const section: number[] = [];
  const heatmap: number[] = [];
  const manifests: number[] = [];
  const counted = () => page.evaluate(() => (window as unknown as { manifests: number }).manifests);
  for (let i = 0; i < REPEAT; i++) {
    await page.evaluate(() => window.__ddalab.store.setState({ shownResult: null, activeResultId: null }));
    await expect(page.getByRole("region", { name: "Result" })).toHaveCount(0);
    const before = await counted();
    await page.getByRole("region", { name: "Run" }).getByRole("button", { name: "Run DDA" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { run?: { heatmap?: number } }).run?.heatmap), {
        timeout: 60_000,
      })
      .toBeDefined();
    const at = await page.evaluate(() => (window as unknown as { run: Record<string, number> }).run);
    shown.push(at.shown - at.done);
    section.push(at.section - at.done);
    heatmap.push(at.heatmap - at.done);
    await page.waitForTimeout(500);
    manifests.push((await counted()) - before);
    await page.evaluate(() => Reflect.deleteProperty(window, "run"));
  }
  put("run_done_to_shown_in_store", shown);
  put("run_done_to_result_section", section);
  put("run_done_to_heatmap_frame", heatmap);
  put("manifest_reads_per_run", manifests);
});

test("deep_link_first_graphql", async ({ page }) => {
  let hit = 0;
  await page.route("https://openneuro.org/crn/graphql", async (route) => {
    hit ||= Date.now();
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    await route.fulfill({ json: { data: { snapshot: { files: [] } } }, headers });
  });
  const first: number[] = [];
  for (let i = 0; i < REPEAT; i++) {
    hit = 0;
    await page.goto(`/${DEMO}`);
    await expect.poll(() => hit).not.toBe(0);
    first.push(hit - (await page.evaluate(() => performance.timeOrigin)));
    await page.goto("about:blank");
  }
  put("deep_link_first_graphql_request_since_load", first);
});

test("open_to_first_waveform", async ({ page }) => {
  const times: number[] = [];
  for (let i = 0; i < REPEAT; i++) {
    await page.goto("/");
    await page.evaluate(() => window.__ddalab.engine.version());
    // The user picks files a moment after the page has loaded.
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const at: Record<string, number> = {};
      Object.assign(window, { opened: at });
      document.addEventListener(
        "change",
        (event) => {
          if (!(event.target as Element).matches('input[aria-label="Recording files"]')) return;
          at.start = performance.now();
          window.__ddalab.viewer.waiters.push(() => {
            at.frame = performance.now();
          });
        },
        { capture: true, once: true },
      );
    });
    await page.getByLabel("Recording files").setInputFiles(BRAINVISION);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { opened: { frame?: number } }).opened.frame))
      .toBeDefined();
    const at = await page.evaluate(() => (window as unknown as { opened: Record<string, number> }).opened);
    times.push(at.frame - at.start);
  }
  put("open_to_first_waveform_frame", times);
});
