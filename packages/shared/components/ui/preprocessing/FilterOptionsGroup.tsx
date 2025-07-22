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
import { Input } from "../input";
import { Badge } from "../badge";
import { FilterIcon } from "lucide-react";
import { FormValues } from "../../../types/preprocessing";

interface FilterOptionsGroupProps {
  form: UseFormReturn<FormValues>;
}

export function FilterOptionsGroup({ form }: FilterOptionsGroupProps) {
  const { control, watch } = form;

  // Convert preprocessing steps array to individual boolean fields for easier handling
  const preprocessingSteps = watch("preprocessingSteps") || [];

  const isStepActive = (stepId: string) =>
    preprocessingSteps.some((step: { id: string }) => step.id === stepId);

  const toggleStep = (stepId: string, stepLabel: string) => {
    const currentSteps = form.getValues("preprocessingSteps");
    const stepExists = currentSteps.find(
      (step: { id: string }) => step.id === stepId
    );

    if (stepExists) {
      // Remove step
      form.setValue(
        "preprocessingSteps",
        currentSteps.filter((step: { id: string }) => step.id !== stepId),
        { shouldValidate: true }
      );
    } else {
      // Add step
      form.setValue(
        "preprocessingSteps",
        [...currentSteps, { id: stepId, label: stepLabel }],
        { shouldValidate: true }
      );
    }
  };

  const filterOptions = [
    {
      id: "lowpassFilter",
      label: "Low-pass Filter",
      description: "Remove high-frequency noise and artifacts",
      icon: "📉",
      recommended: true,
    },
    {
      id: "highpassFilter",
      label: "High-pass Filter",
      description: "Remove low-frequency drifts and baseline wandering",
      icon: "📈",
      recommended: true,
    },
    {
      id: "notchFilter",
      label: "Notch Filter (50/60 Hz)",
      description: "Remove power line interference",
      icon: "⚡",
      recommended: true,
    },
    {
      id: "resample",
      label: "Resample Signal",
      description: "Standardize sampling rate for consistent analysis",
      icon: "🔄",
      recommended: false,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <FilterIcon className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-base">Signal Filtering</h3>
        <Badge variant="secondary" className="text-xs">
          {preprocessingSteps.length} active
        </Badge>
      </div>

      <div className="grid gap-3">
        {filterOptions.map((option) => {
          const isActive = isStepActive(option.id);

          return (
            <div
              key={option.id}
              className={`
                relative p-4 rounded-lg border-2 transition-all duration-200 group
                ${isActive
                  ? "border-primary/30 bg-primary/5 shadow-sm"
                  : "border-border hover:border-primary/20 hover:bg-muted/30"
                }
              `}
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-0.5">
                  <Checkbox
                    checked={isActive}
                    onCheckedChange={() => toggleStep(option.id, option.label)}
                    className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{option.icon}</span>
                    <FormLabel
                      className="text-sm font-medium cursor-pointer"
                      onClick={() => toggleStep(option.id, option.label)}
                    >
                      {option.label}
                    </FormLabel>
                    {option.recommended && (
                      <Badge
                        variant="outline"
                        className="text-xs px-1.5 py-0.5"
                      >
                        Recommended
                      </Badge>
                    )}
                  </div>
                  <FormDescription className="text-xs text-muted-foreground">
                    {option.description}
                  </FormDescription>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {preprocessingSteps.length === 0 && (
        <div className="text-center py-4 text-sm text-muted-foreground bg-muted/20 rounded-lg">
          💡 Select filtering options above to improve signal quality
        </div>
      )}
    </div>
  );
}
