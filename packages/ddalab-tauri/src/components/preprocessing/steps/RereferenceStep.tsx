/**
 * RereferenceStep Component
 *
 * Configuration UI for re-referencing step
 */

import React from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { ReferenceType } from "@/types/preprocessing";

interface RereferenceStepProps {
  pipelineId: string;
}

const REFERENCE_TYPES: {
  value: ReferenceType;
  label: string;
  description: string;
}[] = [
  { value: "none", label: "None", description: "Keep original reference" },
  {
    value: "average",
    label: "Average Reference",
    description: "Average of all channels",
  },
  {
    value: "linked_mastoid",
    label: "Linked Mastoids",
    description: "(A1 + A2) / 2",
  },
  {
    value: "single",
    label: "Single Channel",
    description: "Re-reference to one channel",
  },
  { value: "bipolar", label: "Bipolar Montage", description: "Channel pairs" },
  {
    value: "laplacian",
    label: "Surface Laplacian",
    description: "Spatial high-pass filter",
  },
];

export function RereferenceStep({ pipelineId }: RereferenceStepProps) {
  const pipeline = useAppStore(
    useShallow((state) => state.preprocessing.pipelines[pipelineId]),
  );
  const updateReferenceConfig = useAppStore(
    (state) => state.updateReferenceConfig,
  );
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);

  if (!pipeline) return null;

  const config = pipeline.steps.rereference.config;

  const handleConfigChange = (updates: Partial<typeof config>) => {
    updateReferenceConfig(pipelineId, updates);
  };

  const toggleExcludeChannel = (channel: string) => {
    const current = config.excludeChannels ?? [];
    const updated = current.includes(channel)
      ? current.filter((c) => c !== channel)
      : [...current, channel];
    handleConfigChange({ excludeChannels: updated });
  };

  const toggleReferenceChannel = (channel: string) => {
    const current = config.referenceChannels ?? [];
    const updated = current.includes(channel)
      ? current.filter((c) => c !== channel)
      : [...current, channel];
    handleConfigChange({ referenceChannels: updated });
  };

  return (
    <div className="space-y-6">
      {/* Reference Type */}
      <div className="space-y-2">
        <Label>Reference Type</Label>
        <Select
          value={config.type}
          onValueChange={(value) =>
            handleConfigChange({ type: value as ReferenceType })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REFERENCE_TYPES.map((option) => (
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

      {/* Type-specific options */}
      {config.type === "average" && selectedFile && (
        <div className="space-y-2">
          <Label>Exclude from Average</Label>
          <p className="text-xs text-muted-foreground">
            Select channels to exclude from the average reference calculation
            (e.g., EOG, EMG)
          </p>
          <div className="flex flex-wrap gap-1.5 p-3 border rounded-md max-h-32 overflow-y-auto">
            {selectedFile.channels.map((channel) => {
              const isExcluded = config.excludeChannels?.includes(channel);
              return (
                <Badge
                  key={channel}
                  variant={isExcluded ? "destructive" : "outline"}
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => toggleExcludeChannel(channel)}
                >
                  {channel}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {config.type === "single" && selectedFile && (
        <div className="space-y-2">
          <Label>Reference Channel</Label>
          <p className="text-xs text-muted-foreground">
            Select the channel to use as reference
          </p>
          <Select
            value={config.referenceChannels?.[0] ?? ""}
            onValueChange={(value) =>
              handleConfigChange({ referenceChannels: [value] })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select reference channel" />
            </SelectTrigger>
            <SelectContent>
              {selectedFile.channels.map((channel) => (
                <SelectItem key={channel} value={channel}>
                  {channel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {config.type === "linked_mastoid" && selectedFile && (
        <div className="space-y-2">
          <Label>Mastoid Channels</Label>
          <p className="text-xs text-muted-foreground">
            Select the two mastoid channels (typically A1/M1 and A2/M2)
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Left Mastoid</Label>
              <Select
                value={config.referenceChannels?.[0] ?? ""}
                onValueChange={(value) => {
                  const current = config.referenceChannels ?? [];
                  handleConfigChange({
                    referenceChannels: [value, current[1] ?? ""],
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select A1/M1" />
                </SelectTrigger>
                <SelectContent>
                  {selectedFile.channels.map((channel) => (
                    <SelectItem key={channel} value={channel}>
                      {channel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Right Mastoid</Label>
              <Select
                value={config.referenceChannels?.[1] ?? ""}
                onValueChange={(value) => {
                  const current = config.referenceChannels ?? [];
                  handleConfigChange({
                    referenceChannels: [current[0] ?? "", value],
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select A2/M2" />
                </SelectTrigger>
                <SelectContent>
                  {selectedFile.channels.map((channel) => (
                    <SelectItem key={channel} value={channel}>
                      {channel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {config.type === "bipolar" && selectedFile && (
        <div className="space-y-2">
          <Label>Bipolar Pairs</Label>
          <p className="text-xs text-muted-foreground">
            Configure channel pairs for bipolar derivation. Each pair subtracts
            the second channel from the first.
          </p>
          <div className="p-3 border rounded-md space-y-2">
            {(config.bipolarPairs ?? []).map((pair, index) => (
              <div key={index} className="flex items-center gap-2">
                <Select
                  value={pair[0]}
                  onValueChange={(value) => {
                    const pairs = [...(config.bipolarPairs ?? [])];
                    pairs[index] = [value, pair[1]];
                    handleConfigChange({ bipolarPairs: pairs });
                  }}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedFile.channels.map((channel) => (
                      <SelectItem key={channel} value={channel}>
                        {channel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">−</span>
                <Select
                  value={pair[1]}
                  onValueChange={(value) => {
                    const pairs = [...(config.bipolarPairs ?? [])];
                    pairs[index] = [pair[0], value];
                    handleConfigChange({ bipolarPairs: pairs });
                  }}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedFile.channels.map((channel) => (
                      <SelectItem key={channel} value={channel}>
                        {channel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={() => {
                    const pairs = (config.bipolarPairs ?? []).filter(
                      (_, i) => i !== index,
                    );
                    handleConfigChange({ bipolarPairs: pairs });
                  }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                const pairs = [
                  ...(config.bipolarPairs ?? []),
                  ["", ""] as [string, string],
                ];
                handleConfigChange({ bipolarPairs: pairs });
              }}
              className="text-sm text-primary hover:underline"
            >
              + Add pair
            </button>
          </div>
        </div>
      )}

      {/* Info box */}
      <div className="p-3 bg-muted rounded-md text-sm space-y-1">
        <p className="font-medium">About Re-referencing</p>
        <p className="text-muted-foreground text-xs">
          Re-referencing changes the reference point for all channels. Average
          reference is recommended for most analyses. The original reference is
          preserved for potential reversal.
        </p>
      </div>
    </div>
  );
}
