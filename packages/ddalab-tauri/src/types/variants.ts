/**
 * AUTO-GENERATED from DDA Specification v1.0.0
 * Generated: 2025-12-19
 *
 * DO NOT EDIT MANUALLY - Run `cargo run --package dda-spec` to regenerate.
 */

// =============================================================================
// CONSTANTS
// =============================================================================

export const SPEC_VERSION = "1.0.0" as const;
export const SELECT_MASK_SIZE = 6 as const;
export const BINARY_NAME = "run_DDA_AsciiEdf" as const;
export const REQUIRES_SHELL_WRAPPER = true as const;
export const SHELL_COMMAND = "sh" as const;
export const SUPPORTED_PLATFORMS = ["linux", "macos", "windows"] as const;

// =============================================================================
// TYPES
// =============================================================================

export type ChannelFormat = "individual" | "pairs" | "directed_pairs";

export type FileTypeName = "EDF" | "ASCII";

export interface OutputColumns {
  readonly coefficients: number;
  readonly hasError: boolean;
  readonly description: string;
}

export interface VariantMetadata {
  readonly abbreviation: VariantAbbreviation;
  readonly name: string;
  readonly position: number;
  readonly outputSuffix: string;
  readonly stride: number;
  readonly reserved: boolean;
  readonly requiredParams: readonly string[];
  readonly channelFormat: ChannelFormat;
  readonly outputColumns: OutputColumns;
  readonly documentation: string;
}

export type VariantAbbreviation = "ST" | "CT" | "CD" | "RESERVED" | "DE" | "SY";

export interface FileTypeInfo {
  readonly name: FileTypeName;
  readonly flag: string;
  readonly extensions: readonly string[];
}

// =============================================================================
// VARIANT DEFINITIONS
// =============================================================================

/**
 * Single Timeseries (ST) - Position 0
 *
 * Analyzes individual channels independently. Most basic variant. One result row per channel.
 */
export const ST: VariantMetadata = {
  abbreviation: "ST",
  name: "Single Timeseries",
  position: 0,
  outputSuffix: "_ST",
  stride: 4,
  reserved: false,
  requiredParams: [],
  channelFormat: "individual",
  outputColumns: {
    coefficients: 3,
    hasError: true,
    description: "4 columns per channel: a_1, a_2, a_3 coefficients + error",
  },
  documentation:
    "Analyzes individual channels independently. Most basic variant. One result row per channel.",
} as const;

/**
 * Cross-Timeseries (CT) - Position 1
 *
 * Analyzes relationships between channel pairs. Symmetric: pair (1,2) equals (2,1). When enabled with ST, wrapper must run CT pairs separately.
 */
export const CT: VariantMetadata = {
  abbreviation: "CT",
  name: "Cross-Timeseries",
  position: 1,
  outputSuffix: "_CT",
  stride: 4,
  reserved: false,
  requiredParams: ["-WL_CT", "-WS_CT"],
  channelFormat: "pairs",
  outputColumns: {
    coefficients: 3,
    hasError: true,
    description: "4 columns per pair: a_1, a_2, a_3 coefficients + error",
  },
  documentation:
    "Analyzes relationships between channel pairs. Symmetric: pair (1,2) equals (2,1). When enabled with ST, wrapper must run CT pairs separately.",
} as const;

/**
 * Cross-Dynamical (CD) - Position 2
 *
 * Analyzes directed causal relationships. Asymmetric: (1->2) differs from (2->1). CD is independent (no longer requires ST+CT).
 */
export const CD: VariantMetadata = {
  abbreviation: "CD",
  name: "Cross-Dynamical",
  position: 2,
  outputSuffix: "_CD_DDA_ST",
  stride: 2,
  reserved: false,
  requiredParams: ["-WL_CT", "-WS_CT"],
  channelFormat: "directed_pairs",
  outputColumns: {
    coefficients: 1,
    hasError: true,
    description: "2 columns per directed pair: a_1 coefficient + error",
  },
  documentation:
    "Analyzes directed causal relationships. Asymmetric: (1->2) differs from (2->1). CD is independent (no longer requires ST+CT).",
} as const;

/**
 * Reserved (RESERVED) - Position 3
 *
 * Internal development function. Should always be set to 0 in production.
 */
export const RESERVED: VariantMetadata = {
  abbreviation: "RESERVED",
  name: "Reserved",
  position: 3,
  outputSuffix: "_RESERVED",
  stride: 1,
  reserved: true,
  requiredParams: [],
  channelFormat: "individual",
  outputColumns: {
    coefficients: 0,
    hasError: false,
    description: "Reserved for internal development",
  },
  documentation:
    "Internal development function. Should always be set to 0 in production.",
} as const;

/**
 * Delay Embedding (DE) - Position 4
 *
 * Tests for ergodic behavior in dynamical systems. Produces single aggregate measure per time window (not per-channel).
 */
export const DE: VariantMetadata = {
  abbreviation: "DE",
  name: "Delay Embedding",
  position: 4,
  outputSuffix: "_DE",
  stride: 1,
  reserved: false,
  requiredParams: ["-WL_CT", "-WS_CT"],
  channelFormat: "individual",
  outputColumns: {
    coefficients: 0,
    hasError: false,
    description: "1 column: single ergodicity measure per time window",
  },
  documentation:
    "Tests for ergodic behavior in dynamical systems. Produces single aggregate measure per time window (not per-channel).",
} as const;

/**
 * Synchronization (SY) - Position 5
 *
 * Detects synchronized behavior between signals. Produces one value per channel/measure per time window.
 */
export const SY: VariantMetadata = {
  abbreviation: "SY",
  name: "Synchronization",
  position: 5,
  outputSuffix: "_SY",
  stride: 1,
  reserved: false,
  requiredParams: [],
  channelFormat: "individual",
  outputColumns: {
    coefficients: 0,
    hasError: false,
    description: "1 column per channel/measure: synchronization coefficient",
  },
  documentation:
    "Detects synchronized behavior between signals. Produces one value per channel/measure per time window.",
} as const;

/** All variants in SELECT mask order */
export const VARIANT_REGISTRY: readonly VariantMetadata[] = [
  ST,
  CT,
  CD,
  RESERVED,
  DE,
  SY,
] as const;

/** Variant abbreviations in SELECT mask order */
export const VARIANT_ORDER: readonly VariantAbbreviation[] = [
  "ST",
  "CT",
  "CD",
  "RESERVED",
  "DE",
  "SY",
] as const;

// =============================================================================
// SELECT MASK POSITIONS
// =============================================================================

export const SELECT_MASK_POSITIONS = {
  ST: 0,
  CT: 1,
  CD: 2,
  RESERVED: 3,
  DE: 4,
  SY: 5,
} as const;

// =============================================================================
// FILE TYPES
// =============================================================================

export const FILE_TYPES: Record<FileTypeName, FileTypeInfo> = {
  EDF: {
    name: "EDF",
    flag: "-EDF",
    extensions: ["edf"],
  },
  ASCII: {
    name: "ASCII",
    flag: "-ASCII",
    extensions: ["ascii", "txt", "csv"],
  },
} as const;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Look up variant by abbreviation
 */
export function getVariantByAbbrev(
  abbrev: string,
): VariantMetadata | undefined {
  return VARIANT_REGISTRY.find((v) => v.abbreviation === abbrev);
}

/**
 * Look up variant by output suffix
 */
export function getVariantBySuffix(
  suffix: string,
): VariantMetadata | undefined {
  return VARIANT_REGISTRY.find((v) => v.outputSuffix === suffix);
}

/**
 * Look up variant by position in SELECT mask
 */
export function getVariantByPosition(
  position: number,
): VariantMetadata | undefined {
  return VARIANT_REGISTRY.find((v) => v.position === position);
}

/**
 * Get all non-reserved variants
 */
export function getActiveVariants(): VariantMetadata[] {
  return VARIANT_REGISTRY.filter((v) => !v.reserved);
}

/**
 * Type guard to check if a string is a valid variant abbreviation
 */
export function isVariantAbbreviation(
  value: string,
): value is VariantAbbreviation {
  return VARIANT_ORDER.includes(value as VariantAbbreviation);
}

/**
 * Generate a SELECT mask from variant abbreviations
 *
 * @example
 * generateSelectMask(["ST", "SY"]) // [1, 0, 0, 0, 0, 1]
 */
export function generateSelectMask(variants: string[]): number[] {
  const mask = new Array(SELECT_MASK_SIZE).fill(0);
  for (const abbrev of variants) {
    const variant = getVariantByAbbrev(abbrev);
    if (variant) {
      mask[variant.position] = 1;
    }
  }
  return mask;
}

/**
 * Parse a SELECT mask back to variant abbreviations
 *
 * @example
 * parseSelectMask([1, 0, 0, 0, 0, 1]) // ["ST", "SY"]
 */
export function parseSelectMask(mask: number[]): VariantAbbreviation[] {
  const result: VariantAbbreviation[] = [];
  for (let pos = 0; pos < mask.length; pos++) {
    if (mask[pos] === 1) {
      const variant = getVariantByPosition(pos);
      if (variant && !variant.reserved) {
        result.push(variant.abbreviation);
      }
    }
  }
  return result;
}

/**
 * Format SELECT mask as space-separated string for CLI
 *
 * @example
 * formatSelectMask([1, 1, 0, 0, 0, 1]) // "1 1 0 0 0 1"
 */
export function formatSelectMask(mask: number[]): string {
  return mask.join(" ");
}

/**
 * Check if variant requires CT window parameters
 */
export function requiresCtParams(variant: VariantMetadata): boolean {
  return variant.requiredParams.includes("-WL_CT");
}

/**
 * Detect file type from extension
 */
export function getFileTypeFromExtension(
  ext: string,
): FileTypeInfo | undefined {
  const normalizedExt = ext.toLowerCase().replace(/^\./, "");
  for (const fileType of Object.values(FILE_TYPES)) {
    if (fileType.extensions.includes(normalizedExt)) {
      return fileType;
    }
  }
  return undefined;
}

// =============================================================================
// SCALE PARAMETERS
// =============================================================================

export interface ScaleParameters {
  scaleMin: number;
  scaleMax: number;
  scaleNum: number;
}

export const DEFAULT_SCALE_PARAMETERS: ScaleParameters = {
  scaleMin: 1,
  scaleMax: 20,
  scaleNum: 20,
};

/**
 * Generate delay values from scale parameters
 */
export function generateDelays(params: ScaleParameters): number[] {
  if (params.scaleNum === 1) {
    return [Math.round(params.scaleMin)];
  }

  const step = (params.scaleMax - params.scaleMin) / (params.scaleNum - 1);
  return Array.from({ length: params.scaleNum }, (_, i) =>
    Math.round(params.scaleMin + i * step),
  );
}
