export type InterpretationDecision = "proceed" | "refine" | "reconsider";

export interface InterpretationInput {
  variantId: string;
  ddaMatrix: Record<string, number[]>;
  selectedChannels: string[];
  errorValues?: number[];
}

export interface InterpretationStats {
  channelCount: number;
  windowCount: number;
  finiteValueRatio: number;
  selectedCoverageRatio: number;
  errorFiniteRatio: number | null;
}

export interface InterpretationAssessment {
  decision: InterpretationDecision;
  score: number;
  summary: string;
  reasons: string[];
  recommendedActions: string[];
  stats: InterpretationStats;
}

const HIGH_COMPLEXITY_VARIANTS = new Set([
  "cross_timeseries",
  "cross_dynamical",
]);

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function summarizeFiniteRatio(
  ddaMatrix: Record<string, number[]>,
  sampleCapPerChannel = 2000,
): { finite: number; total: number; windowCount: number } {
  let finite = 0;
  let total = 0;
  let windowCount = 0;

  for (const values of Object.values(ddaMatrix)) {
    if (!Array.isArray(values) || values.length === 0) continue;
    windowCount = Math.max(windowCount, values.length);

    const stride = Math.max(1, Math.ceil(values.length / sampleCapPerChannel));
    for (let i = 0; i < values.length; i += stride) {
      total += 1;
      if (Number.isFinite(values[i])) finite += 1;
    }
  }

  return { finite, total, windowCount };
}

function decideFromScore(score: number): InterpretationDecision {
  if (score >= 70) return "proceed";
  if (score >= 45) return "refine";
  return "reconsider";
}

function buildSummary(decision: InterpretationDecision): string {
  if (decision === "proceed") {
    return "Signal quality is sufficient for interpretation and follow-up.";
  }
  if (decision === "refine") {
    return "Results are usable but would benefit from one refinement pass.";
  }
  return "Interpretation confidence is low; revise configuration before using this run.";
}

export function assessInterpretation(
  input: InterpretationInput,
): InterpretationAssessment {
  const { variantId, ddaMatrix, selectedChannels, errorValues } = input;

  const channels = Object.keys(ddaMatrix);
  const channelCount = channels.length;
  const selectedCoverageRatio =
    selectedChannels.length === 0
      ? 1
      : safeRatio(
          selectedChannels.filter((ch) => channels.includes(ch)).length,
          selectedChannels.length,
        );

  const finiteSummary = summarizeFiniteRatio(ddaMatrix);
  const finiteValueRatio = safeRatio(finiteSummary.finite, finiteSummary.total);

  const errorFiniteRatio =
    errorValues && errorValues.length > 0
      ? safeRatio(
          errorValues.filter((value) => Number.isFinite(value)).length,
          errorValues.length,
        )
      : null;

  const stats: InterpretationStats = {
    channelCount,
    windowCount: finiteSummary.windowCount,
    finiteValueRatio,
    selectedCoverageRatio,
    errorFiniteRatio,
  };

  const reasons: string[] = [];
  const recommendedActions: string[] = [];
  let score = 100;

  if (channelCount === 0 || finiteSummary.windowCount === 0) {
    score = 0;
    reasons.push("No usable variant data points were detected.");
    recommendedActions.push(
      "Confirm channel configuration and rerun the analysis.",
    );
  } else {
    if (finiteValueRatio < 0.75) {
      score -= 45;
      reasons.push("High non-finite value rate in computed DDA matrix.");
      recommendedActions.push(
        "Apply stricter artifact handling and rerun with the same variant.",
      );
    } else if (finiteValueRatio < 0.9) {
      score -= 20;
      reasons.push("Moderate non-finite value rate in DDA outputs.");
      recommendedActions.push(
        "Review preprocessing and verify channel quality before final interpretation.",
      );
    }

    if (finiteSummary.windowCount < 20) {
      score -= 35;
      reasons.push("Low number of windows reduces temporal confidence.");
      recommendedActions.push(
        "Increase analyzed time range or reduce window step for denser coverage.",
      );
    }

    if (selectedCoverageRatio < 0.7) {
      score -= 12;
      reasons.push("A large fraction of selected channels is not represented.");
      recommendedActions.push(
        "Re-check channel selection for the active variant before interpretation.",
      );
    }

    if (errorFiniteRatio !== null && errorFiniteRatio < 0.8) {
      score -= 10;
      reasons.push("Error series contains many non-finite values.");
      recommendedActions.push(
        "Use a conservative interpretation and compare with a second run.",
      );
    }

    if (HIGH_COMPLEXITY_VARIANTS.has(variantId) && channelCount < 2) {
      score -= 30;
      reasons.push(
        "Interaction-focused variant has too few effective channels/pairs.",
      );
      recommendedActions.push(
        "Add additional channel pairs for interaction-focused variants.",
      );
    }
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  const decision = decideFromScore(clampedScore);

  if (reasons.length === 0) {
    reasons.push("Finite output coverage and window density are adequate.");
  }

  if (recommendedActions.length === 0) {
    recommendedActions.push(
      "Proceed with interpretation and export a reproducibility bundle.",
    );
  }

  return {
    decision,
    score: clampedScore,
    summary: buildSummary(decision),
    reasons,
    recommendedActions,
    stats,
  };
}
