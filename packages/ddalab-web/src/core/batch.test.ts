// The batch's manifest against the one `ddalab batch` prints, and the per-recording rules: channels, interval, the
// bundle folders of the combined export and how a batch reads in the history.
//
// golden/batch-manifest.json is the native CLI's output for a folder `fixtures` of three EDFs, made with
//   ddalab batch --bids-dir fixtures --continue-on-error --output-dir out --quiet > batch-manifest.json
// where fixtures/sub-01/eeg/sub-01_task-rest_eeg.edf is dda-rs tests/fixtures/fixture.edf, sub-02 (same layout) is
// fixture_truncated.edf and sub-03 holds the 17 bytes "not an edf header".
import { expect, test } from "vitest";
import { DEFAULT_FORM } from "../features/analysis/validate";
import {
  type BatchRecord,
  batchManifest,
  batchOutcome,
  bundleDirs,
  channelsFor,
  intervalFor,
  settingsLine,
} from "./batch";
import golden from "./golden/batch-manifest.json";
import type { AnalysisRecord } from "./history";
import type { ChannelInfo, RecordingInfo } from "./types";

const TRUNCATED =
  "The header declares 8 data records, but the file holds 7 complete records and 424 extra bytes.";
const BROKEN =
  "Unsupported file type: sub-03_task-rest_eeg.edf holds 17 bytes, fewer than the 256-byte EDF header";
const path = (n: number) => `fixtures/sub-0${n}/eeg/sub-0${n}_task-rest_eeg.edf`;

const batch: BatchRecord = {
  id: "b",
  createdAt: 0,
  root: "fixtures",
  form: DEFAULT_FORM,
  channels: { kind: "signal" },
  interval: { kind: "whole" },
  paths: [1, 2, 3].map(path),
  results: [
    { path: path(1), status: "ok", resultId: "r1", warnings: [] },
    { path: path(2), status: "ok", resultId: "r2", warnings: [TRUNCATED] },
    { path: path(3), status: "error", warnings: [], error: BROKEN },
  ],
  status: "complete",
};

const record = (id: string, windows: number) =>
  ({
    id,
    status: "complete",
    plan: { windows },
    manifest: { variants: [{ id: "ST", row_labels: ["Fp1", "Fp2"] }] },
  }) as AnalysisRecord;

/** `value` with every leaf replaced by its type, keys in their order: the structure JSON.stringify writes. */
const shape = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(shape)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
      : value === null
        ? "null"
        : typeof value;

test("manifest_has_the_cli_keys_order_and_values", () => {
  const ours = batchManifest(batch, [record("r1", 75), record("r2", 16)]);
  // Same keys in the same order, each value of the same type, the output paths and the error text aside.
  expect(JSON.stringify(shape(ours))).toBe(JSON.stringify(shape(golden)));
  const comparable = (m: typeof golden | typeof ours) => ({
    ...m,
    results: m.results.map(({ outputPath, error, ...rest }) => ({ ...rest, hasOutput: outputPath !== null })),
  });
  expect(comparable(ours)).toEqual(comparable(golden));
  expect(golden.results[2].error).toBe(`${path(3)}: ${BROKEN}`);
  expect(ours.results.map((r) => r.outputPath)).toEqual([
    "sub-01/eeg/sub-01_task-rest_eeg.dda",
    "sub-02/eeg/sub-02_task-rest_eeg.dda",
    null,
  ]);
});

test("manifest_counts_a_batch_cut_short_and_a_deleted_result", () => {
  const cut = { ...batch, results: batch.results.slice(0, 2), status: "interrupted" as const };
  const ours = batchManifest(cut, [record("r1", 75)]);
  expect(ours).toMatchObject({
    matchedFiles: 3,
    processedFiles: 2,
    succeeded: 1,
    failed: 1,
    withWarnings: 1,
  });
  expect(ours.results[1]).toMatchObject({
    status: "error",
    error: "The result was deleted from the history",
  });
});

const channel = (label: string, bids_status: string | null = null) => ({ label, bids_status }) as ChannelInfo;
const info = (channels: ChannelInfo[], extra: Partial<RecordingInfo> = {}) =>
  ({
    channels,
    input_files: ["a.edf"],
    sample_rate_hz: 100,
    sample_count: 1000,
    duration_s: 10,
    ...extra,
  }) as RecordingInfo;

test("signal_channels_leave_out_the_bad_ones_as_the_cli_does", () => {
  // Analysis channels 0, 1 and 3 of the file; the second is bad, in any case.
  const recording = info([channel("Fp1"), channel("Fp2", "BAD"), channel("Status"), channel("Cz", "good")]);
  expect(channelsFor({ kind: "signal" }, recording, [0, 1, 3])).toEqual({ channels: [0, 2], warnings: [] });
  const allBad = info([channel("Fp1", "bad")]);
  expect(channelsFor({ kind: "signal" }, allBad, [0]).error).toBe("a.edf has no analysis channel to run on");
});

test("named_channels_run_on_the_ones_a_recording_has", () => {
  const recording = info([channel("Cz"), channel("Fp1"), channel("Fp2")]);
  expect(channelsFor({ kind: "labels", labels: ["Fp2", "Fp1", "O1"] }, recording, [0, 1, 2])).toEqual({
    channels: [1, 2],
    warnings: ["Without channels O1"],
  });
  expect(channelsFor({ kind: "labels", labels: ["O1", "O2"] }, recording, [0, 1, 2]).error).toBe(
    "a.edf has none of the channels O1, O2",
  );
});

test("an_interval_is_clipped_to_the_recording_or_refused_outside_it", () => {
  const recording = info([]);
  expect(intervalFor({ kind: "whole" }, recording)).toEqual({ startS: 0, endS: 10, warnings: [] });
  expect(intervalFor({ kind: "range", startS: 2, endS: 5 }, recording)).toEqual({
    startS: 2,
    endS: 5,
    warnings: [],
  });
  expect(intervalFor({ kind: "range", startS: 2, endS: 30 }, recording)).toEqual({
    startS: 2,
    endS: 10,
    warnings: ["The interval ends at the recording's end, 10 s, before 30 s"],
  });
  expect(intervalFor({ kind: "range", startS: 12, endS: 30 }, recording).error).toBe(
    "start sample 1200 is not inside the 1000 samples of a.edf",
  );
});

test("bundle_folders_mirror_the_paths_and_keep_a_shared_stem_apart", () => {
  const dirs = bundleDirs(["data/a/x.edf", "data/a/x.vhdr", "data/y.bdf"], "data");
  expect([...dirs.values()]).toEqual(["a/x.dda", "a/x.vhdr.dda", "y.dda"]);
  expect(bundleDirs(["one/x.edf", "two/x.edf"], "").get("two/x.edf")).toBe("two/x.dda");
});

test("a_batch_reads_as_it_stands", () => {
  expect(batchOutcome(batch)).toBe("2 of 3, 1 failed");
  expect(batchOutcome({ ...batch, results: batch.results.slice(0, 2) })).toBe("2 of 3");
  expect(batchOutcome({ ...batch, results: batch.results.slice(0, 1), status: "interrupted" })).toBe(
    "Interrupted after 1 of 3",
  );
  expect(settingsLine(batch)).toBe(
    "ST, window 200, step 100, standard model, signal channels, whole recordings",
  );
});
