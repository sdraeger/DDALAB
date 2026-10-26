// The batch's manifest, recording set and document names against what `ddalab batch` writes, and the per-recording
// rules: channels, interval and how a batch reads in the history.
//
// golden/batch-manifest.json is the native CLI's stdout for the BIDS folder e2e/batch.spec.ts builds (`fixtures/` with
// dataset_description.json, notes.edf, derivatives/sub-01, sub-01 runs 2 and 10 of fixture.edf, sub-02
// fixture_truncated.edf, sub-03 17 bytes that are no EDF, sub-04 a header without its data file), made from the
// folder's parent with
//   ddalab batch --bids-dir fixtures --continue-on-error --output-dir dda --model 1 2 10 --quiet > batch-manifest.json
import { expect, test } from "vitest";
import { DEFAULT_FORM } from "../features/analysis/validate";
import {
  asBundle,
  type BatchRecord,
  batchManifest,
  batchOutcome,
  channelsFor,
  discovered,
  intervalFor,
  outputName,
  outputNames,
  settingsLine,
} from "./batch";
import golden from "./golden/batch-manifest.json";
import type { AnalysisRecord } from "./history";
import type { ChannelInfo, RecordingInfo } from "./types";

const paths = golden.results.map((r) => r.inputPath);
const batch: BatchRecord = {
  id: "b",
  createdAt: 0,
  root: "fixtures",
  form: DEFAULT_FORM,
  channels: { kind: "signal" },
  interval: { kind: "whole" },
  paths,
  results: golden.results.map(({ inputPath, status, warnings, error }, i) =>
    status === "ok"
      ? { path: inputPath, status: "ok", resultId: `r${i}`, warnings }
      : { path: inputPath, status: "error", warnings, error },
  ),
  status: "complete",
};
const records = golden.results.flatMap((r, i) =>
  r.result
    ? [
        {
          id: `r${i}`,
          status: "complete",
          plan: { windows: r.result.windows },
          manifest: { variants: [{ id: "ST", row_labels: ["Fp1", "Fp2"] }] },
        } as AnalysisRecord,
      ]
    : [],
);

/** `value` with every leaf replaced by its type, keys in their order: the structure JSON.stringify writes. */
const shape = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(shape)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
      : value === null
        ? "null"
        : typeof value;

/** The output paths with their digest masked: the CLI hashes absolute paths, the page relative ones. */
const masked = (m: { results: { outputPath: string | null }[] }) => ({
  ...m,
  results: m.results.map((r) => ({ ...r, outputPath: r.outputPath?.replace(/\.[0-9a-f]{8}\./, ".<sha8>.") })),
});

test("manifest_equals_the_cli_but_for_the_digests", async () => {
  const ours = batchManifest(batch, records, await outputNames(paths));
  expect(JSON.stringify(shape(ours))).toBe(JSON.stringify(shape(golden)));
  expect(masked(ours)).toEqual(masked(golden));
  // The digest is the SHA-1 of the path the manifest names.
  for (const r of ours.results.filter((r) => r.outputPath))
    expect(r.outputPath).toBe(`dda/${await outputName(r.inputPath)}`);
});

test("a_bundle_in_place_of_a_document_warns_on_a_copy_and_is_counted", async () => {
  const ours = batchManifest(batch, records, await outputNames(paths));
  expect(ours.withWarnings).toBe(1);
  const [first] = ours.results;
  asBundle(ours, first, "The JSON document would be about 900 MB.");
  expect(first.outputPath).toMatch(/^dda\/sub-01_task-rest_run-10_eeg\.[0-9a-f]{8}\.dda$/);
  expect(first.warnings).toEqual([
    "The result document is too large for the browser; this is its bundle. The JSON document would be about 900 MB.",
  ]);
  expect(ours.withWarnings).toBe(2);
  // The batch's own lists, which the store holds, stay as they were.
  expect(batch.results.map((r) => r.warnings.length)).toEqual([0, 0, 1, 0, 0]);
  const again = batchManifest(batch, records, await outputNames(paths));
  expect(again.results[2].warnings).not.toBe(batch.results[2].warnings);
});

test("manifest_counts_a_batch_cut_short_and_a_deleted_result", async () => {
  const cut = { ...batch, results: batch.results.slice(0, 2), status: "interrupted" as const };
  const ours = batchManifest(cut, records.slice(0, 1), await outputNames(paths));
  expect(ours).toMatchObject({
    matchedFiles: 5,
    processedFiles: 2,
    succeeded: 1,
    failed: 1,
    withWarnings: 0,
  });
  expect(ours.results[1]).toMatchObject({
    status: "error",
    error: "The result was deleted from the history",
  });
});

test("manifest_rows_are_in_the_clis_key_order", async () => {
  const many = [
    { ...records[0], manifest: { variants: ["ST", "CT", "CD"].map((id) => ({ id, row_labels: [] })) } },
  ];
  const ours = batchManifest(batch, many as unknown as AnalysisRecord[], await outputNames(paths));
  expect(Object.keys(ours.results[0].result?.rows ?? {})).toEqual(["CD", "CT", "ST"]);
});

test("a_bids_folder_runs_the_recordings_the_cli_discovers_in_its_order", () => {
  // What the folder tree lists: the stray EDF and the derivative too, in its numeric order.
  const listed = [
    "fixtures/derivatives/sub-01/eeg/sub-01_task-rest_eeg.edf",
    "fixtures/notes.edf",
    "fixtures/sub-01/eeg/sub-01_task-rest_run-2_eeg.edf",
    "fixtures/sub-01/eeg/sub-01_task-rest_run-10_eeg.edf",
    "fixtures/sub-02/eeg/sub-02_task-rest_eeg.edf",
    "fixtures/sub-03/eeg/sub-03_task-rest_eeg.edf",
    "fixtures/sub-04/eeg/sub-04_task-rest_eeg.vhdr",
    "fixtures/.hidden/sub-05_eeg.edf",
    "fixtures/sourcedata/sub-05_eeg.bdf",
    "fixtures/a/b/c/d/e/f/sub-06_ieeg.EDF",
    "fixtures/a/b/c/d/e/f/g/sub-07_ieeg.edf",
  ].map((path) => ({ path }));
  expect(discovered(listed, "fixtures").map((r) => r.path)).toEqual([
    "fixtures/a/b/c/d/e/f/sub-06_ieeg.EDF",
    ...paths,
  ]);
});

test("output_names_follow_the_cli", async () => {
  // dda-rs batch.rs test_output_name_sanitizes_the_stem_and_hashes_the_resolved_path, on the path given.
  expect(await outputName("tmp/_sub 01.task+x_ieeg.vhdr")).toMatch(
    /^sub_01\.task_x_ieeg\.[0-9a-f]{8}\.dda\.json$/,
  );
  // SHA-1 of "/nonexistent/_.edf", as the CLI hashes a path it cannot resolve; and of "abc".
  expect(await outputName("/nonexistent/_.edf")).toBe("dataset.64c95c38.dda.json");
  expect(await outputName("abc")).toBe("abc.a9993e36.dda.json");
  expect(await outputName("x/Ölmühle α.edf")).toMatch(/^Ölmühle_α\./);
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
  expect(channelsFor({ kind: "signal" }, recording, [0, 1, 3], "d/a.edf")).toEqual({
    channels: [0, 2],
    warnings: [],
  });
  const allBad = info([channel("Fp1", "bad")]);
  expect(channelsFor({ kind: "signal" }, allBad, [0], "d/a.edf").error).toBe(
    "d/a.edf has no analysis channel to run on",
  );
});

test("named_channels_run_on_the_ones_a_recording_has", () => {
  const recording = info([channel("Cz"), channel("Fp1"), channel("Fp2")]);
  expect(
    channelsFor({ kind: "labels", labels: ["Fp2", "Fp1", "O1"] }, recording, [0, 1, 2], "a.edf"),
  ).toEqual({
    channels: [1, 2],
    warnings: ["Without channels O1"],
  });
  expect(channelsFor({ kind: "labels", labels: ["O1", "O2"] }, recording, [0, 1, 2], "a.edf").error).toBe(
    "a.edf has none of the channels O1, O2",
  );
});

test("an_interval_is_clipped_to_the_recording_or_refused_outside_it", () => {
  const recording = info([]);
  expect(intervalFor({ kind: "whole" }, recording, "a.edf")).toEqual({ startS: 0, endS: 10, warnings: [] });
  expect(intervalFor({ kind: "range", startS: 2, endS: 5 }, recording, "a.edf")).toEqual({
    startS: 2,
    endS: 5,
    warnings: [],
  });
  expect(intervalFor({ kind: "range", startS: 2, endS: 30 }, recording, "a.edf")).toEqual({
    startS: 2,
    endS: 10,
    warnings: ["The interval ends at the recording's end, 10 s, before 30 s"],
  });
  expect(intervalFor({ kind: "range", startS: 12, endS: 30 }, recording, "d/a.edf").error).toBe(
    "start sample 1200 is not inside the 1000 samples of d/a.edf",
  );
});

test("a_batch_reads_as_it_stands", () => {
  expect(batchOutcome(batch)).toBe("3 of 5, 2 failed");
  expect(batchOutcome({ ...batch, results: batch.results.slice(0, 2) })).toBe("2 of 5");
  expect(batchOutcome({ ...batch, results: batch.results.slice(0, 1), status: "interrupted" })).toBe(
    "Interrupted after 1 of 5",
  );
  expect(settingsLine(batch)).toBe(
    "ST, window 200, step 100, standard model, signal channels, whole recordings",
  );
});
