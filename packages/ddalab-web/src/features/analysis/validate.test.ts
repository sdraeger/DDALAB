import { expect, test } from "vitest";
import type { RecordingInfo, VariantInfo } from "../../core/types";
import { type DdaDraft, DEFAULT_FORM, validateRequest } from "./validate";

const variant = (abbreviation: string, position: number, channel_format: VariantInfo["channel_format"]) =>
  ({ abbreviation, position, channel_format }) as VariantInfo;
const ST = variant("ST", 0, "individual");
const CT = variant("CT", 1, "pairs");
const CD = variant("CD", 2, "directed_pairs");

const info = {
  sample_rate_hz: 500,
  sample_count: 3000,
  input_files: ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"],
} as RecordingInfo;

const draft = (change: Partial<DdaDraft> = {}): DdaDraft => ({
  ...DEFAULT_FORM,
  variants: [ST],
  channels: [0, 1],
  startS: 0,
  endS: 6,
  ...change,
});

test("negative_delay_rejected", () => {
  const { request, errors } = validateRequest(draft({ expert: true, delays: "7, -1" }), info);
  expect(request).toBeUndefined();
  expect(errors.delays).toMatch(/non-negative whole numbers/);
});

test("too_few_delays_rejected", () => {
  const { request, errors } = validateRequest(draft({ expert: true, delays: "7 10", nrTau: "3" }), info);
  expect(request).toBeUndefined();
  expect(errors.delays).toMatch(/at least 3/);
});

test("standard_mode_sends_canonical_defaults", () => {
  const expertValues = { delays: "1, 2, -3", modelTerms: "1 2", dm: "9", order: "x", nrTau: "5" };
  const kept = draft({ expert: false, ...expertValues });
  const { request, errors } = validateRequest(kept, info);
  expect(errors).toEqual({});
  expect(request?.delay_parameters.delays).toEqual([7, 10]);
  expect(request?.model_terms).toEqual([1, 2, 10]);
  expect(request?.model_parameters).toEqual({ dm: 4, order: 4, nr_tau: 2 });
  // The expert values stay in the draft for when expert mode is turned on again.
  expect(kept).toMatchObject(expertValues);
});

test("selection_maps_to_samples", () => {
  // 0.58 * 500 is 289.99999999999994 in f64: the 1e-6 makes it sample 290, as the CLI's `--start` does.
  const { request } = validateRequest(draft({ startS: 0.58, endS: 2 }), info);
  expect(request?.time_range).toEqual({ start: 290, end: 1000 });
  // The end is inclusive and stops at the last sample.
  expect(validateRequest(draft({ startS: 1, endS: 6 }), info).request?.time_range).toEqual({
    start: 500,
    end: 2999,
  });
  expect(validateRequest(draft({ startS: 2, endS: 2 }), info).errors.range).toBeDefined();
});

test("pairs_follow_the_variant_metadata", () => {
  const { request } = validateRequest(draft({ variants: [ST, CT, CD], channels: [0, 2, 3] }), info);
  expect(request?.algorithm_selection).toEqual({
    enabled_variants: ["ST", "CT", "CD"],
    select_mask: "1 1 1 0 0 0",
  });
  expect(request?.ct_channel_pairs).toEqual([
    [0, 2],
    [0, 3],
    [2, 3],
  ]);
  expect(request?.cd_channel_pairs).toEqual([
    [0, 2],
    [0, 3],
    [2, 0],
    [2, 3],
    [3, 0],
    [3, 2],
  ]);
  expect(validateRequest(draft({ variants: [CT], channels: [1] }), info).errors.channels).toBeDefined();
});
