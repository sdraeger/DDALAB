import { useMemo, useCallback } from "react";
import { DDAParameters } from "@/components/analysis/AnalysisFormProvider";
import { EDFFileInfo } from "@/types/api";
import { DDA_VARIANTS } from "@/components/dda/VariantSelector";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AnalysisValidation {
  channelValidation: ValidationResult;
  timeRangeValidation: ValidationResult;
  parameterValidation: ValidationResult;
  errors: Record<string, string>;
  warnings: string[];
  hasErrors: boolean;
  hasWarnings: boolean;
  validateAll: () => boolean;
}

export function useAnalysisValidation(
  parameters: DDAParameters,
  selectedFile: EDFFileInfo | null,
): AnalysisValidation {
  const validateChannels = useCallback((): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!selectedFile) {
      errors.push("No file selected");
      return { isValid: false, errors, warnings };
    }

    if (parameters.variants.length === 0) {
      warnings.push("No analysis variants selected");
      return { isValid: true, errors, warnings };
    }

    const allChannels = new Set<string>();
    const missingConfigVariants: string[] = [];

    parameters.variants.forEach((variantId) => {
      const config = parameters.variantChannelConfigs[variantId];
      let hasChannels = false;

      if (config) {
        if (config.selectedChannels && config.selectedChannels.length > 0) {
          config.selectedChannels.forEach((ch) => allChannels.add(ch));
          hasChannels = true;
        }
        if (config.ctChannelPairs && config.ctChannelPairs.length > 0) {
          config.ctChannelPairs.forEach(([ch1, ch2]) => {
            allChannels.add(ch1);
            allChannels.add(ch2);
          });
          hasChannels = true;
        }
        if (config.cdChannelPairs && config.cdChannelPairs.length > 0) {
          config.cdChannelPairs.forEach(([from, to]) => {
            allChannels.add(from);
            allChannels.add(to);
          });
          hasChannels = true;
        }
      }

      if (!hasChannels) {
        const variant = DDA_VARIANTS.find((v) => v.id === variantId);
        missingConfigVariants.push(variant?.name || variantId);
      }
    });

    if (allChannels.size === 0) {
      errors.push(
        "Please configure channels for at least one variant before running analysis",
      );
    } else if (missingConfigVariants.length > 0) {
      errors.push(
        `Missing channel configuration for: ${missingConfigVariants.join(", ")}`,
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }, [parameters.variants, parameters.variantChannelConfigs, selectedFile]);

  const validateTimeRange = useCallback((): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!selectedFile) {
      return { isValid: true, errors, warnings };
    }

    if (parameters.timeStart < 0) {
      errors.push("Start time cannot be negative");
    }

    if (parameters.timeStart >= parameters.timeEnd) {
      errors.push("End time must be greater than start time");
    }

    if (parameters.timeEnd > selectedFile.duration) {
      errors.push(
        `End time (${parameters.timeEnd.toFixed(1)}s) exceeds file duration (${selectedFile.duration.toFixed(1)}s)`,
      );
    }

    const duration = parameters.timeEnd - parameters.timeStart;
    if (duration < 0.1) {
      errors.push("Time range must be at least 0.1 seconds");
    }

    if (duration < 1.0) {
      warnings.push("Very short time range may produce limited results");
    }

    if (duration > selectedFile.duration * 0.9) {
      warnings.push(
        "Analyzing most of the file - this may take significant time",
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }, [
    parameters.timeStart,
    parameters.timeEnd,
    selectedFile?.duration,
    selectedFile,
  ]);

  const validateParameters = useCallback((): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (parameters.windowLength <= 0) {
      errors.push("Window length must be positive");
    }

    if (parameters.windowStep <= 0) {
      errors.push("Window step must be positive");
    }

    if (parameters.windowStep > parameters.windowLength) {
      warnings.push(
        "Window step is larger than window length - windows will not overlap",
      );
    }

    if (parameters.delays.length === 0) {
      errors.push("At least one delay value is required");
    }

    if (parameters.delays.some((d) => d < 0)) {
      errors.push("Delay values must be non-negative");
    }

    const timeRange = parameters.timeEnd - parameters.timeStart;
    const windowCount = Math.floor(timeRange / parameters.windowStep);

    if (windowCount < 2) {
      errors.push(
        "Time range and window configuration produce fewer than 2 windows - increase time range or decrease window step",
      );
    }

    if (windowCount > 10000) {
      warnings.push(
        `Large number of windows (${windowCount}) - analysis may take significant time`,
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }, [
    parameters.windowLength,
    parameters.windowStep,
    parameters.delays,
    parameters.timeStart,
    parameters.timeEnd,
  ]);

  const validateAll = useCallback((): boolean => {
    const channelResult = validateChannels();
    const timeRangeResult = validateTimeRange();
    const parameterResult = validateParameters();

    return (
      channelResult.isValid &&
      timeRangeResult.isValid &&
      parameterResult.isValid
    );
  }, [validateChannels, validateTimeRange, validateParameters]);

  const channelValidation = useMemo(
    () => validateChannels(),
    [validateChannels],
  );
  const timeRangeValidation = useMemo(
    () => validateTimeRange(),
    [validateTimeRange],
  );
  const parameterValidation = useMemo(
    () => validateParameters(),
    [validateParameters],
  );

  const errors = useMemo(() => {
    const errorMap: Record<string, string> = {};

    if (channelValidation.errors.length > 0) {
      errorMap.channels = channelValidation.errors[0];
    }

    if (timeRangeValidation.errors.length > 0) {
      errorMap.timeRange = timeRangeValidation.errors[0];
    }

    if (parameterValidation.errors.length > 0) {
      errorMap.parameters = parameterValidation.errors[0];
    }

    return errorMap;
  }, [channelValidation, timeRangeValidation, parameterValidation]);

  const warnings = useMemo(() => {
    return [
      ...channelValidation.warnings,
      ...timeRangeValidation.warnings,
      ...parameterValidation.warnings,
    ];
  }, [channelValidation, timeRangeValidation, parameterValidation]);

  return {
    channelValidation,
    timeRangeValidation,
    parameterValidation,
    errors,
    warnings,
    hasErrors: Object.keys(errors).length > 0,
    hasWarnings: warnings.length > 0,
    validateAll,
  };
}
