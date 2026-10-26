// Does the wasm ABI give what the native CLI gives on the committed fixtures (packages/dda-rs/tests/fixtures)?
//
// run_blocks_match_native_bundle writes results/parity.csv, one row per (variant, budget_mb, array) for the
// block-capable v1 variants ST, CT, CD, DE, SY and CCD on the BrainVision fixture: every block
// of the plan for `budget_mb` runs through the ABI, its chunks land at their offsets in a buffer, and the buffer's
// f64 values a_i are compared with the values b_i of the CLI's `.npy` for the same request (`ddalab run --bundle`).
//   values    = n, the f64 count of the array
//   identical = #{i : bits(a_i) == bits(b_i), or both NaN (wasm leaves NaN payloads unspecified)}
//   max_rel   = max over i with bits(a_i) != bits(b_i) of |a_i - b_i| / max(|a_i|, |b_i|); 0 when all are identical
// The test asserts identical == values for every array; max_rel is printed and recorded for the parity section.
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
import { decodeReply, load, unframe } from './host.mjs';

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
    pairs: { ct_channel_pairs: [[0, 1], [0, 2], [1, 3]] },
  },
  CD: {
    mask: '0 0 1 0 0 0',
    args: ['--cd-pairs', '0,1', '2,1', '3,0'],
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

test('open_takes_a_cache_size', () => {
  const [small, standard] = [4, undefined].map((cacheMb) => abi.open(BRAINVISION, undefined, cacheMb).handle);
  assert.deepEqual(abi.readRaw(small, 0, 3000), abi.readRaw(standard, 0, 3000));
  [small, standard].forEach((handle) => abi.close(handle));
  assert.throws(() => abi.open(BRAINVISION, undefined, -1), /expected u32/);
});

test('handles_are_never_reused', () => {
  const first = abi.open(EDF).handle;
  const pyramid = abi.pyramid(first);
  abi.close(first);
  assert.throws(() => pyramid.push(0, 10), /no pyramid/);
  const second = abi.open(EDF).handle;
  assert.notEqual(second, first);
  assert.throws(() => abi.rawTile(first, 0, 0), /no open recording/);
  const dropped = abi.pyramid(second);
  dropped.drop();
  assert.throws(() => dropped.push(0, 10), /no pyramid/);
  abi.close(second);

  const hash = abi.hash();
  hash.update(new TextEncoder().encode('abc'));
  assert.equal(hash.hex(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.throws(() => hash.update(new Uint8Array(1)), /no hash/);
  assert.throws(() => hash.hex(), /no hash/);
});

test('replies_decode_unsigned', () => {
  // A reply at 2.25 GiB arrives from wasm as a negative i64.
  const reply = BigInt.asIntN(64, (0x9000_0000n << 32n) | 0xffff_fff0n);
  assert.ok(reply < 0n);
  assert.deepEqual(decodeReply(reply), [0x9000_0000, 0xffff_fff0]);
});

test('host_errors_become_error_replies', async () => {
  let failReads = true;
  const flaky = await load(
    undefined,
    () => {
      throw new Error('progress listener failed');
    },
    (...args) => {
      if (failReads) throw new Error('NotReadableError');
      return fs.readSync(...args);
    },
  );
  assert.throws(() => flaky.open(BRAINVISION), /host read failed for fixture\.vhdr at offset 0/);
  failReads = false;
  const { handle, info } = flaky.open(BRAINVISION);
  const req = request('ST', info.sample_count);
  assert.ok(flaky.runBlock(handle, req, 0, 1).length > 0);
  assert.equal(flaky.readRaw(handle, 0, 2).length, 8);
  flaky.close(handle);
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

// wasm32 has a 32-bit usize: offsets and buffer sizes past 4 GiB must not wrap.
test('run_block_offsets_pass_4_gib', () => {
  const { handle, info } = abi.open(BRAINVISION);
  // 65,536 copies of one pair give each window 65,536 x 3 coefficients; the last of 2,974 windows starts past 4 GiB.
  const req = { ...request('CT', info.sample_count), ct_channel_pairs: Array(65536).fill([0, 1]) };
  req.window_parameters = { window_length: 10, window_step: 1 };
  const { layout, windows } = abi.plan(handle, req, 64);
  const chunks = abi.runBlock(handle, req, windows - 1, windows);
  abi.close(handle);
  for (const { array, offset } of chunks) {
    const { path: name, header, shape } = layout.arrays[array];
    assert.equal(offset, header.length + (windows - 1) * shape[1] * (shape[2] ?? 1) * 8, name);
  }
  assert.ok(chunks.some(({ offset }) => offset > 2 ** 32));
});

test('reads_past_isize_max_bytes_are_refused', () => {
  // fixture.bdf (two channels, 512 samples per record) declaring 2^22 records: 2^31 rows in a sparse 12 GiB file.
  const file = path.join(tmp, 'huge.bdf');
  const header = Buffer.from(fs.readFileSync(RECORDINGS[1][0]).subarray(0, 3 * 256));
  header.write('4194304 ', 236, 'latin1');
  fs.writeFileSync(file, header);
  fs.truncateSync(file, header.length + 2 ** 22 * 512 * 2 * 3);
  const { handle, info } = abi.open([file]);
  assert.equal(info.sample_count, 2 ** 31);
  // 2^29 to 2^32 values pass isize::MAX bytes as f32 on wasm32, and 2^32 passes usize: error replies, no trap.
  for (const rows of [2 ** 28, 2 ** 30 - 1, 2 ** 31]) {
    assert.throws(() => abi.readRaw(handle, 0, rows), /isize::MAX bytes/, `${rows} rows`);
    assert.throws(() => abi.pyramid(handle).push(0, rows), /isize::MAX bytes/, `${rows} rows`);
  }
  assert.equal(abi.readRaw(handle, 0, 2).length, 4);
  abi.close(handle);
});

/** A sparse file `name` of `length` bytes and a module instance that reads every file as `pattern` repeated. */
async function generatedText(name, length, pattern) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, '');
  fs.truncateSync(file, length);
  const bytes = new TextEncoder().encode(pattern);
  const read = (fd, buffer, offset, n, position) => {
    for (let done = 0; done < n; ) {
      const at = (position + done) % bytes.length;
      const k = Math.min(bytes.length - at, n - done);
      buffer.set(bytes.subarray(at, at + k), offset + done);
      done += k;
    }
    return n;
  };
  return { file, text: await load(undefined, undefined, read) };
}

test('text_past_4_gib_opens', async () => {
  // Each MiB holds a data line and a comment line; 4 GiB + 1.5 MiB end inside the comment of data line 4,098.
  const pattern = `1.5,2.5\n#${'x'.repeat(2 ** 20 - 10)}\n`;
  const { file, text } = await generatedText('huge.txt', 2 ** 32 + 3 * 2 ** 19, pattern);
  const { handle, info } = text.open([file]);
  assert.equal(info.sample_count, 4098);
  assert.deepEqual([...text.readRaw(handle, 4097, 1)], [1.5, 2.5]);
  text.close(handle);
});

test('text_samples_past_isize_max_refused', async () => {
  // 262,144 lines of 1,025 cells: 2,149,580,800 bytes of f64, past wasm32's isize::MAX.
  const line = `${','.repeat(1024)}1\n`;
  const { file, text } = await generatedText('wide.csv', 262_144 * line.length, line);
  assert.throws(() => text.open([file]), /isize::MAX bytes/);
});

test('selection_past_2_32_rows_runs', () => {
  // fixture.bdf's 8 records (512 rows of 2 channels at 512 Hz) twice: 16 s alone, and at the end of a sparse
  // 30 GB file of 9,765,625 records, 5e9 rows. ST on its last 10 s runs the same windows in both.
  const fixture = fs.readFileSync(RECORDINGS[1][0]);
  const records = fixture.subarray(3 * 256);
  const header = (count) => {
    const bytes = Buffer.from(fixture.subarray(0, 3 * 256));
    bytes.write(`${count}`.padEnd(8), 236, 'latin1');
    return bytes;
  };
  const [small, huge] = ['small.bdf', 'huge-5e9.bdf'].map((name) => path.join(tmp, name));
  fs.writeFileSync(small, Buffer.concat([header(16), records, records]));
  const total = 9_765_625;
  fs.writeFileSync(huge, header(total));
  fs.truncateSync(huge, 3 * 256 + total * records.length / 8);
  const fd = fs.openSync(huge, 'r+');
  fs.writeSync(fd, Buffer.concat([records, records]), 0, 2 * records.length, 3 * 256 + (total - 16) * records.length / 8);
  fs.closeSync(fd);
  const runs = [small, huge].map((file) => {
    const { handle, info } = abi.open([file]);
    const req = { ...request('ST', info.sample_count), channels: [0, 1], file_path: file };
    req.time_range = { start: info.sample_count - 5120, end: info.sample_count - 1 };
    const { blocks, windows } = abi.plan(handle, req, 0);
    const chunks = blocks.flatMap((b) => abi.runBlock(handle, req, b.w0, b.w1));
    const extras = { id: '', created_at_iso: '', input_sha256: {}, windows };
    const centers = abi.manifest(handle, req, extras).window_centers_seconds;
    abi.close(handle);
    return { rows: info.sample_count, blocks, chunks: chunks.map((c) => [c.array, c.offset, Buffer.from(c.bytes)]), centers };
  });
  assert.equal(runs[1].rows, 5e9);
  assert.ok(runs[1].blocks[0].row0 > 2 ** 32, `${runs[1].blocks[0].row0}`);
  assert.equal(runs[1].blocks.length, runs[0].blocks.length);
  assert.deepEqual(runs[1].chunks, runs[0].chunks);
  const shift = (5e9 - 16 * 512) / 512;
  runs[1].centers.forEach((c, i) => assert.ok(Math.abs(c - runs[0].centers[i] - shift) < 1e-6, `center ${i}: ${c}`));
});

test('diagnostics_match_cli', () => {
  const file = path.join(FIXTURES, 'fixture_truncated.edf');
  const out = path.join(tmp, 'truncated.json');
  execFileSync(CLI, ['run', '--file', file, '--wl', '200', '--ws', '100', '--output', out, '--quiet']);
  const cli = JSON.parse(fs.readFileSync(out, 'utf8'));
  const { handle, info } = abi.open([file]);
  const req = { ...request('ST', info.sample_count), channels: [0, 1], file_path: file };
  const { windows } = abi.plan(handle, req, 64);
  const manifest = abi.manifest(handle, req, { id: '', created_at_iso: '', input_sha256: {}, windows });
  abi.close(handle);
  assert.match(cli.diagnostics.join('\n'), /declares 8 data records/);
  assert.deepEqual(manifest.diagnostics, cli.diagnostics);
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
        assert.equal(identical, n, `${a.path}: ${identical}/${n} bit-identical, max_rel ${maxRel}`);
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
