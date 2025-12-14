"use client";

import React, { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WizardStep } from "@/components/wizard/WizardStep";
import { WizardNavigation } from "@/components/wizard/WizardNavigation";
import { DDAParameters } from "./AnalysisFormProvider";
import { EDFFileInfo } from "@/types/api";

export interface WizardStepConfig {
  id: string;
  title: string;
  description: string;
  component: React.ReactNode;
  validate?: () => boolean;
}

export interface AnalysisWizardProps {
  parameters: DDAParameters;
  selectedFile: EDFFileInfo | null;
  onParametersChange: (params: DDAParameters) => void;
  onComplete: () => void;
  isRunning?: boolean;
  children: React.ReactNode[];
  stepTitles: string[];
  stepDescriptions: string[];
  className?: string;
}

export const AnalysisWizard: React.FC<AnalysisWizardProps> = ({
  parameters,
  selectedFile,
  onParametersChange,
  onComplete,
  isRunning = false,
  children,
  stepTitles,
  stepDescriptions,
  className = "",
}) => {
  const [currentStep, setCurrentStep] = useState(1);

  const totalSteps = children.length;

  const canGoNext = useMemo(() => {
    if (currentStep === 1) {
      return !!selectedFile;
    }
    if (currentStep === 2) {
      return parameters.variants.length > 0;
    }
    if (currentStep === 3) {
      const hasChannels = Object.values(parameters.variantChannelConfigs).some(
        (config) =>
          (config.selectedChannels && config.selectedChannels.length > 0) ||
          (config.ctChannelPairs && config.ctChannelPairs.length > 0) ||
          (config.cdChannelPairs && config.cdChannelPairs.length > 0),
      );
      return hasChannels;
    }
    return true;
  }, [currentStep, selectedFile, parameters]);

  const handleNext = () => {
    if (currentStep < totalSteps && canGoNext) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleStepClick = (step: number) => {
    if (step <= currentStep || step === currentStep + 1) {
      setCurrentStep(step);
    }
  };

  const completedSteps = currentStep - 1;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Analysis Configuration Wizard</CardTitle>
        <CardDescription>
          Follow these steps to configure and run your DDA analysis
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {stepTitles.map((title, index) => (
            <WizardStep
              key={index}
              number={index + 1}
              title={title}
              description={stepDescriptions[index]}
              isActive={currentStep === index + 1}
              isCompleted={index < completedSteps}
              onClick={
                index < currentStep
                  ? () => handleStepClick(index + 1)
                  : undefined
              }
            />
          ))}
        </div>

        <div className="min-h-[400px] py-4">{children[currentStep - 1]}</div>

        <WizardNavigation
          currentStep={currentStep}
          totalSteps={totalSteps}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onFinish={onComplete}
          canGoNext={canGoNext}
          canGoPrevious={currentStep > 1}
          isLoading={isRunning}
        />
      </CardContent>
    </Card>
  );
};
