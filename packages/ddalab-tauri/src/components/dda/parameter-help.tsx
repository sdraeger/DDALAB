"use client";

import * as React from "react";
import { InfoTooltip } from "@/components/ui/info-tooltip";

/**
 * Centralized help text for DDA parameters.
 * Provides consistent, technical documentation throughout the UI.
 */

export interface ParameterHelpContent {
  title: string;
  description: string;
  technicalNote?: string;
  example?: string;
  formula?: string;
  range?: { min: number | string; max: number | string; unit?: string };
}

export const DDA_PARAMETER_HELP: Record<string, ParameterHelpContent> = {
  windowLength: {
    title: "Window Length",
    description:
      "The number of samples in each analysis window. Longer windows capture more temporal dynamics but reduce temporal resolution.",
    technicalNote:
      "Recommended: 100-500ms of data. For 256 Hz sampling, 250ms = 64 samples.",
    example: "For EEG at 256 Hz: 64 samples = 250ms window",
    range: { min: 50, max: 1000, unit: "ms" },
  },
  windowStep: {
    title: "Window Step (Stride)",
    description:
      "How many samples to advance between consecutive windows. Smaller steps = more overlap = smoother output but longer computation.",
    technicalNote:
      "Step = Window Length - Overlap. For 75% overlap with 64 sample windows, step = 16 samples.",
    formula: "step = windowLength × (1 - overlapPercent / 100)",
    range: { min: 1, max: "windowLength - 1", unit: "samples" },
  },
  windowOverlap: {
    title: "Window Overlap",
    description:
      "Percentage of overlap between consecutive windows. Higher overlap produces smoother time series but increases computation time.",
    technicalNote:
      "75% overlap is standard for most analyses. 90%+ for high temporal resolution.",
    range: { min: 0, max: 99, unit: "%" },
  },
  delays: {
    title: "Delay Parameters (τ)",
    description:
      "Time lags used to construct the delay embedding. The delay τ determines how far apart in time the embedded coordinates are taken.",
    technicalNote:
      "Delays should span multiple characteristic time scales of the signal. Common choices: [1, 2, 3, 5, 7, 10] for standard EEG.",
    formula: "x(t), x(t-τ), x(t-2τ), ... form the delay coordinates",
    example: "τ=7 at 256 Hz ≈ 27ms lag between coordinates",
  },
  variants: {
    title: "DDA Variants",
    description: "Different methods for computing delay differential analysis.",
    technicalNote:
      "ST: Single channel analysis. CT: Cross-channel (bidirectional). CD: Cross-channel (directed). DE: Dynamical Ergodicity. SY: Synchronization.",
  },
  ST: {
    title: "Single Timeseries (ST)",
    description:
      "Analyzes dynamics within a single channel using delay embedding.",
    technicalNote:
      "Computes complexity measure for individual channel dynamics. Good for detecting state changes.",
  },
  CT: {
    title: "Cross-Timeseries (CT)",
    description: "Analyzes bidirectional relationships between channel pairs.",
    technicalNote:
      "Measures coupling strength between two signals regardless of direction. Useful for connectivity analysis.",
  },
  CD: {
    title: "Cross-Directed (CD)",
    description:
      "Analyzes directed (causal) relationships between channel pairs.",
    technicalNote:
      "Measures information flow from one channel to another. A→B and B→A are computed separately.",
  },
  DE: {
    title: "Dynamical Ergodicity (DE)",
    description:
      "Measures how well the signal explores its dynamical state space.",
    technicalNote:
      "Low DE suggests the system is confined to a limited region of state space. High DE indicates broader exploration.",
  },
  SY: {
    title: "Synchronization (SY)",
    description:
      "Measures phase synchronization between channels using delay coordinates.",
    technicalNote:
      "Related to cross-timeseries but focuses on phase relationships rather than amplitude coupling.",
  },
  sampleRate: {
    title: "Sampling Rate",
    description: "Number of samples per second in the signal.",
    technicalNote:
      "All temporal parameters (window length, delays) should be considered relative to the sampling rate.",
    example: "256 Hz means 256 samples = 1 second of data",
    range: { min: 1, max: 100000, unit: "Hz" },
  },
};

interface ParameterHelpProps {
  parameter: keyof typeof DDA_PARAMETER_HELP;
  side?: "top" | "right" | "bottom" | "left";
  iconClassName?: string;
  showFormula?: boolean;
  showExample?: boolean;
}

/**
 * Displays a help tooltip for a specific DDA parameter.
 * Uses centralized help definitions for consistency.
 *
 * @example
 * ```tsx
 * <Label>Window Length <ParameterHelp parameter="windowLength" /></Label>
 * ```
 */
export function ParameterHelp({
  parameter,
  side = "top",
  iconClassName,
  showFormula = true,
  showExample = true,
}: ParameterHelpProps) {
  const help = DDA_PARAMETER_HELP[parameter];

  if (!help) {
    console.warn(`No help defined for parameter: ${parameter}`);
    return null;
  }

  return (
    <InfoTooltip
      side={side}
      iconClassName={iconClassName}
      content={
        <div className="space-y-2 text-sm max-w-sm">
          <p className="font-semibold">{help.title}</p>
          <p>{help.description}</p>

          {help.technicalNote && (
            <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-2">
              {help.technicalNote}
            </p>
          )}

          {showFormula && help.formula && (
            <p className="text-xs font-mono bg-muted/50 px-2 py-1 rounded">
              {help.formula}
            </p>
          )}

          {showExample && help.example && (
            <p className="text-xs text-muted-foreground italic">
              Example: {help.example}
            </p>
          )}

          {help.range && (
            <p className="text-xs text-muted-foreground">
              Range: {help.range.min} - {help.range.max}
              {help.range.unit && ` ${help.range.unit}`}
            </p>
          )}
        </div>
      }
    />
  );
}

/**
 * Inline parameter explanation component.
 * Shows the full help content inline instead of in a tooltip.
 */
export function ParameterHelpInline({
  parameter,
  showFormula = true,
  showExample = true,
  className,
}: {
  parameter: keyof typeof DDA_PARAMETER_HELP;
  showFormula?: boolean;
  showExample?: boolean;
  className?: string;
}) {
  const help = DDA_PARAMETER_HELP[parameter];

  if (!help) return null;

  return (
    <div className={`text-xs text-muted-foreground space-y-1 ${className}`}>
      <p>{help.description}</p>

      {help.technicalNote && (
        <p className="border-l-2 border-primary/20 pl-2 text-[11px]">
          {help.technicalNote}
        </p>
      )}

      {showFormula && help.formula && (
        <code className="block font-mono bg-muted/50 px-2 py-1 rounded text-[10px]">
          {help.formula}
        </code>
      )}

      {showExample && help.example && (
        <p className="italic text-[11px]">Example: {help.example}</p>
      )}
    </div>
  );
}

/**
 * Get help content for a parameter programmatically.
 * Useful for dynamic help generation.
 */
export function getParameterHelp(
  parameter: string,
): ParameterHelpContent | undefined {
  return DDA_PARAMETER_HELP[parameter];
}
