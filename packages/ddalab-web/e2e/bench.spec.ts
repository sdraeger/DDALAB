/**
 * Is browser DDA within `max_ratio` (the spec's 1.5) of the native CLI on the same core count, and what do the spec's
 * display metrics read on this machine? It runs in Chromium and stays out of CI (the `bench` project, `npm run bench`).
 *
 * Settings: e2e/bench.config.json, every key required. Each case runs `variant` on every channel of a synthetic EDF of
 * `channels` channels (src/core/synthetic.ts at `recording`), from its first sample to its last, with the window,
 * delays and model of the config, CT on every pair of channels; the request is the one the DDA settings form makes
 * (validateRequest), and the native command the one the provenance shows for it (cliCommand).
 *   workers   = navigator.hardwareConcurrency - 1, the DDA workers of the browser's run (engine.ts poolSize)
 *   browser_s = seconds from engine.run to its `done`: blocks computed, written to OPFS, the manifest written; the file
 *               is opened, scanned and hashed before the clock starts
 *   native_s  = seconds of `ddalab run --bundle` for the same request with DDALAB_RAYON_THREADS = workers, its own
 *               block budget, the file in the page cache
 *   ratio     = browser_s / native_s
 * Display metrics, one value each, repeated on every row (e2e/perfMeasures.ts, the measurements of e2e/perf.spec.ts):
 *   first_viewport_ms = ms from opening DAY (24 h, 256 channels, 2 kHz) to its first complete frame
 *   scan_mb_s         = bytes of the LARGE EDF (2 GiB) / 1e6 / seconds of its scan
 *   pan_p95_ms_tile   = 95th percentile of the frame times of `pan_steps` pan frames of 300 s spans of DAY, 64 rows at
 *                       3,840 device px, tiles cached
 *   pan_p95_ms_raw    = the same over 20 s spans (raw sample spans)
 *   peak_memory_gb    = max(JS heaps of the page and its workers + wasm memory of the IO, hash and annotation workers)
 *                       / 1e9 over two samples of the LARGE scan, mid-scan and at its end
 * The run fails after writing its outputs when a case's ratio exceeds `max_ratio`.
 *
 * Command: DDALAB_E2E_PORT=<port> npm run bench (packages/ddalab-web)
 * Inputs: the synthetic EDFs, written to the system temp directory; the CLI packages/dda-rs/target/release/ddalab
 * (global-setup.ts builds it) and src/core/ddalab.wasm, hashed into the config output.
 * Outputs: results/browser_bench.csv (a row per case) and results/browser_bench_config.json (the resolved config,
 * machine, browser, commit, load averages and hashes).
 */
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, loadavg, tmpdir, totalmem } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { cliCommand } from "../src/core/cliCommand";
import type { DDARequest, RecordingInfo, VariantInfo } from "../src/core/types";
import { validateRequest } from "../src/features/analysis/validate";
import { CLI } from "./global-setup";
import {
  DAY,
  firstViewportMs,
  LARGE,
  LARGE_PATH,
  type MemorySample,
  PANS,
  pan,
  scanMemory,
  scanThroughput,
  start,
  widenPlot,
  writeSynthetic,
} from "./perfMeasures";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const CONFIG_FILE = here("bench.config.json");
const RESULTS = here("../results/");
const KEYS = [
  "recording",
  "window_length",
  "window_step",
  "delays",
  "model_terms",
  "dm",
  "order",
  "nr_tau",
  "pan_steps",
  "max_case_seconds",
  "max_ratio",
  "cases",
];
const CASE_KEYS = ["name", "variant", "channels"];

interface Case {
  name: string;
  variant: string;
  channels: number;
}
const config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
const missing = KEYS.filter((k) => !(k in config)).concat(
  (config.cases ?? []).flatMap((c: Case) => CASE_KEYS.filter((k) => !(k in c)).map((k) => `${c.name}.${k}`)),
  ["rate_hz", "duration_s", "seed"]
    .filter((k) => !(k in (config.recording ?? {})))
    .map((k) => `recording.${k}`),
);
if (missing.length > 0) throw new Error(`${CONFIG_FILE} lacks ${missing.join(", ")}`);
const cases: Case[] = config.cases;

const specOf = (channels: number) => ({
  channels,
  rateHz: config.recording.rate_hz,
  durationS: config.recording.duration_s,
  seed: config.recording.seed,
});
const pathOf = ({ channels, rateHz, durationS, seed }: ReturnType<typeof specOf>) =>
  join(tmpdir(), `ddalab-bench-${channels}ch-${rateHz}hz-${durationS}s-seed${seed}.edf`);

/** What the tests measure, written out once all of it is there. */
const display: Partial<
  Record<"first_viewport_ms" | "scan_mb_s" | "pan_p95_ms_tile" | "pan_p95_ms_raw" | "peak_memory_gb", number>
> = {};
const rows: {
  name: string;
  variant: string;
  channels: number;
  windows: number;
  blocks: number;
  workers: number;
  browser_s: number;
  native_s: number;
}[] = [];
const inputs: Record<string, string> = {};
const machine = { load_average_start: loadavg(), browser_cores: 0 };

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.setTimeout(900_000);
  writeSynthetic(LARGE, LARGE_PATH);
  for (const { channels } of cases) writeSynthetic(specOf(channels), pathOf(specOf(channels)));
});

test.beforeEach(({ page }) => start(page));

test("first_viewport", async ({ page }) => {
  display.first_viewport_ms = await firstViewportMs(page);
});

test("scan_throughput", async ({ page }) => {
  test.setTimeout(300_000);
  display.scan_mb_s = (await scanThroughput(page)).mbPerS;
});

test("pan_frames", async ({ page }) => {
  test.setTimeout(600_000);
  await widenPlot(page);
  for (const [spanS, mode] of PANS) {
    const result = await pan(page, spanS, config.pan_steps);
    expect(result.mode).toBe(mode);
    expect(result.count).toBeGreaterThanOrEqual(config.pan_steps - 1);
    display[mode === "tile" ? "pan_p95_ms_tile" : "pan_p95_ms_raw"] = result.p95;
  }
});

test("peak_memory", async ({ page }) => {
  test.setTimeout(300_000);
  const { peak, end } = await scanMemory(page);
  const total = (sample: MemorySample) => sample.js + sample.wasm;
  display.peak_memory_gb = Math.max(total(peak), total(end)) / 1e9;
});

/** Opens `path` by the file picker and waits for its scan and its hash; the recording's id and info. */
async function openScanned(page: Page, path: string) {
  await page.getByLabel("Recording files").setInputFiles(path);
  const state = () =>
    page.evaluate((name) => {
      const s = window.__ddalab.store.getState();
      const scan = s.recordings[s.activeRecordingId as string]?.scan;
      if (scan?.error) throw new Error(scan.error);
      return Boolean(scan && scan.scannedRows === scan.totalRows && scan.sha256?.[name]);
    }, basename(path));
  await expect.poll(state, { timeout: 300_000, intervals: [500] }).toBe(true);
  return page.evaluate(() => {
    const s = window.__ddalab.store.getState();
    const id = s.activeRecordingId as string;
    const { info, scan } = s.recordings[id];
    return { id, info, sha256: scan.sha256 as Record<string, string> };
  });
}

/** The request the DDA settings form makes for `c` in expert mode with the config's values. */
function requestOf(c: Case, info: RecordingInfo, variants: VariantInfo[]): DDARequest {
  const chosen = variants.filter((v) => v.abbreviation === c.variant);
  if (chosen.length !== 1) throw new Error(`${c.name}: the engine has no variant ${c.variant}`);
  const { request, errors } = validateRequest(
    {
      expert: true,
      variants: chosen,
      channels: Array.from({ length: c.channels }, (_, i) => i),
      startS: 0,
      endS: info.duration_s,
      windowLength: String(config.window_length),
      windowStep: String(config.window_step),
      delays: config.delays.join(" "),
      modelTerms: config.model_terms.join(" "),
      dm: String(config.dm),
      order: String(config.order),
      nrTau: String(config.nr_tau),
    },
    info,
  );
  if (!request) throw new Error(`${c.name}: ${Object.values(errors).join("; ")}`);
  return request;
}

/** Seconds of the native CLI writing the bundle of `request` on `path` with `threads` threads. */
function native(request: DDARequest, path: string, threads: number) {
  const bundle = join(dirname(path), `${basename(path).replace(/\.[^.]*$/, "")}.dda`);
  rmSync(bundle, { recursive: true, force: true });
  const command = `${cliCommand(request, basename(path)).replace(/^ddalab /, `${JSON.stringify(CLI)} `)} --quiet`;
  const started = performance.now();
  execSync(command, {
    cwd: dirname(path),
    env: { ...process.env, DDALAB_RAYON_THREADS: String(threads) },
    stdio: "inherit",
    timeout: config.max_case_seconds * 1000,
  });
  const seconds = (performance.now() - started) / 1000;
  rmSync(bundle, { recursive: true, force: true });
  return seconds;
}

for (const c of cases) {
  test(`dda_${c.name}`, async ({ page }) => {
    test.setTimeout(3 * config.max_case_seconds * 1000);
    const path = pathOf(specOf(c.channels));
    const { id, info, sha256 } = await openScanned(page, path);
    Object.assign(inputs, sha256);
    const variants = await page.evaluate(async () => (await window.__ddalab.engine.version()).variants);
    machine.browser_cores = await page.evaluate(() => navigator.hardwareConcurrency);
    const request = requestOf(c, info, variants);
    const ran = await page.evaluate(
      async ([id, request]) => {
        const { engine } = window.__ddalab;
        const started = performance.now();
        const handle = await engine.run(id, request);
        await handle.done;
        const seconds = (performance.now() - started) / 1000;
        await engine.deleteResult(handle.id);
        return { seconds, plan: handle.plan };
      },
      [id, request] as const,
    );
    const { windows, blocks, workers } = ran.plan;
    const nativeS = native(request, path, workers);
    rows.push({ ...c, windows, blocks, workers, browser_s: ran.seconds, native_s: nativeS });
    console.log(
      `${c.name}: browser ${ran.seconds.toFixed(2)} s, native ${nativeS.toFixed(2)} s, ${workers} workers`,
    );
  });
}

test.afterAll(async ({ browser }) => {
  const shown = Object.keys(display).length;
  if (shown < 5 || rows.length < cases.length) {
    console.log(
      `bench incomplete (${shown} of 5 display metrics, ${rows.length} of ${cases.length} cases): no outputs`,
    );
    return;
  }
  const d = display as Required<typeof display>;
  const csv = [
    "case,variant,channels,windows,blocks,workers,browser_s,native_s,ratio,first_viewport_ms,scan_mb_s," +
      "pan_p95_ms_tile,pan_p95_ms_raw,peak_memory_gb",
    ...rows.map((r) =>
      [
        r.name,
        r.variant,
        r.channels,
        r.windows,
        r.blocks,
        r.workers,
        r.browser_s.toFixed(2),
        r.native_s.toFixed(2),
        (r.browser_s / r.native_s).toFixed(3),
        d.first_viewport_ms.toFixed(0),
        d.scan_mb_s.toFixed(0),
        d.pan_p95_ms_tile.toFixed(2),
        d.pan_p95_ms_raw.toFixed(2),
        d.peak_memory_gb.toFixed(3),
      ].join(","),
    ),
  ];
  const git = (...args: string[]) => execFileSync("git", args, { cwd: here("."), encoding: "utf8" }).trim();
  const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const resolved = {
    config_file: "e2e/bench.config.json",
    config,
    display_workloads: {
      first_viewport: DAY,
      scan: LARGE,
      pan: { recording: DAY, spans: PANS },
      memory: LARGE,
    },
    cpu_model: cpus()[0].model,
    logical_cores: availableParallelism(),
    browser_cores: machine.browser_cores,
    workers: rows[0].workers,
    total_memory_gb: totalmem() / 2 ** 30,
    browser: `${browser.browserType().name()} ${browser.version()}`,
    node_version: process.version,
    commit: git("rev-parse", "HEAD"),
    // Untracked files (notes beside the code) do not enter the builds.
    worktree_dirty: git("status", "--porcelain", "--untracked-files=no") !== "",
    load_average_start: machine.load_average_start,
    load_average_end: loadavg(),
    wasm_sha256: sha(here("../src/core/ddalab.wasm")),
    cli_sha256: sha(CLI),
    input_sha256: inputs,
  };
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, "browser_bench.csv"), `${csv.join("\n")}\n`);
  writeFileSync(join(RESULTS, "browser_bench_config.json"), `${JSON.stringify(resolved, null, 2)}\n`);
  console.log(csv.join("\n"));
  const over = rows.filter((r) => r.browser_s / r.native_s > config.max_ratio).map((r) => r.name);
  expect(over, `cases over the ratio ${config.max_ratio}`).toEqual([]);
});
