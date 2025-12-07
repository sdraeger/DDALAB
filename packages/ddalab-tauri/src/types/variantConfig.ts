/**
 * Variant configuration types for per-variant channel selection
 */

export type ChannelSelectionType = "individual" | "pairs" | "directed_pairs";

export interface VariantMetadata {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  color: string;
  rgb: string;
  bgColor: string;
  borderColor: string;
  channelType: ChannelSelectionType;
  requiresCTParameters?: boolean; // Requires CT window length/step
  supportsPreprocessing?: boolean;
}

export interface VariantChannelConfig {
  variantId: string;
  enabled: boolean;
  // For individual channel variants (ST, DE, SY)
  channels?: string[];
  // For pair-based variants (CT)
  channelPairs?: [string, string][];
  // For directed pair variants (CD)
  directedPairs?: [string, string][]; // [from, to]
}

export interface PerVariantChannelConfiguration {
  [variantId: string]: VariantChannelConfig;
}

/**
 * Variant metadata registry - defines all available DDA variants
 * This is the single source of truth for variant configuration
 */
export const VARIANT_REGISTRY: VariantMetadata[] = [
  {
    id: "single_timeseries",
    name: "Single Timeseries",
    abbreviation: "ST",
    description: "Standard temporal dynamics analysis",
    color: "#00B0F0", // RGB(0, 176, 240) - Bright Blue
    rgb: "0, 176, 240",
    bgColor: "bg-[#00B0F0]/10",
    borderColor: "border-l-[#00B0F0]",
    channelType: "individual",
    requiresCTParameters: false,
    supportsPreprocessing: true,
  },
  {
    id: "cross_timeseries",
    name: "Cross Timeseries",
    abbreviation: "CT",
    description: "Inter-channel relationship analysis",
    color: "#33CC33", // RGB(51, 204, 51) - Bright Green
    rgb: "51, 204, 51",
    bgColor: "bg-[#33CC33]/10",
    borderColor: "border-l-[#33CC33]",
    channelType: "pairs",
    requiresCTParameters: true,
    supportsPreprocessing: true,
  },
  {
    id: "cross_dynamical",
    name: "Cross Dynamical",
    abbreviation: "CD",
    description: "Dynamic coupling pattern analysis",
    color: "#ED2790", // RGB(237, 39, 144) - Magenta Pink
    rgb: "237, 39, 144",
    bgColor: "bg-[#ED2790]/10",
    borderColor: "border-l-[#ED2790]",
    channelType: "directed_pairs",
    requiresCTParameters: true,
    supportsPreprocessing: true,
  },
  {
    id: "dynamical_ergodicity",
    name: "Dynamical Ergodicity",
    abbreviation: "DE",
    description: "Temporal stationarity assessment",
    color: "#9900CC", // RGB(153, 0, 204) - Purple
    rgb: "153, 0, 204",
    bgColor: "bg-[#9900CC]/10",
    borderColor: "border-l-[#9900CC]",
    channelType: "individual",
    requiresCTParameters: true,
    supportsPreprocessing: true,
  },
  {
    id: "synchronization",
    name: "Synchronization",
    abbreviation: "SY",
    description: "Phase synchronization analysis",
    color: "#FF6600", // RGB(255, 102, 0) - Orange
    rgb: "255, 102, 0",
    bgColor: "bg-[#FF6600]/10",
    borderColor: "border-l-[#FF6600]",
    channelType: "individual",
    requiresCTParameters: false,
    supportsPreprocessing: true,
  },
];

/**
 * Canonical order for variant display: ST, CT, CD, DE, SY
 */
export const VARIANT_ORDER: Record<string, number> = {
  single_timeseries: 0,
  cross_timeseries: 1,
  cross_dynamical: 2,
  dynamical_ergodicity: 3,
  synchronization: 4,
};

/**
 * Get the color for a variant by its ID.
 * Returns a fallback color if the variant is not found.
 */
export function getVariantColor(variantId: string): string {
  const variant = VARIANT_REGISTRY.find((v) => v.id === variantId);
  return variant?.color ?? "#64748b"; // Default to slate if unknown
}

/**
 * Helper function to get variant metadata by ID
 */
export function getVariantMetadata(
  variantId: string,
): VariantMetadata | undefined {
  return VARIANT_REGISTRY.find((v) => v.id === variantId);
}

/**
 * Helper function to initialize variant channel config
 */
export function initializeVariantConfig(
  variantId: string,
  enabled: boolean,
  defaultChannels?: string[],
): VariantChannelConfig {
  const metadata = getVariantMetadata(variantId);
  if (!metadata) {
    throw new Error(`Unknown variant: ${variantId}`);
  }

  const config: VariantChannelConfig = {
    variantId,
    enabled,
  };

  if (metadata.channelType === "individual") {
    config.channels = defaultChannels || [];
  } else if (metadata.channelType === "pairs") {
    config.channelPairs = [];
  } else if (metadata.channelType === "directed_pairs") {
    config.directedPairs = [];
  }

  return config;
}

/**
 * Validate that a variant configuration has required channels
 */
export function isVariantConfigValid(config: VariantChannelConfig): boolean {
  if (!config.enabled) return true;

  const metadata = getVariantMetadata(config.variantId);
  if (!metadata) return false;

  if (metadata.channelType === "individual") {
    return (config.channels?.length ?? 0) > 0;
  } else if (metadata.channelType === "pairs") {
    return (config.channelPairs?.length ?? 0) > 0;
  } else if (metadata.channelType === "directed_pairs") {
    return (config.directedPairs?.length ?? 0) > 0;
  }

  return false;
}
