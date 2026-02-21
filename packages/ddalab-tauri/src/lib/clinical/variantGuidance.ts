export type ClinicalGoal =
  | "local_transitions"
  | "channel_coupling"
  | "directional_influence"
  | "global_state_change"
  | "synchrony_patterns";

export interface VariantGuidance {
  variantId: string;
  shortQuestion: string;
  useWhen: string;
  avoidWhen: string;
  outputFocus: string;
  recommendedGoal: ClinicalGoal;
}

const VARIANT_GUIDANCE: Record<string, VariantGuidance> = {
  single_timeseries: {
    variantId: "single_timeseries",
    shortQuestion: "What changes within each channel over time?",
    useWhen:
      "You want a first-pass screen for local transitions in individual channels.",
    avoidWhen:
      "Your primary question is directed channel-to-channel influence.",
    outputFocus: "Per-channel transition strength over time.",
    recommendedGoal: "local_transitions",
  },
  cross_timeseries: {
    variantId: "cross_timeseries",
    shortQuestion: "Which channel pairs change together?",
    useWhen: "You need bidirectional coupling patterns across channel pairs.",
    avoidWhen: "You need directionality (A->B vs B->A).",
    outputFocus: "Pairwise coupling changes over time.",
    recommendedGoal: "channel_coupling",
  },
  cross_dynamical: {
    variantId: "cross_dynamical",
    shortQuestion: "Is influence directional between channels?",
    useWhen:
      "You are testing directional interactions and asymmetry between channels.",
    avoidWhen:
      "You only need a quick broad scan and not direction-specific findings.",
    outputFocus: "Directed channel influence patterns.",
    recommendedGoal: "directional_influence",
  },
  dynamical_ergodicity: {
    variantId: "dynamical_ergodicity",
    shortQuestion: "Is global dynamical behavior shifting?",
    useWhen: "You want a compact summary of broad state organization changes.",
    avoidWhen:
      "You need detailed per-pair directional interpretation at channel level.",
    outputFocus: "Global dynamical state-change indicator.",
    recommendedGoal: "global_state_change",
  },
  synchronization: {
    variantId: "synchronization",
    shortQuestion: "Are channels becoming more synchronized?",
    useWhen:
      "You are investigating synchrony-related event dynamics across channels.",
    avoidWhen:
      "Your target is causal direction rather than synchrony patterns.",
    outputFocus: "Synchronization trends across channels and windows.",
    recommendedGoal: "synchrony_patterns",
  },
};

export function getVariantGuidance(variantId: string): VariantGuidance | null {
  return VARIANT_GUIDANCE[variantId] ?? null;
}

export function listVariantGuidance(): VariantGuidance[] {
  return Object.values(VARIANT_GUIDANCE);
}

export function recommendVariantByGoal(goal: ClinicalGoal): string | null {
  const match = Object.values(VARIANT_GUIDANCE).find(
    (item) => item.recommendedGoal === goal,
  );
  return match?.variantId ?? null;
}
