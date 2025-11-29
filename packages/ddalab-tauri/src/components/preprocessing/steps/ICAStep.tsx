/**
 * ICAStep Component
 *
 * Configuration UI for ICA decomposition step in preprocessing
 */

import React from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ICAAlgorithm, ICANonlinearity } from "@/types/preprocessing";
import { Eye, Brain, Heart, Activity, Zap, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ICAStepProps {
  pipelineId: string;
}

const ALGORITHM_OPTIONS: {
  value: ICAAlgorithm;
  label: string;
  description: string;
}[] = [
  {
    value: "fastica",
    label: "FastICA",
    description: "Fast, widely used (default)",
  },
  {
    value: "infomax",
    label: "Infomax",
    description: "Information maximization",
  },
  {
    value: "jade",
    label: "JADE",
    description: "Joint approximate diagonalization",
  },
  {
    value: "sobi",
    label: "SOBI",
    description: "Second-order blind identification",
  },
];

const NONLINEARITY_OPTIONS: { value: ICANonlinearity; label: string }[] = [
  { value: "logcosh", label: "Log-Cosh (recommended)" },
  { value: "exp", label: "Exponential" },
  { value: "cube", label: "Cubic" },
];

const COMPONENT_TYPES = [
  { type: "brain", label: "Brain", icon: Brain, color: "text-green-500" },
  { type: "eye_blink", label: "Eye Blink", icon: Eye, color: "text-blue-500" },
  {
    type: "eye_movement",
    label: "Eye Movement",
    icon: Eye,
    color: "text-cyan-500",
  },
  { type: "muscle", label: "Muscle", icon: Activity, color: "text-orange-500" },
  { type: "heartbeat", label: "Heart", icon: Heart, color: "text-red-500" },
  {
    type: "line_noise",
    label: "Line Noise",
    icon: Zap,
    color: "text-yellow-500",
  },
  {
    type: "unknown",
    label: "Unknown",
    icon: HelpCircle,
    color: "text-gray-500",
  },
] as const;

export function ICAStep({ pipelineId }: ICAStepProps) {
  const pipeline = useAppStore(
    useShallow((state) => state.preprocessing.pipelines[pipelineId]),
  );
  const updateICAConfig = useAppStore((state) => state.updateICAConfig);
  const toggleICAComponentRejection = useAppStore(
    (state) => state.toggleICAComponentRejection,
  );

  if (!pipeline) return null;

  const config = pipeline.steps.ica.config;
  const result = pipeline.steps.ica.result;
  const rejectedComponents = pipeline.steps.ica.rejectedComponents;

  const handleConfigChange = (updates: Partial<typeof config>) => {
    updateICAConfig(pipelineId, updates);
  };

  return (
    <div className="space-y-6">
      {/* Algorithm Selection */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Algorithm</Label>
          <Select
            value={config.algorithm}
            onValueChange={(value) =>
              handleConfigChange({ algorithm: value as ICAAlgorithm })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALGORITHM_OPTIONS.map((option) => (
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

        <div className="space-y-2">
          <Label>Nonlinearity (FastICA)</Label>
          <Select
            value={config.nonlinearity}
            onValueChange={(value) =>
              handleConfigChange({ nonlinearity: value as ICANonlinearity })
            }
            disabled={config.algorithm !== "fastica"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NONLINEARITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Algorithm Parameters */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Components</Label>
          <Input
            type="number"
            value={config.nComponents ?? ""}
            onChange={(e) =>
              handleConfigChange({
                nComponents: e.target.value
                  ? parseInt(e.target.value)
                  : undefined,
              })
            }
            placeholder="Auto"
            min={1}
          />
          <p className="text-xs text-muted-foreground">Leave empty for auto</p>
        </div>

        <div className="space-y-2">
          <Label>Max Iterations</Label>
          <Input
            type="number"
            value={config.maxIterations}
            onChange={(e) =>
              handleConfigChange({ maxIterations: parseInt(e.target.value) })
            }
            min={100}
            max={10000}
          />
        </div>

        <div className="space-y-2">
          <Label>Tolerance</Label>
          <Input
            type="number"
            value={config.tolerance}
            onChange={(e) =>
              handleConfigChange({ tolerance: parseFloat(e.target.value) })
            }
            step={0.0001}
            min={0.00001}
            max={0.1}
          />
        </div>
      </div>

      {/* Auto-classification */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id="auto-classify"
            checked={config.autoClassify}
            onCheckedChange={(checked) =>
              handleConfigChange({ autoClassify: checked })
            }
          />
          <Label htmlFor="auto-classify">Auto-classify components</Label>
        </div>

        {config.autoClassify && (
          <div className="pl-4 space-y-4 border-l-2 border-muted">
            <div className="space-y-2">
              <Label className="text-sm">Eye Blink Detection Threshold</Label>
              <div className="flex items-center gap-4">
                <Slider
                  value={[config.eyeBlinkThreshold ?? 0.8]}
                  onValueChange={([value]) =>
                    handleConfigChange({ eyeBlinkThreshold: value })
                  }
                  min={0.5}
                  max={1}
                  step={0.05}
                  className="flex-1"
                />
                <span className="text-sm w-12 text-right">
                  {((config.eyeBlinkThreshold ?? 0.8) * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">
                Muscle Artifact Detection Threshold
              </Label>
              <div className="flex items-center gap-4">
                <Slider
                  value={[config.muscleThreshold ?? 0.7]}
                  onValueChange={([value]) =>
                    handleConfigChange({ muscleThreshold: value })
                  }
                  min={0.5}
                  max={1}
                  step={0.05}
                  className="flex-1"
                />
                <span className="text-sm w-12 text-right">
                  {((config.muscleThreshold ?? 0.7) * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Heartbeat Detection Threshold</Label>
              <div className="flex items-center gap-4">
                <Slider
                  value={[config.heartbeatThreshold ?? 0.7]}
                  onValueChange={([value]) =>
                    handleConfigChange({ heartbeatThreshold: value })
                  }
                  min={0.5}
                  max={1}
                  step={0.05}
                  className="flex-1"
                />
                <span className="text-sm w-12 text-right">
                  {((config.heartbeatThreshold ?? 0.7) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Component Results */}
      {result && result.components.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Components ({result.components.length})</Label>
            <div className="text-sm text-muted-foreground">
              {rejectedComponents.length} marked for rejection
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto p-1">
            {result.components.map((component) => {
              const isRejected = rejectedComponents.includes(component.index);
              const typeInfo =
                COMPONENT_TYPES.find(
                  (t) => t.type === component.classification?.type,
                ) ?? COMPONENT_TYPES[COMPONENT_TYPES.length - 1];
              const TypeIcon = typeInfo.icon;

              return (
                <button
                  key={component.index}
                  onClick={() =>
                    toggleICAComponentRejection(pipelineId, component.index)
                  }
                  className={cn(
                    "p-2 rounded-md border text-left transition-all",
                    isRejected
                      ? "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-800"
                      : "hover:bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs">
                      IC{component.index + 1}
                    </span>
                    <TypeIcon className={cn("h-3 w-3", typeInfo.color)} />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {(component.varianceExplained * 100).toFixed(1)}% var
                  </div>
                  {component.classification && (
                    <Badge
                      variant="outline"
                      className={cn("text-[9px] mt-1 px-1", typeInfo.color)}
                    >
                      {typeInfo.label}
                    </Badge>
                  )}
                  {isRejected && (
                    <Badge variant="destructive" className="text-[9px] mt-1">
                      Reject
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            Click components to toggle rejection. Rejected components will be
            removed during reconstruction.
          </p>
        </div>
      )}

      {/* Info box */}
      <div className="p-3 bg-muted rounded-md text-sm space-y-1">
        <p className="font-medium">About ICA</p>
        <p className="text-muted-foreground text-xs">
          Independent Component Analysis decomposes the signal into
          statistically independent components. Artifact components (eye blinks,
          muscle activity, etc.) can be identified and removed to clean the
          data.
        </p>
      </div>
    </div>
  );
}
