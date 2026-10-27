// The npm package's entry (index.mjs): `run` assembles a whole request's arrays from its blocks, whatever the block
// budget, and returns the manifest `ddalab run --bundle` writes.
// Build first: (cd packages/ddalab-wasm && cargo build --release --target wasm32-unknown-unknown)
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from '../index.mjs';

const EDF = fileURLToPath(new URL('../../dda-rs/tests/fixtures/fixture.edf', import.meta.url));
const engine = await load();

/** The request `ddalab run --file fixture.edf --channels 0 1 --wl 200 --ws 100` makes for ST. */
const request = (rows) => ({
  file_path: EDF,
  channels: [0, 1],
  time_range: { start: 0, end: rows - 1 },
  preprocessing_options: { highpass: null, lowpass: null },
  algorithm_selection: { enabled_variants: ['ST'], select_mask: '1 0 0 0 0 0' },
  window_parameters: { window_length: 200, window_step: 100 },
  delay_parameters: { delays: [7, 10] },
  model_parameters: { dm: 4, order: 4, nr_tau: 2 },
});

test('run_returns_the_manifest_and_whole_arrays', () => {
  const { handle, info } = engine.open([EDF]);
  const req = request(info.sample_count);
  const whole = engine.run(handle, req, { budgetMb: 64 });
  const perWindow = engine.run(handle, req, { budgetMb: 0, createdAt: whole.manifest.created_at_iso });
  engine.close(handle);

  assert.equal(whole.manifest.variants[0].id, 'ST');
  const windows = whole.manifest.window_centers_seconds.length;
  assert.ok(windows > 0);
  const q = Object.entries(whole.arrays).find(([name]) => name.endsWith('q.npy'));
  assert.ok(q, Object.keys(whole.arrays).join(', '));
  // As the bundle's .npy holds it: (windows, rows).
  assert.deepEqual(q[1].shape, [windows, 2]);
  assert.ok(q[1].data instanceof Float64Array && q[1].data.length === 2 * windows);
  assert.ok(q[1].data.some(Number.isFinite));
  // One block or one block per window: the same values.
  for (const [name, { data }] of Object.entries(whole.arrays)) {
    assert.deepEqual(perWindow.arrays[name].data, data, name);
  }
  assert.deepEqual(perWindow.manifest, whole.manifest);
});

test('version_names_the_engine', () => {
  assert.match(engine.version().engine_version, /^\d+\.\d+\.\d+/);
});
