import { useMemo } from "react";
import { DDAParameters } from "@/components/analysis/AnalysisFormProvider";

export interface AnalysisEstimationBreakdown {
  channelCount: number;
  windowCount: number;
  variantCount: number;
  delayCount: number;
  totalOperations: number;
}

export interface AnalysisEstimation {
  estimatedTimeSeconds: number;
  estimatedTimeFormatted: string;
  breakdown: AnalysisEstimationBreakdown;
}

export function useAnalysisEstimation(
  parameters: DDAParameters,
): AnalysisEstimation {
  return useMemo(() => {
    const allChannels = new Set<string>();
    parameters.variants.forEach((variantId) => {
      const config = parameters.variantChannelConfigs[variantId];
      if (config) {
        if (config.selectedChannels) {
          config.selectedChannels.forEach((ch) => allChannels.add(ch));
        }
        if (config.ctChannelPairs) {
          config.ctChannelPairs.forEach(([ch1, ch2]) => {
            allChannels.add(ch1);
            allChannels.add(ch2);
          });
        }
        if (config.cdChannelPairs) {
          config.cdChannelPairs.forEach(([from, to]) => {
            allChannels.add(from);
            allChannels.add(to);
          });
        }
      }
    });

    const channelCount = allChannels.size;
    const timeRange = parameters.timeEnd - parameters.timeStart;
    const windowCount = Math.floor(timeRange / parameters.windowStep);
    const variantCount = parameters.variants.length;
    const delayCount = parameters.delays.length;

    const baseTime = 2;
    const perOperationTime = 0.01;
    const totalOperations =
      channelCount * windowCount * variantCount * delayCount;
    const estimatedTimeSeconds = Math.round(
      baseTime + totalOperations * perOperationTime,
    );

    const estimatedTimeFormatted =
      estimatedTimeSeconds < 60
        ? `${estimatedTimeSeconds}s`
        : `${Math.floor(estimatedTimeSeconds / 60)}m ${estimatedTimeSeconds % 60}s`;

    return {
      estimatedTimeSeconds,
      estimatedTimeFormatted,
      breakdown: {
        channelCount,
        windowCount,
        variantCount,
        delayCount,
        totalOperations,
      },
    };
  }, [
    parameters.variantChannelConfigs,
    parameters.timeEnd,
    parameters.timeStart,
    parameters.windowStep,
    parameters.variants,
    parameters.delays.length,
  ]);
}
