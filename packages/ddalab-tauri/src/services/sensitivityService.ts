/**
 * Sensitivity Analysis Service
 *
 * Runs multiple DDA analyses with explicit parameter sets to understand
 * how results change with different settings.
 */

import { ApiService } from "./apiService";
import {
  SensitivityConfig,
  SensitivityResult,
  SensitivityAnalysis,
  SensitivityReport,
  ParameterSet,
  ParameterComparison,
} from "@/types/sensitivity";
import { DDAAnalysisRequest } from "@/types/api";
import { computeChannelStats } from "./wasmService";

type ProgressCallback = (analysis: SensitivityAnalysis) => void;

/**
 * Extract summary statistics from DDA result using WASM for efficient computation
 */
function extractResultSummary(
  result: any,
  parameterSet: ParameterSet,
  duration_ms: number,
): SensitivityResult {
  const variantResults = [];

  if (result?.results?.variants) {
    for (const variant of result.results.variants) {
      const allValues: number[] = [];
      const channelMeans: Record<string, number> = {};

      // Extract Q matrix values and compute per-channel means using WASM
      if (variant.dda_matrix) {
        for (const [channel, values] of Object.entries(variant.dda_matrix)) {
          if (Array.isArray(values)) {
            const validValues = (values as number[]).filter(
              (v) => !isNaN(v) && isFinite(v),
            );
            if (validValues.length > 0) {
              // Use WASM for efficient per-channel statistics
              const channelStats = computeChannelStats(validValues);
              channelMeans[channel] = channelStats.mean;
              allValues.push(...validValues);
            }
          }
        }
      }

      // Use WASM for global statistics computation (much faster than reduce loops)
      if (allValues.length > 0) {
        const globalStats = computeChannelStats(allValues);
        variantResults.push({
          variant_id: variant.variant_id,
          variant_name: variant.variant_name || variant.variant_id,
          mean_q: globalStats.mean,
          std_q: globalStats.std,
          min_q: globalStats.min,
          max_q: globalStats.max,
          channel_means: channelMeans,
        });
      } else {
        variantResults.push({
          variant_id: variant.variant_id,
          variant_name: variant.variant_name || variant.variant_id,
          mean_q: 0,
          std_q: 0,
          min_q: 0,
          max_q: 0,
          channel_means: channelMeans,
        });
      }
    }
  }

  return {
    parameter_set_id: parameterSet.id,
    parameter_set_name: parameterSet.name,
    params: parameterSet.params,
    variantResults,
    duration_ms,
  };
}

/**
 * Generate sensitivity report from analysis results
 */
export function generateSensitivityReport(
  analysis: SensitivityAnalysis,
): SensitivityReport {
  const comparisons: ParameterComparison[] = analysis.results
    .filter((r) => !r.error)
    .map((r) => {
      const overallMeanQ =
        r.variantResults.length > 0
          ? r.variantResults.reduce((sum, v) => sum + v.mean_q, 0) /
            r.variantResults.length
          : 0;
      const overallStdQ =
        r.variantResults.length > 0
          ? r.variantResults.reduce((sum, v) => sum + v.std_q, 0) /
            r.variantResults.length
          : 0;

      return {
        parameter_set_id: r.parameter_set_id,
        parameter_set_name: r.parameter_set_name,
        params: r.params,
        mean_q: overallMeanQ,
        std_q: overallStdQ,
      };
    });

  // Find best performing parameter set (highest mean Q)
  const bestComparison = comparisons.reduce(
    (best, current) => (current.mean_q > best.mean_q ? current : best),
    comparisons[0],
  );

  const bestParams: ParameterSet | null = bestComparison
    ? {
        id: bestComparison.parameter_set_id,
        name: bestComparison.parameter_set_name,
        params: bestComparison.params,
      }
    : null;

  // Calculate overall statistics
  const allMeanQs = comparisons.map((c) => c.mean_q);
  const overallMeanQ =
    allMeanQs.length > 0
      ? allMeanQs.reduce((sum, v) => sum + v, 0) / allMeanQs.length
      : 0;
  const varianceAcrossSets =
    allMeanQs.length > 1
      ? allMeanQs.reduce((sum, v) => sum + Math.pow(v - overallMeanQ, 2), 0) /
        allMeanQs.length
      : 0;

  return {
    analysis_id: analysis.id,
    comparisons,
    best_params: bestParams,
    summary: {
      overall_mean_q: overallMeanQ,
      variance_across_sets: varianceAcrossSets,
      is_stable: varianceAcrossSets < 0.1,
    },
  };
}

/**
 * Run sensitivity analysis with explicit parameter sets
 */
export async function runSensitivityAnalysis(
  apiService: ApiService,
  config: SensitivityConfig,
  onProgress?: ProgressCallback,
): Promise<SensitivityAnalysis> {
  const analysisId = `sensitivity_${Date.now()}`;
  const parameterSets = config.parameterSets;

  const analysis: SensitivityAnalysis = {
    id: analysisId,
    config,
    status: "running",
    progress: {
      total: parameterSets.length,
      completed: 0,
      failed: 0,
    },
    results: [],
    created_at: new Date().toISOString(),
  };

  onProgress?.(analysis);

  // Check for cancellation
  if (isCancelled(analysisId)) {
    analysis.status = "cancelled";
    return analysis;
  }

  const maxConcurrent = config.maxConcurrent || 2;

  // Process parameter sets in batches
  for (let i = 0; i < parameterSets.length; i += maxConcurrent) {
    // Check for cancellation between batches
    if (isCancelled(analysisId)) {
      analysis.status = "cancelled";
      clearCancellation(analysisId);
      onProgress?.({ ...analysis });
      return analysis;
    }

    const batch = parameterSets.slice(i, i + maxConcurrent);

    const batchPromises = batch.map(async (parameterSet) => {
      const startTime = performance.now();

      // Build DDA request with parameter set values
      const request: DDAAnalysisRequest = {
        file_path: config.baseConfig.file_path,
        channels: config.baseConfig.channels,
        start_time: config.baseConfig.start_time,
        end_time: config.baseConfig.end_time,
        variants: config.baseConfig.variants,
        window_length: parameterSet.params.window_length,
        window_step: parameterSet.params.window_step,
        delay_list: parameterSet.params.delays,
      };

      try {
        const result = await apiService.submitDDAAnalysis(request);
        const duration_ms = performance.now() - startTime;

        return extractResultSummary(result, parameterSet, duration_ms);
      } catch (error) {
        const duration_ms = performance.now() - startTime;
        return {
          parameter_set_id: parameterSet.id,
          parameter_set_name: parameterSet.name,
          params: parameterSet.params,
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
  clearCancellation(analysisId);

  return analysis;
}

/**
 * Cancel a running sensitivity analysis
 */
const cancellationTokens = new Map<string, boolean>();

export function cancelSensitivityAnalysis(analysisId: string): void {
  cancellationTokens.set(analysisId, true);
}

export function isCancelled(analysisId: string): boolean {
  return cancellationTokens.get(analysisId) ?? false;
}

export function clearCancellation(analysisId: string): void {
  cancellationTokens.delete(analysisId);
}
