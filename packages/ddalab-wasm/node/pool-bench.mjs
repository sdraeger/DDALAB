// How long does a pool of wasm workers take to write the bundle of a request on a 1 h, 1 kHz EDF, how much memory
// does it hold, and how does it compare with the native CLI on the same request and core count?
//
// Per case of the config (each case runs the pool in its own Node process, then the CLI):
//   workers           = os.availableParallelism() - spare_cores worker threads, each with its own module instance
//                       and file descriptor, taking blocks (plan_blocks at budget_mb) from one shared atomic counter;
//                       the main thread writes their chunks into the bundle files and hashes the input meanwhile;
//                       every instance opens the file with a BlockCache of cache_mb MiB
//   blocks            = number of blocks in the plan
//   wall_s            = seconds from ddalab_plan to manifest.json written
//   peak_rss_mb       = process.resourceUsage().maxRSS / 1024 of the process that ran the pool
//   worker_wasm_mb    = max over workers of the worker's wasm memory at its end (memory.buffer.byteLength / 2^20),
//                       the high-water mark of its heap: wasm memory never shrinks
//   native_cli_wall_s = seconds of `ddalab run --bundle --block-mb budget_mb` with DDALAB_RAYON_THREADS = workers
//   outputs_identical = every .npy of the two bundles is byte-equal and the manifests equal apart from id and time
//
// Inputs: `cargo run --release --example make_fixtures -- --large <fixtures_dir> 16 32 128` (packages/dda-rs),
// `cargo build --release --bin ddalab` and the wasm build (see parity.test.mjs).
// Command: node packages/ddalab-wasm/node/pool-bench.mjs packages/ddalab-wasm/node/pool-bench.config.json
// Writes packages/ddalab-wasm/results/pool_bench.csv and pool_bench_config.json (the config, machine, commit, hashes).
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { load, WASM } from './host.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const CLI = here('../../dda-rs/target/release/ddalab');
const RESULTS = here('../results/');
const KEYS = ['fixtures_dir', 'output_dir', 'spare_cores', 'max_case_seconds', 'window_length', 'window_step',
  'delays', 'dm', 'order', 'nr_tau', 'cases'];
const CASE_KEYS = ['name', 'file', 'variant', 'channels', 'ct_pairs', 'budget_mb', 'cache_mb'];
const MASKS = { ST: '1 0 0 0 0 0', CT: '0 1 0 0 0 0' };

const range = (n) => [...Array(n).keys()];
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function readConfig(file) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = KEYS.filter((k) => !(k in config)).concat(
    config.cases.flatMap((c) => CASE_KEYS.filter((k) => !(k in c)).map((k) => `${c.name}.${k}`)),
  );
  if (missing.length) throw new Error(`config lacks ${missing.join(', ')}`);
  return config;
}

/** "all" is every pair i < j of the case's channels. */
const pairsOf = (c) =>
  c.ct_pairs === 'all' ? range(c.channels).flatMap((i) => range(c.channels).slice(i + 1).map((j) => [i, j])) : c.ct_pairs;

/** The request `ddalab run` builds for the case (dda_params::build_dda_request). */
function request(config, c, rows) {
  if (!(c.variant in MASKS)) throw new Error(`${c.name}: variant ${c.variant} is not ST or CT`);
  const ct = c.variant === 'CT';
  return {
    file_path: path.join(config.fixtures_dir, c.file),
    channels: range(c.channels),
    time_range: { start: 0, end: rows - 1 },
    preprocessing_options: { highpass: null, lowpass: null },
    algorithm_selection: { enabled_variants: [c.variant], select_mask: MASKS[c.variant] },
    window_parameters: {
      window_length: config.window_length,
      window_step: config.window_step,
      ...(ct ? { ct_window_length: config.window_length, ct_window_step: config.window_step } : {}),
    },
    delay_parameters: { delays: config.delays },
    ...(ct ? { ct_channel_pairs: pairsOf(c) } : {}),
    model_parameters: { dm: config.dm, order: config.order, nr_tau: config.nr_tau },
  };
}

/** One worker thread: runs blocks from the shared counter, posts their chunks, then its wasm memory in MiB. */
async function work({ module, file, cacheMb, req, blocks, counter }) {
  const abi = await load(module);
  const { handle } = abi.open([file], undefined, cacheMb);
  const next = new Int32Array(counter);
  for (let i; (i = Atomics.add(next, 0, 1)) < blocks.length; ) {
    const chunks = abi.runBlock(handle, req, blocks[i].w0, blocks[i].w1);
    parentPort.postMessage(chunks, chunks.length ? [chunks[0].bytes.buffer] : []);
  }
  abi.close(handle);
  parentPort.postMessage(abi.exports.memory.buffer.byteLength / 2 ** 20);
}

/** Runs case `c` on the worker pool into `<output_dir>/wasm-<name>`. */
async function runPool(config, c) {
  const file = path.join(config.fixtures_dir, c.file);
  const dir = path.join(config.output_dir, `wasm-${c.name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const workers = os.availableParallelism() - config.spare_cores;
  const module = await WebAssembly.compile(fs.readFileSync(WASM));
  const abi = await load(module);
  const { handle, info } = abi.open([file], undefined, c.cache_mb);
  const req = request(config, c, info.sample_count);

  const start = performance.now();
  const { blocks, layout, windows } = abi.plan(handle, req, c.budget_mb);
  const fds = layout.arrays.map((a) => {
    fs.mkdirSync(path.dirname(path.join(dir, a.path)), { recursive: true });
    const fd = fs.openSync(path.join(dir, a.path), 'w');
    fs.writeSync(fd, Uint8Array.from(a.header));
    fs.ftruncateSync(fd, a.header.length + a.shape.reduce((x, y) => x * y, 1) * 8);
    return fd;
  });
  const counter = new SharedArrayBuffer(4);
  let written = 0;
  const wasmMb = [];
  const done = new Promise((resolve, reject) => {
    for (let w = 0; w < workers; w++) {
      const worker = new Worker(SCRIPT, { workerData: { module, file, cacheMb: c.cache_mb, req, blocks, counter } });
      worker.on('error', reject);
      worker.on('message', (message) => {
        if (typeof message === 'number') wasmMb.push(message);
        else {
          for (const { array, offset, bytes } of message) fs.writeSync(fds[array], bytes, 0, bytes.length, offset);
          written++;
        }
        if (written === blocks.length && wasmMb.length === workers) resolve();
      });
    }
  });
  // Chunks queue while the main thread hashes; the workers keep running.
  const input_sha256 = { [path.basename(file)]: abi.sha256File(file) };
  await done;
  const manifest = abi.manifest(handle, req, { id: '', created_at_iso: '', input_sha256, windows });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  const wall_s = (performance.now() - start) / 1000;
  fds.forEach((fd) => fs.closeSync(fd));
  const peak_rss_mb = process.resourceUsage().maxRSS / 1024;
  return { workers, blocks: blocks.length, wall_s, peak_rss_mb, worker_wasm_mb: Math.max(...wasmMb) };
}

/** The same request through the CLI into `<output_dir>/cli-<name>`: seconds. */
function runCli(config, c, threads) {
  const dir = path.join(config.output_dir, `cli-${c.name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const ctArgs = c.variant === 'CT' ? ['--ct-pairs', ...pairsOf(c).map((p) => p.join(','))] : [];
  const args = ['run', '--file', path.join(config.fixtures_dir, c.file), '--channels', ...range(c.channels).map(String),
    '--variants', c.variant, '--wl', `${config.window_length}`, '--ws', `${config.window_step}`,
    '--delays', ...config.delays.map(String), '--dm', `${config.dm}`, '--order', `${config.order}`,
    '--nr-tau', `${config.nr_tau}`, ...ctArgs, '--block-mb', `${c.budget_mb}`, '--bundle', dir, '--quiet'];
  const start = performance.now();
  execFileSync(CLI, args, {
    env: { ...process.env, DDALAB_RAYON_THREADS: `${threads}` },
    timeout: config.max_case_seconds * 1000,
  });
  return (performance.now() - start) / 1000;
}

/** Both bundles hold the same bytes, and the same manifest apart from id and creation time. */
function sameBundles(config, c) {
  const dirs = ['wasm', 'cli'].map((side) => path.join(config.output_dir, `${side}-${c.name}`));
  const [a, b] = dirs.map((d) => JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')));
  const arrays = a.variants.flatMap((v) => v.arrays);
  const sameArrays = arrays.every((p) => fs.readFileSync(path.join(dirs[0], p)).equals(fs.readFileSync(path.join(dirs[1], p))));
  const strip = ({ id, created_at_iso, ...rest }) => rest;
  return sameArrays && isDeepStrictEqual(strip(a), strip(b));
}

async function main(configFile) {
  const config = readConfig(configFile);
  fs.mkdirSync(config.output_dir, { recursive: true });
  const rows = ['case,variant,channels,budget_mb,cache_mb,blocks,workers,wall_s,peak_rss_mb,worker_wasm_mb,' +
    'native_cli_wall_s,outputs_identical'];
  const inputs = {};
  for (const [i, c] of config.cases.entries()) {
    const child = spawnSync(process.execPath, [SCRIPT, configFile, `${i}`], {
      encoding: 'utf8',
      timeout: config.max_case_seconds * 1000,
    });
    if (child.status !== 0) throw new Error(`${c.name}: ${child.stderr || child.error}`);
    const pool = JSON.parse(child.stdout);
    const native = runCli(config, c, pool.workers);
    rows.push([c.name, c.variant, c.channels, c.budget_mb, c.cache_mb, pool.blocks, pool.workers,
      pool.wall_s.toFixed(2), pool.peak_rss_mb.toFixed(0), pool.worker_wasm_mb.toFixed(0), native.toFixed(2),
      sameBundles(config, c)].join(','));
    inputs[c.file] = JSON.parse(fs.readFileSync(path.join(config.output_dir, `cli-${c.name}`, 'manifest.json'), 'utf8'))
      .reproduction.input_sha256[c.file];
    console.log(rows.at(-1));
  }
  const git = (...args) => execFileSync('git', args, { cwd: here('.'), encoding: 'utf8' }).trim();
  const resolved = {
    config_file: path.basename(configFile),
    config,
    cpu_model: os.cpus()[0].model,
    logical_cores: os.availableParallelism(),
    total_memory_gb: os.totalmem() / 2 ** 30,
    node_version: process.version,
    commit: git('rev-parse', 'HEAD'),
    worktree_dirty: git('status', '--porcelain') !== '',
    wasm_sha256: sha256(WASM),
    cli_sha256: sha256(CLI),
    input_sha256: inputs,
  };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'pool_bench.csv'), rows.join('\n') + '\n');
  fs.writeFileSync(path.join(RESULTS, 'pool_bench_config.json'), JSON.stringify(resolved, null, 2) + '\n');
}

if (!isMainThread) await work(workerData);
else if (process.argv[3] !== undefined) {
  const config = readConfig(process.argv[2]);
  console.log(JSON.stringify(await runPool(config, config.cases[Number(process.argv[3])])));
} else await main(process.argv[2]);
