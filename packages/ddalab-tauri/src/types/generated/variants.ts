// AUTO-GENERATED from DDA_SPEC.yaml
// DO NOT EDIT - Changes will be overwritten
//
// Generated at: 2025-11-15T18:30:41.097634+00:00
// Spec version: 1.0.0
// Generator: dda-codegen v0.1.0

/**
 * DDA Variant Metadata
 *
 * Defines properties and behavior for each DDA analysis variant.
 */
export interface VariantMetadata {
  /** Variant abbreviation (e.g., "ST", "CT", "CD") */
  abbreviation: string;

  /** Full variant name */
  name: string;

  /** Detailed description */
  description: string;

  /** Output file suffix appended by binary */
  outputSuffix: string;

  /**
   * Column stride for parsing output
   * - ST/CT/DE: 4 columns per channel/pair
   * - CD: 2 columns per directed pair
   * - SY: 1 column per channel
   */
  stride: number;

  /** Whether this variant requires CT window parameters */
  requiresCtParams: boolean;
}

/**
 * Registry of all DDA variants
 *
 * This is the canonical list of all supported DDA analysis variants.
 */
export const VARIANT_REGISTRY: ReadonlyArray<VariantMetadata> = [
  {
    abbreviation: "CD",
    name: "Cross-Dynamical",
    description: "Analyzes directed causal relationships between channels",
    outputSuffix: "_CD_DDA_ST",
    stride: 2,
    requiresCtParams: true,
  },
  {
    abbreviation: "CT",
    name: "Cross-Timeseries",
    description: "Analyzes relationships between channel pairs",
    outputSuffix: "_CT",
    stride: 4,
    requiresCtParams: true,
  },
  {
    abbreviation: "DE",
    name: "Delay Embedding (Dynamical Ergodicity)",
    description: "Analyzes dynamical ergodicity through delay embedding",
    outputSuffix: "_DE",
    stride: 1,
    requiresCtParams: true,
  },
  {
    abbreviation: "ST",
    name: "Single Timeseries",
    description: "Analyzes individual channels independently",
    outputSuffix: "_ST",
    stride: 4,
    requiresCtParams: false,
  },
  {
    abbreviation: "SY",
    name: "Synchronization",
    description: "Analyzes phase synchronization between signals",
    outputSuffix: "_SY",
    stride: 1,
    requiresCtParams: false,
  },
] as const;

/**
 * SELECT mask bit positions
 *
 * The SELECT mask is a 6-element array controlling which variants to execute.
 * Format: ST CT CD RESERVED DE SY
 */
export const SelectMaskPositions = {
  CD: 2,
  CT: 1,
  DE: 4, // Position 3 is RESERVED
  ST: 0,
  SY: 5,
  RESERVED: 3,
} as const;

/**
 * Get variant metadata by abbreviation
 *
 * @param abbrev - Variant abbreviation (e.g., "ST", "CT")
 * @returns VariantMetadata if found, undefined otherwise
 */
export function getVariantByAbbrev(abbrev: string): VariantMetadata | undefined {
  return VARIANT_REGISTRY.find((v) => v.abbreviation === abbrev);
}

/**
 * Get variant metadata by output suffix
 *
 * @param suffix - Output file suffix (e.g., "_DDA_ST")
 * @returns VariantMetadata if found, undefined otherwise
 */
export function getVariantBySuffix(suffix: string): VariantMetadata | undefined {
  return VARIANT_REGISTRY.find((v) => v.outputSuffix === suffix);
}

/**
 * Generate SELECT mask from enabled variants
 *
 * @param variants - List of variant abbreviations to enable (e.g., ["ST", "CT"])
 * @returns 6-element array with 1s for enabled variants, 0s for disabled
 *
 * @example
 * ```typescript
 * const mask = generateSelectMask(["ST", "SY"]);
 * // Result: [1, 0, 0, 0, 0, 1] - ST and SY enabled
 * ```
 */
export function generateSelectMask(variants: string[]): number[] {
  const mask = [0, 0, 0, 0, 0, 0];

  for (const variant of variants) {
    switch (variant) {
      case "CD":
        mask[SelectMaskPositions.CD] = 1;
        break;
      case "CT":
        mask[SelectMaskPositions.CT] = 1;
        break;
      case "DE":
        mask[SelectMaskPositions.DE] = 1;
        break;
      case "ST":
        mask[SelectMaskPositions.ST] = 1;
        break;
      case "SY":
        mask[SelectMaskPositions.SY] = 1;
        break;
      default:
        console.warn(`Unknown variant: ${variant}`);
    }
  }

  return mask;
}

/**
 * Parse SELECT mask to list of enabled variants
 *
 * @param mask - 6-element SELECT mask array
 * @returns Array of enabled variant abbreviations
 *
 * @example
 * ```typescript
 * const mask = [1, 0, 0, 0, 0, 1];
 * const enabled = parseSelectMask(mask);
 * // Result: ["ST", "SY"]
 * ```
 */
export function parseSelectMask(mask: number[]): string[] {
  if (mask.length < 6) {
    throw new Error(`Invalid SELECT mask: expected 6 bits, got ${mask.length}`);
  }

  const enabled: string[] = [];
  if (mask[SelectMaskPositions.CD] === 1) {
    enabled.push("CD");
  }
  if (mask[SelectMaskPositions.CT] === 1) {
    enabled.push("CT");
  }
  if (mask[SelectMaskPositions.DE] === 1) {
    enabled.push("DE");
  }
  if (mask[SelectMaskPositions.ST] === 1) {
    enabled.push("ST");
  }
  if (mask[SelectMaskPositions.SY] === 1) {
    enabled.push("SY");
  }

  return enabled;
}

/**
 * Variant type (for type safety)
 */
export type VariantAbbreviation = "CD" | "CT" | "DE" | "ST" | "SY";

/**
 * Type guard to check if a string is a valid variant abbreviation
 */
export function isVariantAbbreviation(value: string): value is VariantAbbreviation {
  return VARIANT_REGISTRY.some((v) => v.abbreviation === value);
}
