"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Target, Settings2, Save } from "lucide-react";
import { DDAParameters } from "./AnalysisFormProvider";

export interface ParameterPreset {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  parameters: Partial<DDAParameters>;
  recommended: string;
}

export interface ParameterPresetsProps {
  onApplyPreset: (preset: ParameterPreset) => void;
  onSaveCustom?: () => void;
  customPresets?: ParameterPreset[];
  className?: string;
}

export const BUILTIN_PRESETS: ParameterPreset[] = [
  {
    id: "quick",
    name: "Quick Scan",
    description: "Fast exploratory analysis with reduced accuracy",
    icon: <Zap className="h-5 w-5" />,
    recommended: "For initial exploration or testing",
    parameters: {
      windowLength: 2,
      windowStep: 1,
      delays: [7],
      modelParameters: {
        dm: 3,
        order: 3,
        nr_tau: 1,
        encoding: [1, 2],
      },
    },
  },
  {
    id: "detailed",
    name: "Detailed Analysis",
    description: "Comprehensive analysis with high accuracy",
    icon: <Target className="h-5 w-5" />,
    recommended: "For publication-quality results",
    parameters: {
      windowLength: 4,
      windowStep: 0.5,
      delays: [7, 10, 15],
      modelParameters: {
        dm: 4,
        order: 4,
        nr_tau: 2,
        encoding: [1, 2, 10],
      },
    },
  },
  {
    id: "custom",
    name: "Custom Settings",
    description: "Manually configure all parameters",
    icon: <Settings2 className="h-5 w-5" />,
    recommended: "For advanced users with specific requirements",
    parameters: {},
  },
];

export const ParameterPresets: React.FC<ParameterPresetsProps> = ({
  onApplyPreset,
  onSaveCustom,
  customPresets = [],
  className = "",
}) => {
  const allPresets = [...BUILTIN_PRESETS, ...customPresets];

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Parameter Presets</CardTitle>
            <CardDescription>
              Start with a preset configuration and customize as needed
            </CardDescription>
          </div>
          {onSaveCustom && (
            <Button variant="outline" size="sm" onClick={onSaveCustom}>
              <Save className="h-4 w-4 mr-2" />
              Save Current
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {allPresets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onApplyPreset(preset)}
              className="text-left p-4 rounded-lg border-2 hover:border-primary hover:bg-muted/50 transition-all group"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  {preset.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">
                    {preset.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {preset.description}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                <strong>Best for:</strong> {preset.recommended}
              </p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
