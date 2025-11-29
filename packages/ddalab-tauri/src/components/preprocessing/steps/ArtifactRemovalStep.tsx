/**
 * ArtifactRemovalStep Component
 *
 * Configuration UI for artifact detection and removal step
 */

import React from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ArtifactType,
  ArtifactAction,
  ArtifactDetectionConfig,
} from "@/types/preprocessing";
import {
  AlertTriangle,
  TrendingUp,
  Minus,
  Eye,
  Zap,
  Activity,
} from "lucide-react";

interface ArtifactRemovalStepProps {
  pipelineId: string;
}

const ARTIFACT_TYPES: {
  value: ArtifactType;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "threshold",
    label: "Amplitude Threshold",
    description: "Detect samples exceeding amplitude limit",
    icon: <TrendingUp className="h-4 w-4" />,
  },
  {
    value: "gradient",
    label: "Gradient",
    description: "Detect rapid signal changes",
    icon: <Activity className="h-4 w-4" />,
  },
  {
    value: "muscle",
    label: "Muscle",
    description: "High-frequency muscle artifact",
    icon: <Zap className="h-4 w-4" />,
  },
  {
    value: "eye_blink",
    label: "Eye Blink",
    description: "Blink artifacts in frontal channels",
    icon: <Eye className="h-4 w-4" />,
  },
  {
    value: "jump",
    label: "Jump/Discontinuity",
    description: "Signal jumps or discontinuities",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  {
    value: "flat",
    label: "Flat Signal",
    description: "Segments with no variation",
    icon: <Minus className="h-4 w-4" />,
  },
];

const ARTIFACT_ACTIONS: {
  value: ArtifactAction;
  label: string;
  description: string;
}[] = [
  {
    value: "mark",
    label: "Mark Only",
    description: "Mark artifacts without modification",
  },
  {
    value: "interpolate",
    label: "Interpolate",
    description: "Replace with interpolated values",
  },
  {
    value: "reject_epoch",
    label: "Reject Epoch",
    description: "Mark epochs containing artifacts",
  },
  { value: "zero", label: "Zero Out", description: "Replace with zeros" },
];

export function ArtifactRemovalStep({ pipelineId }: ArtifactRemovalStepProps) {
  const pipeline = useAppStore(
    useShallow((state) => state.preprocessing.pipelines[pipelineId]),
  );
  const updateArtifactRemovalConfig = useAppStore(
    (state) => state.updateArtifactRemovalConfig,
  );

  if (!pipeline) return null;

  const config = pipeline.steps.artifactRemoval.config;
  const result = pipeline.steps.artifactRemoval.result;

  const handleConfigChange = (updates: Partial<typeof config>) => {
    updateArtifactRemovalConfig(pipelineId, updates);
  };

  const handleDetectorChange = (
    index: number,
    updates: Partial<ArtifactDetectionConfig>,
  ) => {
    const newDetectors = [...config.detectors];
    newDetectors[index] = { ...newDetectors[index], ...updates };
    handleConfigChange({ detectors: newDetectors });
  };

  const handleDetectorToggle = (type: ArtifactType) => {
    const existingIndex = config.detectors.findIndex((d) => d.type === type);
    if (existingIndex >= 0) {
      handleDetectorChange(existingIndex, {
        enabled: !config.detectors[existingIndex].enabled,
      });
    } else {
      // Add new detector
      const newDetector: ArtifactDetectionConfig = {
        type,
        enabled: true,
        threshold: getDefaultThreshold(type),
        windowSize: 256,
      };
      handleConfigChange({ detectors: [...config.detectors, newDetector] });
    }
  };

  const getDefaultThreshold = (type: ArtifactType): number => {
    switch (type) {
      case "threshold":
        return 100;
      case "gradient":
        return 50;
      case "muscle":
        return 4;
      case "eye_blink":
        return 80;
      case "jump":
        return 30;
      case "flat":
        return 1e-6;
      default:
        return 10;
    }
  };

  const getDetector = (type: ArtifactType) => {
    return config.detectors.find((d) => d.type === type);
  };

  return (
    <div className="space-y-6">
      {/* Artifact Action */}
      <div className="space-y-2">
        <Label>Artifact Handling</Label>
        <Select
          value={config.action}
          onValueChange={(value) =>
            handleConfigChange({ action: value as ArtifactAction })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ARTIFACT_ACTIONS.map((option) => (
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

      {/* Interpolation Method (if applicable) */}
      {config.action === "interpolate" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Interpolation Method</Label>
            <Select
              value={config.interpolationMethod ?? "spline"}
              onValueChange={(value) =>
                handleConfigChange({
                  interpolationMethod: value as
                    | "linear"
                    | "spline"
                    | "neighbor",
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="linear">Linear</SelectItem>
                <SelectItem value="spline">Spline (recommended)</SelectItem>
                <SelectItem value="neighbor">Nearest Neighbor</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Epoch Padding (samples)</Label>
            <Input
              type="number"
              value={config.epochPadding}
              onChange={(e) =>
                handleConfigChange({ epochPadding: parseInt(e.target.value) })
              }
              min={0}
              max={500}
            />
            <p className="text-xs text-muted-foreground">
              Samples to include before/after artifact
            </p>
          </div>
        </div>
      )}

      {/* Artifact Detectors */}
      <div className="space-y-3">
        <Label>Artifact Detectors</Label>
        <div className="space-y-2">
          {ARTIFACT_TYPES.map((artifactType) => {
            const detector = getDetector(artifactType.value);
            const isEnabled = detector?.enabled ?? false;

            return (
              <div
                key={artifactType.value}
                className="border rounded-md p-3 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {artifactType.icon}
                    <div>
                      <span className="font-medium text-sm">
                        {artifactType.label}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {artifactType.description}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={() =>
                      handleDetectorToggle(artifactType.value)
                    }
                  />
                </div>

                {isEnabled && detector && (
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                    <div className="space-y-1">
                      <Label className="text-xs">Threshold</Label>
                      <Input
                        type="number"
                        value={detector.threshold}
                        onChange={(e) => {
                          const idx = config.detectors.findIndex(
                            (d) => d.type === artifactType.value,
                          );
                          if (idx >= 0) {
                            handleDetectorChange(idx, {
                              threshold: parseFloat(e.target.value),
                            });
                          }
                        }}
                        step={artifactType.value === "flat" ? 1e-7 : 1}
                        className="h-8"
                      />
                    </div>
                    {artifactType.value !== "flat" && (
                      <div className="space-y-1">
                        <Label className="text-xs">Window Size</Label>
                        <Input
                          type="number"
                          value={detector.windowSize ?? 256}
                          onChange={(e) => {
                            const idx = config.detectors.findIndex(
                              (d) => d.type === artifactType.value,
                            );
                            if (idx >= 0) {
                              handleDetectorChange(idx, {
                                windowSize: parseInt(e.target.value),
                              });
                            }
                          }}
                          min={10}
                          max={1000}
                          className="h-8"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Results Summary */}
      {result && (
        <div className="space-y-3 p-3 bg-muted rounded-md">
          <h4 className="font-medium text-sm">Detection Results</h4>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Clean Data</span>
              <span className="font-medium">
                {result.percentClean.toFixed(1)}%
              </span>
            </div>
            <Progress value={result.percentClean} className="h-2" />
          </div>

          <div className="text-sm">
            <span className="text-muted-foreground">Total artifacts: </span>
            <span className="font-medium">
              {result.detectedArtifacts.length}
            </span>
          </div>

          {Object.entries(result.channelArtifactCounts).length > 0 && (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Artifacts by channel:
              </span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(result.channelArtifactCounts)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 10)
                  .map(([channel, count]) => (
                    <Badge
                      key={channel}
                      variant="secondary"
                      className="text-xs"
                    >
                      {channel}: {count}
                    </Badge>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="p-3 bg-muted rounded-md text-sm space-y-1">
        <p className="font-medium">About Artifact Removal</p>
        <p className="text-muted-foreground text-xs">
          This step detects and handles remaining artifacts after ICA. Different
          detection methods target specific artifact types. Interpolation
          preserves data continuity while removing contaminated segments.
        </p>
      </div>
    </div>
  );
}
