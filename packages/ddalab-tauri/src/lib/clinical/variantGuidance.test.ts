import { describe, expect, it } from "vitest";
import {
  getVariantGuidance,
  listVariantGuidance,
  recommendVariantByGoal,
} from "./variantGuidance";

describe("variantGuidance", () => {
  it("returns guidance for each supported variant", () => {
    const ids = [
      "single_timeseries",
      "cross_timeseries",
      "cross_dynamical",
      "dynamical_ergodicity",
      "synchronization",
    ];

    ids.forEach((id) => {
      const guidance = getVariantGuidance(id);
      expect(guidance).not.toBeNull();
      expect(guidance?.variantId).toBe(id);
      expect(guidance?.useWhen.length).toBeGreaterThan(10);
      expect(guidance?.shortQuestion.length).toBeGreaterThan(10);
    });
  });

  it("returns null for unknown variant ids", () => {
    expect(getVariantGuidance("unknown_variant")).toBeNull();
  });

  it("exposes exactly five clinical guidance entries", () => {
    expect(listVariantGuidance()).toHaveLength(5);
  });

  it("recommends the expected variant for each clinical goal", () => {
    expect(recommendVariantByGoal("local_transitions")).toBe(
      "single_timeseries",
    );
    expect(recommendVariantByGoal("channel_coupling")).toBe("cross_timeseries");
    expect(recommendVariantByGoal("directional_influence")).toBe(
      "cross_dynamical",
    );
    expect(recommendVariantByGoal("global_state_change")).toBe(
      "dynamical_ergodicity",
    );
    expect(recommendVariantByGoal("synchrony_patterns")).toBe(
      "synchronization",
    );
  });
});
