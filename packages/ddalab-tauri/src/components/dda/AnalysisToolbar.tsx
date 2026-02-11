/**
 * AnalysisToolbar Component
 *
 * Toolbar for DDA analysis configuration with run/import/export actions.
 * Extracted from DDAAnalysis.tsx to reduce component complexity.
 */

import { memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Cpu, Cloud, Server, TrendingUp } from "lucide-react";
import { TauriService } from "@/services/tauriService";
import { TooltipButton } from "@/components/ui/tooltip-button";

interface VariantChannelConfig {
  selectedChannels?: string[];
  ctChannelPairs?: [string, string][];
  cdChannelPairs?: [string, string][];
}

interface AnalysisToolbarProps {
  analysisName: string;
  onAnalysisNameChange: (name: string) => void;
  isRunning: boolean;
  isSubmittingToServer: boolean;
  isSubmittingToNsg: boolean;
  isServerConnected: boolean;
  hasNsgCredentials: boolean;
  hasSelectedFile: boolean;
  variants: string[];
  variantChannelConfigs: Record<string, VariantChannelConfig>;
  onRun: () => void;
  onSubmitToServer: () => void;
  onSubmitToNsg: () => void;
  onSensitivity: () => void;
  onReset: () => void;
}

function hasValidChannelConfig(
  variants: string[],
  configs: Record<string, VariantChannelConfig>,
): boolean {
  return variants.some((variantId) => {
    const config = configs[variantId];
    return (
      config &&
      ((config.selectedChannels && config.selectedChannels.length > 0) ||
        (config.ctChannelPairs && config.ctChannelPairs.length > 0) ||
        (config.cdChannelPairs && config.cdChannelPairs.length > 0))
    );
  });
}

export const AnalysisToolbar = memo(function AnalysisToolbar({
  analysisName,
  onAnalysisNameChange,
  isRunning,
  isSubmittingToServer,
  isSubmittingToNsg,
  isServerConnected,
  hasNsgCredentials,
  hasSelectedFile,
  variants,
  variantChannelConfigs,
  onRun,
  onSubmitToServer,
  onSubmitToNsg,
  onSensitivity,
  onReset,
}: AnalysisToolbarProps) {
  const hasValidConfig = hasValidChannelConfig(variants, variantChannelConfigs);
  const isTauri = TauriService.isTauri();

  // Compute tooltip reasons for disabled buttons
  const runTooltip = useMemo(() => {
    if (isRunning) return "Analysis is currently running";
    if (!hasValidConfig) return "Configure channels for at least one variant";
    return "Run DDA analysis locally";
  }, [isRunning, hasValidConfig]);

  const sensitivityTooltip = useMemo(() => {
    if (isRunning) return "Analysis is currently running";
    if (!hasSelectedFile) return "Select a file first";
    return "Analyze how DDA results change with different parameters";
  }, [isRunning, hasSelectedFile]);

  const serverTooltip = useMemo(() => {
    if (isRunning) return "Analysis is currently running";
    if (isSubmittingToServer) return "Submitting to server...";
    if (!isServerConnected)
      return "Connect to a remote server in Settings → Sync";
    if (!hasValidConfig) return "Configure channels for at least one variant";
    return "Submit analysis to remote server for processing";
  }, [isRunning, isSubmittingToServer, isServerConnected, hasValidConfig]);

  const nsgTooltip = useMemo(() => {
    if (isRunning) return "Analysis is currently running";
    if (isSubmittingToNsg) return "Submitting to NSG...";
    if (!hasNsgCredentials) return "Configure NSG credentials in Settings";
    if (!hasValidConfig) return "Configure channels for at least one variant";
    return "Submit analysis to Neuroscience Gateway for HPC processing";
  }, [isRunning, isSubmittingToNsg, hasNsgCredentials, hasValidConfig]);

  return (
    <div className="flex items-center justify-end flex-shrink-0 pb-4">
      <div className="flex items-center space-x-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor="analysis-name"
            className="text-sm font-medium text-muted-foreground whitespace-nowrap"
          >
            Name:
          </label>
          <div className="relative">
            <Input
              id="analysis-name"
              placeholder="Enter analysis name"
              value={analysisName}
              onChange={(e) => onAnalysisNameChange(e.target.value)}
              disabled={isRunning}
              className="w-56 h-9 text-sm"
            />
          </div>
        </div>
        <TooltipButton
          variant="outline"
          size="sm"
          onClick={onSensitivity}
          disabled={isRunning || !hasSelectedFile}
          tooltip={sensitivityTooltip}
        >
          <TrendingUp className="h-4 w-4 mr-1" />
          Sensitivity
        </TooltipButton>
        <TooltipButton
          variant="outline"
          size="sm"
          onClick={onReset}
          disabled={isRunning}
          tooltip={
            isRunning
              ? "Analysis is currently running"
              : "Reset all parameters to defaults"
          }
        >
          Reset
        </TooltipButton>
        <TooltipButton
          onClick={onRun}
          disabled={isRunning || !hasValidConfig}
          className="min-w-[120px]"
          tooltip={runTooltip}
        >
          {isRunning ? (
            <>
              <Cpu className="h-4 w-4 mr-2 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Run DDA
            </>
          )}
        </TooltipButton>
        {isTauri && (
          <TooltipButton
            onClick={onSubmitToServer}
            disabled={
              isRunning ||
              isSubmittingToServer ||
              !isServerConnected ||
              !hasValidConfig
            }
            variant="outline"
            className="min-w-[140px]"
            tooltip={serverTooltip}
          >
            {isSubmittingToServer ? (
              <>
                <Server className="h-4 w-4 mr-2 animate-pulse" />
                Submitting...
              </>
            ) : (
              <>
                <Server className="h-4 w-4 mr-2" />
                Submit to Server
              </>
            )}
          </TooltipButton>
        )}
        {isTauri && (
          <TooltipButton
            onClick={onSubmitToNsg}
            disabled={
              isRunning ||
              isSubmittingToNsg ||
              !hasNsgCredentials ||
              !hasValidConfig
            }
            variant="outline"
            className="min-w-[140px]"
            tooltip={nsgTooltip}
          >
            {isSubmittingToNsg ? (
              <>
                <Cloud className="h-4 w-4 mr-2 animate-pulse" />
                Submitting...
              </>
            ) : (
              <>
                <Cloud className="h-4 w-4 mr-2" />
                Submit to NSG
              </>
            )}
          </TooltipButton>
        )}
      </div>
    </div>
  );
});
