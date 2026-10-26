import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { instantiateCore } from "./abi";
import { readSynthetic, type SyntheticSpec, syntheticEdfSize } from "./synthetic";

const wasm = new WebAssembly.Module(readFileSync(new URL("./ddalab.wasm", import.meta.url)));
const NAME = "synthetic.edf";

async function open(spec: SyntheticSpec) {
  const core = await instantiateCore(wasm, (_, offset, dst) => readSynthetic(spec, offset, dst));
  const opened = core.open({
    primary: NAME,
    files: [{ name: NAME, file_id: 1, len: syntheticEdfSize(spec) }],
  });
  return { core, ...opened };
}
const bytes = (spec: SyntheticSpec, offset: number, length: number) => {
  const out = new Uint8Array(length);
  readSynthetic(spec, offset, out);
  return out;
};

test("header_parses_in_core", async () => {
  const spec = { channels: 256, rateHz: 2000, durationS: 24 * 3600, seed: 1 };
  const { info } = await open(spec);
  expect(info.sample_count).toBe(172_800_000);
  expect(info.channels).toHaveLength(256);
  expect(info.sample_rate_hz).toBe(2000);
  expect(info.duration_s).toBe(86_400);
  expect(info.raw_type).toBe("I16");
  expect(info.warnings).toEqual([]);
});

// Rows 12 to 14 of a 10 Hz recording lie in record 1; within a record channel c follows channel c - 1.
test("rows_follow_the_record_layout", async () => {
  const spec = { channels: 3, rateHz: 10, durationS: 5, seed: 3 };
  const { core, handle } = await open(spec);
  const header = 256 * 4;
  const rows = core.readRaw(handle, 12, 3);
  const expected = [12, 13, 14].flatMap((n) =>
    [0, 1, 2].map((c) => {
      const at = header + Math.floor(n / 10) * 3 * 10 * 2 + (c * 10 + (n % 10)) * 2;
      return new DataView(bytes(spec, at, 2).buffer).getInt16(0, true);
    }),
  );
  expect(Array.from(rows)).toEqual(expected);
});

test("bytes_deterministic", () => {
  const spec = { channels: 3, rateHz: 10, durationS: 5, seed: 3 };
  const size = syntheticEdfSize(spec);
  expect(size).toBe(256 * 4 + 5 * 3 * 10 * 2);
  const whole = bytes(spec, 0, size);
  expect(bytes(spec, 0, size)).toEqual(whole);
  // Any range, including one that starts mid-sample and one that crosses a record boundary, is the same bytes of the whole.
  const record = 3 * 10 * 2;
  for (const [offset, length] of [
    [0, 300],
    [1000, 1],
    [1024 + record - 7, 20],
    [1024 + record - 8, 33],
    [size - 5, 5],
  ]) {
    expect(bytes(spec, offset, length)).toEqual(whole.subarray(offset, offset + length));
  }
  const split = [...bytes(spec, 1024 + record - 7, 7), ...bytes(spec, 1024 + record, 13)];
  expect(Array.from(bytes(spec, 1024 + record - 7, 20))).toEqual(split);
  expect(() => bytes(spec, size - 5, 6)).toThrow();
  expect(bytes({ ...spec, seed: 4 }, 1024, 200)).not.toEqual(whole.subarray(1024, 1224));
});

// Every window of 33 bytes, whatever its alignment to samples, records and the annotation channel.
test.each([false, true])("every_window_is_a_slice_of_the_whole (annotations %s)", (annotations) => {
  const spec = { channels: 3, rateHz: 10, durationS: 5, seed: 3, annotations };
  const size = syntheticEdfSize(spec);
  const whole = bytes(spec, 0, size);
  for (let offset = 0; offset + 33 <= size; offset += 5) {
    expect(bytes(spec, offset, 33)).toEqual(whole.subarray(offset, offset + 33));
  }
});

test("annotation_channel_parses_in_core", async () => {
  const spec = { channels: 3, rateHz: 10, durationS: 200, seed: 1, annotations: true };
  const { core, handle, info, analysis_channels } = await open(spec);
  expect(info.format).toBe("EDF+");
  expect(info.channels.map((channel) => channel.kind)).toEqual(["Signal", "Signal", "Signal", "Annotation"]);
  expect(analysis_channels).toEqual([0, 1, 2]);
  expect(info.sample_count).toBe(2000);
  expect(info.warnings).toEqual([]);
  expect(core.annotations(handle).annotations).toMatchObject([
    { onset_s: 97, label: "spike" },
    { onset_s: 194, label: "spike" },
  ]);
  // The signals are those of the same recording without the annotation channel.
  const plain = await open({ ...spec, annotations: false });
  expect(Array.from(core.readRaw(handle, 95 * 10, 30))).toEqual(
    Array.from(plain.core.readRaw(plain.handle, 95 * 10, 30)),
  );
});

test("spike_every_97_s", () => {
  const spec = { channels: 1, rateHz: 10, durationS: 200, seed: 5 };
  const sample = (n: number) => new DataView(bytes(spec, 256 * 2 + n * 2, 2).buffer).getInt16(0, true);
  expect(Math.abs(sample(970))).toBeGreaterThan(20_000);
  expect(Math.abs(sample(1940))).toBeGreaterThan(20_000);
  for (const n of [0, 969, 971, 1000]) expect(Math.abs(sample(n))).toBeLessThan(12_000);
});
