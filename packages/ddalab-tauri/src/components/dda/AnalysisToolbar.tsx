/**
 * AnalysisToolbar Component
 *
 * Toolbar for DDA analysis configuration with run/import/export actions.
 * Extracted from DDAAnalysis.tsx to reduce component complexity.
 */

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Play,
  Cpu,
  Cloud,
  Server,
  Upload,
  Download,
  TrendingUp,
} from "lucide-react";
import { TauriService } from "@/services/tauriService";

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
  onImport: () => void;
  onExport: () => void;
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
  onImport,
  onExport,
  onSensitivity,
  onReset,
}: AnalysisToolbarProps) {
  const hasValidConfig = hasValidChannelConfig(variants, variantChannelConfigs);
  const isTauri = TauriService.isTauri();

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
        <Button
          variant="outline"
          size="sm"
          onClick={onImport}
          disabled={isRunning}
        >
          <Upload className="h-4 w-4 mr-1" />
          Import
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={isRunning}
        >
          <Download className="h-4 w-4 mr-1" />
          Export
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onSensitivity}
          disabled={isRunning || !hasSelectedFile}
          title="Analyze how results change with different parameters"
        >
          <TrendingUp className="h-4 w-4 mr-1" />
          Sensitivity
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          disabled={isRunning}
          title="Reset all parameters to defaults"
        >
          Reset
        </Button>
        <Button
          onClick={onRun}
          disabled={isRunning || !hasValidConfig}
          className="min-w-[120px]"
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
        </Button>
        {isTauri && (
          <Button
            onClick={onSubmitToServer}
            disabled={
              isRunning ||
              isSubmittingToServer ||
              !isServerConnected ||
              !hasValidConfig
            }
            variant="outline"
            className="min-w-[140px]"
            title={
              !isServerConnected
                ? "Connect to a remote server in Settings → Sync"
                : "Submit analysis to remote server"
            }
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
          </Button>
        )}
        {isTauri && (
          <Button
            onClick={onSubmitToNsg}
            disabled={
              isRunning ||
              isSubmittingToNsg ||
              !hasNsgCredentials ||
              !hasValidConfig
            }
            variant="outline"
            className="min-w-[140px]"
            title={
              !hasNsgCredentials
                ? "Configure NSG credentials in Settings"
                : "Submit to Neuroscience Gateway"
            }
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
          </Button>
        )}
      </div>
    </div>
  );
});
