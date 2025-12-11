import type { DDAResult } from "@/types/api";

export interface ExportOptions {
  variant?: string;
  channels?: string[];
}

/**
 * Compute window indices from DDA parameters
 * @param numWindows Number of windows in the result
 * @param windowLength Window length in samples
 * @param windowStep Window step in samples
 * @returns Array of [window_start, window_end] pairs
 */
function computeWindowIndices(
  numWindows: number,
  windowLength: number,
  windowStep: number,
): [number, number][] {
  const indices: [number, number][] = [];
  for (let i = 0; i < numWindows; i++) {
    const start = i * windowStep;
    const end = start + windowLength;
    indices.push([start, end]);
  }
  return indices;
}

/**
 * Export DDA results to CSV format
 * Simple tabular format: variant, window_start, window_end, error, channel1, channel2, ...
 * When exporting multiple variants, includes variant column; single variant omits it
 * Only includes variants that have actual data
 */
export function exportDDAToCSV(
  result: DDAResult,
  options: ExportOptions = {},
): string {
  const { variant, channels } = options;

  const windowLength = result.parameters.window_length ?? 100;
  const windowStep = result.parameters.window_step ?? 10;

  // Filter variants: by ID if specified, and always exclude empty variants
  const variantsToExport = result.results.variants.filter((v) => {
    // If variant filter specified, check it
    if (variant && v.variant_id !== variant) return false;
    // Only include variants with actual data
    const hasData = Object.keys(v.dda_matrix).length > 0;
    return hasData;
  });

  const lines: string[] = [];
  const isMultiVariant = variantsToExport.length > 1;
  let headerWritten = false;

  for (const variantResult of variantsToExport) {
    const channelsToExport = channels || Object.keys(variantResult.dda_matrix);

    if (channelsToExport.length === 0) continue;

    const firstChannel = channelsToExport[0];
    const numWindows = variantResult.dda_matrix[firstChannel]?.length ?? 0;

    if (numWindows === 0) continue;

    const windowIndices = computeWindowIndices(
      numWindows,
      windowLength,
      windowStep,
    );

    // Get error values (from variant or top-level results)
    const errorValues =
      variantResult.error_values || result.results.error_values || [];
    const hasErrorValues = errorValues.length > 0;

    // Header row (only write once for multi-variant export)
    if (!headerWritten) {
      const baseHeader = hasErrorValues
        ? ["window_start", "window_end", "error", ...channelsToExport]
        : ["window_start", "window_end", ...channelsToExport];
      const header = isMultiVariant ? ["variant", ...baseHeader] : baseHeader;
      lines.push(header.join(","));
      headerWritten = true;
    }

    // Data rows
    for (let i = 0; i < numWindows; i++) {
      const row: (string | number)[] = isMultiVariant
        ? [variantResult.variant_id]
        : [];

      row.push(windowIndices[i][0], windowIndices[i][1]);

      // Add error value if available
      if (hasErrorValues) {
        const errorVal = errorValues[i];
        row.push(
          errorVal !== undefined && Number.isFinite(errorVal) ? errorVal : "",
        );
      }

      for (const channel of channelsToExport) {
        const value = variantResult.dda_matrix[channel]?.[i];
        row.push(value !== undefined && Number.isFinite(value) ? value : "");
      }

      lines.push(row.join(","));
    }
  }

  return lines.join("\n");
}

/**
 * Export DDA results with exponents to CSV
 * Includes exponent summary at the end for each variant
 * Only includes variants that have actual data
 */
export function exportDDAWithSummaryToCSV(
  result: DDAResult,
  options: ExportOptions = {},
): string {
  const { variant, channels } = options;

  const windowLength = result.parameters.window_length ?? 100;
  const windowStep = result.parameters.window_step ?? 10;

  // Filter variants: by ID if specified, and always exclude empty variants
  const variantsToExport = result.results.variants.filter((v) => {
    // If variant filter specified, check it
    if (variant && v.variant_id !== variant) return false;
    // Only include variants with actual data
    const hasData = Object.keys(v.dda_matrix).length > 0;
    return hasData;
  });

  const lines: string[] = [];
  const isMultiVariant = variantsToExport.length > 1;
  let headerWritten = false;

  for (const variantResult of variantsToExport) {
    const channelsToExport = channels || Object.keys(variantResult.dda_matrix);

    if (channelsToExport.length === 0) continue;

    const firstChannel = channelsToExport[0];
    const numWindows = variantResult.dda_matrix[firstChannel]?.length ?? 0;

    if (numWindows === 0) continue;

    const windowIndices = computeWindowIndices(
      numWindows,
      windowLength,
      windowStep,
    );

    // Get error values (from variant or top-level results)
    const errorValues =
      variantResult.error_values || result.results.error_values || [];
    const hasErrorValues = errorValues.length > 0;

    // Header row (only write once for multi-variant export)
    if (!headerWritten) {
      const baseHeader = hasErrorValues
        ? ["window_start", "window_end", "error", ...channelsToExport]
        : ["window_start", "window_end", ...channelsToExport];
      const header = isMultiVariant ? ["variant", ...baseHeader] : baseHeader;
      lines.push(header.join(","));
      headerWritten = true;
    }

    // Data rows
    for (let i = 0; i < numWindows; i++) {
      const row: (string | number)[] = isMultiVariant
        ? [variantResult.variant_id]
        : [];

      row.push(windowIndices[i][0], windowIndices[i][1]);

      // Add error value if available
      if (hasErrorValues) {
        const errorVal = errorValues[i];
        row.push(
          errorVal !== undefined && Number.isFinite(errorVal) ? errorVal : "",
        );
      }

      for (const channel of channelsToExport) {
        const value = variantResult.dda_matrix[channel]?.[i];
        row.push(value !== undefined && Number.isFinite(value) ? value : "");
      }

      lines.push(row.join(","));
    }

    // Exponents summary (if available)
    if (Object.keys(variantResult.exponents).length > 0) {
      lines.push("");
      const expHeaderPrefix = isMultiVariant
        ? `${variantResult.variant_id}_exponent`
        : "exponent";
      lines.push(expHeaderPrefix + "," + channelsToExport.join(","));
      const expRow: (string | number)[] = ["value"];
      for (const channel of channelsToExport) {
        const exp = variantResult.exponents[channel];
        expRow.push(exp !== undefined ? exp : "");
      }
      lines.push(expRow.join(","));
    }
  }

  return lines.join("\n");
}

/**
 * Export DDA results to JSON format
 * Simplified structure with window indices and error values
 * Only includes variants that have actual data
 */
export function exportDDAToJSON(
  result: DDAResult,
  options: ExportOptions = {},
): string {
  const { variant, channels } = options;

  const windowLength = result.parameters.window_length ?? 100;
  const windowStep = result.parameters.window_step ?? 10;

  // Filter variants: by ID if specified, and always exclude empty variants
  const variantsToExport = result.results.variants.filter((v) => {
    // If variant filter specified, check it
    if (variant && v.variant_id !== variant) return false;
    // Only include variants with actual data
    const hasData = Object.keys(v.dda_matrix).length > 0;
    return hasData;
  });

  const exportData = {
    id: result.id,
    file_path: result.file_path,
    channels: result.channels,
    parameters: {
      window_length: windowLength,
      window_step: windowStep,
      delays: result.parameters.delay_list,
    },
    variants: variantsToExport.map((v) => {
      const channelsToExport = channels || Object.keys(v.dda_matrix);
      const firstChannel = channelsToExport[0];
      const numWindows = v.dda_matrix[firstChannel]?.length ?? 0;

      const windowIndices = computeWindowIndices(
        numWindows,
        windowLength,
        windowStep,
      );

      const filteredMatrix: Record<string, number[]> = {};
      const filteredExponents: Record<string, number> = {};

      for (const channel of channelsToExport) {
        if (v.dda_matrix[channel]) {
          filteredMatrix[channel] = v.dda_matrix[channel];
        }
        if (v.exponents[channel] !== undefined) {
          filteredExponents[channel] = v.exponents[channel];
        }
      }

      // Get error values (from variant or top-level results)
      const errorValues = v.error_values || result.results.error_values || [];

      return {
        variant_id: v.variant_id,
        variant_name: v.variant_name,
        windows: windowIndices.map(([start, end], i) => ({
          window_start: start,
          window_end: end,
          ...(errorValues[i] !== undefined && { error: errorValues[i] }),
        })),
        dda_matrix: filteredMatrix,
        exponents: filteredExponents,
        ...(errorValues.length > 0 && { error_values: errorValues }),
      };
    }),
  };

  return JSON.stringify(exportData, null, 2);
}

export function getDefaultExportFilename(
  result: DDAResult,
  format: "csv" | "json",
  variant?: string,
): string {
  const timestamp = new Date(result.created_at)
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const variantSuffix = variant ? `_${variant}` : "_all";
  const fileName = result.name || result.id.slice(0, 8);

  return `dda_${fileName}${variantSuffix}_${timestamp}.${format}`;
}
