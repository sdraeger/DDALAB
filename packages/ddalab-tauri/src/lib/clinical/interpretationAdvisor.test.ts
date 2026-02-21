import { describe, expect, it } from "vitest";
import { assessInterpretation } from "./interpretationAdvisor";

describe("interpretationAdvisor", () => {
  it("returns proceed for high-quality dense data", () => {
    const assessment = assessInterpretation({
      variantId: "single_timeseries",
      ddaMatrix: {
        Fp1: Array.from({ length: 120 }, (_, i) => i * 0.1),
        Fp2: Array.from({ length: 120 }, (_, i) => i * 0.2),
      },
      selectedChannels: ["Fp1", "Fp2"],
      errorValues: Array.from({ length: 120 }, () => 0.01),
    });

    expect(assessment.decision).toBe("proceed");
    expect(assessment.score).toBeGreaterThanOrEqual(70);
    expect(assessment.stats.channelCount).toBe(2);
  });

  it("returns refine when windows are sparse", () => {
    const assessment = assessInterpretation({
      variantId: "single_timeseries",
      ddaMatrix: {
        Fp1: [0.1, 0.2, 0.3, 0.4, 0.5],
      },
      selectedChannels: ["Fp1"],
      errorValues: [0.1, 0.1, 0.1, 0.1, 0.1],
    });

    expect(assessment.decision).toBe("refine");
    expect(assessment.reasons.join(" ")).toContain("Low number of windows");
  });

  it("returns reconsider when no usable data exists", () => {
    const assessment = assessInterpretation({
      variantId: "cross_timeseries",
      ddaMatrix: {},
      selectedChannels: ["F3", "F4"],
    });

    expect(assessment.decision).toBe("reconsider");
    expect(assessment.score).toBe(0);
  });

  it("penalizes interaction variants with insufficient channel coverage", () => {
    const assessment = assessInterpretation({
      variantId: "cross_dynamical",
      ddaMatrix: {
        "F3->F4": [0.1, 0.1, 0.2, 0.3, 0.3, 0.4, 0.4, 0.5, 0.5, 0.5],
      },
      selectedChannels: ["F3->F4"],
    });

    expect(assessment.decision).toBe("reconsider");
    expect(assessment.reasons.join(" ").toLowerCase()).toContain(
      "interaction-focused variant",
    );
  });
});
