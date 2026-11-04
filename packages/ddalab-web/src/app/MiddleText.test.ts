import { expect, test } from "vitest";
import { splitEnd } from "./MiddleText";

test("the_end_that_stays_is_the_longest_short_end_after_a_space", () => {
  expect(splitEnd("Left Anterior Hippocampus 10")).toEqual(["Left Anterior Hippocampus ", "10"]);
  expect(splitEnd("EEG Fp1-REF & EEG F7-REF")).toEqual(["EEG Fp1-REF & EEG ", "F7-REF"]);
  // A pair keeps its first channel's number and the whole short second one.
  expect(splitEnd("Left Anterior Hippocampus 10 & DC")).toEqual(["Left Anterior Hippocampus ", "10 & DC"]);
  expect(splitEnd("ST on a.vhdr")).toEqual(["ST on ", "a.vhdr"]);
});

test("without_a_short_end_the_cut_is_at_the_last_space", () => {
  expect(splitEnd("ST CT on sub-01_ses-pre_run-02_ieeg.vhdr")).toEqual([
    "ST CT on ",
    "sub-01_ses-pre_run-02_ieeg.vhdr",
  ]);
});

test("a_name_without_a_space_is_all_end", () => {
  expect(splitEnd("sub-01_run-02_ieeg.vmrk")).toEqual(["", "sub-01_run-02_ieeg.vmrk"]);
  expect(splitEnd("Cz")).toEqual(["", "Cz"]);
  expect(splitEnd(" Cz")).toEqual(["", " Cz"]);
});
