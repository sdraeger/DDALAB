/**
 * BadChannelDetectionStep Component
 *
 * Configuration UI for bad channel detection step
 */

import React from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { BadChannelMethod } from "@/types/preprocessing";

interface BadChannelDetectionStepProps {
  pipelineId: string;
}

const METHOD_OPTIONS: {
  value: BadChannelMethod;
  label: string;
  description: string;
}[] = [
  {
    value: "variance",
    label: "Variance",
    description: "High variance threshold",
  },
  {
    value: "correlation",
    label: "Correlation",
    description: "Low neighbor correlation",
  },
  {
    value: "flat",
    label: "Flat Signal",
    description: "Constant/flatline detection",
  },
  {
    value: "noise",
    label: "Noise",
    description: "High-frequency noise detection",
  },
  {
    value: "combined",
    label: "Combined",
    description: "Multiple methods (recommended)",
  },
];

export function BadChannelDetectionStep({
  pipelineId,
}: BadChannelDetectionStepProps) {
  const pipeline = useAppStore(
    useShallow((state) => state.preprocessing.pipelines[pipelineId]),
  );
  const updateBadChannelConfig = useAppStore(
    (state) => state.updateBadChannelConfig,
  );
  const addManualBadChannel = useAppStore((state) => state.addManualBadChannel);
  const removeManualBadChannel = useAppStore(
    (state) => state.removeManualBadChannel,
  );
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);

  if (!pipeline) return null;

  const config = pipeline.steps.badChannelDetection.config;
  const result = pipeline.steps.badChannelDetection.result;

  const handleConfigChange = (updates: Partial<typeof config>) => {
    updateBadChannelConfig(pipelineId, updates);
  };

  const toggleManualChannel = (channel: string) => {
    if (config.manualBadChannels.includes(channel)) {
      removeManualBadChannel(pipelineId, channel);
    } else {
      addManualBadChannel(pipelineId, channel);
    }
  };

  return (
    <div className="space-y-6">
      {/* Detection Method */}
      <div className="space-y-2">
        <Label>Detection Method</Label>
        <Select
          value={config.method}
          onValueChange={(value) =>
            handleConfigChange({ method: value as BadChannelMethod })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHOD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <div className="flex flex-col">
                  <span>{option.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Threshold Parameters */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Variance Threshold (SD)</Label>
          <Input
            type="number"
            value={config.varianceThreshold}
            onChange={(e) =>
              handleConfigChange({
                varianceThreshold: parseFloat(e.target.value),
              })
            }
            step={0.1}
            min={1}
            max={10}
          />
          <p className="text-xs text-muted-foreground">
            Channels exceeding this many standard deviations are flagged
          </p>
        </div>

        <div className="space-y-2">
          <Label>Correlation Threshold</Label>
          <Input
            type="number"
            value={config.correlationThreshold}
            onChange={(e) =>
              handleConfigChange({
                correlationThreshold: parseFloat(e.target.value),
              })
            }
            step={0.05}
            min={0}
            max={1}
          />
          <p className="text-xs text-muted-foreground">
            Minimum correlation with neighboring channels
          </p>
        </div>

        <div className="space-y-2">
          <Label>Flat Signal Threshold</Label>
          <Input
            type="number"
            value={config.flatThreshold}
            onChange={(e) =>
              handleConfigChange({ flatThreshold: parseFloat(e.target.value) })
            }
            step={1e-7}
            min={0}
          />
          <p className="text-xs text-muted-foreground">
            Variance below this indicates flatline
          </p>
        </div>

        <div className="space-y-2">
          <Label>Noise Threshold</Label>
          <Input
            type="number"
            value={config.noiseThreshold}
            onChange={(e) =>
              handleConfigChange({ noiseThreshold: parseFloat(e.target.value) })
            }
            step={0.05}
            min={0}
            max={1}
          />
          <p className="text-xs text-muted-foreground">
            High-frequency power ratio threshold
          </p>
        </div>
      </div>

      {/* Auto-detect Toggle */}
      <div className="flex items-center gap-3">
        <Switch
          id="auto-detect"
          checked={config.autoDetect}
          onCheckedChange={(checked) =>
            handleConfigChange({ autoDetect: checked })
          }
        />
        <Label htmlFor="auto-detect">Auto-detect bad channels</Label>
      </div>

      {/* Manual Bad Channel Selection */}
      {selectedFile && (
        <div className="space-y-2">
          <Label>Manual Bad Channels</Label>
          <div className="flex flex-wrap gap-1.5 p-3 border rounded-md max-h-32 overflow-y-auto">
            {selectedFile.channels.map((channel) => {
              const isManualBad = config.manualBadChannels.includes(channel);
              const isDetectedBad =
                result?.detectedBadChannels?.includes(channel);

              return (
                <Badge
                  key={channel}
                  variant={
                    isManualBad
                      ? "destructive"
                      : isDetectedBad
                        ? "secondary"
                        : "outline"
                  }
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => toggleManualChannel(channel)}
                  title={
                    isManualBad
                      ? "Manually marked as bad (click to remove)"
                      : isDetectedBad
                        ? "Auto-detected as bad"
                        : "Click to mark as bad"
                  }
                >
                  {channel}
                </Badge>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Click channels to manually mark/unmark as bad. Red = manually
            marked, gray = auto-detected.
          </p>
        </div>
      )}

      {/* Results Summary */}
      {result && (
        <div className="p-3 bg-muted rounded-md space-y-2">
          <h4 className="font-medium text-sm">Detection Results</h4>
          <div className="text-sm">
            <span className="text-muted-foreground">Detected: </span>
            <span className="font-medium">
              {result.detectedBadChannels.length}
            </span>{" "}
            bad channels
          </div>
          {result.detectedBadChannels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {result.detectedBadChannels.map((ch) => (
                <Badge key={ch} variant="secondary">
                  {ch}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
