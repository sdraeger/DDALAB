import { DDALabFileFormat, DDAConfigValidation, DDAConfigImportResult } from "@/types/ddaConfig";
import type { EDFFileInfo } from "@/types/api";

const DDALAB_FORMAT_VERSION = "1.0.0";

/**
 * Export DDA configuration to .ddalab file format
 */
export function exportDDAConfig(
  parameters: {
    variants: string[];
    windowLength: number;
    windowStep: number;
    delayConfig: {
      mode: "list";
      list?: number[];
    };
    stChannels?: string[];
    ctChannelPairs?: Array<{ source: string; target: string }>;
    cdChannelPairs?: Array<{ source: string; target: string }>;
    ctDelayMin?: number;
    ctDelayMax?: number;
    ctDelayStep?: number;
    ctWindowMin?: number;
    ctWindowMax?: number;
    ctWindowStep?: number;
  },
  fileInfo: EDFFileInfo,
  metadata: {
    analysisName: string;
    description?: string;
    analysisId?: string;
    executionTimeMs?: number;
    resultsSummary?: any;
  }
): DDALabFileFormat {
  const config: DDALabFileFormat = {
    version: DDALAB_FORMAT_VERSION,
    created_at: new Date().toISOString(),
    application_version: typeof window !== 'undefined' && (window as any).__TAURI_METADATA__?.version || "unknown",

    analysis_name: metadata.analysisName,
    description: metadata.description,

    source_file: {
      file_path: fileInfo.file_path,
      file_name: fileInfo.file_name,
      file_hash: "", // Will be computed by caller
      duration: fileInfo.duration,
      sample_rate: fileInfo.sample_rate,
      total_samples: fileInfo.total_samples,
    },

    parameters: {
      variants: parameters.variants,
      window_length: parameters.windowLength,
      window_step: parameters.windowStep,
      delay_config: parameters.delayConfig,
      st_channels: parameters.stChannels,
      ct_channel_pairs: parameters.ctChannelPairs,
      cd_channel_pairs: parameters.cdChannelPairs,
    },
  };

  // Add CT parameters if any variant uses them
  if (parameters.ctDelayMin !== undefined) {
    config.parameters.ct_parameters = {
      ct_delay_min: parameters.ctDelayMin,
      ct_delay_max: parameters.ctDelayMax!,
      ct_delay_step: parameters.ctDelayStep!,
      ct_window_min: parameters.ctWindowMin!,
      ct_window_max: parameters.ctWindowMax!,
      ct_window_step: parameters.ctWindowStep!,
    };
  }

  // Add results if available
  if (metadata.analysisId && metadata.executionTimeMs) {
    config.results = {
      analysis_id: metadata.analysisId,
      execution_time_ms: metadata.executionTimeMs,
      results_summary: metadata.resultsSummary,
    };
  }

  return config;
}

/**
 * Convert DDALabFileFormat to JSON string
 */
export function serializeDDAConfig(config: DDALabFileFormat): string {
  return JSON.stringify(config, null, 2);
}

/**
 * Parse .ddalab file content
 */
export function parseDDAConfig(fileContent: string): DDALabFileFormat {
  try {
    const config = JSON.parse(fileContent) as DDALabFileFormat;

    // Basic validation
    if (!config.version || !config.parameters || !config.source_file) {
      throw new Error("Invalid .ddalab file format: missing required fields");
    }

    return config;
  } catch (error) {
    throw new Error(`Failed to parse .ddalab file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate imported config against current file
 */
export function validateConfigAgainstFile(
  config: DDALabFileFormat,
  currentFile: EDFFileInfo | null
): DDAConfigValidation {
  const warnings: string[] = [];
  const errors: string[] = [];
  let valid = true;

  // Check if a file is selected
  if (!currentFile) {
    errors.push("No file currently selected");
    valid = false;
    return {
      valid,
      warnings,
      errors,
      compatibility: {
        file_match: false,
        duration_compatible: false,
        channels_compatible: false,
        sample_rate_match: false,
      },
    };
  }

  const compatibility = {
    file_match: currentFile.file_name === config.source_file.file_name,
    duration_compatible: true,
    channels_compatible: true,
    sample_rate_match: currentFile.sample_rate === config.source_file.sample_rate,
  };

  // Check file name match (not strict - just informational)
  if (!compatibility.file_match) {
    warnings.push(
      `Configuration was created for "${config.source_file.file_name}" but you're applying it to "${currentFile.file_name}". Ensure the files have compatible structure.`
    );
  }

  // Check sample rate
  if (!compatibility.sample_rate_match) {
    warnings.push(
      `Sample rate mismatch: Original ${config.source_file.sample_rate} Hz, Current ${currentFile.sample_rate} Hz. Time-based parameters will be adjusted.`
    );
  }

  // Check duration compatibility
  const configMaxWindow = config.parameters.window_length;
  const currentMaxSamples = currentFile.total_samples;

  if (configMaxWindow > currentMaxSamples) {
    errors.push(
      `Window length (${configMaxWindow} samples) exceeds current file duration (${currentMaxSamples} samples)`
    );
    compatibility.duration_compatible = false;
    valid = false;
  }

  // Check channel compatibility
  const requiredChannels = new Set<string>();

  // Add ST channels
  if (config.parameters.st_channels) {
    config.parameters.st_channels.forEach(channel => {
      requiredChannels.add(channel);
    });
  }

  // Add CT channel pairs
  if (config.parameters.ct_channel_pairs) {
    config.parameters.ct_channel_pairs.forEach(pair => {
      requiredChannels.add(pair.source);
      requiredChannels.add(pair.target);
    });
  }

  // Add CD channel pairs
  if (config.parameters.cd_channel_pairs) {
    config.parameters.cd_channel_pairs.forEach(pair => {
      requiredChannels.add(pair.source);
      requiredChannels.add(pair.target);
    });
  }

  const currentChannels = new Set(currentFile.channels);
  const missingChannels: string[] = [];

  requiredChannels.forEach(channel => {
    if (!currentChannels.has(channel)) {
      missingChannels.push(channel);
    }
  });

  if (missingChannels.length > 0) {
    errors.push(
      `Missing required channels: ${missingChannels.join(", ")}`
    );
    compatibility.channels_compatible = false;
    valid = false;
  }

  // Check delay parameters against file duration
  if (config.parameters.delay_config.mode === "range") {
    const maxDelay = config.parameters.delay_config.max || 0;
    if (maxDelay > currentMaxSamples) {
      errors.push(
        `Maximum delay (${maxDelay} samples) exceeds current file duration`
      );
      valid = false;
    }
  } else if (config.parameters.delay_config.list) {
    const maxDelay = Math.max(...config.parameters.delay_config.list);
    if (maxDelay > currentMaxSamples) {
      warnings.push(
        `Some delay values exceed current file duration and will be adjusted`
      );
    }
  }

  return {
    valid,
    warnings,
    errors,
    compatibility,
  };
}

/**
 * Import .ddalab file with validation
 */
export function importDDAConfig(
  fileContent: string,
  currentFile: EDFFileInfo | null
): DDAConfigImportResult {
  const config = parseDDAConfig(fileContent);
  const validation = validateConfigAgainstFile(config, currentFile);

  return {
    config,
    validation,
  };
}

/**
 * Convert imported config to local parameters format
 */
export function configToLocalParameters(config: DDALabFileFormat) {
  // Convert range mode to list mode for backward compatibility
  let delayConfig: { mode: "list"; list?: number[] };
  if (config.parameters.delay_config.mode === "range") {
    const min = config.parameters.delay_config.min || 1;
    const max = config.parameters.delay_config.max || 20;
    const num = config.parameters.delay_config.num || 20;

    // Generate evenly-spaced delays from range
    const list: number[] = [];
    for (let i = 0; i < num; i++) {
      const delay = Math.round(min + (max - min) * (i / (num - 1)));
      list.push(delay);
    }
    delayConfig = { mode: "list", list };
  } else {
    delayConfig = config.parameters.delay_config as { mode: "list"; list?: number[] };
  }

  return {
    variants: config.parameters.variants,
    windowLength: config.parameters.window_length,
    windowStep: config.parameters.window_step,
    delayConfig,
    // Variant-specific channels
    selectedChannels: config.parameters.st_channels || [],
    ctChannelPairs: config.parameters.ct_channel_pairs?.map(pair => [pair.source, pair.target] as [string, string]) || [],
    cdChannelPairs: config.parameters.cd_channel_pairs?.map(pair => [pair.source, pair.target] as [string, string]) || [],
    // Legacy compatibility
    scaleMin: delayConfig.list?.[0] || 1,
    scaleMax: delayConfig.list?.[delayConfig.list.length - 1] || 20,
    scaleNum: delayConfig.list?.length || 0,
    // CT parameters
    ctDelayMin: config.parameters.ct_parameters?.ct_delay_min,
    ctDelayMax: config.parameters.ct_parameters?.ct_delay_max,
    ctDelayStep: config.parameters.ct_parameters?.ct_delay_step,
    ctWindowMin: config.parameters.ct_parameters?.ct_window_min,
    ctWindowMax: config.parameters.ct_parameters?.ct_window_max,
    ctWindowStep: config.parameters.ct_parameters?.ct_window_step,
  };
}

/**
 * Generate a default filename for export
 */
export function generateExportFilename(analysisName: string, fileName: string): string {
  const timestamp = new Date().toISOString().split('T')[0];
  const safeName = analysisName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  const safeFileName = fileName.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

  return `${safeFileName}_${safeName}_${timestamp}.ddalab`;
}
