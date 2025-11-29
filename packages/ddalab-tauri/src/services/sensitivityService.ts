/**
 * Sensitivity Analysis Service
 *
 * Runs multiple DDA analyses with varying parameters to understand
 * how results change with different settings.
 */

import { ApiService } from "./apiService";
import {
  SensitivityConfig,
  SensitivityResult,
  SensitivityAnalysis,
  SensitivitySummary,
  SensitivityReport,
  SweepParameter,
  ParameterRange,
} from "@/types/sensitivity";
import { DDAAnalysisRequest } from "@/types/api";

type ProgressCallback = (analysis: SensitivityAnalysis) => void;

/** Partial parameter values for sensitivity sweep */
type PartialParameterValues = Partial<Record<SweepParameter, number>>;

/**
 * Generate parameter combinations from ranges
 */
function generateParameterCombinations(
  ranges: ParameterRange[],
): PartialParameterValues[] {
  if (ranges.length === 0) return [{}];

  const combinations: PartialParameterValues[] = [];

  // Generate values for each parameter
  const parameterValues: Map<SweepParameter, number[]> = new Map();
  for (const range of ranges) {
    const values: number[] = [];
    const step = (range.max - range.min) / Math.max(range.steps - 1, 1);
    for (let i = 0; i < range.steps; i++) {
      values.push(Math.round(range.min + step * i));
    }
    parameterValues.set(range.parameter, values);
  }

  // Generate all combinations
  function generateCombinations(
    index: number,
    current: PartialParameterValues,
  ) {
    if (index >= ranges.length) {
      combinations.push({ ...current });
      return;
    }

    const param = ranges[index].parameter;
    const values = parameterValues.get(param) || [];

    for (const value of values) {
      current[param] = value;
      generateCombinations(index + 1, current);
    }
  }

  generateCombinations(0, {});
  return combinations;
}

/**
 * Extract summary statistics from DDA result
 */
function extractResultSummary(
  result: any,
  parameterValues: PartialParameterValues,
  duration_ms: number,
): SensitivityResult {
  const variantResults = [];

  if (result?.results?.variants) {
    for (const variant of result.results.variants) {
      const allValues: number[] = [];
      const channelMeans: Record<string, number> = {};

      // Extract Q matrix values
      if (variant.dda_matrix) {
        for (const [channel, values] of Object.entries(variant.dda_matrix)) {
          if (Array.isArray(values)) {
            const validValues = (values as number[]).filter(
              (v) => !isNaN(v) && isFinite(v),
            );
            if (validValues.length > 0) {
              const mean =
                validValues.reduce((a, b) => a + b, 0) / validValues.length;
              channelMeans[channel] = mean;
              allValues.push(...validValues);
            }
          }
        }
      }

      // Calculate statistics
      const mean_q =
        allValues.length > 0
          ? allValues.reduce((a, b) => a + b, 0) / allValues.length
          : 0;
      const std_q =
        allValues.length > 1
          ? Math.sqrt(
              allValues.reduce((sum, v) => sum + Math.pow(v - mean_q, 2), 0) /
                (allValues.length - 1),
            )
          : 0;

      variantResults.push({
        variant_id: variant.variant_id,
        variant_name: variant.variant_name || variant.variant_id,
        mean_q,
        std_q,
        min_q: allValues.length > 0 ? Math.min(...allValues) : 0,
        max_q: allValues.length > 0 ? Math.max(...allValues) : 0,
        channel_means: channelMeans,
      });
    }
  }

  return {
    parameterValues,
    variantResults,
    duration_ms,
  };
}

/**
 * Calculate sensitivity summary for a parameter
 */
function calculateSensitivitySummary(
  parameter: SweepParameter,
  results: SensitivityResult[],
): SensitivitySummary {
  // Filter results that have this parameter varied
  const relevantResults = results.filter(
    (r) => r.parameterValues[parameter] !== undefined,
  );

  if (relevantResults.length < 2) {
    return {
      parameter,
      sensitivity_score: 0,
      correlation: 0,
      optimal_value: relevantResults[0]?.parameterValues[parameter] || 0,
      result_variance: 0,
    };
  }

  // Get parameter values and corresponding mean Q values, filtering out undefined
  const dataPoints = relevantResults
    .map((r) => ({
      paramValue: r.parameterValues[parameter],
      meanQ:
        r.variantResults.length > 0
          ? r.variantResults.reduce((sum, v) => sum + v.mean_q, 0) /
            r.variantResults.length
          : 0,
    }))
    .filter(
      (d): d is { paramValue: number; meanQ: number } =>
        d.paramValue !== undefined,
    );

  if (dataPoints.length === 0) {
    return {
      parameter,
      sensitivity_score: 0,
      correlation: 0,
      optimal_value: 0,
      result_variance: 0,
    };
  }

  // Calculate mean of parameter values and mean Q
  const meanParam =
    dataPoints.reduce((sum, d) => sum + d.paramValue, 0) / dataPoints.length;
  const meanQ =
    dataPoints.reduce((sum, d) => sum + d.meanQ, 0) / dataPoints.length;

  // Calculate correlation coefficient
  let numerator = 0;
  let denomParam = 0;
  let denomQ = 0;

  for (const point of dataPoints) {
    const diffParam = point.paramValue - meanParam;
    const diffQ = point.meanQ - meanQ;
    numerator += diffParam * diffQ;
    denomParam += diffParam * diffParam;
    denomQ += diffQ * diffQ;
  }

  const correlation =
    denomParam > 0 && denomQ > 0
      ? numerator / Math.sqrt(denomParam * denomQ)
      : 0;

  // Calculate variance in results
  const variance =
    dataPoints.length > 1
      ? dataPoints.reduce((sum, d) => sum + Math.pow(d.meanQ - meanQ, 2), 0) /
        (dataPoints.length - 1)
      : 0;

  // Sensitivity score: combination of correlation strength and variance
  const sensitivity_score = Math.abs(correlation) * Math.sqrt(variance);

  // Find optimal value (highest mean Q)
  const optimalPoint = dataPoints.reduce((best, current) =>
    current.meanQ > best.meanQ ? current : best,
  );

  return {
    parameter,
    sensitivity_score,
    correlation,
    optimal_value: optimalPoint.paramValue,
    result_variance: variance,
  };
}

/**
 * Generate sensitivity report from analysis
 */
export function generateSensitivityReport(
  analysis: SensitivityAnalysis,
): SensitivityReport {
  const sweepParameters = analysis.config.sweepParameters.map(
    (p) => p.parameter,
  );

  // Calculate sensitivity for each parameter
  const parameter_rankings = sweepParameters
    .map((param) => calculateSensitivitySummary(param, analysis.results))
    .sort((a, b) => b.sensitivity_score - a.sensitivity_score);

  // Generate recommendations
  const recommendations = parameter_rankings.map((summary) => {
    let reason = "";
    if (Math.abs(summary.correlation) > 0.7) {
      reason =
        summary.correlation > 0
          ? `Higher values tend to improve results`
          : `Lower values tend to improve results`;
    } else if (summary.result_variance < 0.01) {
      reason = `Results are stable across this parameter range`;
    } else {
      reason = `Moderate sensitivity - value chosen for balance`;
    }

    return {
      parameter: summary.parameter,
      recommended_value: summary.optimal_value,
      reason,
    };
  });

  // Assess stability
  const highSensitivityParams = parameter_rankings.filter(
    (p) => p.sensitivity_score > 0.5,
  );
  const avgVariance =
    parameter_rankings.reduce((sum, p) => sum + p.result_variance, 0) /
    parameter_rankings.length;

  return {
    analysis_id: analysis.id,
    parameter_rankings,
    recommendations,
    stability: {
      is_stable: highSensitivityParams.length === 0 && avgVariance < 0.1,
      stability_score: 1 / (1 + avgVariance),
      unstable_parameters: highSensitivityParams.map((p) => p.parameter),
    },
  };
}

/**
 * Run sensitivity analysis
 */
export async function runSensitivityAnalysis(
  apiService: ApiService,
  config: SensitivityConfig,
  onProgress?: ProgressCallback,
): Promise<SensitivityAnalysis> {
  const analysisId = `sensitivity_${Date.now()}`;
  const combinations = generateParameterCombinations(config.sweepParameters);

  const analysis: SensitivityAnalysis = {
    id: analysisId,
    config,
    status: "running",
    progress: {
      total: combinations.length,
      completed: 0,
      failed: 0,
    },
    results: [],
    created_at: new Date().toISOString(),
  };

  onProgress?.(analysis);

  const maxConcurrent = config.maxConcurrent || 2;

  // Process combinations in batches
  for (let i = 0; i < combinations.length; i += maxConcurrent) {
    const batch = combinations.slice(i, i + maxConcurrent);

    const batchPromises = batch.map(async (paramValues) => {
      const startTime = performance.now();

      // Build DDA request with modified parameters
      // Note: UI uses "delay_*" but API expects "scale_*" for these parameters
      const request: DDAAnalysisRequest = {
        file_path: config.baseConfig.file_path,
        channels: config.baseConfig.channels,
        start_time: config.baseConfig.start_time,
        end_time: config.baseConfig.end_time,
        variants: config.baseConfig.variants,
        window_length:
          paramValues.window_length ?? config.baseConfig.window_length,
        window_step: paramValues.window_step ?? config.baseConfig.window_step,
        scale_min: paramValues.delay_min ?? config.baseConfig.delay_min,
        scale_max: paramValues.delay_max ?? config.baseConfig.delay_max,
        scale_num: paramValues.delay_num ?? config.baseConfig.delay_num,
      };

      try {
        const result = await apiService.submitDDAAnalysis(request);
        const duration_ms = performance.now() - startTime;

        return extractResultSummary(result, paramValues, duration_ms);
      } catch (error) {
        const duration_ms = performance.now() - startTime;
        return {
          parameterValues: paramValues,
          variantResults: [],
          duration_ms,
          error: error instanceof Error ? error.message : "Unknown error",
        } as SensitivityResult;
      }
    });

    const batchResults = await Promise.all(batchPromises);

    for (const result of batchResults) {
      analysis.results.push(result);
      if (result.error) {
        analysis.progress.failed++;
      } else {
        analysis.progress.completed++;
      }
    }

    onProgress?.({ ...analysis });
  }

  analysis.status =
    analysis.progress.failed === analysis.progress.total
      ? "failed"
      : "completed";
  analysis.completed_at = new Date().toISOString();

  onProgress?.(analysis);

  return analysis;
}

/**
 * Cancel a running sensitivity analysis
 */
let cancellationTokens = new Map<string, boolean>();

export function cancelSensitivityAnalysis(analysisId: string): void {
  cancellationTokens.set(analysisId, true);
}

export function isCancelled(analysisId: string): boolean {
  return cancellationTokens.get(analysisId) ?? false;
}

export function clearCancellation(analysisId: string): void {
  cancellationTokens.delete(analysisId);
}
