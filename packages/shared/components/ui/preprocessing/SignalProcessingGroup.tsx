"use client";

import React from "react";
import { UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "../form";
import { Checkbox } from "../checkbox";
import { Badge } from "../badge";
import { Slider } from "../slider";
import { FormValues } from "../../../types/preprocessing";
import { TrendingUpIcon } from "lucide-react";

interface SignalProcessingGroupProps {
  form: UseFormReturn<FormValues>;
}

export function SignalProcessingGroup({ form }: SignalProcessingGroupProps) {
  const { control, watch } = form;

  const preprocessingSteps = watch("preprocessingSteps") || [];
  const removeOutliers = watch("removeOutliers");
  const smoothing = watch("smoothing");
  const smoothingWindow = watch("smoothingWindow");

  const isDetrendActive = preprocessingSteps.some(
    (step: { id: string }) => step.id === "detrend"
  );

  const toggleDetrend = () => {
    const currentSteps = form.getValues("preprocessingSteps");
    const stepExists = currentSteps.find(
      (step: { id: string }) => step.id === "detrend"
    );

    if (stepExists) {
      form.setValue(
        "preprocessingSteps",
        currentSteps.filter((step: { id: string }) => step.id !== "detrend"),
        { shouldValidate: true }
      );
    } else {
      form.setValue(
        "preprocessingSteps",
        [...currentSteps, { id: "detrend", label: "Detrend" }],
        { shouldValidate: true }
      );
    }
  };

  const activeOptionsCount = [
    isDetrendActive,
    removeOutliers,
    smoothing,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUpIcon className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-base">Signal Enhancement</h3>
        <Badge variant="secondary" className="text-xs">
          {activeOptionsCount} active
        </Badge>
      </div>

      <div className="space-y-4">
        {/* Detrend Option */}
        <div
          className={`
            relative p-4 rounded-lg border-2 transition-all duration-200 group
            ${isDetrendActive
              ? "border-primary/30 bg-primary/5 shadow-sm"
              : "border-border hover:border-primary/20 hover:bg-muted/30"
            }
          `}
        >
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 mt-0.5">
              <Checkbox
                checked={isDetrendActive}
                onCheckedChange={toggleDetrend}
                className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">📏</span>
                <FormLabel
                  className="text-sm font-medium cursor-pointer"
                  onClick={toggleDetrend}
                >
                  Detrend Signal
                </FormLabel>
                <Badge variant="outline" className="text-xs px-1.5 py-0.5">
                  Recommended
                </Badge>
              </div>
              <FormDescription className="text-xs text-muted-foreground">
                Remove linear trends to eliminate slow drifts in the signal
              </FormDescription>
            </div>
          </div>
        </div>

        {/* Remove Outliers */}
        <FormField
          control={control}
          name="removeOutliers"
          render={({ field }) => (
            <div
              className={`
                relative p-4 rounded-lg border-2 transition-all duration-200 group
                ${field.value
                  ? "border-primary/30 bg-primary/5 shadow-sm"
                  : "border-border hover:border-primary/20 hover:bg-muted/30"
                }
              `}
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-0.5">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                  </FormControl>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🎯</span>
                    <FormLabel
                      className="text-sm font-medium cursor-pointer"
                      onClick={() => field.onChange(!field.value)}
                    >
                      Remove Outliers
                    </FormLabel>
                  </div>
                  <FormDescription className="text-xs text-muted-foreground">
                    Automatically detect and remove extreme values that may skew
                    analysis
                  </FormDescription>
                </div>
              </div>
            </div>
          )}
        />

        {/* Smoothing */}
        <FormField
          control={control}
          name="smoothing"
          render={({ field }) => (
            <div className="space-y-3">
              <div
                className={`
                  relative p-4 rounded-lg border-2 transition-all duration-200 group
                  ${field.value
                    ? "border-primary/30 bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary/20 hover:bg-muted/30"
                  }
                `}
              >
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                    </FormControl>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">🌊</span>
                      <FormLabel
                        className="text-sm font-medium cursor-pointer"
                        onClick={() => field.onChange(!field.value)}
                      >
                        Apply Smoothing
                      </FormLabel>
                    </div>
                    <FormDescription className="text-xs text-muted-foreground">
                      Reduce high-frequency noise while preserving important
                      signal features
                    </FormDescription>
                  </div>
                </div>
              </div>

              {/* Smoothing Window Slider */}
              {field.value && (
                <FormField
                  control={control}
                  name="smoothingWindow"
                  render={({ field: windowField }) => (
                    <div className="ml-8 p-4 rounded-lg bg-muted/30 border">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-sm font-medium">
                            Smoothing Window Size
                          </FormLabel>
                          <Badge variant="outline" className="text-xs">
                            {windowField.value} samples
                          </Badge>
                        </div>
                        <FormControl>
                          <Slider
                            value={[windowField.value]}
                            onValueChange={(values) =>
                              windowField.onChange(values[0])
                            }
                            min={3}
                            max={15}
                            step={2}
                            className="w-full"
                          />
                        </FormControl>
                        <FormDescription className="text-xs text-muted-foreground">
                          Larger windows = more smoothing, smaller windows =
                          preserve detail
                        </FormDescription>
                      </div>
                    </div>
                  )}
                />
              )}
            </div>
          )}
        />
      </div>

      {activeOptionsCount === 0 && (
        <div className="text-center py-4 text-sm text-muted-foreground bg-muted/20 rounded-lg">
          🔧 Select signal enhancement options to improve data quality
        </div>
      )}
    </div>
  );
}
