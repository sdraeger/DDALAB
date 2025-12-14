"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";

export interface WizardNavigationProps {
  currentStep: number;
  totalSteps: number;
  onPrevious?: () => void;
  onNext?: () => void;
  onFinish?: () => void;
  canGoNext?: boolean;
  canGoPrevious?: boolean;
  nextLabel?: string;
  previousLabel?: string;
  finishLabel?: string;
  isLoading?: boolean;
  className?: string;
}

export const WizardNavigation: React.FC<WizardNavigationProps> = ({
  currentStep,
  totalSteps,
  onPrevious,
  onNext,
  onFinish,
  canGoNext = true,
  canGoPrevious = true,
  nextLabel = "Next",
  previousLabel = "Previous",
  finishLabel = "Run Analysis",
  isLoading = false,
  className = "",
}) => {
  const isLastStep = currentStep === totalSteps;
  const isFirstStep = currentStep === 1;

  return (
    <div
      className={`flex items-center justify-between border-t pt-4 mt-6 ${className}`}
    >
      <Button
        variant="outline"
        onClick={onPrevious}
        disabled={isFirstStep || !canGoPrevious || isLoading}
        className="gap-2"
      >
        <ChevronLeft className="h-4 w-4" />
        {previousLabel}
      </Button>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Step {currentStep} of {totalSteps}
        </span>
      </div>

      {isLastStep ? (
        <Button
          onClick={onFinish}
          disabled={!canGoNext || isLoading}
          className="gap-2"
          isLoading={isLoading}
        >
          <Play className="h-4 w-4" />
          {finishLabel}
        </Button>
      ) : (
        <Button
          onClick={onNext}
          disabled={!canGoNext || isLoading}
          className="gap-2"
        >
          {nextLabel}
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};
