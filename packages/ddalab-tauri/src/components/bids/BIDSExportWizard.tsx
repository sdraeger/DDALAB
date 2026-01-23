"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useBIDSExport } from "@/hooks/useBIDSExport";
import { BIDSWizardStep } from "@/types/bidsExport";
import { cn } from "@/lib/utils";
import {
  Files,
  Users,
  FileText,
  Settings,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";

import { FileSelectionStep } from "./steps/FileSelectionStep";
import { AssignmentStep } from "./steps/AssignmentStep";
import { MetadataStep } from "./steps/MetadataStep";
import { OptionsStep } from "./steps/OptionsStep";
import { ReviewStep } from "./steps/ReviewStep";

interface BIDSExportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFiles?: string[];
}

const STEPS: { id: BIDSWizardStep; label: string; icon: React.ReactNode }[] = [
  { id: "files", label: "Files", icon: <Files className="h-4 w-4" /> },
  {
    id: "assignment",
    label: "Assignment",
    icon: <Users className="h-4 w-4" />,
  },
  { id: "metadata", label: "Metadata", icon: <FileText className="h-4 w-4" /> },
  { id: "options", label: "Options", icon: <Settings className="h-4 w-4" /> },
  { id: "review", label: "Review", icon: <CheckCircle className="h-4 w-4" /> },
];

export function BIDSExportWizard({
  open,
  onOpenChange,
  initialFiles = [],
}: BIDSExportWizardProps) {
  const exportState = useBIDSExport();
  const {
    currentStep,
    files,
    isExporting,
    progress,
    nextStep,
    prevStep,
    goToStep,
    reset,
  } = exportState;

  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === STEPS.length - 1;

  const canProceed = (): boolean => {
    switch (currentStep) {
      case "files":
        return files.length > 0;
      case "assignment":
        return files.every((f) => f.subjectId && f.task);
      case "metadata":
        return exportState.metadata.name.trim().length > 0;
      case "options":
        return true;
      case "review":
        return exportState.outputPath.length > 0;
      default:
        return false;
    }
  };

  const handleClose = () => {
    if (!isExporting) {
      reset();
      onOpenChange(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case "files":
        return (
          <FileSelectionStep {...exportState} initialFiles={initialFiles} />
        );
      case "assignment":
        return <AssignmentStep {...exportState} />;
      case "metadata":
        return <MetadataStep {...exportState} />;
      case "options":
        return <OptionsStep {...exportState} />;
      case "review":
        return <ReviewStep {...exportState} />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Export to BIDS</DialogTitle>
          <DialogDescription>
            Create a BIDS-compliant dataset from your EEG files
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 py-4 border-b">
          {STEPS.map((step, index) => (
            <React.Fragment key={step.id}>
              <button
                onClick={() =>
                  !isExporting && index <= currentStepIndex && goToStep(step.id)
                }
                disabled={isExporting || index > currentStepIndex}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md transition-colors",
                  currentStep === step.id
                    ? "bg-primary text-primary-foreground"
                    : index < currentStepIndex
                      ? "text-primary hover:bg-muted cursor-pointer"
                      : "text-muted-foreground cursor-not-allowed",
                )}
              >
                {step.icon}
                <span className="hidden sm:inline text-sm">{step.label}</span>
              </button>
              {index < STEPS.length - 1 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-auto py-4 min-h-[400px]">
          {renderStepContent()}
        </div>

        {/* Progress bar during export */}
        {isExporting && progress && (
          <div className="border-t pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">
                Processing {progress.currentFileName} ({progress.currentFile}/
                {progress.totalFiles})
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={isFirstStep || isExporting}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={isExporting}
            >
              Cancel
            </Button>
            {isLastStep ? (
              <Button
                onClick={exportState.startExport}
                disabled={!canProceed() || isExporting}
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  "Export"
                )}
              </Button>
            ) : (
              <Button onClick={nextStep} disabled={!canProceed()}>
                Next
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
