import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ChannelSelector } from "@/components/ChannelSelector";
import {
  ChevronDown,
  Play,
  Square,
  Trash2,
  Settings2,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ICAConfig {
  nComponents: number | undefined;
  maxIterations: number;
  tolerance: number;
  centering: boolean;
  whitening: boolean;
}

interface ICAConfigPanelProps {
  /** Available channels from the file */
  availableChannels: string[];
  /** Currently selected channel names */
  selectedChannels: string[];
  /** Callback when channel selection changes */
  onChannelSelectionChange: (channels: string[]) => void;
  /** Current ICA parameters */
  config: ICAConfig;
  /** Callback when parameters change */
  onConfigChange: (config: Partial<ICAConfig>) => void;
  /** Whether analysis is currently running */
  isRunning: boolean;
  /** Callback to run analysis */
  onRunAnalysis: () => void;
  /** Callback to cancel analysis */
  onCancel: () => void;
  /** Number of marked components to remove */
  markedCount?: number;
  /** Callback to reconstruct without marked components */
  onReconstruct?: () => void;
  /** Whether reconstruction is running */
  isReconstructing?: boolean;
  /** Whether the panel is disabled (no file selected) */
  disabled?: boolean;
  /** Error message to display */
  error?: string | null;
  /** File name being analyzed */
  fileName?: string;
}

const CHANNEL_WARNINGS = {
  high: 64,
  medium: 32,
} as const;

export function ICAConfigPanel({
  availableChannels,
  selectedChannels,
  onChannelSelectionChange,
  config,
  onConfigChange,
  isRunning,
  onRunAnalysis,
  onCancel,
  markedCount = 0,
  onReconstruct,
  isReconstructing = false,
  disabled = false,
  error,
  fileName,
}: ICAConfigPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const selectedCount = selectedChannels.length;

  // Warning message for channel count
  const channelWarning = useMemo(() => {
    if (selectedCount > CHANNEL_WARNINGS.high) {
      return {
        level: "warning" as const,
        message: `${selectedCount} channels selected. Analysis may take several minutes.`,
      };
    }
    if (selectedCount > CHANNEL_WARNINGS.medium) {
      return {
        level: "info" as const,
        message: `${selectedCount} channels selected. Analysis may take 1-2 minutes.`,
      };
    }
    return null;
  }, [selectedCount]);

  // Validation
  const canRun = !disabled && !isRunning && selectedCount >= 2;
  const canReconstruct = markedCount > 0 && !isRunning && !isReconstructing;

  return (
    <div className="p-4 border-b space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">ICA Analysis</h2>
          <p className="text-sm text-muted-foreground">
            Decompose signals into independent components for artifact removal
          </p>
        </div>
        {fileName && (
          <span className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded">
            {fileName}
          </span>
        )}
      </div>

      {/* Channel Selection */}
      {availableChannels.length > 0 && (
        <div className="space-y-2">
          <ChannelSelector
            channels={availableChannels}
            selectedChannels={selectedChannels}
            onSelectionChange={onChannelSelectionChange}
            disabled={isRunning}
            label="Channels for ICA"
            description="Select channels to include in ICA decomposition"
            maxHeight="max-h-32"
            variant="compact"
          />

          {channelWarning && (
            <div
              className={cn(
                "flex items-center gap-2 text-xs p-2 rounded",
                channelWarning.level === "warning"
                  ? "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950"
                  : "text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-950",
              )}
              role="alert"
            >
              <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              {channelWarning.message}
            </div>
          )}
        </div>
      )}

      {/* Quick Settings */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Label htmlFor="n-components" className="text-sm font-medium">
            Number of Components
          </Label>
          <Input
            id="n-components"
            type="number"
            className="mt-1"
            placeholder={`Auto (max ${selectedCount})`}
            value={config.nComponents ?? ""}
            onChange={(e) =>
              onConfigChange({
                nComponents: e.target.value
                  ? parseInt(e.target.value)
                  : undefined,
              })
            }
            min={2}
            max={selectedCount || 64}
            disabled={isRunning}
          />
          <span className="text-xs text-muted-foreground">
            Leave empty for automatic detection
          </span>
        </div>
      </div>

      {/* Advanced Settings */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          Advanced Settings
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              showAdvanced && "rotate-180",
            )}
            aria-hidden="true"
          />
        </Button>
        {showAdvanced && (
          <div className="pt-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-muted/30 rounded-lg">
              <div>
                <Label htmlFor="max-iterations" className="text-sm">
                  Max Iterations
                </Label>
                <Input
                  id="max-iterations"
                  type="number"
                  className="mt-1"
                  value={config.maxIterations}
                  onChange={(e) =>
                    onConfigChange({
                      maxIterations: parseInt(e.target.value) || 200,
                    })
                  }
                  min={10}
                  max={1000}
                  disabled={isRunning}
                />
              </div>

              <div>
                <Label htmlFor="tolerance" className="text-sm">
                  Tolerance
                </Label>
                <Input
                  id="tolerance"
                  type="number"
                  className="mt-1"
                  value={config.tolerance}
                  onChange={(e) =>
                    onConfigChange({
                      tolerance: parseFloat(e.target.value) || 0.0001,
                    })
                  }
                  step={0.0001}
                  min={0.00001}
                  max={0.1}
                  disabled={isRunning}
                />
              </div>

              <div className="flex items-center space-x-2 pt-6">
                <Checkbox
                  id="centering"
                  checked={config.centering}
                  onCheckedChange={(checked) =>
                    onConfigChange({ centering: checked === true })
                  }
                  disabled={isRunning}
                />
                <Label htmlFor="centering" className="text-sm cursor-pointer">
                  Centering
                </Label>
              </div>

              <div className="flex items-center space-x-2 pt-6">
                <Checkbox
                  id="whitening"
                  checked={config.whitening}
                  onCheckedChange={(checked) =>
                    onConfigChange({ whitening: checked === true })
                  }
                  disabled={isRunning}
                />
                <Label htmlFor="whitening" className="text-sm cursor-pointer">
                  Whitening
                </Label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          id="ica-run-button"
          onClick={onRunAnalysis}
          disabled={!canRun}
          isLoading={isRunning}
          loadingText={`Running ICA on ${selectedCount} channels...`}
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          Run ICA ({selectedCount} channels)
        </Button>

        {isRunning && (
          <Button variant="destructive" onClick={onCancel}>
            <Square className="h-4 w-4" aria-hidden="true" />
            Cancel
          </Button>
        )}

        {canReconstruct && onReconstruct && (
          <Button
            variant="secondary"
            onClick={onReconstruct}
            isLoading={isReconstructing}
            loadingText="Reconstructing..."
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Remove {markedCount} Component{markedCount !== 1 ? "s" : ""}
          </Button>
        )}
      </div>

      {/* Validation Messages */}
      {selectedCount < 2 && !disabled && (
        <div
          className="text-sm text-yellow-600 dark:text-yellow-400"
          role="alert"
        >
          Select at least 2 channels to run ICA
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400" role="alert">
          Error: {error}
        </div>
      )}

      {/* Running Status */}
      {isRunning && (
        <div className="text-sm text-muted-foreground">
          Processing {selectedCount} channels with FastICA algorithm...
          {selectedCount > 32 && " This may take a minute or more."}
        </div>
      )}
    </div>
  );
}
