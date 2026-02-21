"use client";

import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { usePreprocessingPipelineExecution } from "@/hooks/usePreprocessingPipelineExecution";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ChunkData } from "@/types/api";
import type {
  ArtifactAction,
  ArtifactDetectionConfig,
  ArtifactType,
  FilterConfig,
  ICAAlgorithm,
  PipelineStepStatus,
  ReferenceType,
} from "@/types/preprocessing";

interface PipelineChunkResult {
  chunk: ChunkData;
  chunkKey: string;
  pipelineId: string;
}

interface PreprocessingPipelinePanelProps {
  filePath: string | null;
  sampleRate?: number;
  chunk: ChunkData | null;
  chunkKey: string | null;
  availableChannels: string[];
  hasActivePreview: boolean;
  onPipelineChunkReady: (result: PipelineChunkResult) => void;
  onClearPipelinePreview: () => void;
  className?: string;
}

const REFERENCE_TYPES: Array<{ value: ReferenceType; label: string }> = [
  { value: "none", label: "None" },
  { value: "average", label: "Average" },
  { value: "linked_mastoid", label: "Linked Mastoid" },
  { value: "single", label: "Single Electrode" },
  { value: "bipolar", label: "Bipolar" },
  { value: "laplacian", label: "Laplacian" },
  { value: "custom", label: "Custom" },
];

const ICA_ALGORITHMS: Array<{ value: ICAAlgorithm; label: string }> = [
  { value: "fastica", label: "FastICA" },
  { value: "infomax", label: "Infomax" },
  { value: "jade", label: "JADE" },
  { value: "sobi", label: "SOBI" },
];

const ARTIFACT_ACTIONS: Array<{ value: ArtifactAction; label: string }> = [
  { value: "mark", label: "Mark" },
  { value: "interpolate", label: "Interpolate" },
  { value: "reject_epoch", label: "Reject Epoch" },
  { value: "zero", label: "Zero" },
];

const ARTIFACT_TYPES: Array<{ value: ArtifactType; label: string }> = [
  { value: "threshold", label: "Threshold" },
  { value: "gradient", label: "Gradient" },
  { value: "muscle", label: "Muscle" },
  { value: "eye_blink", label: "Eye Blink" },
  { value: "jump", label: "Jump" },
  { value: "flat", label: "Flat" },
];

function parseListInput(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseNumberListInput(value: string): number[] {
  return value
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
}

function parseBipolarPairs(value: string): Array<[string, string]> {
  return value
    .split(/[,\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const pair = entry.includes("->") ? entry.split("->") : entry.split("-");
      if (pair.length !== 2) return null;
      const from = pair[0].trim();
      const to = pair[1].trim();
      if (!from || !to) return null;
      return [from, to] as [string, string];
    })
    .filter((pair): pair is [string, string] => pair !== null);
}

function extractFilterValues(filters: FilterConfig[]): {
  highpass?: number;
  lowpass?: number;
  notch: number[];
} {
  let highpass: number | undefined;
  let lowpass: number | undefined;
  const notch: number[] = [];

  for (const filter of filters) {
    if (filter.type === "highpass" || filter.type === "bandpass") {
      if (
        typeof filter.highpassFreq === "number" &&
        Number.isFinite(filter.highpassFreq)
      ) {
        highpass = filter.highpassFreq;
      }
    }
    if (filter.type === "lowpass" || filter.type === "bandpass") {
      if (
        typeof filter.lowpassFreq === "number" &&
        Number.isFinite(filter.lowpassFreq)
      ) {
        lowpass = filter.lowpassFreq;
      }
    }
    if (filter.type === "notch" && Array.isArray(filter.notchFreqs)) {
      notch.push(
        ...filter.notchFreqs.filter(
          (freq) => Number.isFinite(freq) && freq > 0,
        ),
      );
    }
  }

  return {
    highpass,
    lowpass,
    notch: Array.from(new Set(notch)).sort((a, b) => a - b),
  };
}

function buildFilterConfigs(values: {
  highpass?: number;
  lowpass?: number;
  notch: number[];
}): FilterConfig[] {
  const filters: FilterConfig[] = [];
  const { highpass, lowpass } = values;

  const hasHighpass = typeof highpass === "number" && Number.isFinite(highpass);
  const hasLowpass = typeof lowpass === "number" && Number.isFinite(lowpass);

  if (hasHighpass && hasLowpass && highpass! < lowpass!) {
    filters.push({
      type: "bandpass",
      design: "butterworth",
      order: 4,
      highpassFreq: highpass,
      lowpassFreq: lowpass,
      zeroPhase: true,
    });
  } else {
    if (hasHighpass) {
      filters.push({
        type: "highpass",
        design: "butterworth",
        order: 4,
        highpassFreq: highpass,
        zeroPhase: true,
      });
    }
    if (hasLowpass) {
      filters.push({
        type: "lowpass",
        design: "butterworth",
        order: 4,
        lowpassFreq: lowpass,
        zeroPhase: true,
      });
    }
  }

  if (values.notch.length > 0) {
    filters.push({
      type: "notch",
      design: "butterworth",
      order: 4,
      notchFreqs: values.notch,
      notchWidth: 2,
      zeroPhase: true,
    });
  }

  return filters;
}

function statusVariant(
  status: PipelineStepStatus,
): "success" | "destructive" | "warning" | "muted" | "outline" {
  switch (status) {
    case "completed":
      return "success";
    case "error":
      return "destructive";
    case "running":
      return "warning";
    case "pending":
      return "outline";
    case "skipped":
      return "muted";
    default:
      return "muted";
  }
}

function defaultThresholdForDetector(type: ArtifactType): number {
  switch (type) {
    case "gradient":
    case "jump":
      return 50;
    case "flat":
      return 1e-6;
    case "muscle":
      return 80;
    case "eye_blink":
      return 120;
    case "threshold":
    default:
      return 100;
  }
}

export function PreprocessingPipelinePanel({
  filePath,
  sampleRate = 256,
  chunk,
  chunkKey,
  availableChannels,
  hasActivePreview,
  onPipelineChunkReady,
  onClearPipelinePreview,
  className,
}: PreprocessingPipelinePanelProps) {
  const [lastDiagnosticLog, setLastDiagnosticLog] = useState<string>("");

  const {
    preprocessing,
    createPipeline,
    setActivePipeline,
    applyPreset,
    setAllStepsEnabled,
    setStepEnabled,
    updateBadChannelConfig,
    updateFilteringConfig,
    updateReferenceConfig,
    updateICAConfig,
    updateArtifactRemovalConfig,
    resetPipelineResults,
  } = useAppStore(
    useShallow((state) => ({
      preprocessing: state.preprocessing,
      createPipeline: state.createPipeline,
      setActivePipeline: state.setActivePipeline,
      applyPreset: state.applyPreset,
      setAllStepsEnabled: state.setAllStepsEnabled,
      setStepEnabled: state.setStepEnabled,
      updateBadChannelConfig: state.updateBadChannelConfig,
      updateFilteringConfig: state.updateFilteringConfig,
      updateReferenceConfig: state.updateReferenceConfig,
      updateICAConfig: state.updateICAConfig,
      updateArtifactRemovalConfig: state.updateArtifactRemovalConfig,
      resetPipelineResults: state.resetPipelineResults,
    })),
  );

  const { mutateAsync: executePreprocessingPipeline, isPending } =
    usePreprocessingPipelineExecution();

  const pipeline = useMemo(() => {
    if (!filePath) return undefined;
    return Object.values(preprocessing.pipelines).find(
      (candidate) => candidate.fileId === filePath,
    );
  }, [preprocessing.pipelines, filePath]);

  const presets = useMemo(() => {
    const builtIn = [
      { id: "eeg-standard", name: "Standard EEG" },
      { id: "eeg-erp", name: "ERP Analysis" },
      { id: "eeg-minimal", name: "Minimal EEG" },
      { id: "dda-optimized", name: "DDA Optimized" },
    ];
    const custom = preprocessing.customPresets.map((preset) => ({
      id: preset.id,
      name: preset.name,
    }));
    return [...builtIn, ...custom];
  }, [preprocessing.customPresets]);

  useEffect(() => {
    if (!filePath) return;

    if (!pipeline) {
      createPipeline(filePath, "Default Pipeline", "eeg-standard");
      return;
    }

    if (preprocessing.activePipelineId !== pipeline.id) {
      setActivePipeline(pipeline.id);
    }
  }, [
    filePath,
    pipeline,
    preprocessing.activePipelineId,
    createPipeline,
    setActivePipeline,
  ]);

  useEffect(() => {
    setLastDiagnosticLog("");
  }, [filePath, pipeline?.id, chunkKey]);

  const stepStatuses = useMemo(() => {
    if (!pipeline) return [];
    return [
      {
        key: "badChannelDetection",
        type: "bad_channel_detection" as const,
        label: "Bad Channel Detection",
        step: pipeline.steps.badChannelDetection,
      },
      {
        key: "filtering",
        type: "filtering" as const,
        label: "Filtering",
        step: pipeline.steps.filtering,
      },
      {
        key: "rereference",
        type: "rereference" as const,
        label: "Re-reference",
        step: pipeline.steps.rereference,
      },
      {
        key: "ica",
        type: "ica" as const,
        label: "ICA",
        step: pipeline.steps.ica,
      },
      {
        key: "artifactRemoval",
        type: "artifact_removal" as const,
        label: "Artifact Removal",
        step: pipeline.steps.artifactRemoval,
      },
    ];
  }, [pipeline]);

  const allStepsEnabled =
    pipeline && stepStatuses.every((entry) => entry.step.enabled);
  const completedSteps = stepStatuses.filter(
    (entry) =>
      entry.step.status === "completed" || entry.step.status === "skipped",
  ).length;

  const filterValues = useMemo(() => {
    if (!pipeline)
      return { highpass: undefined, lowpass: undefined, notch: [] as number[] };
    return extractFilterValues(pipeline.steps.filtering.config.filters);
  }, [pipeline]);

  const canRun =
    !!pipeline && !!chunk && !!chunkKey && !isPending && !pipeline.isRunning;
  const averageLikeReferenceNeedsMoreChannels =
    !!pipeline &&
    pipeline.steps.rereference.enabled &&
    (pipeline.steps.rereference.config.type === "average" ||
      pipeline.steps.rereference.config.type === "laplacian") &&
    (chunk?.channels.length || 0) < 2;

  const handleFilterValueChange = (
    changes: Partial<{ highpass?: number; lowpass?: number; notch: number[] }>,
  ) => {
    if (!pipeline) return;
    const nextValues = {
      highpass: changes.highpass ?? filterValues.highpass,
      lowpass: changes.lowpass ?? filterValues.lowpass,
      notch: changes.notch ?? filterValues.notch,
    };
    const filters = buildFilterConfigs(nextValues);
    updateFilteringConfig(pipeline.id, {
      filters,
      applyOrder: pipeline.steps.filtering.config.applyOrder,
    });
    onClearPipelinePreview();
  };

  const handleRunPipeline = async () => {
    if (!pipeline || !chunk || !chunkKey) return;

    resetPipelineResults(pipeline.id);

    try {
      const result = await executePreprocessingPipeline({
        pipelineId: pipeline.id,
        pipeline,
        chunk,
      });

      const stepSummary = result.stepReports
        .map(
          (report) =>
            `${report.stepType}: ${report.status}${report.details ? ` (${report.details})` : ""}`,
        )
        .join("\n");
      const diagnosticText = [
        `file=${filePath}`,
        `pipeline_id=${pipeline.id}`,
        `chunk_start=${chunk.chunk_start}`,
        `chunk_size=${chunk.chunk_size}`,
        `channels=${chunk.channels.join(",")}`,
        `artifact_count=${result.artifactCount}`,
        `bad_channels=${result.badChannels.join(", ") || "none"}`,
        "",
        "step_reports:",
        stepSummary || "none",
        "",
        "diagnostic_log:",
        ...(result.diagnosticLog || []),
      ].join("\n");
      setLastDiagnosticLog(diagnosticText);

      onPipelineChunkReady({
        chunk: result.chunk,
        chunkKey,
        pipelineId: pipeline.id,
      });

      toast.success(
        "Pipeline executed",
        `Bad channels: ${result.badChannels.length}, artifact samples: ${result.artifactCount}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Pipeline execution failed", message);
    }
  };

  const handleCopyDiagnosticLog = async () => {
    if (!lastDiagnosticLog) return;
    try {
      await navigator.clipboard.writeText(lastDiagnosticLog);
      toast.success("Diagnostics copied", "Share this log for debugging.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Failed to copy diagnostics", message);
    }
  };

  const handleDetectorUpdate = (
    index: number,
    patch: Partial<ArtifactDetectionConfig>,
  ) => {
    if (!pipeline) return;
    const detectors = pipeline.steps.artifactRemoval.config.detectors.map(
      (detector, detectorIndex) =>
        detectorIndex === index ? { ...detector, ...patch } : detector,
    );
    updateArtifactRemovalConfig(pipeline.id, { detectors });
    onClearPipelinePreview();
  };

  const handleDetectorAdd = () => {
    if (!pipeline) return;
    const existingTypes = new Set(
      pipeline.steps.artifactRemoval.config.detectors.map((det) => det.type),
    );
    const nextType =
      ARTIFACT_TYPES.find((candidate) => !existingTypes.has(candidate.value))
        ?.value ?? "threshold";

    const nextDetector: ArtifactDetectionConfig = {
      type: nextType,
      enabled: true,
      threshold: defaultThresholdForDetector(nextType),
      windowSize:
        nextType === "threshold" ||
        nextType === "gradient" ||
        nextType === "jump"
          ? Math.round(sampleRate / 4)
          : undefined,
      minDuration:
        nextType === "flat" ? Math.round(sampleRate * 0.2) : undefined,
    };

    updateArtifactRemovalConfig(pipeline.id, {
      detectors: [
        ...pipeline.steps.artifactRemoval.config.detectors,
        nextDetector,
      ],
    });
    onClearPipelinePreview();
  };

  const handleDetectorRemove = (index: number) => {
    if (!pipeline) return;
    const next = pipeline.steps.artifactRemoval.config.detectors.filter(
      (_detector, detectorIndex) => detectorIndex !== index,
    );
    updateArtifactRemovalConfig(pipeline.id, { detectors: next });
    onClearPipelinePreview();
  };

  if (!filePath) {
    return (
      <div
        className={cn(
          "rounded-lg border p-3 text-xs text-muted-foreground",
          className,
        )}
      >
        Select a file to configure the preprocessing pipeline.
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div
        className={cn(
          "rounded-lg border p-3 text-xs text-muted-foreground",
          className,
        )}
      >
        Initializing preprocessing pipeline...
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-background/40 p-3 space-y-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Preprocessing Pipeline</div>
          <div className="text-xs text-muted-foreground">
            Run full backend pipeline on the current chunk and preview the
            output.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{completedSteps}/5 done</Badge>
          {hasActivePreview && <Badge variant="success">Preview Applied</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">Preset</Label>
          <Select
            value="custom"
            onValueChange={(presetId) => {
              if (presetId === "custom") return;
              applyPreset(pipeline.id, presetId);
              onClearPipelinePreview();
            }}
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Apply preset" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">Custom / Current</SelectItem>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Enable All Steps</Label>
          <div className="h-8 px-3 border rounded-md flex items-center justify-between">
            <span className="text-xs text-muted-foreground">All enabled</span>
            <Switch
              checked={!!allStepsEnabled}
              onCheckedChange={(checked) => {
                setAllStepsEnabled(pipeline.id, checked);
                onClearPipelinePreview();
              }}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {stepStatuses.map((entry) => (
          <div key={entry.key} className="rounded-md border p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={entry.step.enabled}
                  onCheckedChange={(checked) => {
                    setStepEnabled(pipeline.id, entry.type, checked);
                    onClearPipelinePreview();
                  }}
                />
                <span className="text-sm font-medium">{entry.label}</span>
              </div>
              <Badge variant={statusVariant(entry.step.status)}>
                {entry.step.status}
              </Badge>
            </div>
            {entry.step.error && (
              <div className="mt-2 text-xs text-destructive">
                {entry.step.error}
              </div>
            )}
          </div>
        ))}
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2 rounded-md border p-2">
          <div className="text-xs font-medium">Bad Channel Detection</div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Auto detect</Label>
            <Switch
              checked={pipeline.steps.badChannelDetection.config.autoDetect}
              onCheckedChange={(checked) => {
                updateBadChannelConfig(pipeline.id, { autoDetect: checked });
                onClearPipelinePreview();
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Variance threshold</Label>
              <Input
                type="number"
                step="0.1"
                value={
                  pipeline.steps.badChannelDetection.config.varianceThreshold
                }
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  updateBadChannelConfig(pipeline.id, {
                    varianceThreshold: value,
                  });
                  onClearPipelinePreview();
                }}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Flat threshold</Label>
              <Input
                type="number"
                step="0.000001"
                value={pipeline.steps.badChannelDetection.config.flatThreshold}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  updateBadChannelConfig(pipeline.id, { flatThreshold: value });
                  onClearPipelinePreview();
                }}
                className="h-8"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              Manual bad channels (comma-separated)
            </Label>
            <Input
              value={pipeline.steps.badChannelDetection.config.manualBadChannels.join(
                ", ",
              )}
              onChange={(event) => {
                updateBadChannelConfig(pipeline.id, {
                  manualBadChannels: parseListInput(event.target.value),
                });
                onClearPipelinePreview();
              }}
              className="h-8"
              placeholder={availableChannels.slice(0, 3).join(", ")}
            />
          </div>
        </div>

        <div className="space-y-2 rounded-md border p-2">
          <div className="text-xs font-medium">Filtering</div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Highpass (Hz)</Label>
              <Input
                type="number"
                step="0.1"
                value={filterValues.highpass ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  const value = raw === "" ? undefined : Number(raw);
                  handleFilterValueChange({
                    highpass: Number.isFinite(value as number)
                      ? value
                      : undefined,
                  });
                }}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Lowpass (Hz)</Label>
              <Input
                type="number"
                step="0.1"
                value={filterValues.lowpass ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  const value = raw === "" ? undefined : Number(raw);
                  handleFilterValueChange({
                    lowpass: Number.isFinite(value as number)
                      ? value
                      : undefined,
                  });
                }}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Apply order</Label>
              <Select
                value={pipeline.steps.filtering.config.applyOrder}
                onValueChange={(value: "sequential" | "parallel") => {
                  updateFilteringConfig(pipeline.id, {
                    applyOrder: value,
                    filters: pipeline.steps.filtering.config.filters,
                  });
                  onClearPipelinePreview();
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequential">Sequential</SelectItem>
                  <SelectItem value="parallel">Parallel</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              Notch frequencies (Hz, comma-separated)
            </Label>
            <Input
              value={filterValues.notch.join(", ")}
              onChange={(event) => {
                handleFilterValueChange({
                  notch: parseNumberListInput(event.target.value),
                });
              }}
              className="h-8"
              placeholder="50, 60"
            />
          </div>
        </div>

        <div className="space-y-2 rounded-md border p-2">
          <div className="text-xs font-medium">Re-reference</div>
          {averageLikeReferenceNeedsMoreChannels && (
            <div className="rounded-md border border-amber-300/60 bg-amber-50/60 px-2 py-1 text-xs text-amber-700 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300">
              Average/Laplacian re-reference needs at least 2 selected channels.
              This step will be skipped for the current chunk.
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Reference type</Label>
            <Select
              value={pipeline.steps.rereference.config.type}
              onValueChange={(value: ReferenceType) => {
                updateReferenceConfig(pipeline.id, { type: value });
                onClearPipelinePreview();
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFERENCE_TYPES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {pipeline.steps.rereference.config.type === "bipolar" ? (
            <div className="space-y-1">
              <Label className="text-xs">
                Bipolar pairs (e.g., F3-C3, C3-P3)
              </Label>
              <Textarea
                value={(pipeline.steps.rereference.config.bipolarPairs || [])
                  .map((pair) => `${pair[0]}-${pair[1]}`)
                  .join(", ")}
                onChange={(event) => {
                  updateReferenceConfig(pipeline.id, {
                    bipolarPairs: parseBipolarPairs(event.target.value),
                  });
                  onClearPipelinePreview();
                }}
                rows={2}
              />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Reference channels</Label>
                <Input
                  value={(
                    pipeline.steps.rereference.config.referenceChannels || []
                  ).join(", ")}
                  onChange={(event) => {
                    updateReferenceConfig(pipeline.id, {
                      referenceChannels: parseListInput(event.target.value),
                    });
                    onClearPipelinePreview();
                  }}
                  className="h-8"
                  placeholder="A1, A2"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Exclude channels</Label>
                <Input
                  value={(
                    pipeline.steps.rereference.config.excludeChannels || []
                  ).join(", ")}
                  onChange={(event) => {
                    updateReferenceConfig(pipeline.id, {
                      excludeChannels: parseListInput(event.target.value),
                    });
                    onClearPipelinePreview();
                  }}
                  className="h-8"
                  placeholder="EOG, ECG"
                />
              </div>
            </>
          )}
        </div>

        <div className="space-y-2 rounded-md border p-2">
          <div className="text-xs font-medium">ICA</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Algorithm</Label>
              <Select
                value={pipeline.steps.ica.config.algorithm}
                onValueChange={(value: ICAAlgorithm) => {
                  updateICAConfig(pipeline.id, { algorithm: value });
                  onClearPipelinePreview();
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ICA_ALGORITHMS.map((algorithm) => (
                    <SelectItem key={algorithm.value} value={algorithm.value}>
                      {algorithm.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Components</Label>
              <Input
                type="number"
                min={2}
                value={pipeline.steps.ica.config.nComponents ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  updateICAConfig(pipeline.id, {
                    nComponents:
                      raw === "" ? undefined : Math.max(2, Number(raw)),
                  });
                  onClearPipelinePreview();
                }}
                className="h-8"
                placeholder="Auto"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Max iterations</Label>
              <Input
                type="number"
                min={100}
                value={pipeline.steps.ica.config.maxIterations}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  updateICAConfig(pipeline.id, {
                    maxIterations: Math.max(100, Math.round(value)),
                  });
                  onClearPipelinePreview();
                }}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tolerance</Label>
              <Input
                type="number"
                step="0.00001"
                value={pipeline.steps.ica.config.tolerance}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  updateICAConfig(pipeline.id, { tolerance: value });
                  onClearPipelinePreview();
                }}
                className="h-8"
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Auto classify components</Label>
            <Switch
              checked={pipeline.steps.ica.config.autoClassify}
              onCheckedChange={(checked) => {
                updateICAConfig(pipeline.id, { autoClassify: checked });
                onClearPipelinePreview();
              }}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium">Artifact Removal</div>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={handleDetectorAdd}
          >
            Add detector
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Action</Label>
            <Select
              value={pipeline.steps.artifactRemoval.config.action}
              onValueChange={(value: ArtifactAction) => {
                updateArtifactRemovalConfig(pipeline.id, { action: value });
                onClearPipelinePreview();
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ARTIFACT_ACTIONS.map((action) => (
                  <SelectItem key={action.value} value={action.value}>
                    {action.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Epoch padding (samples)</Label>
            <Input
              type="number"
              min={0}
              value={pipeline.steps.artifactRemoval.config.epochPadding}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                updateArtifactRemovalConfig(pipeline.id, {
                  epochPadding: Math.max(0, Math.round(value)),
                });
                onClearPipelinePreview();
              }}
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Interpolation method</Label>
            <Select
              value={
                pipeline.steps.artifactRemoval.config.interpolationMethod ||
                "linear"
              }
              onValueChange={(value: "linear" | "spline" | "neighbor") => {
                updateArtifactRemovalConfig(pipeline.id, {
                  interpolationMethod: value,
                });
                onClearPipelinePreview();
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="linear">Linear</SelectItem>
                <SelectItem value="spline">Spline</SelectItem>
                <SelectItem value="neighbor">Neighbor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          {pipeline.steps.artifactRemoval.config.detectors.map(
            (detector, index) => (
              <div
                key={`${detector.type}-${index}`}
                className="rounded border p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={detector.enabled}
                      onCheckedChange={(checked) =>
                        handleDetectorUpdate(index, { enabled: checked })
                      }
                    />
                    <span className="text-xs font-medium">
                      {ARTIFACT_TYPES.find(
                        (option) => option.value === detector.type,
                      )?.label || detector.type}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleDetectorRemove(index)}
                  >
                    Remove
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={detector.type}
                      onValueChange={(value: ArtifactType) =>
                        handleDetectorUpdate(index, {
                          type: value,
                          threshold: defaultThresholdForDetector(value),
                        })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ARTIFACT_TYPES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Threshold</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={detector.threshold}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isFinite(value)) return;
                        handleDetectorUpdate(index, { threshold: value });
                      }}
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Window size</Label>
                    <Input
                      type="number"
                      min={1}
                      value={detector.windowSize ?? ""}
                      onChange={(event) => {
                        const raw = event.target.value;
                        const value =
                          raw === "" ? undefined : Math.max(1, Number(raw));
                        handleDetectorUpdate(index, { windowSize: value });
                      }}
                      className="h-8"
                    />
                  </div>
                </div>
              </div>
            ),
          )}
          {pipeline.steps.artifactRemoval.config.detectors.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No detectors configured. Add at least one detector to remove
              artifacts.
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" onClick={handleRunPipeline} disabled={!canRun}>
          {isPending || pipeline.isRunning
            ? "Running..."
            : "Run Pipeline On Current Chunk"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onClearPipelinePreview();
            resetPipelineResults(pipeline.id);
          }}
          disabled={
            !hasActivePreview &&
            stepStatuses.every((entry) => entry.step.status === "idle")
          }
        >
          Clear Preview / Reset Status
        </Button>
        <span className="text-xs text-muted-foreground">
          {chunk
            ? `Chunk: ${chunk.chunk_start.toLocaleString()} - ${(chunk.chunk_start + chunk.chunk_size).toLocaleString()} (${chunk.channels.length} channels)`
            : "Load chunk data to run pipeline"}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Shareable Diagnostics</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleCopyDiagnosticLog}
              disabled={!lastDiagnosticLog}
            >
              Copy Log
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setLastDiagnosticLog("")}
              disabled={!lastDiagnosticLog}
            >
              Clear
            </Button>
          </div>
        </div>
        <Textarea
          value={lastDiagnosticLog}
          readOnly
          rows={8}
          className="font-mono text-[11px]"
          placeholder="Run pipeline once to generate a shareable diagnostic log."
        />
      </div>
    </div>
  );
}
