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
import { Badge } from "../badge";
import { FormValues } from "../../form/DDAForm";
import { BarChart3Icon } from "lucide-react";

interface NormalizationGroupProps {
  form: UseFormReturn<FormValues>;
}

export function NormalizationGroup({ form }: NormalizationGroupProps) {
  const { control, watch } = form;

  const normalization = watch("normalization");

  const normalizationOptions = [
    {
      value: "none",
      label: "None",
      description: "Keep original signal values unchanged",
      icon: "📊",
      useCase: "Raw analysis",
      example: "μV",
    },
    {
      value: "minmax",
      label: "Min-Max Scaling",
      description: "Scale values to range between 0 and 1",
      icon: "📏",
      useCase: "Compare amplitudes",
      example: "0.0 - 1.0",
    },
    {
      value: "zscore",
      label: "Z-Score (Standard)",
      description: "Center around mean with unit variance",
      icon: "🎯",
      useCase: "Statistical analysis",
      example: "-2.5 to +2.5",
      recommended: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3Icon className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-base">Signal Normalization</h3>
        <Badge variant="secondary" className="text-xs">
          {normalization === "none" ? "Disabled" : "Active"}
        </Badge>
      </div>

      <FormField
        control={control}
        name="normalization"
        render={({ field }) => (
          <div className="space-y-3">
            {normalizationOptions.map((option) => {
              const isSelected = field.value === option.value;

              return (
                <div
                  key={option.value}
                  className={`
                    relative p-4 rounded-lg border-2 transition-all duration-200 group
                    ${
                      isSelected
                        ? "border-primary/30 bg-primary/5 shadow-sm ring-1 ring-primary/20"
                        : "border-border hover:border-primary/20 hover:bg-muted/30"
                    }
                  `}
                >
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 mt-1">
                      <div
                        className={`
                          w-4 h-4 rounded-full border-2 transition-colors cursor-pointer
                          ${
                            isSelected
                              ? "border-primary bg-primary"
                              : "border-muted-foreground/30 bg-background"
                          }
                        `}
                        onClick={() => field.onChange(option.value)}
                      >
                        {isSelected && (
                          <div className="w-2 h-2 bg-white rounded-full m-0.5" />
                        )}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{option.icon}</span>
                        <FormLabel
                          className="text-sm font-medium cursor-pointer"
                          onClick={() => field.onChange(option.value)}
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

                      <FormDescription className="text-xs text-muted-foreground mb-2">
                        {option.description}
                      </FormDescription>

                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">
                            Best for:
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-xs px-1.5 py-0.5"
                          >
                            {option.useCase}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">Range:</span>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {option.example}
                          </code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      />

      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <span className="text-blue-600 dark:text-blue-400">💡</span>
          <div className="text-xs">
            <p className="font-medium text-blue-800 dark:text-blue-300 mb-1">
              Normalization Tip
            </p>
            <p className="text-blue-700 dark:text-blue-400 leading-relaxed">
              Z-Score normalization is recommended for most DDA analyses as it
              standardizes signals for cross-channel comparison while preserving
              relative patterns.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
