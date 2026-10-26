import { expect, test } from "vitest";
import { signalChannels } from "./overviewLayer";

test("the_overview_leaves_out_dc_and_auxiliary_channels", () => {
  const channel = (label: string, bids_type: string | null) => ({ label, bids_type });
  expect(
    signalChannels([
      channel("G1", "ECOG"),
      channel("DC10", "MISC"),
      channel("EKG", "ECG"),
      channel("Fp1", null),
      channel("DC1", null),
      channel("Trigger", "TRIG"),
    ]),
  ).toEqual([true, false, false, true, false, false]);
  // A recording of auxiliary channels alone keeps them all.
  expect(signalChannels([channel("DC1", "MISC"), channel("DC2", "MISC")])).toEqual([true, true]);
});
