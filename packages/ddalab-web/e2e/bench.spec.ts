/**
 * Is browser DDA within `max_ratio` (the spec's 1.5) of the native CLI doing the same work on the same core count, and
 * what do the spec's display metrics read on this machine? It runs in Chromium and stays out of CI (the `bench`
 * project, `npm run bench`), against the minified build: `vite build --mode e2e` (the e2e test hook kept) served by
 * `vite preview`. Every page runs in a persistent Chromium profile of its own, its OPFS on disk on the volume the CLI
 * writes to.
 *
 * Settings: e2e/bench.config.json (or the file DDALAB_BENCH_CONFIG names), every key required. Each case runs
 * `variant` on every channel of a synthetic EDF of `channels` channels (src/core/synthetic.ts at `recording`), first
 * sample to last, with the window, delays and model of the config, CT on every pair of channels. The request is the
 * one the DDA settings form makes (validateRequest); the native command the one the provenance shows for it
 * (cliCommand) plus `--block-mb budget_mb`, with DDALAB_RAYON_THREADS = workers. The file is opened, scanned and
 * hashed in the page first. Each case waits up to `load_wait_s` for the 1-minute load average to fall to `max_load_1m`,
 * and is skipped (and the run failed at the end) when it does not; then it runs `repeats` times, browser then native
 * on even repeats and native then browser on odd ones.
 *   windows        = 1 + floor((N - (window_length + max(delays) + 2 dm - 1)) / window_step), N = end - start + 1 the
 *                    samples of the run's range, as the core counts them (engine.plan)
 *   repeats        = `repeats` of the config for a measured case, 0 for a skipped one
 *   skipped        = empty for a measured case; else "load L above max_load_1m", L the 1-minute load average after
 *                    waiting `load_wait_s`
 *   workers        = the DDA workers of the browser's run, ddaPoolSize(navigator.hardwareConcurrency, channels) of
 *                    engine.ts: every core but one, fewer when the memory contract's sizing rule needs it
 *   threads        = DDALAB_RAYON_THREADS of the CLI = workers
 *   budget_mb      = the browser's block budget, min(16, needed / (2 workers)) MiB (scheduler.ts blockBudgetMb)
 *   browser_blocks = blocks of the browser's plan; native_blocks = blocks of the core's plan (the wasm host in Node)
 *                    for the request the CLI recorded in its manifest, at budget_mb; the case fails when they differ
 *   browser_s      = median over repeats of the seconds from engine.run to its `done` (blocks computed and written to
 *                    OPFS, the manifest written); the input's SHA-256 is known before the clock starts
 *   native_s       = median over repeats of the seconds from the CLI's first progress line on stderr (its serial
 *                    SHA-256 of the input done, its first window computed) to its exit: the same span without hashing,
 *                    which in the browser runs while the recording is open, before Run
 *   ratio          = browser_s / native_s
 *   native_total_s = median of the CLI's whole wall time (`time -p` real: start, open, hash, plan, run, exit)
 *   native_cpu_s   = median of the CLI's user + sys seconds (`time -p`), its hash included; native_cpu_s /
 *                    native_total_s is the CLI's mean busy threads
 *   load_1m_max    = max of the 1-minute load average at the start of each of the case's runs
 * Memory comes from one more browser run of the case after the repeats, kept out of the timing: sampling slows a run.
 * Its caches are warm first: the plot shows every channel and steps across the whole recording at 20 s spans (raw
 * rows) and at 300 s spans (tiles), each frame drawn before the next (warmCaches). Its samples start every
 * `memory_sample_ms` from engine.run to `done`, or as soon as the one before returns when that took longer
 * (e2e/sampleMax.ts):
 *   run_memory_gb          = max over samples of performance.measureUserAgentSpecificMemory().bytes / 1e9: the JS of
 *                            the page and its dedicated workers, in a cross-origin isolated page, measured eagerly
 *                            (`browser_args`); it does not cover any worker's wasm memory
 *   run_memory_interval_ms = mean milliseconds between the starts of those samples
 *   run_wasm_gb            = max over samples of (sum over the run's DDA workers of the wasm memory each reported with
 *                            its last block + the wasm memory of the IO, hash and annotation workers), each
 *                            memory.buffer.byteLength, / 1e9: the wasm run_memory_gb leaves out
 *   run_js_wasm_gb         = run_memory_gb + run_wasm_gb: the figure for the spec's 1.5 GB contract on JS plus wasm,
 *                            every worker's wasm included, an upper bound on their simultaneous total, as the two
 *                            maxima may fall at different times
 *   run_rss_tree_gb        = max over samples every `memory_sample_ms` of sum(RSS of each process of the Chromium
 *                            process tree of the case's profile) / 1e9, from `ps`: an upper bound, which counts pages
 *                            that processes share once per process
 * results/browser_bench_runs.csv has a row per run:
 *   case, repeat   = the case's name; the repeat, 0 to repeats - 1 for timed runs and `repeats` for the memory run
 *   side, order    = browser, native or memory; 0 for the first run of its repeat, 1 for the second, 0 for memory
 *   load_1m        = the 1-minute load average when the run starts
 *   seconds        = browser and memory: engine.run to `done`; native: the CLI's first progress line to its exit
 *   total_s, cpu_s = native only: the CLI's `time -p` real, and user + sys
 *   memory_gb, memory_interval_ms, wasm_gb, rss_tree_gb = memory only: run_memory_gb, run_memory_interval_ms,
 *                    run_wasm_gb and run_rss_tree_gb of the case
 * Each repeat compares the two outputs and fails on a difference: every .npy array byte for byte (SHA-256), and the
 * manifests, the recorded request included, apart from id, creation time and the build commit (`comparable`).
 * Display metrics, one value each, repeated on every row (e2e/perfMeasures.ts, the measurements of e2e/perf.spec.ts):
 *   first_viewport_ms = ms from opening DAY (24 h, 256 channels, 2 kHz) to its first complete frame
 *   scan_mb_s         = bytes of the LARGE EDF (2 GiB, 64 channels) / 1e6 / seconds of its scan
 *   pan_p95_ms_tile   = 95th percentile of the frame times of `pan_steps` pan frames of 300 s spans of DAY, 64 rows at
 *                       3,840 device px, tiles cached; pan_p95_ms_raw: the same over 20 s spans (raw sample spans)
 *   pan_incomplete    = frames of both pans that lacked planned data; pan_blank = frames that drew a blank column;
 *                       both must be 0
 *   scan_memory_gb    = max(JS heaps of the page and its workers by measureUserAgentSpecificMemory + wasm memory of
 *                       the IO, hash and annotation workers) / 1e9 over two samples of the LARGE scan, the first once
 *                       5% is scanned with the plot drawing raw rows, the second at its end; the DDA workers are not
 *                       in it
 * The run fails after writing its outputs when a case was skipped or its ratio exceeds `max_ratio`.
 *
 * Command: DDALAB_E2E_PORT=<port> npm run bench (packages/ddalab-web)
 * Inputs: the synthetic EDFs, written to the system temp directory; the CLI packages/dda-rs/target/release/ddalab
 * (global-setup.ts builds it) and src/core/ddalab.wasm, both hashed into the config output; native_blocks loads the
 * cargo build that src/core/ddalab.wasm is copied from.
 * Outputs: results/browser_bench.csv (a row per case), results/browser_bench_runs.csv (a row per run) and
 * results/browser_bench_config.json (the resolved config, machine, browser, server, build profiles, commit, load
 * averages and hashes). All three are deleted when the run starts.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, cpus, loadavg, platform, release, tmpdir, totalmem } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cliCommand } from "../src/core/cliCommand";
import type { DDARequest, RecordingInfo, ResultDocument, VariantInfo } from "../src/core/types";
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
import { sampleMax } from "./sampleMax";
import { test as base, expect, type Page } from "./test";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const CONFIG_FILE = process.env.DDALAB_BENCH_CONFIG ?? here("bench.config.json");
const RESULTS = here("../results/");
const OUTPUTS = ["browser_bench.csv", "browser_bench_runs.csv", "browser_bench_config.json"];
// `profile_dir`: the folder of each test's Chromium profile in its output folder. `browser_args`: Chromium's flags;
// --enable-blink-features=ForceEagerMeasureMemory measures memory at once, where Chromium waits for its next garbage
// collection (up to 20 s).
const KEYS = [
  "profile_dir",
  "browser_args",
  "recording",
  "window_length",
  "window_step",
  "delays",
  "model_terms",
  "dm",
  "order",
  "nr_tau",
  "pan_steps",
  "repeats",
  "max_load_1m",
  "load_wait_s",
  "memory_sample_ms",
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

/** Pages in a persistent Chromium profile of their own, in the test's output folder. */
const test = base.extend({
  context: async (
    { playwright, channel, headless, viewport, deviceScaleFactor, userAgent, baseURL },
    use,
    testInfo,
  ) => {
    const context = await playwright.chromium.launchPersistentContext(
      testInfo.outputPath(config.profile_dir),
      {
        channel,
        headless,
        viewport,
        deviceScaleFactor,
        userAgent,
        baseURL,
        args: config.browser_args,
      },
    );
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

type Display = Record<
  | "first_viewport_ms"
  | "scan_mb_s"
  | "pan_p95_ms_tile"
  | "pan_p95_ms_raw"
  | "pan_incomplete"
  | "pan_blank"
  | "scan_memory_gb",
  number
>;
/** What the tests measure, written out once all of it is there. */
const display: Partial<Display> = {};
interface Run {
  case: string;
  repeat: number;
  side: "browser" | "native" | "memory";
  order: number;
  load_1m: number;
  seconds: number;
  total_s: number | null;
  cpu_s: number | null;
  memory_gb: number | null;
  memory_interval_ms: number | null;
  wasm_gb: number | null;
  rss_tree_gb: number | null;
}
/** The fields a side does not measure. */
const NONE = {
  total_s: null,
  cpu_s: null,
  memory_gb: null,
  memory_interval_ms: null,
  wasm_gb: null,
  rss_tree_gb: null,
};
const runs: Run[] = [];
interface Row extends Case {
  windows: number;
  workers: number;
  budget_mb: number;
  browser_blocks: number;
  native_blocks: number;
  skipped: string;
}
const rows: Row[] = [];
const inputs: Record<string, string> = {};
const machine = { load_average_start: loadavg(), browser_cores: 0 };

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.setTimeout(900_000);
  for (const name of OUTPUTS) rmSync(join(RESULTS, name), { force: true });
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
  display.pan_incomplete = 0;
  display.pan_blank = 0;
  for (const [spanS, mode] of PANS) {
    const result = await pan(page, spanS, config.pan_steps);
    expect(result.mode).toBe(mode);
    expect(result.count).toBeGreaterThanOrEqual(config.pan_steps - 1);
    expect(result).toMatchObject({ incomplete: 0, blank: 0 });
    display.pan_incomplete += result.incomplete;
    display.pan_blank += result.blank;
    display[mode === "tile" ? "pan_p95_ms_tile" : "pan_p95_ms_raw"] = result.p95;
  }
});

test("scan_memory", async ({ page }) => {
  test.setTimeout(300_000);
  const { peak, end } = await scanMemory(page);
  const total = (sample: MemorySample) => sample.js + sample.wasm;
  display.scan_memory_gb = Math.max(total(peak), total(end)) / 1e9;
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

/** The 1-minute load average once it is at most `max_load_1m`, or after `load_wait_s` when it never gets there. */
async function settledLoad() {
  const until = Date.now() + config.load_wait_s * 1000;
  while (loadavg()[0] > config.max_load_1m && Date.now() < until)
    await new Promise((r) => setTimeout(r, 5000));
  return loadavg()[0];
}

/** Bytes resident in the Chromium processes started with `profile` and all their descendants, from `ps`. */
function treeBytes(profile: string) {
  const processes = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((m) => m !== null)
    .map(([, pid, ppid, rss, command]) => ({ pid: +pid, ppid: +ppid, rss: +rss, command }));
  const tree = new Set(
    processes.filter((p) => p.command.includes(`--user-data-dir=${profile}`)).map((p) => p.pid),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of processes) {
      if (tree.has(p.pid) || !tree.has(p.ppid)) continue;
      tree.add(p.pid);
      grew = true;
    }
  }
  if (tree.size === 0) throw new Error(`no Chromium process runs the profile ${profile}`);
  return processes.filter((p) => tree.has(p.pid)).reduce((sum, p) => sum + p.rss * 1024, 0);
}

/** SHA-256 of each `.npy` file of the result `id` in OPFS, by path, and its manifest. */
const storedResult = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results");
    const found: Record<string, string> = {};
    async function walk(directory: FileSystemDirectoryHandle, prefix: string) {
      for await (const [name, entry] of directory.entries()) {
        if (entry.kind === "directory") await walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`);
        else if (name.endsWith(".npy")) {
          const bytes = await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer();
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          found[prefix + name] = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
        }
      }
    }
    await walk(await results.getDirectoryHandle(id), "");
    return { arrays: found, manifest: await window.__ddalab.engine.resultManifest(id) };
  }, id);

/** SHA-256 of each `.npy` file of a CLI bundle, by path, and its manifest. */
function bundleResult(dir: string) {
  const arrays: Record<string, string> = {};
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".npy"))
        arrays[relative(dir, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(dir);
  return { arrays, manifest: JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as ResultDocument };
}

/** One timed browser run: its seconds, its plan's blocks and its output. */
async function browserRun(page: Page, id: string, request: DDARequest) {
  const ran = await page.evaluate(
    async ([id, request]) => {
      const { engine } = window.__ddalab;
      const started = performance.now();
      const handle = await engine.run(id, request);
      await handle.done;
      return {
        seconds: (performance.now() - started) / 1000,
        resultId: handle.id,
        blocks: handle.plan.blocks,
      };
    },
    [id, request] as const,
  );
  const output = await storedResult(page, ran.resultId);
  await page.evaluate((resultId) => window.__ddalab.engine.deleteResult(resultId), ran.resultId);
  return { ...ran, output };
}

/**
 * Fills the caches the way viewing does: the plot shows every channel of the recording and steps across all of it at
 * 20 s spans (raw rows) and at 300 s spans (tiles), each frame drawn before the next.
 */
async function warmCaches(page: Page, info: RecordingInfo) {
  await page.evaluate(
    async ([duration, rows]) => {
      const { store, viewer } = window.__ddalab;
      for (const span of [20, 300]) {
        for (let t0 = 0; t0 < duration; t0 += span) {
          store.setState((s) => ({
            view: { ...s.view, t0, t1: t0 + span, firstChannel: 0, rowCount: rows },
          }));
          await viewer.settled();
        }
      }
    },
    [info.duration_s, info.channels.length] as const,
  );
}

/**
 * The untimed run that measures memory: the samples of measureUserAgentSpecificMemory and of every worker's wasm,
 * taken in the page by `sampleMax` (passed in as its source), and the process tree's RSS, sampled from here.
 */
async function memoryRun(page: Page, id: string, request: DDARequest, profile: string) {
  let rss = treeBytes(profile);
  const sampler = setInterval(() => {
    rss = Math.max(rss, treeBytes(profile));
  }, config.memory_sample_ms);
  try {
    const ran = await page.evaluate(
      async ([id, request, intervalMs, source]) => {
        if (!crossOriginIsolated) throw new Error("the page is not cross-origin isolated");
        const sample: typeof sampleMax = new Function(`return (${source})`)();
        const { engine } = window.__ddalab;
        const measured = performance as unknown as {
          measureUserAgentSpecificMemory(): Promise<{ bytes: number }>;
        };
        let handle: Awaited<ReturnType<typeof engine.run>> | undefined;
        let finish = () => {};
        const finished = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const others = async () => {
          const { io, hash, annotations } = await engine.wasmBytes();
          return io + hash + annotations;
        };
        const samples = Promise.all([
          sample(async () => (await measured.measureUserAgentSpecificMemory()).bytes, finished, intervalMs),
          sample(async () => (handle?.wasmBytes() ?? 0) + (await others()), finished, intervalMs),
        ]);
        const started = performance.now();
        try {
          handle = await engine.run(id, request);
          await handle.done;
        } finally {
          finish();
        }
        const seconds = (performance.now() - started) / 1000;
        const [memory, wasm] = await samples;
        await engine.deleteResult(handle.id);
        return { seconds, memory, wasmBytes: Math.max(wasm.max, handle.wasmBytes() + (await others())) };
      },
      [id, request, config.memory_sample_ms, String(sampleMax)] as const,
    );
    return { ...ran, rssBytes: rss };
  } finally {
    clearInterval(sampler);
  }
}

/**
 * One native run of `request` on `path` with `threads` threads at a block budget of `budgetMb` MiB: the seconds from
 * its first progress line to its exit, its whole wall and CPU seconds from `time -p`, and its bundle.
 */
function nativeRun(request: DDARequest, path: string, threads: number, budgetMb: number) {
  const bundle = join(dirname(path), `${basename(path).replace(/\.[^.]*$/, "")}.dda`);
  rmSync(bundle, { recursive: true, force: true });
  const cli = cliCommand(request, basename(path)).replace(/^ddalab /, `${JSON.stringify(CLI)} `);
  const command = `exec ${cli} --block-mb ${budgetMb}`;
  return new Promise<{ seconds: number; total_s: number; cpu_s: number; bundle: string }>(
    (resolve, reject) => {
      const child = spawn("/usr/bin/time", ["-p", "sh", "-c", command], {
        cwd: dirname(path),
        env: { ...process.env, DDALAB_RAYON_THREADS: String(threads) },
        timeout: config.max_case_seconds * 1000,
      });
      let computing: number | undefined;
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (text: string) => {
        if (computing === undefined && /\r {2}window \d+\//.test(text)) computing = performance.now();
        stderr += text;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        const ended = performance.now();
        const field = (name: string) => Number(new RegExp(`^${name} ([\\d.]+)$`, "m").exec(stderr)?.[1]);
        if (code !== 0 || computing === undefined) {
          return reject(new Error(`the CLI exited with ${code}: ${stderr.slice(-2000)}`));
        }
        resolve({
          seconds: (ended - computing) / 1000,
          total_s: field("real"),
          cpu_s: field("user") + field("sys"),
          bundle,
        });
      });
    },
  );
}

type Host = {
  load(): Promise<{
    open(paths: string[]): { handle: number };
    plan(handle: number, request: DDARequest, budgetMb: number): { blocks: unknown[] };
    close(handle: number): void;
  }>;
};
/** Blocks of the core's plan of `request` on `path` at `budgetMb` MiB, from the wasm host in Node. */
async function coreBlocks(path: string, request: DDARequest, budgetMb: number) {
  const host: Host = await import(new URL("../../ddalab-wasm/node/host.mjs", import.meta.url).href);
  const abi = await host.load();
  const { handle } = abi.open([path]);
  try {
    return abi.plan(handle, request, budgetMb).blocks.length;
  } finally {
    abi.close(handle);
  }
}

/**
 * A manifest without what differs between two runs of the same request: id and creation time, and the commit, which
 * the wasm build records and the CLI build of global-setup.ts leaves null.
 */
const comparable = ({ id, created_at_iso, reproduction, ...rest }: ResultDocument) => {
  const { git_commit, ...kept } = reproduction;
  return { ...rest, reproduction: kept };
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

for (const c of cases) {
  test(`dda_${c.name}`, async ({ page }) => {
    test.setTimeout((config.load_wait_s + 2 * config.repeats * config.max_case_seconds) * 1000 + 600_000);
    const path = pathOf(specOf(c.channels));
    const profile = test.info().outputPath(config.profile_dir);
    const { id, info, sha256 } = await openScanned(page, path);
    Object.assign(inputs, sha256);
    const variants = await page.evaluate(async () => (await window.__ddalab.engine.version()).variants);
    machine.browser_cores = await page.evaluate(() => navigator.hardwareConcurrency);
    const request = requestOf(c, info, variants);
    const plan = await page.evaluate(([id, request]) => window.__ddalab.engine.plan(id, request), [
      id,
      request,
    ] as const);
    const row: Row = {
      ...c,
      windows: plan.windows,
      workers: plan.workers,
      budget_mb: plan.budgetMb,
      browser_blocks: plan.blocks,
      native_blocks: 0,
      skipped: "",
    };
    rows.push(row);
    const load = await settledLoad();
    if (load > config.max_load_1m) {
      row.skipped = `load ${load.toFixed(2)} above ${config.max_load_1m}`;
      test.skip(true, `${c.name}: ${row.skipped}`);
    }
    let cliRequest: DDARequest | undefined;
    for (let repeat = 0; repeat < config.repeats; repeat++) {
      const sides = repeat % 2 === 0 ? (["browser", "native"] as const) : (["native", "browser"] as const);
      const outputs: Partial<Record<(typeof sides)[number], ReturnType<typeof bundleResult>>> = {};
      for (const [order, side] of sides.entries()) {
        const load_1m = loadavg()[0];
        const at = { case: c.name, repeat, side, order, load_1m };
        if (side === "browser") {
          const ran = await browserRun(page, id, request);
          expect(ran.blocks).toBe(plan.blocks);
          outputs.browser = ran.output;
          runs.push({ ...at, ...NONE, seconds: ran.seconds });
        } else {
          const ran = await nativeRun(request, path, plan.workers, plan.budgetMb);
          outputs.native = bundleResult(ran.bundle);
          rmSync(ran.bundle, { recursive: true, force: true });
          runs.push({ ...at, ...NONE, seconds: ran.seconds, total_s: ran.total_s, cpu_s: ran.cpu_s });
        }
      }
      const { browser, native } = outputs as Required<typeof outputs>;
      expect(browser.arrays, `${c.name}: arrays of repeat ${repeat}`).toEqual(native.arrays);
      expect(Object.keys(browser.arrays).length).toBeGreaterThan(0);
      expect(comparable(browser.manifest), `${c.name}: manifests of repeat ${repeat}`).toEqual(
        comparable(native.manifest),
      );
      cliRequest = native.manifest.reproduction.request;
    }
    if (cliRequest) row.native_blocks = await coreBlocks(path, cliRequest, plan.budgetMb);
    expect(row.native_blocks, `${c.name}: the CLI's blocks`).toBe(row.browser_blocks);
    await warmCaches(page, info);
    const load_1m = loadavg()[0];
    const measured = await memoryRun(page, id, request, profile);
    runs.push({
      ...NONE,
      case: c.name,
      repeat: config.repeats,
      side: "memory",
      order: 0,
      load_1m,
      seconds: measured.seconds,
      memory_gb: measured.memory.max / 1e9,
      memory_interval_ms: measured.memory.intervalMs,
      wasm_gb: measured.wasmBytes / 1e9,
      rss_tree_gb: measured.rssBytes / 1e9,
    });
    const mine = runs.filter((r) => r.case === c.name);
    const of = (side: Run["side"]) => median(mine.filter((r) => r.side === side).map((r) => r.seconds));
    console.log(
      `${c.name}: browser ${of("browser").toFixed(2)} s, native ${of("native").toFixed(2)} s, ` +
        `${plan.workers} workers, ${plan.budgetMb} MiB blocks`,
    );
  });
}

test.afterAll(async ({ browser }) => {
  const shown = Object.keys(display).length;
  if (shown < 7 || rows.length < cases.length) {
    console.log(
      `bench incomplete (${shown} of 7 display metrics, ${rows.length} of ${cases.length} cases): no outputs`,
    );
    return;
  }
  const d = display as Display;
  const csv = [
    "case,variant,channels,windows,workers,threads,budget_mb,browser_blocks,native_blocks,repeats,browser_s," +
      "native_s,ratio,native_total_s,native_cpu_s,run_memory_gb,run_memory_interval_ms,run_wasm_gb,run_js_wasm_gb," +
      "run_rss_tree_gb,load_1m_max,skipped,first_viewport_ms,scan_mb_s," +
      "pan_p95_ms_tile,pan_p95_ms_raw,pan_incomplete,pan_blank,scan_memory_gb",
    ...rows.map((r) => {
      const mine = runs.filter((run) => run.case === r.name);
      const browserRuns = mine.filter((run) => run.side === "browser");
      const nativeRuns = mine.filter((run) => run.side === "native");
      const memoryRun = mine.find((run) => run.side === "memory");
      const measured =
        !r.skipped && browserRuns.length > 0 && nativeRuns.length > 0 && memoryRun !== undefined;
      const browserS = median(browserRuns.map((run) => run.seconds));
      const nativeS = median(nativeRuns.map((run) => run.seconds));
      const fixed = (value: number, digits: number) => (measured ? value.toFixed(digits) : "");
      return [
        r.name,
        r.variant,
        r.channels,
        r.windows,
        r.workers,
        r.workers,
        r.budget_mb,
        r.browser_blocks,
        measured ? r.native_blocks : "",
        measured ? config.repeats : 0,
        fixed(browserS, 2),
        fixed(nativeS, 2),
        fixed(browserS / nativeS, 3),
        fixed(median(nativeRuns.map((run) => run.total_s ?? 0)), 2),
        fixed(median(nativeRuns.map((run) => run.cpu_s ?? 0)), 2),
        fixed(memoryRun?.memory_gb ?? 0, 3),
        fixed(memoryRun?.memory_interval_ms ?? 0, 0),
        fixed(memoryRun?.wasm_gb ?? 0, 3),
        fixed((memoryRun?.memory_gb ?? 0) + (memoryRun?.wasm_gb ?? 0), 3),
        fixed(memoryRun?.rss_tree_gb ?? 0, 3),
        fixed(Math.max(...mine.map((run) => run.load_1m)), 2),
        r.skipped,
        d.first_viewport_ms.toFixed(0),
        d.scan_mb_s.toFixed(0),
        d.pan_p95_ms_tile.toFixed(2),
        d.pan_p95_ms_raw.toFixed(2),
        d.pan_incomplete,
        d.pan_blank,
        d.scan_memory_gb.toFixed(3),
      ].join(",");
    }),
  ];
  const runsCsv = [
    "case,repeat,side,order,load_1m,seconds,total_s,cpu_s,memory_gb,memory_interval_ms,wasm_gb,rss_tree_gb",
    ...runs.map((r) =>
      [
        r.case,
        r.repeat,
        r.side,
        r.order,
        r.load_1m.toFixed(2),
        r.seconds.toFixed(3),
        r.total_s?.toFixed(2) ?? "",
        r.cpu_s?.toFixed(2) ?? "",
        r.memory_gb?.toFixed(3) ?? "",
        r.memory_interval_ms?.toFixed(0) ?? "",
        r.wasm_gb?.toFixed(3) ?? "",
        r.rss_tree_gb?.toFixed(3) ?? "",
      ].join(","),
    ),
  ];
  const git = (...args: string[]) => execFileSync("git", args, { cwd: here("."), encoding: "utf8" }).trim();
  const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const run = (command: string, ...args: string[]) => {
    try {
      return execFileSync(command, args, { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  /** The `[profile.release]` section of a Cargo.toml, or what cargo uses without one. */
  const profileOf = (toml: string) =>
    /^\[profile\.release\]\n((?:[^[\n].*\n?)*)/m.exec(readFileSync(here(toml), "utf8"))?.[1].trim() ??
    "none: cargo's default release profile (opt-level 3, lto off, 16 codegen units)";
  const require = createRequire(import.meta.url);
  const resolved = {
    config_file: relative(here(".."), CONFIG_FILE).startsWith("..")
      ? CONFIG_FILE
      : relative(here(".."), CONFIG_FILE),
    config,
    display_workloads: {
      first_viewport: DAY,
      scan: LARGE,
      pan: { recording: DAY, spans: PANS },
      memory: LARGE,
    },
    server: process.env.DDALAB_DIST
      ? "vite preview of `vite build --mode e2e` (minified, with the e2e test hook)"
      : "vite dev server",
    storage: "a persistent Chromium profile per test in test-results (OPFS on disk)",
    timed_span:
      "browser: engine.run to done, the input hashed before; " +
      "native: first progress line to exit, after the CLI's own serial hash",
    cpu_model: cpus()[0].model,
    logical_cores: availableParallelism(),
    browser_cores: machine.browser_cores,
    total_memory_gb: totalmem() / 2 ** 30,
    os: `${platform()} ${release()}`,
    os_version: run("sw_vers", "-productVersion"),
    power: run("pmset", "-g", "batt")?.split("\n")[0] ?? null,
    browser: `${browser.browserType().name()} ${browser.version()}`,
    playwright_version: require("@playwright/test/package.json").version,
    node_version: process.version,
    build_profiles: {
      wasm: profileOf("../../ddalab-wasm/Cargo.toml"),
      native: profileOf("../../dda-rs/Cargo.toml"),
    },
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
  writeFileSync(join(RESULTS, OUTPUTS[0]), `${csv.join("\n")}\n`);
  writeFileSync(join(RESULTS, OUTPUTS[1]), `${runsCsv.join("\n")}\n`);
  writeFileSync(join(RESULTS, OUTPUTS[2]), `${JSON.stringify(resolved, null, 2)}\n`);
  console.log(csv.join("\n"));
  const failures = rows.flatMap((r) => {
    if (r.skipped) return [`${r.name} skipped: ${r.skipped}`];
    const mine = runs.filter((run) => run.case === r.name);
    const ratio =
      median(mine.filter((run) => run.side === "browser").map((run) => run.seconds)) /
      median(mine.filter((run) => run.side === "native").map((run) => run.seconds));
    return ratio > config.max_ratio ? [`${r.name}: ratio ${ratio.toFixed(3)} above ${config.max_ratio}`] : [];
  });
  expect(failures).toEqual([]);
});
