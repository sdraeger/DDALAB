/**
 * FilteringStep Component
 *
 * Configuration UI for frequency filtering step
 */

import React from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  FilterConfig,
  FilterType,
  FilterDesign,
} from "@/types/preprocessing";
import { Plus, Trash2 } from "lucide-react";

interface FilteringStepProps {
  pipelineId: string;
}

const FILTER_TYPES: { value: FilterType; label: string }[] = [
  { value: "highpass", label: "Highpass" },
  { value: "lowpass", label: "Lowpass" },
  { value: "bandpass", label: "Bandpass" },
  { value: "bandstop", label: "Bandstop" },
  { value: "notch", label: "Notch" },
];

const FILTER_DESIGNS: { value: FilterDesign; label: string }[] = [
  { value: "butterworth", label: "Butterworth (IIR)" },
  { value: "chebyshev1", label: "Chebyshev Type I" },
  { value: "chebyshev2", label: "Chebyshev Type II" },
  { value: "fir", label: "FIR" },
];

export function FilteringStep({ pipelineId }: FilteringStepProps) {
  const pipeline = useAppStore(
    useShallow((state) => state.preprocessing.pipelines[pipelineId]),
  );
  const updateFilteringConfig = useAppStore(
    (state) => state.updateFilteringConfig,
  );

  if (!pipeline) return null;

  const config = pipeline.steps.filtering.config;

  const handleAddFilter = () => {
    const newFilter: FilterConfig = {
      type: "highpass",
      design: "butterworth",
      order: 4,
      highpassFreq: 1,
      zeroPhase: true,
    };
    updateFilteringConfig(pipelineId, {
      filters: [...config.filters, newFilter],
    });
  };

  const handleRemoveFilter = (index: number) => {
    updateFilteringConfig(pipelineId, {
      filters: config.filters.filter((_, i) => i !== index),
    });
  };

  const handleUpdateFilter = (
    index: number,
    updates: Partial<FilterConfig>,
  ) => {
    const newFilters = [...config.filters];
    newFilters[index] = { ...newFilters[index], ...updates };
    updateFilteringConfig(pipelineId, { filters: newFilters });
  };

  const getFilterSummary = (filter: FilterConfig): string => {
    switch (filter.type) {
      case "highpass":
        return `HP: ${filter.highpassFreq}Hz`;
      case "lowpass":
        return `LP: ${filter.lowpassFreq}Hz`;
      case "bandpass":
        return `BP: ${filter.highpassFreq}-${filter.lowpassFreq}Hz`;
      case "bandstop":
        return `BS: ${filter.highpassFreq}-${filter.lowpassFreq}Hz`;
      case "notch":
        return `Notch: ${filter.notchFreqs?.join(", ")}Hz`;
      default:
        return filter.type;
    }
  };

  return (
    <div className="space-y-6">
      {/* Apply Order */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label>Filter Application</Label>
          <p className="text-xs text-muted-foreground">
            How filters are applied to the data
          </p>
        </div>
        <Select
          value={config.applyOrder}
          onValueChange={(value) =>
            updateFilteringConfig(pipelineId, {
              applyOrder: value as "sequential" | "parallel",
            })
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sequential">Sequential</SelectItem>
            <SelectItem value="parallel">Parallel (Merge)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filter List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Filters ({config.filters.length})</Label>
          <Button variant="outline" size="sm" onClick={handleAddFilter}>
            <Plus className="h-4 w-4 mr-1" />
            Add Filter
          </Button>
        </div>

        {/* Filter Summary Badges */}
        <div className="flex flex-wrap gap-2">
          {config.filters.map((filter, index) => (
            <Badge key={index} variant="secondary">
              {getFilterSummary(filter)}
            </Badge>
          ))}
        </div>

        {/* Filter Cards */}
        <div className="space-y-3">
          {config.filters.map((filter, index) => (
            <div key={index} className="p-3 border rounded-md space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline">{index + 1}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveFilter(index)}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Filter Type */}
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select
                    value={filter.type}
                    onValueChange={(value) =>
                      handleUpdateFilter(index, { type: value as FilterType })
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_TYPES.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Filter Design */}
                <div className="space-y-1">
                  <Label className="text-xs">Design</Label>
                  <Select
                    value={filter.design}
                    onValueChange={(value) =>
                      handleUpdateFilter(index, {
                        design: value as FilterDesign,
                      })
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_DESIGNS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Order */}
                <div className="space-y-1">
                  <Label className="text-xs">Order</Label>
                  <Input
                    type="number"
                    value={filter.order}
                    onChange={(e) =>
                      handleUpdateFilter(index, {
                        order: parseInt(e.target.value),
                      })
                    }
                    min={1}
                    max={10}
                    className="h-8"
                  />
                </div>

                {/* Frequency Parameters based on type */}
                {(filter.type === "highpass" ||
                  filter.type === "bandpass" ||
                  filter.type === "bandstop") && (
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {filter.type === "highpass"
                        ? "Cutoff (Hz)"
                        : "Low Cutoff (Hz)"}
                    </Label>
                    <Input
                      type="number"
                      value={filter.highpassFreq ?? ""}
                      onChange={(e) =>
                        handleUpdateFilter(index, {
                          highpassFreq: parseFloat(e.target.value),
                        })
                      }
                      step={0.1}
                      min={0}
                      className="h-8"
                    />
                  </div>
                )}

                {(filter.type === "lowpass" ||
                  filter.type === "bandpass" ||
                  filter.type === "bandstop") && (
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {filter.type === "lowpass"
                        ? "Cutoff (Hz)"
                        : "High Cutoff (Hz)"}
                    </Label>
                    <Input
                      type="number"
                      value={filter.lowpassFreq ?? ""}
                      onChange={(e) =>
                        handleUpdateFilter(index, {
                          lowpassFreq: parseFloat(e.target.value),
                        })
                      }
                      step={0.1}
                      min={0}
                      className="h-8"
                    />
                  </div>
                )}

                {filter.type === "notch" && (
                  <>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">
                        Notch Frequencies (Hz, comma-separated)
                      </Label>
                      <Input
                        value={filter.notchFreqs?.join(", ") ?? ""}
                        onChange={(e) =>
                          handleUpdateFilter(index, {
                            notchFreqs: e.target.value
                              .split(",")
                              .map((s) => parseFloat(s.trim()))
                              .filter((n) => !isNaN(n)),
                          })
                        }
                        placeholder="50, 60, 100, 120"
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Notch Width (Hz)</Label>
                      <Input
                        type="number"
                        value={filter.notchWidth ?? 2}
                        onChange={(e) =>
                          handleUpdateFilter(index, {
                            notchWidth: parseFloat(e.target.value),
                          })
                        }
                        step={0.5}
                        min={0.5}
                        className="h-8"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Zero-phase toggle */}
              <div className="flex items-center gap-2 pt-1">
                <Switch
                  id={`zero-phase-${index}`}
                  checked={filter.zeroPhase}
                  onCheckedChange={(checked) =>
                    handleUpdateFilter(index, { zeroPhase: checked })
                  }
                />
                <Label htmlFor={`zero-phase-${index}`} className="text-xs">
                  Zero-phase filtering (no phase distortion)
                </Label>
              </div>
            </div>
          ))}
        </div>

        {config.filters.length === 0 && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            No filters configured. Click "Add Filter" to get started.
          </div>
        )}
      </div>
    </div>
  );
}
