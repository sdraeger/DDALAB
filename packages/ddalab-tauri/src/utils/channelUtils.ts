/**
 * Channel Conversion Utilities
 *
 * Centralized functions for converting between channel names and indices.
 * Eliminates duplicate conversion logic throughout the codebase.
 */

/**
 * Convert an array of channel names to their indices in the channel list.
 * Filters out channels that don't exist in the list.
 *
 * @param channelNames - Array of channel names to convert
 * @param allChannels - Complete list of available channels
 * @returns Array of valid channel indices
 */
export function channelNamesToIndices(
  channelNames: string[],
  allChannels: string[],
): number[] {
  return channelNames
    .map((name) => allChannels.indexOf(name))
    .filter((idx) => idx !== -1);
}

/**
 * Convert channel pairs (names) to index pairs.
 * Filters out pairs where either channel doesn't exist.
 *
 * @param pairs - Array of [channelName1, channelName2] pairs
 * @param allChannels - Complete list of available channels
 * @returns Array of valid [index1, index2] pairs
 */
export function channelPairsToIndices(
  pairs: [string, string][],
  allChannels: string[],
): [number, number][] {
  return pairs
    .map(([ch1, ch2]) => {
      const idx1 = allChannels.indexOf(ch1);
      const idx2 = allChannels.indexOf(ch2);
      return [idx1, idx2] as [number, number];
    })
    .filter(([idx1, idx2]) => idx1 !== -1 && idx2 !== -1);
}

/**
 * Convert channel pairs (names) to index pairs with fallback to 0.
 * Used for NSG submission where we want to preserve pairs even if channel not found.
 *
 * @param pairs - Array of [channelName1, channelName2] pairs
 * @param allChannels - Complete list of available channels
 * @returns Array of [index1, index2] pairs (indices default to 0 if not found)
 */
export function channelPairsToIndicesWithFallback(
  pairs: [string, string][],
  allChannels: string[],
): [number, number][] {
  return pairs.map(([ch1, ch2]) => {
    const idx1 = allChannels.indexOf(ch1);
    const idx2 = allChannels.indexOf(ch2);
    return [idx1 >= 0 ? idx1 : 0, idx2 >= 0 ? idx2 : 0] as [number, number];
  });
}

/**
 * Convert channel indices to names.
 *
 * @param indices - Array of channel indices
 * @param allChannels - Complete list of available channels
 * @param unknownPrefix - Prefix for unknown channel indices (default: "Unknown")
 * @returns Array of channel names
 */
export function channelIndicesToNames(
  indices: number[],
  allChannels: string[],
  unknownPrefix = "Unknown",
): string[] {
  return indices.map((idx) => allChannels[idx] || `${unknownPrefix}(${idx})`);
}

/**
 * Normalize a file path for comparison.
 * Handles Windows backslashes and trailing slashes.
 *
 * @param path - File path to normalize
 * @returns Normalized path string
 */
export function normalizePath(path: string | undefined | null): string {
  if (!path) return "";
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
