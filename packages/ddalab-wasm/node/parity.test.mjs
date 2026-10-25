// Does the wasm ABI give what the native CLI gives on the committed fixtures (packages/dda-rs/tests/fixtures)?
//
// run_blocks_match_native_bundle writes results/parity.csv, one row per (variant, budget_mb, array) for the
// block-capable v1 variants ST, CT, CD, DE, SY and CCD on the BrainVision fixture: every block
// of the plan for `budget_mb` runs through the ABI, its chunks land at their offsets in a buffer, and the buffer's
// f64 values a_i are compared with the values b_i of the CLI's `.npy` for the same request (`ddalab run --bundle`).
//   values    = n, the f64 count of the array
//   identical = #{i : bits(a_i) == bits(b_i), or both NaN (wasm leaves NaN payloads unspecified)}
//   max_rel   = max over i with bits(a_i) != bits(b_i) of |a_i - b_i| / max(|a_i|, |b_i|); 0 when all are identical
// The test passes when identical == values, or else when max_rel <= 1e-12.
//
// Build, then run from the repository root:
//   (cd packages/dda-rs && cargo build --release --bin ddalab --example dump_tiles)
//   (cd packages/ddalab-wasm && cargo build --release --target wasm32-unknown-unknown)
//   node --test packages/ddalab-wasm/node/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { load, unframe } from './host.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FIXTURES = here('../../dda-rs/tests/fixtures/');
const CLI = process.env.DDALAB_CLI ?? here('../../dda-rs/target/release/ddalab');
const DUMP_TILES = here('../../dda-rs/target/release/examples/dump_tiles');
const PARITY_CSV = here('../results/parity.csv');

const RECORDINGS = [
  ['fixture.edf'],
  ['fixture.bdf'],
  ['fixture.vhdr', 'fixture.eeg', 'fixture.vmrk'],
  ['fixture.csv'],
].map((names) => names.map((name) => path.join(FIXTURES, name)));
const [EDF, , BRAINVISION] = RECORDINGS;

const progress = [];
const abi = await load(undefined, (p) => progress.push(p));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddalab-parity-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const u32 = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
const tileId = (tile) => [u32(tile, 4), Number(new DataView(tile.buffer, tile.byteOffset).getBigUint64(8, true))];

/** Every tile `dump_tiles` writes for the recording, level by level. */
function nativeTiles(paths) {
  const out = path.join(tmp, 'tiles.bin');
  execFileSync(DUMP_TILES, [paths[0], out]);
  return unframe(new Uint8Array(fs.readFileSync(out)));
}

/** Per variant: the `ddalab run` arguments beyond the shared ones, and what they add to the request. */
const VARIANTS = {
  ST: { mask: '1 0 0 0 0 0', args: [] },
  CT: {
    mask: '0 1 0 0 0 0',
    args: ['--ct-pairs', '0,1', '0,2', '1,3'],
    ct: [200, 100],
    pairs: { ct_channel_pairs: [[0, 1], [0, 2], [1, 3]] },
  },
  CD: {
    mask: '0 0 1 0 0 0',
    args: ['--cd-pairs', '0,1', '2,1', '3,0'],
    ct: [200, 100],
    pairs: { cd_channel_pairs: [[0, 1], [2, 1], [3, 0]] },
  },
  DE: { mask: '0 0 0 0 1 0', args: ['--ct-wl', '2', '--ct-ws', '1'], ct: [2, 1] },
  SY: { mask: '0 0 0 0 0 1', args: [] },
  CCD: { mask: '0 0 0 0 0 0', args: [] },
};

/** A request as `ddalab run` builds it for `--channels 0 1 2 3 --wl 200 --ws 100` and the variant's arguments. */
function request(variant, rows) {
  const { mask, ct, pairs } = VARIANTS[variant];
  return {
    file_path: BRAINVISION[0],
    channels: [0, 1, 2, 3],
    time_range: { start: 0, end: rows - 1 },
    preprocessing_options: { highpass: null, lowpass: null },
    algorithm_selection: { enabled_variants: [variant], select_mask: mask },
    window_parameters: {
      window_length: 200,
      window_step: 100,
      ...(ct ? { ct_window_length: ct[0], ct_window_step: ct[1] } : {}),
    },
    delay_parameters: { delays: [7, 10] },
    ...pairs,
    model_parameters: { dm: 4, order: 4, nr_tau: 2 },
  };
}

test('version_lists_variants', () => {
  const { engine_version, variants } = abi.version();
  assert.match(engine_version, /^\d+\.\d+\.\d+/);
  const ids = variants.map((v) => v.abbreviation);
  for (const id of ['ST', 'CT', 'CD', 'DE', 'SY']) assert.ok(ids.includes(id), `${id} in ${ids}`);
});

// Every fixture format, EDF first; the EDF+ annotations come from `ddalab_annotations`, as `inspect` scans them.
test('open_edf_info_matches_cli', () => {
  for (const paths of RECORDINGS) {
    const cli = JSON.parse(execFileSync(CLI, ['inspect', '--file', paths[0], '--json'], { encoding: 'utf8' }));
    const { handle, info, analysis_channels } = abi.open(paths);
    const scan = abi.annotations(handle);
    abi.close(handle);
    const scanned = { ...info, annotations: scan.annotations, warnings: [...info.warnings, ...scan.warnings] };
    assert.deepEqual({ ...scanned, analysis_channels }, cli, paths[0]);
  }
  assert.throws(() => abi.open([path.join(FIXTURES, 'result_reference.json')]), /Unsupported file type/);
});

test('raw_tile_matches_cli', () => {
  for (const paths of RECORDINGS) {
    const native = nativeTiles(paths);
    const { handle } = abi.open(paths);
    for (const tile of native) {
      const [level, index] = tileId(tile);
      assert.deepEqual(Buffer.from(abi.rawTile(handle, level, index)), Buffer.from(tile), `${paths[0]} ${level}/${index}`);
    }
    const level0 = native.filter((tile) => tileId(tile)[0] === 0).length;
    assert.throws(() => abi.rawTile(handle, 0, level0), /does not exist/);
    assert.throws(() => abi.rawTile(handle, 0, -1), /index/);
    abi.close(handle);
    assert.throws(() => abi.rawTile(handle, 0, 0), /recording/);
  }
});

test('pyramid_matches_raw_tiles', () => {
  for (const paths of RECORDINGS) {
    const native = nativeTiles(paths);
    const { handle, info } = abi.open(paths);
    const pyramid = abi.pyramid(handle);
    assert.throws(() => pyramid.push(5, 10), /rows from 0/);
    assert.throws(() => pyramid.finish(), /expects rows 0\.\./);
    const built = [];
    for (let row = 0; row < info.sample_count; row += 999) {
      built.push(...pyramid.push(row, Math.min(999, info.sample_count - row)));
    }
    built.push(...pyramid.finish());
    built.sort((a, b) => tileId(a)[0] - tileId(b)[0] || tileId(a)[1] - tileId(b)[1]);
    assert.deepEqual(built.map((t) => Buffer.from(t)), native.map((t) => Buffer.from(t)), paths[0]);
    abi.close(handle);
  }
});

test('read_raw_is_row_major_display_channels', () => {
  const { handle, info, analysis_channels } = abi.open(EDF);
  const raw = abi.readRaw(handle, 1, 3);
  assert.equal(raw.length, 3 * analysis_channels.length);
  // The EDF writer stores the digital maximum at sample 1 of every signal.
  assert.deepEqual([...raw.subarray(0, analysis_channels.length)], [32767, 32767]);
  assert.throws(() => abi.readRaw(handle, info.sample_count - 1, 2), /rows/);
  abi.close(handle);
});

test('progress_every_percent', () => {
  const { handle, info } = abi.open(EDF);
  const req = { ...request('ST', info.sample_count), channels: [0, 1], file_path: EDF[0] };
  req.window_parameters = { window_length: 200, window_step: 10 };
  progress.length = 0;
  abi.runBlock(handle, req, 0, abi.plan(handle, req, 64).windows);
  abi.close(handle);
  const total = progress[0].total_steps;
  const every = Math.max(Math.floor(total / 100), 1);
  assert.ok(total >= 1000, `${total} steps`);
  assert.equal(progress.length, Math.floor(total / every));
  assert.ok(progress.every((p) => p.step_index % every === 0));
});

test('run_blocks_match_native_bundle', (t) => {
  const rows = [];
  for (const variant of Object.keys(VARIANTS)) {
    const dir = path.join(tmp, `bundle-${variant}`);
    execFileSync(CLI, [
      'run', '--file', BRAINVISION[0], '--channels', '0', '1', '2', '3', '--variants', variant,
      '--wl', '200', '--ws', '100', ...VARIANTS[variant].args, '--bundle', dir, '--quiet',
    ]);
    const cliManifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const { handle, info } = abi.open(BRAINVISION);
    const req = request(variant, info.sample_count);
    // 0 MiB plans one window per block, 64 MiB one block for the whole request.
    for (const budgetMb of [0, 64]) {
      const { blocks, layout, windows } = abi.plan(handle, req, budgetMb);
      assert.equal(blocks.length, budgetMb === 0 ? windows : 1);
      const buffers = layout.arrays.map((a) => {
        const buffer = new Uint8Array(a.header.length + a.shape.reduce((x, y) => x * y, 1) * 8);
        buffer.set(a.header);
        return buffer;
      });
      for (const block of blocks) {
        for (const { array, offset, bytes } of abi.runBlock(handle, req, block.w0, block.w1)) {
          buffers[array].set(bytes, offset);
        }
      }
      layout.arrays.forEach((a, i) => {
        const cli = new Uint8Array(fs.readFileSync(path.join(dir, a.path)));
        assert.deepEqual(cli.subarray(0, a.header.length), buffers[i].subarray(0, a.header.length), a.path);
        const n = (cli.length - a.header.length) / 8;
        assert.equal(n * 8 + a.header.length, buffers[i].length, a.path);
        const [x, y] = [buffers[i], cli].map((b) => new Float64Array(b.buffer, a.header.length, n));
        const [xBits, yBits] = [buffers[i], cli].map((b) => new BigUint64Array(b.buffer, a.header.length, n));
        let identical = 0;
        let maxRel = 0;
        for (let k = 0; k < n; k++) {
          if (xBits[k] === yBits[k] || (Number.isNaN(x[k]) && Number.isNaN(y[k]))) {
            identical++;
            continue;
          }
          const rel = Math.abs(x[k] - y[k]) / Math.max(Math.abs(x[k]), Math.abs(y[k]));
          maxRel = Math.max(maxRel, rel === 0 || Number.isNaN(rel) ? (x[k] === y[k] ? 0 : Infinity) : rel);
        }
        t.diagnostic(`${variant} ${budgetMb} MiB ${a.path}: ${identical}/${n} bit-identical, max_rel ${maxRel}`);
        rows.push([variant, budgetMb, a.path, n, identical, maxRel].join(','));
        assert.ok(identical === n || maxRel <= 1e-12, `${a.path}: max_rel ${maxRel}`);
      });
      const input_sha256 = Object.fromEntries(
        info.input_files.map((name) => [name, abi.sha256File(path.join(FIXTURES, name))]),
      );
      const extras = { id: cliManifest.id, created_at_iso: cliManifest.created_at_iso, input_sha256, windows };
      assert.deepEqual(abi.manifest(handle, req, extras), cliManifest);
    }
    abi.close(handle);
  }
  fs.mkdirSync(path.dirname(PARITY_CSV), { recursive: true });
  fs.writeFileSync(PARITY_CSV, ['variant,budget_mb,array,values,identical,max_rel', ...rows, ''].join('\n'));
});
